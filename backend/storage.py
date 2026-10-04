"""
Persistent image storage for listing uploads.

``UPLOAD_STORAGE`` selects the backend:

``local`` (default)
    Files are written to ``UPLOAD_FOLDER`` – ``frontend/assets/uploads`` during
    local development – and served by Flask / the web server. Ideal for a
    laptop or a VPS with a persistent disk.

``s3``
    Files are written to any S3-compatible bucket (Cloudflare R2, AWS S3,
    MinIO, Backblaze B2, Supabase Storage's S3 gateway…). This is the only
    *persistent* option on serverless hosts such as Vercel, where the
    filesystem is ephemeral, and it returns absolute public URLs, so images
    keep working across redeploys and multiple function instances.

Both backends expose the same ``save`` / ``delete`` / ``list_for_user`` /
``describe`` API, so the routes never need to know which one is active.
"""

import mimetypes
import os
import tempfile

from werkzeug.utils import secure_filename

#: Backend identifiers used by ``UPLOAD_STORAGE``.
LOCAL = "local"
S3 = "s3"

DEFAULT_S3_PREFIX = "uploads"
DEFAULT_PUBLIC_PREFIX = "assets/uploads"
#: Browsers may cache an uploaded image for a week (the name is unique).
DEFAULT_CACHE_CONTROL = "public, max-age=604800"

#: Extension key under which the built backend is cached on the Flask app.
_EXTENSION_KEY = "campus_market.upload_storage"

#: Configuration keys that identify a backend – changing any of them rebuilds it.
_SIGNATURE_KEYS = (
    "UPLOAD_STORAGE",
    "UPLOAD_FOLDER",
    "UPLOAD_STORAGE_PERSISTENT",
    "PUBLIC_UPLOAD_PREFIX",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ENDPOINT_URL",
    "S3_ACCESS_KEY_ID",
    "S3_PREFIX",
    "S3_PUBLIC_BASE_URL",
    "S3_ADDRESSING_STYLE",
)


class StorageError(RuntimeError):
    """Raised when upload storage is misconfigured or unavailable."""


# ---------------------------------------------------------------------------
# Helpers shared by the backends
# ---------------------------------------------------------------------------
def _s3_error_classes() -> tuple:
    """Error classes raised by botocore (imported lazily – boto3 is optional)."""
    try:
        import botocore.exceptions as exceptions
    except ImportError:                  # boto3 missing: no call can happen
        return ()
    return (exceptions.BotoCoreError, exceptions.ClientError)


_S3_ERRORS = _s3_error_classes()


def _error_code(exc: Exception) -> str:
    """Best-effort error code from a botocore exception."""
    response = getattr(exc, "response", None) or {}
    error = response.get("Error") or {}
    code = error.get("Code") or response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return str(code) if code else exc.__class__.__name__


def _is_not_found(exc: Exception) -> bool:
    """True when S3 reported that the object does not exist."""
    response = getattr(exc, "response", None) or {}
    status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return _error_code(exc) in {"404", "NoSuchKey", "NotFound"} or status == 404


def _friendly_s3_error(exc: Exception, bucket: str) -> str:
    """Translate a botocore failure into an actionable message."""
    code = _error_code(exc)
    message = f"Object storage error ({code}) while talking to bucket '{bucket}'."
    if code in {"AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "403"}:
        return message + " Check S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY and the bucket permissions."
    if code in {"NoSuchBucket", "404"}:
        return message + " Check S3_BUCKET (and S3_ENDPOINT_URL for R2/MinIO)."
    if code in {"EndpointConnectionError", "ConnectTimeoutError", "ConnectionError"}:
        return message + " Check S3_ENDPOINT_URL and that this host can reach it."
    return message


# ---------------------------------------------------------------------------
# Backends
# ---------------------------------------------------------------------------
class StorageBackend:
    """Interface every upload backend implements."""

    backend = "unknown"
    persistent = False

    def save(self, file_storage, filename: str) -> dict:       # pragma: no cover
        raise NotImplementedError

    def delete(self, filename: str) -> None:                   # pragma: no cover
        raise NotImplementedError

    def list_for_user(self, user_id: int) -> list:             # pragma: no cover
        raise NotImplementedError

    def describe(self) -> dict:                                # pragma: no cover
        raise NotImplementedError


class LocalStorage(StorageBackend):
    """Write uploads to a directory on disk and serve them as static files."""

    backend = LOCAL

    def __init__(self, folder: str, public_prefix: str = DEFAULT_PUBLIC_PREFIX,
                 persistent: bool = True):
        self.folder = folder
        self.public_prefix = (public_prefix or DEFAULT_PUBLIC_PREFIX).strip("/")
        self.persistent = persistent

    # -- helpers ------------------------------------------------------------
    def path_for(self, filename: str) -> str:
        """Absolute path for ``filename``, sandboxed inside ``self.folder``."""
        safe_name = secure_filename(filename or "")
        if not safe_name:
            raise StorageError("Invalid file name")
        folder = os.path.abspath(self.folder)
        path = os.path.abspath(os.path.join(folder, safe_name))
        if os.path.dirname(path) != folder:
            raise StorageError("Invalid file name")
        return path

    def url_for(self, filename: str) -> str:
        """Path the frontend can request, relative to the site root."""
        return f"{self.public_prefix}/{secure_filename(filename)}"

    # -- API ----------------------------------------------------------------
    def save(self, file_storage, filename: str) -> dict:
        os.makedirs(self.folder, exist_ok=True)
        safe_name = secure_filename(filename)
        destination = self.path_for(safe_name)
        file_storage.save(destination)
        return {
            "filename": safe_name,
            "url": self.url_for(safe_name),
            "absolute_url": "/" + self.url_for(safe_name),
            "size_kb": round(os.path.getsize(destination) / 1024, 1),
            "storage": self.backend,
        }

    def delete(self, filename: str) -> None:
        path = self.path_for(filename)
        if not os.path.isfile(path):
            raise FileNotFoundError(filename)
        os.remove(path)

    def list_for_user(self, user_id: int) -> list:
        wanted = f"u{user_id}_"
        try:
            names = [
                name
                for name in os.listdir(self.folder)
                if name.startswith(wanted) and not name.startswith(".")
            ]
        except OSError:
            names = []

        def modified(name: str) -> float:
            try:
                return os.path.getmtime(os.path.join(self.folder, name))
            except OSError:
                return 0.0

        items = []
        for name in sorted(names, key=modified, reverse=True):
            try:
                size = os.path.getsize(os.path.join(self.folder, name))
            except OSError:
                size = 0
            items.append(
                {
                    "filename": name,
                    "url": self.url_for(name),
                    "size_kb": round(size / 1024, 1),
                }
            )
        return items

    def describe(self) -> dict:
        info = {
            "backend": self.backend,
            "persistent": self.persistent,
            "location": self.folder,
            "public_prefix": self.public_prefix,
        }
        if not self.persistent:
            info["warning"] = (
                "Uploads are written to an ephemeral filesystem and disappear on the "
                "next deploy or cold start. Set UPLOAD_STORAGE=s3 (plus the S3_* "
                "variables) to keep images."
            )
        return info


class S3Storage(StorageBackend):
    """Store uploads in any S3-compatible bucket and serve them by public URL."""

    backend = S3
    persistent = True

    def __init__(
        self,
        bucket: str,
        *,
        prefix: str = DEFAULT_S3_PREFIX,
        region: str = "auto",
        endpoint_url: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        public_base_url: str | None = None,
        addressing_style: str = "path",
        client=None,
    ):
        self.bucket = bucket
        self.prefix = (prefix or "").strip("/")
        self.region = region or "auto"
        self.endpoint_url = endpoint_url or None
        self.access_key_id = access_key_id or None
        self.secret_access_key = secret_access_key or None
        self.public_base_url = (public_base_url or "").rstrip("/")
        self.addressing_style = (addressing_style or "path").lower()
        self._client = client

    # -- boto3 client -------------------------------------------------------
    @property
    def client(self):
        """Lazily built boto3 client (kept warm for the life of the instance)."""
        if self._client is None:
            self._client = self._build_client()
        return self._client

    def _build_client(self):
        try:
            import boto3
            from botocore.config import Config as BotoConfig
        except ImportError as exc:                    # pragma: no cover - install issue
            raise StorageError(
                "boto3 is not installed, so UPLOAD_STORAGE=s3 cannot work. "
                "Add `boto3` to the environment (it is already listed in requirements.txt)."
            ) from exc

        kwargs = {
            "service_name": "s3",
            "region_name": self.region,
            "config": BotoConfig(
                signature_version="s3v4",
                s3={"addressing_style": self.addressing_style},
            ),
        }
        if self.endpoint_url:
            kwargs["endpoint_url"] = self.endpoint_url
        if self.access_key_id and self.secret_access_key:
            kwargs["aws_access_key_id"] = self.access_key_id
            kwargs["aws_secret_access_key"] = self.secret_access_key
        return boto3.client(**kwargs)

    # -- helpers ------------------------------------------------------------
    def key_for(self, filename: str) -> str:
        """Object key for ``filename`` (``<prefix>/u<id>_<ts>_<rand>.<ext>``)."""
        safe_name = secure_filename(filename or "")
        if not safe_name:
            raise StorageError("Invalid file name")
        return f"{self.prefix}/{safe_name}" if self.prefix else safe_name

    def url_for(self, key: str) -> str:
        """Absolute public URL for an object key."""
        if not self.public_base_url:
            raise StorageError(
                "S3_PUBLIC_BASE_URL is not set, so uploaded images cannot be linked. "
                "Set it to the bucket's public URL (for example "
                "https://pub-<hash>.r2.dev for Cloudflare R2)."
            )
        return f"{self.public_base_url}/{key.lstrip('/')}"

    # -- API ----------------------------------------------------------------
    def save(self, file_storage, filename: str) -> dict:
        body = file_storage.read()
        content_type = (
            file_storage.mimetype
            or mimetypes.guess_type(filename or "")[0]
            or "application/octet-stream"
        )
        key = self.key_for(filename)
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=body,
                ContentType=content_type,
                CacheControl=DEFAULT_CACHE_CONTROL,
            )
        except _S3_ERRORS as exc:
            raise StorageError(_friendly_s3_error(exc, self.bucket)) from exc

        url = self.url_for(key)
        return {
            "filename": secure_filename(filename),
            "url": url,
            "absolute_url": url,
            "size_kb": round(len(body) / 1024, 1),
            "storage": self.backend,
            "key": key,
        }

    def exists(self, filename: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=self.key_for(filename))
            return True
        except _S3_ERRORS as exc:
            if _is_not_found(exc):
                return False
            raise StorageError(_friendly_s3_error(exc, self.bucket)) from exc

    def delete(self, filename: str) -> None:
        if not self.exists(filename):
            raise FileNotFoundError(filename)
        try:
            self.client.delete_object(Bucket=self.bucket, Key=self.key_for(filename))
        except _S3_ERRORS as exc:
            raise StorageError(_friendly_s3_error(exc, self.bucket)) from exc

    def list_for_user(self, user_id: int) -> list:
        wanted = f"u{user_id}_"
        search_prefix = f"{self.prefix}/{wanted}" if self.prefix else wanted
        try:
            response = self.client.list_objects_v2(
                Bucket=self.bucket, Prefix=search_prefix, MaxKeys=1000
            )
        except _S3_ERRORS as exc:
            raise StorageError(_friendly_s3_error(exc, self.bucket)) from exc

        rows = response.get("Contents") or []
        rows.sort(key=lambda row: str(row.get("LastModified") or ""), reverse=True)
        return [
            {
                "filename": str(row.get("Key", "")).rsplit("/", 1)[-1],
                "url": self.url_for(str(row.get("Key", ""))),
                "size_kb": round((row.get("Size") or 0) / 1024, 1),
            }
            for row in rows
        ]

    def describe(self) -> dict:
        return {
            "backend": self.backend,
            "persistent": True,
            "bucket": self.bucket,
            "prefix": self.prefix,
            "endpoint": self.endpoint_url or "aws",
            "public_base_url": self.public_base_url or None,
        }


class UnavailableStorage(StorageBackend):
    """Placeholder returned when ``UPLOAD_STORAGE`` cannot be built.

    The API keeps serving every other route – only uploads fail, with a clear
    message instead of a stack trace.
    """

    def __init__(self, backend: str, reason: str):
        self.backend = backend
        self.reason = reason
        self.persistent = False

    def _fail(self):
        raise StorageError(self.reason)

    def save(self, file_storage, filename: str) -> dict:
        self._fail()

    def delete(self, filename: str) -> None:
        self._fail()

    def list_for_user(self, user_id: int) -> list:
        self._fail()

    def describe(self) -> dict:
        return {
            "backend": self.backend,
            "persistent": False,
            "configured": False,
            "error": self.reason,
        }


# ---------------------------------------------------------------------------
# Factory + per-app cache
# ---------------------------------------------------------------------------
def _build_s3(config) -> StorageBackend:
    """Validate S3 settings and build the backend (or explain what is missing)."""
    bucket = config.get("S3_BUCKET")
    public_base_url = config.get("S3_PUBLIC_BASE_URL")
    access_key_id = config.get("S3_ACCESS_KEY_ID")
    secret_access_key = config.get("S3_SECRET_ACCESS_KEY")

    missing = [
        name
        for name, value in (
            ("S3_BUCKET", bucket),
            ("S3_PUBLIC_BASE_URL", public_base_url),
        )
        if not value
    ]
    if missing:
        return UnavailableStorage(
            S3,
            "UPLOAD_STORAGE=s3 but " + " and ".join(missing) + " "
            + ("are" if len(missing) > 1 else "is")
            + " not set – uploads cannot be stored and served until it is configured.",
        )
    if bool(access_key_id) != bool(secret_access_key):
        return UnavailableStorage(
            S3,
            "Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (or neither, to use "
            "the environment's default AWS credentials).",
        )

    return S3Storage(
        bucket=bucket,
        prefix=config.get("S3_PREFIX") or DEFAULT_S3_PREFIX,
        region=config.get("S3_REGION") or "auto",
        endpoint_url=config.get("S3_ENDPOINT_URL"),
        access_key_id=access_key_id,
        secret_access_key=secret_access_key,
        public_base_url=public_base_url,
        addressing_style=config.get("S3_ADDRESSING_STYLE") or "path",
    )


def build_storage(config) -> StorageBackend:
    """Instantiate the backend described by a Flask config mapping."""
    backend = str(config.get("UPLOAD_STORAGE") or LOCAL).lower()
    if backend == LOCAL:
        return LocalStorage(
            folder=config.get("UPLOAD_FOLDER")
            or os.path.join(tempfile.gettempdir(), "campus-market", "uploads"),
            public_prefix=config.get("PUBLIC_UPLOAD_PREFIX") or DEFAULT_PUBLIC_PREFIX,
            persistent=bool(config.get("UPLOAD_STORAGE_PERSISTENT", True)),
        )
    if backend == S3:
        return _build_s3(config)
    return UnavailableStorage(
        backend,
        f"UPLOAD_STORAGE='{backend}' is not supported – use 'local' or 's3'.",
    )


def _signature(config) -> tuple:
    """Configuration fingerprint – changing it rebuilds the backend."""
    return tuple(str(config.get(key)) for key in _SIGNATURE_KEYS)


def get_storage(app) -> StorageBackend:
    """Return the upload backend for ``app`` (built once, then cached)."""
    entry = app.extensions.get(_EXTENSION_KEY)
    if entry and entry.get("pinned"):
        return entry["storage"]

    signature = _signature(app.config)
    if entry and entry["signature"] == signature:
        return entry["storage"]

    storage = build_storage(app.config)
    app.extensions[_EXTENSION_KEY] = {"signature": signature, "storage": storage}
    return storage


def set_storage(app, storage: StorageBackend) -> None:
    """Pin an explicit backend (used by tests to inject a fake S3 client)."""
    app.extensions[_EXTENSION_KEY] = {
        "signature": _signature(app.config),
        "storage": storage,
        "pinned": True,
    }
