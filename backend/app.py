"""
Campus Marketplace – Flask application entry point.

Federal University of Lafia student marketplace:
products, accommodation, events and services with admin moderation.

Run (development)
-----------------
    cd backend
    python app.py                     # http://127.0.0.1:5000
    python app.py --seed              # create tables + demo data
    python app.py --reset             # drop everything and start clean

The app also serves the static frontend (``../frontend``) so that a single
``python app.py`` gives you a working website at http://localhost:5000 –
no separate web server needed (and no CORS problems in production).
"""

import argparse
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, request, send_from_directory
from werkzeug.exceptions import HTTPException

# ---------------------------------------------------------------------------
# Path setup – allows ``python backend/app.py`` from the project root too.
# ---------------------------------------------------------------------------
BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from config import Config, get_config            # noqa: E402
from extensions import cors, db, jwt            # noqa: E402
from models import TokenBlocklist, User         # noqa: E402
from routes import register_blueprints          # noqa: E402

FRONTEND_DIR = os.path.join(Config.PROJECT_ROOT, "frontend")


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
def configure_logging(app: Flask) -> None:
    """Console logging + a rotating file log in ``backend/logs``."""
    level = logging.DEBUG if app.config.get("DEBUG") else logging.INFO
    formatter = logging.Formatter(
        "[%(asctime)s] %(levelname)s in %(module)s: %(message)s", "%Y-%m-%d %H:%M:%S"
    )

    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(formatter)
    stream.setLevel(level)
    app.logger.addHandler(stream)
    app.logger.setLevel(level)

    try:
        log_dir = os.path.join(BACKEND_DIR, "logs")
        os.makedirs(log_dir, exist_ok=True)
        file_handler = RotatingFileHandler(
            os.path.join(log_dir, "campus-market.log"), maxBytes=1_000_000, backupCount=3
        )
        file_handler.setFormatter(formatter)
        file_handler.setLevel(logging.INFO)
        app.logger.addHandler(file_handler)
    except OSError:                       # read-only filesystem (some hosts)
        app.logger.warning("File logging disabled (cannot create logs directory)")


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------
def create_app(config_object=None) -> Flask:
    """Build and configure the Flask application."""
    app = Flask(
        __name__,
        static_folder=FRONTEND_DIR if os.path.isdir(FRONTEND_DIR) else None,
        static_url_path="",
    )
    app.config.from_object(config_object or get_config())

    # --- extensions --------------------------------------------------------
    db.init_app(app)
    jwt.init_app(app)

    origins = app.config["CORS_ORIGINS"]
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": origins if origins != "*" else "*"}},
        supports_credentials=False,
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    configure_logging(app)
    register_blueprints(app)
    register_error_handlers(app)
    register_static_routes(app)
    register_jwt_handlers(app)

    # --- health check + index ---------------------------------------------
    @app.route("/api")
    def api_index():
        """Small self-documenting landing page for the API root."""
        return jsonify(
            {
                "success": True,
                "message": "Campus Marketplace API v1.0.0 – Federal University of Lafia",
                "docs": {
                    "auth": [
                        "POST   /api/auth/signup",
                        "POST   /api/auth/login",
                        "POST   /api/auth/refresh",
                        "POST   /api/auth/logout",
                        "GET    /api/auth/me",
                    ],
                    "products": [
                        "GET    /api/products",
                        "POST   /api/products",
                        "GET    /api/products/<id>",
                        "PUT    /api/products/<id>",
                        "DELETE /api/products/<id>",
                    ],
                    "accommodation": [
                        "GET    /api/accommodation",
                        "POST   /api/accommodation",
                        "GET    /api/accommodation/<id>",
                    ],
                    "events": ["GET    /api/events", "POST   /api/events"],
                    "services": ["GET    /api/services", "POST   /api/services"],
                    "users": ["GET    /api/users/<id>", "PUT    /api/users/<id>"],
                    "admin": [
                        "GET    /api/admin/pending",
                        "POST   /api/admin/approve/<id>",
                        "POST   /api/admin/reject/<id>",
                        "GET    /api/admin/users",
                    ],
                    "misc": ["GET /api/health", "GET /api/stats", "GET /api/search?q="],
                },
            }
        )

    @app.cli.command("init-db")
    def init_db_command():                 # pragma: no cover - manual helper
        """``flask init-db`` – create the database tables."""
        with app.app_context():
            db.create_all()
        print("Database tables created.")

    return app


# ---------------------------------------------------------------------------
# Static frontend (single-server deployment)
# ---------------------------------------------------------------------------
def register_static_routes(app: Flask) -> None:
    """Serve the vanilla frontend straight from the Flask app."""

    @app.route("/")
    def index():
        index_file = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.isfile(index_file):
            return send_from_directory(FRONTEND_DIR, "index.html")
        return redirect("/api")

    @app.route("/<path:path>")
    def static_files(path: str):
        """Serve any static asset; unknown paths fall back to the API 404."""
        if path.startswith("api/"):
            return jsonify({"success": False, "message": "Endpoint not found"}), 404
        candidate = os.path.join(FRONTEND_DIR, path)
        if os.path.isfile(candidate):
            return send_from_directory(FRONTEND_DIR, path)
        # Friendly fallback: try ``<path>.html`` inside ``pages/``
        for fallback in (f"pages/{path}", f"pages/{path}.html", f"{path}.html"):
            if os.path.isfile(os.path.join(FRONTEND_DIR, fallback)):
                return send_from_directory(FRONTEND_DIR, fallback)
        return jsonify({"success": False, "message": f"Not found: /{path}"}), 404


# ---------------------------------------------------------------------------
# JWT callbacks
# ---------------------------------------------------------------------------
def register_jwt_handlers(app: Flask) -> None:
    """Custom JWT error payloads + revocation check."""

    @jwt.token_in_blocklist_loader
    def is_token_revoked(_jwt_header, jwt_payload) -> bool:
        jti = jwt_payload.get("jti")
        return (
            db.session.query(TokenBlocklist.id).filter_by(jti=jti).first() is not None
        )

    @jwt.revoked_token_loader
    def revoked_token(_jwt_header, _jwt_payload):
        return jsonify(
            {"success": False, "message": "This session has ended – please log in again"}
        ), 401

    @jwt.expired_token_loader
    def expired_token(_jwt_header, _jwt_payload):
        return jsonify(
            {"success": False, "message": "Your session has expired – please log in again",
             "code": "token_expired"}
        ), 401

    @jwt.invalid_token_loader
    def invalid_token(reason):
        return jsonify(
            {"success": False, "message": "Invalid authentication token", "reason": reason}
        ), 422

    @jwt.unauthorized_loader
    def missing_token(reason):
        return jsonify(
            {"success": False, "message": "Please log in to continue", "reason": reason}
        ), 401

    @jwt.user_lookup_loader
    def user_lookup(_jwt_header, jwt_payload):
        identity = jwt_payload.get("sub")
        try:
            return db.session.get(User, int(identity))
        except (TypeError, ValueError):
            return None

    @jwt.additional_claims_loader
    def add_claims(identity):
        """Attach role/name claims so the frontend can render the right UI."""
        try:
            user = db.session.get(User, int(identity))
        except (TypeError, ValueError):
            return {}
        if user is None:
            return {}
        return {"role": user.user_type, "name": user.name, "verified": user.verified}


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------
def register_error_handlers(app: Flask) -> None:
    """Every error returns clean JSON – the frontend never receives HTML."""

    @app.errorhandler(400)
    def bad_request(error):
        return jsonify({"success": False, "message": getattr(error, "description", "Bad request")}), 400

    @app.errorhandler(401)
    def unauthorized(error):
        return jsonify(
            {"success": False, "message": getattr(error, "description", "Please log in")}
        ), 401

    @app.errorhandler(403)
    def forbidden(error):
        return jsonify(
            {"success": False, "message": getattr(error, "description", "Access denied")}
        ), 403

    @app.errorhandler(404)
    def not_found(error):
        if request.path.startswith("/api"):
            return jsonify(
                {"success": False, "message": getattr(error, "description", "Resource not found")}
            ), 404
        # Non-API 404 → let the SPA-style fallback handle it.
        return jsonify({"success": False, "message": "Page not found"}), 404

    @app.errorhandler(405)
    def method_not_allowed(error):
        return jsonify(
            {"success": False, "message": f"Method {request.method} is not allowed on {request.path}"}
        ), 405

    @app.errorhandler(413)
    def payload_too_large(_error):
        limit_mb = app.config["MAX_CONTENT_LENGTH"] // (1024 * 1024)
        return jsonify(
            {"success": False, "message": f"File is too large. Maximum size is {limit_mb} MB"}
        ), 413

    @app.errorhandler(422)
    def unprocessable(error):
        return jsonify(
            {"success": False, "message": getattr(error, "description", "Invalid request")}
        ), 422

    @app.errorhandler(500)
    def internal_error(error):
        app.logger.exception("Unhandled server error: %s", error)
        db.session.rollback()
        message = "Something went wrong on our side. Please try again."
        if app.config.get("DEBUG"):
            message = f"Server error: {error}"
        return jsonify({"success": False, "message": message}), 500

    @app.errorhandler(Exception)
    def unhandled_exception(error):        # pragma: no cover - defensive
        if isinstance(error, HTTPException):
            return error
        app.logger.exception("Unhandled exception: %s", error)
        db.session.rollback()
        return jsonify({"success": False, "message": "Unexpected server error"}), 500

    @app.after_request
    def add_security_headers(response):
        """Lightweight hardening + cache hints for uploaded images."""
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "no-referrer-when-downgrade")
        if request.path.startswith("/assets/uploads"):
            response.headers["Cache-Control"] = "public, max-age=604800"
        return response


# ---------------------------------------------------------------------------
# Bootstrap helpers
# ---------------------------------------------------------------------------
def bootstrap(app: Flask, reset: bool = False, seed: bool = False) -> None:
    """Create tables (and optionally demo data) inside an app context."""
    with app.app_context():
        if reset:
            db.drop_all()
            print("Dropped all tables.")
        db.create_all()
        _ensure_admin(app)
        if seed:
            from seed_data import seed_database

            seed_database(app)


def _ensure_admin(app: Flask) -> None:
    """Make sure at least one administrator exists (needed for moderation)."""
    email = os.getenv("ADMIN_EMAIL", "admin@unilafia.edu.ng").lower()
    password = os.getenv("ADMIN_PASSWORD", "Admin@1234")

    admin = User.query.filter_by(email=email).first()
    if admin:
        if admin.user_type != "admin":
            admin.user_type = "admin"
            db.session.commit()
        return

    admin = User(
        name=os.getenv("ADMIN_NAME", "Campus Marketplace Admin"),
        email=email,
        phone=os.getenv("ADMIN_PHONE", "08030000000"),
        user_type="admin",
        verified=True,
        department="Student Affairs",
        location="Federal University of Lafia",
    )
    admin.set_password(password)
    db.session.add(admin)
    db.session.commit()
    app.logger.info("Created default administrator: %s", email)


#: Module-level app so ``flask --app app run`` and gunicorn both work.
app = create_app()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="Campus Marketplace API server")
    parser.add_argument("--host", default=os.getenv("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "5000")))
    parser.add_argument("--seed", action="store_true", help="insert demo data on start")
    parser.add_argument("--reset", action="store_true", help="drop and recreate all tables")
    parser.add_argument("--debug", action="store_true", default=os.getenv("FLASK_ENV") != "production")
    args = parser.parse_args()

    # The Werkzeug reloader re-executes this script in a child process, so run
    # the database bootstrap only once (in the parent) – otherwise every file
    # save would drop and re-seed the database.
    is_reloader_child = os.environ.get("WERKZEUG_RUN_MAIN") == "true"
    if not is_reloader_child:
        bootstrap(app, reset=args.reset, seed=args.seed or args.reset)

    app.run(host=args.host, port=args.port, debug=args.debug, use_reloader=args.debug)


if __name__ == "__main__":
    main()
