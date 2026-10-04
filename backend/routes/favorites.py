"""Authenticated wishlist endpoints."""
from flask import Blueprint, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import Accommodation, Event, Favorite, Product, Service, User
from .common import api_error, payload_data

bp = Blueprint("favorites", __name__)
MODELS = {
    "product": Product,
    "accommodation": Accommodation,
    "event": Event,
    "service": Service,
}


def _user_id():
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


def _favorite_dict(favorite):
    model = MODELS.get(favorite.listing_type)
    item = db.session.get(model, favorite.listing_id) if model else None
    return {
        "id": favorite.id,
        "listing_type": favorite.listing_type,
        "listing_id": favorite.listing_id,
        "created_at": favorite.created_at.isoformat() + "Z",
        "listing": item.to_dict() if item and item.status == "published" else None,
    }


@bp.get("")
@jwt_required()
def list_favorites():
    user_id = _user_id()
    favorites = Favorite.query.filter_by(user_id=user_id).order_by(Favorite.created_at.desc()).all()
    items = [_favorite_dict(item) for item in favorites]
    return jsonify({"items": [item for item in items if item["listing"] is not None]})


@bp.post("")
@jwt_required()
def add_favorite():
    user_id = _user_id()
    if user_id is None or db.session.get(User, user_id) is None:
        return api_error("Account not found.", 401)
    data = payload_data()
    listing_type = str(data.get("listing_type", "product")).strip().lower()
    try:
        listing_id = int(data.get("listing_id"))
    except (TypeError, ValueError):
        return api_error("A valid listing ID is required.", 400)
    model = MODELS.get(listing_type)
    if model is None:
        return api_error("Listing type must be product, accommodation, event or service.", 400)
    listing = db.session.get(model, listing_id)
    if listing is None or listing.status != "published":
        return api_error("Published listing not found.", 404)
    favorite = Favorite(user_id=user_id, listing_type=listing_type, listing_id=listing_id)
    db.session.add(favorite)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        favorite = Favorite.query.filter_by(user_id=user_id, listing_type=listing_type, listing_id=listing_id).first()
        return jsonify({"message": "Already in your wishlist.", "favorite": _favorite_dict(favorite)}), 200
    return jsonify({"message": "Saved to your wishlist.", "favorite": _favorite_dict(favorite)}), 201


@bp.delete("/<int:favorite_id>")
@jwt_required()
def remove_favorite(favorite_id):
    favorite = Favorite.query.filter_by(id=favorite_id, user_id=_user_id()).first()
    if favorite is None:
        return api_error("Saved listing not found.", 404)
    db.session.delete(favorite)
    db.session.commit()
    return jsonify({"message": "Removed from your wishlist."})


@bp.delete("/listing/<listing_type>/<int:listing_id>")
@jwt_required()
def remove_favorite_by_listing(listing_type, listing_id):
    favorite = Favorite.query.filter_by(user_id=_user_id(), listing_type=listing_type, listing_id=listing_id).first()
    if favorite is None:
        return api_error("Saved listing not found.", 404)
    db.session.delete(favorite)
    db.session.commit()
    return jsonify({"message": "Removed from your wishlist."})
