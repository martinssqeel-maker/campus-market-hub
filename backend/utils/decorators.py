"""
Route decorators & authenticated-user helpers.

``current_user()`` is cached per request so a single request never hits the
database more than once for the logged-in account.
"""

from functools import wraps

from flask import abort, g, has_request_context, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from extensions import db
from models import User

#: Key used to cache the authenticated user *per request*.
#: ``flask.g`` is app-context scoped – caching there leaks the previous user
#: when one app context spans several requests (tests, CLI, nested contexts),
#: which is a real security problem. ``request.environ`` is request scoped.
_USER_CACHE_KEY = "campus_market.current_user"


def load_user(user_id):
    """Fetch a user by id (int or string) or return ``None``."""
    try:
        return db.session.get(User, int(user_id))
    except (TypeError, ValueError):
        return None


def current_user(optional: bool = False):
    """
    Return the account behind the current JWT.

    ``optional=True`` is used by public endpoints that add extra fields
    (contact details, favourite flags) when a token happens to be present.
    """
    cache = request.environ if has_request_context() else None
    if cache is not None and _USER_CACHE_KEY in cache:
        return cache[_USER_CACHE_KEY]

    try:
        verify_jwt_in_request(optional=optional)
    except Exception:                      # missing / expired / malformed token
        if optional:
            return None
        raise

    identity = get_jwt_identity()
    user = load_user(identity) if identity else None
    if user is None:
        if optional:
            return None
        abort(401, description="Account no longer exists")

    # Only successful lookups are cached (a "no token" result stays uncached
    # so the same request can still authenticate later if it needs to).
    if cache is not None:
        cache[_USER_CACHE_KEY] = user
        g.current_user = user
    return user


def login_required(fn):
    """Require a valid access token + an active account."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user.is_active:
            return jsonify({"success": False, "message": "Your account has been suspended"
                            " – contact the administrator"}), 403
        g.current_user = user
        return fn(*args, **kwargs)

    return wrapper


def admin_required(fn):
    """Require a valid access token belonging to an administrator."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user.is_admin:
            return jsonify({"success": False, "message": "Administrator access required"}), 403
        g.current_user = user
        return fn(*args, **kwargs)

    return wrapper


def owner_or_admin_required(get_record):
    """
    Decorator factory guarding owner-only routes.

    ``get_record`` receives the route arguments and must return the record
    (or None for a 404).
    """

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = current_user()
            record = get_record(*args, **kwargs)
            if record is None:
                return jsonify({"success": False, "message": "Listing not found"}), 404
            if not user.is_admin and user.id not in {
                record.seller_id,
                getattr(record, "landlord_id", None),
                getattr(record, "provider_id", None),
                getattr(record, "creator_id", None),
            }:
                return jsonify(
                    {"success": False, "message": "You can only modify your own listing"}
                ), 403
            g.current_user = user
            return fn(*args, **kwargs)

        return wrapper

    return decorator


def get_or_404(model, record_id, name: str = "Resource"):
    """Fetch a row by primary key or abort with a clean 404 JSON payload."""
    record = db.session.get(model, record_id)
    if record is None:
        abort(404, description=f"{name} not found")
    return record
