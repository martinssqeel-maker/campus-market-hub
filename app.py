"""
Vercel / WSGI entrypoint for Campus Marketplace.

Vercel's Flask preset looks for a top-level ``app`` variable in ``app.py`` at
the repository root, and gunicorn on a VPS can use ``gunicorn "app:app"`` from
the same file. The Flask application itself lives in ``backend/app.py`` – this
module only makes it importable from the repository root.

``backend/app.py`` is loaded under a private module name on purpose: Vercel
imports *this* file as ``app``, so a plain ``from app import app`` here would
import itself (a circular import).

Local development keeps working exactly as before::

    python app.py                 # http://127.0.0.1:5000
    python app.py --seed          # create tables + demo data
    python app.py --reset         # drop everything and start clean

Deployment (managed PostgreSQL + S3-compatible storage) is documented in
``docs/DEPLOYMENT.md``.
"""

import importlib.util
import os
import sys

PROJECT_ROOT = os.path.abspath(os.path.dirname(__file__))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")

# ``backend/`` holds config.py, extensions.py, models.py, routes/, … so it must
# be importable before ``backend/app.py`` runs.
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Load environment variables before the configuration classes are read, so a
# local ``.env`` behaves like the Vercel dashboard. Real environment variables
# (Vercel) always win; ``backend/.env`` wins over the repository-root ``.env``.
try:
    from dotenv import load_dotenv
except ImportError:                     # pragma: no cover - python-dotenv is a dependency
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv(os.path.join(BACKEND_DIR, ".env"))
    load_dotenv(os.path.join(PROJECT_ROOT, ".env"))


def _load_backend_module():
    """Import ``backend/app.py`` without colliding with this module's name."""
    path = os.path.join(BACKEND_DIR, "app.py")
    spec = importlib.util.spec_from_file_location("campus_market_backend", path)
    if spec is None or spec.loader is None:          # pragma: no cover - defensive
        raise ImportError(f"Could not load the Flask app from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module                  # keep exactly one instance
    spec.loader.exec_module(module)
    return module


_backend = _load_backend_module()

#: The WSGI application Vercel, gunicorn and ``flask --app app`` look for.
app = _backend.app
#: Alias some WSGI servers expect.
application = app


if __name__ == "__main__":              # pragma: no cover - manual helper
    # ``python app.py`` at the repository root behaves like ``backend/app.py``.
    _backend.main()
