/**
 * premium_stub_server.js — dependency-free static + API stub for UI checks.
 *
 * Serves the real `frontend/` directory exactly like Flask does (site root,
 * `/pages/...`, `/css/...`, `/js/...`, `/assets/...`) and answers the `/api/**`
 * endpoints with deterministic fixtures. That lets the jsdom harness and the
 * browser overflow checks exercise the real frontend without needing the
 * database, S3 storage or a seeded Flask instance.
 *
 * Usage:
 *   node backend/tests/premium_stub_server.js [port]
 * Then: http://127.0.0.1:<port>/index.html
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const FRONTEND = path.join(ROOT, "frontend");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon"
};

/* --------------------------------- fixtures ------------------------------ */

function product(id, over = {}) {
  return Object.assign({
    id,
    type: "product",
    item_type: "product",
    title: "Sample item " + id,
    description: "A well kept item advertised by a verified seller in Lafia.",
    price: 12500 + id * 1000,
    category: "electronics",
    condition: "used",
    location: "Angwan Rimi",
    image_url: null,
    views: 10 + id,
    featured: false,
    status: "published",
    created_at: new Date(Date.now() - id * 3600 * 1000).toISOString(),
    seller: { id: 2, name: "Aisha Bello", phone: "08031234567", verified: true, rating_average: 4.6, rating_count: 12 }
  }, over);
}

function room(id, over = {}) {
  return Object.assign({
    id,
    type: "accommodation",
    item_type: "accommodation",
    title: "Self-contain " + id,
    description: "Tiled self-contain with water and prepaid meter.",
    price: 180000 + id * 5000,
    room_type: "self-contain",
    rooms: 1,
    gender: "any",
    furnished: true,
    amenities: ["Water supply", "Prepaid meter"],
    location: "Bukan Sidi",
    image_url: null,
    views: 4 + id,
    featured: false,
    status: "published",
    created_at: new Date(Date.now() - id * 7200 * 1000).toISOString(),
    landlord: { id: 3, name: "Musa Okafor", phone: "08099887766", verified: true, rating_average: 4.2, rating_count: 5 }
  }, over);
}

function event(id, over = {}) {
  return Object.assign({
    id,
    type: "event",
    item_type: "event",
    title: "Career fair " + id,
    description: "Meet employers and graduate trainees.",
    category: "career",
    location: "Auditorium",
    date: new Date(Date.now() + id * 86400000).toISOString(),
    ticket_price: 0,
    image_url: null,
    views: 3 + id,
    featured: false,
    status: "published",
    created_at: new Date(Date.now() - id * 3600 * 1000).toISOString(),
    creator: { id: 4, name: "Student Union", phone: "08122334455", verified: true }
  }, over);
}

function service(id, over = {}) {
  return Object.assign({
    id,
    type: "service",
    item_type: "service",
    title: "Printing service " + id,
    description: "Project typing, binding and photocopies.",
    category: "printing",
    price: 500 + id * 100,
    price_unit: "per page",
    location: "Hostel",
    image_url: null,
    views: 2 + id,
    featured: false,
    status: "published",
    created_at: new Date(Date.now() - id * 5400 * 1000).toISOString(),
    provider: { id: 5, name: "Grace Danladi", phone: "08133445566", verified: true, rating_average: 4.8, rating_count: 9 }
  }, over);
}

/* One fixture carries a real, decodable image so gallery, cover-image and lazy
   loading behaviour are exercised against actual pixels rather than nothing. */
const SAMPLE_IMAGE = "/uploads/sample-1.jpg";

const PRODUCTS = Array.from({ length: 14 }, (_, i) => product(i + 1, {
  title: "Item " + (i + 1) + " for sale",
  ...(i === 0 ? { image_url: SAMPLE_IMAGE } : {})
}));
const ROOMS = Array.from({ length: 9 }, (_, i) => room(i + 1));
const EVENTS = Array.from({ length: 8 }, (_, i) => event(i + 1));
const SERVICES = Array.from({ length: 7 }, (_, i) => service(i + 1));

const USERS = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  name: "Member " + (i + 1),
  email: "member" + (i + 1) + "@example.com",
  phone: "0803000000" + i,
  user_type: i === 0 ? "admin" : "student",
  verified: i % 2 === 0,
  is_active: true,
  created_at: new Date(Date.now() - i * 86400000).toISOString()
}));

const PENDING = [
  { id: 101, item_type: "product", type_label: "Product", title: "Pending laptop", description: "Pending review", price: 90000, location: "Mararaba", created_at: new Date().toISOString(), seller: { name: "Aisha Bello" } },
  { id: 102, item_type: "accommodation", type_label: "Accommodation", title: "Pending self-contain", description: "Pending review", price: 150000, location: "Akun", created_at: new Date().toISOString(), landlord: { name: "Musa Okafor" } }
];

function pagination(total, page, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  return { page, per_page: perPage, total, pages, has_prev: page > 1, has_next: page < pages };
}

function slice(list, query) {
  const page = Number(query.get("page") || 1);
  const perPage = Number(query.get("per_page") || 12);
  const start = (page - 1) * perPage;
  return { items: list.slice(start, start + perPage), pagination: pagination(list.length, page, perPage) };
}

/* --------------------------------- routing ------------------------------- */

function apiResponse(url) {
  const p = url.pathname.replace(/^\/api/, "");
  const q = url.searchParams;

  if (p === "/health") return { service: "Campus Marketplace API", version: "1.0.0", status: "ok", database: "connected", storage: { configured: true, backend: "local" } };
  if (p === "/stats") return { products: PRODUCTS.length, accommodation: ROOMS.length, events: EVENTS.length, services: SERVICES.length, users: 42, verified_users: 20, campus: "Lafia" };
  if (p === "/meta") return {
    product_categories: ["phones", "laptops", "electronics", "accessories"],
    room_types: ["single", "self-contain", "hostel", "flat", "shared"],
    event_categories: ["academic", "career", "social", "sports", "religious", "entertainment", "advert", "others"],
    service_categories: ["laundry", "printing", "tutoring", "tech-repair", "cleaning", "barbing", "delivery", "photography", "catering", "others"],
    conditions: ["new", "used", "fairly used", "refurbished"],
    genders: ["any", "male", "female"],
    promotion_plans: [
      { id: "free", label: "Free", price: 0, days: 3, detail: "Standard placement for 3 days", points: ["Listed and searchable"] },
      { id: "7d", label: "7 days", price: 1000, days: 7, detail: "Promoted placement for a week", points: ["Promoted badge"] },
      { id: "30d", label: "30 days", price: 3500, days: 30, detail: "Promoted placement for a month", points: ["Priority inside its category"] },
      { id: "premium", label: "Premium Promotion", price: 10000, days: 30, featured: true, detail: "Priority placement plus eligible external advertising exposure", points: ["Top of its category"] }
    ],
    provider_registration_fee: { amount: 2500, currency: "NGN", note: "One-time fee to be considered for the provider directory. Payment does not imply verification." },
    sort_options: [{ value: "-created_at", label: "Newest first" }],
    user_types: ["student", "landlord", "service_provider"],
    listing_types: ["product", "accommodation", "event", "service"]
  };
  if (p === "/products/categories") return {
    categories: [
      { name: "phones", count: 5 }, { name: "laptops", count: 4 },
      { name: "electronics", count: 3 }, { name: "accessories", count: 2 }
    ]
  };
  if (p.startsWith("/products/")) {
    const id = Number(p.split("/")[2]);
    const found = LISTING_STORE.concat(PRODUCTS).find((row) => row.id === id) || PRODUCTS[0];
    return Object.assign({}, found, { similar: PRODUCTS.slice(0, 3) });
  }
  // Newest first, like the API: freshly created listings lead the list.
  if (p === "/products") return slice(LISTING_STORE.concat(PRODUCTS), q);
  if (p === "/accommodation/locations") return [
    { location: "Angwan Rimi", count: 4 }, { location: "Bukan Sidi", count: 3 }, { location: "Mararaba", count: 2 }
  ];
  if (p.startsWith("/accommodation/")) return ROOMS[0];
  if (p === "/accommodation") return slice(ROOMS, q);
  if (p === "/events/upcoming") return EVENTS.slice(0, 4);
  if (p.startsWith("/events/")) return EVENTS[0];
  if (p === "/events") return slice(EVENTS, q);
  if (p.startsWith("/services/")) return SERVICES[0];
  if (p === "/services") return slice(SERVICES, q);
  if (p === "/favorites/ids") return { ids: { product: [1], accommodation: [], event: [], service: [] } };
  if (p === "/favorites") return slice(PRODUCTS.slice(0, 2).map((row) => ({ listing: row })), q);
  if (p === "/search") {
    const term = (q.get("q") || "").toLowerCase();
    const allProducts = LISTING_STORE.concat(PRODUCTS);
    return {
      q: term,
      products: allProducts.slice(0, 3), accommodation: ROOMS.slice(0, 2),
      events: EVENTS.slice(0, 1), services: SERVICES.slice(0, 1), total: allProducts.length
    };
  }
  if (p === "/popular") return { products: LISTING_STORE.concat(PRODUCTS).slice(0, 6), rooms: ROOMS.slice(0, 4), categories: [] };
  if (p === "/admin/stats") return {
    users: { total: 42, verified: 20, new_this_week: 6 },
    listings: {
      total: 38, published_total: 30, pending_total: PENDING.length,
      products: { published: 12, pending: 1 }, accommodation: { published: 8, pending: 1 },
      events: { published: 6, pending: 0 }, services: { published: 4, pending: 0 }
    },
    engagement: { views: 512, reviews: 23 }
  };
  if (p === "/admin/pending") return { items: PENDING, total: PENDING.length };
  if (p === "/admin/activity") return { items: [{ kind: "product", label: "Item 1 for sale", status: "pending", created_at: new Date().toISOString() }] };
  if (p === "/admin/all-listings") return { items: PRODUCTS.concat(ROOMS).concat(EVENTS).concat(SERVICES), pagination: pagination(38, 1, 50) };
  if (p === "/admin/users") return { items: USERS, pagination: pagination(10, 1, 20) };
  if (p.startsWith("/admin/users/")) return Object.assign({}, USERS[0], { listings: { products: 3, accommodation: 1, events: 0, services: 2 }, rating_average: 4.5, rating_count: 4 });
  if (p === "/auth/me") return { user: USERS[0] };
  const userPath = p.slice("/users/".length);
  if (p.startsWith("/users/")) {
    if (userPath.endsWith("/listings")) return {
      products: [
        product(701, { title: "Pending approval check", status: "pending" }),
        product(702, { title: "Rejected listing check", status: "rejected" }),
        ...LISTING_STORE.concat(PRODUCTS).slice(0, 4)
      ], accommodation: ROOMS.slice(0, 2),
      events: [], services: [], counts: { products: LISTING_STORE.concat(PRODUCTS).length, accommodation: ROOMS.length, events: 0, services: 0 }
    };
    if (userPath.endsWith("/reviews")) return { reviews: [], rating_average: null, rating_count: 0 };
    if (userPath.endsWith("/stats")) return { rating_average: 4.5, rating_count: 4 };
    return Object.assign({}, USERS[1], { bio: "Trading in Lafia since 2024.", department: "Computer Science", level: "300 Level", location: "Angwan Rimi" });
  }
  if (p.startsWith("/users/")) {
    const restOfP = p.slice("/users/".length);
    if (restOfP.endsWith("/listings")) return {
      products: LISTING_STORE.concat(PRODUCTS).slice(0, 4), accommodation: ROOMS.slice(0, 2),
      events: [], services: [], counts: { products: LISTING_STORE.concat(PRODUCTS).length, accommodation: ROOMS.length, events: 0, services: 0 }
    };
  }
  return {};
}

/* Listings created through POST during a test run, so a follow-up GET can
   prove the upload survived the trip to the database and back. */
const LISTING_STORE = [];
const CREATED = [];
/* Stamp each upload so the client cannot confuse two in-flight files. */
let uploadSeq = 0;
const UPLOAD_DELAY_MS = Number(process.env.STUB_UPLOAD_DELAY_MS || 450);
const UPLOAD_LOG = [];
/* Uploaded bytes by URL, so a follow-up GET of /uploads/... returns the image
   the way the real backend would — display checks can assert on real pixels. */
const UPLOADS = new Map(); // url -> { bytes, mime }

/* Browser uploads arrive as multipart/form-data. Pull the file bytes out of
   the envelope so the stub stores exactly what the real backend would write
   to disk — display checks can then rely on actually decodable pixels. */
function multipartFileBytes(req, raw) {
  const ct = req.headers["content-type"] || "";
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct);
  if (!match) return raw;
  const boundary = "--" + (match[1] || match[2]).trim();
  const head = raw.indexOf("\r\n\r\n");
  if (raw.indexOf(boundary) === -1 || head === -1) return raw;
  const bodyStart = head + 4;
  const tail = raw.indexOf(Buffer.from("\r\n" + boundary), bodyStart);
  return raw.subarray(bodyStart, tail === -1 ? raw.length : tail);
}

function sniffMime(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length > 12 && bytes.toString("ascii", 0, 5) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length > 6 && bytes.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return "application/octet-stream";
}

function handleApi(req, res, url) {
  const chunks = [];
  req.on("data", (chunk) => { chunks.push(chunk); });
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    const body = raw.toString("utf8");
    let payload = apiResponse(url);

    /* ---- uploads: deliberately slow so the submit/upload race is real ---- */
    if (url.pathname === "/api/uploads/image") {
      uploadSeq += 1;
      const stamp = uploadSeq;
      const uploadUrl = "/uploads/stub-image-" + stamp + ".jpg";
      UPLOAD_LOG.push(stamp);
      const bytes = multipartFileBytes(req, raw);
      UPLOADS.set(uploadUrl, { bytes: bytes, mime: sniffMime(bytes) });
      return setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({
          success: true,
          message: "ok",
          data: { url: uploadUrl }
        }));
      }, UPLOAD_DELAY_MS);
    }

    /* ---- create endpoints: remember what the client actually POSTed ---- */
    if (req.method === "POST" && ["/api/products", "/api/accommodation", "/api/events", "/api/services"].includes(url.pathname)) {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch (e) { parsed = { raw: body }; }
      const created = Object.assign({ id: 900 + CREATED.length, status: "pending", views: 0 }, parsed,
        { created_at: new Date().toISOString() });
      CREATED.push({ path: url.pathname, body: parsed });
      LISTING_STORE.push(created);
      res.writeHead(201, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ success: true, message: "Listing submitted for review", data: created }));
    }

    if (url.pathname === "/api/auth/login") {
      payload = {
        access_token: "stub-access-token",
        refresh_token: "stub-refresh-token",
        user: { id: 1, name: "Stub Admin", user_type: "admin", email: "admin@example.com" }
      };
    }
    if (url.pathname === "/api/auth/signup") {
      payload = {
        access_token: "stub-access-token",
        refresh_token: "stub-refresh-token",
        user: { id: 9, name: "New Member", user_type: "student", email: "new@example.com" }
      };
    }
    if (url.pathname === "/api/auth/check-email") payload = { available: true };
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ success: true, message: "ok", data: payload }));
  });
}

/** Every response is uncacheable — a test stub must never serve stale assets. */
function headers(type) {
  return { "Content-Type": type, "Cache-Control": "no-store, must-revalidate" };
}

function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  if (UPLOADS.has(rel)) {
    const stored = UPLOADS.get(rel);
    res.writeHead(200, headers(stored.mime)).end(stored.bytes);
    return;
  }
  /* A deterministic stand-in image so fixtures with an image_url render real
     pixels. Uploaded files take precedence above. */
  if (rel === "/uploads/sample-1.jpg") {
    fs.readFile(path.join(FRONTEND, "assets", "logo.png"), (err, data) => {
      if (err) { res.writeHead(404).end("no sample image"); return; }
      res.writeHead(200, headers("image/png")).end(data);
    });
    return;
  }

  const target = path.join(FRONTEND, rel);
  if (!target.startsWith(FRONTEND)) { res.writeHead(403).end("forbidden"); return; }

  fs.readFile(target, (err, data) => {
    if (err) {
      // Flask falls back to `<name>.html` and then `pages/<name>.html`.
      const fallbacks = [target + ".html", path.join(FRONTEND, "pages", rel)];
      const tryNext = (index) => {
        if (index >= fallbacks.length) { res.writeHead(404, { "Content-Type": "text/plain" }).end("not found: " + rel); return; }
        fs.readFile(fallbacks[index], (e2, d2) => {
          if (e2) { tryNext(index + 1); return; }
          res.writeHead(200, headers(TYPES[path.extname(fallbacks[index])] || "application/octet-stream")).end(d2);
        });
      };
      tryNext(0);
      return;
    }
    res.writeHead(200, headers(TYPES[path.extname(target)] || "application/octet-stream")).end(data);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api")) { handleApi(req, res, url); return; }
    serveStatic(res, url.pathname);
  });
}

module.exports = {
  createServer,
  FRONTEND,
  fixtures: { PRODUCTS, ROOMS, EVENTS, SERVICES, PENDING, USERS },
  /* test observability: what landed in the "database" and how many uploads ran */
  created: CREATED,
  uploadLog: UPLOAD_LOG,
  reset: () => { CREATED.length = 0; uploadSeq = 0; LISTING_STORE.length = 0; UPLOAD_LOG.length = 0; UPLOADS.clear(); }
};

if (require.main === module) {
  const port = Number(process.argv[2] || 5599);
  createServer().listen(port, "127.0.0.1", () => {
    console.log("Campus Marketplace stub server on http://127.0.0.1:" + port);
  });
}
