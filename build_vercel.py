#!/usr/bin/env python3
"""
Prepare the repository for a Vercel deployment (and sanity-check the config).

What it does
------------
1. Validates ``vercel.json`` – it must be valid JSON that builds ``app.py``
   as a Python function and proxies ``/api`` to it.
2. Checks that the files Vercel needs are present (root ``app.py``,
   ``requirements.txt``, ``frontend/``).
3. Rebuilds ``public/`` – a clean copy of ``frontend/`` that Vercel serves
   as static files.  ``frontend/`` is the source of truth (you edit pages
   there); ``public/`` is a build artefact and is git-ignored.

Run it locally any time::

    python build_vercel.py
    python build_vercel.py --smoke     # also boot the app in-process and hit
                                       # /api/health (uses in-memory SQLite)

Vercel runs the same script automatically during every deployment via the
``buildCommand`` in ``vercel.json`` (without ``--smoke``, because the build
machine does not install the Python dependencies).
"""

import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(ROOT, "frontend")
PUBLIC_DIR = os.path.join(ROOT, "public")


def fail(message: str) -> None:
    print(f"✗ {message}")
    sys.exit(1)


def check_vercel_json() -> None:
    """vercel.json must build app.py as a function and route /api to it."""
    path = os.path.join(ROOT, "vercel.json")
    if not os.path.isfile(path):
        fail(f"missing {os.path.relpath(path, ROOT)}")
    try:
        with open(path, encoding="utf-8") as fh:
            config = json.load(fh)
    except json.JSONDecodeError as exc:
        fail(f"vercel.json is not valid JSON: {exc}")

    builds = config.get("builds", [])
    function_source = None
    for build in builds:
        if build.get("use") == "@vercel/python":
            function_source = build.get("src")
    if function_source != "app.py":
        fail('vercel.json must build "app.py" with the "@vercel/python" runtime')

    routes = config.get("routes", [])
    destinations = {route.get("dest") for route in routes}
    if "/app" not in destinations:
        fail('vercel.json routes must proxy the API to the "/app" function')
    if not any(str(route.get("src", "")).startswith("/api") for route in routes):
        fail("vercel.json routes must cover /api (e.g. \"/api/:path*\")")

    if "buildCommand" not in config:
        fail("vercel.json needs a buildCommand that regenerates public/")
    print(f"✓ vercel.json – function: {function_source}, build: {config['buildCommand']}")


def check_support_files() -> None:
    """Everything the Vercel build consumes must exist."""
    for name in ("app.py", "requirements.txt"):
        if not os.path.isfile(os.path.join(ROOT, name)):
            fail(f"missing {name}")
    if not os.path.isdir(FRONTEND_DIR):
        fail("missing frontend/")
    if not os.path.isfile(os.path.join(FRONTEND_DIR, "index.html")):
        fail("frontend/index.html not found – the frontend looks broken")
    print("✓ app.py, requirements.txt and frontend/ are present")


def rebuild_public() -> None:
    """Regenerate public/ as a clean copy of frontend/."""
    if os.path.isdir(PUBLIC_DIR):
        shutil.rmtree(PUBLIC_DIR)
    shutil.copytree(
        FRONTEND_DIR,
        PUBLIC_DIR,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    count = 0
    total = 0
    for _dirpath, _dirnames, filenames in os.walk(PUBLIC_DIR):
        for filename in filenames:
            count += 1
            total += os.path.getsize(os.path.join(_dirpath, filename))
    print(
        f"✓ public/ rebuilt from frontend/ – {count} files, "
        f"{total / 1024:.0f} KB"
    )


def smoke_test() -> None:
    """Boot the WSGI app in-process (in-memory SQLite) and hit /api/health."""
    os.environ["FLASK_ENV"] = "development"
    os.environ["DATABASE_URL"] = "sqlite:///:memory:"
    os.environ.pop("UPLOAD_STORAGE", None)

    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "campus_market_root_app", os.path.join(ROOT, "app.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    app = module.app
    if not callable(app):
        fail("root app.py does not expose a WSGI-callable `app`")
    with app.app_context():
        module.db.create_all()

    client = app.test_client()
    response = client.get("/api/health")
    payload = response.get_json() or {}
    if response.status_code != 200 or payload.get("success") is not True:
        fail(f"smoke test: GET /api/health -> {response.status_code} {payload}")
    database = payload.get("data", {}).get("database")
    if database != "connected":
        fail(f"smoke test: database check returned {database!r}")
    print("✓ WSGI smoke test – /api/health is 200 and the database is reachable")


def main() -> None:
    print("Building Vercel artefacts for Campus Marketplace\n")
    check_vercel_json()
    check_support_files()
    rebuild_public()
    if "--smoke" in sys.argv[1:]:
        smoke_test()
    print("\nDone. On Vercel: set FLASK_ENV, DATABASE_URL, SECRET_KEY, JWT_SECRET")
    print("(+ UPLOAD_STORAGE/S3_* for persistent images), run `flask --app app")
    print("init-db` and `flask --app app create-admin` against DATABASE_URL,")
    print("then deploy.  Full guide: docs/DEPLOYMENT_VERCEL.md")


if __name__ == "__main__":
    main()
