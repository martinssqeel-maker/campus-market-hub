# Campus Marketplace

**A web & mobile-friendly student marketplace for the Federal University of Lafia (UNILAFIA).**

Buy and sell items · Find accommodation · Discover campus events · Hire student services — with a full admin moderation workflow behind every listing.

| | |
|---|---|
| **Student** | Martins Moses — 2023/ED/SID/OO68 |
| **Supervisor** | Mr Solomon |
| **Stack** | HTML5 · CSS3 · Vanilla JavaScript · Python Flask · SQLite (MySQL for production) |
| **Repository** | https://github.com/martinssqeel-maker/campus-market-hub |
| **Timeline** | 72 hours (3 days) |

---

## Table of contents

1. [What is implemented](#what-is-implemented)
2. [Quick start (5 minutes)](#quick-start-5-minutes)
3. [Demo accounts](#demo-accounts)
4. [Project structure](#project-structure)
5. [Database schema](#database-schema)
6. [API reference (summary)](#api-reference-summary)
7. [Testing](#testing)
8. [Deployment](#deployment)
9. [Troubleshooting](#troubleshooting)
10. [Project checklist](#project-checklist)

---

## What is implemented

### Core features

- **Authentication** — registration, login, JWT access + refresh tokens, real logout (token blocklist), password change, bcrypt password hashing, suspension handling.
- **Products** — create / read / update / delete, image upload, categories, condition, search, price-range + location filters, sorting, pagination, view counter.
- **Accommodation** — rooms, self-contains, hostels, flats and shared rooms with price, room type, gender preference, amenities, furnished flag and location filters.
- **Events & adverts** — campus events with date/time, category, venue, ticket price, upcoming-only filter and date-range search.
- **Services** — laundry, printing, tutoring, repairs, cleaning, catering and more, with price units.
- **Admin moderation** — every new listing starts as `pending`; admins approve, reject (with a reason), flag, feature or delete listings, and verify / suspend / promote or delete users.
- **Profiles & reputation** — public profile pages, per-user listing tabs, star ratings and written reviews, one review per author per user.
- **Wishlist / favourites** — heart button on every card, dedicated wishlist page, filterable by listing type.
- **Search & auto-complete** — global search endpoint plus live suggestions in the hero search bar.
- **Contact sellers** — click-to-call (`tel:`) and WhatsApp (`wa.me`) deep links, contact details revealed to logged-in users only.
- **Responsive design** — mobile-first CSS tested from **320 px** upwards, bottom navigation on phones, tablet/desktop layouts, automatic dark mode.
- **Image upload** — drag-and-drop or click, extension + MIME validation, unique filenames, 5 MB limit, progress bar, inline preview.
- **Security** — parameterised ORM queries (no SQL injection), server-side validation on every endpoint, ownership checks on every mutation, CORS configured, upload path-traversal protection, hashed passwords.

### Beyond the brief (bonus features)

- Public statistics API powering live counters on the landing page.
- Activity feed and per-type breakdown cards on the admin dashboard (auto-refreshes).
- Inline SVG placeholder artwork so the demo looks complete with zero external images.
- Automated **Python API test-suite** (23 tests) and a **browser-level jsdom smoke test**.
- Print-friendly stylesheet and `prefers-reduced-motion` / dark-mode support.

---

## Quick start (5 minutes)

### 1. Requirements

- Python **3.9+** (3.11 recommended)
- A modern browser (Chrome, Edge, Firefox or Safari)
- Git

### 2. Clone the repository

```bash
git clone https://github.com/martinssqeel-maker/campus-market-hub.git
cd campus-market-hub
```

### 3. Create a virtual environment and install dependencies

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate

pip install -r backend/requirements.txt
```

### 4. Create the database and load demo data

```bash
cd backend
python app.py --reset --seed
```

This creates `backend/database.db`, adds the tables, an administrator account and realistic demo content (9 users, 13 products, 7 rooms, 8 events, 6 services, 9 reviews, 7 pending-approval items for the moderation demo).

### 5. Open the app

The Flask app serves both the API **and** the frontend, so there is nothing else to start:

> **http://localhost:5000**

Useful URLs:

| URL | Page |
|---|---|
| `http://localhost:5000/` | Landing page |
| `http://localhost:5000/pages/home.html` | Marketplace (browse, filter, search) |
| `http://localhost:5000/pages/accommodation.html` | Accommodation listings |
| `http://localhost:5000/pages/login.html` | Login (with demo-account shortcuts) |
| `http://localhost:5000/pages/admin-dashboard.html` | Admin moderation dashboard |
| `http://localhost:5000/api` | API index (self-documenting JSON) |
| `http://localhost:5000/api/health` | Health check |

### 6. (Optional) run the frontend separately

The frontend is plain HTML/CSS/JS, so it also works from any static server — handy when you want to edit files without restarting Flask:

```bash
cd frontend
python -m http.server 5500          # or use the VS Code Live Server extension
```

`js/api.js` automatically points to `http://localhost:5000/api` when the frontend is opened on a different port, and to `/api` when served by Flask.

---

## Demo accounts

| Role | Email | Password |
|---|---|---|
| **Administrator** | `admin@unilafia.edu.ng` | `Admin@1234` |
| Student | `aisha.bello@unilafia.edu.ng` | `Student@123` |
| Student | `emeka.okafor@unilafia.edu.ng` | `Student@123` |
| Landlord | `danjuma.attah@gmail.com` | `Landlord@123` |
| Landlord | `grace.onah@gmail.com` | `Landlord@123` |
| Service provider | `blessing.uche@unilafia.edu.ng` | `Provider@123` |
| Service provider | `ibrahim.musa@unilafia.edu.ng` | `Provider@123` |

> The login page has one-click buttons that fill these credentials in automatically.

**Moderation demo:** sign in as the admin, open the dashboard — you will find several listings already waiting in the queue. Approve one and watch it appear in the public marketplace immediately.

---

## Project structure

```
campus-market-hub/
├── backend/
│   ├── app.py                  # Application factory, CORS, static hosting, error handlers, CLI
│   ├── config.py               # Dev / testing / production configuration
│   ├── extensions.py           # Shared SQLAlchemy, JWT and CORS instances
│   ├── models.py               # 7 tables: users, products, accommodation, events, services, reviews, favorites (+ token blocklist)
│   ├── seed_data.py            # Realistic UNILAFIA demo data
│   ├── requirements.txt        # Python dependencies
│   ├── .env.example            # Environment template
│   ├── database.db             # SQLite database (created by --seed, not committed)
│   ├── routes/
│   │   ├── __init__.py         # Blueprint registration
│   │   ├── auth.py             # signup, login, refresh, logout, profile, password
│   │   ├── products.py         # product CRUD, filters, categories, similar items
│   │   ├── accommodation.py    # room CRUD, types, locations
│   │   ├── events.py           # event CRUD, upcoming, stats
│   │   ├── services.py         # service CRUD, categories
│   │   ├── users.py            # profiles, listings, stats, reviews
│   │   ├── favorites.py        # wishlist toggle / list / remove
│   │   ├── uploads.py          # image upload, list, delete
│   │   ├── admin.py            # moderation queue, approvals, user management, dashboards
│   │   └── misc.py             # health, stats, global search, meta
│   ├── utils/
│   │   ├── decorators.py       # login_required, admin_required, current_user
│   │   ├── helpers.py          # response envelopes, pagination, filtering, sorting
│   │   └── validators.py       # email / phone / password / price / image validation
│   ├── tests/
│   │   ├── test_api.py         # 23 automated API tests (unittest)
│   │   ├── browser_smoke.js    # 66 jsdom checks across every page
│   │   └── browser_filters.js  # 20 jsdom checks that filters match the API
│   └── logs/                   # Rotating log files (created at runtime)
├── frontend/
│   ├── index.html              # Landing page (hero, stats, featured, events, CTA)
│   ├── pages/
│   │   ├── login.html          # Login + demo credentials
│   │   ├── signup.html         # Registration form with live validation
│   │   ├── home.html           # Marketplace browse, filters, pagination
│   │   ├── product-details.html# Item / room details, seller contact, safety tips
│   │   ├── accommodation.html  # Room listings with dedicated filters
│   │   ├── events.html         # Campus events & adverts
│   │   ├── services.html       # Student services
│   │   ├── post-listing.html   # Post product / room / event / service + image upload
│   │   ├── profile.html        # Profile, listings by tab, reviews, edit form
│   │   ├── favorites.html      # Wishlist
│   │   └── admin-dashboard.html# Stats, moderation queue, all listings, users
│   ├── css/
│   │   ├── style.css           # Design tokens + components
│   │   └── responsive.css      # Mobile-first breakpoints, dark mode, print
│   ├── js/
│   │   ├── api.js              # API client, JWT handling, auto token refresh
│   │   ├── ui.js               # Shared header/footer/nav, cards, toasts, modals, placeholders
│   │   ├── auth.js             # Forms, validation, session guards
│   │   ├── marketplace.js      # Every public page + listing feed engine
│   │   └── admin.js            # Moderation dashboard
│   └── assets/
│       ├── images/logo.svg     # Logo (also used as favicon)
│       ├── logo.png            # Raster logo for reports / slides
│       └── uploads/            # Student-uploaded photos (git-ignored)
├── docs/
│   └── API.md                  # Full API documentation with request/response examples
├── .gitignore
└── README.md
```

---

## Database schema

Seven tables (the five required tables plus supporting tables for ratings and moderation integrity):

```
users                          products
├── id (PK)                    ├── id (PK)
├── name                       ├── seller_id  ──► users.id
├── email (unique)             ├── title
├── phone                      ├── description
├── password_hash (bcrypt)     ├── price
├── user_type                  ├── image_url
│     student | landlord |     ├── category
│     service_provider |       ├── condition
│     admin                    ├── location
├── verified                   ├── status  pending | published |
├── is_active                  │           rejected | sold | archived
├── avatar_url, bio,           ├── featured, views, rejection_reason
│   department, level,         └── created_at
│   location, whatsapp
└── created_at                 events
                               ├── id (PK)
accommodation                  ├── creator_id ──► users.id
├── id (PK)                    ├── title, description
├── landlord_id ──► users.id   ├── date, location, category
├── title, description         ├── ticket_price, image_url
├── location, price            ├── status, views
├── rooms, room_type           └── created_at
├── gender, furnished
├── amenities, image_url       services
├── status, featured, views    ├── id (PK)
└── created_at                 ├── provider_id ──► users.id
                               ├── title, description
reviews                        ├── category, price, price_unit
├── id (PK)                    ├── location, image_url
├── author_id ──► users.id     ├── status, views
├── target_id ──► users.id     └── created_at
├── rating (1–5)
├── comment                    favorites
├── listing_type, listing_id   ├── id (PK)
└── created_at                 ├── user_id ──► users.id
   (unique: author+target)     ├── item_type, item_id
                               └── created_at
token_blocklist
├── id (PK), jti, token_type, user_id, created_at   ← makes logout real
```

Enum reference:

| Field | Allowed values |
|---|---|
| `users.user_type` | `student`, `landlord`, `service_provider`, `admin` |
| listing `status` | `pending`, `published`, `rejected`, `sold`, `archived` |
| `products.condition` | `new`, `used`, `refurbished` |
| `accommodation.room_type` | `single`, `self-contain`, `hostel`, `flat`, `shared` |
| `accommodation.gender` | `any`, `male`, `female` |
| `events.category` | `academic`, `social`, `sports`, `religious`, `career`, `entertainment`, `advert`, `others` |

---

## API reference (summary)

Full documentation with request/response bodies: **[docs/API.md](docs/API.md)**

Authentication uses `Authorization: Bearer <access_token>`.

### Auth

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/signup` | Register (student / landlord / service provider) |
| POST | `/api/auth/login` | Log in, returns access + refresh tokens |
| POST | `/api/auth/refresh` | New access token from a refresh token |
| POST | `/api/auth/logout` | Revoke the current token |
| GET | `/api/auth/me` | Current user + listing counts |
| PUT | `/api/auth/me` | Update own profile |
| POST | `/api/auth/me/password` | Change password |
| POST | `/api/auth/check-email` | Live "email already taken?" check |

### Listings

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/products` | List + filter (`q`, `category`, `min_price`, `max_price`, `location`, `condition`, `sort`, `page`, `per_page`) |
| POST | `/api/products` | Create (auth, starts as `pending`) |
| GET | `/api/products/<id>` | Details (+ similar items) |
| PUT | `/api/products/<id>` | Update (owner or admin) |
| DELETE | `/api/products/<id>` | Delete (owner or admin) |
| GET | `/api/products/categories` | Categories with counts |
| GET | `/api/accommodation` | Rooms + filters (`room_type`, `gender`, `rooms`, `furnished`, price, location) |
| POST/PUT/DELETE | `/api/accommodation[/<id>]` | Room management |
| GET | `/api/accommodation/types`, `/locations` | Filter helpers |
| GET/POST | `/api/events` | List (date range, category, `upcoming`, `free`) / create |
| GET | `/api/events/upcoming`, `/stats` | Widgets for the home page |
| GET/POST | `/api/services` | List (category, price) / create |
| GET | `/api/services/categories` | Categories with counts |

### Users, wishlist, uploads

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/users/<id>` | Public profile (ratings, counts) |
| PUT | `/api/users/<id>` | Update profile (self or admin) |
| GET | `/api/users/<id>/listings` | All listings by type (owners see drafts) |
| GET | `/api/users/<id>/stats`, `/reviews` | Counters and reviews |
| POST | `/api/users/<id>/reviews` | Create/update a 1–5 star review |
| POST | `/api/favorites` | Toggle a listing in the wishlist |
| GET | `/api/favorites`, `/api/favorites/ids` | Wishlist with details / id list |
| POST | `/api/uploads/image` | Upload a listing photo (multipart, field `image`) |

### Admin (admin token required)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/admin/pending` | Moderation queue (all types) — alias `/pending-listings` |
| POST | `/api/admin/approve/<id>` | Approve & publish (`item_type` in body/query) |
| POST | `/api/admin/reject/<id>` | Reject with optional `reason` |
| POST | `/api/admin/flag/<type>/<id>` | Flag and hide |
| POST | `/api/admin/feature/<type>/<id>` | Toggle featured badge |
| DELETE | `/api/admin/listing/<type>/<id>` | Hard delete |
| GET | `/api/admin/all-listings` | Table data (`status`, `type`, `q`, pagination) |
| GET | `/api/admin/users` | User list (`q`, `user_type`, filters) |
| POST | `/api/admin/verify/<id>` | Toggle verified badge |
| POST | `/api/admin/suspend/<id>` | Suspend / reactivate |
| POST | `/api/admin/make-admin/<id>` | Promote / demote |
| GET | `/api/admin/stats`, `/activity`, `/health` | Dashboard data |

### Utilities

`GET /api/health` · `GET /api/stats` · `GET /api/search?q=` · `GET /api/meta` · `GET /api/popular`

Every response uses one envelope:

```json
{ "success": true,  "message": "…", "data": { … } }
{ "success": false, "message": "…", "errors": { "field": "reason" } }
```

---

## Testing

### Automated API tests (23 tests)

```bash
cd backend
python -m unittest discover -s tests -t . -v
```

Covers auth (including token revocation and suspension), the full moderation workflow, CRUD permissions, every filter, pagination, search, reviews, wishlist toggling, image upload and error envelopes. Uses an in-memory SQLite database — your real data is untouched.

### Browser-level tests (jsdom)

These load the **real pages**, run the **real frontend JavaScript** against a running server and check what the user actually sees — including live interactions (wishlist heart, admin approve button, filter chips):

```bash
# with the API running on http://localhost:5000
npm install jsdom

node backend/tests/browser_smoke.js     # 66 checks: every page renders, no JS errors
node backend/tests/browser_filters.js   # 20 checks: UI counts match API filter results
```

`browser_smoke.js` asserts that each page renders its content and that the console stays clean; `browser_filters.js` drives the search boxes, category chips and filter forms and compares the number of listings shown with the number the API returns for the same query, proving the filters really filter.

### Manual smoke test checklist

| # | Step | Expected |
|---|---|---|
| 1 | Open `/` | Hero counters fill in, featured cards and events render |
| 2 | Sign up a new account | Logged in immediately, redirected to the marketplace |
| 3 | Post a product with a photo | Progress bar, preview, "submitted for review" message |
| 4 | Visit the marketplace as a guest | The new listing is **not** visible (status = pending) |
| 5 | Log in as admin → dashboard | The listing appears in the moderation queue |
| 6 | Click **Approve** | Toast confirmation, listing becomes public instantly |
| 7 | Open the listing as a guest | Details render, contact details replaced by a log-in prompt |
| 8 | Log in and open it again | Call + WhatsApp buttons appear |
| 9 | Tap ♡ on a card | Toast "Saved to your wishlist", heart fills, item appears in `/pages/favorites.html` |
| 10 | Filter by category / price / location | URL-less instant filtering with the active-filter tags |
| 11 | Resize the browser to 320 px | Bottom navigation appears, nothing overflows |
| 12 | Log out | Token revoked; protected pages redirect to login |

---

## Deployment

### Option A — Gunicorn on a Linux VPS (recommended)

```bash
# on the server
git clone https://github.com/martinssqeel-maker/campus-market-hub.git
cd campus-market-hub
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt

cd backend
cp .env.example .env      # then edit: SECRET_KEY, JWT_SECRET_KEY, ADMIN_PASSWORD
python app.py --seed      # first-time database + demo data

gunicorn --workers 3 --bind 0.0.0.0:5000 "app:app"
```

Put Nginx in front of it, proxy `/` and `/api` to `127.0.0.1:5000`, and serve `frontend/assets/uploads` from disk if you prefer.

### Option B — MySQL in production

1. Create the database and a user:

```sql
CREATE DATABASE campus_market CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'campus_user'@'localhost' IDENTIFIED BY 'StrongPass';
GRANT ALL PRIVILEGES ON campus_market.* TO 'campus_user'@'localhost';
FLUSH PRIVILEGES;
```

2. Point the app at it in `backend/.env`:

```
FLASK_ENV=production
DATABASE_URL=mysql+pymysql://campus_user:StrongPass@localhost/campus_market
SECRET_KEY=<random>
JWT_SECRET_KEY=<random>
ADMIN_PASSWORD=<strong password>
CORS_ORIGINS=https://your-domain.com
```

3. Install the driver and start the app:

```bash
pip install PyMySQL
python app.py --seed        # creates the MySQL tables
```

`app.py` normalises legacy `mysql://` URLs to `mysql+pymysql://` automatically, and the engine uses `pool_pre_ping` so long-idle connections do not break.

### Deployment checklist

- [ ] `FLASK_ENV=production` and `DEBUG=0`
- [ ] New `SECRET_KEY` and `JWT_SECRET_KEY`
- [ ] Default admin password changed (or the account renamed)
- [ ] `CORS_ORIGINS` restricted to your real domain
- [ ] HTTPS enabled (tokens travel in headers)
- [ ] Database backups scheduled (`mysqldump` / file copy)
- [ ] `AUTO_PUBLISH=false` so moderation stays on

---

## Troubleshooting

| Problem | Cause & fix |
|---|---|
| `ModuleNotFoundError: No module named 'flask'` | The virtual environment is not activated, or dependencies are missing → `source .venv/bin/activate && pip install -r backend/requirements.txt` |
| CORS error in the browser console | The frontend is on a different port than the API. Either serve the frontend from Flask (`http://localhost:5000`) or set `window.CAMPUS_API_BASE` in the page before `js/api.js` loads. |
| `401 Please log in to continue` | The access token expired. `api.js` refreshes it automatically; if the refresh token is also expired the user is redirected to the login page. |
| Uploaded image does not appear | Check `UPLOAD_FOLDER` is writable and that the saved path is under `frontend/assets/uploads`. |
| `sqlite3.OperationalError: no such table` | The database was never created → `cd backend && python app.py --seed`. |
| Port 5000 already in use | `python app.py --port 5001` (then open `http://localhost:5001`). |
| Listings stay invisible after posting | This is the moderation workflow. Approve them from the admin dashboard, or set `AUTO_PUBLISH=true` for a quick demo. |
| `413 File is too large` | The image exceeds the 5 MB limit — resize it, or raise `MAX_UPLOAD_MB` in `.env`. |
| Reset everything | `python app.py --reset --seed` (drops all tables and reloads demo data). |

---

## Project checklist

| Requirement | Status | Where |
|---|---|---|
| User authentication with JWT | ✅ | `backend/routes/auth.py`, `frontend/js/auth.js` |
| Database with 5+ tables | ✅ | 7 tables in `backend/models.py` |
| Admin approval workflow | ✅ | `backend/routes/admin.py`, `frontend/pages/admin-dashboard.html` |
| Search & filtering (category, price, location) | ✅ | products, accommodation, events, services routes |
| Responsive design (320 px+) | ✅ | `frontend/css/responsive.css` |
| Image upload | ✅ | `backend/routes/uploads.py`, `post-listing.html` |
| User profiles with ratings & history | ✅ | `backend/routes/users.py`, `profile.html` |
| 6+ working pages | ✅ | 12 pages in `frontend/` |
| SQL injection prevention | ✅ | SQLAlchemy ORM everywhere, whitelisted sorting |
| Input validation on all forms | ✅ | `backend/utils/validators.py` + client-side rules |
| Clean commits | ✅ | See `git log --oneline` |
| Documentation | ✅ | This file + [`docs/API.md`](docs/API.md) |

---

## Licence & attribution

Coursework project for the Federal University of Lafia. Built by **Martins Moses** (2023/ED/SID/OO68),
supervised by **Mr Solomon**. Free to reuse for educational purposes with attribution.
