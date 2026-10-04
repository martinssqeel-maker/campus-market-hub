"""
Shared Flask extension instances.

Keeping every extension in one module prevents circular imports between
``app.py``, ``models.py`` and the route blueprints.
"""

from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_sqlalchemy import SQLAlchemy

#: SQLAlchemy ORM handle used by every model / blueprint.
db = SQLAlchemy()

#: JWT manager (access + refresh tokens, blocklist support).
jwt = JWTManager()

#: Cross-Origin Resource Sharing – lets the frontend run on a different port
#: (e.g. VS Code Live Server on :5500) while still calling the API.
cors = CORS()
