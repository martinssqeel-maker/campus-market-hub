"""Product marketplace listing endpoints."""
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required, verify_jwt_in_request
from sqlalchemy import or_

from ..extensions import db
from ..models import Favorite, Product, User
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

bp = Blueprint("products", __name__)


def _valid_image_url(value):
    value = str(value or "").strip()
    if not value:
        return ""
    parsed = urlparse(value)
    if value.startswith("/uploads/") or (parsed.scheme in {"http", "https"} and parsed.netloc):
        return value[:500]
    raise ValueError("Image URL must be an uploaded image or a secure HTTP(S) URL.")


def _listing_owner():
    try:
        return db.session.get(User, int(get_jwt_identity()))
    except (TypeError, ValueError):
        return None


@bp.get("")
def list_products():
    query = Product.query.filter_by(status="published")
    search = request.args.get("q", request.args.get("search", "")).strip()
    category = request.args.get("category", "").strip()
    location = request.args.get("location", "").strip()

    if search:
        term = f"%{search[:100]}%"
        query = query.filter(or_(Product.title.ilike(term), Product.description.ilike(term), Product.category.ilike(term)))
    if category:
        query = query.filter(Product.category.ilike(category[:60]))
    if location:
        query = query.filter(Product.location.ilike(f"%{location[:120]}%"))
    try:
        if request.args.get("min_price") not in (None, ""):
            minimum = Decimal(request.args["min_price"])
            if not minimum.is_finite() or minimum < 0:
                raise InvalidOperation
            query = query.filter(Product.price >= minimum)
        if request.args.get("max_price") not in (None, ""):
            maximum = Decimal(request.args["max_price"])
            if not maximum.is_finite() or maximum < 0:
                raise InvalidOperation
            query = query.filter(Product.price <= maximum)
    except (InvalidOperation, ValueError):
        return api_error("Price filters must be valid amounts greater than or equal to zero.", 400)

    sort = request.args.get("sort", "newest")
    if sort == "price_low":
        query = query.order_by(Product.price.asc(), Product.created_at.desc())
    elif sort == "price_high":
        query = query.order_by(Product.price.desc(), Product.created_at.desc())
    else:
        query = query.order_by(Product.created_at.desc())

    page, per_page = pagination_args()
    result = query.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify(listing_response(result, lambda item: item.to_dict()))


@bp.post("")
@jwt_required()
def create_product():
    data = payload_data()
    try:
        title = clean_text(data.get("title"), "Title", maximum=140)
        description = clean_text(data.get("description"), "Description", maximum=5000, minimum=10)
        category = clean_text(data.get("category"), "Category", maximum=60)
        location = clean_text(data.get("location") or "Federal University of Lafia", "Location", maximum=120)
        price = positive_price(data.get("price"))
        image_url = save_uploaded_image(request.files.get("image")) if request.files.get("image") else _valid_image_url(data.get("image_url"))
    except ValueError as exc:
        return api_error(str(exc), 400)

    user = _listing_owner()
    if user is None:
        return api_error("Account not found.", 401)
    product = Product(
        seller_id=user.id,
        title=title,
        description=description,
        price=price,
        image_url=image_url,
        category=category,
        location=location,
        status="pending",
    )
    db.session.add(product)
    db.session.commit()
    return jsonify({"message": "Your listing was submitted for review.", "product": product.to_dict()}), 201


@bp.get("/<int:product_id>")
def get_product(product_id):
    product = db.session.get(Product, product_id)
    if product is None:
        return api_error("Product not found.", 404)
    if product.status != "published":
        # Public visitors cannot inspect listings before moderator approval.
        verify_jwt_in_request(optional=True)
        viewer = _listing_owner()
        if viewer is None or (viewer.id != product.seller_id and not viewer.is_admin):
            return api_error("Product not found.", 404)
    return jsonify({"product": product.to_dict()})


@bp.put("/<int:product_id>")
@jwt_required()
def update_product(product_id):
    product = db.session.get(Product, product_id)
    user = _listing_owner()
    if product is None:
        return api_error("Product not found.", 404)
    if user is None or (product.seller_id != user.id and not user.is_admin):
        return api_error("You can only edit your own listing.", 403)

    data = payload_data()
    changed = False
    try:
        for key, maximum in (("title", 140), ("description", 5000), ("category", 60), ("location", 120)):
            if key in data:
                new_value = clean_text(data.get(key), key.replace("_", " ").title(), maximum=maximum,
                                       minimum=10 if key == "description" else 1)
                if getattr(product, key) != new_value:
                    setattr(product, key, new_value)
                    changed = True
        if "price" in data:
            new_price = positive_price(data.get("price"))
            if product.price != new_price:
                product.price = new_price
                changed = True
        uploaded = request.files.get("image")
        if uploaded and uploaded.filename:
            new_url = save_uploaded_image(uploaded)
            remove_uploaded_image(product.image_url)
            product.image_url = new_url
            changed = True
        elif "image_url" in data:
            new_url = _valid_image_url(data.get("image_url"))
            if product.image_url != new_url:
                remove_uploaded_image(product.image_url)
                product.image_url = new_url
                changed = True
    except ValueError as exc:
        return api_error(str(exc), 400)

    if changed and product.status == "published":
        product.status = "pending"
    db.session.commit()
    return jsonify({"message": "Listing updated. Changes to published listings are reviewed again.", "product": product.to_dict()})


@bp.delete("/<int:product_id>")
@jwt_required()
def delete_product(product_id):
    product = db.session.get(Product, product_id)
    user = _listing_owner()
    if product is None:
        return api_error("Product not found.", 404)
    if user is None or (product.seller_id != user.id and not user.is_admin):
        return api_error("You can only delete your own listing.", 403)
    remove_uploaded_image(product.image_url)
    Favorite.query.filter_by(listing_type="product", listing_id=product.id).delete(synchronize_session=False)
    db.session.delete(product)
    db.session.commit()
    return jsonify({"message": "Listing deleted."})
