"""Public profiles, listing history and student ratings."""
import re

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required, verify_jwt_in_request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import Accommodation, Event, Product, Review, Service, User
from .common import (
    api_error,
    clean_text,
    listing_response,
    pagination_args,
    payload_data,
)

bp = Blueprint("users", __name__)
PHONE_RE = re.compile(r"^[+()0-9 .-]{7,32}$")
LISTING_MODELS = {
    "product": (Product, "seller_id"),
    "accommodation": (Accommodation, "landlord_id"),
    "event": (Event, "creator_id"),
    "service": (Service, "provider_id"),
}


def _viewer():
    try:
        verify_jwt_in_request(optional=True)
        identity = get_jwt_identity()
        return db.session.get(User, int(identity)) if identity is not None else None
    except (TypeError, ValueError):
        return None


@bp.get("/<int:user_id>")
def get_profile(user_id):
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found.", 404)
    average, review_count = db.session.query(func.avg(Review.rating), func.count(Review.id)).filter(
        Review.reviewed_user_id == user.id
    ).one()
    published_products = Product.query.filter_by(seller_id=user.id, status="published").count()
    published_accommodation = Accommodation.query.filter_by(landlord_id=user.id, status="published").count()
    return jsonify({
        "user": user.to_dict(),
        "rating": {"average": round(float(average or 0), 1), "count": review_count},
        "listing_count": published_products + published_accommodation
                          + Event.query.filter_by(creator_id=user.id, status="published").count()
                          + Service.query.filter_by(provider_id=user.id, status="published").count(),
    })


@bp.put("/<int:user_id>")
@jwt_required()
def update_profile(user_id):
    user = db.session.get(User, user_id)
    viewer = _viewer()
    if user is None:
        return api_error("User not found.", 404)
    if viewer is None or (viewer.id != user.id and not viewer.is_admin):
        return api_error("You can only update your own profile.", 403)
    data = payload_data()
    try:
        if "name" in data:
            user.name = clean_text(data.get("name"), "Name", maximum=100, minimum=2)
        if "phone" in data:
            phone = clean_text(data.get("phone"), "Phone number", maximum=32)
            if not PHONE_RE.fullmatch(phone):
                raise ValueError("Enter a valid phone number.")
            user.phone = phone
        if "bio" in data:
            user.bio = clean_text(data.get("bio"), "Bio", required=False, maximum=500)
    except ValueError as exc:
        return api_error(str(exc), 400)
    db.session.commit()
    return jsonify({"message": "Profile updated.", "user": user.to_dict()})


@bp.get("/<int:user_id>/listings")
def user_listings(user_id):
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found.", 404)
    viewer = _viewer()
    is_owner = viewer is not None and (viewer.id == user.id or viewer.is_admin)
    listing_type = request.args.get("type", "all").strip().lower()
    if listing_type not in {"all", *LISTING_MODELS.keys()}:
        return api_error("Listing type must be product, accommodation, event, service or all.", 400)

    response = {}
    page, per_page = pagination_args()
    for kind, (model, owner_field) in LISTING_MODELS.items():
        if listing_type != "all" and listing_type != kind:
            continue
        query = model.query.filter(getattr(model, owner_field) == user.id)
        if not is_owner:
            query = query.filter_by(status="published")
        query = query.order_by(model.created_at.desc())
        result = query.paginate(page=page, per_page=per_page, error_out=False)
        response["items" if listing_type != "all" else kind + "s"] = listing_response(result, lambda item: item.to_dict())
    return jsonify(response)


@bp.get("/<int:user_id>/reviews")
def user_reviews(user_id):
    if db.session.get(User, user_id) is None:
        return api_error("User not found.", 404)
    page, per_page = pagination_args()
    result = Review.query.filter_by(reviewed_user_id=user_id).order_by(Review.created_at.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )
    return jsonify(listing_response(result, lambda item: item.to_dict()))


@bp.post("/<int:user_id>/reviews")
@jwt_required()
def create_review(user_id):
    reviewed = db.session.get(User, user_id)
    try:
        reviewer_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        reviewer_id = None
    if reviewed is None:
        return api_error("User not found.", 404)
    if reviewer_id is None or reviewer_id == reviewed.id:
        return api_error("You cannot review your own account.", 400)
    data = payload_data()
    try:
        rating = int(data.get("rating"))
    except (TypeError, ValueError):
        return api_error("Rating must be a whole number from 1 to 5.", 400)
    if rating < 1 or rating > 5:
        return api_error("Rating must be a whole number from 1 to 5.", 400)
    try:
        comment = clean_text(data.get("comment", ""), "Comment", required=False, maximum=800)
    except ValueError as exc:
        return api_error(str(exc), 400)
    review = Review(reviewer_id=reviewer_id, reviewed_user_id=reviewed.id, rating=rating, comment=comment)
    db.session.add(review)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_error("You have already reviewed this student.", 409)
    return jsonify({"message": "Thanks for sharing your experience.", "review": review.to_dict()}), 201
