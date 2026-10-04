"""
Image uploads – ``/api/uploads``

POST   /api/uploads/image    multipart form upload (field name: ``image``)
GET    /api/uploads          list of images the current user has uploaded
DELETE /api/uploads/<name>   remove an uploaded image

Where the files actually live is decided by ``UPLOAD_STORAGE`` (see
``utils/storage.py``):

* ``local`` (development) – ``frontend/assets/uploads``, served by Flask so
  the returned relative URL (``assets/uploads/x.jpg``) works on one phone,
  on Live Server and behind a reverse proxy alike.
* ``s3`` (production, e.g. Vercel) – a persistent S3-compatible bucket such
  as Cloudflare R2; the API then returns an absolute public URL for the
  object instead.

The route layer is identical either way.
"""

import time
import uuid

from flask import Blueprint, current_app, request
from utils import storage
from utils.decorators import current_user, login_required
from utils.helpers import api_error, api_success
from utils.validators import ValidationError, validate_image_file
from werkzeug.utils import secure_filename

uploads_bp = Blueprint("uploads", __name__)

#: Allowed content types as a second line of defence behind the extension check.
ALLOWED_MIMETYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "application/octet-stream",  # some Android browsers send this
}


@uploads_bp.post("/uploads/image")
@login_required
def upload_image():
    """Accept one image (max size from ``MAX_CONTENT_LENGTH``) and save it."""
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
        extension = safe_name.rsplit(".", 1)[1].lower()
        # Unique, collision-proof name: user id + timestamp + random suffix.
        filename = f"u{user.id}_{int(time.time())}_{uuid.uuid4().hex[:8]}.{extension}"
        filename = secure_filename(filename)

        info = storage.save_image(filename, file, content_type=file.mimetype)
        return api_success(info, message="Image uploaded", status=201)
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)
    except (OSError, storage.StorageError) as exc:
        # Disk full / permission problems, or S3 misconfiguration.
        current_app.logger.error("Upload failed: %s", exc)
        return api_error("Could not save the image. Please try again.", 500)


@uploads_bp.get("/uploads")
@login_required
def list_uploads():
    """List the current user's uploaded images (newest first)."""
    user = current_user()
    try:
        items = storage.list_user_images(user.id)
    except (OSError, storage.StorageError) as exc:
        current_app.logger.error("Listing uploads failed: %s", exc)
        items = []
    return api_success({"items": items, "total": len(items)})


@uploads_bp.delete("/uploads/<path:filename>")
@login_required
def delete_upload(filename: str):
    """Delete one of *your own* uploads (path-traversal safe)."""
    user = current_user()
    safe_name = secure_filename(filename)
    if not safe_name.startswith(f"u{user.id}_") and not user.is_admin:
        return api_error("You can only delete your own uploads", 403)

    try:
        existed = storage.delete_image(safe_name)
    except (OSError, storage.StorageError) as exc:
        current_app.logger.error("Deleting upload failed: %s", exc)
        return api_error("Could not delete the image. Please try again.", 500)
    if not existed:
        return api_error("File not found", 404)
    return api_success(message="Image deleted")
