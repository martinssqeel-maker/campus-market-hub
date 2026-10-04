"""
Admin moderation – ``/api/admin/*``

Listing moderation (approve / reject / feature / delete)
    GET    /api/admin/pending                everything awaiting review
    GET    /api/admin/pending-listings       alias kept for the project spec
    GET    /api/admin/all-listings           every listing, filterable by status
    POST   /api/admin/approve/<id>           publish a listing
    POST   /api/admin/reject/<id>            reject a listing (reason optional)
    POST   /api/admin/flag/<type>/<id>       flag/remove inappropriate content
    POST   /api/admin/feature/<type>/<id>    toggle the "featured" badge
    DELETE /api/admin/listing/<type>/<id>    hard delete a listing

User management
    GET    /api/admin/users                  all users (+ search/filter)
    POST   /api/admin/verify/<id>            toggle the "verified student" badge
    POST   /api/admin/suspend/<id>           activate / suspend an account
    POST   /api/admin/make-admin/<id>        promote / demote an admin

Dashboard
    GET    /api/admin/stats                  platform overview
    GET    /api/admin/activity               latest audit-style activity feed
"""

from datetime import datetime, timedelta, timezone

from flask import Blueprint, request
from sqlalchemy import func

from config import Config
from extensions import db
from models import (
    Accommodation,
    Event,
    Favorite,
    Product,
    Review,
    Service,
    User,
    model_for_type,
)
from utils.decorators import admin_required, current_user
from utils.helpers import (
    api_error,
    api_success,
    apply_search,
    apply_sort,
    paginate,
    parse_bool,
    parse_int,
    request_data,
)
from utils.validators import clean_text

admin_bp = Blueprint("admin", __name__)

#: Listing types that participate in the moderation workflow.
MODERATED_TYPES = ("product", "accommodation", "event", "service")
TYPE_LABELS = {
    "product": "Product",
    "accommodation": "Accommodation",
    "event": "Event",
    "service": "Service",
}


def _resolve_type(item_type=None, item_id=None):
    """
    Work out which table a moderation request refers to.

    ``item_type`` may be supplied explicitly (preferred). When it is missing we
    look the id up across every moderated table – if it matches exactly one
    row we use it, otherwise we report the ambiguity instead of guessing.
    """
    item_type = (item_type or "").strip().lower()
    if item_type in MODERATED_TYPES:
        return item_type, None
    if not item_id:
        return None, "item_type is required (product, accommodation, event or service)"

    matches = [
        kind for kind in MODERATED_TYPES
        if db.session.get(model_for_type(kind), item_id) is not None
    ]
    if len(matches) == 1:
        return matches[0], None
    if not matches:
        return None, "Listing not found"
    return None, f"Ambiguous id – specify item_type (matches: {', '.join(matches)})"


def _pending_rows(limit: int = 100) -> list[dict]:
    """Collect pending listings of every type into one review queue."""
    rows: list[dict] = []
    for kind in MODERATED_TYPES:
        model = model_for_type(kind)
        items = (
            model.query.filter_by(status="pending")
            .order_by(model.created_at.asc())
            .limit(limit)
            .all()
        )
        for item in items:
            payload = item.to_dict(viewer=None)
            payload["item_type"] = kind
            payload["type_label"] = TYPE_LABELS[kind]
            rows.append(payload)
    rows.sort(key=lambda row: row.get("created_at") or "")
    return rows


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@admin_bp.get("/admin/stats")
@admin_required
def admin_stats():
    """Headline numbers for the admin dashboard cards."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    week_ago = now - timedelta(days=7)

    def status_counts(model):
        rows = (
            db.session.query(model.status, func.count(model.id)).group_by(model.status).all()
        )
        return {status: count for status, count in rows}

    product_counts = status_counts(Product)
    room_counts = status_counts(Accommodation)
    event_counts = status_counts(Event)
    service_counts = status_counts(Service)

    pending_total = sum(
        counts.get("pending", 0)
        for counts in (product_counts, room_counts, event_counts, service_counts)
    )

    return api_success(
        {
            "users": {
                "total": User.query.count(),
                "students": User.query.filter_by(user_type="student").count(),
                "landlords": User.query.filter_by(user_type="landlord").count(),
                "service_providers": User.query.filter_by(user_type="service_provider").count(),
                "admins": User.query.filter_by(user_type="admin").count(),
                "verified": User.query.filter_by(verified=True).count(),
                "suspended": User.query.filter_by(is_active=False).count(),
                "new_this_week": User.query.filter(User.created_at >= week_ago).count(),
            },
            "listings": {
                "products": {
                    "total": Product.query.count(),
                    "published": product_counts.get("published", 0),
                    "pending": product_counts.get("pending", 0),
                },
                "accommodation": {
                    "total": Accommodation.query.count(),
                    "published": room_counts.get("published", 0),
                    "pending": room_counts.get("pending", 0),
                },
                "events": {
                    "total": Event.query.count(),
                    "published": event_counts.get("published", 0),
                    "pending": event_counts.get("pending", 0),
                },
                "services": {
                    "total": Service.query.count(),
                    "published": service_counts.get("published", 0),
                    "pending": service_counts.get("pending", 0),
                },
                "pending_total": pending_total,
                "published_total": sum(
                    counts.get("published", 0)
                    for counts in (product_counts, room_counts, event_counts, service_counts)
                ),
                "total": (
                    Product.query.count()
                    + Accommodation.query.count()
                    + Event.query.count()
                    + Service.query.count()
                ),
            },
            "engagement": {
                "reviews": Review.query.count(),
                "favorites": Favorite.query.count(),
                "views": (db.session.query(func.coalesce(func.sum(Product.views), 0)).scalar() or 0)
                + (db.session.query(func.coalesce(func.sum(Accommodation.views), 0)).scalar() or 0)
                + (db.session.query(func.coalesce(func.sum(Event.views), 0)).scalar() or 0)
                + (db.session.query(func.coalesce(func.sum(Service.views), 0)).scalar() or 0),
            },
            "generated_at": now.isoformat(),
        }
    )


@admin_bp.get("/admin/activity")
@admin_required
def admin_activity():
    """Recent registrations and listings – the dashboard's activity feed."""
    limit = parse_int(request.args.get("limit"), 10, minimum=1, maximum=50)
    feed: list[dict] = []

    for user in User.query.order_by(User.created_at.desc()).limit(limit).all():
        feed.append(
            {
                "kind": "user",
                "label": f"{user.name} joined as {user.user_type.replace('_', ' ')}",
                "status": "verified" if user.verified else None,
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "id": user.id,
            }
        )

    for kind in MODERATED_TYPES:
        model = model_for_type(kind)
        for item in model.query.order_by(model.created_at.desc()).limit(limit).all():
            feed.append(
                {
                    "kind": kind,
                    "label": f"New {TYPE_LABELS[kind].lower()}: {item.title}",
                    "status": item.status,
                    "created_at": item.created_at.isoformat() if item.created_at else None,
                    "id": item.id,
                }
            )

    feed.sort(key=lambda row: row.get("created_at") or "", reverse=True)
    return api_success({"items": feed[: limit * 2], "total": len(feed)})


# ---------------------------------------------------------------------------
# Moderation queue
# ---------------------------------------------------------------------------
@admin_bp.get("/admin/pending")
@admin_required
def pending_listings():
    """Everything currently waiting for approval (all listing types)."""
    rows = _pending_rows(limit=parse_int(request.args.get("limit"), 200, minimum=1, maximum=500))
    item_type = (request.args.get("type") or request.args.get("item_type") or "").lower()
    if item_type in MODERATED_TYPES:
        rows = [row for row in rows if row["item_type"] == item_type]
    return api_success({"items": rows, "total": len(rows)})


@admin_bp.get("/admin/pending-listings")
@admin_required
def pending_listings_alias():
    """Alias for ``/api/admin/pending`` (name used in the project spec)."""
    return pending_listings()


@admin_bp.get("/admin/all-listings")
@admin_required
def all_listings():
    """Every listing (any status) – used by the moderation table."""
    status = (request.args.get("status") or "").strip().lower()
    item_type = (request.args.get("type") or "").strip().lower()
    search = request.args.get("q")
    page = parse_int(request.args.get("page"), 1, minimum=1)
    per_page = parse_int(request.args.get("per_page"), 20, minimum=1, maximum=100)
    sort = request.args.get("sort") or "-created_at"

    rows: list[dict] = []
    for kind in MODERATED_TYPES:
        if item_type in MODERATED_TYPES and item_type != kind:
            continue
        model = model_for_type(kind)
        query = model.query
        if status:
            query = query.filter(model.status == status)
        query = apply_search(query, model, search, ("title", "description"))
        for item in query.order_by(model.created_at.desc()).limit(200).all():
            payload = item.to_dict(viewer=None)
            payload["item_type"] = kind
            payload["type_label"] = TYPE_LABELS[kind]
            rows.append(payload)

    reverse = sort.startswith("-")
    rows.sort(key=lambda row: row.get(sort.lstrip("-+")) or "", reverse=reverse)
    total = len(rows)
    start = (page - 1) * per_page
    return api_success(
        {
            "items": rows[start: start + per_page],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "pages": max(1, -(-total // per_page)),
                "has_next": start + per_page < total,
                "has_prev": page > 1,
            },
        }
    )


def _set_status(item_id: int, status: str, reason: str | None = None):
    """Shared approve/reject implementation (DRY)."""
    payload = request_data()
    item_type = payload.get("item_type") or request.args.get("type") or request.args.get("item_type")
    kind, error = _resolve_type(item_type, item_id)
    if error:
        return api_error(error, 404 if "not found" in error.lower() else 422)

    listing = db.session.get(model_for_type(kind), item_id)
    listing.status = status
    if hasattr(listing, "rejection_reason"):
        listing.rejection_reason = clean_text(reason, 255) or None
    db.session.commit()

    data = listing.to_dict(viewer=None)
    data["item_type"] = kind
    messages = {
        "published": f"{TYPE_LABELS[kind]} approved and published",
        "rejected": f"{TYPE_LABELS[kind]} rejected",
        "archived": f"{TYPE_LABELS[kind]} archived",
        "pending": f"{TYPE_LABELS[kind]} moved back to pending review",
    }
    return api_success(data, message=messages.get(status, "Listing updated"))


@admin_bp.post("/admin/approve/<int:item_id>")
@admin_required
def approve_listing(item_id: int):
    """Publish a pending listing (body/query may include ``item_type``)."""
    return _set_status(item_id, "published")


@admin_bp.post("/admin/reject/<int:item_id>")
@admin_required
def reject_listing(item_id: int):
    """Reject a listing, optionally with a reason shown to the seller."""
    payload = request_data()
    return _set_status(item_id, "rejected", payload.get("reason") or request.args.get("reason"))


@admin_bp.post("/admin/<item_type>/<int:item_id>/approve")
@admin_required
def approve_typed(item_type: str, item_id: int):
    """Type-safe approve: ``POST /api/admin/product/12/approve``."""
    return _set_status(item_id, "published") if item_type in MODERATED_TYPES else api_error(
        "Unsupported listing type", 422
    )


@admin_bp.post("/admin/<item_type>/<int:item_id>/reject")
@admin_required
def reject_typed(item_type: str, item_id: int):
    """Type-safe reject: ``POST /api/admin/product/12/reject``."""
    if item_type not in MODERATED_TYPES:
        return api_error("Unsupported listing type", 422)
    payload = request_data()
    return _set_status(item_id, "rejected", payload.get("reason"))


@admin_bp.post("/admin/flag/<item_type>/<int:item_id>")
@admin_required
def flag_listing(item_type: str, item_id: int):
    """Flag inappropriate content – removes it from the public site."""
    if item_type not in MODERATED_TYPES:
        return api_error("Unsupported listing type", 422)
    listing = db.session.get(model_for_type(item_type), item_id)
    if listing is None:
        return api_error("Listing not found", 404)
    listing.status = "rejected"
    if hasattr(listing, "rejection_reason"):
        listing.rejection_reason = clean_text(
            request_data().get("reason") or "Flagged by an administrator", 255
        )
    db.session.commit()
    return api_success(listing.to_dict(viewer=None), message="Listing flagged and hidden")


@admin_bp.post("/admin/feature/<item_type>/<int:item_id>")
@admin_required
def toggle_feature(item_type: str, item_id: int):
    """Toggle the ``featured`` badge (shown first on the home page)."""
    if item_type not in MODERATED_TYPES:
        return api_error("Unsupported listing type", 422)
    listing = db.session.get(model_for_type(item_type), item_id)
    if listing is None:
        return api_error("Listing not found", 404)
    if not hasattr(listing, "featured"):
        return api_error("This listing type cannot be featured", 422)
    listing.featured = not listing.featured
    db.session.commit()
    return api_success(
        listing.to_dict(viewer=None),
        message="Listing featured" if listing.featured else "Listing unfeatured",
    )


@admin_bp.delete("/admin/listing/<item_type>/<int:item_id>")
@admin_required
def delete_listing(item_type: str, item_id: int):
    """Permanently delete a listing."""
    if item_type not in MODERATED_TYPES:
        return api_error("Unsupported listing type", 422)
    listing = db.session.get(model_for_type(item_type), item_id)
    if listing is None:
        return api_error("Listing not found", 404)
    db.session.delete(listing)
    db.session.commit()
    return api_success(message="Listing deleted")


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------
@admin_bp.get("/admin/users")
@admin_required
def admin_users():
    """List all accounts with search / role / status filters and pagination."""
    query = User.query
    search = request.args.get("q")
    if search:
        query = apply_search(query, User, search, ("name", "email", "phone"))

    user_type = (request.args.get("user_type") or "").strip().lower()
    if user_type in {"student", "landlord", "service_provider", "admin"}:
        query = query.filter(User.user_type == user_type)

    if request.args.get("verified") is not None and request.args.get("verified") != "":
        query = query.filter(User.verified.is_(parse_bool(request.args.get("verified"))))
    if request.args.get("active") is not None and request.args.get("active") != "":
        query = query.filter(User.is_active.is_(parse_bool(request.args.get("active"), True)))

    query = apply_sort(query, User, request.args.get("sort"), default="-created_at")
    result = paginate(query, lambda user: user.to_dict(include_private=True))
    result["filters"] = {"q": search or "", "user_type": user_type or "all"}
    return api_success(result)


@admin_bp.get("/admin/users/<int:user_id>")
@admin_required
def admin_user_detail(user_id: int):
    """Full details for one account (used by the user drawer)."""
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found", 404)
    data = user.to_dict(include_private=True)
    data["listings"] = {
        "products": user.products.count(),
        "accommodation": user.accommodations.count(),
        "events": user.events.count(),
        "services": user.services.count(),
        "pending": user.products.filter_by(status="pending").count()
        + user.accommodations.filter_by(status="pending").count()
        + user.events.filter_by(status="pending").count()
        + user.services.filter_by(status="pending").count(),
    }
    data["reviews"] = [review.to_dict() for review in user.reviews_received.limit(20)]
    return api_success(data)


@admin_bp.post("/admin/verify/<int:user_id>")
@admin_required
def verify_user(user_id: int):
    """Toggle the 'verified student' badge on an account."""
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found", 404)
    payload = request_data()
    user.verified = (
        parse_bool(payload.get("verified"), not user.verified)
        if "verified" in payload
        else not user.verified
    )
    db.session.commit()
    return api_success(
        user.to_dict(include_private=True),
        message=f"{user.name} is now {'verified' if user.verified else 'unverified'}",
    )


@admin_bp.post("/admin/suspend/<int:user_id>")
@admin_required
def suspend_user(user_id: int):
    """Suspend (or reactivate) an account."""
    viewer = current_user()
    if viewer.id == user_id:
        return api_error("You cannot suspend your own admin account", 400)
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found", 404)

    payload = request_data()
    # ``{"active": true}`` sets the state explicitly; no body toggles it.
    if "active" in payload:
        user.is_active = parse_bool(payload.get("active"), True)
    else:
        user.is_active = not user.is_active
    db.session.commit()
    return api_success(
        user.to_dict(include_private=True),
        message=f"{user.name} has been {'reactivated' if user.is_active else 'suspended'}",
    )


@admin_bp.post("/admin/make-admin/<int:user_id>")
@admin_required
def make_admin(user_id: int):
    """Promote a user to admin, or demote an existing admin."""
    viewer = current_user()
    if viewer.id == user_id:
        return api_error("You cannot change your own role", 400)
    user = db.session.get(User, user_id)
    if user is None:
        return api_error("User not found", 404)

    payload = request_data()
    promote = parse_bool(payload.get("admin"), user.user_type != "admin")
    user.user_type = "admin" if promote else (clean_text(payload.get("user_type"), 30) or "student")
    if promote:
        user.verified = True
    db.session.commit()
    return api_success(
        user.to_dict(include_private=True),
        message=f"{user.name} is now an {user.user_type.replace('_', ' ')}",
    )


# ---------------------------------------------------------------------------
# Seeding helpers (development convenience – short-circuited by the env flag)
# ---------------------------------------------------------------------------
@admin_bp.get("/admin/health")
def admin_health():
    """Tiny uptime check used by the deployment smoke-test."""
    return api_success(
        {
            "status": "ok",
            "auto_publish": Config.AUTO_PUBLISH,
            "time": datetime.now(timezone.utc).isoformat(),
        }
    )
