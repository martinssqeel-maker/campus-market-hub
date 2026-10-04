# Deploying Campus Marketplace to Vercel (step by step)

This guide takes you from "empty Vercel account" to a live site. It is
written for first-time Vercel users — every click is described.

> The code is already pre-configured: `vercel.json`, the root `app.py`
> (the API entry point) and `build_vercel.py` (build script) are in the
> repository. You do **not** need to write any configuration.

---

## How the deployment works (2-minute read)

```
browser ──► Vercel
             ├── everything EXCEPT /api  →  static files from public/
             │                              (generated from frontend/ at
             │                               build time by build_vercel.py)
             └── /api/*                   →  one Python serverless function
                                              (the root app.py – Flask)
                                                   │
                    ┌──────────────────────────────┴───────────────┐
                    ▼                                              ▼
          Vercel Postgres (managed PostgreSQL)         Cloudflare R2 bucket
          users, listings, reviews…                    uploaded images
```

Two things are different from local development, and both are already
handled by the code:

1. **The database.** Vercel functions are stateless, so the app uses
   PostgreSQL instead of the local SQLite file — configured with the
   `DATABASE_URL` environment variable.
2. **Uploaded images.** A function's disk is wiped after every request, so
   images are stored in an S3-compatible bucket (we use **Cloudflare R2**
   because its free tier has *zero egress fees*). The switch is the
   `UPLOAD_STORAGE=s3` environment variable; the app returns the bucket's
   public URL for every image it stores.

Everything else (JWT auth, moderation, the API) works exactly as locally.

---

## Step 0 — Accounts you need (all free)

| Service | Free tier you get | Used for |
|---|---|---|
| [Vercel](https://vercel.com/signup) | Hobby plan, unlimited small deploys | hosting the site + the Python API |
| [Cloudflare](https://dash.cloudflare.com/sign-up) | R2: 10 GB storage, **no egress fees** | persistent storage for uploaded images |

You need your existing GitHub account (the repository) and nothing else.

---

## Step 1 — Import the repository into Vercel

1. Log in to Vercel → **Add New… → Project**.
2. Find the **campus-market-hub** repository (GitHub) → **Import**.
3. Vercel detects a Python project. Leave everything at the default
   (there is a `vercel.json` — Vercel reads the build command and routes
   from it). Click **Deploy**.
4. The first deploy will *succeed* but the site is not usable yet
   (no database, no secrets). That's expected — keep the project open;
   the remaining steps add everything.

> **Production branch:** deploy from the branch that contains this
> guide's companion changes (the branch you push from). Vercel redeploys
> automatically on every push to that branch.

---

## Step 2 — Create the PostgreSQL database (Vercel Postgres)

1. Open your project → **Storage** tab → **PostgreSQL** → **New**.
2. Name it (e.g. `campus-market`), pick any region, keep the **free**
   0.5 GB plan → **Create**.
3. On the database page you see two connection strings. Copy the
   **direct** one — it looks like:

   ```
   postgresql://username:PASSWORD@ep-xxx-yyy.us-east-2.aws.neon.tech/campus_market?sslmode=require
   ```

   - Treat it like a password — it contains one.
   - Use the *direct* connection, not the *pooled* one.
   - If the username or password contains special characters, leave them
     as shown (Vercel gives you a ready-to-use string).

4. Open **Settings → Environment Variables** and add **two** variables
   (select *Production, Preview & Development* for both):

   | Name | Value |
   |---|---|
   | `FLASK_ENV` | `production` |
   | `DATABASE_URL` | the `postgresql://…` string from step 3 |

> **Free-plan note:** an idle Vercel Postgres database can go to sleep.
> The next query wakes it (a request may be slow for a few seconds the
> first time). If you need it always awake, the paid plan removes that.

---

## Step 3 — Create the image bucket (Cloudflare R2)

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com) →
   left menu **R2 Object Storage → Create bucket**.
   - Name: `campus-market-uploads` (any name works — remember it).
   - Location: any (e.g. *US*). → **Create bucket**.
2. **Create an API token** (R2 → *Manage R2 API Tokens* → *Create API Token*):
   - Token name: `campus-market`
   - Permissions: **Object Read & Write**
   - Bucket: tick only `campus-market-uploads`
   - → **Create token**.
   - You get an **Account ID**, an **Access Key ID** and a **Secret Access
     Key**. The secret is shown **once** — save it now.
3. **Get the S3 endpoint**: open the bucket → *Settings* (or the
   *Endpoint* section). The **Cloudflare S3 Endpoint** looks like:

   ```
   https://<ACCOUNT-ID>.r2.cloudflarestorage.com
   ```

4. **Enable a public read URL** (this is how the browser will load the
   photos): bucket → *Settings → Manage Public Bucket* → *Custom domain
   settings* / *Bucket name*: type something short like `pub-cmh` →
   **Create**. Copy the generated URL, it looks like:

   ```
   https://pub-cmh.a1b2c3d4e5.r2.dev
   ```

   > An MVP listing photo is public content, so a public-read URL is the
   > right choice. (Only *uploads* use the token; *reading* images uses
   > this public URL — no CORS configuration is needed.)

5. Back in Vercel → **Settings → Environment Variables**, add **eight**
   more variables (again for all environments):

   | Name | Value |
   |---|---|
   | `UPLOAD_STORAGE` | `s3` |
   | `S3_ENDPOINT_URL` | `https://<ACCOUNT-ID>.r2.cloudflarestorage.com` |
   | `S3_BUCKET` | `campus-market-uploads` |
   | `S3_ACCESS_KEY_ID` | the Access Key ID from step 2 |
   | `S3_SECRET_ACCESS_KEY` | the Secret Access Key from step 2 |
   | `S3_REGION` | `auto` (R2 has one global region) |
   | `S3_PUBLIC_URL` | `https://pub-cmh.a1b2c3d4e5.r2.dev` (from step 4, **no** trailing slash) |
   | `S3_KEY_PREFIX` | `uploads` |

---

## Step 4 — Generate your secrets and add them

Generate two long random strings (run each command once, copy the output):

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"   # → SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(48))"   # → JWT_SECRET
```

Add them in Vercel → **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `SECRET_KEY` | output of the first command |
| `JWT_SECRET` | output of the second command |

Keep these somewhere safe (password manager). Anyone with `JWT_SECRET`
can mint login tokens.

---

## Step 5 — Create the tables and the admin account (from your computer)

This is the only step you do **outside** Vercel. You run two commands on
your machine that talk to the production database directly — no deploy
needed for them.

```bash
# 1) get the code (or your working copy) and the Python environment
git clone https://github.com/martinssqeel-maker/campus-market-hub.git
cd campus-market-hub
python -m venv .venv
source .venv/bin/activate          # Windows:  .venv\Scripts\activate
pip install -r requirements.txt

# 2) point the commands at the PRODUCTION database
export DATABASE_URL="postgresql://username:PASSWORD@ep-xxx…/campus_market?sslmode=require"
# Windows PowerShell instead of export:
#   $env:DATABASE_URL="postgresql://username:PASSWORD@ep-xxx…/campus_market?sslmode=require"

# 3) create the tables
flask --app app init-db

# 4) create the administrator (it will ask you for name, email,
#    password and phone — or set ADMIN_NAME, ADMIN_EMAIL,
#    ADMIN_PASSWORD, ADMIN_PHONE as environment variables to skip prompts)
flask --app app create-admin
```

Expected output:

```
Database tables created.
Administrator name: …
Administrator created: you@example.com
```

Notes:

- The password must contain letters **and** digits (minimum 6 characters).
- Running `create-admin` again for the same email is harmless (it just
  confirms the account is an admin).
- This creates **no demo data** — the site starts empty, which is what
  you want in production.

---

## Step 6 — Deploy (again) and verify

1. Vercel → your project → **Settings → Environment Variables** — if you
   added variables *after* the last deploy, Vercel shows a banner; click
   **Redeploy** (or simply push a commit to the connected branch).
2. Watch the build log: it runs `python3 build_vercel.py` (regenerates
   `public/`), then builds the Python function.
3. Open your site. Verify, in this order:

   | Check | What to do | Success looks like |
   |---|---|---|
   | API + database | open `https://your-site.vercel.app/api/health` | `"database": "connected"` |
   | Frontend | open `https://your-site.vercel.app/` | landing page, counters fill in |
   | Signup | create a student account | logged in, marketplace opens |
   | Image storage | post a listing **with a photo** → approve it as admin | the listing photo loads; in the R2 dashboard → bucket → *Objects* you see `uploads/u1_…png` |
   | Moderation | log in as your admin (Step 5) → dashboard → Approve | listing becomes public instantly |

You're live. 🎉

---

## Environment variables — full reference

| Variable | Required | Example / source |
|---|---|---|
| `FLASK_ENV` | yes | `production` |
| `DATABASE_URL` | yes | Vercel Postgres *direct* connection string |
| `SECRET_KEY` | yes | random string (Step 4) |
| `JWT_SECRET` | yes | *different* random string (Step 4) |
| `UPLOAD_STORAGE` | yes (for uploads) | `s3` |
| `S3_ENDPOINT_URL` | yes (for uploads) | `https://<account>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | yes (for uploads) | `campus-market-uploads` |
| `S3_ACCESS_KEY_ID` | yes (for uploads) | R2 API token (Step 3) |
| `S3_SECRET_ACCESS_KEY` | yes (for uploads) | R2 API token (Step 3) |
| `S3_REGION` | yes (for uploads) | `auto` for R2 (AWS S3: a real region like `us-east-1`) |
| `S3_PUBLIC_URL` | yes (for uploads) | `https://pub-…r2.dev` (Step 3, no trailing slash) |
| `S3_KEY_PREFIX` | optional | `uploads` (default) |
| `MAX_UPLOAD_MB` | optional | `4` is safest on the Vercel Hobby plan (function body limit ≈ 4.5 MB) |

The root `.env.example` lists the four core variables; the rest are
documented here and in `backend/.env.example` (the local-development
template, which also documents the `S3_*` block).

---

## Day-to-day operations

- **Update the site:** push to the connected branch → Vercel redeploys in
  ~1–2 minutes. (Or `vercel --prod` with the Vercel CLI.)
- **Change an environment variable:** Settings → Environment Variables →
  save → the change applies on the next deploy (Redeploy).
- **Look at data:** Vercel → Storage → PostgreSQL → *Query* tab (run
  `SELECT * FROM users;` and friends).
- **Back up the database:** from your machine,
  `pg_dump "$DATABASE_URL" > campus-backup-$(date +%F).sql` (install
  `postgresql-client` for `pg_dump`).
- **Costs:** Vercel Hobby is free for this scale; Vercel Postgres free
  tier = 0.5 GB; R2 free tier = 10 GB with zero egress fees. A busy
  student marketplace comfortably fits in the free tiers.

---

## Troubleshooting (Vercel-specific)

| Symptom | Cause & fix |
|---|---|
| `/api/health` → `"database": "error: …"` | `DATABASE_URL` typo, or the free-tier DB is asleep. Check the string character-for-character; wake the DB by running a query in the Storage tab. |
| Build fails at the *build* step | Read the log. It should run `python3 build_vercel.py`. If the error mentions the build script, confirm it exists on the deployed branch. |
| Images don't appear on listings | `S3_PUBLIC_URL` must be the exact public URL (starts with `https://pub-`, **no** trailing slash) and `S3_BUCKET` must match the bucket the images were uploaded to. Old local-relative URLs (`assets/uploads/…`) only exist in the development environment. |
| "Could not save the image. Please try again." on upload | Missing/invalid `S3_*` variables (the function's own disk is not writable). Re-check all seven `S3_*` + `UPLOAD_STORAGE=s3`. |
| First request after a long pause is slow (or times out) | Cold start + sleeping free-tier database. Subsequent requests are fast; a paid Postgres plan removes the sleep. |
| `413 File is too large` | The Hobby plan limits function request bodies to ≈ 4.5 MB. Resize the photo, or set `MAX_UPLOAD_MB=4`. |
| Site works but shows *"Cannot reach the server"* | The `/api` route in `vercel.json` was lost — make sure `vercel.json` is on the deployed branch. |
| I deployed and nothing changed | Vercel may have deployed a different branch. Check the *Deployments* tab: which branch/commit is live? |

---

## Security checklist before you share the URL

- [ ] `SECRET_KEY` and `JWT_SECRET` are the random values from Step 4 (not the
      `replace-with-…` placeholders).
- [ ] The admin password from Step 5 is strong and stored in a password
      manager — it is the only back door to the moderation workflow.
- [ ] The R2 secret access key has been revoked and re-created if it was
      ever pasted into chat/email (R2 → Manage R2 API Tokens).
- [ ] No `.env` file was committed (it is git-ignored; `git status` is clean).

---

## FAQ

**Do I need to commit `public/`?**
No. It is generated from `frontend/` by `python3 build_vercel.py` during
every Vercel build (and is git-ignored). Edit pages in `frontend/` only.

**Can I run the local app against the production database?**
Yes: set `DATABASE_URL` to the production string locally and start the app.
This is handy for inspecting production data (be careful with writes!).

**Can I deploy without R2 (local image storage)?**
You *can* skip the R2 variables, but uploaded images disappear after the
first function cold start — the Vercel filesystem is ephemeral. Persistent
images require an S3-compatible bucket.

**What if I later move off Vercel?**
The same code runs anywhere: set `DATABASE_URL` to any PostgreSQL
instance, keep `UPLOAD_STORAGE=s3` with any S3-compatible provider, and
serve `app.py` with Gunicorn (see the README deployment options).
