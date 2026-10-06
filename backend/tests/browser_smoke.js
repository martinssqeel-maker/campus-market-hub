/**
 * Browser-level smoke test for Campus Marketplace.
 *
 * Loads every real page in jsdom, executes the real frontend scripts against a
 * running Flask server, and asserts that content renders with no JS errors.
 * Interaction checks cover the wishlist heart and the admin approve button.
 *
 * Usage (the API must already be running on :5000):
 *     npm install jsdom
 *     node backend/tests/browser_smoke.js
 *
 * Set CM_BASE to test another host, e.g. CM_BASE=https://preview.example node …
 */
/**
 * Resolve jsdom from the current working directory as a fallback, so the test
 * can be run as `node backend/tests/browser_*.js` from the project root even
 * when `npm install jsdom` was run at the top level.
 */
function loadJsdom() {
  const path = require("path");
  try {
    return require("jsdom");
  } catch (firstError) {
    const candidates = [
      path.join(process.cwd(), "node_modules", "jsdom"),
      path.join(__dirname, "..", "..", "node_modules", "jsdom")
    ];
    for (const candidate of candidates) {
      try { return require(candidate); } catch (ignored) { /* try the next one */ }
    }
    console.error(
      "jsdom is required for this browser test.\n" +
      "Install it first:  npm install jsdom\n" +
      "then run:          node " + path.relative(process.cwd(), __filename)
    );
    throw firstError;
  }
}

const { JSDOM, VirtualConsole } = loadJsdom();

const BASE = process.env.CM_BASE || "http://127.0.0.1:5000";
const results = [];
let failures = 0;

function log(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const json = await res.json();
  if (!json.success) throw new Error("login failed: " + JSON.stringify(json));
  return { access: json.data.access_token, refresh: json.data.refresh_token, user: json.data.user };
}

async function loadPage(path, opts = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
  virtualConsole.on("error", (...args) => errors.push("console.error: " + args.join(" ")));

  const dom = await JSDOM.fromURL(BASE + path, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // Node 18+ fetch, resolving relative URLs like a browser would.
      window.fetch = (input, init) => {
        const url = typeof input === "string" && input.startsWith("http")
          ? input : new URL(input, window.location.href).href;
        return fetch(url, init);
      };
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      window.IntersectionObserver = window.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} };
      window.URL.createObjectURL = () => "blob:mock";
      window.scrollTo = () => {};
      window.Element.prototype.scrollIntoView = () => {};
      if (opts.session) {
        window.localStorage.setItem("cm_access_token", opts.session.access);
        window.localStorage.setItem("cm_refresh_token", opts.session.refresh);
        window.localStorage.setItem("cm_user", JSON.stringify(opts.session.user));
      }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, opts.wait || 2200));
  return { dom, window: dom.window, document: dom.window.document, errors };
}

function countCards(doc) {
  return doc.querySelectorAll(".listing-card").length;
}

(async () => {
  // ---------------------------------------------------------------- landing
  let page = await loadPage("/index.html");
  let doc = page.document;
  log("landing: header nav rendered", doc.querySelectorAll("#site-header .main-nav a").length >= 5);
  log("landing: hero stat filled", /^\d/.test(doc.getElementById("stat-products").textContent),
      "stat-products=" + doc.getElementById("stat-products").textContent);
  log("landing: featured listings rendered", countCards(doc) >= 4, countCards(doc) + " cards");
  log("landing: events rendered", doc.querySelectorAll("#events-list article").length > 0,
      doc.querySelectorAll("#events-list article").length + " events");
  log("landing: category strip rendered", doc.querySelectorAll("#category-strip .chip").length > 0);
  log("landing: footer rendered", /Campus Marketplace/.test(doc.getElementById("site-footer").textContent));
  log("landing: bottom nav rendered", doc.querySelectorAll("#bottom-nav a").length === 5);
  log("landing: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------------------- marketplace home
  page = await loadPage("/pages/home.html");
  doc = page.document;
  log("home: listings rendered", countCards(doc) >= 8, countCards(doc) + " cards");
  log("home: listing count text", /listing/.test(doc.getElementById("listing-count").textContent),
      doc.getElementById("listing-count").textContent);
  log("home: accommodation sidebar", doc.querySelectorAll("#side-rooms a").length > 0 ||
      /No rooms/.test(doc.getElementById("side-rooms").textContent));
  log("home: events sidebar", doc.querySelectorAll("#side-events button").length > 0 ||
      /No upcoming/.test(doc.getElementById("side-events").textContent));
  // Pagination shows buttons only when there is more than one page.
  const countText = doc.getElementById("listing-count").textContent;
  const totalListings = parseInt(countText, 10);
  const paginationButtons = doc.querySelectorAll("#listing-pagination button").length;
  log("home: pagination consistent with page count",
      totalListings > 12 ? paginationButtons > 0 : paginationButtons === 0,
      countText + " → " + paginationButtons + " buttons");

  // Component-level check of the pagination renderer (multi-page case).
  const pagHost = doc.createElement("div");
  doc.body.appendChild(pagHost);
  let clicked = null;
  page.window.UI.renderPagination(pagHost,
    { page: 2, per_page: 2, total: 5, pages: 3, has_prev: true, has_next: true },
    (n) => { clicked = n; });
  const pagHtml = pagHost.querySelectorAll("button");
  log("home: pagination renders prev/next + pages", pagHtml.length === 5, pagHtml.length + " buttons");
  pagHtml[pagHtml.length - 2].click();     // "Next ›"
  log("home: pagination click emits page number", clicked === 3, "clicked=" + clicked);

  // Wishlist toggle through the real UI (logged out → prompts login).
  const favBtn = doc.querySelector(".fav-btn");
  favBtn.click();
  await new Promise((r) => setTimeout(r, 400));
  log("home: guest wishlist click shows prompt",
      /log in to save/i.test([...doc.querySelectorAll(".toast")].map((t) => t.textContent).join(" ")));
  log("home: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // -------------------------------------------------------- accommodation
  page = await loadPage("/pages/accommodation.html");
  doc = page.document;
  log("accommodation: rooms rendered", countCards(doc) >= 6, countCards(doc) + " cards");
  log("accommodation: location filter populated",
      doc.getElementById("room-location").options.length > 2,
      doc.getElementById("room-location").options.length + " options");
  log("accommodation: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // -------------------------------------------------------------- events
  page = await loadPage("/pages/events.html");
  doc = page.document;
  log("events: events rendered", countCards(doc) >= 7, countCards(doc) + " cards");
  log("events: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------------------------ services
  page = await loadPage("/pages/services.html");
  doc = page.document;
  log("services: services rendered", countCards(doc) >= 5, countCards(doc) + " cards");
  log("services: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ----------------------------------------------------- product details
  page = await loadPage("/pages/product-details.html?id=1&type=product");
  doc = page.document;
  log("details: title rendered", doc.querySelector("#detail-root h1") !== null,
      doc.querySelector("#detail-root h1")?.textContent);
  log("details: price shown", /₦/.test(doc.querySelector(".price-tag")?.textContent || ""),
      doc.querySelector(".price-tag")?.textContent);
  log("details: login prompt for guests",
      /Log in to see contact details/.test(doc.getElementById("detail-root").textContent));
  log("details: specs list rendered", doc.querySelectorAll(".spec-list li").length >= 4);
  log("details: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------ product details (logged in)
  const student = await login("aisha.bello@unilafia.edu.ng", "Student@123");
  page = await loadPage("/pages/product-details.html?id=3&type=product", { session: student });
  doc = page.document;
  log("details(authed): WhatsApp link present",
      /wa.me\/234/.test(doc.getElementById("detail-root").innerHTML));
  log("details(authed): call link present", /tel:/.test(doc.getElementById("detail-root").innerHTML));
  log("details(authed): save button present",
      doc.querySelector("[data-detail-fav]") !== null);
  log("details(authed): no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------------------------- profile
  page = await loadPage("/pages/profile.html", { session: student });
  doc = page.document;
  log("profile: name rendered", doc.querySelector(".profile-hero h1") !== null,
      doc.querySelector(".profile-hero h1")?.textContent.trim());
  log("profile: stat tiles rendered", doc.querySelectorAll(".stat-tile").length === 4);
  log("profile: tab listings rendered", countCards(doc) > 0, countCards(doc) + " cards");
  log("profile: edit button for owner", doc.querySelector('[data-action="edit-profile"]') !== null);
  log("profile: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ----------------------------------------------------------- favorites
  page = await loadPage("/pages/favorites.html", { session: student });
  doc = page.document;
  log("favorites: content rendered",
      countCards(doc) > 0 || /wishlist is empty/.test(doc.getElementById("favorites-root").textContent),
      countCards(doc) + " saved cards");
  log("favorites: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // --------------------------------------------------------- post listing
  page = await loadPage("/pages/post-listing.html", { session: student });
  doc = page.document;
  log("post: form present", doc.getElementById("post-form") !== null);
  log("post: category options loaded",
      doc.getElementById("category-select").options.length === 10,
      doc.getElementById("category-select").options.length + " options");
  log("post: product section visible, accommodation hidden",
      !doc.querySelector('[data-type-section="product"]').classList.contains("hidden") &&
      doc.querySelector('[data-type-section="accommodation"]').classList.contains("hidden"));
  log("post: upload zone present", doc.getElementById("upload-zone") !== null);
  log("post: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------------------------- login
  page = await loadPage("/pages/login.html");
  doc = page.document;
  log("login: form has no shipped credentials",
      doc.getElementById("login-form") !== null && doc.querySelectorAll("[data-demo-email]").length === 0);
  log("login: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------------------------ signup
  page = await loadPage("/pages/signup.html");
  doc = page.document;
  log("signup: form fields present",
      doc.getElementById("signup-form") !== null &&
      doc.querySelector('[name="confirm_password"]') !== null);
  log("signup: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ---------------------------------------------------------- admin dash
  const admin = await login("admin@unilafia.edu.ng", "Admin@1234");
  page = await loadPage("/pages/admin-dashboard.html", { session: admin, wait: 3000 });
  doc = page.document;
  log("admin: stats populated", Number(doc.getElementById("stat-users").textContent.replace(/,/g, "")) > 0,
      "users=" + doc.getElementById("stat-users").textContent);
  log("admin: pending queue rendered",
      doc.querySelectorAll("#pending-list [data-item-id]").length > 0,
      doc.querySelectorAll("#pending-list [data-item-id]").length + " pending cards");
  log("admin: breakdown rendered",
      !/Loading/.test(doc.getElementById("listing-breakdown").textContent));
  log("admin: activity feed rendered",
      !/Loading/.test(doc.getElementById("activity-list").textContent));
  log("admin: tabs present", doc.querySelectorAll("#admin-tabs button[data-tab]").length === 3);
  log("admin: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------- authenticated UI actions
  page = await loadPage("/pages/home.html", { session: student, wait: 2600 });
  doc = page.document;
  const favBefore = await (await fetch(`${BASE}/api/favorites/ids`, {
    headers: { Authorization: "Bearer " + student.access } })).json();
  const alreadySaved = (favBefore.data.ids.product || []);
  const targetFav = [...doc.querySelectorAll(".fav-btn")].find(
    (b) => !alreadySaved.includes(Number(b.dataset.favId)));
  targetFav.click();
  await new Promise((r) => setTimeout(r, 1200));
  const favAfter = await (await fetch(`${BASE}/api/favorites/ids`, {
    headers: { Authorization: "Bearer " + student.access } })).json();
  log("home(authed): wishlist heart saves to the API",
      (favAfter.data.ids.product || []).includes(Number(targetFav.dataset.favId)),
      "saved ids: " + JSON.stringify(favAfter.data.ids.product));
  log("home(authed): heart turns filled", targetFav.classList.contains("active"));
  targetFav.click();   // clean up
  await new Promise((r) => setTimeout(r, 1000));
  const favClean = await (await fetch(`${BASE}/api/favorites/ids`, {
    headers: { Authorization: "Bearer " + student.access } })).json();
  log("home(authed): second click un-saves",
      !(favClean.data.ids.product || []).includes(Number(targetFav.dataset.favId)));
  log("home(authed): no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------------ admin approve action
  page = await loadPage("/pages/admin-dashboard.html", { session: admin, wait: 3000 });
  doc = page.document;
  const pendingBefore = (await (await fetch(`${BASE}/api/admin/pending`, {
    headers: { Authorization: "Bearer " + admin.access } })).json()).data.total;
  const approveBtn = doc.querySelector('#pending-list [data-action="approve"]');
  const approvedTitle = approveBtn.closest("[data-item-id]").querySelector("strong").textContent;
  approveBtn.click();
  await new Promise((r) => setTimeout(r, 2500));
  const pendingAfter = (await (await fetch(`${BASE}/api/admin/pending`, {
    headers: { Authorization: "Bearer " + admin.access } })).json()).data.total;
  log("admin: approve button publishes a listing",
      pendingAfter === pendingBefore - 1, `${pendingBefore} → ${pendingAfter} pending`);
  log("admin: toast confirms approval",
      /approved/i.test([...doc.querySelectorAll(".toast")].map((t) => t.textContent).join(" ")),
      approvedTitle);

  // --------------------------------------------- admin listings + users tab
  doc.querySelector('#admin-tabs [data-tab="listings"]').click();
  await new Promise((r) => setTimeout(r, 1800));
  log("admin: listings table populated",
      doc.querySelectorAll("#listings-body tr").length > 5,
      doc.querySelectorAll("#listings-body tr").length + " rows");
  doc.querySelector('#admin-tabs [data-tab="users"]').click();
  await new Promise((r) => setTimeout(r, 1800));
  log("admin: users table populated",
      doc.querySelectorAll("#users-body tr").length >= 9,
      doc.querySelectorAll("#users-body tr").length + " rows");
  log("admin: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // -------------------------------------------- guest guard on profile
  page = await loadPage("/pages/profile.html", { wait: 1800 });
  doc = page.document;
  log("profile(guest): asks user to log in",
      /Please log in/.test(doc.getElementById("profile-root").textContent));
  log("profile(guest): no JS errors", page.errors.length === 0, page.errors.join(" | "));

  console.log(`\n${results.length - failures}/${results.length} frontend checks passed`);
  if (failures) {
    console.log("\nFailures:");
    results.filter((r) => !r.ok).forEach((r) => console.log(" - " + r.name + " :: " + r.detail));
  }
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error("SMOKE TEST CRASHED:", error);
  process.exit(2);
});
