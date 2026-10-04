"""
Application configuration.

Environment variables (optionally loaded from ``backend/.env``) override every
default, so the same code runs in development (SQLite, local upload folder)
and in production (PostgreSQL, S3-compatible image storage) – e.g. on Vercel.

Example production setup (Vercel)::

    export FLASK_ENV=production
    export DATABASE_URL="postgresql://user:pass@host:port/campus_market?sslmode=require"
    export SECRET_KEY="a-long-random-secret"
    export JWT_SECRET="a-different-long-random-secret"
    export UPLOAD_STORAGE=s3
    export S3_ENDPOINT_URL="https://<account>.r2.cloudflarestorage.com"
    export S3_BUCKET="campus-market-uploads"
    export S3_ACCESS_KEY_ID="…"
    export S3_SECRET_ACCESS_KEY="…"
    export S3_REGION="auto"
    export S3_PUBLIC_URL="https://pub-<bucket-id>.r2.dev"
"""

import os
from datetime import timedelta
from typing import ClassVar


def _bool_env(name: str, default: bool = False) -> bool:
    """Read a truthy/falsy environment variable."""
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    """Base configuration shared by every environment."""

    # --- Core ---------------------------------------------------------------
    BASE_DIR = os.path.abspath(os.path.dirname(__file__))
    PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, os.pardir))

    SECRET_KEY = os.getenv("SECRET_KEY", "campus-market-dev-secret-change-me")
    JSON_SORT_KEYS = False
    PROPAGATE_EXCEPTIONS = False

    # --- Database -----------------------------------------------------------
    # SQLite for development; PostgreSQL (Vercel / production) or MySQL via
    # DATABASE_URL.  ``postgresql://`` (the scheme Vercel Postgres displays)
    # is accepted as-is because SQLAlchemy maps it to the psycopg2 driver.
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        "sqlite:///" + os.path.join(BASE_DIR, "database.db"),
    )
    # Normalise legacy aliases that SQLAlchemy 2.x rejects.
    if SQLALCHEMY_DATABASE_URI.startswith("mysql://"):
        SQLALCHEMY_DATABASE_URI = SQLALCHEMY_DATABASE_URI.replace(
            "mysql://", "mysql+pymysql://", 1
        )
    elif SQLALCHEMY_DATABASE_URI.startswith("postgres://"):
        SQLALCHEMY_DATABASE_URI = SQLALCHEMY_DATABASE_URI.replace(
            "postgres://", "postgresql+psycopg2://", 1
        )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Pool settings keep long-lived connections healthy after idle periods
    # (matters for Vercel serverless, where a function may wake up minutes
    # after the previous request).
    SQLALCHEMY_ENGINE_OPTIONS: ClassVar[dict] = {
        "pool_pre_ping": True,
        "pool_recycle": 280,
    }

    # --- JWT ----------------------------------------------------------------
    # ``JWT_SECRET`` is the canonical name (matches the root .env.example);
    # ``JWT_SECRET_KEY`` is kept as a legacy alias for older .env files.
    JWT_SECRET_KEY = (
        os.getenv("JWT_SECRET")
        or os.getenv("JWT_SECRET_KEY")
        or "campus-market-jwt-secret-change-me"
    )
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        hours=int(os.getenv("JWT_ACCESS_HOURS", "24"))
    )
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(
        days=int(os.getenv("JWT_REFRESH_DAYS", "30"))
    )
    JWT_ERROR_MESSAGE_KEY = "message"
    # Allow the frontend to send "Authorization: Bearer <token>".
    JWT_TOKEN_LOCATION: ClassVar[list] = ["headers"]

    # --- Uploads ------------------------------------------------------------
    # UPLOAD_STORAGE selects the backend for uploaded images:
    #   local – files are written to UPLOAD_FOLDER on disk (development;
    #           Flask serves them from the static frontend folder)
    #   s3    – files go to any S3-compatible bucket (AWS S3, Cloudflare R2,
    #           MinIO, …).  Required on Vercel, where the filesystem is
    #           ephemeral and every request may run on a different machine.
    UPLOAD_STORAGE = os.getenv("UPLOAD_STORAGE", "local").strip().lower()
    UPLOAD_FOLDER = os.getenv(
        "UPLOAD_FOLDER", os.path.join(PROJECT_ROOT, "frontend", "assets", "uploads")
    )
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_UPLOAD_MB", "5")) * 1024 * 1024
    ALLOWED_IMAGE_EXTENSIONS: ClassVar[set] = {"png", "jpg", "jpeg", "gif", "webp"}

    # S3-compatible storage settings (only used when UPLOAD_STORAGE=s3).
    # R2 example:  S3_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com
    #              S3_REGION=auto   (R2 has a single global region)
    S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL")
    S3_BUCKET = os.getenv("S3_BUCKET")
    S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID")
    S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY")
    S3_REGION = os.getenv("S3_REGION", "auto")
    # Public base URL where the bucket's objects are readable, e.g.
    # https://pub-<bucket-id>.r2.dev (R2 "public bucket" URL).  The API
    # returns <S3_PUBLIC_URL>/<S3_KEY_PREFIX>/<filename> to the frontend.
    S3_PUBLIC_URL = os.getenv("S3_PUBLIC_URL")
    S3_KEY_PREFIX = os.getenv("S3_KEY_PREFIX", "uploads")

    # --- Pagination ---------------------------------------------------------
    DEFAULT_PAGE_SIZE = 12
    MAX_PAGE_SIZE = 48

    # --- CORS ---------------------------------------------------------------
    # "*" is fine for this coursework project; tighten it for real deployments.
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")

    # --- Moderation ---------------------------------------------------------
    # Every student listing starts as "pending" until an admin reviews it.
    AUTO_PUBLISH = _bool_env("AUTO_PUBLISH", False)


class DevelopmentConfig(Config):
    """Local development – verbose errors and auto-reload friendly."""

    DEBUG = True
    ENV = "development"


class TestingConfig(Config):
    """Isolated config used by the automated test-suite."""

    TESTING = True
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_ENGINE_OPTIONS: ClassVar[dict] = {}
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    WTF_CSRF_ENABLED = False


class ProductionConfig(Config):
    """Production – stricter defaults, MySQL recommended."""

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
