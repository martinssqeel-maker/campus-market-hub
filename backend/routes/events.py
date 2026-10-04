"""
Campus events & adverts – ``/api/events``

GET    /api/events             list with date / category / location filters
GET    /api/events/upcoming    next N upcoming events (home page widget)
GET    /api/events/<id>        single event
POST   /api/events             create (auth, moderation applies)
PUT    /api/events/<id>        edit (owner or admin)
DELETE /api/events/<id>        delete (owner or admin)
"""

from datetime import datetime, timezone

from flask import Blueprint, request
from sqlalchemy import func, or_

from config import Config
from extensions import db
from models import Event
from utils.decorators import current_user, login_required
from utils.helpers import (
    api_error,
    api_success,
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

events_bp = Blueprint("events", __name__)

EVENT_CATEGORIES = [
    "academic",
    "social",
    "sports",
    "religious",
    "career",
    "entertainment",
    "advert",
    "others",
]


def _parse_datetime(value):
    """Accept ISO strings (``2026-03-14``, ``2026-03-14T10:00``) or datetimes."""
    if isinstance(value, datetime):
        return value
    if not value:
        raise ValidationError("Event date is required", {"date": "Required"})
    raw = str(value).strip().replace("Z", "+00:00")
    for fmt in (None, "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            parsed = datetime.fromisoformat(raw) if fmt is None else datetime.strptime(raw, fmt)
            return parsed.replace(tzinfo=None)
        except ValueError:
            continue
    raise ValidationError(
        "Use a valid date, e.g. 2026-03-14 or 2026-03-14T10:00", {"date": "Invalid date"}
    )


@events_bp.get("/events")
def list_events():
    """Public event feed with date range, category and location filters."""
    viewer = current_user(optional=True)
    query = Event.query

    status = (request.args.get("status") or "").strip().lower()
    if viewer and viewer.is_admin:
        query = query.filter(Event.status == status) if status else query
    elif status and status != "published" and viewer:
        query = query.filter(Event.creator_id == viewer.id, Event.status == status)
    else:
        conditions = [Event.status == "published"]
        if viewer:
            conditions.append(Event.creator_id == viewer.id)
        query = query.filter(or_(*conditions))

    category = (request.args.get("category") or "").strip().lower()
    if category in {"all", ""}:
        category = None
    if category and category in EVENT_CATEGORIES:
        query = query.filter(Event.category == category)

    location = (request.args.get("location") or "").strip()
    if location:
        query = query.filter(Event.location.ilike(f"%{location}%"))

    if parse_bool(request.args.get("upcoming"), default=False):
        query = query.filter(Event.date >= datetime.now(timezone.utc).replace(tzinfo=None))

    if request.args.get("date") or request.args.get("date_from"):
        query = query.filter(Event.date >= _parse_datetime(request.args.get("date")
                                                          or request.args.get("date_from")))
    if request.args.get("date_to"):
        query = query.filter(Event.date <= _parse_datetime(request.args["date_to"]))

    max_price = parse_float(request.args.get("max_price"))
    if max_price is not None:
        query = query.filter(Event.ticket_price <= max_price)
    if parse_bool(request.args.get("free")):
        query = query.filter(Event.ticket_price == 0)

    creator_id = parse_int(request.args.get("creator_id"))
    if creator_id:
        query = query.filter(Event.creator_id == creator_id)

    query = apply_search(
        query, Event, request.args.get("q"), ("title", "description", "category", "location")
    )
    # Default ordering for events is chronological (soonest first).
    query = apply_sort(query, Event, request.args.get("sort"), default="date")

    result = paginate(query, lambda row: row.to_dict(viewer=viewer))
    result["categories"] = EVENT_CATEGORIES
    result["filters"] = {
        "q": request.args.get("q") or "",
        "category": category or "all",
        "location": location,
        "date_from": request.args.get("date_from") or "",
        "date_to": request.args.get("date_to") or "",
        "upcoming": parse_bool(request.args.get("upcoming")),
    }
    return api_success(result)


@events_bp.get("/events/upcoming")
def upcoming_events():
    """The next few events – powers the home-page "What's happening" strip."""
    limit = parse_int(request.args.get("limit"), 4, minimum=1, maximum=20)
    rows = (
        Event.query.filter(
            Event.status == "published",
            Event.date >= datetime.now(timezone.utc).replace(tzinfo=None),
        )
        .order_by(Event.date.asc())
        .limit(limit)
        .all()
    )
    return api_success([row.to_dict() for row in rows])


@events_bp.get("/events/stats")
def event_stats():
    """Counts by category for the events page summary cards."""
    rows = (
        db.session.query(Event.category, func.count(Event.id))
        .filter(Event.status == "published")
        .group_by(Event.category)
        .all()
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return api_success(
        {
            "by_category": [{"category": row[0], "count": row[1]} for row in rows],
            "upcoming": Event.query.filter(Event.status == "published", Event.date >= now).count(),
            "total": Event.query.filter(Event.status == "published").count(),
        }
    )


@events_bp.get("/events/<int:event_id>")
def get_event(event_id: int):
    """Single event details."""
    viewer = current_user(optional=True)
    event = db.session.get(Event, event_id)
    if event is None:
        return api_error("Event not found", 404)
    if event.status != "published" and not owner_or_admin(viewer, event):
        return api_error("This event is not available", 403)
    if not owner_or_admin(viewer, event):
        event.views = (event.views or 0) + 1
        db.session.commit()
    return api_success(event.to_dict(viewer=viewer))


@events_bp.post("/events")
@login_required
def create_event():
    """Create an event / campus advert."""
    user = current_user()
    payload = request_data()
    try:
        title = clean_text(payload.get("title"), 160)
        if len(title) < 3:
            raise ValidationError("Title is too short", {"title": "At least 3 characters"})
        description = clean_text(payload.get("description"), 4000)
        if len(description) < 10:
            raise ValidationError(
                "Please describe the event (at least 10 characters)",
                {"description": "Too short"},
            )
        category = clean_text(payload.get("category"), 60).lower() or "social"
        if category not in EVENT_CATEGORIES:
            category = "others"

        event = Event(
            creator_id=user.id,
            title=title,
            description=description,
            date=_parse_datetime(payload.get("date")),
            location=clean_text(payload.get("location"), 160) or "UNILAFIA Campus",
            category=category,
            ticket_price=parse_float(payload.get("ticket_price"), 0.0, minimum=0.0) or 0.0,
            image_url=clean_text(payload.get("image_url"), 300) or None,
            status="published" if (Config.AUTO_PUBLISH or user.is_admin) else "pending",
        )
        db.session.add(event)
        db.session.commit()
        return api_success(
            event.to_dict(viewer=user),
            message="Event submitted for review."
            if event.status == "pending"
            else "Event published!",
            status=201,
        )
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@events_bp.put("/events/<int:event_id>")
@login_required
def update_event(event_id: int):
    """Edit an event (owner or admin)."""
    viewer = current_user()
    event = db.session.get(Event, event_id)
    if event is None:
        return api_error("Event not found", 404)
    if not owner_or_admin(viewer, event):
        return api_error("You can only edit your own events", 403)

    payload = request_data()
    try:
        if payload.get("title"):
            event.title = clean_text(payload["title"], 160)
        if payload.get("description"):
            event.description = clean_text(payload["description"], 4000)
        if payload.get("date"):
            event.date = _parse_datetime(payload["date"])
        if payload.get("location"):
            event.location = clean_text(payload["location"], 160)
        if payload.get("category"):
            category = clean_text(payload["category"], 60).lower()
            event.category = category if category in EVENT_CATEGORIES else event.category
        if payload.get("ticket_price") is not None:
            event.ticket_price = parse_float(payload["ticket_price"], 0.0, minimum=0.0) or 0.0
        if "image_url" in payload:
            event.image_url = clean_text(payload["image_url"], 300) or None

        new_status = (payload.get("status") or "").lower()
        if viewer.is_admin and new_status in {"published", "archived"}:
            event.status = new_status
        elif not viewer.is_admin and event.status == "published":
            event.status = "pending"

        db.session.commit()
        return api_success(event.to_dict(viewer=viewer), message="Event updated")
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@events_bp.delete("/events/<int:event_id>")
@login_required
def delete_event(event_id: int):
    """Delete an event (owner or admin)."""
    viewer = current_user()
    event = db.session.get(Event, event_id)
    if event is None:
        return api_error("Event not found", 404)
    if not owner_or_admin(viewer, event):
        return api_error("You can only delete your own events", 403)
    db.session.delete(event)
    db.session.commit()
    return api_success(message="Event deleted")
