"""Accommodation listing endpoints."""
from decimal import Decimal, InvalidOperation

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required, verify_jwt_in_request
from sqlalchemy import or_

from ..extensions import db
from ..models import Accommodation, Favorite, User
from .common import (
    api_error,
    clean_text,
    listing_response,
    pagination_args,
    payload_data,
    positive_price,
    remove_uploaded_image,
    save_uploaded_image,
)

bp = Blueprint("accommodation", __name__)
ROOM_TYPES = {"room", "self_contain", "hostel", "shared"}


def _user():
    try:
        return db.session.get(User, int(get_jwt_identity()))
    except (TypeError, ValueError):
        return None


@bp.get("")
def list_accommodation():
    query = Accommodation.query.filter_by(status="published")
    search = request.args.get("q", request.args.get("search", "")).strip()
    location = request.args.get("location", "").strip()
    room_type = request.args.get("room_type", "").strip().lower()
    if search:
        term = f"%{search[:100]}%"
        query = query.filter(or_(Accommodation.title.ilike(term), Accommodation.description.ilike(term), Accommodation.location.ilike(term)))
    if location:
        query = query.filter(Accommodation.location.ilike(f"%{location[:160]}%"))
    if room_type:
        query = query.filter(Accommodation.room_type == room_type)
    try:
        if request.args.get("min_price") not in (None, ""):
            minimum = Decimal(request.args["min_price"])
            if not minimum.is_finite() or minimum < 0:
                raise InvalidOperation
            query = query.filter(Accommodation.price >= minimum)
        if request.args.get("max_price") not in (None, ""):
            maximum = Decimal(request.args["max_price"])
            if not maximum.is_finite() or maximum < 0:
                raise InvalidOperation
            query = query.filter(Accommodation.price <= maximum)
    except (InvalidOperation, ValueError):
        return api_error("Price filters must be valid amounts greater than or equal to zero.", 400)

    sort = request.args.get("sort", "newest")
    if sort == "price_low":
        query = query.order_by(Accommodation.price.asc())
    elif sort == "price_high":
        query = query.order_by(Accommodation.price.desc())
    else:
        query = query.order_by(Accommodation.created_at.desc())
    page, per_page = pagination_args()
    result = query.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify(listing_response(result, lambda item: item.to_dict()))


@bp.post("")
@jwt_required()
def create_accommodation():
    data = payload_data()
    try:
        title = clean_text(data.get("title"), "Title", maximum=140)
        description = clean_text(data.get("description"), "Description", maximum=5000, minimum=10)
        location = clean_text(data.get("location"), "Location", maximum=160)
        price = positive_price(data.get("price"))
        try:
            rooms = int(data.get("rooms", 1))
        except (TypeError, ValueError):
            raise ValueError("Rooms must be a whole number greater than zero.")
        if rooms < 1 or rooms > 1000:
            raise ValueError("Rooms must be a whole number greater than zero.")
        room_type = str(data.get("room_type", "room")).strip().lower()
        if room_type not in ROOM_TYPES:
            raise ValueError("Choose a valid accommodation type.")
        image_url = save_uploaded_image(request.files.get("image")) if request.files.get("image") else ""
    except ValueError as exc:
        return api_error(str(exc), 400)

    landlord = _user()
    if landlord is None:
        return api_error("Account not found.", 401)
    listing = Accommodation(
        landlord_id=landlord.id,
        title=title,
        description=description,
        location=location,
        price=price,
        rooms=rooms,
        room_type=room_type,
        image_url=image_url,
        status="pending",
    )
    db.session.add(listing)
    db.session.commit()
    return jsonify({"message": "Accommodation submitted for review.", "accommodation": listing.to_dict()}), 201


@bp.get("/<int:listing_id>")
def get_accommodation(listing_id):
    listing = db.session.get(Accommodation, listing_id)
    if listing is None:
        return api_error("Accommodation listing not found.", 404)
    if listing.status != "published":
        verify_jwt_in_request(optional=True)
        viewer = _user()
        if viewer is None or (viewer.id != listing.landlord_id and not viewer.is_admin):
            return api_error("Accommodation listing not found.", 404)
    return jsonify({"accommodation": listing.to_dict()})


@bp.put("/<int:listing_id>")
@jwt_required()
def update_accommodation(listing_id):
    listing = db.session.get(Accommodation, listing_id)
    user = _user()
    if listing is None:
        return api_error("Accommodation listing not found.", 404)
    if user is None or (listing.landlord_id != user.id and not user.is_admin):
        return api_error("You can only edit your own listing.", 403)
    data = payload_data()
    changed = False
    try:
        for key, maximum in (("title", 140), ("description", 5000), ("location", 160)):
            if key in data:
                value = clean_text(data[key], key.title(), maximum=maximum, minimum=10 if key == "description" else 1)
                if getattr(listing, key) != value:
                    setattr(listing, key, value)
                    changed = True
        if "price" in data:
            value = positive_price(data["price"])
            if listing.price != value:
                listing.price = value
                changed = True
        if "rooms" in data:
            try:
                value = int(data["rooms"])
            except (ValueError, TypeError):
                raise ValueError("Rooms must be a whole number greater than zero.")
            if value < 1 or value > 1000:
                raise ValueError("Rooms must be a whole number greater than zero.")
            if listing.rooms != value:
                listing.rooms = value
                changed = True
        if "room_type" in data:
            value = str(data["room_type"]).strip().lower()
            if value not in ROOM_TYPES:
                raise ValueError("Choose a valid accommodation type.")
            if listing.room_type != value:
                listing.room_type = value
                changed = True
        image = request.files.get("image")
        if image and image.filename:
            new_url = save_uploaded_image(image)
            remove_uploaded_image(listing.image_url)
            listing.image_url = new_url
            changed = True
    except ValueError as exc:
        return api_error(str(exc), 400)
    if changed and listing.status == "published":
        listing.status = "pending"
    db.session.commit()
    return jsonify({"message": "Accommodation updated. Published changes are reviewed again.", "accommodation": listing.to_dict()})


@bp.delete("/<int:listing_id>")
@jwt_required()
def delete_accommodation(listing_id):
    listing = db.session.get(Accommodation, listing_id)
    user = _user()
    if listing is None:
        return api_error("Accommodation listing not found.", 404)
    if user is None or (listing.landlord_id != user.id and not user.is_admin):
        return api_error("You can only delete your own listing.", 403)
    remove_uploaded_image(listing.image_url)
    Favorite.query.filter_by(listing_type="accommodation", listing_id=listing.id).delete(synchronize_session=False)
    db.session.delete(listing)
    db.session.commit()
    return jsonify({"message": "Accommodation listing deleted."})
