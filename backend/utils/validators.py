"""
Input validation helpers.

Every public endpoint validates its payload before touching the database –
this is the single defence against bad data, XSS-ish junk and oversized input.
"""

import re

from werkzeug.utils import secure_filename

from config import Config

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
# Nigerian phone numbers: 0703…, +234703…, 0803…, 0813… etc.
PHONE_RE = re.compile(r"^(\+?234|0)[789][01]\d{8}$")
ALLOWED_USER_TYPES = {"student", "landlord", "service_provider"}


class ValidationError(Exception):
    """Raised when a payload fails validation (turned into HTTP 422)."""

    def __init__(self, message: str, errors: dict | None = None):
        super().__init__(message)
        self.message = message
        self.errors = errors or {}


# ---------------------------------------------------------------------------
# Field level checks
# ---------------------------------------------------------------------------
def clean_text(value, max_length: int = 5000) -> str:
    """Trim, normalise whitespace and hard-cap length (basic XSS hygiene)."""
    if value is None:
        return ""
    text = str(value).strip()
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)   # strip control chars
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text[:max_length]


def validate_email(email: str) -> str:
    """Return a normalised email address or raise ``ValidationError``."""
    email = (email or "").strip().lower()
    if not email or not EMAIL_RE.match(email):
        raise ValidationError("Please enter a valid email address", {"email": "Invalid email"})
    if len(email) > 160:
        raise ValidationError("Email address is too long", {"email": "Too long"})
    return email


def validate_phone(phone: str) -> str:
    """Validate a Nigerian mobile number and return a canonical local form."""
    phone = re.sub(r"[\s\-()]", "", (phone or "").strip())
    if not phone:
        raise ValidationError("Phone number is required", {"phone": "Required"})
    if not PHONE_RE.match(phone):
        raise ValidationError(
            "Enter a valid Nigerian phone number, e.g. 08031234567",
            {"phone": "Invalid phone number"},
        )
    if phone.startswith("+234"):
        phone = "0" + phone[4:]
    elif phone.startswith("234"):
        phone = "0" + phone[3:]
    return phone


def validate_password(password: str) -> str:
    """Enforce a minimum-strength password (length + letters + digits)."""
    if not password or len(password) < 6:
        raise ValidationError(
            "Password must be at least 6 characters", {"password": "Too short"}
        )
    if len(password) > 128:
        raise ValidationError("Password is too long", {"password": "Too long"})
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise ValidationError(
            "Password must contain at least one letter and one number",
            {"password": "Too weak"},
        )
    return password


def validate_user_type(user_type: str) -> str:
    """Only students, landlords and service providers may self-register."""
    user_type = (user_type or "student").strip().lower()
    if user_type not in ALLOWED_USER_TYPES:
        raise ValidationError(
            "user_type must be student, landlord or service_provider",
            {"user_type": "Invalid account type"},
        )
    return user_type


def validate_rating(rating) -> int:
    """Ratings are whole numbers from 1 to 5."""
    try:
        value = int(rating)
    except (TypeError, ValueError):
        raise ValidationError("Rating must be a number between 1 and 5", {"rating": "Invalid"})
    if not 1 <= value <= 5:
        raise ValidationError("Rating must be between 1 and 5", {"rating": "Out of range"})
    return value


def validate_price(price, required: bool = False, allow_zero: bool = True) -> float:
    """Coerce a price to a non-negative float."""
    if price in (None, ""):
        if required:
            raise ValidationError("Price is required", {"price": "Required"})
        return 0.0
    try:
        value = float(str(price).replace(",", "").strip())
    except (TypeError, ValueError):
        raise ValidationError("Price must be a number", {"price": "Invalid amount"})
    if value < 0:
        raise ValidationError("Price cannot be negative", {"price": "Negative"})
    if value == 0 and not allow_zero:
        raise ValidationError("Price must be greater than zero", {"price": "Zero"})
    if value > 100_000_000:
        raise ValidationError("Price looks unrealistic", {"price": "Too large"})
    return round(value, 2)


def validate_required(payload: dict, required_fields: dict) -> dict:
    """
    Check a set of required fields.

    ``required_fields`` maps ``field -> label``; raises a single
    ``ValidationError`` listing every missing field at once so the UI can
    highlight all of them in one pass.
    """
    missing = {}
    for field, label in required_fields.items():
        value = payload.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing[field] = f"{label} is required"
    if missing:
        raise ValidationError("Please fill in all required fields", missing)
    return payload


def validate_listing_payload(payload: dict, kind: str = "product") -> dict:
    """
    Validate and normalise a listing payload (product / accommodation /
    event / service).  Each kind needs slightly different required fields,
    so the rules live in one table instead of scattered if-statements.
    """
    rules = {
        "product": {"title": "Title", "description": "Description", "price": "Price"},
        "accommodation": {"title": "Title", "location": "Location", "price": "Price"},
        "event": {"title": "Title", "description": "Description", "date": "Date"},
        "service": {"title": "Title", "price": "Price"},
    }
    validate_required(payload, rules.get(kind, {"title": "Title"}))

    cleaned = {**payload}
    cleaned["title"] = clean_text(payload.get("title"), 160)
    if "description" in payload:
        cleaned["description"] = clean_text(payload.get("description"), 4000)
    if len(cleaned["title"]) < 3:
        raise ValidationError("Title is too short", {"title": "At least 3 characters"})
    if "description" in cleaned and cleaned["description"] and len(cleaned["description"]) < 10:
        raise ValidationError(
            "Description is too short – add a bit more detail",
            {"description": "At least 10 characters"},
        )
    if "price" in payload or kind in {"product", "accommodation", "service"}:
        cleaned["price"] = validate_price(payload.get("price"), required=(kind != "event"))
    if "location" in payload:
        cleaned["location"] = clean_text(payload.get("location"), 160) or "UNILAFIA Campus"
    return cleaned


def validate_image_file(filename: str) -> str:
    """Return a safe filename for an uploaded image or raise ``ValidationError``."""
    if not filename:
        raise ValidationError("No file selected")
    safe_name = secure_filename(filename)
    if "." not in safe_name:
        raise ValidationError("File must have an extension (jpg, png…)")
    extension = safe_name.rsplit(".", 1)[1].lower()
    if extension not in Config.ALLOWED_IMAGE_EXTENSIONS:
        allowed = ", ".join(sorted(Config.ALLOWED_IMAGE_EXTENSIONS))
        raise ValidationError(f"Unsupported image type. Allowed: {allowed}")
    return safe_name
