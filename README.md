# Campus Marketplace

A responsive student-to-student marketplace for the **Federal University of Lafia (FULafia)**. Students can browse campus finds, accommodation, events and services; save favourites; contact other students; maintain a rated profile; and submit listings for admin review.

> This repository contains a working Flask API and a plain HTML/CSS/JavaScript frontend. Flask serves both the API and frontend from one origin for simple local development.

## What is included

- JWT signup, login, `/me` and revocable logout; passwords are stored as bcrypt hashes.
- SQLite by default, SQLAlchemy models and a MySQL-compatible `DATABASE_URL` option.
- Products, accommodation, events, services, student profiles, reviews, favourites and a JWT blocklist (eight tables total).
- New listings start as `pending`. Only approved `published` listings are visible to the public; admins can approve or reject any listing type.
- Search, category/type, price and location filters, pagination and lightweight autocomplete suggestions.
- Validated image upload (JPG, PNG, WEBP or GIF, up to 5 MiB); images are normalized and stored under `instance/uploads/`.
- Mobile-first pages for home, marketplace, listing details, accommodation, events, services, login, signup, posting, profile/reviews and admin moderation.
- Pytest API integration tests, sample-data and admin-creation CLI commands.

## Quick start

Python 3.10+ is recommended.

```bash
# From the repository root
python -m venv .venv
# Linux / macOS
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1

pip install -r backend/requirements.txt
cp .env.example .env             # Windows: copy .env.example .env
```

Set `SECRET_KEY` and `JWT_SECRET_KEY` in `.env` to long, unique random values before using real accounts. For example, generate values with:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Start the app from the repository root:

```bash
python -m backend.app
```

Open **http://127.0.0.1:5000**. The first run creates `instance/campus_marketplace.db` automatically. The server binds to `0.0.0.0`, so it also works in a container or hosted preview. Set `PORT` to override the default port and `FLASK_DEBUG=1` only for local debugging.

### Optional demo content

Seed a few clearly identified campus listings to explore the interface:

```bash
flask --app backend.app seed-demo
```

Demo account (for local development only):

- Email: `demo.student@fulafia.edu.ng`
- Password: `Student123!`

### Create the first admin

Admin accounts cannot be created through public signup. Create one from the terminal:

```bash
flask --app backend.app create-admin
```

Follow the prompts for name, email, phone and password, then sign in and visit **/pages/admin-dashboard.html**. An admin can review all four listing types and verify student accounts.

## Run the tests

```bash
pytest -q backend/tests
```

The test suite covers auth and token revocation, password hashing, pending-to-published moderation, filters, favourites, ratings, ownership and API errors. Tests use a temporary in-memory SQLite database and upload folder.

## Configuration

`.env.example` documents all supported settings. The app loads a root `.env` file automatically.

| Variable | Default | Description |
| --- | --- | --- |
| `SECRET_KEY` | Development-only value | Flask secret. Set a strong random value in every deployed environment. |
| `JWT_SECRET_KEY` | `SECRET_KEY` | Signing key for bearer tokens; use a separate strong random value in production. |
| `JWT_ACCESS_TOKEN_HOURS` | `12` | JWT access-token lifetime. |
| `DATABASE_URL` | SQLite under `instance/` | SQLAlchemy connection string. MySQL example: `mysql+pymysql://user:password@host/campus_marketplace?charset=utf8mb4`. |
| `UPLOAD_FOLDER` | `instance/uploads/` | Persistent filesystem folder for processed listing images. |
| `CORS_ORIGINS` | `*` | Comma-separated frontend origins when hosting frontend and API separately. |
| `PORT` | `5000` | Development server port. |
| `FLASK_DEBUG` | `0` | Enable Flask debug mode locally only. |

For production, use HTTPS, strong secrets, a persistent database and upload volume, backups, an explicit CORS allowlist, and a production WSGI server. Example on a Linux host:

```bash
gunicorn --workers 2 --bind 0.0.0.0:8000 'backend.app:app'
```

SQLite is suitable for development and small demonstrations. For schema changes in a deployed MySQL database, manage revisions with Flask-Migrate instead of relying on `create_all`:

```bash
flask --app backend.app db init       # once per checkout
flask --app backend.app db migrate -m "describe schema change"
flask --app backend.app db upgrade
```

`db.create_all()` runs on application startup to make a fresh development checkout immediately usable. Do not treat it as a production migration strategy.

## Pages

| URL | Purpose |
| --- | --- |
| `/` | Landing page, featured listings, rooms and upcoming events |
| `/pages/home.html` | Searchable and filterable product marketplace |
| `/pages/product-details.html?type=product&id=1` | Product/accommodation/event/service detail and seller contact |
| `/pages/accommodation.html` | Accommodation filters and room listings |
| `/pages/events.html` | Campus events calendar |
| `/pages/services.html` | Student services directory |
| `/pages/login.html` / `/pages/signup.html` | Authentication |
| `/pages/post-listing.html` | Submit a product, room, event or service for moderation |
| `/pages/profile.html?id=1` | Student profile, rating and published listing history |
| `/pages/favorites.html` | Authenticated wishlist; save and remove listings |
| `/pages/admin-dashboard.html` | Admin moderation queue and account verification |

The frontend is vanilla JavaScript and works at mobile widths down to 320 px. To host it separately, configure the API base with `window.CAMPUS_MARKET_API_BASE` before `js/api.js` loads (or edit the page's `meta[name="api-base"]`), and set `CORS_ORIGINS` on Flask.

## API overview

All responses are JSON. Protected routes accept `Authorization: Bearer <access_token>`. Signup and login return a token and safe user profile. New listing content is not public until approved.

### Authentication

| Method | Endpoint | Access |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Public — `{name,email,phone,password}` |
| `POST` | `/api/auth/login` | Public — `{email,password}` |
| `POST` | `/api/auth/logout` | JWT — revokes the current token |
| `GET` | `/api/auth/me` | JWT — current profile |

### Marketplace listings

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/api/products` | `q`, `category`, `min_price`, `max_price`, `location`, `sort`, `page`, `per_page` |
| `POST` | `/api/products` | JWT; JSON or multipart form (`image`); starts pending |
| `GET` | `/api/products/<id>` | Public after approval; owner/admin can view pending posts |
| `PUT` / `DELETE` | `/api/products/<id>` | JWT owner/admin; edits to published products return to pending |
| `GET` / `POST` | `/api/accommodation` | Filters: `q`, `location`, `room_type`, `min_price`, `max_price`; posts start pending |
| `GET` / `POST` | `/api/events` | Filters: `q`, `category`, `location`, `from`, `to`; posts start pending |
| `GET` / `POST` | `/api/services` | Filters: `q`, `category`, `location`, `min_price`, `max_price`; posts start pending |
| `GET` | `/api/health` | API health check |

List endpoints return `{items, pagination}`. Supported listing `room_type` values are `room`, `shared`, `self_contain` and `hostel`. Image uploads use the form field name `image`; image URL/path values are not accepted from arbitrary local filesystem locations.

### Profiles, reviews and wishlist

| Method | Endpoint | Access |
| --- | --- | --- |
| `GET` / `PUT` | `/api/users/<id>` | Public profile / JWT owner or admin edit |
| `GET` | `/api/users/<id>/listings?type=all` | Published listings publicly; own pending history for owner/admin |
| `GET` / `POST` | `/api/users/<id>/reviews` | Read reviews / JWT to add one rating per reviewer |
| `GET` / `POST` | `/api/favorites` | JWT wishlist list / save a published `{listing_type,listing_id}` |
| `DELETE` | `/api/favorites/<favorite_id>` | JWT owner |
| `DELETE` | `/api/favorites/listing/<type>/<id>` | JWT owner; remove by listing |

### Moderation and accounts

| Method | Endpoint | Access |
| --- | --- | --- |
| `GET` | `/api/admin/pending` or `/api/admin/pending-listings` | Admin; pending products, accommodation, events and services |
| `POST` | `/api/admin/approve/<type>/<id>` | Admin; type is `product`, `accommodation`, `event` or `service` |
| `POST` | `/api/admin/reject/<type>/<id>` | Admin; type as above |
| `GET` | `/api/admin/users` | Admin; paginated account list, optional `q` search |
| `POST` | `/api/admin/users/<id>/verify` | Admin; verify a student account |
| `GET` | `/api/admin/stats` | Admin dashboard summary |

For compatibility, `/api/admin/approve/<id>` and `/api/admin/reject/<id>` default to the product listing type. Use the explicit typed route when moderating any other listing type because IDs are unique only within each table. Rejected listings are not shown publicly; owners can remove a post and submit a corrected one.

## Project structure

```text
backend/
  app.py                 Flask app factory, CLI commands, static frontend serving
  config.py              Environment-based configuration
  extensions.py           SQLAlchemy, bcrypt and JWT extensions
  models.py               Users, products, accommodation, events, services, reviews, favourites, revoked tokens
  routes/                 Auth, product, accommodation, event, service, user and admin APIs
  requirements.txt
  tests/test_api.py       API integration tests
frontend/
  index.html              Responsive marketplace landing page
  pages/                  Browse, detail, auth, posting, profile and admin screens
  css/                    Shared and mobile-first styles
  js/                     API client, page logic, auth and moderation UI
  assets/                 Local SVG artwork and brand mark
instance/                 Runtime SQLite database and uploads (ignored by Git)
```

## Notes for a real deployment

- Public signup creates a student account, but does not independently prove FULafia enrolment. Use the admin verification workflow after checking credentials.
- Listing moderation is implemented server-side; hiding pending posts is not just a frontend convention.
- WhatsApp and telephone buttons link directly to the phone number supplied by the seller. Arrange transactions safely and meet in public campus locations.
- Email verification, payment processing and push notifications are intentionally outside this starter platform; do not describe accounts as institution-authenticated until a verification provider is connected.
