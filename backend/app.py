"""Campus Marketplace Flask application and local development commands."""
import logging
import os
from datetime import timedelta
from pathlib import Path

import click
from dotenv import load_dotenv
from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from flask_migrate import Migrate
from sqlalchemy import event

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

from .config import Config
from .extensions import bcrypt, db, jwt
from .models import Accommodation, Event, Product, TokenBlocklist, User, utcnow

FRONTEND_DIR = ROOT_DIR / "frontend"


def create_app(config_object=None):
    """Create and configure the Flask app. The same factory is used by tests."""
    app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
    app.config.from_object(Config)
    if config_object:
        if isinstance(config_object, dict):
            app.config.update(config_object)
        else:
            app.config.from_object(config_object)

    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)
    Path(ROOT_DIR / "instance").mkdir(parents=True, exist_ok=True)

    db.init_app(app)
    bcrypt.init_app(app)
    jwt.init_app(app)
    Migrate(app, db)
    CORS(app, resources={r"/api/*": {"origins": app.config.get("CORS_ORIGINS", ["*"])}})

    # Import only after extensions have been initialized to keep route imports simple.
    from .routes import (
        accommodation,
        admin,
        auth,
        events,
        favorites,
        products,
        services,
        users,
    )
    app.register_blueprint(auth.bp, url_prefix="/api/auth")
    app.register_blueprint(products.bp, url_prefix="/api/products")
    app.register_blueprint(accommodation.bp, url_prefix="/api/accommodation")
    app.register_blueprint(events.bp, url_prefix="/api/events")
    app.register_blueprint(services.bp, url_prefix="/api/services")
    app.register_blueprint(users.bp, url_prefix="/api/users")
    app.register_blueprint(favorites.bp, url_prefix="/api/favorites")
    app.register_blueprint(admin.bp, url_prefix="/api/admin")

    @jwt.token_in_blocklist_loader
    def is_token_revoked(_jwt_header, jwt_payload):
        return TokenBlocklist.query.filter_by(jti=jwt_payload["jti"]).first() is not None

    @jwt.unauthorized_loader
    def missing_token(reason):
        return jsonify({"error": "Authentication required.", "details": reason}), 401

    @jwt.invalid_token_loader
    def invalid_token(reason):
        return jsonify({"error": "Invalid authentication token.", "details": reason}), 401

    @jwt.expired_token_loader
    def expired_token(_jwt_header, _jwt_payload):
        return jsonify({"error": "Your session has expired. Please sign in again."}), 401

    @jwt.revoked_token_loader
    def revoked_token(_jwt_header, _jwt_payload):
        return jsonify({"error": "This session has been signed out. Please sign in again."}), 401

    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/uploads/<path:filename>")
    def uploaded_file(filename):
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "service": "Campus Marketplace API"})

    @app.errorhandler(413)
    def file_too_large(_error):
        return jsonify({"error": "Upload too large. Requests are limited to 8 MiB."}), 413

    @app.errorhandler(404)
    def not_found(error):
        if app.request_class and getattr(error, "name", None) == "Not Found":
            from flask import request
            if request.path.startswith("/api/"):
                return jsonify({"error": "API endpoint not found."}), 404
        return error

    @app.errorhandler(500)
    def server_error(_error):
        db.session.rollback()
        app.logger.exception("Unhandled server error")
        return jsonify({"error": "An unexpected server error occurred."}), 500

    @app.cli.command("create-admin")
    @click.option("--email", prompt=True, help="Administrator email address")
    @click.option("--name", prompt="Administrator name")
    @click.option("--phone", prompt="Contact phone")
    @click.password_option(confirmation_prompt=True)
    def create_admin(email, name, phone, password):
        """Create an administrator account without exposing admin signup publicly."""
        normalized_email = email.strip().lower()
        if User.query.filter_by(email=normalized_email).first():
            raise click.ClickException("A user with that email already exists.")
        if len(password) < 8:
            raise click.ClickException("Password must be at least 8 characters.")
        user = User(email=normalized_email, name=name.strip(), phone=phone.strip(), user_type="admin", verified=True)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        click.echo(f"Administrator created: {normalized_email}")

    @app.cli.command("seed-demo")
    def seed_demo():
        """Add clearly labelled sample campus listings for a local demonstration."""
        email = "demo.student@fulafia.edu.ng"
        user = User.query.filter_by(email=email).first()
        if user is None:
            user = User(name="Amina Yusuf", email=email, phone="+234 801 234 5678", verified=True,
                        bio="FULafia student and campus essentials seller.")
            user.set_password("Student123!")
            db.session.add(user)
            db.session.flush()
        if Product.query.filter_by(seller_id=user.id).count() == 0:
            db.session.add_all([
                Product(seller_id=user.id, title="Scientific calculator", description="Clean, fully working calculator. Ideal for lectures and exams.", price=18500, category="Electronics", location="Take-off Campus", status="published"),
                Product(seller_id=user.id, title="Campus reading desk", description="Compact study desk in good condition. Easy to move between rooms.", price=22000, category="Home & living", location="Permanent Site", status="published"),
                Product(seller_id=user.id, title="Organic chemistry textbook", description="A well-kept copy with clear notes and no missing pages.", price=9500, category="Books", location="Take-off Campus", status="published"),
                Product(seller_id=user.id, title="Wireless headphones", description="Comfortable Bluetooth headphones with a long-lasting battery.", price=27000, category="Electronics", location="Permanent Site", status="published"),
            ])
        if Accommodation.query.filter_by(landlord_id=user.id).count() == 0:
            db.session.add_all([
                Accommodation(landlord_id=user.id, title="Bright room near Take-off Campus", description="Secure student room with water access and a short walk to campus.", location="Take-off Campus", price=180000, rooms=1, room_type="room", status="published"),
                Accommodation(landlord_id=user.id, title="Shared student apartment", description="Two available rooms in a tidy shared apartment near local shops.", location="Lafia town", price=150000, rooms=2, room_type="shared", status="published"),
            ])
        if Event.query.filter_by(creator_id=user.id).count() == 0:
            db.session.add_all([
                Event(creator_id=user.id, title="FULafia founders' week meetup", description="Meet student founders, share ideas and connect with other builders.", date=utcnow() + timedelta(days=9), location="University Auditorium", category="Networking", status="published"),
                Event(creator_id=user.id, title="Saturday campus clean-up", description="Join fellow students for a friendly, one-hour campus clean-up.", date=utcnow() + timedelta(days=4), location="Take-off Campus", category="Community", status="published"),
            ])
        db.session.commit()
        click.echo("Demo listings are ready. Demo login: demo.student@fulafia.edu.ng / Student123!")

    # create_all makes a fresh development checkout immediately runnable. Production
    # schema changes should be managed with `flask --app backend.app db migrate`.
    with app.app_context():
        engine = db.engine
        if engine.dialect.name == "sqlite":
            @event.listens_for(engine, "connect")
            def enable_sqlite_foreign_keys(connection, _record):
                cursor = connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()
        db.create_all()

    app.logger.setLevel(logging.INFO)
    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_DEBUG", "0") == "1")
