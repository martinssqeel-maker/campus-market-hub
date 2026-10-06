/**
 * Browser-level filter test for Campus Marketplace.
 *
 * Drives the search boxes, category chips and filter forms on every browse
 * page and compares what the UI displays with what the API returns for the
 * same query – proving the filters really filter.
 *
 * Usage (the API must already be running on :5000):
 *     npm install jsdom
 *     node backend/tests/browser_filters.js
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
let failures = 0;

function log(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
}

async function apiTotal(path) {
  const res = await fetch(BASE + path);
  const json = await res.json();
  return json.data.pagination.total;
}

async function loadPage(path) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(e.message));
  const dom = await JSDOM.fromURL(BASE + path, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = (input, init) => fetch(
        typeof input === "string" && input.startsWith("http") ? input : new URL(input, window.location.href).href,
        init);
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, addEventListener() {}, removeEventListener() {} }));
      window.IntersectionObserver = window.IntersectionObserver || class { observe() {} disconnect() {} };
      window.scrollTo = () => {};
      window.Element.prototype.scrollIntoView = () => {};
    }
  });
  await new Promise((r) => setTimeout(r, 2400));
  return { document: dom.window.document, window: dom.window, errors };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ------------------------------------------------------- marketplace search
  let page = await loadPage("/pages/home.html");
  let doc = page.document;

  const search = doc.getElementById("market-search");
  search.value = "laptop";
  doc.getElementById("filter-form").dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(1500);
  let expected = await apiTotal("/api/products?q=laptop");
  let shown = parseInt(doc.getElementById("listing-count").textContent, 10);
  log("home: text search for \"laptop\" finds items", shown === expected && shown > 0,
      `UI ${shown} vs API ${expected}`);

  // reset via the form's reset button
  doc.querySelector('#filter-form [data-action="reset"]').click();
  await wait(1500);
  expected = await apiTotal("/api/products");
  shown = parseInt(doc.getElementById("listing-count").textContent, 10);
  log("home: reset restores all listings", shown === expected, `UI ${shown} vs API ${expected}`);

  // ------------------------------------------------------------ category chip
  doc.querySelector('#category-chips .chip[data-value="books"]').click();
  await wait(1500);
  expected = await apiTotal("/api/products?category=books");
  shown = parseInt(doc.getElementById("listing-count").textContent, 10);
  log("home: category chip filters listings", shown === expected && shown > 0, `UI ${shown} vs API ${expected}`);

  // ------------------------------------------------------------ price range
  doc.querySelector('#category-chips .chip[data-value="all"]').click();
  await wait(1200);
  doc.getElementById("min-price").value = "10000";
  doc.getElementById("max-price").value = "100000";
  doc.getElementById("filter-form").dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(1500);
  expected = await apiTotal("/api/products?min_price=10000&max_price=100000");
  shown = parseInt(doc.getElementById("listing-count").textContent, 10);
  log("home: price range filter works", shown === expected, `UI ${shown} vs API ${expected}`);

  // ------------------------------------------------------------ location
  doc.getElementById("min-price").value = "";
  doc.getElementById("max-price").value = "";
  doc.getElementById("filter-location").value = "Mararaba";
  doc.getElementById("filter-form").dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(1500);
  expected = await apiTotal("/api/products?location=Mararaba");
  shown = parseInt(doc.getElementById("listing-count").textContent, 10);
  log("home: location filter works", shown === expected && shown > 0, `UI ${shown} vs API ${expected}`);

  // ------------------------------------------------- appearance of cards
  log("home: every card links to a details page",
      [...doc.querySelectorAll(".listing-card a")].every((a) => /product-details\.html\?/.test(a.getAttribute("href"))));
  log("home: card shows price in naira",
      [...doc.querySelectorAll(".listing-price")].every((el) => /₦/.test(el.textContent)));
  log("home: no JS errors during filtering", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------------------- accommodation page
  page = await loadPage("/pages/accommodation.html");
  doc = page.document;
  doc.querySelector('#room-type-chips .chip[data-value="self-contain"]').click();
  await wait(1500);
  expected = await apiTotal("/api/accommodation?room_type=self-contain");
  shown = parseInt(doc.getElementById("room-count").textContent, 10);
  log("accommodation: room-type chip filters", shown === expected && shown > 0, `UI ${shown} vs API ${expected}`);

  doc.querySelector('#room-type-chips .chip[data-value="all"]').click();
  await wait(1200);
  doc.getElementById("room-max").value = "150000";
  doc.getElementById("room-filter-form").dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(1500);
  expected = await apiTotal("/api/accommodation?max_price=150000");
  shown = parseInt(doc.getElementById("room-count").textContent, 10);
  log("accommodation: max-price filter works", shown === expected, `UI ${shown} vs API ${expected}`);

  doc.getElementById("room-max").value = "";
  doc.getElementById("room-gender").value = "female";
  doc.getElementById("room-filter-form").dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(1500);
  expected = await apiTotal("/api/accommodation?gender=female");
  shown = parseInt(doc.getElementById("room-count").textContent, 10);
  log("accommodation: gender filter works", shown === expected && shown > 0, `UI ${shown} vs API ${expected}`);
  log("accommodation: no JS errors during filtering", page.errors.length === 0, page.errors.join(" | "));

  // --------------------------------------------------------------- events
  page = await loadPage("/pages/events.html");
  doc = page.document;
  doc.querySelector('#event-category-chips .chip[data-value="career"]').click();
  await wait(1500);
  expected = await apiTotal("/api/events?category=career");
  shown = parseInt(doc.getElementById("event-count").textContent, 10);
  log("events: category chip filters", shown === expected && shown > 0, `UI ${shown} vs API ${expected}`);

  doc.querySelector('#event-category-chips .chip[data-value="all"]').click();
  await wait(1200);
  doc.getElementById("events-upcoming").checked = true;
  doc.getElementById("events-upcoming").dispatchEvent(new page.window.Event("change", { bubbles: true }));
  await wait(1500);
  expected = await apiTotal("/api/events?upcoming=true");
  shown = parseInt(doc.getElementById("event-count").textContent, 10);
  log("events: upcoming-only filter works", shown === expected, `UI ${shown} vs API ${expected}`);

  // event detail modal opens
  doc.querySelector("#event-grid .listing-card a").click();
  await wait(300);
  log("events: clicking a card opens the details modal in place",
      doc.querySelector(".modal-backdrop") !== null &&
      /events\.html$/.test(doc.location.pathname + doc.location.search === "" ? "/pages/events.html" : doc.location.pathname),
      "url: " + doc.location.pathname + doc.location.search);
  log("events: no JS errors during filtering", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------------------------- services
  page = await loadPage("/pages/services.html");
  doc = page.document;
  doc.querySelector('#service-category-chips .chip[data-value="printing"]').click();
  await wait(1500);
  expected = await apiTotal("/api/services?category=printing");
  shown = parseInt(doc.getElementById("service-count").textContent, 10);
  log("services: category chip filters", shown === expected && shown > 0, `UI ${shown} vs API ${expected}`);
  log("services: no JS errors during filtering", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------- autocomplete on the landing page
  page = await loadPage("/index.html");
  doc = page.document;
  const heroSearch = doc.getElementById("hero-search");
  heroSearch.value = "laptop";
  heroSearch.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  await wait(1600);
  const box = doc.getElementById("hero-suggestions");
  log("landing: autocomplete shows suggestions",
      !box.classList.contains("hidden") && box.querySelectorAll("button[data-href]").length > 0,
      box.querySelectorAll("button[data-href]").length + " suggestions");
  log("landing: no JS errors during search", page.errors.length === 0, page.errors.join(" | "));

  console.log(`\n${failures === 0 ? "ALL" : ""} filter checks: ${failures} failure(s)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(2); });
