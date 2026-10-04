"""Campus event and notice endpoints."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required, verify_jwt_in_request
from sqlalchemy import or_

from ..extensions import db
from ..models import Event, Favorite, User
from .common import (
    api_error,
    clean_text,
    listing_response,
    pagination_args,
    payload_data,
    remove_uploaded_image,
    save_uploaded_image,
)

bp = Blueprint("events", __name__)


def _user():
    try:
        return db.session.get(User, int(get_jwt_identity()))
    except (TypeError, ValueError):
        return None


def _parse_datetime(value):
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise ValueError("Enter a valid event date and time.")
    if parsed.tzinfo is None:
        # datetime-local fields contain no offset; interpret them in campus time.
        parsed = parsed.replace(tzinfo=ZoneInfo("Africa/Lagos"))
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


@bp.get("")
def list_events():
    query = Event.query.filter_by(status="published")
    search = request.args.get("q", request.args.get("search", "")).strip()
    location = request.args.get("location", "").strip()
    category = request.args.get("category", "").strip()
    if search:
        term = f"%{search[:100]}%"
        query = query.filter(or_(Event.title.ilike(term), Event.description.ilike(term), Event.location.ilike(term)))
    if location:
        query = query.filter(Event.location.ilike(f"%{location[:160]}%"))
    if category:
        query = query.filter(Event.category.ilike(category[:60]))
    if request.args.get("from"):
        try:
            query = query.filter(Event.date >= _parse_datetime(request.args["from"]))
        except ValueError as exc:
            return api_error(str(exc), 400)
    if request.args.get("to"):
        try:
            query = query.filter(Event.date <= _parse_datetime(request.args["to"]))
        except ValueError as exc:
            return api_error(str(exc), 400)

    query = query.order_by(Event.date.asc(), Event.created_at.desc())
    page, per_page = pagination_args()
    result = query.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify(listing_response(result, lambda item: item.to_dict()))


@bp.post("")
@jwt_required()
def create_event():
    data = payload_data()
    try:
        title = clean_text(data.get("title"), "Title", maximum=140)
        description = clean_text(data.get("description"), "Description", maximum=5000, minimum=10)
        location = clean_text(data.get("location"), "Location", maximum=160)
        category = clean_text(data.get("category") or "Campus event", "Category", maximum=60)
        event_date = _parse_datetime(data.get("date"))
        image_url = save_uploaded_image(request.files.get("image")) if request.files.get("image") else ""
    except ValueError as exc:
        return api_error(str(exc), 400)
    creator = _user()
    if creator is None:
        return api_error("Account not found.", 401)
    event = Event(
        creator_id=creator.id,
        title=title,
        description=description,
        date=event_date,
        location=location,
        category=category,
        image_url=image_url,
        status="pending",
    )
    db.session.add(event)
    db.session.commit()
    return jsonify({"message": "Event submitted for review.", "event": event.to_dict()}), 201


@bp.get("/<int:event_id>")
def get_event(event_id):
    event = db.session.get(Event, event_id)
    if event is None:
        return api_error("Event not found.", 404)
    if event.status != "published":
        verify_jwt_in_request(optional=True)
        viewer = _user()
        if viewer is None or (viewer.id != event.creator_id and not viewer.is_admin):
            return api_error("Event not found.", 404)
    return jsonify({"event": event.to_dict()})


@bp.delete("/<int:event_id>")
@jwt_required()
def delete_event(event_id):
    event = db.session.get(Event, event_id)
    user = _user()
    if event is None:
        return api_error("Event not found.", 404)
    if user is None or (event.creator_id != user.id and not user.is_admin):
        return api_error("You can only delete your own event.", 403)
    remove_uploaded_image(event.image_url)
    Favorite.query.filter_by(listing_type="event", listing_id=event.id).delete(synchronize_session=False)
    db.session.delete(event)
    db.session.commit()
    return jsonify({"message": "Event deleted."})
