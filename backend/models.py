"""
Database models for Campus Marketplace.

Tables
------
users            – students, landlords, service providers and admins
products         – marketplace items (books, electronics, hostel essentials…)
accommodation    – rooms / self-contains / hostels around UNILAFIA
events           – campus events and adverts
services         – student services (laundry, printing, barbing, tutoring…)
reviews          – ratings written *about* a user (seller / landlord reputation)
favorites        – wishlist rows (polymorphic: product | accommodation | event | service)
token_blocklist  – revoked JWTs so logout really invalidates a token

Every model exposes ``to_dict()`` so routes stay thin and responses consistent.
"""

from datetime import datetime, timezone

import bcrypt
from sqlalchemy import UniqueConstraint, func

from extensions import db
from storage import image_urls

#: Listing life-cycle: pending -> published -> (sold | rejected | removed)
LISTING_STATUSES = ("pending", "published", "rejected", "sold", "archived")
#: Accounts that may post on the platform.
USER_TYPES = ("student", "landlord", "service_provider", "admin")


def utcnow() -> datetime:
    """Timezone-aware UTC timestamp (SQLAlchemy-friendly)."""
    return datetime.now(timezone.utc)


def _hash_password(password: str) -> str:
    """Hash a password with bcrypt (sha256 pre-hash lifts the 72-byte limit)."""
    import hashlib

    digest = hashlib.sha256(password.encode("utf-8")).hexdigest().encode("utf-8")
    return bcrypt.hashpw(digest, bcrypt.gensalt(rounds=12)).decode("utf-8")


def _verify_password(password: str, password_hash: str) -> bool:
    """Check a plaintext password against a stored bcrypt hash."""
    import hashlib

    if not password_hash:
        return False
    digest = hashlib.sha256(password.encode("utf-8")).hexdigest().encode("utf-8")
    try:
        return bcrypt.checkpw(digest, password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def iso(value: datetime | None) -> str | None:
    """Serialise a datetime to an ISO-8601 string (or None)."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
class User(db.Model):
    """A registered account (student, landlord, service provider or admin)."""

    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(160), unique=True, nullable=False, index=True)
    phone = db.Column(db.String(20), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    user_type = db.Column(db.String(30), nullable=False, default="student")
    verified = db.Column(db.Boolean, nullable=False, default=False)  # admin-verified badge
    is_active = db.Column(db.Boolean, nullable=False, default=True)   # soft ban
    avatar_url = db.Column(db.String(1000))
    bio = db.Column(db.Text)
    department = db.Column(db.String(120))          # e.g. "Computer Science"
    level = db.Column(db.String(20))                # e.g. "200 Level"
    location = db.Column(db.String(160))            # e.g. "Lafia, Nasarawa"
    whatsapp = db.Column(db.String(20))             # optional separate WhatsApp number
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    # Relationships ---------------------------------------------------------
    products = db.relationship(
        "Product", backref="seller", lazy="dynamic", cascade="all, delete-orphan"
    )
    accommodations = db.relationship(
        "Accommodation", backref="landlord", lazy="dynamic", cascade="all, delete-orphan"
    )
    events = db.relationship(
        "Event", backref="creator", lazy="dynamic", cascade="all, delete-orphan"
    )
    services = db.relationship(
        "Service", backref="provider", lazy="dynamic", cascade="all, delete-orphan"
    )
    favorites = db.relationship(
        "Favorite", backref="user", lazy="dynamic", cascade="all, delete-orphan"
    )
    reviews_received = db.relationship(
        "Review",
        foreign_keys="Review.target_id",
        backref="target",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    reviews_written = db.relationship(
        "Review",
        foreign_keys="Review.author_id",
        backref="author",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    # Password helpers ------------------------------------------------------
    def set_password(self, password: str) -> None:
        self.password_hash = _hash_password(password)

    def check_password(self, password: str) -> bool:
        return _verify_password(password, self.password_hash)

    # Reputation ------------------------------------------------------------
    @property
    def rating_average(self) -> float | None:
        """Mean star rating received (None when the user has no reviews)."""
        total = self.reviews_received.with_entities(
            func.avg(Review.rating), func.count(Review.id)
        ).first()
        if not total or not total[1]:
            return None
        return round(float(total[0]), 1)

    @property
    def rating_count(self) -> int:
        return self.reviews_received.count()

    @property
    def is_admin(self) -> bool:
        return self.user_type == "admin"

    # Serialisation ---------------------------------------------------------
    def to_dict(self, include_private: bool = False) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "user_type": self.user_type,
            "verified": self.verified,
            "avatar_url": image_urls(self.avatar_url)["image_url"],
            "bio": self.bio,
            "department": self.department,
            "level": self.level,
            "location": self.location,
            "rating_average": self.rating_average,
            "rating_count": self.rating_count,
            "created_at": iso(self.created_at),
        }
        if include_private:
            # Email / phone are only exposed to the owner and to admins.
            data.update(
                {
                    "email": self.email,
                    "phone": self.phone,
                    "whatsapp": self.whatsapp or self.phone,
                    "is_active": self.is_active,
                }
            )
        return data


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------
class Product(db.Model):
    """A marketplace item posted by a student."""

    __tablename__ = "products"

    id = db.Column(db.Integer, primary_key=True)
    seller_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title = db.Column(db.String(160), nullable=False, index=True)
    description = db.Column(db.Text, nullable=False)
    price = db.Column(db.Float, nullable=False, default=0.0)
    image_url = db.Column(db.String(1000))
    category = db.Column(db.String(60), nullable=False, default="others", index=True)
    location = db.Column(db.String(160), default="UNILAFIA Campus")
    condition = db.Column(db.String(30), default="used")   # new | used | refurbished
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    views = db.Column(db.Integer, nullable=False, default=0)
    featured = db.Column(db.Boolean, nullable=False, default=False)
    rejection_reason = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (db.Index("ix_products_status_created", "status", "created_at"),)

    def to_dict(self, viewer=None) -> dict:
        images = image_urls(self.image_url)
        data = {
            "id": self.id,
            "type": "product",
            "title": self.title,
            "description": self.description,
            "price": self.price,
            "image_url": images["image_url"],
            "image_fallback_url": images["image_fallback_url"],
            "category": self.category,
            "location": self.location,
            "condition": self.condition,
            "status": self.status,
            "views": self.views,
            "featured": self.featured,
            "rejection_reason": self.rejection_reason,
            "created_at": iso(self.created_at),
            "seller_id": self.seller_id,
            "seller": {
                "id": self.seller.id,
                "name": self.seller.name,
                "verified": self.seller.verified,
                "rating_average": self.seller.rating_average,
                "rating_count": self.seller.rating_count,
            }
            if self.seller
            else None,
        }
        if viewer is not None:
            # Contact details only for logged-in users (protects sellers).
            data["seller"]["phone"] = self.seller.phone if self.seller else None
            data["seller"]["whatsapp"] = (
                (self.seller.whatsapp or self.seller.phone) if self.seller else None
            )
            data["seller"]["email"] = self.seller.email if self.seller else None
        return data


# ---------------------------------------------------------------------------
# Accommodation
# ---------------------------------------------------------------------------
class Accommodation(db.Model):
    """A room, self-contain, flat or hostel bed space near campus."""

    __tablename__ = "accommodation"

    id = db.Column(db.Integer, primary_key=True)
    landlord_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title = db.Column(db.String(160), nullable=False, index=True)
    description = db.Column(db.Text)
    location = db.Column(db.String(160), nullable=False, index=True)
    price = db.Column(db.Float, nullable=False, default=0.0)         # per year (₦)
    rooms = db.Column(db.Integer, nullable=False, default=1)          # bedrooms / spaces
    room_type = db.Column(db.String(40), nullable=False, default="single")  # single
    gender = db.Column(db.String(20), default="any")                  # male | female | any
    furnished = db.Column(db.Boolean, nullable=False, default=False)
    amenities = db.Column(db.String(300))                            # comma separated
    image_url = db.Column(db.String(1000))
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    views = db.Column(db.Integer, nullable=False, default=0)
    featured = db.Column(db.Boolean, nullable=False, default=False)
    rejection_reason = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    def to_dict(self, viewer=None) -> dict:
        images = image_urls(self.image_url)
        data = {
            "id": self.id,
            "type": "accommodation",
            "title": self.title,
            "description": self.description,
            "location": self.location,
            "price": self.price,
            "rooms": self.rooms,
            "room_type": self.room_type,
            "gender": self.gender,
            "furnished": self.furnished,
            "amenities": [a.strip() for a in (self.amenities or "").split(",") if a.strip()],
            "image_url": images["image_url"],
            "image_fallback_url": images["image_fallback_url"],
            "status": self.status,
            "views": self.views,
            "featured": self.featured,
            "rejection_reason": self.rejection_reason,
            "created_at": iso(self.created_at),
            "landlord_id": self.landlord_id,
            "landlord": {
                "id": self.landlord.id,
                "name": self.landlord.name,
                "verified": self.landlord.verified,
                "rating_average": self.landlord.rating_average,
                "rating_count": self.landlord.rating_count,
            }
            if self.landlord
            else None,
        }
        if viewer is not None and self.landlord:
            data["landlord"]["phone"] = self.landlord.phone
            data["landlord"]["whatsapp"] = self.landlord.whatsapp or self.landlord.phone
            data["landlord"]["email"] = self.landlord.email
        return data


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------
class Event(db.Model):
    """A campus event, advert or announcement."""

    __tablename__ = "events"

    id = db.Column(db.Integer, primary_key=True)
    creator_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title = db.Column(db.String(160), nullable=False, index=True)
    description = db.Column(db.Text, nullable=False)
    date = db.Column(db.DateTime, nullable=False, index=True)
    location = db.Column(db.String(160), nullable=False)
    category = db.Column(db.String(60), default="social", index=True)
    ticket_price = db.Column(db.Float, nullable=False, default=0.0)
    image_url = db.Column(db.String(1000))
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    views = db.Column(db.Integer, nullable=False, default=0)
    rejection_reason = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    def to_dict(self, viewer=None) -> dict:
        images = image_urls(self.image_url)
        return {
            "id": self.id,
            "type": "event",
            "title": self.title,
            "description": self.description,
            "date": iso(self.date),
            "location": self.location,
            "category": self.category,
            "ticket_price": self.ticket_price,
            "image_url": images["image_url"],
            "image_fallback_url": images["image_fallback_url"],
            "status": self.status,
            "views": self.views,
            "rejection_reason": self.rejection_reason,
            "created_at": iso(self.created_at),
            "creator_id": self.creator_id,
            "creator": {
                "id": self.creator.id,
                "name": self.creator.name,
                "verified": self.creator.verified,
            }
            if self.creator
            else None,
        }


# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------
class Service(db.Model):
    """A service offered to students (laundry, printing, tutoring, hair…)."""

    __tablename__ = "services"

    id = db.Column(db.Integer, primary_key=True)
    provider_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title = db.Column(db.String(160), nullable=False, index=True)
    description = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(60), default="others", index=True)
    price = db.Column(db.Float, nullable=False, default=0.0)
    price_unit = db.Column(db.String(40), default="per job")   # per job | per page | per hour
    location = db.Column(db.String(160), default="UNILAFIA Campus")
    image_url = db.Column(db.String(1000))
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    views = db.Column(db.Integer, nullable=False, default=0)
    rejection_reason = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    def to_dict(self, viewer=None) -> dict:
        images = image_urls(self.image_url)
        data = {
            "id": self.id,
            "type": "service",
            "title": self.title,
            "description": self.description,
            "category": self.category,
            "price": self.price,
            "price_unit": self.price_unit,
            "location": self.location,
            "image_url": images["image_url"],
            "image_fallback_url": images["image_fallback_url"],
            "status": self.status,
            "views": self.views,
            "rejection_reason": self.rejection_reason,
            "created_at": iso(self.created_at),
            "provider_id": self.provider_id,
            "provider": {
                "id": self.provider.id,
                "name": self.provider.name,
                "verified": self.provider.verified,
                "rating_average": self.provider.rating_average,
                "rating_count": self.provider.rating_count,
            }
            if self.provider
            else None,
        }
        if viewer is not None and self.provider:
            data["provider"]["phone"] = self.provider.phone
            data["provider"]["whatsapp"] = self.provider.whatsapp or self.provider.phone
        return data


# ---------------------------------------------------------------------------
# Reviews
# ---------------------------------------------------------------------------
class Review(db.Model):
    """A 1–5 star review written about a seller / landlord / provider."""

    __tablename__ = "reviews"

    id = db.Column(db.Integer, primary_key=True)
    author_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rating = db.Column(db.Integer, nullable=False, default=5)
    comment = db.Column(db.Text)
    listing_type = db.Column(db.String(30))   # optional context: product/…
    listing_id = db.Column(db.Integer)        # optional context id
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("author_id", "target_id", name="uq_review_author_target"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "rating": self.rating,
            "comment": self.comment,
            "listing_type": self.listing_type,
            "listing_id": self.listing_id,
            "created_at": iso(self.created_at),
            "author": {
                "id": self.author.id,
                "name": self.author.name,
                "avatar_url": image_urls(self.author.avatar_url)["image_url"],
            }
            if self.author
            else None,
        }


# ---------------------------------------------------------------------------
# Favourites / wishlist
# ---------------------------------------------------------------------------
class Favorite(db.Model):
    """A saved listing – item_type keeps this table generic (DRY)."""

    __tablename__ = "favorites"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_type = db.Column(db.String(30), nullable=False)   # product | accommodation | …
    item_id = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "item_type", "item_id", name="uq_favorite"),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "item_type": self.item_type,
            "item_id": self.item_id,
            "created_at": iso(self.created_at),
        }


# ---------------------------------------------------------------------------
# JWT blocklist (real logout)
# ---------------------------------------------------------------------------
class TokenBlocklist(db.Model):
    """Revoked JWT ids – checked on every authenticated request."""

    __tablename__ = "token_blocklist"

    id = db.Column(db.Integer, primary_key=True)
    jti = db.Column(db.String(36), nullable=False, index=True)
    token_type = db.Column(db.String(20))
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


# ---------------------------------------------------------------------------
# Convenience: map listing type -> model, reused by favourites & moderation
# ---------------------------------------------------------------------------
LISTING_MODELS = {
    "product": Product,
    "products": Product,
    "accommodation": Accommodation,
    "room": Accommodation,
    "event": Event,
    "events": Event,
    "service": Service,
    "services": Service,
}


def model_for_type(item_type: str):
    """Resolve a listing type string to its SQLAlchemy model (or None)."""
    return LISTING_MODELS.get((item_type or "").strip().lower())
