"""
Image uploads – ``/api/uploads``

POST   /api/uploads/image    multipart form upload (field name: ``image``)
GET    /api/uploads          list of images the current user has uploaded
DELETE /api/uploads/<name>   remove an uploaded image

Files land in ``frontend/assets/uploads`` so the static frontend can serve
them directly, and the API returns a relative URL (``assets/uploads/x.jpg``)
that works on a phone, on Live Server and behind a reverse proxy alike.
"""

import os
import time
import uuid

from flask import Blueprint, current_app, request
from werkzeug.utils import secure_filename

from config import Config
from utils.decorators import current_user, login_required
from utils.helpers import api_error, api_success
from utils.validators import ValidationError, validate_image_file

uploads_bp = Blueprint("uploads", __name__)

#: Public URL prefix for an uploaded file (relative – no hard-coded host).
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


def upload_dir() -> str:
    """Absolute upload directory, created on first use."""
    folder = current_app.config.get("UPLOAD_FOLDER", Config.UPLOAD_FOLDER)
    os.makedirs(folder, exist_ok=True)
    return folder


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
        destination = os.path.join(upload_dir(), filename)
        file.save(destination)

        size_kb = round(os.path.getsize(destination) / 1024, 1)
        return api_success(
            {
                "filename": filename,
                "url": f"{PUBLIC_PREFIX}/{filename}",
                "absolute_url": f"/{PUBLIC_PREFIX}/{filename}",
                "size_kb": size_kb,
            },
            message="Image uploaded",
            status=201,
        )
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)
    except OSError as exc:                     # disk full / permission problems
        current_app.logger.error("Upload failed: %s", exc)
        return api_error("Could not save the image. Please try again.", 500)


@uploads_bp.get("/uploads")
@login_required
def list_uploads():
    """List the current user's uploaded images (newest first)."""
    user = current_user()
    folder = upload_dir()
    prefix = f"u{user.id}_"
    try:
        files = [
            name
            for name in os.listdir(folder)
            if name.startswith(prefix) and not name.startswith(".")
        ]
    except OSError:
        files = []

    items = []
    for name in sorted(files, key=lambda n: os.path.getmtime(os.path.join(folder, n)), reverse=True):
        path = os.path.join(folder, name)
        items.append(
            {
                "filename": name,
                "url": f"{PUBLIC_PREFIX}/{name}",
                "size_kb": round(os.path.getsize(path) / 1024, 1),
            }
        )
    return api_success({"items": items, "total": len(items)})


@uploads_bp.delete("/uploads/<path:filename>")
@login_required
def delete_upload(filename: str):
    """Delete one of *your own* uploads (path-traversal safe)."""
    user = current_user()
    safe_name = secure_filename(filename)
    if not safe_name.startswith(f"u{user.id}_") and not user.is_admin:
        return api_error("You can only delete your own uploads", 403)

    path = os.path.join(upload_dir(), safe_name)
    if not os.path.isfile(path):
        return api_error("File not found", 404)
    os.remove(path)
    return api_success(message="Image deleted")
