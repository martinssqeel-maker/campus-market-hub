"""Shared API helpers for validation, authentication and image uploads."""
from functools import wraps
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from flask import current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import User


def api_error(message, status=400, **details):
    payload = {"error": message}
    if details:
        payload.update(details)
    return jsonify(payload), status


def payload_data():
    """Return JSON or multipart form fields without assuming either content type."""
    if request.is_json:
        value = request.get_json(silent=True)
        return value if isinstance(value, dict) else {}
    return request.form.to_dict()


def current_user():
    identity = get_jwt_identity()
    try:
        return db.session.get(User, int(identity))
    except (TypeError, ValueError):
        return None


def admin_required(view):
    """Require a valid JWT belonging to an administrator."""
    @wraps(view)
    @jwt_required()
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None or not user.is_admin:
            return api_error("Administrator access required.", 403)
        return view(*args, **kwargs)
    return wrapped


def owner_or_admin(user_id):
    user = current_user()
    return user is not None and (user.id == user_id or user.is_admin)


def clean_text(value, label, *, required=True, maximum=500, minimum=1):
    if value is None:
        value = ""
    text = str(value).strip()
    if required and len(text) < minimum:
        raise ValueError(f"{label} is required.")
    if len(text) > maximum:
        raise ValueError(f"{label} must be {maximum} characters or fewer.")
    return text


def positive_price(value, *, required=True):
    if value in (None, "") and not required:
        return None
    from decimal import Decimal, InvalidOperation
    try:
        price = Decimal(str(value))
        if not price.is_finite() or price < 0 or price > Decimal("9999999999.99"):
            raise ValueError
        return price.quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError, ArithmeticError):
        raise ValueError("Price must be a valid amount greater than or equal to zero.")


def save_uploaded_image(file_storage):
    """Validate and normalize an uploaded raster image; return a /uploads URL."""
    if not file_storage or not file_storage.filename:
        return ""
    raw = file_storage.read(current_app.config["MAX_IMAGE_BYTES"] + 1)
    if not raw:
        raise ValueError("The selected image is empty.")
    if len(raw) > current_app.config["MAX_IMAGE_BYTES"]:
        raise ValueError("Images must be 5 MiB or smaller.")

    try:
        with Image.open(BytesIO(raw)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP", "GIF"}:
                raise ValueError("Upload a JPG, PNG, WEBP or GIF image.")
            if source.width * source.height > 25_000_000:
                raise ValueError("The image dimensions are too large.")
            source.verify()
        with Image.open(BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source)
            image.thumbnail((2000, 2000))
            if image.mode != "RGB":
                image = image.convert("RGB")
            output = BytesIO()
            image.save(output, format="JPEG", quality=86, optimize=True)
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise ValueError("The uploaded file is not a valid image.")

    folder = Path(current_app.config["UPLOAD_FOLDER"])
    folder.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}.jpg"
    (folder / filename).write_bytes(output.getvalue())
    return f"/uploads/{filename}"


def remove_uploaded_image(image_url):
    """Delete only files managed by this app, never arbitrary filesystem paths."""
    if not image_url or not image_url.startswith("/uploads/"):
        return
    name = image_url.removeprefix("/uploads/")
    if "/" in name or "\\" in name:
        return
    path = Path(current_app.config["UPLOAD_FOLDER"]) / name
    try:
        path.unlink(missing_ok=True)
    except OSError:
        current_app.logger.warning("Unable to remove uploaded image %s", name)


def safe_commit():
    try:
        db.session.commit()
        return None
    except IntegrityError:
        db.session.rollback()
        return api_error("This record conflicts with an existing entry.", 409)
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Database transaction failed")
        return api_error("Unable to save your changes right now.", 500)


def pagination_args():
    try:
        page = max(1, int(request.args.get("page", 1)))
        per_page = min(48, max(1, int(request.args.get("per_page", 12))))
    except (TypeError, ValueError):
        page, per_page = 1, 12
    return page, per_page


def listing_response(pagination, serialize):
    return {
        "items": [serialize(item) for item in pagination.items],
        "pagination": {
            "page": pagination.page,
            "per_page": pagination.per_page,
            "total": pagination.total,
            "pages": pagination.pages,
            "has_next": pagination.has_next,
            "has_prev": pagination.has_prev,
        },
    }
