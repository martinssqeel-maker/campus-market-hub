"""
Public utility routes.

GET /api/health          liveness probe / smoke-test
GET /api/stats           marketplace counters for the home page
GET /api/search          cross-type search (products, rooms, events, services)
GET /api/meta            categories, room types and sort options for the UI
GET /api/popular         trending searches / popular categories
"""

from flask import Blueprint, request
from sqlalchemy import func, or_

from extensions import db
from models import Accommodation, Event, Product, Service, User
from utils.decorators import current_user
from utils.helpers import api_success, parse_int
from routes.accommodation import ROOM_TYPES
from routes.events import EVENT_CATEGORIES
from routes.products import PRODUCT_CATEGORIES
from routes.services import SERVICE_CATEGORIES

misc_bp = Blueprint("misc", __name__)


@misc_bp.get("/health")
def health():
    """Uptime probe – also verifies the database connection works."""
    try:
        db.session.execute(db.text("SELECT 1"))
        database = "connected"
    except Exception as exc:                        # pragma: no cover - infra issue
        database = f"error: {exc}"

    return api_success(
        {
            "service": "Campus Marketplace API",
            "version": "1.0.0",
            "status": "ok" if database == "connected" else "degraded",
            "database": database,
        }
    )


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
