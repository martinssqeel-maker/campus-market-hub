"""
Automated API test-suite for Campus Marketplace.

Run with either::

    python -m unittest discover -s backend/tests -v
    python backend/tests/test_api.py

Every endpoint in the project specification is exercised, including the
moderation workflow, authentication edge cases, filtering and image upload.

Uses an in-memory SQLite database, so it never touches ``database.db``.
"""

import io
import os
import sys
import unittest
from datetime import datetime, timezone

# Make ``backend/`` importable when the suite is run from the project root.
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
sys.path.insert(0, BACKEND_DIR)

from config import TestingConfig
from extensions import db
from models import Product, User
from utils import storage

from app import create_app

#: Smallest valid PNG (1x1 pixel) used to test the upload endpoint.
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000100ffff03000006"
    "0005574bd0a40000000049454e44ae426082"
)


class ApiTestCase(unittest.TestCase):
    """Base class: builds an app with a fresh database for every test."""

    @classmethod
    def setUpClass(cls):
        cls.upload_dir = os.path.join(PROJECT_ROOT, "frontend", "assets", "uploads")
        os.makedirs(cls.upload_dir, exist_ok=True)

    def setUp(self):
        self.app = create_app(TestingConfig)
        self.app.config["UPLOAD_FOLDER"] = self.upload_dir
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        self.client = self.app.test_client()

        # --- fixtures: one admin, one student, one landlord -----------------
        # Admins cannot register through the API (by design), so the fixture
        # inserts the account directly and then logs in normally.
        self.admin_token = self._make_admin("Admin Tester", "admin@test.ng")
        self.student_token = self._make_user("Student Tester", "student@test.ng")
        self.landlord_token = self._make_user(
            "Landlord Tester", "landlord@test.ng", user_type="landlord"
        )

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.ctx.pop()

    # -- helpers -----------------------------------------------------------
    def _make_user(self, name, email, user_type="student", verified=False):
        """Register a user directly through the API and return its token."""
        response = self.client.post(
            "/api/auth/signup",
            json={
                "name": name,
                "email": email,
                "phone": "08031234567",
                "password": "Passw0rd123",
                "user_type": user_type,
            },
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        token = response.get_json()["data"]["access_token"]
        if verified:
            user = User.query.filter_by(email=email).first()
            user.verified = True
            db.session.commit()
        return token

    def _make_admin(self, name, email):
        """Create an administrator directly in the DB and return its token."""
        user = User(name=name, email=email, phone="08030000000",
                    user_type="admin", verified=True)
        user.set_password("Passw0rd123")
        db.session.add(user)
        db.session.commit()

        response = self.client.post(
            "/api/auth/login", json={"email": email, "password": "Passw0rd123"}
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()["data"]["access_token"]

    def auth(self, token):
        return {"Authorization": f"Bearer {token}"}

    def create_product(self, token, **overrides):
        payload = {
            "title": "Casio Scientific Calculator",
            "description": "Gently used calculator for MTH 101 and STA 111 students.",
            "price": 4500,
            "category": "electronics",
            "location": "Angwan Rimi, Lafia",
            "condition": "used",
        }
        payload.update(overrides)
        return self.client.post("/api/products", json=payload, headers=self.auth(token))

    # ------------------------------------------------------------------
    # Health, meta and public data
    # ------------------------------------------------------------------
    def test_health_and_meta(self):
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.get_json()["data"]["database"], "connected")

        meta = self.client.get("/api/meta").get_json()["data"]
        for key in ("product_categories", "room_types", "event_categories", "service_categories"):
            self.assertTrue(meta[key], f"{key} should not be empty")

        stats = self.client.get("/api/stats").get_json()["data"]
        self.assertEqual(stats["campus"], "Federal University of Lafia")

        self.assertEqual(self.client.get("/api").status_code, 200)

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------
    def test_signup_validation_errors(self):
        # missing fields
        response = self.client.post("/api/auth/signup", json={"email": "bad"})
        self.assertEqual(response.status_code, 422)
        self.assertIn("errors", response.get_json())

        # invalid email
        response = self.client.post(
            "/api/auth/signup",
            json={"name": "Test User", "email": "not-an-email", "phone": "08031234567",
                  "password": "Passw0rd123"},
        )
        self.assertEqual(response.status_code, 422)

        # weak password
        response = self.client.post(
            "/api/auth/signup",
            json={"name": "Test User", "email": "weak@test.ng", "phone": "08031234567",
                  "password": "abc"},
        )
        self.assertEqual(response.status_code, 422)

        # invalid phone
        response = self.client.post(
            "/api/auth/signup",
            json={"name": "Test User", "email": "phone@test.ng", "phone": "12345",
                  "password": "Passw0rd123"},
        )
        self.assertEqual(response.status_code, 422)

    def test_duplicate_email_rejected(self):
        response = self.client.post(
            "/api/auth/signup",
            json={"name": "Copy Cat", "email": "student@test.ng", "phone": "08031234567",
                  "password": "Passw0rd123"},
        )
        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.get_json()["success"])

    def test_login_logout_and_token_revocation(self):
        # wrong password
        bad = self.client.post(
            "/api/auth/login", json={"email": "student@test.ng", "password": "nope1234"}
        )
        self.assertEqual(bad.status_code, 401)

        # unknown email
        unknown = self.client.post(
            "/api/auth/login", json={"email": "ghost@test.ng", "password": "Passw0rd123"}
        )
        self.assertEqual(unknown.status_code, 401)

        # correct credentials
        response = self.client.post(
            "/api/auth/login", json={"email": "student@test.ng", "password": "Passw0rd123"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()["data"]
        self.assertIn("access_token", data)
        self.assertIn("refresh_token", data)

        headers = self.auth(data["access_token"])
        self.assertEqual(self.client.get("/api/auth/me", headers=headers).status_code, 200)

        # refresh
        refreshed = self.client.post(
            "/api/auth/refresh", headers=self.auth(data["refresh_token"])
        )
        self.assertEqual(refreshed.status_code, 200)
        self.assertIn("access_token", refreshed.get_json()["data"])

        # logout revokes the token
        self.assertEqual(self.client.post("/api/auth/logout", headers=headers).status_code, 200)
        revoked = self.client.get("/api/auth/me", headers=headers)
        self.assertEqual(revoked.status_code, 401)

    def test_protected_route_requires_token(self):
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        self.assertEqual(self.client.get("/api/auth/me", headers=self.auth("garbage")).status_code, 422)

    def test_profile_update_and_password_change(self):
        headers = self.auth(self.student_token)
        update = self.client.put(
            "/api/auth/me",
            json={"bio": "I sell textbooks.", "department": "Computer Science",
                  "level": "300 Level"},
            headers=headers,
        )
        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.get_json()["data"]["department"], "Computer Science")

        # wrong current password
        wrong = self.client.post(
            "/api/auth/me/password",
            json={"old_password": "wrongpass1", "new_password": "BrandNew123"},
            headers=headers,
        )
        self.assertEqual(wrong.status_code, 401)

        ok = self.client.post(
            "/api/auth/me/password",
            json={"old_password": "Passw0rd123", "new_password": "BrandNew123"},
            headers=headers,
        )
        self.assertEqual(ok.status_code, 200)

        # new password works on login
        relogin = self.client.post(
            "/api/auth/login", json={"email": "student@test.ng", "password": "BrandNew123"}
        )
        self.assertEqual(relogin.status_code, 200)

    def test_check_email(self):
        taken = self.client.post("/api/auth/check-email", json={"email": "student@test.ng"})
        self.assertFalse(taken.get_json()["data"]["available"])
        free = self.client.post("/api/auth/check-email", json={"email": "brand-new@test.ng"})
        self.assertTrue(free.get_json()["data"]["available"])

    # ------------------------------------------------------------------
    # Products + moderation workflow
    # ------------------------------------------------------------------
    def test_product_requires_auth(self):
        self.assertEqual(self.client.post("/api/products", json={"title": "x"}).status_code, 401)

    def test_product_validation(self):
        bad = self.create_product(self.student_token, title="ab", description="short")
        self.assertEqual(bad.status_code, 422)

    def test_full_moderation_workflow(self):
        created = self.create_product(self.student_token)
        self.assertEqual(created.status_code, 201)
        product = created.get_json()["data"]
        self.assertEqual(product["status"], "pending")   # nothing publishes itself
        product_id = product["id"]

        # owner can see the draft
        own = self.client.get(f"/api/products/{product_id}",
                              headers=self.auth(self.student_token))
        self.assertEqual(own.status_code, 200)

        # public cannot
        self.assertEqual(self.client.get(f"/api/products/{product_id}").status_code, 403)

        # it does not appear in the public list
        public_ids = [
            item["id"]
            for item in self.client.get("/api/products").get_json()["data"]["items"]
        ]
        self.assertNotIn(product_id, public_ids)

        # it is in the admin pending queue
        pending = self.client.get("/api/admin/pending", headers=self.auth(self.admin_token))
        self.assertEqual(pending.status_code, 200)
        pending_ids = [
            item["id"] for item in pending.get_json()["data"]["items"]
            if item["item_type"] == "product"
        ]
        self.assertIn(product_id, pending_ids)

        pending_alias = self.client.get(
            "/api/admin/pending-listings", headers=self.auth(self.admin_token)
        )
        self.assertEqual(pending_alias.status_code, 200)

        # non-admin cannot moderate
        forbidden = self.client.post(
            f"/api/admin/approve/{product_id}",
            json={"item_type": "product"},
            headers=self.auth(self.student_token),
        )
        self.assertEqual(forbidden.status_code, 403)

        # approve
        approved = self.client.post(
            f"/api/admin/approve/{product_id}",
            json={"item_type": "product"},
            headers=self.auth(self.admin_token),
        )
        self.assertEqual(approved.status_code, 200, approved.get_json())
        self.assertEqual(approved.get_json()["data"]["status"], "published")

        # now public
        self.assertEqual(self.client.get(f"/api/products/{product_id}").status_code, 200)
        public_ids = [
            item["id"]
            for item in self.client.get("/api/products").get_json()["data"]["items"]
        ]
        self.assertIn(product_id, public_ids)

        # reject flow on a second listing
        second = self.create_product(self.student_token, title="Second Hand Fan",
                                     description="Standing fan in good condition.")
        second_id = second.get_json()["data"]["id"]
        rejected = self.client.post(
            f"/api/admin/reject/{second_id}",
            json={"item_type": "product", "reason": "No clear photo"},
            headers=self.auth(self.admin_token),
        )
        self.assertEqual(rejected.status_code, 200)
        self.assertEqual(rejected.get_json()["data"]["status"], "rejected")
        self.assertEqual(rejected.get_json()["data"]["rejection_reason"], "No clear photo")

        # typing variant of approve/reject
        third = self.create_product(self.student_token, title="Third Item Here",
                                    description="Another item for testing purposes.")
        third_id = third.get_json()["data"]["id"]
        typed = self.client.post(
            f"/api/admin/product/{third_id}/approve", headers=self.auth(self.admin_token)
        )
        self.assertEqual(typed.status_code, 200)

    def test_product_update_delete_permissions(self):
        product_id = self.create_product(self.student_token).get_json()["data"]["id"]

        # another student cannot edit
        other_token = self._make_user("Other Student", "other@test.ng")
        forbidden = self.client.put(
            f"/api/products/{product_id}", json={"price": 100}, headers=self.auth(other_token)
        )
        self.assertEqual(forbidden.status_code, 403)

        # owner can
        updated = self.client.put(
            f"/api/products/{product_id}",
            json={"title": "Updated Calculator Title", "price": 3900},
            headers=self.auth(self.student_token),
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["data"]["price"], 3900)

        # admin can
        admin_update = self.client.put(
            f"/api/products/{product_id}", json={"price": 3500},
            headers=self.auth(self.admin_token),
        )
        self.assertEqual(admin_update.status_code, 200)

        # unknown id → 404
        self.assertEqual(
            self.client.delete("/api/products/9999", headers=self.auth(self.student_token)).status_code,
            404,
        )

        # owner delete
        deleted = self.client.delete(
            f"/api/products/{product_id}", headers=self.auth(self.student_token)
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertIsNone(db.session.get(Product, product_id))

    def test_product_filters_search_sort_and_pagination(self):
        # build 5 published products with distinct attributes
        samples = [
            ("Calculus Textbook", "books", 3000, "Angwan Rimi"),
            ("Physics Textbook", "books", 5000, "Akun"),
            ("Bluetooth Speaker", "electronics", 25000, "Mararaba"),
            ("Android Phone", "phones", 60000, "Tudun Amba"),
            ("Study Desk", "furniture", 12000, "Bukan Sidi"),
        ]
        ids = []
        for title, category, price, location in samples:
            response = self.create_product(
                self.student_token,
                title=title,
                description=f"{title} in good condition for students.",
                category=category,
                price=price,
                location=location,
            )
            ids.append(response.get_json()["data"]["id"])
        for product_id in ids:
            self.client.post(
                f"/api/admin/approve/{product_id}",
                json={"item_type": "product"},
                headers=self.auth(self.admin_token),
            )

        # category filter
        books = self.client.get("/api/products?category=books").get_json()["data"]
        self.assertEqual(len(books["items"]), 2)
        self.assertTrue(all(item["category"] == "books" for item in books["items"]))

        # price range
        cheap = self.client.get("/api/products?min_price=4000&max_price=26000").get_json()["data"]
        self.assertEqual(len(cheap["items"]), 3)

        # search
        search = self.client.get("/api/products?q=textbook").get_json()["data"]
        self.assertEqual(len(search["items"]), 2)

        # location filter
        loc = self.client.get("/api/products?location=Akun").get_json()["data"]
        self.assertEqual(len(loc["items"]), 1)
        self.assertEqual(loc["items"][0]["location"], "Akun")

        # sorting
        ascending = self.client.get("/api/products?sort=price").get_json()["data"]["items"]
        prices = [item["price"] for item in ascending]
        self.assertEqual(prices, sorted(prices))

        # pagination
        page = self.client.get("/api/products?per_page=2&page=2").get_json()["data"]
        self.assertEqual(page["pagination"]["per_page"], 2)
        self.assertEqual(page["pagination"]["page"], 2)
        self.assertEqual(len(page["items"]), 2)
        self.assertEqual(page["pagination"]["total"], 5)

        # categories endpoint
        categories = self.client.get("/api/products/categories").get_json()["data"]
        counts = {row["name"]: row["count"] for row in categories["categories"]}
        self.assertEqual(counts["books"], 2)

        # similar products
        first_book = self.client.get("/api/products?category=books").get_json()["data"]["items"][0]
        similar = self.client.get(f"/api/products/{first_book['id']}/similar").get_json()["data"]
        self.assertTrue(all(item["category"] == "books" for item in similar))

        # view counter increments on public detail view
        before = self.client.get(f"/api/products/{first_book['id']}").get_json()["data"]["views"]
        after = self.client.get(f"/api/products/{first_book['id']}").get_json()["data"]["views"]
        self.assertEqual(after, before + 1)

    def test_contact_details_only_for_logged_in_users(self):
        product_id = self.create_product(self.student_token).get_json()["data"]["id"]
        self.client.post(f"/api/admin/approve/{product_id}",
                         json={"item_type": "product"},
                         headers=self.auth(self.admin_token))

        public = self.client.get(f"/api/products/{product_id}").get_json()["data"]
        self.assertNotIn("phone", public["seller"])

        authed = self.client.get(
            f"/api/products/{product_id}", headers=self.auth(self.landlord_token)
        ).get_json()["data"]
        self.assertIn("phone", authed["seller"])

    # ------------------------------------------------------------------
    # Accommodation
    # ------------------------------------------------------------------
    def test_accommodation_crud_and_filters(self):
        payload = {
            "title": "Self Contain at Bukan Sidi",
            "description": "Neat self contain with private bathroom and steady water supply.",
            "location": "Bukan Sidi, Lafia",
            "price": 180000,
            "rooms": 1,
            "room_type": "self-contain",
            "gender": "any",
            "furnished": True,
            "amenities": ["Water supply", "Prepaid meter"],
        }
        created = self.client.post(
            "/api/accommodation", json=payload, headers=self.auth(self.landlord_token)
        )
        self.assertEqual(created.status_code, 201, created.get_json())
        listing = created.get_json()["data"]
        self.assertEqual(listing["status"], "pending")
        self.assertEqual(listing["amenities"], ["Water supply", "Prepaid meter"])

        # validation: missing price
        missing = self.client.post(
            "/api/accommodation",
            json={"title": "No price room", "location": "Lafia"},
            headers=self.auth(self.landlord_token),
        )
        self.assertEqual(missing.status_code, 422)

        listing_id = listing["id"]
        self.client.post(f"/api/admin/approve/{listing_id}",
                         json={"item_type": "accommodation"},
                         headers=self.auth(self.admin_token))

        # list + filters
        feed = self.client.get("/api/accommodation").get_json()["data"]
        self.assertEqual(len(feed["items"]), 1)

        by_type = self.client.get("/api/accommodation?room_type=self-contain").get_json()["data"]
        self.assertEqual(len(by_type["items"]), 1)

        none = self.client.get("/api/accommodation?room_type=hostel").get_json()["data"]
        self.assertEqual(len(none["items"]), 0)

        by_price = self.client.get("/api/accommodation?max_price=100000").get_json()["data"]
        self.assertEqual(len(by_price["items"]), 0)

        by_search = self.client.get("/api/accommodation?q=bukan").get_json()["data"]
        self.assertEqual(len(by_search["items"]), 1)

        by_gender = self.client.get("/api/accommodation?gender=male").get_json()["data"]
        self.assertEqual(len(by_gender["items"]), 1)   # gender "any" matches everyone

        # helper endpoints
        self.assertEqual(self.client.get("/api/accommodation/types").status_code, 200)
        self.assertEqual(self.client.get("/api/accommodation/locations").status_code, 200)
        self.assertEqual(self.client.get(f"/api/accommodation/{listing_id}").status_code, 200)

        # update + delete (owner)
        updated = self.client.put(
            f"/api/accommodation/{listing_id}",
            json={"price": 165000},
            headers=self.auth(self.landlord_token),
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["data"]["price"], 165000)

        deleted = self.client.delete(
            f"/api/accommodation/{listing_id}", headers=self.auth(self.landlord_token)
        )
        self.assertEqual(deleted.status_code, 200)

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------
    def test_event_crud_and_date_filters(self):
        from datetime import timedelta, timezone

        now = datetime.now(timezone.utc)
        soon = (now + timedelta(days=3)).strftime("%Y-%m-%dT10:00")
        later = (now + timedelta(days=30)).strftime("%Y-%m-%dT10:00")
        past = (now - timedelta(days=10)).strftime("%Y-%m-%dT10:00")

        for title, date, category in [
            ("Career Fair", soon, "career"),
            ("Tech Summit", later, "academic"),
            ("Old Party", past, "social"),
        ]:
            response = self.client.post(
                "/api/events",
                json={
                    "title": title,
                    "description": f"{title} details for all UNILAFIA students.",
                    "date": date,
                    "location": "UNILAFIA Auditorium",
                    "category": category,
                    "ticket_price": 0 if category != "social" else 1000,
                },
                headers=self.auth(self.student_token),
            )
            self.assertEqual(response.status_code, 201, response.get_json())
            self.client.post(
                f"/api/admin/approve/{response.get_json()['data']['id']}",
                json={"item_type": "event"},
                headers=self.auth(self.admin_token),
            )

        # invalid date
        bad = self.client.post(
            "/api/events",
            json={"title": "Bad Date Event", "description": "Testing invalid date handling.",
                  "date": "not-a-date", "location": "Lafia"},
            headers=self.auth(self.student_token),
        )
        self.assertEqual(bad.status_code, 422)

        all_events = self.client.get("/api/events").get_json()["data"]
        self.assertEqual(len(all_events["items"]), 3)

        upcoming = self.client.get("/api/events?upcoming=true").get_json()["data"]
        self.assertEqual(len(upcoming["items"]), 2)

        career = self.client.get("/api/events?category=career").get_json()["data"]
        self.assertEqual(len(career["items"]), 1)

        free = self.client.get("/api/events?free=true").get_json()["data"]
        self.assertEqual(len(free["items"]), 2)

        feed = self.client.get("/api/events/upcoming?limit=1").get_json()["data"]
        self.assertEqual(len(feed), 1)
        self.assertEqual(feed[0]["title"], "Career Fair")

        self.assertEqual(self.client.get("/api/events/stats").status_code, 200)

        # detail + edit + delete
        event_id = all_events["items"][0]["id"]
        self.assertEqual(self.client.get(f"/api/events/{event_id}").status_code, 200)
        edited = self.client.put(
            f"/api/events/{event_id}",
            json={"title": "Career Fair (Updated Venue)"},
            headers=self.auth(self.student_token),
        )
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(
            self.client.delete(f"/api/events/{event_id}",
                               headers=self.auth(self.student_token)).status_code,
            200,
        )

    # ------------------------------------------------------------------
    # Services
    # ------------------------------------------------------------------
    def test_services_flow(self):
        created = self.client.post(
            "/api/services",
            json={
                "title": "Laptop Repair Service",
                "description": "Screen replacement, battery and software repairs for students.",
                "category": "tech-repair",
                "price": 2500,
                "price_unit": "per job",
                "location": "Faculty of Science",
            },
            headers=self.auth(self.landlord_token),
        )
        self.assertEqual(created.status_code, 201, created.get_json())
        self.assertEqual(created.get_json()["data"]["status"], "pending")

        service_id = created.get_json()["data"]["id"]
        self.client.post(f"/api/admin/approve/{service_id}",
                         json={"item_type": "service"},
                         headers=self.auth(self.admin_token))

        listed = self.client.get("/api/services").get_json()["data"]
        self.assertEqual(len(listed["items"]), 1)
        self.assertTrue(all(item["type"] == "service" for item in listed["items"]))

        filtered = self.client.get("/api/services?category=tech-repair").get_json()["data"]
        self.assertEqual(len(filtered["items"]), 1)
        self.assertEqual(len(self.client.get("/api/services?category=laundry")
                             .get_json()["data"]["items"]), 0)

        self.assertEqual(self.client.get("/api/services/categories").status_code, 200)
        self.assertEqual(self.client.get(f"/api/services/{service_id}").status_code, 200)

        updated = self.client.put(
            f"/api/services/{service_id}",
            json={"price": 3000},
            headers=self.auth(self.landlord_token),
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(
            self.client.delete(f"/api/services/{service_id}",
                               headers=self.auth(self.landlord_token)).status_code,
            200,
        )

    # ------------------------------------------------------------------
    # Users, reviews, favourites
    # ------------------------------------------------------------------
    def test_user_profile_listings_and_reviews(self):
        product_id = self.create_product(self.student_token).get_json()["data"]["id"]
        self.client.post(f"/api/admin/approve/{product_id}",
                         json={"item_type": "product"},
                         headers=self.auth(self.admin_token))

        me = self.client.get("/api/auth/me", headers=self.auth(self.student_token)).get_json()["data"]
        user_id = me["user"]["id"]

        profile = self.client.get(f"/api/users/{user_id}").get_json()["data"]
        self.assertEqual(profile["name"], "Student Tester")
        self.assertEqual(profile["listings_count"]["products"], 1)
        self.assertNotIn("email", profile)

        own_profile = self.client.get(
            f"/api/users/{user_id}", headers=self.auth(self.student_token)
        ).get_json()["data"]
        self.assertIn("email", own_profile)
        self.assertTrue(own_profile["is_me"])

        listings = self.client.get(f"/api/users/{user_id}/listings").get_json()["data"]
        self.assertEqual(listings["counts"]["products"], 1)

        stats = self.client.get(f"/api/users/{user_id}/stats").get_json()["data"]
        self.assertEqual(stats["total_listings"], 1)

        # another user updates the profile via PUT /api/users/<id>
        ok = self.client.put(
            f"/api/users/{user_id}",
            json={"bio": "Updated bio for testing."},
            headers=self.auth(self.student_token),
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.get_json()["data"]["bio"], "Updated bio for testing.")

        forbidden = self.client.put(
            f"/api/users/{user_id}", json={"bio": "Hacked bio"},
            headers=self.auth(self.landlord_token),
        )
        self.assertEqual(forbidden.status_code, 403)

        # reviews
        bad_rating = self.client.post(
            f"/api/users/{user_id}/reviews", json={"rating": 9},
            headers=self.auth(self.landlord_token),
        )
        self.assertEqual(bad_rating.status_code, 422)

        review = self.client.post(
            f"/api/users/{user_id}/reviews",
            json={"rating": 5, "comment": "Fast delivery and honest seller.", "listing_type": "product"},
            headers=self.auth(self.landlord_token),
        )
        self.assertEqual(review.status_code, 201, review.get_json())
        self.assertEqual(review.get_json()["data"]["rating_average"], 5.0)

        # self-review rejected
        self_review = self.client.post(
            f"/api/users/{user_id}/reviews", json={"rating": 5},
            headers=self.auth(self.student_token),
        )
        self.assertEqual(self_review.status_code, 400)

        # updating the same review does not create a duplicate
        again = self.client.post(
            f"/api/users/{user_id}/reviews",
            json={"rating": 4, "comment": "Still good, minor delay."},
            headers=self.auth(self.landlord_token),
        )
        self.assertEqual(again.status_code, 201)
        reviews = self.client.get(f"/api/users/{user_id}/reviews").get_json()["data"]
        self.assertEqual(reviews["rating_count"], 1)
        self.assertEqual(reviews["rating_average"], 4.0)

    def test_favorites_toggle(self):
        product_id = self.create_product(self.student_token).get_json()["data"]["id"]
        headers = self.auth(self.landlord_token)

        # cannot favourite while logged out
        self.assertEqual(
            self.client.post("/api/favorites",
                             json={"item_type": "product", "item_id": product_id}).status_code,
            401,
        )

        saved = self.client.post("/api/favorites",
                                 json={"item_type": "product", "item_id": product_id},
                                 headers=headers)
        self.assertEqual(saved.status_code, 201)
        self.assertTrue(saved.get_json()["data"]["saved"])

        listing = self.client.get("/api/favorites", headers=headers).get_json()["data"]
        self.assertEqual(listing["total"], 1)
        self.assertEqual(listing["items"][0]["listing"]["id"], product_id)

        ids = self.client.get("/api/favorites/ids", headers=headers).get_json()["data"]
        self.assertEqual(ids["ids"]["product"], [product_id])

        # toggling again removes it
        removed = self.client.post("/api/favorites",
                                   json={"item_type": "product", "item_id": product_id},
                                   headers=headers)
        self.assertFalse(removed.get_json()["data"]["saved"])

        # explicit delete path + 404 for unknown listing
        self.assertEqual(
            self.client.delete(f"/api/favorites/product/{product_id}", headers=headers).status_code,
            404,
        )
        not_found = self.client.post(
            "/api/favorites", json={"item_type": "product", "item_id": 999999}, headers=headers
        )
        self.assertEqual(not_found.status_code, 404)
        bad_type = self.client.post(
            "/api/favorites", json={"item_type": "spaceship", "item_id": 1}, headers=headers
        )
        self.assertEqual(bad_type.status_code, 422)

    # ------------------------------------------------------------------
    # Admin user management & dashboards
    # ------------------------------------------------------------------
    def test_admin_dashboard_and_user_management(self):
        headers = self.auth(self.admin_token)

        stats = self.client.get("/api/admin/stats", headers=headers).get_json()["data"]
        self.assertEqual(stats["users"]["total"], 3)
        self.assertEqual(stats["users"]["admins"], 1)

        self.assertEqual(self.client.get("/api/admin/activity", headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/api/admin/all-listings", headers=headers).status_code, 200)

        users = self.client.get("/api/admin/users", headers=headers).get_json()["data"]
        self.assertEqual(users["pagination"]["total"], 3)
        student = next(u for u in users["items"] if u["email"] == "student@test.ng")

        search = self.client.get("/api/admin/users?q=landlord", headers=headers).get_json()["data"]
        self.assertEqual(search["pagination"]["total"], 1)

        by_type = self.client.get("/api/admin/users?user_type=student",
                                  headers=headers).get_json()["data"]
        self.assertEqual(by_type["pagination"]["total"], 1)

        self.assertEqual(
            self.client.get(f"/api/admin/users/{student['id']}", headers=headers).status_code, 200
        )

        # verify toggle
        verified = self.client.post(f"/api/admin/verify/{student['id']}", headers=headers)
        self.assertTrue(verified.get_json()["data"]["verified"])

        # suspend / reactivate
        suspended = self.client.post(f"/api/admin/suspend/{student['id']}", headers=headers)
        self.assertFalse(suspended.get_json()["data"]["is_active"])

        blocked = self.client.get("/api/auth/me", headers=self.auth(self.student_token))
        self.assertEqual(blocked.status_code, 403)

        self.client.post(f"/api/admin/suspend/{student['id']}", json={"active": True},
                         headers=headers)
        self.assertEqual(
            self.client.get("/api/auth/me", headers=self.auth(self.student_token)).status_code, 200
        )

        # promote / demote
        promoted = self.client.post(f"/api/admin/make-admin/{student['id']}", headers=headers)
        self.assertEqual(promoted.get_json()["data"]["user_type"], "admin")
        self.client.post(f"/api/admin/make-admin/{student['id']}",
                         json={"admin": False, "user_type": "student"}, headers=headers)

        # feature toggle on a listing
        product_id = self.create_product(self.student_token).get_json()["data"]["id"]
        featured = self.client.post(f"/api/admin/feature/product/{product_id}", headers=headers)
        self.assertTrue(featured.get_json()["data"]["featured"])

        # flag hides content
        flagged = self.client.post(
            f"/api/admin/flag/product/{product_id}", json={"reason": "Spam"}, headers=headers
        )
        self.assertEqual(flagged.get_json()["data"]["status"], "rejected")
        self.assertEqual(self.client.get(f"/api/products/{product_id}").status_code, 403)

        # health + hard delete
        self.assertEqual(self.client.get("/api/admin/health").status_code, 200)
        deleted = self.client.delete(f"/api/admin/listing/product/{product_id}", headers=headers)
        self.assertEqual(deleted.status_code, 200)

        # role guard: a student cannot reach admin routes
        self.assertEqual(
            self.client.get("/api/admin/stats", headers=self.auth(self.landlord_token)).status_code,
            403,
        )

    def test_admin_user_deletion(self):
        me = self.client.get("/api/auth/me", headers=self.auth(self.landlord_token)).get_json()["data"]
        deleted = self.client.delete(
            f"/api/users/{me['user']['id']}", headers=self.auth(self.admin_token)
        )
        self.assertEqual(deleted.status_code, 200)

    # ------------------------------------------------------------------
    # Search, uploads
    # ------------------------------------------------------------------
    def test_global_search(self):
        product_id = self.create_product(self.student_token, title="Unique Calculus Textbook",
                                         description="Rare calculus textbook for science students.").get_json()["data"]["id"]
        self.client.post(f"/api/admin/approve/{product_id}",
                         json={"item_type": "product"},
                         headers=self.auth(self.admin_token))

        empty = self.client.get("/api/search").get_json()["data"]
        self.assertEqual(empty["total"], 0)

        results = self.client.get("/api/search?q=calculus").get_json()["data"]
        self.assertEqual(len(results["products"]), 1)
        self.assertEqual(results["total"], 1)

    def test_image_upload_and_delete(self):
        headers = self.auth(self.student_token)
        self.assertEqual(self.client.post("/api/uploads/image").status_code, 401)

        response = self.client.post(
            "/api/uploads/image",
            data={"image": (io.BytesIO(PNG_BYTES), "my-photo.png")},
            headers=headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        payload = response.get_json()["data"]
        self.assertTrue(payload["url"].startswith("assets/uploads/"))
        saved_path = os.path.join(self.upload_dir, payload["filename"])
        self.assertTrue(os.path.isfile(saved_path))

        listed = self.client.get("/api/uploads", headers=headers).get_json()["data"]
        self.assertGreaterEqual(listed["total"], 1)

        # another user cannot delete it
        other_token = self._make_user("Upload Thief", "thief@test.ng")
        self.assertEqual(
            self.client.delete(f"/api/uploads/{payload['filename']}",
                               headers=self.auth(other_token)).status_code,
            403,
        )

        self.assertEqual(
            self.client.delete(f"/api/uploads/{payload['filename']}", headers=headers).status_code,
            200,
        )
        self.assertFalse(os.path.isfile(saved_path))

        # unsupported extension
        bad = self.client.post(
            "/api/uploads/image",
            data={"image": (io.BytesIO(b"#!/bin/sh"), "evil.sh")},
            headers=headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(bad.status_code, 422)

    def test_404_and_405_are_json(self):
        missing = self.client.get("/api/does-not-exist")
        self.assertEqual(missing.status_code, 404)
        self.assertFalse(missing.get_json()["success"])

        wrong_method = self.client.delete("/api/auth/login")
        self.assertEqual(wrong_method.status_code, 405)


# ---------------------------------------------------------------------------
# S3-compatible storage (the persistent upload path used on Vercel)
# ---------------------------------------------------------------------------
class FakeS3Client:
    """In-memory stand-in for the boto3 S3 client used by storage._s3_client."""

    def __init__(self):
        self.objects = {}  # key -> (body, content_type, last_modified)
        self.cache_controls = {}  # key -> CacheControl header (if any)

    def put_object(self, Bucket, Key, Body, ContentType, **extra):
        # ``extra`` absorbs options like CacheControl that the real client
        # accepts but the in-memory fake only needs to record.
        self.objects[Key] = (bytes(Body), ContentType, datetime.now(timezone.utc))
        if extra.get("CacheControl"):
            self.cache_controls[Key] = extra["CacheControl"]

    def list_objects_v2(self, Bucket, Prefix=None, MaxKeys=None,
                        ContinuationToken=None):
        contents = [
            {"Key": key, "Size": len(body), "LastModified": mtime}
            for key, (body, _type, mtime) in self.objects.items()
            if Prefix is None or key.startswith(Prefix)
        ]
        return {"Contents": contents}

    def head_object(self, Bucket, Key):
        from botocore.exceptions import ClientError

        if Key not in self.objects:
            raise ClientError(
                {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"
            )
        return {}

    def delete_object(self, Bucket, Key):
        self.objects.pop(Key, None)
        return {}


class UploadS3StorageTestCase(unittest.TestCase):
    """Upload endpoints against ``UPLOAD_STORAGE=s3`` (fake bucket).

    Validates the persistent-storage contract the production (Vercel)
    deployment relies on: objects land under the configured key prefix,
    the API returns absolute public URLs, listing is scoped per user and
    deletion removes the object.  Standalone (does not inherit from
    ``ApiTestCase``) because the parent's local-storage upload test
    asserts disk behaviour that does not apply to the S3 backend.
    """

    def setUp(self):
        self.upload_dir = os.path.join(PROJECT_ROOT, "frontend", "assets", "uploads")
        os.makedirs(self.upload_dir, exist_ok=True)
        self.app = create_app(TestingConfig)
        self.app.config.update(
            UPLOAD_STORAGE="s3",
            S3_ENDPOINT_URL="https://acme.r2.cloudflarestorage.com",
            S3_BUCKET="campus-market-uploads",
            S3_ACCESS_KEY_ID="test-key-id",
            S3_SECRET_ACCESS_KEY="test-secret",
            S3_REGION="auto",
            S3_PUBLIC_URL="https://pub-test.r2.dev",
            S3_KEY_PREFIX="uploads",
        )
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        self.client = self.app.test_client()

        self.student_token = self._make_user("S3 Student", "s3-student@test.ng")
        self.landlord_token = self._make_user(
            "S3 Landlord", "s3-landlord@test.ng", user_type="landlord"
        )

        self.fake_bucket = FakeS3Client()
        self._original_client_factory = storage._s3_client
        storage._s3_client = lambda: self.fake_bucket

    def tearDown(self):
        storage._s3_client = self._original_client_factory
        db.session.remove()
        db.drop_all()
        self.ctx.pop()

    # -- helpers -----------------------------------------------------------
    def _make_user(self, name, email, user_type="student"):
        response = self.client.post(
            "/api/auth/signup",
            json={
                "name": name,
                "email": email,
                "phone": "08031234567",
                "password": "Passw0rd123",
                "user_type": user_type,
            },
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.get_json()["data"]["access_token"]

    def _upload_png(self, token, name="photo.png"):
        return self.client.post(
            "/api/uploads/image",
            data={"image": (io.BytesIO(PNG_BYTES), name)},
            headers={"Authorization": f"Bearer {token}"},
            content_type="multipart/form-data",
        )

    def test_s3_upload_returns_absolute_public_url(self):
        response = self._upload_png(self.student_token)
        self.assertEqual(response.status_code, 201, response.get_json())
        payload = response.get_json()["data"]

        self.assertTrue(payload["url"].startswith("https://pub-test.r2.dev/uploads/"))
        self.assertEqual(payload["url"], payload["absolute_url"])
        self.assertGreater(payload["size_kb"], 0)

        key = f"uploads/{payload['filename']}"
        self.assertIn(key, self.fake_bucket.objects)
        body, content_type, _mtime = self.fake_bucket.objects[key]
        self.assertEqual(body, PNG_BYTES)
        self.assertEqual(content_type, "image/png")
        self.assertEqual(
            self.fake_bucket.cache_controls[key], "public, max-age=604800"
        )

        # nothing may land on the local disk when the S3 backend is active
        self.assertFalse(
            os.path.isfile(os.path.join(self.upload_dir, payload["filename"]))
        )

    def test_s3_list_is_scoped_per_user_and_deletion_removes_object(self):
        first = self._upload_png(self.student_token, "one.png").get_json()["data"]
        second = self._upload_png(self.student_token, "two.png").get_json()["data"]
        other = self._upload_png(self.landlord_token, "theirs.png").get_json()["data"]

        listed = self.client.get(
            "/api/uploads",
            headers={"Authorization": f"Bearer {self.student_token}"},
        ).get_json()["data"]
        self.assertEqual(listed["total"], 2)
        names = {item["filename"] for item in listed["items"]}
        self.assertEqual(
            names, {first["filename"], second["filename"]}
        )
        self.assertNotIn(other["filename"], names)
        self.assertTrue(all(
            item["url"].startswith("https://pub-test.r2.dev/uploads/")
            for item in listed["items"]
        ))

        # another user cannot delete the object
        self.assertEqual(
            self.client.delete(
                f"/api/uploads/{first['filename']}",
                headers={"Authorization": f"Bearer {self.landlord_token}"},
            ).status_code,
            403,
        )

        # owner deletes; the object disappears from the bucket
        self.assertEqual(
            self.client.delete(
                f"/api/uploads/{first['filename']}",
                headers={"Authorization": f"Bearer {self.student_token}"},
            ).status_code,
            200,
        )
        self.assertNotIn(f"uploads/{first['filename']}", self.fake_bucket.objects)
        self.assertIn(f"uploads/{second['filename']}", self.fake_bucket.objects)

        # deleting again → 404 (object no longer exists)
        self.assertEqual(
            self.client.delete(
                f"/api/uploads/{first['filename']}",
                headers={"Authorization": f"Bearer {self.student_token}"},
            ).status_code,
            404,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
