"""
Image uploads – ``/api/uploads``

POST   /api/uploads/image    multipart form upload (field name: ``image``)
GET    /api/uploads          list of images the current user has uploaded
DELETE /api/uploads/<name>   remove an uploaded image

Storage is pluggable (see ``storage.py``):

* ``UPLOAD_STORAGE=local`` (default) writes to ``UPLOAD_FOLDER``
  (``frontend/assets/uploads`` in development) and returns a relative URL such
  as ``assets/uploads/u3_1699999_ab12cd34.png``.
* ``UPLOAD_STORAGE=s3`` writes to an S3-compatible bucket (Cloudflare R2, AWS
  S3, MinIO…) and returns an absolute URL, which is what keeps images alive on
  serverless hosts such as Vercel.

Both modes answer with the same JSON shape, so the frontend does not care
which backend is active.
"""

import time
import uuid

from flask import Blueprint, current_app, request

from storage import StorageError, get_storage
from utils.decorators import current_user, login_required
from utils.helpers import api_error, api_success
from utils.validators import ValidationError, validate_image_file

uploads_bp = Blueprint("uploads", __name__)

#: Public URL prefix used by the local backend (relative – no hard-coded host).
PUBLIC_PREFIX = "assets/uploads"
#: Allowed content types as a second line of defence behind the extension check.
ALLOWED_MIMETYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "application/octet-stream",  # some Android browsers send this
}


def build_filename(user_id: int, safe_name: str) -> str:
    """Unique, collision-proof name: user id + timestamp + random suffix."""
    extension = safe_name.rsplit(".", 1)[1].lower()
    return f"u{user_id}_{int(time.time())}_{uuid.uuid4().hex[:8]}.{extension}"


@uploads_bp.post("/uploads/image")
@login_required
def upload_image():
    """Accept one image (max size from ``MAX_CONTENT_LENGTH``) and store it."""
    if "image" not in request.files and "file" not in request.files:
        return api_error("No image file was sent", 422, {"image": "Required"})

    file = request.files.get("image") or request.files.get("file")
    if not file or not file.filename:
        return api_error("No image selected", 422, {"image": "Required"})

    try:
        safe_name = validate_image_file(file.filename)
        if file.mimetype and file.mimetype not in ALLOWED_MIMETYPES:
            raise ValidationError("That file does not look like an image")

        user = current_user()
        storage = get_storage(current_app)
        result = storage.save(file, build_filename(user.id, safe_name))

        payload = dict(result)
        warning = storage.describe().get("warning")
        if warning:
            # Surfaced in the response so a non-persistent setup is noticed
            # immediately instead of after the images vanish.
            payload["warning"] = warning
        return api_success(payload, message="Image uploaded", status=201)

    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)
    except StorageError as exc:
        current_app.logger.error("Upload storage error: %s", exc)
        return api_error(str(exc), 503)
    except OSError as exc:                     # disk full / permission problems
        current_app.logger.error("Upload failed: %s", exc)
        return api_error("Could not save the image. Please try again.", 500)


@uploads_bp.get("/uploads")
@login_required
def list_uploads():
    """List the current user's uploaded images (newest first)."""
    user = current_user()
    try:
        items = get_storage(current_app).list_for_user(user.id)
    except StorageError as exc:
        current_app.logger.error("Upload storage error: %s", exc)
        return api_error(str(exc), 503)
    except OSError as exc:
        current_app.logger.error("Could not list uploads: %s", exc)
        return api_error("Could not list your images. Please try again.", 500)

    return api_success({"items": items, "total": len(items)})


@uploads_bp.delete("/uploads/<path:filename>")
@login_required
def delete_upload(filename: str):
    """Delete one of *your own* uploads (path-traversal safe)."""
    user = current_user()
    storage = get_storage(current_app)
    safe_name = filename.rsplit("/", 1)[-1]
    if not safe_name.startswith(f"u{user.id}_") and not user.is_admin:
        return api_error("You can only delete your own uploads", 403)

    try:
        storage.delete(safe_name)
    except FileNotFoundError:
        return api_error("File not found", 404)
    except StorageError as exc:
        current_app.logger.error("Upload storage error: %s", exc)
        return api_error(str(exc), 503)
    except OSError as exc:
        current_app.logger.error("Could not delete upload: %s", exc)
        return api_error("Could not delete the image. Please try again.", 500)

    return api_success(message="Image deleted")
