"""
Small, reusable helpers shared by every blueprint.

Keeping pagination, filtering and JSON envelopes here means routes stay short
and behave identically (DRY).
"""

from typing import Any

from flask import jsonify, request
from sqlalchemy import or_

from config import Config


# ---------------------------------------------------------------------------
# JSON responses
# ---------------------------------------------------------------------------
def api_success(data: Any = None, message: str | None = None, status: int = 200, **extra):
    """Standard success envelope: ``{"success": true, ...}``."""
    payload = {"success": True}
    if message:
        payload["message"] = message
    if data is not None:
        payload["data"] = data
    payload.update(extra)
    return jsonify(payload), status


def api_error(message: str, status: int = 400, errors: dict | list | None = None):
    """Standard error envelope: ``{"success": false, "message": ...}``."""
    payload = {"success": False, "message": message}
    if errors:
        payload["errors"] = errors
    return jsonify(payload), status


# ---------------------------------------------------------------------------
# Request parsing
# ---------------------------------------------------------------------------
def parse_int(value, default=None, minimum=None, maximum=None):
    """Safely coerce ``value`` to int, clamping to [minimum, maximum]."""
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    if minimum is not None:
        number = max(minimum, number)
    if maximum is not None:
        number = min(maximum, number)
    return number


def parse_float(value, default=None, minimum=None):
    """Safely coerce ``value`` to float; returns ``default`` on failure."""
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return default
    if minimum is not None and number < minimum:
        return default
    return number


def parse_bool(value, default=False) -> bool:
    """Interpret common truthy strings/form values."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on", "y"}


def request_data() -> dict:
    """Return the JSON body, form data or query args – whichever exists."""
    if request.is_json:
        return request.get_json(silent=True) or {}
    if request.form:
        return request.form.to_dict()
    return request.args.to_dict()


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------
def apply_search(query, model, term: str, fields=("title", "description")):
    """Case-insensitive LIKE search across ``fields`` (SQL-injection safe)."""
    if not term:
        return query
    pattern = f"%{term.strip()}%"
    columns = [getattr(model, field) for field in fields if hasattr(model, field)]
    if not columns:
        return query
    return query.filter(or_(*[column.ilike(pattern) for column in columns]))


def apply_price_range(query, model, min_price=None, max_price=None):
    """Filter by ``price`` using inclusive bounds."""
    if min_price is not None:
        query = query.filter(model.price >= min_price)
    if max_price is not None:
        query = query.filter(model.price <= max_price)
    return query


def apply_sort(query, model, sort: str | None, default="-created_at"):
    """Whitelist-based sorting – protects against arbitrary SQL ordering."""
    sort = (sort or default).strip()
    descending = sort.startswith("-")
    field_name = sort.lstrip("-+")
    column = getattr(model, field_name, None)
    if column is None:
        column = getattr(model, "created_at")
        descending = True
    return query.order_by(column.desc() if descending else column.asc())


def paginate(query, serializer=None, page=None, per_page=None) -> dict:
    """
    Paginate a SQLAlchemy query and return a JSON-friendly envelope.

    ``serializer`` is a callable receiving each row; by default ``to_dict()``
    is used when available.
    """
    page = parse_int(page if page is not None else request.args.get("page"), 1, minimum=1)
    per_page = parse_int(
        per_page if per_page is not None else request.args.get("per_page"),
        Config.DEFAULT_PAGE_SIZE,
        minimum=1,
        maximum=Config.MAX_PAGE_SIZE,
    )

    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    if serializer is None:
        items = [row.to_dict() if hasattr(row, "to_dict") else row for row in pagination.items]
    else:
        items = [serializer(row) for row in pagination.items]

    return {
        "items": items,
        "pagination": {
            "page": pagination.page,
            "per_page": pagination.per_page,
            "total": pagination.total,
            "pages": pagination.pages,
            "has_next": pagination.has_next,
            "has_prev": pagination.has_prev,
        },
    }


def owner_or_admin(user, record) -> bool:
    """True when ``user`` owns ``record`` or is an administrator."""
    if user is None or record is None:
        return False
    if user.is_admin:
        return True
    owner_field = getattr(record, "seller_id", None)
    if owner_field is None:
        owner_field = getattr(record, "landlord_id", None)
    if owner_field is None:
        owner_field = getattr(record, "provider_id", None)
    if owner_field is None:
        owner_field = getattr(record, "creator_id", None)
    return owner_field == user.id
