"""
User profiles, ratings and reviews – ``/api/users``

GET    /api/users/<id>              public profile
PUT    /api/users/<id>              update profile (self or admin)
GET    /api/users/<id>/listings     everything the user has posted
GET    /api/users/<id>/reviews      reviews received
POST   /api/users/<id>/reviews      write / update a review (auth)
GET    /api/users/<id>/stats        dashboard counters
DELETE /api/users/<id>              admin-only account removal
"""

from flask import Blueprint, request

from extensions import db
from models import (
    Accommodation,
    Event,
    Favorite,
    Product,
    Review,
    Service,
    User,
)
from utils.decorators import admin_required, current_user, login_required
from utils.helpers import api_error, api_success, parse_int, request_data
from utils.validators import (
    ValidationError,
    clean_text,
    normalize_image_reference,
    validate_email,
    validate_phone,
    validate_rating,
)

users_bp = Blueprint("users", __name__)


def _profile_counts(user: User) -> dict:
    """How many published listings the user has of each kind."""
    return {
        "products": Product.query.filter_by(seller_id=user.id, status="published").count(),
        "accommodation": Accommodation.query.filter_by(
            landlord_id=user.id, status="published"
        ).count(),
        "events": Event.query.filter_by(creator_id=user.id, status="published").count(),
        "services": Service.query.filter_by(provider_id=user.id, status="published").count(),
    }


@users_bp.get("/users/<int:user_id>")
def get_user(user_id: int):
    """Public profile – contact details only for the owner and for admins."""
    viewer = current_user(optional=True)
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found", 404)

    include_private = bool(viewer and (viewer.id == user.id or viewer.is_admin))
    data = user.to_dict(include_private=True)   # sellers are contacted by phone/WhatsApp
    data["is_me"] = bool(viewer and viewer.id == user.id)
    data["listings_count"] = _profile_counts(user)
    data["joined"] = data.get("created_at")
    if not include_private:
        data.pop("email", None)
    return api_success(data)


@users_bp.put("/users/<int:user_id>")
@login_required
def update_user(user_id: int):
    """Update a profile (only your own, unless you are an admin)."""
    viewer = current_user()
    if viewer.id != user_id and not viewer.is_admin:
        return api_error("You can only edit your own profile", 403)

    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found", 404)

    payload = request_data()
    try:
        if payload.get("name"):
            name = clean_text(payload["name"], 120)
            if len(name) < 3:
                raise ValidationError("Please enter a full name", {"name": "Too short"})
            user.name = name
        if payload.get("email"):
            email = validate_email(payload["email"])
            clash = User.query.filter(User.email == email, User.id != user.id).first()
            if clash:
                return api_error("That email is already in use", 409,
                                 {"email": "Email already registered"})
            user.email = email
        if payload.get("phone"):
            user.phone = validate_phone(payload["phone"])
        if payload.get("whatsapp"):
            user.whatsapp = validate_phone(payload["whatsapp"])

        for field, limit in (
            ("bio", 600),
            ("department", 120),
            ("level", 20),
            ("location", 160),
        ):
            if field in payload:
                setattr(user, field, clean_text(payload.get(field), limit) or None)
        if "avatar_url" in payload:
            # Normalised like a listing image: a bucket key survives a provider
            # or domain change, a pasted (or expiring) URL does not.
            user.avatar_url = normalize_image_reference(payload.get("avatar_url"), "avatar_url")

        # Admins may toggle verification / account status.
        if viewer.is_admin:
            if "verified" in payload:
                user.verified = str(payload["verified"]).lower() in {"1", "true", "yes", "on"}
            if "is_active" in payload:
                user.is_active = str(payload["is_active"]).lower() in {"1", "true", "yes", "on"}

        db.session.commit()
        return api_success(user.to_dict(include_private=True), message="Profile updated")
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@users_bp.get("/users/<int:user_id>/listings")
def user_listings(user_id: int):
    """
    Everything a user has posted, grouped by type.

    Visitors only see published items; the owner and admins also see drafts
    (pending / rejected) so the "My listings" tab can show status badges.
    """
    viewer = current_user(optional=True)
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found", 404)

    is_owner = bool(viewer and (viewer.id == user.id or viewer.is_admin))
    only_published = None if is_owner else "published"

    def filter_status(query):
        return query if only_published is None else query.filter_by(status=only_published)

    products = filter_status(Product.query.filter_by(seller_id=user.id)) \
        .order_by(Product.created_at.desc()).limit(50).all()
    rooms = filter_status(Accommodation.query.filter_by(landlord_id=user.id)) \
        .order_by(Accommodation.created_at.desc()).limit(50).all()
    events = filter_status(Event.query.filter_by(creator_id=user.id)) \
        .order_by(Event.created_at.desc()).limit(50).all()
    services = filter_status(Service.query.filter_by(provider_id=user.id)) \
        .order_by(Service.created_at.desc()).limit(50).all()

    return api_success(
        {
            "user": user.to_dict(include_private=is_owner),
            "products": [row.to_dict(viewer=viewer) for row in products],
            "accommodation": [row.to_dict(viewer=viewer) for row in rooms],
            "events": [row.to_dict(viewer=viewer) for row in events],
            "services": [row.to_dict(viewer=viewer) for row in services],
            "counts": {
                "products": len(products),
                "accommodation": len(rooms),
                "events": len(events),
                "services": len(services),
                "total": len(products) + len(rooms) + len(events) + len(services),
            },
        }
    )


@users_bp.get("/users/<int:user_id>/stats")
def user_stats(user_id: int):
    """Small counters shown on the profile header."""
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found", 404)
    published = _profile_counts(user)
    return api_success(
        {
            "listings": published,
            "total_listings": sum(published.values()),
            "rating_average": user.rating_average,
            "rating_count": user.rating_count,
            "verified": user.verified,
            "member_since": user.created_at.isoformat() if user.created_at else None,
        }
    )


@users_bp.get("/users/<int:user_id>/reviews")
def user_reviews(user_id: int):
    """Reviews received by a user (newest first)."""
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found", 404)
    reviews = (
        Review.query.filter_by(target_id=user.id)
        .order_by(Review.created_at.desc())
        .limit(parse_int(request.args.get("limit"), 50, minimum=1, maximum=200))
        .all()
    )
    return api_success(
        {
            "reviews": [review.to_dict() for review in reviews],
            "rating_average": user.rating_average,
            "rating_count": user.rating_count,
        }
    )


@users_bp.post("/users/<int:user_id>/reviews")
@login_required
def create_review(user_id: int):
    """Leave (or update) a 1–5 star review for another user."""
    author = current_user()
    if author.id == user_id:
        return api_error("You cannot review your own account", 400)

    target = db.session.get(User, user_id)
    if target is None:
        return api_error("User not found", 404)

    payload = request_data()
    try:
        rating = validate_rating(payload.get("rating"))
        comment = clean_text(payload.get("comment"), 600)

        review = Review.query.filter_by(author_id=author.id, target_id=target.id).first()
        if review is None:
            review = Review(author_id=author.id, target_id=target.id)
            db.session.add(review)
        review.rating = rating
        review.comment = comment
        review.listing_type = clean_text(payload.get("listing_type"), 30) or None
        review.listing_id = parse_int(payload.get("listing_id"))

        db.session.commit()
        return api_success(
            {"review": review.to_dict(), "rating_average": target.rating_average,
             "rating_count": target.rating_count},
            message="Thanks for your review!",
            status=201,
        )
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@users_bp.delete("/reviews/<int:review_id>")
@login_required
def delete_review(review_id: int):
    """Delete your own review, or any review if you are an admin."""
    viewer = current_user()
    review = db.session.get(Review, review_id)
    if review is None:
        return api_error("Review not found", 404)
    if review.author_id != viewer.id and not viewer.is_admin:
        return api_error("You can only delete your own reviews", 403)
    db.session.delete(review)
    db.session.commit()
    return api_success(message="Review deleted")


@users_bp.delete("/users/<int:user_id>")
@login_required
@admin_required
def delete_user(user_id: int):
    """Admin-only: permanently remove an account and its listings."""
    viewer = current_user()
    if viewer.id == user_id:
        return api_error("You cannot delete your own admin account", 400)
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found", 404)
    Favorite.query.filter_by(user_id=user.id).delete()
    db.session.delete(user)
    db.session.commit()
    return api_success(message="User account deleted")
