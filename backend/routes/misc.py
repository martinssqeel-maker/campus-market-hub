"""
Public utility routes.

GET /api/health          liveness probe / smoke-test
GET /api/stats           marketplace counters for the home page
GET /api/search          cross-type search (products, rooms, events, services)
GET /api/meta            categories, room types and sort options for the UI
GET /api/popular         trending searches / popular categories
"""

from flask import Blueprint, current_app, request
from sqlalchemy import func, or_

from config import secret_warnings
from extensions import db
from models import Accommodation, Event, Product, Service, User
from storage import get_storage
from utils.decorators import current_user
from utils.helpers import api_success, parse_int
from routes.accommodation import ROOM_TYPES
from routes.events import EVENT_CATEGORIES
from routes.products import PRODUCT_CATEGORIES
from routes.services import SERVICE_CATEGORIES

misc_bp = Blueprint("misc", __name__)


def _image_report(storage: dict) -> dict:
    """Plain-language verdict on *why photos do or do not render*.

    ``/api/health`` is the place an operator looks when "the picture is in the
    bucket but the listing is empty", so the answer is spelled out here instead
    of leaving them to compare ``S3_*`` values by eye.
    """
    delivery = storage.get("image_delivery") or "unknown"
    problems = []
    if storage.get("error"):
        problems.append(
            "Image storage is not usable, so new uploads fail: " + str(storage["error"])
        )
    elif storage.get("backend") == "local" and storage.get("persistent") is False:
        problems.append(
            "Uploads land on an ephemeral filesystem – they disappear on the next "
            "request or deploy. Set UPLOAD_STORAGE=s3 plus the S3_* variables."
        )

    if storage.get("backend") == "s3" and delivery == "bucket":
        hint = (
            "Listing photos link straight to the bucket; if they still do not render, "
            "the bucket is not public – set UPLOAD_URL_MODE=proxy (or clear "
            "S3_PUBLIC_BASE_URL) to serve them through /api/uploads/view instead."
        )
    elif storage.get("backend") == "s3":
        hint = (
            "Listing photos are served by this API through /api/uploads/view, which "
            "reads the bucket with the server's credentials and therefore works with a "
            "private bucket as well."
        )
    else:
        hint = (
            "Listing photos are read from UPLOAD_FOLDER and can also be served through "
            "/api/uploads/view. On serverless hosts this folder is temporary – use "
            "UPLOAD_STORAGE=s3 for persistent images."
        )
    return {
        "backend": storage.get("backend"),
        "delivery": delivery,
        "url_mode": storage.get("url_mode"),
        "public_base_url": storage.get("public_base_url"),
        "notice": storage.get("notice"),
        "problems": problems,
        "hint": hint,
    }


@misc_bp.get("/health")
def health():
    """Uptime probe – verifies the database and reports the upload backend."""
    try:
        db.session.execute(db.text("SELECT 1"))
        database = "connected"
    except Exception as exc:                        # pragma: no cover - infra issue
        database = f"error: {exc}"

    storage = get_storage(current_app).describe()

    warnings = []
    if not current_app.config.get("DEBUG"):
        # In production, missing secrets are a real problem worth surfacing.
        warnings.extend(secret_warnings())
    if storage.get("warning"):
        warnings.append(storage["warning"])
    if storage.get("error"):
        warnings.append(storage["error"])

    healthy = database == "connected" and storage.get("configured", True)
    payload = {
        "service": "Campus Marketplace API",
        "version": "1.0.0",
        "status": "ok" if healthy else "degraded",
        "database": database,
        "storage": storage,
        "images": _image_report(storage),
    }
    warnings.extend(payload["images"]["problems"])
    if warnings:
        payload["warnings"] = warnings
    return api_success(payload)


@misc_bp.get("/stats")
def marketplace_stats():
    """Live counters shown on the landing page hero."""
    return api_success(
        {
            "products": Product.query.filter_by(status="published").count(),
            "accommodation": Accommodation.query.filter_by(status="published").count(),
            "events": Event.query.filter_by(status="published").count(),
            "services": Service.query.filter_by(status="published").count(),
            "users": User.query.count(),
            "verified_users": User.query.filter_by(verified=True).count(),
            "campus": "Federal University of Lafia",
        }
    )


@misc_bp.get("/search")
def search_everything():
    """Search across every listing type at once (used by the navbar search)."""
    viewer = current_user(optional=True)
    term = (request.args.get("q") or "").strip()
    limit = parse_int(request.args.get("limit"), 5, minimum=1, maximum=20)
    if not term:
        return api_success(
            {"q": "", "products": [], "accommodation": [], "events": [], "services": [],
             "total": 0}
        )

    pattern = f"%{term}%"

    products = (
        Product.query.filter(
            Product.status == "published",
            or_(
                Product.title.ilike(pattern),
                Product.description.ilike(pattern),
                Product.category.ilike(pattern),
                Product.location.ilike(pattern),
            ),
        )
        .order_by(Product.created_at.desc())
        .limit(limit)
        .all()
    )
    rooms = (
        Accommodation.query.filter(
            Accommodation.status == "published",
            or_(
                Accommodation.title.ilike(pattern),
                Accommodation.location.ilike(pattern),
                Accommodation.description.ilike(pattern),
                Accommodation.room_type.ilike(pattern),
            ),
        )
        .order_by(Accommodation.created_at.desc())
        .limit(limit)
        .all()
    )
    events = (
        Event.query.filter(
            Event.status == "published",
            or_(
                Event.title.ilike(pattern),
                Event.description.ilike(pattern),
                Event.category.ilike(pattern),
                Event.location.ilike(pattern),
            ),
        )
        .order_by(Event.date.asc())
        .limit(limit)
        .all()
    )
    services = (
        Service.query.filter(
            Service.status == "published",
            or_(
                Service.title.ilike(pattern),
                Service.description.ilike(pattern),
                Service.category.ilike(pattern),
                Service.location.ilike(pattern),
            ),
        )
        .order_by(Service.created_at.desc())
        .limit(limit)
        .all()
    )

    results = {
        "q": term,
        "products": [row.to_dict(viewer=viewer) for row in products],
        "accommodation": [row.to_dict(viewer=viewer) for row in rooms],
        "events": [row.to_dict(viewer=viewer) for row in events],
        "services": [row.to_dict(viewer=viewer) for row in services],
    }
    results["total"] = sum(
        len(results[key]) for key in ("products", "accommodation", "events", "services")
    )
    return api_success(results)


@misc_bp.get("/meta")
def meta():
    """Everything the frontend needs to build filters and forms."""
    return api_success(
        {
            "product_categories": PRODUCT_CATEGORIES,
            "room_types": ROOM_TYPES,
            "event_categories": EVENT_CATEGORIES,
            "service_categories": SERVICE_CATEGORIES,
            "conditions": ["new", "used", "refurbished"],
            "genders": ["any", "male", "female"],
            "sort_options": [
                {"value": "-created_at", "label": "Newest first"},
                {"value": "created_at", "label": "Oldest first"},
                {"value": "price", "label": "Price: low to high"},
                {"value": "-price", "label": "Price: high to low"},
                {"value": "title", "label": "Title A–Z"},
            ],
            "user_types": ["student", "landlord", "service_provider"],
            "listing_types": ["product", "accommodation", "event", "service"],
        }
    )


@misc_bp.get("/popular")
def popular():
    """Popular categories and the most-viewed listings (trending strip)."""
    top_products = (
        Product.query.filter_by(status="published")
        .order_by(Product.views.desc(), Product.created_at.desc())
        .limit(6)
        .all()
    )
    top_rooms = (
        Accommodation.query.filter_by(status="published")
        .order_by(Accommodation.views.desc())
        .limit(4)
        .all()
    )
    category_rows = (
        db.session.query(Product.category, func.count(Product.id))
        .filter(Product.status == "published")
        .group_by(Product.category)
        .order_by(func.count(Product.id).desc())
        .limit(6)
        .all()
    )
    return api_success(
        {
            "categories": [{"name": row[0], "count": row[1]} for row in category_rows],
            "products": [row.to_dict() for row in top_products],
            "accommodation": [row.to_dict() for row in top_rooms],
        }
    )
