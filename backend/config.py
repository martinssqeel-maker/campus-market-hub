"""Application configuration for Campus Marketplace."""
import os
from datetime import timedelta
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
INSTANCE_DIR = ROOT_DIR / "instance"


class Config:
    """Defaults suitable for local development; use environment variables in production."""

    SECRET_KEY = os.getenv("SECRET_KEY", "development-only-change-this-secret")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", SECRET_KEY)
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=int(os.getenv("JWT_ACCESS_TOKEN_HOURS", "12")))
    JWT_TOKEN_LOCATION = ("headers",)
    JWT_HEADER_TYPE = "Bearer"

    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{(INSTANCE_DIR / 'campus_marketplace.db').as_posix()}",
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", str(INSTANCE_DIR / "uploads"))
    MAX_CONTENT_LENGTH = 8 * 1024 * 1024  # request cap; individual images are capped at 5 MiB
    MAX_IMAGE_BYTES = 5 * 1024 * 1024
    CORS_ORIGINS = tuple(origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip())

    JSON_SORT_KEYS = False
    BCRYPT_LOG_ROUNDS = int(os.getenv("BCRYPT_LOG_ROUNDS", "12"))
    BCRYPT_HANDLE_LONG_PASSWORDS = True
