"""
Wishlist / favourites – ``/api/favorites``

POST   /api/favorites              toggle a listing in the wishlist
GET    /api/favorites              the signed-in user's saved listings
DELETE /api/favorites/<item>/<id>  remove explicitly
GET    /api/favorites/ids          lightweight id list for heart states
"""

from flask import Blueprint, request

from extensions import db
from models import Favorite, model_for_type
from utils.decorators import current_user, login_required
from utils.helpers import api_error, api_success, request_data
from utils.validators import ValidationError, clean_text

favorites_bp = Blueprint("favorites", __name__)

SUPPORTED_TYPES = {"product", "accommodation", "event", "service"}


def _normalise_type(item_type: str) -> str:
    """Map friendly aliases (``products``, ``room``) onto canonical names."""
    value = (item_type or "").strip().lower()
    aliases = {
        "products": "product",
        "rooms": "accommodation",
        "room": "accommodation",
        "events": "event",
        "services": "service",
    }
    return aliases.get(value, value)


@favorites_bp.post("/favorites")
@login_required
def toggle_favorite():
    """Add a listing to the wishlist, or remove it if already saved."""
    user = current_user()
    payload = request_data()
    try:
        item_type = _normalise_type(clean_text(payload.get("item_type"), 30))
        if item_type not in SUPPORTED_TYPES:
            raise ValidationError("Unsupported item type", {"item_type": "Invalid"})
        try:
            item_id = int(payload.get("item_id"))
        except (TypeError, ValueError):
            raise ValidationError("item_id must be a number", {"item_id": "Invalid"})

        model = model_for_type(item_type)
        if db.session.get(model, item_id) is None:
            return api_error("Listing not found", 404)

        favorite = Favorite.query.filter_by(
            user_id=user.id, item_type=item_type, item_id=item_id
        ).first()

        if favorite:
            db.session.delete(favorite)
            db.session.commit()
            return api_success(
                {"item_type": item_type, "item_id": item_id, "saved": False},
                message="Removed from your wishlist",
            )

        favorite = Favorite(user_id=user.id, item_type=item_type, item_id=item_id)
        db.session.add(favorite)
        db.session.commit()
        return api_success(
            {"item_type": item_type, "item_id": item_id, "saved": True},
            message="Saved to your wishlist",
            status=201,
        )
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@favorites_bp.get("/favorites")
@login_required
def list_favorites():
    """Return the signed-in user's wishlist with full listing details."""
    user = current_user()
    item_type = _normalise_type(request.args.get("item_type"))
    query = Favorite.query.filter_by(user_id=user.id)
    if item_type in SUPPORTED_TYPES:
        query = query.filter_by(item_type=item_type)

    rows = query.order_by(Favorite.created_at.desc()).all()
    items = []
    for row in rows:
        model = model_for_type(row.item_type)
        listing = db.session.get(model, row.item_id) if model else None
        if listing is None:
            continue                        # listing was deleted – skip silently
        items.append(
            {
                "favorite_id": row.id,
                "saved_at": row.created_at.isoformat(),
                "item_type": row.item_type,
                "listing": listing.to_dict(viewer=user),
            }
        )
    return api_success({"items": items, "total": len(items)})


@favorites_bp.get("/favorites/ids")
@login_required
def favorite_ids():
    """Compact list of saved ids so the UI can render filled hearts."""
    user = current_user()
    rows = Favorite.query.filter_by(user_id=user.id).all()
    grouped: dict[str, list[int]] = {}
    for row in rows:
        grouped.setdefault(row.item_type, []).append(row.item_id)
    return api_success({"ids": grouped, "total": len(rows)})


@favorites_bp.delete("/favorites/<item_type>/<int:item_id>")
@login_required
def remove_favorite(item_type: str, item_id: int):
    """Explicitly remove a saved listing."""
    user = current_user()
    favorite = Favorite.query.filter_by(
        user_id=user.id, item_type=_normalise_type(item_type), item_id=item_id
    ).first()
    if favorite is None:
        return api_error("That item is not in your wishlist", 404)
    db.session.delete(favorite)
    db.session.commit()
    return api_success(message="Removed from your wishlist")
