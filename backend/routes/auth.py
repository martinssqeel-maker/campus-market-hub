"""Registration, login and JWT logout endpoints."""
import re
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify
from flask_jwt_extended import (
    create_access_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models import TokenBlocklist, User
from .common import api_error, clean_text, payload_data

bp = Blueprint("auth", __name__)
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_RE = re.compile(r"^[+()0-9 .-]{7,32}$")


def auth_result(user, status=200):
    token = create_access_token(identity=str(user.id))
    return jsonify({
        "message": "Signed in successfully.",
        "access_token": token,
        "token_type": "Bearer",
        "user": user.to_dict(),
    }), status


@bp.post("/signup")
def signup():
    data = payload_data()
    try:
        name = clean_text(data.get("name"), "Name", maximum=100, minimum=2)
        email = clean_text(data.get("email"), "Email", maximum=254).lower()
        password = str(data.get("password") or "")
        phone = clean_text(data.get("phone"), "Phone number", maximum=32)
        if not EMAIL_RE.fullmatch(email):
            raise ValueError("Enter a valid email address.")
        if len(password) < 8 or len(password) > 128:
            raise ValueError("Password must be between 8 and 128 characters.")
        if not PHONE_RE.fullmatch(phone):
            raise ValueError("Enter a valid phone number (7 to 32 characters).")
    except ValueError as exc:
        return api_error(str(exc), 400)

    if User.query.filter_by(email=email).first():
        return api_error("An account with this email already exists.", 409)

    user = User(name=name, email=email, phone=phone, user_type="student", verified=False)
    user.set_password(password)
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_error("An account with this email already exists.", 409)

    return auth_result(user, 201)


@bp.post("/login")
def login():
    data = payload_data()
    email = str(data.get("email") or "").strip().lower()
    password = str(data.get("password") or "")
    if not EMAIL_RE.fullmatch(email) or not password:
        return api_error("Enter your email and password.", 400)

    user = User.query.filter_by(email=email).first()
    if user is None or not user.check_password(password):
        return api_error("Email or password is incorrect.", 401)
    return auth_result(user)


@bp.post("/logout")
@jwt_required()
def logout():
    token = get_jwt()
    entry = TokenBlocklist(
        jti=token["jti"],
        expires_at=datetime.fromtimestamp(token["exp"], tz=timezone.utc).replace(tzinfo=None),
    )
    db.session.add(entry)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
    except Exception:
        db.session.rollback()
        current_app.logger.exception("Could not revoke JWT during logout")
        return api_error("Unable to sign out right now. Please try again.", 500)
    return jsonify({"message": "Signed out successfully."}), 200


@bp.get("/me")
@jwt_required()
def me():
    identity = get_jwt_identity()
    try:
        user = db.session.get(User, int(identity))
    except (TypeError, ValueError):
        user = None
    if user is None:
        return api_error("Account not found.", 404)
    return jsonify({"user": user.to_dict()})
