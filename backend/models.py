"""SQLAlchemy models for the Campus Marketplace API."""
from datetime import datetime, timezone

from .extensions import bcrypt, db


def utcnow():
    """Return a naive UTC timestamp (portable across SQLite and MySQL)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(254), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(32), nullable=False, default="")
    user_type = db.Column(db.String(20), nullable=False, default="student", index=True)
    verified = db.Column(db.Boolean, nullable=False, default=False)
    bio = db.Column(db.String(500), nullable=False, default="")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)

    products = db.relationship("Product", back_populates="seller", cascade="all, delete-orphan")
    accommodations = db.relationship("Accommodation", back_populates="landlord", cascade="all, delete-orphan")
    events = db.relationship("Event", back_populates="creator", cascade="all, delete-orphan")
    services = db.relationship("Service", back_populates="provider", cascade="all, delete-orphan")
    reviews_written = db.relationship(
        "Review", foreign_keys="Review.reviewer_id", back_populates="reviewer", cascade="all, delete-orphan"
    )
    reviews_received = db.relationship(
        "Review", foreign_keys="Review.reviewed_user_id", back_populates="reviewed_user", cascade="all, delete-orphan"
    )

    def set_password(self, password: str) -> None:
        self.password_hash = bcrypt.generate_password_hash(password).decode("utf-8")

    def check_password(self, password: str) -> bool:
        return bcrypt.check_password_hash(self.password_hash, password)

    @property
    def is_admin(self) -> bool:
        return self.user_type == "admin"

    def to_dict(self, include_contact: bool = True) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "user_type": self.user_type,
            "verified": self.verified,
            "bio": self.bio,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None,
        }
        if include_contact:
            data["phone"] = self.phone
        return data


class Product(db.Model):
    __tablename__ = "products"
    __table_args__ = (
        db.CheckConstraint("price >= 0", name="ck_products_price_nonnegative"),
        db.Index("ix_products_status_category", "status", "category"),
    )

    id = db.Column(db.Integer, primary_key=True)
    seller_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = db.Column(db.String(140), nullable=False)
    description = db.Column(db.Text, nullable=False)
    price = db.Column(db.Numeric(12, 2), nullable=False)
    image_url = db.Column(db.String(500), nullable=False, default="")
    category = db.Column(db.String(60), nullable=False, index=True)
    location = db.Column(db.String(120), nullable=False, default="Federal University of Lafia")
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    seller = db.relationship("User", back_populates="products")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "price": float(self.price or 0),
            "image_url": self.image_url,
            "category": self.category,
            "location": self.location,
            "status": self.status,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None,
            "seller": {
                "id": self.seller.id,
                "name": self.seller.name,
                "phone": self.seller.phone,
                "verified": self.seller.verified,
            } if self.seller else None,
        }


class Accommodation(db.Model):
    __tablename__ = "accommodation"
    __table_args__ = (
        db.CheckConstraint("price >= 0", name="ck_accommodation_price_nonnegative"),
        db.CheckConstraint("rooms >= 1", name="ck_accommodation_rooms_positive"),
        db.Index("ix_accommodation_status_location", "status", "location"),
    )

    id = db.Column(db.Integer, primary_key=True)
    landlord_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = db.Column(db.String(140), nullable=False)
    description = db.Column(db.Text, nullable=False)
    location = db.Column(db.String(160), nullable=False)
    price = db.Column(db.Numeric(12, 2), nullable=False)
    rooms = db.Column(db.Integer, nullable=False, default=1)
    room_type = db.Column(db.String(40), nullable=False, default="room")
    image_url = db.Column(db.String(500), nullable=False, default="")
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    landlord = db.relationship("User", back_populates="accommodations")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "location": self.location,
            "price": float(self.price or 0),
            "rooms": self.rooms,
            "room_type": self.room_type,
            "image_url": self.image_url,
            "status": self.status,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None,
            "landlord": {
                "id": self.landlord.id,
                "name": self.landlord.name,
                "phone": self.landlord.phone,
                "verified": self.landlord.verified,
            } if self.landlord else None,
        }


class Event(db.Model):
    __tablename__ = "events"
    __table_args__ = (db.Index("ix_events_status_date", "status", "date"),)

    id = db.Column(db.Integer, primary_key=True)
    creator_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = db.Column(db.String(140), nullable=False)
    description = db.Column(db.Text, nullable=False)
    date = db.Column(db.DateTime, nullable=False, index=True)
    location = db.Column(db.String(160), nullable=False)
    category = db.Column(db.String(60), nullable=False, default="Campus event")
    image_url = db.Column(db.String(500), nullable=False, default="")
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)

    creator = db.relationship("User", back_populates="events")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "date": self.date.isoformat() + "Z" if self.date else None,
            "location": self.location,
            "category": self.category,
            "image_url": self.image_url,
            "status": self.status,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None,
            "creator": {
                "id": self.creator.id,
                "name": self.creator.name,
                "phone": self.creator.phone,
            } if self.creator else None,
        }


class Service(db.Model):
    __tablename__ = "services"
    __table_args__ = (db.Index("ix_services_status_category", "status", "category"),)

    id = db.Column(db.Integer, primary_key=True)
    provider_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = db.Column(db.String(140), nullable=False)
    description = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(60), nullable=False, default="Other")
    location = db.Column(db.String(120), nullable=False, default="Federal University of Lafia")
    price = db.Column(db.Numeric(12, 2), nullable=True)
    image_url = db.Column(db.String(500), nullable=False, default="")
    status = db.Column(db.String(20), nullable=False, default="pending", index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)

    provider = db.relationship("User", back_populates="services")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "category": self.category,
            "location": self.location,
            "price": float(self.price) if self.price is not None else None,
            "image_url": self.image_url,
            "status": self.status,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None,
            "provider": {
                "id": self.provider.id,
                "name": self.provider.name,
                "phone": self.provider.phone,
                "verified": self.provider.verified,
            } if self.provider else None,
        }


class Review(db.Model):
    __tablename__ = "reviews"
    __table_args__ = (
        db.CheckConstraint("rating >= 1 AND rating <= 5", name="ck_reviews_rating_range"),
        db.UniqueConstraint("reviewer_id", "reviewed_user_id", name="uq_review_per_user"),
    )

    id = db.Column(db.Integer, primary_key=True)
    reviewer_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    reviewed_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    rating = db.Column(db.Integer, nullable=False)
    comment = db.Column(db.String(800), nullable=False, default="")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)

    reviewer = db.relationship("User", foreign_keys=[reviewer_id], back_populates="reviews_written")
    reviewed_user = db.relationship("User", foreign_keys=[reviewed_user_id], back_populates="reviews_received")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "rating": self.rating,
            "comment": self.comment,
            "created_at": self.created_at.isoformat() + "Z" if self.created_at else None,
            "reviewer": {"id": self.reviewer.id, "name": self.reviewer.name} if self.reviewer else None,
        }


class Favorite(db.Model):
    __tablename__ = "favorites"
    __table_args__ = (db.UniqueConstraint("user_id", "listing_type", "listing_id", name="uq_user_favorite_listing"),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    listing_type = db.Column(db.String(30), nullable=False)
    listing_id = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)

    user = db.relationship("User")


class TokenBlocklist(db.Model):
    __tablename__ = "token_blocklist"

    id = db.Column(db.Integer, primary_key=True)
    jti = db.Column(db.String(36), unique=True, nullable=False, index=True)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
