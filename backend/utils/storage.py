"""
Pluggable storage for uploaded images.

The upload routes never touch a filesystem or a bucket directly – they call
this module, which picks the active backend from the ``UPLOAD_STORAGE``
setting:

* ``local`` (default) – files are written to ``UPLOAD_FOLDER`` on disk.  This
  is what local development uses; Flask serves them from the static frontend
  folder as relative URLs (``assets/uploads/<file>``).
* ``s3`` – files are stored in any S3-compatible bucket (AWS S3, Cloudflare
  R2, MinIO, DigitalOcean Spaces, …).  This is what production on Vercel
  uses, because a serverless filesystem is ephemeral: every request can run
  on a different machine, so images must live in persistent object storage.

Both backends implement the same three operations (save / list / delete) and
return the same shapes, so the routes behave identically either way.

``boto3`` is imported lazily inside the S3 code paths so the app (and the
test suite) runs without the dependency when only local storage is used.
"""

import os

from flask import current_app

from config import Config

#: Relative public prefix used by the ``local`` backend.  Flask's static
#: routing serves ``frontend/assets/uploads`` at this path, and the
#: frontend's ``UI.imageFor()`` resolves the relative URL against the site
#: root, so no host is ever hard-coded.
LOCAL_PUBLIC_PREFIX = "assets/uploads"


class StorageError(Exception):
    """Raised when an image cannot be saved, listed or removed."""


# ---------------------------------------------------------------------------
# Backend selection + public URLs
# ---------------------------------------------------------------------------
def storage_mode() -> str:
    """Return the active backend name: ``"local"`` or ``"s3"``."""
    mode = (current_app.config.get("UPLOAD_STORAGE") or "local").strip().lower()
    if mode not in {"local", "s3"}:
        raise StorageError(
            f"UPLOAD_STORAGE must be 'local' or 's3' (got '{mode}')"
        )
    return mode


def upload_dir() -> str:
    """Absolute upload directory for the local backend, created on demand."""
    folder = current_app.config.get("UPLOAD_FOLDER", Config.UPLOAD_FOLDER)
    os.makedirs(folder, exist_ok=True)
    return folder


def s3_key_prefix() -> str:
    """Bucket key prefix for all uploads (defaults to ``uploads/``)."""
    return (current_app.config.get("S3_KEY_PREFIX") or "uploads").strip("/")


def public_base_url() -> str:
    """Base URL in which saved images appear (no trailing slash).

    Local backend:  ``assets/uploads``           (relative – same origin)
    S3 backend:     ``https://pub-….r2.dev/uploads``  (absolute)
    """
    if storage_mode() == "s3":
        base = (current_app.config.get("S3_PUBLIC_URL") or "").strip()
        if not base:
            raise StorageError(
                "UPLOAD_STORAGE=s3 but S3_PUBLIC_URL is not configured"
            )
        return base.rstrip("/") + "/" + s3_key_prefix()
    return LOCAL_PUBLIC_PREFIX


# ---------------------------------------------------------------------------
# S3 client (built lazily so boto3 is only needed when actually used)
# ---------------------------------------------------------------------------
def _s3_client():
    """Create a boto3 S3 client from the current app configuration."""
    import boto3  # noqa: PLC0415 – lazy on purpose (see module docstring)

    endpoint = current_app.config.get("S3_ENDPOINT_URL")
    bucket = current_app.config.get("S3_BUCKET")
    key_id = current_app.config.get("S3_ACCESS_KEY_ID")
    secret = current_app.config.get("S3_SECRET_ACCESS_KEY")
    region = current_app.config.get("S3_REGION") or "auto"

    missing = [
        name
        for name, value in (
            ("S3_ENDPOINT_URL", endpoint),
            ("S3_BUCKET", bucket),
            ("S3_ACCESS_KEY_ID", key_id),
            ("S3_SECRET_ACCESS_KEY", secret),
        )
        if not value
    ]
    if missing:
        raise StorageError(
            "S3 storage is enabled but not fully configured – missing: "
            + ", ".join(missing)
        )

    client_kwargs = {
        "endpoint_url": endpoint,
        "aws_access_key_id": key_id,
        "aws_secret_access_key": secret,
        # R2 has one global region addressed as "auto"; AWS S3 needs a real
        # region, which the operator supplies via S3_REGION.
        "region_name": region,
    }
    # Non-AWS endpoints (R2, MinIO, …) require virtual-host-style addressing;
    # boto3 defaults to path-style for custom endpoints, which R2 rejects.
    if endpoint and "amazonaws.com" not in endpoint:
        client_kwargs["addressing_style"] = "virtual"

    return boto3.client("s3", **client_kwargs)


def _s3_key(filename: str) -> str:
    return f"{s3_key_prefix()}/{filename}"


def _public_url(filename: str) -> str:
    url = f"{public_base_url()}/{filename}"
    # Local URLs are relative ("assets/uploads/x.jpg"); S3 URLs are absolute.
    return url if url.startswith("http") else f"/{url}"


# ---------------------------------------------------------------------------
# Save / list / delete
# ---------------------------------------------------------------------------
def save_image(filename: str, file_storage, content_type: str | None = None) -> dict:
    """Persist one image and return its public URL information.

    ``file_storage`` is a Werkzeug ``FileStorage`` (already validated by the
    route).  Returns ``{"filename", "url", "absolute_url", "size_kb"}``.
    """
    if storage_mode() == "s3":
        body = file_storage.read()
        _s3_client().put_object(
            Bucket=current_app.config["S3_BUCKET"],
            Key=_s3_key(filename),
            Body=body,
            ContentType=content_type or "application/octet-stream",
        )
        size_kb = round(len(body) / 1024, 1)
    else:
        folder = upload_dir()
        file_storage.save(os.path.join(folder, filename))
        size_kb = round(os.path.getsize(os.path.join(folder, filename)) / 1024, 1)

    url = _public_url(filename)
    return {
        "filename": filename,
        "url": url.lstrip("/"),
        "absolute_url": url,
        "size_kb": size_kb,
    }


def list_user_images(user_id: int) -> list:
    """List one user's uploaded images, newest first.

    Uploads are always named ``u<user_id>_<timestamp>_<suffix>.<ext>``, so a
    key/file prefix is enough to scope the listing to a single account.
    """
    user_prefix = f"u{user_id}_"

    if storage_mode() == "s3":
        client = _s3_client()
        bucket = current_app.config["S3_BUCKET"]
        key_prefix = s3_key_prefix()
        prefix = f"{key_prefix}/{user_prefix}"

        entries = []
        continuation_token = None
        while True:
            kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            response = client.list_objects_v2(**kwargs)
            for obj in response.get("Contents", []):
                # Strip only the key prefix – the filename keeps its
                # ``u<user_id>_`` marker (it is part of the public name).
                name = obj["Key"][len(key_prefix) + 1 :]
                if name:
                    entries.append(
                        {
                            "filename": name,
                            "url": _public_url(name).lstrip("/"),
                            "size_kb": round(obj.get("Size", 0) / 1024, 1),
                            "_mtime": obj["LastModified"].timestamp(),
                        }
                    )
            continuation_token = response.get("NextContinuationToken")
            if not continuation_token:
                break

        entries.sort(key=lambda entry: entry["_mtime"], reverse=True)
        for entry in entries:
            entry.pop("_mtime", None)
        return entries

    folder = upload_dir()
    files = [
        name
        for name in os.listdir(folder)
        if name.startswith(user_prefix) and not name.startswith(".")
    ]
    items = []
    for name in sorted(files, key=lambda n: os.path.getmtime(os.path.join(folder, n)), reverse=True):
        path = os.path.join(folder, name)
        items.append(
            {
                "filename": name,
                "url": f"{LOCAL_PUBLIC_PREFIX}/{name}",
                "size_kb": round(os.path.getsize(path) / 1024, 1),
            }
        )
    return items


def delete_image(filename: str) -> bool:
    """Remove one uploaded image.  Returns ``False`` when it does not exist."""
    if storage_mode() == "s3":
        from botocore.exceptions import ClientError  # noqa: PLC0415 – lazy

        client = _s3_client()
        bucket = current_app.config["S3_BUCKET"]
        key = _s3_key(filename)
        try:
            client.head_object(Bucket=bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey"}:
                return False
            raise
        client.delete_object(Bucket=bucket, Key=key)
        return True

    path = os.path.join(upload_dir(), filename)
    if not os.path.isfile(path):
        return False
    os.remove(path)
    return True
