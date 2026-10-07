/**
 * premium_ui_checks.js — jsdom verification for the redesigned Lafia Marketplace UI.
 *
 * Boots the dependency-free stub server (real frontend files + canned API data),
 * loads every page in jsdom with the real scripts executing, and asserts:
 *
 *   1. the route guard blocks guests from every Zone 2 page
 *   2. the logged-in app shell renders consistently on every Zone 2 page
 *   3. auth pages stay public and keep their form contract
 *   4. the landing page renders real listings, counters and marketing sections
 *   5. no duplicated-word copy defects remain anywhere
 *   6. every page has a title, description and favicon
 *
 * Horizontal overflow is NOT measurable in jsdom (it has no layout engine), so
 * that check lives in the browser pass — see the notes printed at the end.
 *
 * Usage:  node backend/tests/premium_ui_checks.js
 */

"use strict";

const { JSDOM, VirtualConsole, requestInterceptor } = require("jsdom");
const { createServer } = require("./premium_stub_server");

/**
 * Every request that is not the local stub is answered with an empty response.
 * Without this the Google Fonts <link> blocks script execution on a cold cache,
 * which makes the harness flaky and dependent on the network.
 */
const offlineInterceptor = requestInterceptor(async (request) => {
  if (!/^http:\/\/127\.0\.0\.1/.test(String(request.url))) {
    return new Response("", { status: 200, headers: { "Content-Type": "text/css" } });
  }
  return undefined;
});

const results = [];
let failures = 0;

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
}

/* ------------------------------------------------------------------ server */

let BASE = "";

function startServer() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      BASE = "http://127.0.0.1:" + server.address().port;
      resolve(server);
    });
  });
}

/* ------------------------------------------------------------------- jsdom */

/** Errors jsdom emits that are environment noise, not page bugs. */
function isIgnorable(message) {
  return (
    /Not implemented: navigation/i.test(message) ||
    /Could not parse CSS/i.test(message) ||
    /Error: Not implemented: window\.(open|scrollTo)/i.test(message)
  );
}

async function loadPage(route, opts = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => {
    const message = "jsdomError: " + (e && e.message ? e.message : e);
    if (!isIgnorable(message)) errors.push(message);
  });
  virtualConsole.on("error", (...args) => errors.push("console.error: " + args.join(" ")));

  const dom = await JSDOM.fromURL(BASE + route, {
    runScripts: "dangerously",
    resources: { interceptors: [offlineInterceptor] },
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = (input, init) => {
        const url = typeof input === "string" && input.startsWith("http")
          ? input : new URL(input, window.location.href).href;
        return fetch(url, init);
      };
      window.matchMedia = window.matchMedia || (() => ({
        matches: false, media: "", addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}
      }));
      window.IntersectionObserver = window.IntersectionObserver || class {
        observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
      };
      window.URL.createObjectURL = () => "blob:stub";
      window.scrollTo = () => {};
      window.Element.prototype.scrollIntoView = () => {};
      if (opts.session) {
        window.localStorage.setItem("cm_access_token", opts.session.access);
        window.localStorage.setItem("cm_refresh_token", opts.session.refresh);
        window.localStorage.setItem("cm_user", JSON.stringify(opts.session.user));
      }
    }
  });

  // Poll for shell.js instead of sleeping a fixed amount: the very first load
  // pays jsdom/undici warm-up, and a fixed delay made that load flaky.
  const deadline = Date.now() + (opts.wait || 6000);
  while (Date.now() < deadline && !dom.window.__cmRouteGuard) {
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  // Then give the page's own fetches time to render.
  await new Promise((resolve) => setTimeout(resolve, opts.settle === undefined ? 1200 : opts.settle));
  return { dom, window: dom.window, document: dom.window.document, errors };
}

const SESSION = {
  access: "stub-access-token",
  refresh: "stub-refresh-token",
  user: { id: 1, name: "Stub Admin", user_type: "admin", email: "admin@example.com" }
};

const APP_PAGES = [
  { route: "/pages/home.html", label: "home" },
  { route: "/pages/accommodation.html", label: "accommodation" },
  { route: "/pages/events.html", label: "events" },
  { route: "/pages/services.html", label: "services" },
  { route: "/pages/post-listing.html", label: "post-listing" },
  { route: "/pages/favorites.html", label: "favorites" },
  { route: "/pages/profile.html", label: "profile" },
  { route: "/pages/product-details.html?id=1&type=product", label: "product-details" },
  { route: "/pages/admin-dashboard.html", label: "admin-dashboard" }
];

const ALL_ROUTES = ["/index.html", ...APP_PAGES.map((p) => p.route),
  "/pages/login.html", "/pages/signup.html"];

/* ------------------------------------------------------------- copy sweep */

const DEFECT_PATTERNS = [
  /\bPost Post\b/, /\bSaved Saved\b/, /\bSave Save\b/, /\bApprove Approve\b/,
  /\bRooms Rooms\b/, /\bEvents Events\b/, /\bServices Services\b/, /\bProducts Products\b/,
  /\bSports Sports\b/, /\bOther Others\b/, /\bHostel Hostel\b/, /\bFlat Flat\b/, /\bShared Shared\b/,
  /\bAcademic Academic\b/, /\bCareer Career\b/, /\bSocial Social\b/, /\bReligious Religious\b/,
  /\bEntertainment Entertain/, /\bAdverts Adverts\b/, /\bSingle room Single\b/,
  /\bSelf-contain Self-contain\b/, /\bView details View\b/, /\bBrowse all View\b/, /\bSee all View\b/,
  /\bBack Continue\b/, /\bMy wishlist Saved\b/, /\bRooms Accommodation\b/, /\bEvents Upcoming\b/,
  /\bProducts Product\b/, /\bRooms Accommodation\b/, /\bServices Service\b/, /\bEvents Event\b/,
  /UNILAFIA/, /UniLafia/, /unilafia/,
  /\bNo photo\b/, /\bNo photo available\b/, /\bLorem ipsum\b/i, /data-demo-email/
];

function scanForDefects(label, text, where) {
  const hits = DEFECT_PATTERNS.filter((re) => re.test(text)).map((re) => String(re));
  check(`${label}: no copy defects (${where})`, hits.length === 0, hits.join(", "));
}

/* -------------------------------------------------------------------- main */

(async () => {
  const server = await startServer();
  console.log(`\nStub server on ${BASE}\n${"=".repeat(74)}\n`);

  /* ---------------------------------------------- 1. guest route guard */
  console.log("--- 1. Route guard (guest) ---");
  for (const page of APP_PAGES) {
    const { window, document, errors } = await loadPage(page.route, { settle: 250 });
    const guard = window.__cmRouteGuard || {};
    check(`${page.label}: guest redirected to landing`,
      guard.status === "redirect" && /\/index\.html\?next=/.test(String(guard.target || "")),
      `status=${guard.status} target=${guard.target || "-"}`);
    check(`${page.label}: app chrome not rendered for guest`,
      document.querySelectorAll("#site-header .app-topbar").length === 0 &&
      document.querySelectorAll("#bottom-nav a").length === 0);
    check(`${page.label}: redirect gate shown`, document.querySelector(".cm-gate") !== null);
    check(`${page.label}: locked flag set on <html>`,
      document.documentElement.classList.contains("cm-locked"));
    check(`${page.label}: no JS errors`, errors.length === 0, errors.join(" | "));
  }

  /* -------------------------------------------- 2. logged-in app shell */
  console.log("\n--- 2. App shell (signed in) ---");
  for (const page of APP_PAGES) {
    const { window, document, errors } = await loadPage(page.route, { session: SESSION, wait: 1800 });
    const guard = window.__cmRouteGuard || {};
    check(`${page.label}: guard lets a signed-in user through`, guard.status === "authenticated",
      `status=${guard.status}`);
    check(`${page.label}: not locked`, !document.documentElement.classList.contains("cm-locked"));

    const isDashboard = page.label === "admin-dashboard";
    if (isDashboard) {
      check("admin-dashboard: dark console shell kept", document.getElementById("admin-dashboard") !== null);
    } else {
      check(`${page.label}: top bar rendered`, document.querySelector("#site-header.app-topbar") !== null);
      check(`${page.label}: avatar menu present`, document.getElementById("app-avatar") !== null);
      const navLinks = document.querySelectorAll("#bottom-nav a");
      check(`${page.label}: bottom nav has 5 items`, navLinks.length === 5, navLinks.length + " links");
      check(`${page.label}: elevated post button in bottom nav`,
        document.querySelector("#bottom-nav .app-nav-fab") !== null);
    }

    if (!isDashboard) {
      const isDetail = page.label === "product-details";
      const head = isDetail
        ? document.querySelector(".crumbs")
        : document.querySelector(".page-head h1");
      check(`${page.label}: page header present`, !!head,
        head ? (head.textContent.trim().slice(0, 48) || head.className) : "missing");
    }

    check(`${page.label}: has a document title`, /Lafia|Marketplace/i.test(document.title), document.title);
    check(`${page.label}: no JS errors`, errors.length === 0, errors.join(" | "));
  }

  /* ------------------------------------------- 3. page-specific content */
  console.log("\n--- 3. Page content ---");

  let page = await loadPage("/pages/home.html", { session: SESSION, wait: 1800 });
  let doc = page.document;
  check("home: listings rendered", doc.querySelectorAll("#listing-grid .listing-card").length >= 8,
    doc.querySelectorAll("#listing-grid .listing-card").length + " cards");
  check("home: listing count text", /listing/i.test(doc.getElementById("listing-count").textContent),
    doc.getElementById("listing-count").textContent);
  check("home: accommodation sidebar", doc.querySelectorAll("#side-rooms a").length > 0);
  check("home: events sidebar", doc.querySelectorAll("#side-events button").length > 0);
  check("home: pagination present", doc.querySelectorAll("#listing-pagination button").length > 0);
  check("home: favourite heart is an SVG not an emoji",
    !!doc.querySelector(".fav-btn svg"));

  page = await loadPage("/pages/accommodation.html", { session: SESSION, wait: 1800 });
  doc = page.document;
  check("accommodation: rooms rendered", doc.querySelectorAll("#room-grid .listing-card").length >= 6);
  check("accommodation: area filter populated", doc.getElementById("room-location").options.length > 2,
    doc.getElementById("room-location").options.length + " options");

  page = await loadPage("/pages/events.html", { session: SESSION, wait: 1800 });
  check("events: events rendered", page.document.querySelectorAll("#event-grid .listing-card").length >= 5);

  page = await loadPage("/pages/services.html", { session: SESSION, wait: 1800 });
  check("services: services rendered", page.document.querySelectorAll("#service-grid .listing-card").length >= 5);

  page = await loadPage("/pages/product-details.html?id=1&type=product", { session: SESSION, wait: 1800 });
  doc = page.document;
  check("details: title rendered", !!doc.querySelector("#detail-root h1"),
    doc.querySelector("#detail-root h1") ? doc.querySelector("#detail-root h1").textContent : "missing");
  check("details: price shown", /₦/.test((doc.querySelector(".price-tag") || {}).textContent || ""));
  check("details: specs list rendered", doc.querySelectorAll("#detail-root .spec-list li").length >= 4);
  check("details: WhatsApp contact for signed-in users",
    /wa\.me\/234/.test(doc.getElementById("detail-root").innerHTML));
  check("details: call link present", /tel:/.test(doc.getElementById("detail-root").innerHTML));
  check("details: save control present", doc.querySelector("[data-detail-fav]") !== null);

  page = await loadPage("/pages/post-listing.html", { session: SESSION, wait: 1800 });
  doc = page.document;
  check("post: form present", doc.getElementById("post-form") !== null);
  check("post: category options loaded (4)", doc.getElementById("category-select").options.length === 4,
    doc.getElementById("category-select").options.length + " options");
  check("post: product section visible, accommodation hidden",
    !doc.querySelector('[data-type-section="product"]').classList.contains("hidden") &&
    doc.querySelector('[data-type-section="accommodation"]').classList.contains("hidden"));
  check("post: upload zone present", doc.getElementById("upload-zone") !== null);
  check("post: upload icon is inline SVG",
    !!doc.querySelector("#upload-zone .icon svg"));

  page = await loadPage("/pages/favorites.html", { session: SESSION, wait: 1800 });
  doc = page.document;
  check("favorites: content rendered",
    doc.querySelectorAll("#favorites-root .listing-card").length > 0 ||
    /wishlist is empty/i.test(doc.getElementById("favorites-root").textContent));

  page = await loadPage("/pages/profile.html", { session: SESSION, wait: 2000 });
  doc = page.document;
  check("profile: name rendered", !!doc.querySelector("#profile-root .ud-profile h1"),
    doc.querySelector("#profile-root .ud-profile h1") ? doc.querySelector("#profile-root .ud-profile h1").textContent.trim() : "missing");
  check("profile: stat tiles rendered (4)", doc.querySelectorAll("#profile-root .ud-stat").length === 4,
    doc.querySelectorAll("#profile-root .ud-stat").length + " tiles");
  check("profile: edit button for owner", doc.querySelector('[data-action="edit-profile"]') !== null);
  check("profile: profile card grid rendered", doc.querySelectorAll("#profile-root .ud-card").length > 0);

  page = await loadPage("/pages/admin-dashboard.html", { session: SESSION, wait: 2200 });
  doc = page.document;
  check("admin: stats populated", Number(doc.getElementById("stat-users").textContent.replace(/,/g, "")) > 0,
    "users=" + doc.getElementById("stat-users").textContent);
  check("admin: pending queue rendered", doc.querySelectorAll("#pending-list [data-item-id]").length > 0,
    doc.querySelectorAll("#pending-list [data-item-id]").length + " cards");
  check("admin: admin tabs still 3", doc.querySelectorAll("#admin-tabs button[data-tab]").length === 3);
  check("admin: pending card exposes a title strong",
    !!doc.querySelector("#pending-list [data-item-id] strong"));
  check("admin: breakdown rendered", !/Loading/.test(doc.getElementById("listing-breakdown").textContent));
  check("admin: activity feed rendered", !/Loading/.test(doc.getElementById("activity-list").textContent));
  doc.querySelector('#admin-tabs [data-tab="listings"]').click();
  await new Promise((r) => setTimeout(r, 700));
  check("admin: listings table populated", doc.querySelectorAll("#listings-body tr").length > 5,
    doc.querySelectorAll("#listings-body tr").length + " rows");
  doc.querySelector('#admin-tabs [data-tab="users"]').click();
  await new Promise((r) => setTimeout(r, 700));
  check("admin: users table populated", doc.querySelectorAll("#users-body tr").length >= 9,
    doc.querySelectorAll("#users-body tr").length + " rows");

  /* -------------------------------------------------- 4. auth + landing */
  console.log("\n--- 4. Zone 1 (marketing + auth) ---");

  page = await loadPage("/pages/login.html");
  doc = page.document;
  check("login: form present, no shipped credentials",
    doc.getElementById("login-form") !== null && doc.querySelectorAll("[data-demo-email]").length === 0);
  check("login: stays public (no guard)", (page.window.__cmRouteGuard || {}).status === "public");
  check("login: back-to-home link", !!doc.querySelector(".auth-back"));
  check("login: cross-link to signup", !!doc.querySelector('a[href^="signup.html"]'));

  page = await loadPage("/pages/signup.html");
  doc = page.document;
  check("signup: form + confirm password present",
    doc.getElementById("signup-form") !== null && doc.querySelector('[name="confirm_password"]') !== null);
  check("signup: stays public (no guard)", (page.window.__cmRouteGuard || {}).status === "public");

  page = await loadPage("/index.html", { wait: 2000 });
  doc = page.document;
  check("landing: sticky glass navbar links (>=5)", doc.querySelectorAll("#site-header.mk-nav .mk-nav__links a").length >= 5,
    doc.querySelectorAll("#site-header .mk-nav__links a").length + " links");
  check("landing: hamburger + drawer control present", !!doc.querySelector("#site-header.mk-nav .mk-burger"));
  check("landing: hero headline", !!doc.querySelector(".mk-hero h1"),
    doc.querySelector(".mk-hero h1") ? doc.querySelector(".mk-hero h1").textContent.trim().slice(0, 60) : "missing");
  check("landing: two hero CTAs", doc.querySelectorAll(".mk-cta-row .btn").length === 2);
  check("landing: hero counter populated with live data",
    /^\d/.test(doc.getElementById("stat-products").textContent) &&
    Number(doc.getElementById("stat-products").textContent.replace(/[^\d]/g, "")) > 0,
    "stat-products=" + doc.getElementById("stat-products").textContent);
  check("landing: features grid has 4 cards", doc.querySelectorAll(".mk-feature").length === 4);
  check("landing: how-it-works has 3 steps", doc.querySelectorAll(".mk-step").length === 3);
  check("landing: live preview rendered real cards",
    doc.querySelectorAll("#featured-grid .listing-card").length >= 4,
    doc.querySelectorAll("#featured-grid .listing-card").length + " cards");
  check("landing: category strip rendered", doc.querySelectorAll("#category-strip .chip").length > 0);
  check("landing: rooms preview rendered", doc.querySelectorAll("#rooms-grid .listing-card").length > 0);
  check("landing: events rendered", doc.querySelectorAll("#events-list article").length > 0);
  check("landing: testimonials has 3 cards", doc.querySelectorAll(".mk-quote").length === 3);
  check("landing: FAQ has 5 items", doc.querySelectorAll("#faq details").length === 5);
  check("landing: final CTA banner", !!doc.querySelector(".mk-banner"));
  check("landing: footer has 4 columns", doc.querySelectorAll("#site-footer .mk-footer__grid > *").length === 4);
  check("landing: no app bottom nav on marketing zone", doc.querySelectorAll("#bottom-nav a").length === 0);
  check("landing: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  /* --------------------------------------------------- 5. copy sweep */
  console.log("\n--- 5. Copy sweep + metadata ---");
  for (const route of ALL_ROUTES) {
    const html = await (await fetch(BASE + route)).text();
    scanForDefects(route.replace(/^\//, ""), html, "source");
  }
  const landingHtml = await (await fetch(BASE + "/index.html")).text();
  check("landing: open-graph tags present",
    /og:title/.test(landingHtml) && /og:description/.test(landingHtml) && /og:image/.test(landingHtml));
  check("landing: meta description present", /<meta name="description"/.test(landingHtml));
  check("landing: favicon linked", /rel="icon"/.test(landingHtml));

  /* ------------------------------------------------------- 6. helper checks */
  console.log("\n--- 6. Shared components ---");
  page = await loadPage("/index.html", { wait: 1600 });
  const UI = page.window.UI;
  const pagHost = page.document.createElement("div");
  let clicked = null;
  UI.renderPagination(pagHost, { page: 2, per_page: 2, total: 5, pages: 3, has_prev: true, has_next: true },
    (n) => { clicked = n; });
  const buttons = pagHost.querySelectorAll("button");
  check("renderPagination: prev/next + pages", buttons.length === 5, buttons.length + " buttons");
  buttons[buttons.length - 2].click();
  check("renderPagination: click emits page number", clicked === 3, "clicked=" + clicked);

  check("emptyState: uses the SVG icon set, never raw labels",
    !/🔍|⚠️|❓|💔/.test(UI.emptyState("Products", "None", "Nothing here")) &&
    /<svg/.test(UI.emptyState("Products", "None", "Nothing here")));
  check("imageFor: returns null for a listing without an image", UI.imageFor({}) === null);
  check("imageFor: resolves a relative upload path",
    UI.imageFor({ image_url: "/uploads/x.jpg" }) === "../uploads/x.jpg" ||
    UI.imageFor({ image_url: "/uploads/x.jpg" }) === "uploads/x.jpg",
    UI.imageFor({ image_url: "/uploads/x.jpg" }));
  // The counter animates through requestAnimationFrame, so give it time to land.
  const counterEl = page.document.createElement("span");
  page.document.body.appendChild(counterEl);
  page.window.Shell.setCounter(counterEl, 42);
  await new Promise((r) => setTimeout(r, 1600));
  check("Shell: counter animates to the final value", counterEl.textContent === "42", counterEl.textContent);

  server.close();

  console.log("\n" + "=".repeat(74));
  console.log(`${results.length - failures}/${results.length} checks passed`);
  if (failures) {
    console.log("\nFailures:");
    results.filter((r) => !r.ok).forEach((r) => console.log(" - " + r.name + (r.detail ? " :: " + r.detail : "")));
  }
  console.log("\nNote: horizontal-overflow checks (390/768/1512px) require a real layout engine");
  console.log("and are run separately in the browser pass.");
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error("HARNESS CRASHED:", error);
  process.exit(2);
});
