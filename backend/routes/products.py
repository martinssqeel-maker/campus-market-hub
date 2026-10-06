"""
Product (marketplace item) routes – ``/api/products``

GET    /api/products             list + search + filter (public, paginated)
GET    /api/products/categories  catalogue categories with live counts
GET    /api/products/<id>        single product (increments view counter)
GET    /api/products/<id>/similar  related items from the same category
POST   /api/products             create listing (auth, starts as "pending")
PUT    /api/products/<id>        edit (owner or admin)
DELETE /api/products/<id>        delete (owner or admin)
"""

from flask import Blueprint, request
from sqlalchemy import func

from config import Config
from extensions import db
from models import Product, model_for_type
from utils.decorators import current_user, login_required
from utils.helpers import (
    api_error,
    api_success,
    apply_price_range,
    apply_search,
    apply_sort,
    owner_or_admin,
    paginate,
    parse_bool,
    parse_float,
    parse_int,
    request_data,
)
from utils.validators import (
    ValidationError,
    clean_image_url,
    clean_text,
    validate_listing_payload,
)

products_bp = Blueprint("products", __name__)

#: Canonical category list used by the post-listing form and filters.
PRODUCT_CATEGORIES = [
    "books",
    "electronics",
    "phones",
    "laptops",
    "furniture",
    "hostel-essentials",
    "clothing",
    "food",
    "sports",
    "others",
]


def _visible_query(viewer):
    """
    Base query honouring the moderation workflow:
    anonymous users only ever see *published* items; owners additionally see
    their own pending/rejected ones; admins see everything.
    """
    query = Product.query
    status = (request.args.get("status") or "").strip().lower()
    if viewer and viewer.is_admin:
        return query.filter(Product.status == status) if status else query
    if status and status != "published" and viewer:
        return query.filter(Product.seller_id == viewer.id, Product.status == status)
    condition = [Product.status == "published"]
    if viewer:
        condition.append(Product.seller_id == viewer.id)
    from sqlalchemy import or_

    return query.filter(or_(*condition))


@products_bp.get("/products")
def list_products():
    """Public, paginated product feed with search, category & price filters."""
    viewer = current_user(optional=True)
    query = _visible_query(viewer)

    # --- filters ----------------------------------------------------------
    category = (request.args.get("category") or "").strip().lower()
    if category in {"all", ""}:
        category = None
    if category and category in PRODUCT_CATEGORIES:
        query = query.filter(Product.category == category)

    location = (request.args.get("location") or "").strip()
    if location:
        query = query.filter(Product.location.ilike(f"%{location}%"))

    condition = (request.args.get("condition") or "").strip().lower()
    if condition:
        query = query.filter(Product.condition == condition)

    if parse_bool(request.args.get("featured")):
        query = query.filter(Product.featured.is_(True))

    seller_id = parse_int(request.args.get("seller_id"))
    if seller_id:
        query = query.filter(Product.seller_id == seller_id)

    # Category, location and condition are searched too, so "laptop" finds a
    # laptop even when the seller's title says "HP EliteBook".
    query = apply_search(
        query,
        Product,
        request.args.get("q"),
        ("title", "description", "category", "location", "condition"),
    )
    query = apply_price_range(
        query,
        Product,
        parse_float(request.args.get("min_price")),
        parse_float(request.args.get("max_price")),
    )
    query = apply_sort(query, Product, request.args.get("sort"))

    result = paginate(query, lambda row: row.to_dict(viewer=viewer))
    result["categories"] = PRODUCT_CATEGORIES
    result["filters"] = {
        "q": request.args.get("q") or "",
        "category": category or "all",
        "min_price": request.args.get("min_price") or "",
        "max_price": request.args.get("max_price") or "",
        "location": location,
        "sort": request.args.get("sort") or "newest",
    }
    return api_success(result)


@products_bp.get("/products/categories")
def product_categories():
    """Category list with the number of published items in each."""
    rows = (
        db.session.query(Product.category, func.count(Product.id))
        .filter(Product.status == "published")
        .group_by(Product.category)
        .all()
    )
    counts = {category: count for category, count in rows}
    return api_success(
        {
            "categories": [
                {"name": name, "count": counts.get(name, 0)} for name in PRODUCT_CATEGORIES
            ],
            "total": sum(counts.values()),
        }
    )


@products_bp.get("/products/<int:product_id>")
def get_product(product_id: int):
    """Single product. Drafts are visible only to their owner and to admins."""
    viewer = current_user(optional=True)
    product = db.session.get(Product, product_id)
    if product is None:
        return api_error("Product not found", 404)

    if product.status != "published" and not owner_or_admin(viewer, product):
        return api_error("This listing is not available", 403)

    if not owner_or_admin(viewer, product):
        # Count a view once per request (owners don't inflate their own stats).
        product.views = (product.views or 0) + 1
        db.session.commit()

    data = product.to_dict(viewer=viewer)

    # Extra context for the details page.
    similar = (
        Product.query.filter(
            Product.category == product.category,
            Product.status == "published",
            Product.id != product.id,
        )
        .order_by(Product.created_at.desc())
        .limit(4)
        .all()
    )
    data["similar"] = [row.to_dict() for row in similar]
    data["seller_listings"] = (
        Product.query.filter(
            Product.seller_id == product.seller_id,
            Product.status == "published",
            Product.id != product.id,
        )
        .count()
    )
    return api_success(data)


@products_bp.get("/products/<int:product_id>/similar")
def similar_products(product_id: int):
    """Lightweight 'you may also like' endpoint."""
    product = db.session.get(Product, product_id)
    if product is None:
        return api_error("Product not found", 404)
    rows = (
        Product.query.filter(
            Product.status == "published",
            Product.id != product_id,
            Product.category == product.category,
        )
        .order_by(Product.created_at.desc())
        .limit(parse_int(request.args.get("limit"), 4, minimum=1, maximum=12))
        .all()
    )
    return api_success([row.to_dict() for row in rows])


@products_bp.post("/products")
@login_required
def create_product():
    """Create a product listing – always starts life as ``pending``."""
    user = current_user()
    payload = request_data()
    try:
        data = validate_listing_payload(payload, "product")
        category = clean_text(payload.get("category"), 60).lower() or "others"
        if category not in PRODUCT_CATEGORIES:
            category = "others"

        product = Product(
            seller_id=user.id,
            title=data["title"],
            description=data.get("description") or data["title"],
            price=data["price"],
            category=category,
            location=data.get("location") or "UNILAFIA Campus",
            condition=clean_text(payload.get("condition"), 30).lower() or "used",
            # Stored verbatim: object-storage URLs must never be truncated.
            image_url=clean_image_url(payload.get("image_url")) or None,
            status="published" if Config.AUTO_PUBLISH or user.is_admin else "pending",
        )
        db.session.add(product)
        db.session.commit()
        return api_success(
            product.to_dict(viewer=user),
            message="Listing submitted for review. An admin will approve it shortly."
            if product.status == "pending"
            else "Listing published!",
            status=201,
        )
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@products_bp.put("/products/<int:product_id>")
@login_required
def update_product(product_id: int):
    """Edit a product (owner or admin). Editing re-enters moderation."""
    viewer = current_user()
    product = db.session.get(Product, product_id)
    if product is None:
        return api_error("Product not found", 404)
    if not owner_or_admin(viewer, product):
        return api_error("You can only edit your own listings", 403)

    payload = request_data()
    try:
        data = validate_listing_payload({**product.to_dict(), **payload}, "product")
        product.title = data["title"]
        product.description = data.get("description") or product.description
        product.price = data["price"]
        if "category" in payload:
            category = clean_text(payload.get("category"), 60).lower()
            product.category = category if category in PRODUCT_CATEGORIES else product.category
        if "location" in payload:
            product.location = data.get("location") or product.location
        if "condition" in payload:
            product.condition = clean_text(payload.get("condition"), 30).lower()
        if "image_url" in payload:
            product.image_url = clean_image_url(payload.get("image_url")) or None

        # Optional status shortcut (mark as sold / re-list).
        new_status = (payload.get("status") or "").strip().lower()
        if new_status in {"sold", "archived"} and not viewer.is_admin:
            product.status = new_status
        elif new_status == "published" and (viewer.is_admin or Config.AUTO_PUBLISH):
            product.status = "published"
        elif not viewer.is_admin and product.status == "published":
            product.status = "pending"          # edits are re-moderated

        db.session.commit()
        return api_success(product.to_dict(viewer=viewer), message="Listing updated")
    except ValidationError as exc:
        return api_error(exc.message, 422, exc.errors)


@products_bp.delete("/products/<int:product_id>")
@login_required
def delete_product(product_id: int):
    """Delete a product (owner or admin)."""
    viewer = current_user()
    product = db.session.get(Product, product_id)
    if product is None:
        return api_error("Product not found", 404)
    if not owner_or_admin(viewer, product):
        return api_error("You can only delete your own listings", 403)

    db.session.delete(product)
    db.session.commit()
    return api_success(message="Listing deleted")


# ---------------------------------------------------------------------------
# Generic listing lookup used by favourites (kept here to avoid duplication)
# ---------------------------------------------------------------------------
def listing_by_type(item_type: str, item_id: int):
    """Return a listing across any supported type (or None)."""
    model = model_for_type(item_type)
    if model is None:
        return None
    return db.session.get(model, item_id)
