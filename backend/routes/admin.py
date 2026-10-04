"""Moderation and administrator-only endpoints."""
from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import or_

from ..extensions import db
from ..models import Accommodation, Event, Product, Service, User
from .common import admin_required, api_error, pagination_args, payload_data

bp = Blueprint("admin", __name__)
LISTING_MODELS = {
    "product": Product,
    "accommodation": Accommodation,
    "event": Event,
    "service": Service,
}


def _serialize_listing(kind, item):
    return {"listing_type": kind, **item.to_dict()}


def _pending_items():
    return {
        kind: [_serialize_listing(kind, item) for item in model.query.filter_by(status="pending").order_by(model.created_at.asc()).all()]
        for kind, model in LISTING_MODELS.items()
    }


@bp.get("/pending")
@bp.get("/pending-listings")
@admin_required
def pending_listings():
    items = _pending_items()
    return jsonify({"items": items, "total": sum(len(group) for group in items.values())})


@bp.post("/approve/<int:listing_id>")
@bp.post("/approve/<string:listing_type>/<int:listing_id>")
@admin_required
def approve_listing(listing_id, listing_type="product"):
    data = payload_data()
    listing_type = str(data.get("listing_type") or listing_type or "product").lower()
    model = LISTING_MODELS.get(listing_type)
    if model is None:
        return api_error("Listing type must be product, accommodation, event or service.", 400)
    listing = db.session.get(model, listing_id)
    if listing is None:
        return api_error("Listing not found.", 404)
    if listing.status != "pending":
        return api_error(f"Only pending listings can be approved (current status: {listing.status}).", 409)
    listing.status = "published"
    db.session.commit()
    current_app.logger.info("Admin approved %s listing %s", listing_type, listing_id)
    return jsonify({"message": "Listing approved and published.", "listing": _serialize_listing(listing_type, listing)})


@bp.post("/reject/<int:listing_id>")
@bp.post("/reject/<string:listing_type>/<int:listing_id>")
@admin_required
def reject_listing(listing_id, listing_type="product"):
    data = payload_data()
    listing_type = str(data.get("listing_type") or listing_type or "product").lower()
    model = LISTING_MODELS.get(listing_type)
    if model is None:
        return api_error("Listing type must be product, accommodation, event or service.", 400)
    listing = db.session.get(model, listing_id)
    if listing is None:
        return api_error("Listing not found.", 404)
    if listing.status != "pending":
        return api_error(f"Only pending listings can be rejected (current status: {listing.status}).", 409)
    listing.status = "rejected"
    db.session.commit()
    current_app.logger.info("Admin rejected %s listing %s", listing_type, listing_id)
    return jsonify({"message": "Listing rejected.", "listing": _serialize_listing(listing_type, listing)})


@bp.get("/users")
@admin_required
def list_users():
    search = request.args.get("q", "").strip()
    query = User.query
    if search:
        term = f"%{search[:100]}%"
        query = query.filter(or_(User.name.ilike(term), User.email.ilike(term), User.phone.ilike(term)))
    page, per_page = pagination_args()
    result = query.order_by(User.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        "items": [{
            **user.to_dict(),
            "email": user.email,
            "listing_count": Product.query.filter_by(seller_id=user.id).count()
                             + Accommodation.query.filter_by(landlord_id=user.id).count()
                             + Event.query.filter_by(creator_id=user.id).count()
                             + Service.query.filter_by(provider_id=user.id).count(),
        } for user in result.items],
        "pagination": {
            "page": result.page, "per_page": result.per_page, "total": result.total,
            "pages": result.pages, "has_next": result.has_next, "has_prev": result.has_prev,
        },
    })


@bp.post("/users/<int:user_id>/verify")
@admin_required
def verify_user(user_id):
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found.", 404)
    user.verified = True
    db.session.commit()
    return jsonify({"message": "Student account verified.", "user": user.to_dict()})


@bp.get("/stats")
@admin_required
def admin_stats():
    return jsonify({
        "users": User.query.count(),
        "published_products": Product.query.filter_by(status="published").count(),
        "pending_listings": sum(model.query.filter_by(status="pending").count() for model in LISTING_MODELS.values()),
        "published_accommodation": Accommodation.query.filter_by(status="published").count(),
        "published_events": Event.query.filter_by(status="published").count(),
    })
