"""API integration tests for authentication, moderation and marketplace workflows."""
from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from PIL import Image

from backend.app import create_app
from backend.extensions import db
from backend.models import User


@pytest.fixture()
def app(tmp_path):
    application = create_app({
        "TESTING": True,
        "SECRET_KEY": "test-secret",
        "JWT_SECRET_KEY": "test-jwt-secret-with-more-than-thirty-two-bytes",
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
        "UPLOAD_FOLDER": str(tmp_path / "uploads"),
        "BCRYPT_LOG_ROUNDS": 4,
        "BCRYPT_HANDLE_LONG_PASSWORDS": True,
        "CORS_ORIGINS": ["*"],
    })
    with application.app_context():
        db.drop_all()
        db.create_all()
    yield application
    with application.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def signup(client, email="student@fulafia.edu.ng", name="Student One"):
    response = client.post("/api/auth/signup", json={
        "name": name,
        "email": email,
        "phone": "+234 801 234 5678",
        "password": "SecurePass123",
    })
    assert response.status_code == 201, response.get_json()
    return response.get_json()


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def create_admin(app):
    with app.app_context():
        admin = User(name="Campus Admin", email="admin@fulafia.edu.ng", phone="+234 800 000 0000", user_type="admin", verified=True)
        admin.set_password("SecurePass123")
        db.session.add(admin)
        db.session.commit()
        return admin.id


def login(client, email):
    response = client.post("/api/auth/login", json={"email": email, "password": "SecurePass123"})
    assert response.status_code == 200, response.get_json()
    return response.get_json()["access_token"]


def test_signup_login_and_logout_revokes_jwt(client, app):
    data = signup(client)
    assert data["user"]["name"] == "Student One"
    assert data["access_token"]

    with app.app_context():
        user = User.query.filter_by(email="student@fulafia.edu.ng").one()
        assert user.password_hash != "SecurePass123"
        assert user.check_password("SecurePass123")

    duplicate = client.post("/api/auth/signup", json={
        "name": "Another Student", "email": "STUDENT@fulafia.edu.ng", "phone": "+2348000000000", "password": "SecurePass123",
    })
    assert duplicate.status_code == 409
    assert client.get("/api/auth/me", headers=auth(data["access_token"])).status_code == 200

    logout = client.post("/api/auth/logout", headers=auth(data["access_token"]))
    assert logout.status_code == 200
    revoked = client.get("/api/auth/me", headers=auth(data["access_token"]))
    assert revoked.status_code == 401


def test_products_are_private_until_admin_approval_and_filters_work(client, app):
    student = signup(client)
    product_response = client.post("/api/products", json={
        "title": "Physics textbook", "description": "A clean copy with no missing pages.",
        "price": 12500, "category": "Books", "location": "Take-off Campus",
    }, headers=auth(student["access_token"]))
    assert product_response.status_code == 201
    product = product_response.get_json()["product"]
    assert product["status"] == "pending"
    assert client.get("/api/products").get_json()["items"] == []
    assert client.get(f"/api/products/{product['id']}").status_code == 404

    create_admin(app)
    admin_token = login(client, "admin@fulafia.edu.ng")
    pending = client.get("/api/admin/pending", headers=auth(admin_token))
    assert pending.status_code == 200
    assert pending.get_json()["total"] == 1
    assert pending.get_json()["items"]["product"][0]["id"] == product["id"]

    approved = client.post(f"/api/admin/approve/product/{product['id']}", json={}, headers=auth(admin_token))
    assert approved.status_code == 200
    assert approved.get_json()["listing"]["status"] == "published"
    assert client.get("/api/products?category=Books&min_price=10000&max_price=13000").get_json()["pagination"]["total"] == 1
    assert client.get("/api/products?category=Books&max_price=1000").get_json()["items"] == []

    updated = client.put(f"/api/products/{product['id']}", json={"price": 11000}, headers=auth(student["access_token"]))
    assert updated.status_code == 200
    assert updated.get_json()["product"]["status"] == "pending"
    assert client.get("/api/products").get_json()["items"] == []

    forbidden = client.post(f"/api/admin/approve/product/{product['id']}", json={}, headers=auth(student["access_token"]))
    assert forbidden.status_code == 403


def test_accommodation_events_services_and_favorites(client, app):
    student = signup(client)
    token = student["access_token"]

    accommodation = client.post("/api/accommodation", json={
        "title": "Quiet room near campus", "description": "A clean single room near campus with steady water.",
        "location": "Take-off Campus", "price": 180000, "rooms": 1, "room_type": "room",
    }, headers=auth(token))
    assert accommodation.status_code == 201
    accommodation_id = accommodation.get_json()["accommodation"]["id"]

    event = client.post("/api/events", json={
        "title": "Student design meetup", "description": "Share ideas and meet student designers on campus.",
        "date": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(), "location": "Main Auditorium", "category": "Networking",
    }, headers=auth(token))
    assert event.status_code == 201
    event_id = event.get_json()["event"]["id"]

    service = client.post("/api/services", json={
        "title": "Peer tutoring", "description": "Friendly first-year maths tutoring from a senior student.",
        "category": "Tutoring", "location": "Take-off Campus", "price": 2500,
    }, headers=auth(token))
    assert service.status_code == 201
    service_id = service.get_json()["service"]["id"]

    admin_id = create_admin(app)
    admin_token = login(client, "admin@fulafia.edu.ng")
    assert admin_id
    for kind, listing_id in (("accommodation", accommodation_id), ("event", event_id), ("service", service_id)):
        response = client.post(f"/api/admin/approve/{kind}/{listing_id}", json={}, headers=auth(admin_token))
        assert response.status_code == 200, response.get_json()

    rooms = client.get("/api/accommodation?location=Take-off&min_price=100000&max_price=200000")
    assert rooms.status_code == 200 and rooms.get_json()["pagination"]["total"] == 1
    events = client.get("/api/events?category=Networking")
    assert events.status_code == 200 and len(events.get_json()["items"]) == 1
    services = client.get("/api/services?q=tutor")
    assert services.status_code == 200 and len(services.get_json()["items"]) == 1

    favorite = client.post("/api/favorites", json={"listing_type": "event", "listing_id": event_id}, headers=auth(token))
    assert favorite.status_code == 201
    assert favorite.get_json()["favorite"]["listing"]["title"] == "Student design meetup"
    assert len(client.get("/api/favorites", headers=auth(token)).get_json()["items"]) == 1
    assert client.delete(f"/api/favorites/listing/event/{event_id}", headers=auth(token)).status_code == 200


def test_user_profile_reviews_and_ownership(client):
    seller = signup(client, "seller@fulafia.edu.ng", "Seller Student")
    buyer = signup(client, "buyer@fulafia.edu.ng", "Buyer Student")
    seller_id = seller["user"]["id"]
    response = client.post(f"/api/users/{seller_id}/reviews", json={"rating": 5, "comment": "Helpful and friendly."}, headers=auth(buyer["access_token"]))
    assert response.status_code == 201
    profile = client.get(f"/api/users/{seller_id}").get_json()
    assert profile["rating"]["average"] == 5.0
    assert profile["rating"]["count"] == 1
    duplicate = client.post(f"/api/users/{seller_id}/reviews", json={"rating": 4}, headers=auth(buyer["access_token"]))
    assert duplicate.status_code == 409
    self_review = client.post(f"/api/users/{seller_id}/reviews", json={"rating": 4}, headers=auth(seller["access_token"]))
    assert self_review.status_code == 400


def test_validation_and_cors_errors_are_json(client):
    invalid = client.post("/api/auth/signup", json={"name": "A", "email": "nope", "phone": "123", "password": "short"})
    assert invalid.status_code == 400
    assert "error" in invalid.get_json()

    bad_price = client.get("/api/products?min_price=abc")
    assert bad_price.status_code == 400
    assert client.get("/api/health").get_json()["status"] == "ok"
    missing = client.get("/api/does-not-exist")
    assert missing.status_code == 404
    assert missing.is_json


def test_image_upload_is_validated_normalized_and_served(client):
    student = signup(client)
    image_bytes = BytesIO()
    Image.new("RGB", (24, 18), color=(28, 120, 90)).save(image_bytes, format="PNG")
    image_bytes.seek(0)
    response = client.post("/api/products", data={
        "title": "Handmade campus tote", "description": "A strong tote bag sewn by a FULafia student.",
        "price": "4000", "category": "Fashion", "location": "Take-off Campus",
        "image": (image_bytes, "tote.png"),
    }, headers=auth(student["access_token"]), content_type="multipart/form-data")
    assert response.status_code == 201, response.get_json()
    image_url = response.get_json()["product"]["image_url"]
    assert image_url.startswith("/uploads/") and image_url.endswith(".jpg")
    stored = client.get(image_url)
    assert stored.status_code == 200
    assert stored.mimetype == "image/jpeg"

    bad_file = client.post("/api/products", data={
        "title": "Broken photo listing", "description": "This uploaded file is not a real image.",
        "price": "1000", "category": "Other", "image": (BytesIO(b"not an image"), "broken.png"),
    }, headers=auth(student["access_token"]), content_type="multipart/form-data")
    assert bad_file.status_code == 400
    assert "image" in bad_file.get_json()["error"].lower()


def test_admin_can_reject_listings_and_verify_students(client, app):
    student = signup(client)
    listing = client.post("/api/events", json={
        "title": "Campus film night", "description": "A student organised film screening and discussion.",
        "date": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(), "location": "Student Centre",
    }, headers=auth(student["access_token"]))
    assert listing.status_code == 201
    event_id = listing.get_json()["event"]["id"]

    create_admin(app)
    admin_token = login(client, "admin@fulafia.edu.ng")
    rejected = client.post(f"/api/admin/reject/event/{event_id}", json={}, headers=auth(admin_token))
    assert rejected.status_code == 200
    assert rejected.get_json()["listing"]["status"] == "rejected"
    assert client.get("/api/events").get_json()["items"] == []

    verify = client.post(f"/api/admin/users/{student['user']['id']}/verify", json={}, headers=auth(admin_token))
    assert verify.status_code == 200
    assert verify.get_json()["user"]["verified"] is True
    users = client.get("/api/admin/users?q=student", headers=auth(admin_token))
    assert users.status_code == 200
    assert users.get_json()["items"][0]["verified"] is True


def test_cors_preflight_and_missing_auth_are_handled(client):
    preflight = client.options("/api/auth/signup", headers={
        "Origin": "https://campus.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
    })
    assert preflight.status_code == 200
    assert preflight.headers.get("Access-Control-Allow-Origin") == "https://campus.example"
    protected = client.post("/api/products", json={"title": "No auth"})
    assert protected.status_code == 401
    assert protected.is_json
