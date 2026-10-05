"""
Student services – ``/api/services``

GET    /api/services          list with filters
GET    /api/services/<id>     single service
POST   /api/services          create (auth, moderation applies)
PUT    /api/services/<id>     edit (owner or admin)
DELETE /api/services/<id>     delete (owner or admin)
"""

from flask import Blueprint, request
from sqlalchemy import func, or_

from config import Config
from extensions import db
from models import Service
from utils.decorators import current_user, login_required
from utils.helpers import (
    api_error,
    api_success,
    apply_price_range,
    apply_search,
    apply_sort,
    owner_or_admin,
    paginate,
    parse_float,
    parse_int,
    request_data,
)
from utils.validators import (
    ValidationError,
    clean_text,
    normalize_image_reference,
    validate_price,
)

services_bp = Blueprint("services", __name__)

SERVICE_CATEGORIES = [
    "laundry",
    "printing",
    "tutoring",
    "barbing",
    "cleaning",
    "delivery",
    "photography",
    "tech-repair",
    "catering",
    "others",
]


@services_bp.get("/services")
def list_services():
    """Public service feed with search, category and price filters."""
    viewer = current_user(optional=True)
    query = Service.query

    status = (request.args.get("status") or "").strip().lower()
    if viewer and viewer.is_admin:
        query = query.filter(Service.status == status) if status else query
    elif status and status != "published" and viewer:
        query = query.filter(Service.provider_id == viewer.id, Service.status == status)
    else:
        conditions = [Service.status == "published"]
        if viewer:
            conditions.append(Service.provider_id == viewer.id)
        query = query.filter(or_(*conditions))

    category = (request.args.get("category") or "").strip().lower()
    if category in {"all", ""}:
        category = None
    if category and category in SERVICE_CATEGORIES:
        query = query.filter(Service.category == category)

    location = (request.args.get("location") or "").strip()
    if location:
        query = query.filter(Service.location.ilike(f"%{location}%"))

    provider_id = parse_int(request.args.get("provider_id"))
    if provider_id:
        query = query.filter(Service.provider_id == provider_id)

    query = apply_search(
        query, Service, request.args.get("q"), ("title", "description", "category", "location")
    )
    query = apply_price_range(
        query,
        Service,
        parse_float(request.args.get("min_price")),
        parse_float(request.args.get("max_price")),
    )
    query = apply_sort(query, Service, request.args.get("sort"))

    result = paginate(query, lambda row: row.to_dict(viewer=viewer))
    result["categories"] = SERVICE_CATEGORIES
    return api_success(result)


@services_bp.get("/services/categories")
def service_categories():
    """Service categories with live counts."""
    rows = (
        db.session.query(Service.category, func.count(Service.id))
        .filter(Service.status == "published")
        .group_by(Service.category)
        .all()
    )
    counts = {category: count for category, count in rows}
    return api_success(
        {
            "categories": [
                {"name": name, "count": counts.get(name, 0)} for name in SERVICE_CATEGORIES
            ],
            "total": sum(counts.values()),
        }
    )


@services_bp.get("/services/<int:service_id>")
def get_service(service_id: int):
    """Single service details."""
    viewer = current_user(optional=True)
    service = db.session.get(Service, service_id)
    if service is None:
        return api_error("Service not found", 404)
    if service.status != "published" and not owner_or_admin(viewer, service):
        return api_error("This service is not available", 403)
    if not owner_or_admin(viewer, service):
        service.views = (service.views or 0) + 1
        db.session.commit()
    return api_success(service.to_dict(viewer=viewer))


@services_bp.post("/services")
@login_required
def create_service():
    """Create a service offering."""
    user = current_user()
    payload = request_data()
    try:
        title = clean_text(payload.get("title"), 160)
        if len(title) < 3:
            raise ValidationError("Title is too short", {"title": "At least 3 characters"})
        description = clean_text(payload.get("description"), 4000)
        if len(description) < 10:
            raise ValidationError(
                "Please describe your service (at least 10 characters)",
                {"description": "Too short"},
            )
        category = clean_text(payload.get("category"), 60).lower() or "others"
        if category not in SERVICE_CATEGORIES:
            category = "others"

        service = Service(
            provider_id=user.id,
            title=title,
            description=description,
            category=category,
            price=validate_price(payload.get("price"), required=False),
            price_unit=clean_text(payload.get("price_unit"), 40) or "per job",
            location=clean_text(payload.get("location"), 160) or "UNILAFIA Campus",
            image_url=normalize_image_reference(payload.get("image_url")),
            status="published" if (Config.AUTO_PUBLISH or user.is_admin) else "pending",
        )
        db.session.add(service)
        db.session.commit()
        return api_success(
            service.to_dict(viewer=user),
            message="Service submitted for review."
            if service.status == "pending"
            else "Service published!",
            status=201,
        )
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@services_bp.put("/services/<int:service_id>")
@login_required
def update_service(service_id: int):
    """Edit a service (owner or admin)."""
    viewer = current_user()
    service = db.session.get(Service, service_id)
    if service is None:
        return api_error("Service not found", 404)
    if not owner_or_admin(viewer, service):
        return api_error("You can only edit your own services", 403)

    payload = request_data()
    try:
        if payload.get("title"):
            service.title = clean_text(payload["title"], 160)
        if payload.get("description"):
            service.description = clean_text(payload["description"], 4000)
        if payload.get("category"):
            category = clean_text(payload["category"], 60).lower()
            service.category = category if category in SERVICE_CATEGORIES else service.category
        if payload.get("price") is not None:
            service.price = validate_price(payload["price"])
        if payload.get("price_unit"):
            service.price_unit = clean_text(payload["price_unit"], 40)
        if payload.get("location"):
            service.location = clean_text(payload["location"], 160)
        if "image_url" in payload:
            service.image_url = normalize_image_reference(payload.get("image_url"))

        new_status = (payload.get("status") or "").lower()
        if new_status in {"archived", "sold"}:
            service.status = new_status
        elif viewer.is_admin and new_status == "published":
            service.status = "published"
        elif not viewer.is_admin and service.status == "published":
            service.status = "pending"

        db.session.commit()
        return api_success(service.to_dict(viewer=viewer), message="Service updated")
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@services_bp.delete("/services/<int:service_id>")
@login_required
def delete_service(service_id: int):
    """Delete a service (owner or admin)."""
    viewer = current_user()
    service = db.session.get(Service, service_id)
    if service is None:
        return api_error("Service not found", 404)
    if not owner_or_admin(viewer, service):
        return api_error("You can only delete your own services", 403)
    db.session.delete(service)
    db.session.commit()
    return api_success(message="Service deleted")
