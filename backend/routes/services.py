"""Student-to-student services directory endpoints."""
from decimal import Decimal, InvalidOperation

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required, verify_jwt_in_request
from sqlalchemy import or_

from ..extensions import db
from ..models import Favorite, Service, User
from .common import (
    api_error,
    clean_text,
    listing_response,
    pagination_args,
    payload_data,
    positive_price,
    remove_uploaded_image,
    save_uploaded_image,
)

bp = Blueprint("services", __name__)


def _user():
    try:
        return db.session.get(User, int(get_jwt_identity()))
    except (TypeError, ValueError):
        return None


@bp.get("")
def list_services():
    query = Service.query.filter_by(status="published")
    search = request.args.get("q", request.args.get("search", "")).strip()
    category = request.args.get("category", "").strip()
    location = request.args.get("location", "").strip()
    if search:
        term = f"%{search[:100]}%"
        query = query.filter(or_(Service.title.ilike(term), Service.description.ilike(term), Service.category.ilike(term)))
    if category:
        query = query.filter(Service.category.ilike(category[:60]))
    if location:
        query = query.filter(Service.location.ilike(f"%{location[:120]}%"))
    try:
        if request.args.get("min_price") not in (None, ""):
            minimum = Decimal(request.args["min_price"])
            if not minimum.is_finite() or minimum < 0:
                raise InvalidOperation
            query = query.filter(Service.price >= minimum)
        if request.args.get("max_price") not in (None, ""):
            maximum = Decimal(request.args["max_price"])
            if not maximum.is_finite() or maximum < 0:
                raise InvalidOperation
            query = query.filter(Service.price <= maximum)
    except (InvalidOperation, ValueError):
        return api_error("Price filters must be valid amounts greater than or equal to zero.", 400)
    query = query.order_by(Service.created_at.desc())
    page, per_page = pagination_args()
    result = query.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify(listing_response(result, lambda item: item.to_dict()))


@bp.post("")
@jwt_required()
def create_service():
    data = payload_data()
    try:
        title = clean_text(data.get("title"), "Title", maximum=140)
        description = clean_text(data.get("description"), "Description", maximum=5000, minimum=10)
        category = clean_text(data.get("category") or "Other", "Category", maximum=60)
        location = clean_text(data.get("location") or "Federal University of Lafia", "Location", maximum=120)
        price = positive_price(data.get("price"), required=False)
        image_url = save_uploaded_image(request.files.get("image")) if request.files.get("image") else ""
    except ValueError as exc:
        return api_error(str(exc), 400)
    provider = _user()
    if provider is None:
        return api_error("Account not found.", 401)
    service = Service(provider_id=provider.id, title=title, description=description, category=category,
                      location=location, price=price, image_url=image_url, status="pending")
    db.session.add(service)
    db.session.commit()
    return jsonify({"message": "Service submitted for review.", "service": service.to_dict()}), 201


@bp.get("/<int:service_id>")
def get_service(service_id):
    service = db.session.get(Service, service_id)
    if service is None:
        return api_error("Service not found.", 404)
    if service.status != "published":
        verify_jwt_in_request(optional=True)
        viewer = _user()
        if viewer is None or (viewer.id != service.provider_id and not viewer.is_admin):
            return api_error("Service not found.", 404)
    return jsonify({"service": service.to_dict()})


@bp.delete("/<int:service_id>")
@jwt_required()
def delete_service(service_id):
    service = db.session.get(Service, service_id)
    user = _user()
    if service is None:
        return api_error("Service not found.", 404)
    if user is None or (service.provider_id != user.id and not user.is_admin):
        return api_error("You can only delete your own service.", 403)
    remove_uploaded_image(service.image_url)
    Favorite.query.filter_by(listing_type="service", listing_id=service.id).delete(synchronize_session=False)
    db.session.delete(service)
    db.session.commit()
    return jsonify({"message": "Service deleted."})
