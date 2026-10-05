"""
Authentication routes – ``/api/auth/*``

Endpoints
---------
POST  /api/auth/signup           register a new account
POST  /api/auth/login            obtain access + refresh JWTs
POST  /api/auth/refresh          exchange a refresh token for a new access token
POST  /api/auth/logout           revoke the current token (real logout)
GET   /api/auth/me               current profile
PUT   /api/auth/me               update the current profile
POST  /api/auth/me/password      change password
POST  /api/auth/check-email      live availability check for the signup form
"""

from flask import Blueprint, jsonify
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)

from extensions import db
from models import TokenBlocklist, User
from utils.decorators import current_user, login_required
from utils.helpers import api_error, api_success, request_data
from utils.validators import (
    ValidationError,
    clean_text,
    normalize_image_reference,
    validate_email,
    validate_password,
    validate_phone,
    validate_required,
    validate_user_type,
)

auth_bp = Blueprint("auth", __name__)


def _tokens_for(user: User) -> dict:
    """Build an access/refresh token pair carrying role claims."""
    claims = {"role": user.user_type, "name": user.name, "verified": user.verified}
    return {
        "access_token": create_access_token(identity=str(user.id), additional_claims=claims),
        "refresh_token": create_refresh_token(identity=str(user.id), additional_claims=claims),
        "token_type": "Bearer",
    }


@auth_bp.post("/auth/signup")
def signup():
    """Register a new student / landlord / service provider."""
    payload = request_data()
    try:
        validate_required(
            payload,
            {
                "name": "Full name",
                "email": "Email",
                "phone": "Phone number",
                "password": "Password",
            },
        )
        name = clean_text(payload.get("name"), 120)
        if len(name) < 3:
            raise ValidationError("Please enter your full name", {"name": "Too short"})

        email = validate_email(payload.get("email"))
        phone = validate_phone(payload.get("phone"))
        password = validate_password(payload.get("password"))
        user_type = validate_user_type(payload.get("user_type"))

        if payload.get("confirm_password") is not None and (
            payload.get("confirm_password") != password
        ):
            raise ValidationError("Passwords do not match", {"confirm_password": "No match"})

        if User.query.filter_by(email=email).first():
            return api_error("An account with this email already exists", 409,
                             {"email": "Email already registered"})

        user = User(
            name=name,
            email=email,
            phone=phone,
            user_type=user_type,
            department=clean_text(payload.get("department"), 120) or None,
            level=clean_text(payload.get("level"), 20) or None,
            location=clean_text(payload.get("location"), 160) or None,
            whatsapp=clean_text(payload.get("whatsapp"), 20) or None,
        )
        user.set_password(password)
        db.session.add(user)
        db.session.commit()

        return api_success(
            {"user": user.to_dict(include_private=True), **_tokens_for(user)},
            message="Welcome to Campus Marketplace! Your account is ready.",
            status=201,
        )
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@auth_bp.post("/auth/login")
def login():
    """Authenticate with email + password and return JWT tokens."""
    payload = request_data()
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""

    if not email or not password:
        return api_error("Email and password are required", 422,
                         {"email": "Required", "password": "Required"})

    user = User.query.filter_by(email=email).first()
    # Same message for unknown email and wrong password – avoids account probing.
    if user is None or not user.check_password(password):
        return api_error("Invalid email or password", 401)

    if not user.is_active:
        return api_error("Your account has been suspended – contact the administrator", 403)

    return api_success(
        {"user": user.to_dict(include_private=True), **_tokens_for(user)},
        message=f"Welcome back, {user.name.split()[0]}!",
    )


@auth_bp.post("/auth/refresh")
@jwt_required(refresh=True)
def refresh():
    """
    Issue a fresh access token from a valid refresh token.

    The identity is read straight from the verified refresh token (the
    ``jwt_required(refresh=True)`` guard already validated it).
    """
    identity = get_jwt_identity()
    user = db.session.get(User, int(identity)) if identity else None
    if user is None:
        return api_error("Account no longer exists", 401)
    if not user.is_active:
        return api_error("Your account has been suspended – contact the administrator", 403)
    return api_success(
        {
            "access_token": create_access_token(
                identity=str(user.id),
                additional_claims={"role": user.user_type, "name": user.name},
            )
        },
        message="Token refreshed",
    )


@auth_bp.post("/auth/logout")
@jwt_required(verify_type=False)
def logout():
    """
    Revoke the current JWT by storing its ``jti`` in the blocklist.

    Accepts either an access or a refresh token so the client can drop both.
    """
    token = get_jwt()
    jti = token.get("jti")
    if jti and not db.session.query(TokenBlocklist.id).filter_by(jti=jti).first():
        db.session.add(
            TokenBlocklist(
                jti=jti,
                token_type=token.get("type"),
                user_id=int(get_jwt_identity()) if get_jwt_identity() else None,
            )
        )
        db.session.commit()
    return api_success(message="You have been logged out")


@auth_bp.get("/auth/me")
@login_required
def me():
    """Return the signed-in user (used to rehydrate the frontend session)."""
    user = current_user()
    counts = {
        "products": user.products.count(),
        "accommodation": user.accommodations.count(),
        "events": user.events.count(),
        "services": user.services.count(),
        "favorites": user.favorites.count(),
    }
    return api_success({"user": user.to_dict(include_private=True), "counts": counts})


@auth_bp.put("/auth/me")
@login_required
def update_me():
    """Update the signed-in user's profile fields."""
    user = current_user()
    payload = request_data()

    try:
        if "name" in payload:
            name = clean_text(payload.get("name"), 120)
            if len(name) < 3:
                raise ValidationError("Please enter your full name", {"name": "Too short"})
            user.name = name
        if payload.get("email"):
            email = validate_email(payload["email"])
            clash = User.query.filter(User.email == email, User.id != user.id).first()
            if clash:
                return api_error("That email is already in use", 409,
                                 {"email": "Email already registered"})
            user.email = email
        if payload.get("phone"):
            user.phone = validate_phone(payload["phone"])
        if payload.get("whatsapp"):
            user.whatsapp = validate_phone(payload["whatsapp"])

        for field, limit in (
            ("bio", 600),
            ("department", 120),
            ("level", 20),
            ("location", 160),
        ):
            if field in payload:
                setattr(user, field, clean_text(payload.get(field), limit) or None)
        if "avatar_url" in payload:
            # Normalised like a listing image: a bucket key survives a provider
            # or domain change, a pasted (or expiring) URL does not.
            user.avatar_url = normalize_image_reference(payload.get("avatar_url"), "avatar_url")

        db.session.commit()
        return api_success(user.to_dict(include_private=True), message="Profile updated")
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@auth_bp.post("/auth/me/password")
@login_required
def change_password():
    """Change the password (old password required)."""
    user = current_user()
    payload = request_data()
    old_password = payload.get("old_password") or payload.get("current_password") or ""
    new_password = payload.get("new_password") or payload.get("password") or ""

    if not user.check_password(old_password):
        return api_error("Your current password is incorrect", 401,
                         {"old_password": "Incorrect password"})
    try:
        validate_password(new_password)
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)

    user.set_password(new_password)
    db.session.commit()
    return api_success(message="Password changed successfully")


@auth_bp.post("/auth/check-email")
def check_email():
    """Public helper for the signup form's live "email taken" hint."""
    email = (request_data().get("email") or "").strip().lower()
    if not email:
        return jsonify({"success": False, "message": "Email is required"}), 422
    exists = User.query.filter_by(email=email).first() is not None
    return jsonify({"success": True, "data": {"email": email, "available": not exists}})
