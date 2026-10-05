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

What the browser is *shown* is decided separately, by ``display_url``:

* a bucket that really is public (its own CDN domain) is linked directly, and
* anything else – a private Supabase bucket, a base URL that points at the
  authenticated S3 API, no CDN domain at all – is linked through the
  same-origin ``/api/uploads/view/…`` route, which streams the object using
  the server's credentials.

That distinction is the whole reason images used to upload fine and still show
up as broken thumbnails: the file was in the bucket, but the URL handed to the
browser needed a signature the browser cannot produce.
"""

import mimetypes
import os
import posixpath
import re
import tempfile
from urllib.parse import unquote, urlsplit

from werkzeug.utils import secure_filename

#: Backend identifiers used by ``UPLOAD_STORAGE``.
LOCAL = "local"
S3 = "s3"

DEFAULT_S3_PREFIX = "uploads"
DEFAULT_PUBLIC_PREFIX = "assets/uploads"
#: Browsers may cache an uploaded image for a week (the name is unique).
DEFAULT_CACHE_CONTROL = "public, max-age=604800"

#: How listing responses link to stored images (``UPLOAD_URL_MODE``).
URL_MODE_AUTO = "auto"
URL_MODE_PUBLIC = "public"
URL_MODE_PROXY = "proxy"
URL_MODES = (URL_MODE_AUTO, URL_MODE_PUBLIC, URL_MODE_PROXY)

#: Same-origin route that streams an object with server-side credentials.
#: ``routes/uploads.py`` serves it; ``image_urls`` below links to it.
VIEW_ROUTE = "/api/uploads/view"

#: Supabase Storage exposes a bucket twice, under two *very* different URLs:
#: ``/storage/v1/s3`` is the S3 API (every request must be signed) while
#: ``/storage/v1/object/public`` is the anonymous read URL.  Pasting the S3
#: endpoint into ``S3_PUBLIC_BASE_URL`` – which is what the "it works like any
#: S3 bucket" advice implies – uploads succeed but no browser can load the
#: result, so the value is corrected instead of trusted.
SUPABASE_S3_API_PATH = "/storage/v1/s3"
SUPABASE_PUBLIC_PATH = "/storage/v1/object/public"
_SUPABASE_HOST_RE = re.compile(r"^[a-z0-9][a-z0-9-]*\.supabase\.co$", re.IGNORECASE)

#: Uploaded files are named ``u<user id>_<unix ts>_<8 hex>.<ext>`` (see
#: ``routes/uploads.build_filename``).  Recognising that pattern is what makes
#: it possible to rescue an image URL that was truncated, signed or rewritten
#: by a proxy – the name alone is enough to find the object again.
UPLOAD_NAME_RE = re.compile(r"^u\d+_\d+_[0-9a-f]{6,32}\.[A-Za-z0-9]{2,5}$", re.IGNORECASE)

#: Only image files are ever served back out of the bucket.
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

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
    "UPLOAD_URL_MODE",
)


class StorageError(RuntimeError):
    """Raised when upload storage is misconfigured or unavailable."""


class InvalidReferenceError(StorageError):
    """The value handed to the storage layer is not a servable upload.

    Distinct from :class:`StorageError` so the public view route can answer
    "no such image" instead of "storage is broken" for a bad path.
    """


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
# URL plumbing – what a <img src> can actually load
# ---------------------------------------------------------------------------
def _url_origin(url: str) -> str:
    """``scheme://host[:port]`` of an absolute URL, lower-cased (``""`` if not)."""
    try:
        parsed = urlsplit(str(url))
    except ValueError:
        return ""
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def _url_path(url: str) -> str:
    """Path of an absolute URL (``""`` when it is not one)."""
    try:
        return urlsplit(str(url)).path or ""
    except ValueError:
        return ""


def is_supabase_url(url: str | None) -> bool:
    """True for ``https://<project-ref>.supabase.co/…`` URLs."""
    origin = _url_origin(url or "")
    if not origin:
        return False
    host = origin.split("//", 1)[1].split("@")[-1].split(":")[0]
    return bool(_SUPABASE_HOST_RE.match(host))


def supabase_public_base(url: str | None, bucket: str | None) -> str | None:
    """Canonical anonymous-read base for a Supabase bucket, or ``None``.

    Accepts either flavour of a Supabase URL (the signed S3 endpoint or the
    public object path) and always returns
    ``https://<ref>.supabase.co/storage/v1/object/public/<bucket>`` – which is
    what a browser may request *provided the bucket is public*.
    """
    if not url or not bucket or not is_supabase_url(url):
        return None
    origin = _url_origin(url)
    path = _url_path(url).rstrip("/")
    for marker in (SUPABASE_S3_API_PATH, SUPABASE_PUBLIC_PATH):
        if path.lower().startswith(marker):
            # Anything after the marker is the bucket (and maybe a key); the
            # configured bucket always wins, since that is where we write.
            return f"{origin}{SUPABASE_PUBLIC_PATH}/{bucket.strip('/')}"
    return None


def normalize_public_base(base: str | None, endpoint: str | None, bucket: str | None):
    """Return ``(browser_safe_public_base | None, notice | None)``.

    The notice is shown by ``/api/health`` so a misconfiguration is explained
    instead of being silently swallowed.  ``None`` as the first element means
    "link images through ``/api/uploads/view`` instead".
    """
    raw = (base or "").strip().rstrip("/")
    bucket = (bucket or "").strip("/")

    if not raw:
        derived = supabase_public_base(endpoint, bucket)
        if derived:
            return derived, (
                "S3_PUBLIC_BASE_URL was not set, so it was derived from "
                "S3_ENDPOINT_URL as the Supabase public object URL. Leave the "
                "bucket private and this app serves images through "
                f"{VIEW_ROUTE} instead – both work."
            )
        return None, None

    if is_supabase_url(raw):
        corrected = supabase_public_base(raw, bucket)
        if corrected and corrected != raw:
            return corrected, (
                "S3_PUBLIC_BASE_URL pointed at Supabase's signed S3 endpoint "
                f"('{raw}'). Browsers cannot load those URLs, so listing images "
                f"now use '{corrected}'. If the bucket is private, clear "
                "S3_PUBLIC_BASE_URL (or set UPLOAD_URL_MODE=proxy) to serve "
                "images through the API instead."
            )
        return raw, None

    # A base on the same origin as the S3 API endpoint is an authenticated
    # endpoint (e.g. https://<account>.r2.cloudflarestorage.com/<bucket>), not
    # a public domain – the CDN/custom-domain URL is what belongs here.
    if endpoint and _url_origin(raw) == _url_origin(endpoint):
        return None, (
            f"S3_PUBLIC_BASE_URL ('{raw}') is the same origin as S3_ENDPOINT_URL, "
            "which requires a signature. Images are served through "
            f"{VIEW_ROUTE} instead; set S3_PUBLIC_BASE_URL to the bucket's public "
            "domain (for Cloudflare R2: https://pub-<hash>.r2.dev) to link the "
            "bucket directly."
        )
    return raw, None


def clean_object_key(value: str) -> str | None:
    """Normalise a bucket-relative path, refusing traversal and non-images.

    ``None`` means "this is not a path we are willing to serve".
    """
    text = unquote(str(value or "")).strip().lstrip("/")
    if not text or "\x00" in text:
        return None
    text = posixpath.normpath(text)
    if text.startswith("..") or "/" in text[:2] or text in (".", "/"):
        return None
    extension = text.rsplit(".", 1)[-1].lower() if "." in text else ""
    if extension not in IMAGE_EXTENSIONS:
        return None
    return text


def key_to_view_url(reference: str) -> str:
    """Same-origin proxy URL for an object key or upload filename."""
    return f"{VIEW_ROUTE}/{reference.lstrip('/')}"


def _active_storage():
    """Backend for the current app, or ``None`` outside a request (CLI, seeds)."""
    from flask import current_app, has_app_context

    if not has_app_context():
        return None
    try:
        return get_storage(current_app)
    except Exception:                                # pragma: no cover - defensive
        return None


def image_urls(value) -> dict:
    """Display URLs for a stored image reference.

    Returns ``{"image_url": …, "image_fallback_url": …}``: the first is what the
    listing renders, the second the same-origin route that streams the file
    with server-side credentials.  A private bucket, a moved CDN domain or a
    URL saved by an older release therefore still shows a picture instead of
    an empty tile.

    Resolution happens on every response rather than at write time, so fixing
    the storage configuration also fixes every existing listing – no data
    migration required.
    """
    result = {"image_url": None, "image_fallback_url": None}
    text = str(value if value is not None else "").strip()
    if not text:
        return result

    storage = _active_storage()
    if storage is None or not hasattr(storage, "display_url"):
        result["image_url"] = text            # CLI / seeds: hand back the token
        return result

    try:
        result["image_url"] = storage.display_url(text)
    except StorageError:
        result["image_url"] = text
    if result["image_url"] != text:
        try:
            result["image_fallback_url"] = storage.proxy_url(text)
        except StorageError:                   # pragma: no cover - defensive
            result["image_fallback_url"] = None
    return result


def image_url(value) -> str | None:
    """The displayable URL alone (for nested payloads such as seller cards)."""
    return image_urls(value)["image_url"]



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

    # -- reading images back out -------------------------------------------
    #: Reference stored in the database (bare name for local, key for S3).
    def reference_for(self, filename: str) -> str:             # pragma: no cover
        raise NotImplementedError

    def owns(self, reference: str) -> bool:
        """True when this backend can re-resolve ``reference`` (see ``utils``)."""
        return False

    def display_url(self, reference: str) -> str:              # pragma: no cover
        """URL a browser can load for a stored reference."""
        raise NotImplementedError

    def proxy_url(self, reference: str) -> str:                # pragma: no cover
        """Same-origin ``/api/uploads/view`` URL for a stored reference."""
        return key_to_view_url(reference)

    def open_object(self, reference: str) -> dict:             # pragma: no cover
        """Return ``{"body": bytes, "content_type": str, "etag": str|None}``."""
        raise NotImplementedError


class LocalStorage(StorageBackend):
    """Write uploads to a directory on disk and serve them as static files."""

    backend = LOCAL

    def __init__(self, folder: str, public_prefix: str = DEFAULT_PUBLIC_PREFIX,
                 persistent: bool = True, url_mode: str = URL_MODE_AUTO):
        self.folder = folder
        self.public_prefix = (public_prefix or DEFAULT_PUBLIC_PREFIX).strip("/")
        self.persistent = persistent
        self.url_mode = (url_mode or URL_MODE_AUTO).lower()
        if self.url_mode not in URL_MODES:
            self.url_mode = URL_MODE_AUTO

    # -- helpers ------------------------------------------------------------
    def path_for(self, filename: str) -> str:
        """Absolute path for ``filename``, sandboxed inside ``self.folder``."""
        safe_name = secure_filename(filename or "")
        if not safe_name:
            raise InvalidReferenceError("Invalid file name")
        folder = os.path.abspath(self.folder)
        path = os.path.abspath(os.path.join(folder, safe_name))
        if os.path.dirname(path) != folder:
            raise InvalidReferenceError("Invalid file name")
        return path

    def url_for(self, filename: str) -> str:
        """Path the frontend can request, relative to the site root."""
        return f"{self.public_prefix}/{secure_filename(filename)}"

    # -- reading images back out -------------------------------------------
    def name_from_reference(self, reference: str) -> str:
        """Bare upload name for any reference the database may hold.

        Rows written by older releases stored the full relative path
        (``assets/uploads/x.png``) and a client may post back the URL it was
        handed, so all three shapes have to collapse to one name.
        """
        value = str(reference or "").strip()
        if "://" in value:
            value = unquote(_url_path(value))
        value = value.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
        safe_name = secure_filename(value)
        if not safe_name:
            raise InvalidReferenceError("Invalid file name")
        return safe_name

    def key_for_reference(self, reference: str) -> str:
        """Canonical stored form of a reference (the bare file name)."""
        return self.name_from_reference(reference)

    def reference_for(self, reference: str) -> str:
        """What belongs in the database for this upload.

        Idempotent, like the S3 backend: re-normalising a stored value (which
        happens every time a listing is edited) must not change it.
        """
        return self.name_from_reference(reference)

    def owns(self, reference: str) -> bool:
        """True for our own uploads only.

        ``image_url`` also carries static artwork and links pasted by admins
        (``assets/images/product-placeholder.svg``, a news article…) – those are
        already valid URLs and must be handed back untouched.
        """
        raw = str(reference or "").strip()
        if not raw:
            return False
        if "://" in raw:
            path = unquote(_url_path(raw))
            return f"/{self.public_prefix}/" in path or path.startswith(VIEW_ROUTE + "/")
        tail = raw.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
        if not UPLOAD_NAME_RE.match(tail):
            return False
        prefix = self.public_prefix + "/"
        return not raw.startswith("/") and (raw == tail or raw.startswith(prefix))

    def display_url(self, reference: str) -> str:
        if not self.owns(reference):
            return str(reference or "").strip()
        if self.url_mode == URL_MODE_PROXY:
            return self.proxy_url(reference)
        return self.url_for(self.name_from_reference(reference))

    def proxy_url(self, reference: str) -> str | None:
        if not self.owns(reference):
            return None
        return key_to_view_url(self.name_from_reference(reference))

    def open_object(self, reference: str) -> dict:
        path = self.path_for(self.name_from_reference(reference))
        if not os.path.isfile(path):
            raise FileNotFoundError(reference)
        with open(path, "rb") as handle:
            body = handle.read()
        return {
            "body": body,
            "content_type": mimetypes.guess_type(path)[0] or "application/octet-stream",
            "etag": None,
        }

    # -- API ----------------------------------------------------------------
    def save(self, file_storage, filename: str) -> dict:
        os.makedirs(self.folder, exist_ok=True)
        safe_name = secure_filename(filename)
        destination = self.path_for(safe_name)
        file_storage.save(destination)
        url = self.url_for(safe_name)
        return {
            "filename": safe_name,
            "reference": safe_name,
            "url": url,
            "absolute_url": "/" + url,
            "proxy_url": self.proxy_url(safe_name),
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
                    "reference": name,
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
            "url_mode": self.url_mode,
            "image_delivery": VIEW_ROUTE if self.url_mode == URL_MODE_PROXY else self.public_prefix,
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
        url_mode: str = URL_MODE_AUTO,
        client=None,
    ):
        self.bucket = bucket
        self.prefix = (prefix or "").strip("/")
        self.region = region or "auto"
        self.endpoint_url = endpoint_url or None
        self.access_key_id = access_key_id or None
        self.secret_access_key = secret_access_key or None
        self.addressing_style = (addressing_style or "path").lower()
        self.url_mode = (url_mode or URL_MODE_AUTO).lower()
        if self.url_mode not in URL_MODES:
            self.url_mode = URL_MODE_AUTO
        #: ``S3_PUBLIC_BASE_URL`` as configured, before the correction below.
        self.configured_public_base = (public_base_url or "").strip().rstrip("/")
        #: Base a browser may use anonymously – ``""`` when there is none.
        self.public_base_url, self.public_base_notice = normalize_public_base(
            self.configured_public_base, self.endpoint_url, self.bucket
        )
        self.public_base_url = self.public_base_url or ""
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
            raise InvalidReferenceError("Invalid file name")
        return f"{self.prefix}/{safe_name}" if self.prefix else safe_name

    def _path_of(self, reference: str) -> str:
        """Path portion of any reference (``assets/uploads/x.png``, a full URL…)."""
        value = str(reference or "").strip()
        if "://" in value:
            value = _url_path(value)
        value = unquote(value.split("?", 1)[0].split("#", 1)[0]).replace("\\", "/")
        if value.lstrip("/").lower().startswith(VIEW_ROUTE.lstrip("/").lower()):
            value = value.lstrip("/")[len(VIEW_ROUTE):]
        return value.strip("/")

    @staticmethod
    def _tail(reference: str) -> str:
        """Last path segment, with any query string removed (``?X-Amz-…``)."""
        value = unquote(str(reference or "").split("?")[0].split("#")[0])
        return value.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]

    def owns(self, reference: str) -> bool:
        """True when a reference clearly points at *this* bucket.

        Used before rewriting a value into a canonical key: an unrelated
        external URL (a link to someone else's CDN image) has to survive
        untouched, so guessing is not good enough here.  A presigned URL of our
        own object *is* ours, which is why the query string is dropped first.
        """
        raw = str(reference or "").strip()
        if not raw:
            return False
        tail = self._tail(raw)
        if "://" not in raw:
            return bool(UPLOAD_NAME_RE.match(tail))
        origins = {
            _url_origin(candidate)
            for candidate in (
                self.public_base_url,
                self.configured_public_base,
                self.endpoint_url,
                supabase_public_base(raw, self.bucket),
            )
            if candidate
        }
        if _url_origin(raw) in origins and _url_origin(raw):
            return True
        host = (_url_origin(raw).split("//")[-1] or "").split(":")[0]
        if self.bucket and host.startswith(f"{self.bucket.lower()}."):
            return True                                  # virtual-hosted style
        # Our upload names are unguessable and unique (`u<id>_<ts>_<rand>.png`),
        # so a matching tail is enough – the row may have been written before the
        # bucket was renamed, and re-deriving the key from *our* configuration is
        # precisely what heals those rows.  The host is never followed: the key is
        # read from this bucket, so a stale foreign URL cannot turn into a proxy.
        return bool(UPLOAD_NAME_RE.match(tail))

    def candidate_keys(self, reference: str) -> list:
        """Object keys this reference could plausibly mean, best guess first.

        Historical rows hold every shape this app has ever emitted – a bare
        name, ``assets/uploads/…``, a public CDN URL, a URL built from the
        *signed* S3 endpoint, or a presigned URL – so resolution follows the
        upload name (unique by construction) and keeps the real path as a
        fallback.
        """
        path = self._path_of(reference)
        if not path:
            raise InvalidReferenceError("Invalid image reference")
        tail = path.rsplit("/", 1)[-1]
        named = bool(UPLOAD_NAME_RE.match(tail))
        under_prefix = bool(self.prefix and path.startswith(f"{self.prefix}/"))
        if not named and not under_prefix:
            # Unknown naming that is not inside our upload folder: refuse to
            # serve it, so the view route cannot be pointed at random objects.
            raise InvalidReferenceError("Invalid image reference")

        keys = []
        if named:
            keys.append(f"{self.prefix}/{tail}" if self.prefix else tail)
        keys.append(path)
        if self.bucket and path.lower().startswith(f"{self.bucket.lower()}/"):
            keys.append(path[len(self.bucket) + 1:])
        if self.prefix and not under_prefix and "/" in path:
            keys.append(f"{self.prefix}/{tail}")

        cleaned, seen = [], set()
        for key in keys:
            candidate = clean_object_key(key)
            if candidate and candidate not in seen:
                seen.add(candidate)
                cleaned.append(candidate)
        if not cleaned:
            raise InvalidReferenceError("Invalid image reference")
        return cleaned

    def key_for_reference(self, reference: str) -> str:
        """Best single object key for a reference (used when storing)."""
        return self.candidate_keys(reference)[0]

    def reference_for(self, reference: str) -> str:
        """What belongs in the database: the object key, never a full URL.

        Idempotent on purpose – the same value is stored, read back and
        normalised again whenever a listing is edited.
        """
        return self.key_for_reference(reference)

    def url_for(self, key: str) -> str:
        """Absolute public URL for an object key."""
        if not self.public_base_url:
            raise StorageError(
                "S3_PUBLIC_BASE_URL is not set, so uploaded images cannot be linked. "
                "Set it to the bucket's public URL (for example "
                "https://pub-<hash>.r2.dev for Cloudflare R2)."
            )
        return f"{self.public_base_url}/{key.lstrip('/')}"

    def public_url(self, key: str) -> str | None:
        """Public URL when the bucket really is anonymously readable, else None."""
        if self.url_mode == URL_MODE_PROXY or not self.public_base_url:
            return None
        return self.url_for(key)

    def url_for_key(self, key: str) -> str:
        """URL for an object key this backend owns (no reference parsing)."""
        return self.public_url(key) or key_to_view_url(key)

    def display_url(self, reference: str) -> str:
        """URL a browser should use for a stored reference.

        In ``auto`` mode an object is linked through the bucket only when the
        configured public base is an anonymous-read URL; otherwise it goes
        through ``/api/uploads/view``, which signs the request with the
        credentials the browser never sees.  Either way this never raises.
        """
        if not self.owns(reference):
            # A link to somebody else's CDN (or static artwork) is not ours to
            # rewrite – pass it through so it keeps working exactly as before.
            return str(reference or "").strip()
        try:
            key = self.key_for_reference(reference)
        except StorageError:
            return str(reference or "").strip()
        if self.url_mode == URL_MODE_PUBLIC and self.configured_public_base:
            return f"{self.configured_public_base}/{key}"
        return self.public_url(key) or self.proxy_url(key)

    def proxy_url(self, reference: str) -> str | None:
        """Same-origin streaming URL, or ``None`` for a foreign reference."""
        if not self.owns(reference):
            return None
        try:
            return key_to_view_url(self.key_for_reference(reference))
        except StorageError:
            return None

    def signed_url(self, key: str, expires_in: int = 15 * 60) -> str:
        """Short-lived presigned GET URL for ``key`` (private buckets)."""
        try:
            return self.client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=expires_in,
            )
        except _S3_ERRORS as exc:
            raise StorageError(_friendly_s3_error(exc, self.bucket)) from exc

    def open_object(self, reference: str) -> dict:
        """Fetch the object behind a reference, trying every plausible key."""
        for key in self.candidate_keys(reference):   # strict: public endpoint
            try:
                response = self.client.get_object(Bucket=self.bucket, Key=key)
            except _S3_ERRORS as exc:
                if _is_not_found(exc):
                    continue
                raise StorageError(_friendly_s3_error(exc, self.bucket)) from exc
            body = response["Body"].read()
            return {
                "body": body,
                "content_type": response.get("ContentType")
                or mimetypes.guess_type(key)[0]
                or "application/octet-stream",
                "etag": (response.get("ETag") or "").strip('"') or None,
                "key": key,
            }
        raise FileNotFoundError(reference)

    def keys_to_try(self, filename: str) -> list:
        """Candidate keys for a read/delete, tolerant of unusual naming.

        ``candidate_keys`` is strict because it also guards the public
        ``/api/uploads/view`` route; deleting one of your own files has no such
        exposure, so a name that predates the current convention still resolves.
        """
        try:
            return self.candidate_keys(filename)
        except StorageError:
            return [self.key_for(filename)]

    def find_key(self, filename: str) -> str | None:
        """First candidate key that actually exists in the bucket."""
        for key in self.keys_to_try(filename):
            try:
                self.client.head_object(Bucket=self.bucket, Key=key)
                return key
            except _S3_ERRORS as exc:
                if _is_not_found(exc):
                    continue
                raise StorageError(_friendly_s3_error(exc, self.bucket)) from exc
        return None

    def exists(self, filename: str) -> bool:
        return self.find_key(filename) is not None

    def delete(self, filename: str) -> None:
        key = self.find_key(filename)
        if key is None:
            raise FileNotFoundError(filename)
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except _S3_ERRORS as exc:
            raise StorageError(_friendly_s3_error(exc, self.bucket)) from exc

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

        # ``reference`` is what the listing stores (a bucket-relative key that
        # keeps working when the public domain or the URL mode changes).
        public = self.public_url(key)
        url = self.url_for_key(key)
        return {
            "filename": secure_filename(filename),
            "reference": key,
            "key": key,
            "url": url,
            "absolute_url": url,
            "proxy_url": self.proxy_url(key),
            "public_url": public,
            "size_kb": round(len(body) / 1024, 1),
            "storage": self.backend,
        }

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
                "reference": str(row.get("Key", "")),
                "url": self.url_for_key(str(row.get("Key", ""))),
                "size_kb": round((row.get("Size") or 0) / 1024, 1),
            }
            for row in rows
        ]

    def describe(self) -> dict:
        info = {
            "backend": self.backend,
            "persistent": True,
            "bucket": self.bucket,
            "prefix": self.prefix,
            "endpoint": self.endpoint_url or "aws",
            "public_base_url": self.public_base_url or None,
            "url_mode": self.url_mode,
            "image_delivery": "bucket" if self.public_base_url else VIEW_ROUTE,
        }
        if self.public_base_notice:
            info["notice"] = self.public_base_notice
        return info


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

    def owns(self, reference: str) -> bool:
        return False

    def reference_for(self, filename: str) -> str:
        self._fail()

    def display_url(self, reference: str) -> str:
        self._fail()

    def open_object(self, reference: str) -> dict:
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
    """Validate S3 settings and build the backend (or explain what is missing).

    Only the bucket name is mandatory.  ``S3_PUBLIC_BASE_URL`` used to be too,
    which pushed people into pasting whatever URL their provider showed them –
    often the *signed* S3 endpoint, whose images no browser can load.  A
    missing public base now simply means images are served through
    ``/api/uploads/view`` with the server's credentials.
    """
    bucket = config.get("S3_BUCKET")
    public_base_url = config.get("S3_PUBLIC_BASE_URL")
    access_key_id = config.get("S3_ACCESS_KEY_ID")
    secret_access_key = config.get("S3_SECRET_ACCESS_KEY")
    url_mode = str(config.get("UPLOAD_URL_MODE") or URL_MODE_AUTO).lower()

    if not bucket:
        return UnavailableStorage(
            S3,
            "UPLOAD_STORAGE=s3 but S3_BUCKET is not set – uploads cannot be "
            "stored until it is configured.",
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
        url_mode=url_mode,
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
            url_mode=str(config.get("UPLOAD_URL_MODE") or URL_MODE_AUTO).lower(),
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
