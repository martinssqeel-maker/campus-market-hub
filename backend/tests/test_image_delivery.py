"""
Tests for image *delivery* – the path a listing photo takes from the bucket to
an ``<img>`` tag, which is where "the file is in Supabase but nobody can see it"
originally broke.

Covered here:

* ``normalize_image_reference`` – whatever the client posts (public URL, signed
  URL, relative path, bare name) becomes one durable token in the database.
* ``storage.image_urls`` – that token becomes a URL a browser can load, using
  the storage configuration active *now*, so existing rows heal themselves.
* Supabase's two URL shapes: the signed S3 endpoint is never handed to a
  browser, and a private bucket still renders via ``/api/uploads/view``.
* ``GET /api/uploads/view/<ref>`` – streaming, presigned redirect, 404s and
  the path-traversal guard.

Run with the rest of the suite::

    python -m unittest discover -s backend/tests -v

Nothing touches the network: the bucket is an in-memory fake.
"""

import io
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
# ``backend`` is inserted last so that ``app`` resolves to ``backend/app.py``
# rather than the repository-root Vercel entrypoint, whichever runs first.
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, BACKEND_DIR)

from botocore.exceptions import ClientError                       # noqa: E402
from flask_jwt_extended import create_access_token                 # noqa: E402
from werkzeug.datastructures import FileStorage                    # noqa: E402

from app import create_app                                         # noqa: E402
from config import TestingConfig                                   # noqa: E402
from extensions import db                                          # noqa: E402
from models import Product, User                                   # noqa: E402
from storage import (                                              # noqa: E402
    LocalStorage,
    S3Storage,
    build_storage,
    image_urls,
    normalize_public_base,
    set_storage,
    supabase_public_base,
)
from utils.validators import ValidationError, normalize_image_reference  # noqa: E402

SUPABASE_REF = "abcd1234ef5678"
SUPABASE_HOST = f"https://{SUPABASE_REF}.supabase.co"
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000100ffff03000006"
    "0005574bd0a40000000049454e44ae426082"
)
#: The object name this app generates (``u<id>_<ts>_<rand>.<ext>``).
UPLOAD_NAME = "u3_1700000000_deadbeef.png"


def client_error(code, status, operation="GetObject"):
    return ClientError(
        {"Error": {"Code": code, "Message": code},
         "ResponseMetadata": {"HTTPStatusCode": status}},
        operation,
    )


class FakeS3Client:
    """In-memory stand-in for boto3's S3 client, including reads and presigning."""

    def __init__(self, public=False):
        self.objects = {}
        self.put_calls = []
        self.delete_calls = []
        self.get_calls = []
        self.presign_calls = []
        self.fail_with = None
        #: Mirrors Supabase's "Public bucket" checkbox / an R2 custom domain.
        self.public = public

    def _maybe_fail(self):
        if self.fail_with is not None:
            raise self.fail_with

    def put_object(self, Bucket, Key, Body, ContentType=None, CacheControl=None):
        self._maybe_fail()
        self.put_calls.append({"Bucket": Bucket, "Key": Key, "Body": Body,
                               "ContentType": ContentType})
        self.objects[(Bucket, Key)] = {
            "Body": Body,
            "ContentType": ContentType,
            "LastModified": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "ETag": '"etag-deadbeef"',
        }

    def head_object(self, Bucket, Key):
        self._maybe_fail()
        if (Bucket, Key) not in self.objects:
            raise client_error("404", 404, "HeadObject")
        return {"ContentLength": len(self.objects[(Bucket, Key)]["Body"])}

    def get_object(self, Bucket, Key):
        self.get_calls.append((Bucket, Key))
        self._maybe_fail()
        if (Bucket, Key) not in self.objects:
            raise client_error("NoSuchKey", 404)
        if not self.public and not getattr(self, "allow_private_reads", True):
            raise client_error("AccessDenied", 403)
        found = self.objects[(Bucket, Key)]
        return {"Body": io.BytesIO(found["Body"]), "ContentType": found["ContentType"],
                "ETag": found["ETag"], "ContentLength": len(found["Body"])}

    def delete_object(self, Bucket, Key):
        self._maybe_fail()
        self.delete_calls.append((Bucket, Key))
        self.objects.pop((Bucket, Key), None)

    def list_objects_v2(self, Bucket, Prefix, MaxKeys=1000):
        self._maybe_fail()
        return {"Contents": [
            {"Key": key, "Size": len(obj["Body"]), "LastModified": obj["LastModified"]}
            for (bucket, key), obj in self.objects.items()
            if bucket == Bucket and key.startswith(Prefix)
        ]}

    def generate_presigned_url(self, method, Params=None, ExpiresIn=3600, **kwargs):
        self._maybe_fail()
        params = Params or {}
        self.presign_calls.append({"method": method, "Params": params, "ExpiresIn": ExpiresIn})
        return (f"https://bucket.s3.example.com/{params['Key']}"
                f"?X-Amz-Expires={ExpiresIn}&X-Amz-Signature=deadbeef")


def supabase_storage(client, *, public_base=None, url_mode="auto", bucket="campus-market"):
    """Storage as configured for Supabase Storage's S3 gateway."""
    return S3Storage(
        bucket=bucket,
        prefix="uploads",
        region="us-east-1",
        endpoint_url=f"{SUPABASE_HOST}/storage/v1/s3",
        access_key_id="key-id",
        secret_access_key="secret",
        public_base_url=public_base,
        addressing_style="path",
        url_mode=url_mode,
        client=client,
    )


def r2_storage(client, *, public_base="https://pub-1a2b.r2.dev", url_mode="auto"):
    return S3Storage(
        bucket="campus-market",
        prefix="uploads",
        region="auto",
        endpoint_url="https://account.r2.cloudflarestorage.com",
        access_key_id="key-id",
        secret_access_key="secret",
        public_base_url=public_base,
        url_mode=url_mode,
        client=client,
    )


class TestAppMixin:
    """A Flask app with a fake bucket wired in, plus one verified student."""

    def build_app(self, storage):
        self.app = create_app(TestingConfig)
        self.app.config.update(UPLOAD_STORAGE="s3", UPLOAD_STORAGE_PERSISTENT=True)
        set_storage(self.app, storage)
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        self.user = User(name="Uploader", email="uploader@test.ng", phone="08031234567",
                         user_type="student", verified=True)
        self.user.set_password("Passw0rd123")
        db.session.add(self.user)
        db.session.commit()
        self.client = self.app.test_client()
        self.headers = {
            "Authorization": f"Bearer {create_access_token(identity=str(self.user.id))}"
        }

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.ctx.pop()


# ---------------------------------------------------------------------------
# Public-base correction
# ---------------------------------------------------------------------------
class PublicBaseTests(unittest.TestCase):
    """The exact misconfiguration behind "uploaded but invisible"."""

    def test_supabase_s3_endpoint_is_replaced_by_the_public_object_url(self):
        base, notice = normalize_public_base(
            f"{SUPABASE_HOST}/storage/v1/s3/campus-market", f"{SUPABASE_HOST}/storage/v1/s3",
            "campus-market",
        )
        self.assertEqual(base, f"{SUPABASE_HOST}/storage/v1/object/public/campus-market")
        self.assertIn("signed S3 endpoint", notice)

    def test_public_base_is_derived_from_the_endpoint_when_missing(self):
        base, notice = normalize_public_base(None, f"{SUPABASE_HOST}/storage/v1/s3", "media")
        self.assertEqual(base, f"{SUPABASE_HOST}/storage/v1/object/public/media")
        self.assertIn("derived", notice)

    def test_correct_public_base_is_left_alone(self):
        correct = f"{SUPABASE_HOST}/storage/v1/object/public/campus-market"
        base, notice = normalize_public_base(correct, f"{SUPABASE_HOST}/storage/v1/s3",
                                             "campus-market")
        self.assertEqual(base, correct)
        self.assertIsNone(notice)

    def test_a_base_on_the_signed_api_origin_is_not_trusted(self):
        """R2-style: the API origin needs credentials, so links must not use it."""
        base, notice = normalize_public_base(
            "https://acct.r2.cloudflarestorage.com/campus-market",
            "https://acct.r2.cloudflarestorage.com", "campus-market",
        )
        self.assertIsNone(base)
        self.assertIn("/api/uploads/view", notice)

    def test_custom_domain_is_trusted_as_is(self):
        base, notice = normalize_public_base("https://cdn.example.com",
                                             "https://acct.r2.cloudflarestorage.com", "bucket")
        self.assertEqual(base, "https://cdn.example.com")
        self.assertIsNone(notice)

    def test_supabase_public_base_helper(self):
        self.assertEqual(
            supabase_public_base(f"{SUPABASE_HOST}/storage/v1/s3", "media"),
            f"{SUPABASE_HOST}/storage/v1/object/public/media",
        )
        self.assertIsNone(supabase_public_base("https://cdn.example.com", "media"))

    def test_bucket_only_configuration_still_builds_a_backend(self):
        storage = build_storage({
            "UPLOAD_STORAGE": "s3",
            "S3_BUCKET": "campus-market",
            "S3_ENDPOINT_URL": f"{SUPABASE_HOST}/storage/v1/s3",
            "S3_ACCESS_KEY_ID": "k", "S3_SECRET_ACCESS_KEY": "s",
        })
        self.assertIsInstance(storage, S3Storage)
        self.assertEqual(
            storage.display_url(UPLOAD_NAME),
            f"{SUPABASE_HOST}/storage/v1/object/public/campus-market/uploads/{UPLOAD_NAME}",
        )


# ---------------------------------------------------------------------------
# Reference normalisation (write path)
# ---------------------------------------------------------------------------
class NormalizeReferenceTests(TestAppMixin, unittest.TestCase):
    def setUp(self):
        self.client_fake = FakeS3Client()
        self.build_app(supabase_storage(self.client_fake))

    def normalize(self, value):
        with self.app.app_context():
            return normalize_image_reference(value)

    def test_every_shape_we_have_ever_emitted_collapses_to_the_key(self):
        key = f"uploads/{UPLOAD_NAME}"
        variants = [
            UPLOAD_NAME,
            key,
            f"assets/uploads/{UPLOAD_NAME}",
            f"/api/uploads/view/{key}",
            f"{SUPABASE_HOST}/storage/v1/object/public/campus-market/{key}",
            f"{SUPABASE_HOST}/storage/v1/s3/campus-market/{key}",
            f"{SUPABASE_HOST}/storage/v1/s3/{key}",
            f"https://pub-1a2b.r2.dev/{key}?X-Amz-Signature=abc",
            f"/{key}",
        ]
        for variant in variants:
            with self.subTest(variant=variant):
                self.assertEqual(self.normalize(variant), key)

    def test_a_signed_url_is_never_stored(self):
        signed = (f"{SUPABASE_HOST}/storage/v1/s3/campus-market/uploads/{UPLOAD_NAME}"
                  "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=" + "a" * 64)
        self.assertEqual(self.normalize(signed), f"uploads/{UPLOAD_NAME}")
        self.assertLess(len(self.normalize(signed)), 300)

    def test_foreign_urls_and_static_assets_pass_through(self):
        for value in ("https://example.com/photos/room.jpg",
                      "assets/images/product-placeholder.svg",
                      "https://picsum.photos/seed/1/400/300"):
            with self.subTest(value=value):
                self.assertEqual(self.normalize(value), value)

    def test_blank_values_become_none(self):
        for value in ("", "   ", None):
            self.assertIsNone(self.normalize(value))

    def test_traversal_is_rejected(self):
        with self.assertRaises(ValidationError) as ctx:
            self.normalize(f"{SUPABASE_HOST}/storage/v1/s3/campus-market/../../etc/passwd")
        self.assertIn("image_url", ctx.exception.errors)

    def test_over_long_external_url_is_refused_not_truncated(self):
        long_url = "https://example.com/" + "a" * 1200 + ".png"
        with self.assertRaises(ValidationError) as ctx:
            self.normalize(long_url)
        self.assertIn("too long", str(ctx.exception.message).lower())

    def test_rows_written_for_another_project_or_prefix_still_resolve(self):
        """Moving bucket, project or prefix must not orphan existing photos.

        The upload name is unique by construction, so it is enough to find the
        object again in the *currently configured* bucket – the stale host in the
        stored URL is never followed.
        """
        moved = supabase_storage(self.client_fake)
        moved.bucket = "campus-media"
        moved.prefix = "media"
        moved.endpoint_url = "https://newhost.supabase.co/storage/v1/s3"
        moved.public_base_url = "https://newhost.supabase.co/storage/v1/object/public/campus-media"
        moved.public_base_notice = None
        set_storage(self.app, moved)
        stale = (f"{SUPABASE_HOST}/storage/v1/object/public/campus-market/uploads/{UPLOAD_NAME}")
        with self.app.app_context():
            self.assertEqual(normalize_image_reference(stale), f"media/{UPLOAD_NAME}")
            self.assertEqual(
                image_urls(stale)["image_url"],
                f"https://newhost.supabase.co/storage/v1/object/public/campus-media/media/{UPLOAD_NAME}",
            )

    def test_local_backend_stores_the_bare_name(self):
        with tempfile.TemporaryDirectory() as folder:
            local = LocalStorage(folder, public_prefix="assets/uploads")
            set_storage(self.app, local)
            with self.app.app_context():
                stored = normalize_image_reference(f"assets/uploads/{UPLOAD_NAME}")
                self.assertEqual(stored, UPLOAD_NAME)
                self.assertEqual(
                    image_urls(stored)["image_url"], f"assets/uploads/{UPLOAD_NAME}"
                )


# ---------------------------------------------------------------------------
# Display URLs (read path)
# ---------------------------------------------------------------------------
class ImageUrlsTests(TestAppMixin, unittest.TestCase):
    def setUp(self):
        self.client_fake = FakeS3Client()
        self.build_app(supabase_storage(self.client_fake))

    def urls_for(self, value):
        with self.app.app_context():
            return image_urls(value)

    def test_legacy_broken_urls_render_again_without_a_data_migration(self):
        """Rows written while the misconfigured base was active heal themselves."""
        broken = f"{SUPABASE_HOST}/storage/v1/s3/uploads/{UPLOAD_NAME}"
        good = f"{SUPABASE_HOST}/storage/v1/object/public/campus-market/uploads/{UPLOAD_NAME}"
        resolved = self.urls_for(broken)
        self.assertEqual(resolved["image_url"], good)
        self.assertEqual(resolved["image_fallback_url"], f"/api/uploads/view/uploads/{UPLOAD_NAME}")

    def test_private_bucket_falls_back_to_the_api_route(self):
        """No public domain at all (bucket left private) still yields an <img> src."""
        storage = supabase_storage(self.client_fake, public_base="")
        storage.public_base_url = ""                      # simulate: not public
        set_storage(self.app, storage)
        resolved = self.urls_for(f"uploads/{UPLOAD_NAME}")
        self.assertEqual(resolved["image_url"], f"/api/uploads/view/uploads/{UPLOAD_NAME}")
        self.assertEqual(resolved["image_fallback_url"], f"/api/uploads/view/uploads/{UPLOAD_NAME}")

    def test_proxy_mode_never_links_the_bucket_directly(self):
        """UPLOAD_URL_MODE=proxy keeps a bucket completely private."""
        set_storage(self.app, r2_storage(self.client_fake, url_mode="proxy"))
        resolved = self.urls_for(f"uploads/{UPLOAD_NAME}")
        self.assertEqual(resolved["image_url"], f"/api/uploads/view/uploads/{UPLOAD_NAME}")

    def test_public_bucket_links_are_used_when_configured(self):
        set_storage(self.app, r2_storage(self.client_fake))
        resolved = self.urls_for(f"uploads/{UPLOAD_NAME}")
        self.assertEqual(resolved["image_url"], f"https://pub-1a2b.r2.dev/uploads/{UPLOAD_NAME}")
        self.assertEqual(resolved["image_fallback_url"], f"/api/uploads/view/uploads/{UPLOAD_NAME}")

    def test_foreign_and_static_references_are_untouched(self):
        for value in ("https://example.com/x.jpg", "assets/images/logo.svg"):
            with self.subTest(value=value):
                resolved = self.urls_for(value)
                self.assertEqual(resolved["image_url"], value)
                self.assertIsNone(resolved["image_fallback_url"])

    def test_empty_is_empty(self):
        self.assertEqual(self.urls_for(None), {"image_url": None, "image_fallback_url": None})


# ---------------------------------------------------------------------------
# /api/uploads/view
# ---------------------------------------------------------------------------
class NoRequestContextTests(unittest.TestCase):
    """CLI, seeds and admin scripts run with no app – nothing may crash."""

    def test_outside_a_request_the_token_is_returned(self):
        self.assertEqual(image_urls(f"uploads/{UPLOAD_NAME}")["image_url"],
                         f"uploads/{UPLOAD_NAME}")
        self.assertIsNone(image_urls(f"uploads/{UPLOAD_NAME}")["image_fallback_url"])

    def test_normalising_without_a_request_keeps_the_value(self):
        # No configured backend to interpret it, so the reference is kept as-is.
        self.assertEqual(normalize_image_reference(f"assets/uploads/{UPLOAD_NAME}"),
                         f"assets/uploads/{UPLOAD_NAME}")


class ServeImageTests(TestAppMixin, unittest.TestCase):
    def setUp(self):
        self.client_fake = FakeS3Client()
        self.build_app(supabase_storage(self.client_fake))
        self.client_fake.put_object(
            Bucket="campus-market", Key=f"uploads/{UPLOAD_NAME}", Body=PNG_BYTES,
            ContentType="image/png",
        )

    def test_streams_the_object_with_cache_headers(self):
        response = self.client.get(f"/api/uploads/view/uploads/{UPLOAD_NAME}")
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.data, PNG_BYTES)
        self.assertEqual(response.headers["Content-Type"], "image/png")
        self.assertIn("immutable", response.headers["Cache-Control"])
        self.assertEqual(response.headers["ETag"], '"etag-deadbeef"')
        self.assertIn(("campus-market", f"uploads/{UPLOAD_NAME}"), self.client_fake.get_calls)

    def test_resolves_every_reference_shape(self):
        references = [
            UPLOAD_NAME,
            f"uploads/{UPLOAD_NAME}",
            f"assets/uploads/{UPLOAD_NAME}",
            f"https://pub-1a2b.r2.dev/uploads/{UPLOAD_NAME}",
            f"{SUPABASE_HOST}/storage/v1/object/public/campus-market/uploads/{UPLOAD_NAME}",
            f"{SUPABASE_HOST}/storage/v1/s3/uploads/{UPLOAD_NAME}",
        ]
        for reference in references:
            with self.subTest(reference=reference):
                response = self.client.get(f"/api/uploads/view/{reference}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, PNG_BYTES)

    def test_conditional_request_short_circuits(self):
        response = self.client.get(
            f"/api/uploads/view/uploads/{UPLOAD_NAME}", headers={"If-None-Match": '"etag-deadbeef"'}
        )
        self.assertEqual(response.status_code, 304)

    def test_missing_object_is_a_json_404(self):
        response = self.client.get("/api/uploads/view/uploads/u3_1_00000000.png")
        self.assertEqual(response.status_code, 404)
        self.assertFalse(response.get_json()["success"])

    def test_paths_outside_the_upload_prefix_are_refused(self):
        for reference in ("secret.pdf", "docs/private.png", "a/b/c/../../x.png",
                          "https://evil.example.com/x.png"):
            with self.subTest(reference=reference):
                response = self.client.get(f"/api/uploads/view/{reference}")
                self.assertIn(response.status_code, (400, 404))
        self.assertEqual(self.client_fake.get_calls, [],
                         "refused references must not reach the bucket at all")

    def test_non_image_extensions_are_refused(self):
        self.client_fake.put_object(Bucket="campus-market", Key="uploads/shell.png.sh",
                                    Body=b"#!/bin/sh", ContentType="text/plain")
        response = self.client.get("/api/uploads/view/uploads/shell.png.sh")
        self.assertIn(response.status_code, (400, 404))

    def test_public_route_needs_no_token(self):
        response = self.client.get(f"/api/uploads/view/uploads/{UPLOAD_NAME}")
        self.assertEqual(response.status_code, 200)

    def test_redirect_mode_hands_the_browser_a_presigned_url(self):
        self.app.config["UPLOAD_PROXY_MODE"] = "redirect"
        response = self.client.get(f"/api/uploads/view/uploads/{UPLOAD_NAME}")
        self.assertEqual(response.status_code, 302)
        self.assertIn("X-Amz-Signature", response.headers["Location"])
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertEqual(self.client_fake.presign_calls[0]["Params"]["Key"],
                         f"uploads/{UPLOAD_NAME}")
        self.client_fake.get_calls.clear()

    def test_streaming_is_used_when_presigning_fails(self):
        self.app.config["UPLOAD_PROXY_MODE"] = "redirect"

        def explode(*args, **kwargs):
            raise client_error("CredentialsError", 403)

        self.client_fake.generate_presigned_url = explode
        response = self.client.get(f"/api/uploads/view/uploads/{UPLOAD_NAME}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, PNG_BYTES)

    def test_bucket_errors_become_a_clear_503(self):
        self.client_fake.fail_with = client_error("AccessDenied", 403)
        response = self.client.get(f"/api/uploads/view/uploads/{UPLOAD_NAME}")
        self.assertEqual(response.status_code, 503)
        self.assertIn("S3_ACCESS_KEY_ID", response.get_json()["message"])

    def test_local_storage_is_served_through_the_same_route(self):
        with tempfile.TemporaryDirectory() as folder:
            local = LocalStorage(folder, public_prefix="assets/uploads")
            local.save(FileStorage(io.BytesIO(PNG_BYTES), "photo.png", content_type="image/png"),
                       UPLOAD_NAME)
            set_storage(self.app, local)
            response = self.client.get(f"/api/uploads/view/{UPLOAD_NAME}")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data, PNG_BYTES)
            missing = self.client.get("/api/uploads/view/u3_9_99999999_zzzzzzzz.png")
            self.assertEqual(missing.status_code, 404)


# ---------------------------------------------------------------------------
# The listing round-trip a student actually performs
# ---------------------------------------------------------------------------
class ListingRoundTripTests(TestAppMixin, unittest.TestCase):
    def setUp(self):
        self.client_fake = FakeS3Client()
        self.build_app(supabase_storage(self.client_fake))

    def post_listing(self, image_value):
        return self.client.post(
            "/api/products",
            json={"title": "Second-hand calculator", "description": "Casio fx-991, used for "
                  "two semesters and still accurate.", "price": 8500, "image_url": image_value},
            headers=self.headers,
        )

    def test_upload_then_post_stores_a_key_and_renders_a_working_url(self):
        upload = self.client.post(
            "/api/uploads/image",
            data={"image": (io.BytesIO(PNG_BYTES), "calc.png")},
            headers=self.headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 201, upload.get_json())
        payload = upload.get_json()["data"]
        # The browser is given a URL it can load, and the row keeps the key.
        self.assertEqual(payload["reference"], f"uploads/{payload['filename']}")
        self.assertTrue(payload["url"].startswith(SUPABASE_HOST))
        self.assertTrue(payload["proxy_url"].startswith("/api/uploads/view/"))

        created = self.post_listing(payload["url"])
        self.assertEqual(created.status_code, 201, created.get_json())
        product_id = created.get_json()["data"]["id"]

        stored = db.session.get(Product, product_id)
        self.assertEqual(stored.image_url, f"uploads/{payload['filename']}")
        self.assertNotIn("supabase.co", stored.image_url)

        # Listings start as "pending", so read it back as its owner.
        listing = self.client.get(f"/api/products/{product_id}", headers=self.headers).get_json()["data"]
        self.assertEqual(
            listing["image_url"],
            f"{SUPABASE_HOST}/storage/v1/object/public/campus-market/uploads/{payload['filename']}",
        )
        self.assertEqual(listing["image_fallback_url"],
                         f"/api/uploads/view/uploads/{payload['filename']}")

    def test_pasting_a_full_public_url_is_accepted_and_shortened(self):
        key = f"uploads/{UPLOAD_NAME}"
        created = self.post_listing(
            f"{SUPABASE_HOST}/storage/v1/object/public/campus-market/{key}")
        self.assertEqual(created.status_code, 201, created.get_json())
        self.assertEqual(db.session.get(Product, created.get_json()["data"]["id"]).image_url, key)

    def test_images_survive_a_provider_change(self):
        """Switching to a private bucket only changes the emitted URL, not the data."""
        created = self.post_listing(f"uploads/{UPLOAD_NAME}")
        product_id = created.get_json()["data"]["id"]

        private = supabase_storage(self.client_fake, public_base="")
        private.public_base_url = ""
        set_storage(self.app, private)

        listing = self.client.get(f"/api/products/{product_id}", headers=self.headers).get_json()["data"]
        self.assertEqual(listing["image_url"], f"/api/uploads/view/uploads/{UPLOAD_NAME}")

    def test_profile_avatar_uses_the_same_rule(self):
        response = self.client.put(
            "/api/auth/me",
            json={"avatar_url": f"{SUPABASE_HOST}/storage/v1/s3/uploads/{UPLOAD_NAME}"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["data"]["avatar_url"],
                         f"{SUPABASE_HOST}/storage/v1/object/public/campus-market"
                         f"/uploads/{UPLOAD_NAME}")
        self.assertEqual(db.session.get(User, self.user.id).avatar_url, f"uploads/{UPLOAD_NAME}")

    def test_health_explains_the_image_setup(self):
        health = self.client.get("/api/health").get_json()["data"]
        self.assertEqual(health["images"]["delivery"], "bucket")
        self.assertEqual(health["images"]["url_mode"], "auto")
        self.assertIn("public", health["images"]["hint"])
        self.assertEqual(health["images"]["problems"], [])

    def test_health_flags_ephemeral_local_uploads(self):
        with tempfile.TemporaryDirectory() as folder:
            set_storage(self.app, LocalStorage(folder, persistent=False))
            health = self.client.get("/api/health").get_json()["data"]
            self.assertEqual(health["status"], "ok")
            self.assertTrue(any("UPLOAD_STORAGE=s3" in problem
                                for problem in health["images"]["problems"]))


class S3AddressingStyleTests(unittest.TestCase):
    """Virtual-hosted buckets (AWS) must not be mistaken for public domains."""

    def test_virtual_hosted_public_url_is_recognised_as_ours(self):
        storage = S3Storage(
            bucket="campus-market", prefix="uploads", region="us-east-1",
            endpoint_url="https://s3.us-east-1.amazonaws.com",
            access_key_id="k", secret_access_key="s",
            public_base_url="https://campus-market.s3.us-east-1.amazonaws.com",
        )
        self.assertTrue(storage.owns(
            f"https://campus-market.s3.us-east-1.amazonaws.com/uploads/{UPLOAD_NAME}"))
        self.assertEqual(storage.key_for_reference(
            f"https://campus-market.s3.us-east-1.amazonaws.com/uploads/{UPLOAD_NAME}"),
            f"uploads/{UPLOAD_NAME}")


if __name__ == "__main__":
    unittest.main()
