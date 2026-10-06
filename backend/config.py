"""
Application configuration.

Environment variables (optionally loaded from ``backend/.env`` or the
repository-root ``.env``) override every default, so the same code runs in
development (SQLite + local disk) and in production (managed PostgreSQL with
S3-compatible object storage).

Production example – see ``docs/DEPLOYMENT.md`` for the full Vercel walkthrough::

    export FLASK_ENV=production
    export DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
    export SECRET_KEY="a-long-random-secret"
    export JWT_SECRET="a-different-long-random-secret"
    export UPLOAD_STORAGE=s3
    export S3_BUCKET="campus-market"
    export S3_ENDPOINT_URL="https://<account>.r2.cloudflarestorage.com"
    export S3_ACCESS_KEY_ID="..."
    export S3_SECRET_ACCESS_KEY="..."
    export S3_PUBLIC_BASE_URL="https://pub-<hash>.r2.dev"
"""

import os
import tempfile
from datetime import timedelta

#: Filesystem locations, shared by every configuration class.
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, os.pardir))

#: Development-only fallbacks – a public deployment must set real secrets.
DEV_SECRET_KEY = "campus-market-dev-secret-change-me"
DEV_JWT_SECRET = "campus-market-jwt-secret-change-me"

#: Accepted values for ``UPLOAD_STORAGE``.
UPLOAD_BACKENDS = ("local", "s3")

#: ``users.phone`` is NOT NULL, so ``create-admin`` needs a value. This number
#: is only used for contact details and can be replaced in the profile.
DEFAULT_ADMIN_PHONE = "08030000000"

#: Vercel rejects request bodies larger than 4.5 MB before Flask sees them.
VERCEL_MAX_UPLOAD_MB = 4


def _str_env(name: str, env=None) -> str | None:
    """Return a stripped environment variable, treating ``""`` as "not set"."""
    raw = (os.environ if env is None else env).get(name)
    if raw is None:
        return None
    raw = str(raw).strip()
    return raw or None


def _bool_env(name: str, default: bool = False, env=None) -> bool:
    """Read a truthy/falsy environment variable."""
    raw = _str_env(name, env)
    if raw is None:
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def running_on_vercel(env=None) -> bool:
    """Vercel sets ``VERCEL=1`` for both build steps and function runtimes."""
    return bool(_str_env("VERCEL", env))


def normalize_database_url(url: str | None) -> str | None:
    """Rewrite legacy / driver-less URLs into one SQLAlchemy can load.

    ``postgres://`` (Heroku-style) and a bare ``postgresql://`` both default to
    the psycopg2 driver, which is not installed – this project ships psycopg 3
    (``postgresql+psycopg://``). ``mysql://`` is the equivalent legacy alias.
    """
    if not url:
        return url
    url = url.strip()
    for prefix, replacement in (
        ("postgres://", "postgresql+psycopg://"),
        ("postgresql://", "postgresql+psycopg://"),
        ("mysql://", "mysql+pymysql://"),
    ):
        if url.startswith(prefix):
            return replacement + url[len(prefix):]
    return url


def engine_options(uri: str | None) -> dict:
    """Connection-pool settings appropriate for ``uri``.

    Serverless platforms keep function instances warm between requests, so
    pooled connections can go stale – ``pool_pre_ping`` revalidates them and
    the short ``pool_recycle`` avoids idle-timeout surprises with managed
    databases.
    """
    if not uri or uri.startswith("sqlite"):
        return {}
    options = {"pool_pre_ping": True, "pool_recycle": 280}
    if uri.startswith("postgresql"):
        # Fail fast instead of hanging a request when the database is asleep.
        options["connect_args"] = {"connect_timeout": 10}
    return options


def resolve_upload_folder(env=None) -> str:
    """Directory used by the ``local`` upload backend."""
    explicit = _str_env("UPLOAD_FOLDER", env)
    if explicit:
        return explicit
    if running_on_vercel(env):
        # Only /tmp is writable inside a Vercel Function, and it is wiped
        # between invocations – set UPLOAD_STORAGE=s3 for real persistence.
        return os.path.join(tempfile.gettempdir(), "campus-market", "uploads")
    return os.path.join(PROJECT_ROOT, "frontend", "assets", "uploads")


def resolve_upload_storage(env=None) -> str:
    """Return the configured upload backend (``local`` by default)."""
    return (_str_env("UPLOAD_STORAGE", env) or "local").lower()


def upload_storage_is_persistent(backend: str | None = None, env=None) -> bool:
    """True when uploaded images survive a restart or redeploy."""
    backend = backend or resolve_upload_storage(env)
    if backend == "s3":
        return True
    return not running_on_vercel(env)


def resolve_max_upload_mb(env=None) -> int:
    """Upload size limit in MB, clamped to what the platform accepts."""
    default = VERCEL_MAX_UPLOAD_MB if running_on_vercel(env) else 5
    try:
        value = int(_str_env("MAX_UPLOAD_MB", env) or default)
    except (TypeError, ValueError):
        value = default
    if running_on_vercel(env):
        value = min(value, VERCEL_MAX_UPLOAD_MB)
    return max(1, value)


def secret_warnings(env=None) -> list:
    """Configuration problems that must be fixed before a public deployment."""
    warnings = []
    if not _str_env("SECRET_KEY", env):
        warnings.append(
            "SECRET_KEY is not set – Flask is signing sessions with the insecure "
            "development default."
        )
    if not (_str_env("JWT_SECRET", env) or _str_env("JWT_SECRET_KEY", env)):
        warnings.append(
            "JWT_SECRET is not set – login tokens are signed with the insecure "
            "development default."
        )
    return warnings


class Config:
    """Base configuration shared by every environment."""

    # --- Core ---------------------------------------------------------------
    BASE_DIR = BASE_DIR
    PROJECT_ROOT = PROJECT_ROOT
    RUNNING_ON_VERCEL = running_on_vercel()

    SECRET_KEY = _str_env("SECRET_KEY") or DEV_SECRET_KEY
    JSON_SORT_KEYS = False
    PROPAGATE_EXCEPTIONS = False

    # --- Database -----------------------------------------------------------
    # SQLite for development, PostgreSQL (or MySQL) in production.
    SQLALCHEMY_DATABASE_URI = normalize_database_url(
        _str_env("DATABASE_URL") or "sqlite:///" + os.path.join(BASE_DIR, "database.db")
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Pool settings keep connections healthy on serverless platforms.
    SQLALCHEMY_ENGINE_OPTIONS = engine_options(SQLALCHEMY_DATABASE_URI)

    # --- JWT ----------------------------------------------------------------
    # ``JWT_SECRET`` is the name configured on Vercel; ``JWT_SECRET_KEY`` is the
    # historical Flask-JWT-Extended name and is still honoured.
    JWT_SECRET_KEY = (
        _str_env("JWT_SECRET") or _str_env("JWT_SECRET_KEY") or DEV_JWT_SECRET
    )
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        hours=int(_str_env("JWT_ACCESS_HOURS") or 24)
    )
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(
        days=int(_str_env("JWT_REFRESH_DAYS") or 30)
    )
    JWT_ERROR_MESSAGE_KEY = "message"
    # Allow the frontend to send "Authorization: Bearer <token>".
    JWT_TOKEN_LOCATION = ["headers"]

    # --- Uploads ------------------------------------------------------------
    #: URL prefix returned for images served by the local backend.
    PUBLIC_UPLOAD_PREFIX = "assets/uploads"
    #: "local" (disk) or "s3" (any S3-compatible bucket).
    UPLOAD_STORAGE = resolve_upload_storage()
    #: False when uploads land on an ephemeral filesystem (Vercel + local).
    UPLOAD_STORAGE_PERSISTENT = upload_storage_is_persistent(UPLOAD_STORAGE)
    UPLOAD_FOLDER = resolve_upload_folder()
    MAX_CONTENT_LENGTH = resolve_max_upload_mb() * 1024 * 1024
    ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

    # --- S3-compatible object storage (used when UPLOAD_STORAGE=s3) ---------
    S3_BUCKET = _str_env("S3_BUCKET")
    # Cloudflare R2 and MinIO use "auto"; AWS uses the bucket's real region.
    S3_REGION = _str_env("S3_REGION") or "auto"
    # Required for R2/MinIO; leave empty for plain AWS S3.
    S3_ENDPOINT_URL = _str_env("S3_ENDPOINT_URL")
    S3_ACCESS_KEY_ID = _str_env("S3_ACCESS_KEY_ID")
    S3_SECRET_ACCESS_KEY = _str_env("S3_SECRET_ACCESS_KEY")
    # Key prefix inside the bucket, e.g. "uploads/u3_1699999_ab12.png".
    S3_PREFIX = _str_env("S3_PREFIX") or "uploads"
    # Public read base URL of the bucket, e.g. https://pub-<hash>.r2.dev
    # (Cloudflare R2) or https://cdn.example.com (custom domain).
    S3_PUBLIC_BASE_URL = _str_env("S3_PUBLIC_BASE_URL")
    # "path" works with every S3-compatible provider; use "virtual" on AWS.
    S3_ADDRESSING_STYLE = (_str_env("S3_ADDRESSING_STYLE") or "path").lower()

    # --- Pagination ---------------------------------------------------------
    DEFAULT_PAGE_SIZE = 12
    MAX_PAGE_SIZE = 48

    # --- CORS ---------------------------------------------------------------
    # "*" is fine while the API and frontend share one origin; tighten it when
    # they are hosted separately.
    CORS_ORIGINS = _str_env("CORS_ORIGINS") or "*"

    # --- Moderation ---------------------------------------------------------
    # Every student listing starts as "pending" until an admin reviews it.
    AUTO_PUBLISH = _bool_env("AUTO_PUBLISH", False)


class DevelopmentConfig(Config):
    """Local development – verbose errors and auto-reload friendly."""

    DEBUG = True
    ENV = "development"


class TestingConfig(Config):
    """Isolated config used by the automated test-suite.

    Uploads always use the local filesystem and a throwaway SQLite database, so
    the tests never touch the network, ``database.db`` or a real bucket.
    """

    TESTING = True
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_ENGINE_OPTIONS = {}
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    WTF_CSRF_ENABLED = False
    SECRET_KEY = "campus-market-test-secret"
    JWT_SECRET_KEY = "campus-market-test-jwt-secret"
    UPLOAD_STORAGE = "local"
    UPLOAD_STORAGE_PERSISTENT = True
    UPLOAD_FOLDER = os.path.join(PROJECT_ROOT, "frontend", "assets", "uploads")
    S3_BUCKET = None
    S3_PUBLIC_BASE_URL = None


class ProductionConfig(Config):
    """Production – debug disabled, PostgreSQL and object storage recommended."""

    DEBUG = False
    ENV = "production"


#: Map FLASK_ENV / APP_ENV values to configuration classes.
CONFIG_MAP = {
    "development": DevelopmentConfig,
    "dev": DevelopmentConfig,
    "testing": TestingConfig,
    "test": TestingConfig,
    "production": ProductionConfig,
    "prod": ProductionConfig,
}


def get_config(env: str | None = None):
    """Return the configuration class for ``env`` (defaults to development)."""
    env = (env or os.getenv("FLASK_ENV") or os.getenv("APP_ENV") or "development").lower()
    return CONFIG_MAP.get(env, DevelopmentConfig)
