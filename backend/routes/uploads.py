"""
Image uploads – ``/api/uploads``

POST   /api/uploads/image         multipart form upload (field name: ``image``)
GET    /api/uploads               list of images the current user has uploaded
GET    /api/uploads/view/<ref>    stream one image (public, works with any bucket)
DELETE /api/uploads/<name>        remove an uploaded image

Storage is pluggable (see ``storage.py``):

* ``UPLOAD_STORAGE=local`` (default) writes to ``UPLOAD_FOLDER``
  (``frontend/assets/uploads`` in development) and returns a relative URL such
  as ``assets/uploads/u3_1699999_ab12cd34.png``.
* ``UPLOAD_STORAGE=s3`` writes to an S3-compatible bucket (Cloudflare R2, AWS
  S3, MinIO, Supabase Storage…) and returns an absolute URL when the bucket has
  a public domain.

**Why ``/api/uploads/view`` exists.**  An ``<img>`` tag cannot sign a request,
so a bucket that is not public (Supabase buckets are private until you tick
"Public bucket") answers every browser with a 400 – the photo uploaded, sits in
the bucket, and never renders.  This route is the same-origin fallback the
frontend retries automatically: the API fetches the object with the server's
credentials and streams it back, so images work whether the bucket is public or
private, and whether or not ``S3_PUBLIC_BASE_URL`` is configured at all.

Both modes answer with the same JSON shape, so the frontend does not care
which backend is active.
"""

import time
import uuid

from flask import Blueprint, Response, current_app, redirect, request

from storage import VIEW_ROUTE, InvalidReferenceError, StorageError, get_storage
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


def _proxy_mode() -> str:
    """``stream`` (default) or ``redirect`` for ``/api/uploads/view``."""
    return str(current_app.config.get("UPLOAD_PROXY_MODE") or "stream").lower()


def _redirect_target(storage, reference: str) -> str | None:
    """A URL to bounce the browser to instead of proxying bytes, if any.

    ``None`` means "stream it", which is also the safety net when a presigned
    URL cannot be minted (no credentials, provider error): a working proxied
    image beats a fast broken one.
    """
    if hasattr(storage, "signed_url"):
        try:
            return storage.signed_url(storage.key_for_reference(reference))
        except StorageError as exc:
            current_app.logger.warning("Presign failed, streaming instead: %s", exc)
            return None
    try:
        target = storage.display_url(reference)
    except StorageError:
        return None
    if not target or target.startswith(VIEW_ROUTE) or target == request.path:
        return None                    # would send us straight back here
    return target


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


@uploads_bp.get("/uploads/view/<path:reference>")
def view_upload(reference: str):
    """Stream one uploaded image from wherever it is stored.

    Deliberately unauthenticated: an ``<img>`` element cannot present a JWT,
    and listing photos are public information.  Access is still bounded – only
    names this app generated (``u<id>_<ts>_<random>.png``) or paths inside the
    configured upload prefix resolve to an object, path traversal is rejected,
    and nothing but an image extension is ever read out of the bucket.

    ``UPLOAD_PROXY_MODE=redirect`` answers with a 302 to a short-lived
    presigned URL instead of proxying the bytes, which moves the bandwidth to
    the storage provider if the function's egress ever becomes the bottleneck.
    """
    storage = get_storage(current_app)
    if not hasattr(storage, "open_object"):          # pragma: no cover - custom backend
        return api_error("This storage backend cannot stream files", 501)

    # Ownership first: anything that is not an upload this app made (a foreign
    # URL, a static asset, ``../``, an odd extension) never reaches the bucket.
    if hasattr(storage, "owns") and not storage.owns(reference):
        return api_error("Image not found", 404)

    try:
        if _proxy_mode() == "redirect":
            target = _redirect_target(storage, reference)
            if target:
                # Signatures expire, so never let a cache hold the redirect.
                response = redirect(target, code=302)
                response.headers["Cache-Control"] = "private, no-store"
                return response
        payload = storage.open_object(reference)
    except (FileNotFoundError, InvalidReferenceError):
        return api_error("Image not found", 404)
    except StorageError as exc:
        current_app.logger.error("Upload storage error: %s", exc)
        return api_error(str(exc), 503)
    except OSError as exc:
        current_app.logger.error("Could not read upload: %s", exc)
        return api_error("Could not read the image. Please try again.", 500)

    body = payload["body"]
    etag = payload.get("etag")
    headers = {
        # Upload names are unique per file, so a stale copy is impossible.
        "Cache-Control": "public, max-age=604800, immutable",
        "Content-Type": payload.get("content_type") or "image/jpeg",
        "Content-Length": str(len(body)),
    }
    if etag:
        headers["ETag"] = f'"{etag}"'
        if request.headers.get("If-None-Match") == f'"{etag}"':
            return Response(status=304, headers={"ETag": headers["ETag"]})
    return Response(body, status=200, headers=headers)


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
