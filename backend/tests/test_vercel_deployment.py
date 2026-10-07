"""
Tests for the Vercel hosting layer: database URL handling, upload storage
backends (local disk and S3-compatible buckets), the static build script and
the repository-root WSGI entrypoint.

Run with the rest of the suite::

    python -m unittest discover -s backend/tests -v

Nothing here touches the network: the S3 backend is exercised through a fake
boto3 client, and the build script writes into a temporary directory.
"""

import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, os.pardir))
sys.path.insert(0, BACKEND_DIR)
sys.path.insert(0, PROJECT_ROOT)

from botocore.exceptions import ClientError                      # noqa: E402
from flask import Flask                                          # noqa: E402
from flask_jwt_extended import create_access_token               # noqa: E402
from werkzeug.datastructures import FileStorage                  # noqa: E402

import build_vercel                                              # noqa: E402
from backend.app import create_app                                # noqa: E402
from config import (                                             # noqa: E402
    TestingConfig,
    engine_options,
    normalize_database_url,
    resolve_max_upload_mb,
    resolve_upload_folder,
    secret_warnings,
    upload_storage_is_persistent,
)
from extensions import db                                        # noqa: E402
from models import User                                          # noqa: E402
from storage import (                                            # noqa: E402
    LocalStorage,
    S3Storage,
    StorageError,
    UnavailableStorage,
    build_storage,
    get_storage,
    set_storage,
)

#: Smallest valid PNG (1x1 pixel).
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000100ffff03000006"
    "0005574bd0a40000000049454e44ae426082"
)


def client_error(code, status):
    """Build the botocore ClientError the fake client raises."""
    return ClientError(
        {"Error": {"Code": code, "Message": code},
         "ResponseMetadata": {"HTTPStatusCode": status}},
        "HeadObject",
    )


class FakeS3Client:
    """Minimal in-memory stand-in for boto3's S3 client."""

    def __init__(self):
        self.objects = {}
        self.put_calls = []
        self.delete_calls = []
        self.fail_with = None

    def _maybe_fail(self):
        if self.fail_with is not None:
            raise self.fail_with

    # -- boto3 surface ------------------------------------------------------
    def put_object(self, Bucket, Key, Body, ContentType=None, CacheControl=None):
        self._maybe_fail()
        self.put_calls.append(
            {"Bucket": Bucket, "Key": Key, "Body": Body,
             "ContentType": ContentType, "CacheControl": CacheControl}
        )
        self.objects[(Bucket, Key)] = {
            "Body": Body,
            "LastModified": datetime(2026, 1, 1, tzinfo=timezone.utc),
        }

    def head_object(self, Bucket, Key):
        self._maybe_fail()
        if (Bucket, Key) not in self.objects:
            raise client_error("404", 404)
        return {"ContentLength": len(self.objects[(Bucket, Key)]["Body"])}

    def delete_object(self, Bucket, Key):
        self._maybe_fail()
        self.delete_calls.append((Bucket, Key))
        self.objects.pop((Bucket, Key), None)

    def list_objects_v2(self, Bucket, Prefix, MaxKeys=1000):
        self._maybe_fail()
        contents = [
            {"Key": key, "Size": len(obj["Body"]), "LastModified": obj["LastModified"]}
            for (bucket, key), obj in self.objects.items()
            if bucket == Bucket and key.startswith(Prefix)
        ]
        return {"Contents": contents}


def s3_storage(client, bucket="campus-market", prefix="uploads"):
    return S3Storage(
        bucket=bucket,
        prefix=prefix,
        region="auto",
        endpoint_url="https://account.r2.cloudflarestorage.com",
        access_key_id="key-id",
        secret_access_key="secret",
        public_base_url="https://cdn.example.com",
        client=client,
    )


# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------
class DatabaseUrlTests(unittest.TestCase):
    def test_postgres_urls_use_the_installed_psycopg_driver(self):
        self.assertEqual(
            normalize_database_url("postgres://u:p@host/db"),
            "postgresql+psycopg://u:p@host/db",
        )
        self.assertEqual(
            normalize_database_url("postgresql://u:p@host/db?sslmode=require"),
            "postgresql+psycopg://u:p@host/db?sslmode=require",
        )
        # Already explicit URLs are left alone.
        self.assertEqual(
            normalize_database_url("postgresql+psycopg://u:p@host/db"),
            "postgresql+psycopg://u:p@host/db",
        )

    def test_legacy_mysql_alias(self):
        self.assertEqual(
            normalize_database_url("mysql://u:p@host/db"),
            "mysql+pymysql://u:p@host/db",
        )

    def test_sqlite_and_empty_values(self):
        uri = "sqlite:///" + os.path.join(BACKEND_DIR, "database.db")
        self.assertEqual(normalize_database_url(uri), uri)
        self.assertIsNone(normalize_database_url(None))
        self.assertEqual(normalize_database_url(""), "")

    def test_engine_options(self):
        self.assertEqual(engine_options("sqlite:///:memory:"), {})
        postgres = engine_options("postgresql+psycopg://u:p@host/db")
        self.assertTrue(postgres["pool_pre_ping"])
        self.assertEqual(postgres["pool_recycle"], 280)
        self.assertEqual(postgres["connect_args"], {"connect_timeout": 10})
        mysql = engine_options("mysql+pymysql://u:p@host/db")
        self.assertTrue(mysql["pool_pre_ping"])
        self.assertNotIn("connect_args", mysql)


class UploadPathConfigurationTests(unittest.TestCase):
    def test_upload_folder_defaults_to_the_frontend_on_a_normal_host(self):
        folder = resolve_upload_folder({})
        self.assertEqual(folder, os.path.join(PROJECT_ROOT, "frontend", "assets", "uploads"))

    def test_upload_folder_falls_back_to_tmp_on_vercel(self):
        folder = resolve_upload_folder({"VERCEL": "1"})
        self.assertTrue(folder.startswith(tempfile.gettempdir() + os.sep))
        self.assertIn("campus-market", folder)

    def test_explicit_upload_folder_always_wins(self):
        self.assertEqual(resolve_upload_folder({"UPLOAD_FOLDER": "/data/uploads"}), "/data/uploads")
        self.assertEqual(
            resolve_upload_folder({"UPLOAD_FOLDER": "/data/uploads", "VERCEL": "1"}),
            "/data/uploads",
        )

    def test_only_s3_is_persistent_on_vercel(self):
        self.assertTrue(upload_storage_is_persistent("s3", {"VERCEL": "1"}))
        self.assertFalse(upload_storage_is_persistent("local", {"VERCEL": "1"}))
        self.assertTrue(upload_storage_is_persistent("local", {}))

    def test_max_upload_is_clamped_to_the_platform_limit(self):
        self.assertEqual(resolve_max_upload_mb({}), 5)
        self.assertEqual(resolve_max_upload_mb({"VERCEL": "1"}), 4)
        # Vercel rejects bodies over ~4.5 MB before Flask sees them.
        self.assertEqual(resolve_max_upload_mb({"VERCEL": "1", "MAX_UPLOAD_MB": "20"}), 4)
        self.assertEqual(resolve_max_upload_mb({"VERCEL": "1", "MAX_UPLOAD_MB": "2"}), 2)

    def test_secret_warnings(self):
        warnings = secret_warnings({})
        self.assertEqual(len(warnings), 2)
        self.assertEqual(secret_warnings({"SECRET_KEY": "s", "JWT_SECRET": "j"}), [])
        # The historical Flask-JWT-Extended name still counts.
        self.assertEqual(secret_warnings({"SECRET_KEY": "s", "JWT_SECRET_KEY": "j"}), [])


class StorageFactoryTests(unittest.TestCase):
    def test_default_backend_is_local(self):
        storage = build_storage({})
        self.assertIsInstance(storage, LocalStorage)
        self.assertTrue(storage.persistent)

    def test_unknown_backend_is_reported_not_crashed(self):
        storage = build_storage({"UPLOAD_STORAGE": "dropbox"})
        self.assertIsInstance(storage, UnavailableStorage)
        with self.assertRaises(StorageError) as ctx:
            storage.save(FileStorage(io.BytesIO(PNG_BYTES), "x.png"), "x.png")
        self.assertIn("local", str(ctx.exception))
        self.assertIn("s3", str(ctx.exception))

    def test_s3_requires_bucket_and_public_url(self):
        without_bucket = build_storage({"UPLOAD_STORAGE": "s3"})
        self.assertIsInstance(without_bucket, UnavailableStorage)
        self.assertIn("S3_BUCKET", without_bucket.describe()["error"])
        self.assertIn("S3_PUBLIC_BASE_URL", without_bucket.describe()["error"])

        without_public_url = build_storage(
            {"UPLOAD_STORAGE": "s3", "S3_BUCKET": "campus-market"}
        )
        self.assertIn("S3_PUBLIC_BASE_URL", without_public_url.describe()["error"])

    def test_s3_half_configured_credentials_are_rejected(self):
        storage = build_storage(
            {
                "UPLOAD_STORAGE": "s3",
                "S3_BUCKET": "campus-market",
                "S3_PUBLIC_BASE_URL": "https://cdn.example.com",
                "S3_ACCESS_KEY_ID": "only-the-key",
            }
        )
        self.assertIn("S3_SECRET_ACCESS_KEY", storage.describe()["error"])

    def test_complete_s3_configuration_builds_the_backend(self):
        storage = build_storage(
            {
                "UPLOAD_STORAGE": "s3",
                "S3_BUCKET": "campus-market",
                "S3_PREFIX": "uploads",
                "S3_REGION": "auto",
                "S3_ENDPOINT_URL": "https://account.r2.cloudflarestorage.com",
                "S3_ACCESS_KEY_ID": "key-id",
                "S3_SECRET_ACCESS_KEY": "secret",
                "S3_PUBLIC_BASE_URL": "https://cdn.example.com/",
            }
        )
        self.assertIsInstance(storage, S3Storage)
        description = storage.describe()
        self.assertEqual(description["bucket"], "campus-market")
        self.assertTrue(description["persistent"])
        # The trailing slash is normalised away before URLs are built.
        self.assertEqual(storage.url_for("uploads/a.png"), "https://cdn.example.com/uploads/a.png")


# ---------------------------------------------------------------------------
# Local disk backend
# ---------------------------------------------------------------------------
class LocalStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.storage = LocalStorage(self.tmp.name, public_prefix="assets/uploads")

    def test_save_list_delete_round_trip(self):
        file = FileStorage(io.BytesIO(PNG_BYTES), "photo.png", content_type="image/png")
        saved = self.storage.save(file, "u7_1699999_ab12cd34.png")

        self.assertEqual(saved["filename"], "u7_1699999_ab12cd34.png")
        self.assertEqual(saved["url"], "assets/uploads/u7_1699999_ab12cd34.png")
        self.assertEqual(saved["absolute_url"], "/assets/uploads/u7_1699999_ab12cd34.png")
        self.assertTrue(os.path.isfile(os.path.join(self.tmp.name, saved["filename"])))

        mine = self.storage.list_for_user(7)
        self.assertEqual([item["filename"] for item in mine], [saved["filename"]])
        self.assertEqual(self.storage.list_for_user(8), [])

        self.storage.delete(saved["filename"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, saved["filename"])))
        with self.assertRaises(FileNotFoundError):
            self.storage.delete(saved["filename"])

    def test_traversal_is_contained(self):
        path = self.storage.path_for("../../etc/passwd")
        self.assertTrue(path.startswith(os.path.abspath(self.tmp.name) + os.sep))
        with self.assertRaises(StorageError):
            self.storage.path_for("")

    def test_ephemeral_local_storage_is_flagged(self):
        storage = LocalStorage(self.tmp.name, persistent=False)
        self.assertIn("s3", storage.describe()["warning"])


# ---------------------------------------------------------------------------
# S3-compatible backend (fake client – no network)
# ---------------------------------------------------------------------------
class S3StorageTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeS3Client()
        self.storage = s3_storage(self.client)

    def test_save_uploads_an_object_and_returns_a_public_url(self):
        file = FileStorage(io.BytesIO(PNG_BYTES), "photo.png", content_type="image/png")
        saved = self.storage.save(file, "u3_1699999_deadbeef.png")

        self.assertEqual(len(self.client.put_calls), 1)
        call = self.client.put_calls[0]
        self.assertEqual(call["Bucket"], "campus-market")
        self.assertEqual(call["Key"], "uploads/u3_1699999_deadbeef.png")
        self.assertEqual(call["Body"], PNG_BYTES)
        self.assertEqual(call["ContentType"], "image/png")

        self.assertEqual(saved["url"], "https://cdn.example.com/uploads/u3_1699999_deadbeef.png")
        self.assertEqual(saved["absolute_url"], saved["url"])
        self.assertTrue(saved["size_kb"] > 0)
        self.assertEqual(saved["storage"], "s3")

    def test_list_filters_by_user_prefix_and_sorts_newest_first(self):
        for name, flavour in (("u1_a.png", "png"), ("u1_b.png", "png"), ("u2_c.png", "png")):
            self.storage.save(
                FileStorage(io.BytesIO(PNG_BYTES), name, content_type="image/png"), name
            )
        self.client.objects[("campus-market", "uploads/u1_a.png")]["LastModified"] = datetime(
            2026, 5, 1, tzinfo=timezone.utc
        )

        items = self.storage.list_for_user(1)
        self.assertEqual([item["filename"] for item in items], ["u1_a.png", "u1_b.png"])
        self.assertTrue(items[0]["url"].startswith("https://cdn.example.com/uploads/"))
        self.assertEqual(self.storage.list_for_user(3), [])

    def test_delete_removes_the_object_or_raises_file_not_found(self):
        self.storage.save(FileStorage(io.BytesIO(PNG_BYTES), "p.png"), "u3_x.png")
        self.assertTrue(self.storage.exists("u3_x.png"))

        self.storage.delete("u3_x.png")
        self.assertEqual(self.client.delete_calls, [("campus-market", "uploads/u3_x.png")])
        self.assertFalse(self.storage.exists("u3_x.png"))
        with self.assertRaises(FileNotFoundError):
            self.storage.delete("u3_x.png")

    def test_credentials_errors_are_translated(self):
        self.client.fail_with = client_error("AccessDenied", 403)
        with self.assertRaises(StorageError) as ctx:
            self.storage.save(FileStorage(io.BytesIO(PNG_BYTES), "p.png"), "u3_x.png")
        message = str(ctx.exception)
        self.assertIn("AccessDenied", message)
        self.assertIn("S3_ACCESS_KEY_ID", message)

    def test_key_traversal_is_flattened(self):
        self.assertEqual(self.storage.key_for("../../evil.sh"), "uploads/evil.sh")

    def test_real_boto3_client_is_configured_for_s3_compatible_services(self):
        """The fake client covers the logic; this covers ``_build_client``."""
        try:
            import boto3  # noqa: F401
        except ImportError:                        # pragma: no cover - optional extra
            self.skipTest("boto3 is not installed (only needed for UPLOAD_STORAGE=s3)")

        storage = S3Storage(
            bucket="campus-market",
            prefix="uploads",
            region="auto",
            endpoint_url="https://account.r2.cloudflarestorage.com",
            access_key_id="key-id",
            secret_access_key="secret",
            public_base_url="https://cdn.example.com",
            addressing_style="path",
        )
        client = storage.client
        self.assertEqual(client.meta.service_model.service_name, "s3")
        self.assertEqual(client.meta.endpoint_url, "https://account.r2.cloudflarestorage.com")
        self.assertEqual(client.meta.config.signature_version, "s3v4")
        self.assertEqual(client.meta.config.s3, {"addressing_style": "path"})


# ---------------------------------------------------------------------------
# Upload endpoints with the S3 backend
# ---------------------------------------------------------------------------
class UploadRouteS3Tests(unittest.TestCase):
    """The full HTTP path, with a fake boto3 client behind the S3 backend."""

    def setUp(self):
        self.app = create_app(TestingConfig)
        self.app.config.update(
            UPLOAD_STORAGE="s3",
            UPLOAD_STORAGE_PERSISTENT=True,
            S3_BUCKET="campus-market",
            S3_PREFIX="uploads",
            S3_PUBLIC_BASE_URL="https://cdn.example.com",
            S3_ENDPOINT_URL="https://account.r2.cloudflarestorage.com",
            S3_ACCESS_KEY_ID="key-id",
            S3_SECRET_ACCESS_KEY="secret",
        )
        self.fake_client = FakeS3Client()
        set_storage(self.app, s3_storage(self.fake_client))

        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        user = User(name="Uploader", email="uploader@test.ng", phone="08031234567",
                    user_type="student", verified=True)
        user.set_password("Passw0rd123")
        db.session.add(user)
        db.session.commit()

        self.client = self.app.test_client()
        self.headers = {"Authorization": f"Bearer {create_access_token(identity=str(user.id))}"}

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.ctx.pop()

    def test_upload_list_delete(self):
        response = self.client.post(
            "/api/uploads/image",
            data={"image": (io.BytesIO(PNG_BYTES), "my-photo.png")},
            headers=self.headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        payload = response.get_json()["data"]
        self.assertEqual(payload["storage"], "s3")
        self.assertTrue(payload["url"].startswith("https://cdn.example.com/uploads/u"))
        self.assertTrue(payload["url"].endswith(".png"))
        self.assertNotIn("warning", payload)

        listed = self.client.get("/api/uploads", headers=self.headers).get_json()["data"]
        self.assertEqual(listed["total"], 1)
        self.assertEqual(listed["items"][0]["filename"], payload["filename"])

        deleted = self.client.delete(f"/api/uploads/{payload['filename']}", headers=self.headers)
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.fake_client.objects, {})
        self.assertEqual(
            self.client.delete(f"/api/uploads/{payload['filename']}", headers=self.headers).status_code,
            404,
        )

    def test_path_traversal_delete_is_rejected(self):
        response = self.client.delete(
            "/api/uploads/..%2F..%2Fetc%2Fpasswd", headers=self.headers
        )
        self.assertEqual(response.status_code, 403)

    def test_invalid_extension_is_still_rejected(self):
        response = self.client.post(
            "/api/uploads/image",
            data={"image": (io.BytesIO(b"#!/bin/sh"), "evil.sh")},
            headers=self.headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.fake_client.put_calls, [])

    def test_storage_failures_return_503_with_an_actionable_message(self):
        self.fake_client.fail_with = client_error("AccessDenied", 403)
        response = self.client.post(
            "/api/uploads/image",
            data={"image": (io.BytesIO(PNG_BYTES), "photo.png")},
            headers=self.headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 503)
        self.assertIn("S3_ACCESS_KEY_ID", response.get_json()["message"])


class MisconfiguredStorageTests(unittest.TestCase):
    """A broken storage configuration must degrade gracefully – never crash."""

    def setUp(self):
        self.app = create_app(TestingConfig)
        self.app.config.update(UPLOAD_STORAGE="s3", S3_BUCKET=None, S3_PUBLIC_BASE_URL=None)
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        user = User(name="Uploader", email="uploader2@test.ng", phone="08031234567",
                    user_type="student", verified=True)
        user.set_password("Passw0rd123")
        db.session.add(user)
        db.session.commit()
        self.client = self.app.test_client()
        self.headers = {"Authorization": f"Bearer {create_access_token(identity=str(user.id))}"}

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.ctx.pop()

    def test_marketplace_keeps_working_and_health_explains_the_problem(self):
        health = self.client.get("/api/health").get_json()["data"]
        self.assertEqual(health["status"], "degraded")
        self.assertFalse(health["storage"]["configured"])
        self.assertIn("S3_BUCKET", health["storage"]["error"])

        upload = self.client.post(
            "/api/uploads/image",
            data={"image": (io.BytesIO(PNG_BYTES), "photo.png")},
            headers=self.headers,
            content_type="multipart/form-data",
        )
        self.assertEqual(upload.status_code, 503)
        self.assertIn("S3_BUCKET", upload.get_json()["message"])

        listing = self.client.get("/api/uploads", headers=self.headers)
        self.assertEqual(listing.status_code, 503)

    def test_storage_cache_rebuilds_when_the_configuration_changes(self):
        first = get_storage(self.app)
        self.app.config["UPLOAD_STORAGE"] = "local"
        self.app.config["UPLOAD_FOLDER"] = os.path.join(PROJECT_ROOT, "frontend", "assets", "uploads")
        second = get_storage(self.app)
        self.assertIsNot(first, second)
        self.assertEqual(second.backend, "local")


# ---------------------------------------------------------------------------
# Static build script
# ---------------------------------------------------------------------------
class BuildScriptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.output = os.path.join(self.tmp.name, "public")

    def test_build_publishes_the_frontend_without_user_uploads(self):
        summary = build_vercel.build(output=self.output)
        self.assertGreater(summary["files"], 10)

        for rel in ("index.html", "css/style.css", "js/api.js",
                    "js/marketplace.js", "pages/home.html",
                    "assets/images/logo.svg"):
            self.assertTrue(os.path.isfile(os.path.join(self.output, *rel.split("/"))), rel)
        self.assertFalse(os.path.exists(os.path.join(self.output, "assets", "uploads")))
        self.assertTrue(os.path.isfile(os.path.join(self.output, build_vercel.MARKER_NAME)))

        # A freshly built directory is in sync with the source …
        self.assertEqual(build_vercel.check(output=self.output), [])

        # … and --check reports drift instead of silently passing.
        with open(os.path.join(self.output, "extra.txt"), "w", encoding="utf-8") as handle:
            handle.write("stale")
        problems = build_vercel.check(output=self.output)
        self.assertIn("unexpected: extra.txt", problems)

    def test_rebuilding_replaces_generated_output(self):
        build_vercel.build(output=self.output)
        with open(os.path.join(self.output, "stale.txt"), "w", encoding="utf-8") as handle:
            handle.write("old")
        build_vercel.build(output=self.output)
        self.assertFalse(os.path.exists(os.path.join(self.output, "stale.txt")))

    def test_hand_written_directory_is_not_clobbered(self):
        os.makedirs(self.output)
        with open(os.path.join(self.output, "index.html"), "w", encoding="utf-8") as handle:
            handle.write("hand-made")
        with self.assertRaises(build_vercel.BuildError):
            build_vercel.build(output=self.output)
        build_vercel.build(output=self.output, force=True)
        self.assertTrue(os.path.isfile(os.path.join(self.output, build_vercel.MARKER_NAME)))

    def test_incomplete_source_is_rejected(self):
        empty = os.path.join(self.tmp.name, "empty")
        os.makedirs(empty)
        with self.assertRaises(build_vercel.BuildError) as ctx:
            build_vercel.build(source=empty, output=self.output)
        self.assertIn("incomplete", str(ctx.exception))

    def test_cli_exit_codes(self):
        self.assertEqual(build_vercel.main(["--output", self.output]), 0)
        self.assertEqual(build_vercel.main(["--check", "--output", self.output]), 0)
        missing = os.path.join(self.tmp.name, "not-built")
        self.assertEqual(build_vercel.main(["--check", "--output", missing]), 1)


# ---------------------------------------------------------------------------
# Repository-root entrypoint (what Vercel loads)
# ---------------------------------------------------------------------------
class RootEntrypointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = os.path.join(PROJECT_ROOT, "app.py")
        spec = importlib.util.spec_from_file_location("campus_market_root_entrypoint", path)
        cls.module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.module
        spec.loader.exec_module(cls.module)

    def test_exposes_wsgi_app(self):
        self.assertIsInstance(self.module.app, Flask)
        self.assertIs(self.module.application, self.module.app)

    def test_registers_the_api_and_health_route(self):
        rules = {rule.rule for rule in self.module.app.url_map.iter_rules()}
        self.assertIn("/api/health", rules)
        self.assertIn("/", rules)

    def test_single_backend_instance_is_shared(self):
        backend = sys.modules["campus_market_backend"]
        self.assertIs(backend.app, self.module.app)


class VercelRuntimeTests(unittest.TestCase):
    """Boot the entrypoint in a subprocess with Vercel's environment."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_entrypoint_boots_and_sanitises_paths_on_vercel(self):
        env = {
            **os.environ,
            "VERCEL": "1",
            "FLASK_ENV": "production",
            "SECRET_KEY": "test-secret",
            "JWT_SECRET": "test-jwt-secret",
            "DATABASE_URL": f"sqlite:///{os.path.join(self.tmp.name, 'vercel.db')}",
        }
        for name in ("UPLOAD_STORAGE", "S3_BUCKET", "S3_PUBLIC_BASE_URL", "MAX_UPLOAD_MB",
                     "UPLOAD_FOLDER", "JWT_SECRET_KEY"):
            env.pop(name, None)

        code = (
            "import app as entrypoint;"
            "c = entrypoint.app.config;"
            "print('RESULT', c['UPLOAD_STORAGE'], c['UPLOAD_STORAGE_PERSISTENT'],"
            " c['MAX_CONTENT_LENGTH'], c['UPLOAD_FOLDER'], c['DEBUG'])"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=PROJECT_ROOT, env=env, capture_output=True, text=True, timeout=180,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        line = [row for row in result.stdout.splitlines() if row.startswith("RESULT")][-1]
        backend, persistent, max_length, folder, debug = line.split()[1:]

        # Vercel's filesystem is read-only except /tmp: the app must not try to
        # write into the bundled frontend, and it must say that uploads are not
        # persistent (which /api/health also reports).
        self.assertEqual(backend, "local")
        self.assertEqual(persistent, "False")
        self.assertEqual(max_length, str(4 * 1024 * 1024))     # clamped to Vercel's cap
        self.assertTrue(folder.startswith(tempfile.gettempdir()))
        self.assertEqual(debug, "False")

    def test_entrypoint_boots_with_s3_configured(self):
        env = {
            **os.environ,
            "VERCEL": "1",
            "FLASK_ENV": "production",
            "SECRET_KEY": "test-secret",
            "JWT_SECRET": "test-jwt-secret",
            "DATABASE_URL": f"sqlite:///{os.path.join(self.tmp.name, 'vercel-s3.db')}",
            "UPLOAD_STORAGE": "s3",
            "S3_BUCKET": "campus-market",
            "S3_ENDPOINT_URL": "https://account.r2.cloudflarestorage.com",
            "S3_ACCESS_KEY_ID": "key-id",
            "S3_SECRET_ACCESS_KEY": "secret",
            "S3_PUBLIC_BASE_URL": "https://pub-abc123.r2.dev",
        }
        code = (
            "import app as entrypoint;"
            "print('RESULT', entrypoint.app.config['UPLOAD_STORAGE'],"
            " entrypoint.app.config['UPLOAD_STORAGE_PERSISTENT'])"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=PROJECT_ROOT, env=env, capture_output=True, text=True, timeout=180,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        line = [row for row in result.stdout.splitlines() if row.startswith("RESULT")][-1]
        self.assertEqual(line.split(), ["RESULT", "s3", "True"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
