"""
Campus Marketplace – root Flask entry point.

This small module is the single WSGI entry point for the whole project:

* **Vercel** builds ``app.py`` as a serverless function (see ``vercel.json``)
  and proxies every ``/api/...`` request to it. Static pages are served
  directly from the generated ``public/`` folder, so the function only ever
  sees API traffic.
* **``flask --app app run`` / ``flask --app app init-db`` / ``flask --app app
  create-admin``** work from the project root because the CLI finds the
  module-level ``app`` object defined below.
* **``python app.py``** starts the development server with the same
  behaviour as ``cd backend && python app.py`` (tables are created if needed;
  no demo data and no auto-created accounts).

The real application factory lives in ``backend/app.py`` – this file only
wires paths and environment loading so the app can be imported from the
repository root.
"""

import os
import sys

from dotenv import load_dotenv

#: Absolute path of the repository root (the folder containing this file).
PROJECT_ROOT = os.path.abspath(os.path.dirname(__file__))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")

for _path in (PROJECT_ROOT, BACKEND_DIR):
    if _path not in sys.path:
        sys.path.insert(0, _path)

# Load a root-level .env (production-style variables such as FLASK_ENV,
# DATABASE_URL, SECRET_KEY, JWT_SECRET, UPLOAD_STORAGE, S3_*…).  Real
# environment variables always win, so on Vercel the dashboard values are
# used and this call is a no-op.  backend/app.py additionally loads
# backend/.env for the local-development workflow.
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

# NOTE: import ``extensions`` top-level (not ``backend.extensions``) so this is
# the *same* module object – and the same SQLAlchemy instance – that
# backend/app.py uses internally.  Importing it as ``backend.extensions``
# would create a second, unregistered SQLAlchemy instance.
from extensions import db

from backend.app import create_app

#: The WSGI application.  Vercel's Python runtime invokes this callable
#: directly for every proxied request.
app = create_app()


if __name__ == "__main__":
    # Convenience local server: creates the tables (if missing) and runs the
    # dev server.  Like every other entry point, it seeds nothing and creates
    # no accounts – use `flask --app app create-admin` for that.
    with app.app_context():
        db.create_all()
    app.run(
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_ENV", "development") != "production",
    )
