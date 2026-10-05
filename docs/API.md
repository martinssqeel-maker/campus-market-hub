# Campus Marketplace — API Documentation

Base URL (development): `http://localhost:5000/api`

All requests and responses are JSON, except `POST /api/uploads/image` which uses `multipart/form-data`
and `GET /api/uploads/view/…`, which returns image bytes.

Every listing carries `image_url` plus `image_fallback_url`: the second is the
`/api/uploads/view` route, and the frontend retries it automatically when the
first fails to load, so a private bucket or a stale CDN domain never shows a
blank tile.

**Authentication:** send the access token in a header:

```
Authorization: Bearer <access_token>
```

---

## 1. Response format

**Success**

```json
{
  "success": true,
  "message": "Listing submitted for review. An admin will approve it shortly.",
  "data": { "id": 14, "title": "Casio Scientific Calculator", "status": "pending" }
}
```

**Error**

```json
{
  "success": false,
  "message": "Please fill in all required fields",
  "errors": { "price": "Price is required" }
}
```

**Status codes**

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 400 | Bad request (e.g. self-review) |
| 401 | Missing / expired / revoked token, wrong password |
| 403 | Not allowed (not the owner, not an admin, suspended account) |
| 404 | Resource not found |
| 409 | Conflict (email already registered) |
| 413 | Upload too large |
| 422 | Validation error (field details in `errors`) |
| 500 | Server error (logged to `backend/logs/campus-market.log`) |

**Pagination envelope** (list endpoints)

```json
{
  "items": [ … ],
  "pagination": { "page": 1, "per_page": 12, "total": 11, "pages": 1,
                  "has_next": false, "has_prev": false }
}
```

---

## 2. Authentication `/api/auth`

### POST `/auth/signup`

```json
{
  "name": "Martins Moses",
  "email": "martins@unilafia.edu.ng",
  "phone": "08031234567",
  "password": "Passw0rd123",
  "confirm_password": "Passw0rd123",
  "user_type": "student",
  "department": "Computer Science",
  "level": "300 Level"
}
```

Rules: password ≥ 6 chars with at least one letter and one digit; Nigerian phone
(`0803…`, `0703…`, `+234803…`); `user_type` may only be `student`, `landlord` or
`service_provider` (admins are created by the system).

**201**

```json
{
  "success": true,
  "message": "Welcome to Campus Marketplace! Your account is ready.",
  "data": {
    "user": { "id": 12, "name": "Martins Moses", "email": "…", "user_type": "student", "verified": false },
    "access_token": "eyJ…",
    "refresh_token": "eyJ…",
    "token_type": "Bearer"
  }
}
```

### POST `/auth/login`

```json
{ "email": "student@example.com", "password": "YourStrongPassword1!" }
```

Returns the same `data` shape as signup. `401` for wrong credentials,
`403` if the account is suspended.

### POST `/auth/refresh`
Header: `Authorization: Bearer <refresh_token>` → `{ "data": { "access_token": "…" } }`

### POST `/auth/logout`
Revokes the presented token (access or refresh) by storing its `jti` in `token_blocklist`.

### GET `/auth/me`

```json
{ "data": { "user": { … }, "counts": { "products": 3, "accommodation": 0,
  "events": 1, "services": 0, "favorites": 4 } } }
```

### PUT `/auth/me`
Any of `name`, `email`, `phone`, `whatsapp`, `bio`, `department`, `level`, `location`, `avatar_url`.

### POST `/auth/me/password`
```json
{ "old_password": "YourStrongPassword1!", "new_password": "BrandNew123" }
```

### POST `/auth/check-email`
```json
{ "email": "someone@unilafia.edu.ng" }
→ { "data": { "email": "…", "available": true } }
```

---

## 3. Products `/api/products`

### GET `/products`

| Query param | Example | Notes |
|---|---|---|
| `q` | `laptop` | Searches title + description |
| `category` | `laptops` | See `/products/categories` |
| `min_price` / `max_price` | `5000` / `50000` | Inclusive |
| `location` | `Angwan` | Partial match |
| `condition` | `used` | `new` \| `used` \| `refurbished` |
| `featured` | `true` | Featured only |
| `seller_id` | `3` | A single seller's items |
| `sort` | `-price` | `created_at`, `-created_at`, `price`, `-price`, `title` |
| `page`, `per_page` | `2`, `12` | `per_page` max 48 |
| `status` | `pending` | Only meaningful for the owner/admin |

Guests see `published` items only; owners also see their own drafts; admins see everything.

### POST `/products` *(auth)*

```json
{
  "title": "HP EliteBook 840 G5",
  "description": "Core i5, 8GB RAM, 256GB SSD. Charger included.",
  "price": 185000,
  "category": "laptops",
  "condition": "refurbished",
  "location": "Mararaba, Lafia",
  "image_url": "assets/uploads/u3_1728040000_ab12cd34.jpg",
  "image_fallback_url": "/api/uploads/view/u3_1728040000_ab12cd34.jpg"
}
```

**201** — `status` is `pending` unless `AUTO_PUBLISH=true`.

### GET `/products/<id>`
Adds `similar` (4 related items) and `seller_listings`. Contact details
(`phone`, `whatsapp`, `email`) are included **only** for authenticated callers.
Increments `views` for non-owners.

### PUT `/products/<id>` *(owner or admin)*
Partial update. Editing a published listing sends it back to `pending`
(unless you are an admin). `status` accepts `sold` / `archived`.

### DELETE `/products/<id>` *(owner or admin)* → `{ "message": "Listing deleted" }`

### GET `/products/categories`
```json
{ "data": { "categories": [ { "name": "books", "count": 4 }, … ], "total": 11 } }
```

### GET `/products/<id>/similar?limit=4`

---

## 4. Accommodation `/api/accommodation`

Same CRUD pattern as products, with room-specific fields.

### GET `/accommodation`

| Query param | Example |
|---|---|
| `q` | `self contain` |
| `room_type` (alias `type`) | `single`, `self-contain`, `hostel`, `flat`, `shared` |
| `min_price` / `max_price` | `60000` / `250000` (per year) |
| `location` | `Bukan Sidi` |
| `gender` | `female` (matches `female` and `any`) |
| `rooms` | minimum number of bedrooms/spaces |
| `furnished` | `true` |
| `landlord_id`, `sort`, `page`, `per_page` | as above |

### POST `/accommodation` *(auth)*

```json
{
  "title": "Single Room (Self-Contain) at Bukan Sidi",
  "description": "Private toilet, bathroom, borehole water, prepaid meter.",
  "location": "Bukan Sidi, Lafia",
  "price": 180000,
  "rooms": 1,
  "room_type": "self-contain",
  "gender": "any",
  "furnished": true,
  "amenities": ["Water supply", "Prepaid meter", "Tiled floor"]
}
```

Also available: `GET /accommodation/types`, `GET /accommodation/locations`,
`GET|PUT|DELETE /accommodation/<id>`.

---

## 5. Events `/api/events`

### GET `/events`

| Query param | Example |
|---|---|
| `q` | `career` |
| `category` | `academic`, `career`, `social`, `sports`, `religious`, `entertainment`, `advert`, `others` |
| `date_from` / `date_to` | `2026-03-01` |
| `upcoming` | `true` (only future events) |
| `free` | `true` (ticket price 0) |
| `max_price` | `2000` |
| `location`, `creator_id`, `sort` (default `date`), `page`, `per_page` | |

### POST `/events` *(auth)*

```json
{
  "title": "UNILAFIA Career & Internship Fair 2026",
  "description": "Meet 25+ recruiters, CV clinics and mock interviews.",
  "date": "2026-03-14T10:00",
  "location": "Faculty of Science Auditorium",
  "category": "career",
  "ticket_price": 0,
  "image_url": ""
}
```

Accepted date formats: `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM`, `YYYY-MM-DD HH:MM`, `DD/MM/YYYY`.

Extras: `GET /events/upcoming?limit=4`, `GET /events/stats`.

---

## 6. Services `/api/services`

`GET /services?category=laundry&max_price=2000&q=iron`, `GET /services/categories`.

### POST `/services` *(auth)*

```json
{
  "title": "Same-Day Laundry & Ironing Service",
  "description": "Wash, dry and iron within 24 hours. Pickup and delivery included.",
  "category": "laundry",
  "price": 1500,
  "price_unit": "per load",
  "location": "UNILAFIA Campus"
}
```

---

## 7. Users `/api/users`

### GET `/users/<id>`
Public profile: `name`, `user_type`, `verified`, `rating_average`, `rating_count`,
`department`, `level`, `location`, `bio`, `created_at`, `listings_count`.
`email` is only visible to the account owner and admins.

### PUT `/users/<id>` *(self or admin)*
Same fields as `PUT /auth/me`. Admins may additionally send `verified`
or `is_active`.

### GET `/users/<id>/listings`
```json
{ "data": { "user": { … },
  "products": [ … ], "accommodation": [ … ], "events": [ … ], "services": [ … ],
  "counts": { "products": 4, "accommodation": 0, "events": 1,
              "services": 0, "total": 5 } } }
```
Visitors get published items only; the owner and admins also receive drafts.

### GET `/users/<id>/stats`
`listings` breakdown, `total_listings`, `rating_average`, `rating_count`, `verified`, `member_since`.

### GET `/users/<id>/reviews` · POST `/users/<id>/reviews` *(auth)*

```json
{ "rating": 5, "comment": "Honest seller, item exactly as described.",
  "listing_type": "product", "listing_id": 3 }
```

One review per author per user — posting again updates the previous review.
Self-reviews return `400`.

### DELETE `/reviews/<review_id>` *(author or admin)*

### DELETE `/users/<id>` *(admin only)*

---

## 8. Favourites `/api/favorites` *(auth)*

### POST `/favorites`
```json
{ "item_type": "product", "item_id": 3 }
```
Toggles: `{ "data": { "item_type": "product", "item_id": 3, "saved": true } }`.
`item_type` accepts `product`, `accommodation`, `event`, `service`
(and plural/`room` aliases).

### GET `/favorites?item_type=accommodation`
Returns saved items with the full listing object nested under `listing`.
Deleted listings are skipped silently.

### GET `/favorites/ids`
```json
{ "data": { "ids": { "product": [1, 3], "accommodation": [2] }, "total": 3 } }
```

### DELETE `/favorites/<item_type>/<item_id>`

---

## 9. Uploads `/api/uploads`

### POST `/uploads/image` *(auth)*
`multipart/form-data`, field name **`image`** (or `file`). Max 5 MB.
Allowed extensions: `png`, `jpg`, `jpeg`, `gif`, `webp`.

```json
{ "data": { "filename": "u3_1728040000_ab12cd34.jpg",
            "reference": "uploads/u3_1728040000_ab12cd34.jpg",
            "url": "https://pub-1a2b.r2.dev/uploads/u3_1728040000_ab12cd34.jpg",
            "proxy_url": "/api/uploads/view/uploads/u3_1728040000_ab12cd34.jpg",
            "size_kb": 182.4 } }
```

`url` is what to put in an `<img>` right now; `reference` is what to store on
the listing. Either works — `image_url` is normalised to `reference` on write —
but a listing that stores the key keeps rendering after the bucket's domain,
provider or URL mode changes, while a stored URL breaks the moment one of them
moves.

### GET `/uploads/view/<reference>`
**Public** (no token: an `<img>` tag cannot send one). Streams one uploaded
image from wherever it lives — the local folder or an S3-compatible bucket —
using the server's credentials.

- `200` with `Content-Type: image/…` and `Cache-Control: public, max-age=604800, immutable`
  (`ETag` supported, so `If-None-Match` returns `304`)
- `404` for an unknown object, a path outside the upload prefix, or anything
  that is not an image extension
- `503` when the bucket itself is unreachable, with the provider's error
  translated into what to fix

Accepts the object key, the bare file name, `assets/uploads/…`, a full public
URL of the bucket, or a presigned/endpoint URL for it — all of which resolve to
the same object. `UPLOAD_PROXY_MODE=redirect` answers `302` to a short-lived
presigned URL instead, which moves the bandwidth to the storage provider.

### GET `/uploads` — images uploaded by the signed-in user
### DELETE `/uploads/<filename>` — delete one of your own uploads

`curl` example:

```bash
curl -X POST http://localhost:5000/api/uploads/image \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@/path/to/photo.jpg"
```

---

## 10. Admin `/api/admin` *(admin token required)*

### Moderation

| Method | Endpoint | Body / query | Effect |
|---|---|---|---|
| GET | `/admin/pending` | `?type=product` | All pending listings (`item_type`, `type_label` added) |
| GET | `/admin/pending-listings` | — | Same as above (alias) |
| POST | `/admin/approve/<id>` | `{ "item_type": "product" }` | Sets `status = published` |
| POST | `/admin/reject/<id>` | `{ "item_type": "product", "reason": "Blurry photo" }` | Sets `status = rejected` |
| POST | `/admin/flag/<type>/<id>` | `{ "reason": "Spam" }` | Hides the listing |
| POST | `/admin/feature/<type>/<id>` | — | Toggles the `featured` badge |
| DELETE | `/admin/listing/<type>/<id>` | — | Permanent delete |
| GET | `/admin/all-listings` | `?status=pending&type=product&q=fan&page=1&per_page=20` | Table data with pagination |

`item_type` may be supplied in the JSON body or as a query parameter. If it is
omitted, the API looks the id up across all four listing tables and reports the
ambiguity rather than guessing. Typed variants exist as well:
`POST /admin/product/12/approve`, `POST /admin/product/12/reject`.

### Users

| Method | Endpoint | Body | Effect |
|---|---|---|---|
| GET | `/admin/users` | `?q=aisha&user_type=student&verified=true&active=true&page=1` | Paginated user list |
| GET | `/admin/users/<id>` | — | Profile + listing counters + recent reviews |
| POST | `/admin/verify/<id>` | `{ "verified": true }` (optional) | Toggle / set the verified badge |
| POST | `/admin/suspend/<id>` | `{ "active": false }` (optional) | Suspend / reactivate |
| POST | `/admin/make-admin/<id>` | `{ "admin": true }` (optional) | Promote / demote |

### Dashboard

| Method | Endpoint | Returns |
|---|---|---|
| GET | `/admin/stats` | User, listing and engagement counters + this week's sign-ups |
| GET | `/admin/activity?limit=10` | Recent registrations and listings |
| GET | `/admin/health` | API status, `AUTO_PUBLISH` flag, server time |

---

## 11. Utilities

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api` | Self-documenting API index |
| GET | `/api/health` | Service + database health |
| GET | `/api/stats` | Public counters used by the landing page |
| GET | `/api/search?q=laptop&limit=5` | Cross-type search (products, rooms, events, services) |
| GET | `/api/meta` | Categories, room types, sort options, user types |
| GET | `/api/popular` | Trending categories and most-viewed listings |

---

## 12. Worked example (curl)

```bash
# 1. Log in with a local test account
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"YourStrongPassword1!"}' \
  | python -c "import sys, json; print(json.load(sys.stdin)['data']['access_token'])")

# 2. Upload a photo
URL=$(curl -s -X POST http://localhost:5000/api/uploads/image \
  -H "Authorization: Bearer $TOKEN" -F "image=@photo.jpg" \
  | python -c "import sys, json; print(json.load(sys.stdin)['data']['url'])")

# 3. Create the listing (starts as pending)
curl -s -X POST http://localhost:5000/api/products \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"title\":\"Scientific Calculator\",\"description\":\"Casio fx-991ES Plus in good condition for MTH 101.\",\"price\":4200,\"category\":\"electronics\",\"image_url\":\"$URL\"}"

# 4. Approve it as the admin
ADMIN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"YourAdminPassword1!"}' \
  | python -c "import sys, json; print(json.load(sys.stdin)['data']['access_token'])")

curl -s -X POST http://localhost:5000/api/admin/approve/14 \
  -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
  -d '{"item_type":"product"}'

# 5. It is now publicly visible
curl -s "http://localhost:5000/api/products?q=calculator"
```
