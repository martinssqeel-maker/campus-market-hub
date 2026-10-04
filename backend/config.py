"""
Application configuration.

Environment variables (optionally loaded from ``backend/.env``) override every
default, so the same code runs in development (SQLite) and production (MySQL).

Example production setup::

    export FLASK_ENV=production
    export DATABASE_URL="mysql+pymysql://user:pass@localhost/campus_market"
    export JWT_SECRET_KEY="a-long-random-secret"
"""

import os
from datetime import timedelta


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
    # SQLite for development, MySQL/PostgreSQL in production via DATABASE_URL.
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        "sqlite:///" + os.path.join(BASE_DIR, "database.db"),
    )
    # ``mysql://`` is a legacy alias that SQLAlchemy 2.x rejects – normalise it.
    if SQLALCHEMY_DATABASE_URI.startswith("mysql://"):
        SQLALCHEMY_DATABASE_URI = SQLALCHEMY_DATABASE_URI.replace(
            "mysql://", "mysql+pymysql://", 1
        )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Pool settings keep MySQL connections healthy after long idle periods.
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
        "pool_recycle": 280,
    }

    # --- JWT ----------------------------------------------------------------
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "campus-market-jwt-secret-change-me")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(
        hours=int(os.getenv("JWT_ACCESS_HOURS", "24"))
    )
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(
        days=int(os.getenv("JWT_REFRESH_DAYS", "30"))
    )
    JWT_ERROR_MESSAGE_KEY = "message"
    # Allow the frontend to send "Authorization: Bearer <token>".
    JWT_TOKEN_LOCATION = ["headers"]

    # --- Uploads ------------------------------------------------------------
    UPLOAD_FOLDER = os.getenv(
        "UPLOAD_FOLDER", os.path.join(PROJECT_ROOT, "frontend", "assets", "uploads")
    )
    MAX_CONTENT_LENGTH = int(os.getenv("MAX_UPLOAD_MB", "5")) * 1024 * 1024
    ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

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
    SQLALCHEMY_ENGINE_OPTIONS = {}
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
