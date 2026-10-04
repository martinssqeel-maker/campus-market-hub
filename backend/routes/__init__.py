"""Blueprint registration for all API routes."""

from flask import Flask


def register_blueprints(app: Flask) -> None:
    """Attach every blueprint under the ``/api`` prefix (DRY registration)."""
    from routes.accommodation import accommodation_bp
    from routes.admin import admin_bp
    from routes.auth import auth_bp
    from routes.events import events_bp
    from routes.favorites import favorites_bp
    from routes.misc import misc_bp
    from routes.products import products_bp
    from routes.services import services_bp
    from routes.uploads import uploads_bp
    from routes.users import users_bp

    for blueprint in (
        auth_bp,
        products_bp,
        accommodation_bp,
        events_bp,
        services_bp,
        users_bp,
        favorites_bp,
        admin_bp,
        uploads_bp,
        misc_bp,
    ):
        app.register_blueprint(blueprint, url_prefix="/api")
