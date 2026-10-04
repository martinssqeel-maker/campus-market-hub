"""
Accommodation routes – ``/api/accommodation``

GET    /api/accommodation            list with filters (price, type, location…)
GET    /api/accommodation/types      room-type options + published counts
GET    /api/accommodation/locations  popular areas around campus
GET    /api/accommodation/<id>       single listing (increments views)
POST   /api/accommodation            create (auth, moderation applies)
PUT    /api/accommodation/<id>       edit (owner or admin)
DELETE /api/accommodation/<id>       delete (owner or admin)
"""

from flask import Blueprint, request
from sqlalchemy import func, or_

from config import Config
from extensions import db
from models import Accommodation
from utils.decorators import current_user, login_required
from utils.helpers import (
    api_error,
    api_success,
    apply_price_range,
    apply_search,
    apply_sort,
    owner_or_admin,
    paginate,
    parse_bool,
    parse_float,
    parse_int,
    request_data,
)
from utils.validators import ValidationError, clean_text

accommodation_bp = Blueprint("accommodation", __name__)

#: Canonical room types (matches the filter chips on the frontend).
ROOM_TYPES = ["single", "self-contain", "hostel", "flat", "shared"]


@accommodation_bp.get("/accommodation")
def list_accommodation():
    """Public accommodation feed with price / type / gender / location filters."""
    viewer = current_user(optional=True)
    query = Accommodation.query

    # Moderation visibility (published + own drafts; admins see all).
    status = (request.args.get("status") or "").strip().lower()
    if viewer and viewer.is_admin:
        query = query.filter(Accommodation.status == status) if status else query
    elif status and status != "published" and viewer:
        query = query.filter(
            Accommodation.landlord_id == viewer.id, Accommodation.status == status
        )
    else:
        conditions = [Accommodation.status == "published"]
        if viewer:
            conditions.append(Accommodation.landlord_id == viewer.id)
        query = query.filter(or_(*conditions))

    # --- filters ----------------------------------------------------------
    room_type = (request.args.get("room_type") or request.args.get("type") or "").lower().strip()
    if room_type in {"all", ""}:
        room_type = None
    if room_type:
        query = query.filter(Accommodation.room_type == room_type)

    location = (request.args.get("location") or "").strip()
    if location:
        query = query.filter(Accommodation.location.ilike(f"%{location}%"))

    gender = (request.args.get("gender") or "").strip().lower()
    if gender and gender != "any":
        query = query.filter(or_(Accommodation.gender == gender, Accommodation.gender == "any"))

    if parse_bool(request.args.get("furnished")):
        query = query.filter(Accommodation.furnished.is_(True))

    rooms = parse_int(request.args.get("rooms"))
    if rooms:
        query = query.filter(Accommodation.rooms >= rooms)

    landlord_id = parse_int(request.args.get("landlord_id"))
    if landlord_id:
        query = query.filter(Accommodation.landlord_id == landlord_id)

    query = apply_search(
        query, Accommodation, request.args.get("q"), ("title", "description", "location")
    )
    query = apply_price_range(
        query,
        Accommodation,
        parse_float(request.args.get("min_price")),
        parse_float(request.args.get("max_price")),
    )
    query = apply_sort(query, Accommodation, request.args.get("sort"))

    result = paginate(query, lambda row: row.to_dict(viewer=viewer))
    result["room_types"] = ROOM_TYPES
    result["filters"] = {
        "q": request.args.get("q") or "",
        "room_type": room_type or "all",
        "min_price": request.args.get("min_price") or "",
        "max_price": request.args.get("max_price") or "",
        "location": location,
        "gender": gender or "any",
        "furnished": parse_bool(request.args.get("furnished")),
    }
    return api_success(result)


@accommodation_bp.get("/accommodation/types")
def accommodation_types():
    """Room types with the number of published listings in each."""
    rows = (
        db.session.query(Accommodation.room_type, func.count(Accommodation.id))
        .filter(Accommodation.status == "published")
        .group_by(Accommodation.room_type)
        .all()
    )
    counts = {room_type: count for room_type, count in rows}
    return api_success(
        {
            "types": [
                {"name": name, "count": counts.get(name, 0), "label": name.replace("-", " ").title()}
                for name in ROOM_TYPES
            ],
            "total": sum(counts.values()),
        }
    )


@accommodation_bp.get("/accommodation/locations")
def accommodation_locations():
    """Most popular areas (used for the location filter and quick chips)."""
    rows = (
        db.session.query(Accommodation.location, func.count(Accommodation.id))
        .filter(Accommodation.status == "published")
        .group_by(Accommodation.location)
        .order_by(func.count(Accommodation.id).desc())
        .limit(12)
        .all()
    )
    return api_success([{"location": row[0], "count": row[1]} for row in rows])


@accommodation_bp.get("/accommodation/<int:listing_id>")
def get_accommodation(listing_id: int):
    """Single accommodation listing."""
    viewer = current_user(optional=True)
    listing = db.session.get(Accommodation, listing_id)
    if listing is None:
        return api_error("Accommodation listing not found", 404)
    if listing.status != "published" and not owner_or_admin(viewer, listing):
        return api_error("This listing is not available", 403)

    if not owner_or_admin(viewer, listing):
        listing.views = (listing.views or 0) + 1
        db.session.commit()

    data = listing.to_dict(viewer=viewer)
    data["similar"] = [
        row.to_dict()
        for row in Accommodation.query.filter(
            Accommodation.status == "published",
            Accommodation.id != listing.id,
            Accommodation.room_type == listing.room_type,
        )
        .limit(3)
        .all()
    ]
    return api_success(data)


@accommodation_bp.post("/accommodation")
@login_required
def create_accommodation():
    """Create an accommodation listing (authentication required)."""
    user = current_user()
    payload = request_data()
    try:
        title = clean_text(payload.get("title"), 160)
        if len(title) < 3:
            raise ValidationError("Title is too short", {"title": "At least 3 characters"})
        location = clean_text(payload.get("location"), 160)
        if not location:
            raise ValidationError("Location is required", {"location": "Required"})

        from utils.validators import validate_price

        price = validate_price(payload.get("price"), required=True)
        room_type = clean_text(payload.get("room_type"), 40).lower() or "single"
        if room_type not in ROOM_TYPES:
            room_type = "single"

        listing = Accommodation(
            landlord_id=user.id,
            title=title,
            description=clean_text(payload.get("description"), 4000) or title,
            location=location,
            price=price,
            rooms=parse_int(payload.get("rooms"), 1, minimum=1, maximum=50),
            room_type=room_type,
            gender=clean_text(payload.get("gender"), 20).lower() or "any",
            furnished=parse_bool(payload.get("furnished")),
            amenities=", ".join(
                filter(None, [clean_text(a, 40) for a in _as_list(payload.get("amenities"))])
            ),
            image_url=clean_text(payload.get("image_url"), 300) or None,
            status="published" if (Config.AUTO_PUBLISH or user.is_admin) else "pending",
        )
        db.session.add(listing)
        db.session.commit()
        return api_success(
            listing.to_dict(viewer=user),
            message="Room submitted for review."
            if listing.status == "pending"
            else "Room published!",
            status=201,
        )
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@accommodation_bp.put("/accommodation/<int:listing_id>")
@login_required
def update_accommodation(listing_id: int):
    """Edit an accommodation listing (owner or admin)."""
    viewer = current_user()
    listing = db.session.get(Accommodation, listing_id)
    if listing is None:
        return api_error("Accommodation listing not found", 404)
    if not owner_or_admin(viewer, listing):
        return api_error("You can only edit your own listings", 403)

    payload = request_data()
    try:
        from utils.validators import validate_price

        # Partial updates: only the fields actually sent are validated.
        if payload.get("title") is not None:
            title = clean_text(payload["title"], 160)
            if len(title) < 3:
                raise ValidationError("Title is too short", {"title": "At least 3 characters"})
            listing.title = title
        if payload.get("description"):
            listing.description = clean_text(payload["description"], 4000)
        if payload.get("location"):
            listing.location = clean_text(payload["location"], 160)
        if payload.get("price") is not None:
            listing.price = validate_price(payload["price"], required=True)
        if payload.get("rooms") is not None:
            listing.rooms = parse_int(payload["rooms"], listing.rooms, minimum=1, maximum=50)
        if payload.get("room_type"):
            room_type = clean_text(payload["room_type"], 40).lower()
            listing.room_type = room_type if room_type in ROOM_TYPES else listing.room_type
        if payload.get("gender"):
            listing.gender = clean_text(payload["gender"], 20).lower()
        if "furnished" in payload:
            listing.furnished = parse_bool(payload["furnished"])
        if "amenities" in payload:
            listing.amenities = ", ".join(
                filter(None, [clean_text(a, 40) for a in _as_list(payload["amenities"])])
            )
        if "image_url" in payload:
            listing.image_url = clean_text(payload["image_url"], 300) or None

        new_status = (payload.get("status") or "").lower()
        if new_status in {"archived", "sold"}:
            listing.status = new_status
        elif viewer.is_admin and new_status == "published":
            listing.status = "published"
        elif not viewer.is_admin and listing.status == "published":
            listing.status = "pending"

        db.session.commit()
        return api_success(listing.to_dict(viewer=viewer), message="Listing updated")
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@accommodation_bp.delete("/accommodation/<int:listing_id>")
@login_required
def delete_accommodation(listing_id: int):
    """Delete an accommodation listing (owner or admin)."""
    viewer = current_user()
    listing = db.session.get(Accommodation, listing_id)
    if listing is None:
        return api_error("Accommodation listing not found", 404)
    if not owner_or_admin(viewer, listing):
        return api_error("You can only delete your own listings", 403)
    db.session.delete(listing)
    db.session.commit()
    return api_success(message="Listing deleted")


def _as_list(value):
    """Accept a comma-separated string *or* a real list for multi-value fields."""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    return [part.strip() for part in str(value).split(",") if part.strip()]
