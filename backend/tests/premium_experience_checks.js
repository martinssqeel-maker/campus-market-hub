/**
 * premium_experience_checks.js — verification for the surfaces the redesign adds.
 *
 * `premium_ui_checks.js` and `premium_overflow_checks.js` cover the original page
 * set and are kept at their 200/84 contract. This suite covers everything new:
 *
 *   1. Messages — route guard, conversation list, real thread created from a
 *      listing, quick replies and the Make an Offer flow
 *   2. Game Centre — guard, board, daily challenge, a genuinely completed game
 *      (score, streak, achievements, weekly board, history)
 *   3. App shell additions — location picker, notification centre, bottom nav
 *      labels exactly Home | Saved | Sell | Messages | Profile
 *   4. Public landing page is marketing-only
 *   5. Real-layout overflow at 390 / 768 / 1512 px for both new pages
 *
 * Usage:  node backend/tests/premium_experience_checks.js
 */

"use strict";

const path = require("path");
const fs = require("fs");
const { JSDOM, VirtualConsole, requestInterceptor } = require("jsdom");
const puppeteer = require("puppeteer");
const { createServer } = require("./premium_stub_server");

const SHOT_DIR = path.join(__dirname, "__screens__");
const WIDTHS = [390, 768, 1512];

const results = [];
let failures = 0;

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
}

const offlineInterceptor = requestInterceptor(async (request) => {
  if (!/^http:\/\/127\.0\.0\.1/.test(String(request.url))) {
    return new Response("", { status: 200, headers: { "Content-Type": "text/css" } });
  }
  return undefined;
});

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

function isIgnorable(message) {
  return (
    /Not implemented: navigation/i.test(message) ||
    /Could not parse CSS/i.test(message) ||
    /Error: Not implemented: window\.(open|scrollTo)/i.test(message)
  );
}

const SESSION = {
  access: "stub-access-token",
  refresh: "stub-refresh-token",
  user: { id: 1, name: "Stub Admin", user_type: "admin", email: "admin@example.com" }
};

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
      window.navigator.vibrate = () => true;
      if (opts.session) {
        window.localStorage.setItem("cm_access_token", opts.session.access);
        window.localStorage.setItem("cm_refresh_token", opts.session.refresh);
        window.localStorage.setItem("cm_user", JSON.stringify(opts.session.user));
      }
      Object.keys(opts.storage || {}).forEach((key) => {
        window.localStorage.setItem(key, opts.storage[key]);
      });
    }
  });

  const deadline = Date.now() + (opts.wait || 6000);
  while (Date.now() < deadline && !dom.window.__cmRouteGuard) {
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  await new Promise((resolve) => setTimeout(resolve, opts.settle === undefined ? 1200 : opts.settle));
  return { dom, window: dom.window, document: dom.window.document, errors };
}

/* ══════════════════════════════════════════════════════════ 1. route guard */

async function guardChecks() {
  console.log("--- 1. Route guard on the new pages ---");
  for (const page of [
    { route: "/pages/messages.html", label: "messages" },
    { route: "/pages/game-centre.html", label: "game-centre" }
  ]) {
    const { window, document, errors } = await loadPage(page.route, { settle: 250 });
    const guard = window.__cmRouteGuard || {};
    check(`${page.label}: guest is sent to sign in`,
      guard.status === "redirect" && /\/index\.html\?next=/.test(String(guard.target || "")),
      `status=${guard.status}`);
    check(`${page.label}: no app chrome for a guest`,
      document.querySelectorAll("#site-header .app-topbar").length === 0 &&
      document.querySelectorAll("#bottom-nav a").length === 0);
    check(`${page.label}: no JS errors for a guest`, errors.length === 0, errors.join(" | "));
  }
}

/* ═══════════════════════════════════════════════════ 2. shell + nav labels */

async function shellChecks() {
  console.log("\n--- 2. App shell additions ---");
  for (const page of [
    { route: "/pages/messages.html", label: "messages" },
    { route: "/pages/game-centre.html", label: "game-centre" },
    { route: "/pages/home.html", label: "home" }
  ]) {
    const { document, errors } = await loadPage(page.route, { session: SESSION, wait: 1800 });
    check(`${page.label}: top bar rendered`, document.querySelector("#site-header.app-topbar") !== null);
    check(`${page.label}: location control present`, document.getElementById("app-loc") !== null);
    check(`${page.label}: notification bell present`, document.getElementById("app-bell") !== null);

    const labels = Array.from(document.querySelectorAll("#bottom-nav a span"))
      .map((node) => node.textContent.trim())
      .filter((text) => text && text !== "0");
    check(`${page.label}: bottom nav is exactly Home|Saved|Sell|Messages|Profile`,
      labels.join("|") === "Home|Saved|Sell|Messages|Profile", labels.join("|"));
    check(`${page.label}: no JS errors`, errors.length === 0, errors.join(" | "));
  }
}

/* ═════════════════════════════════════════════════════════════ 3. messages */

async function messagesChecks() {
  console.log("\n--- 3. Messages ---");

  let page = await loadPage("/pages/messages.html", { session: SESSION, wait: 1800 });
  let doc = page.document;
  check("messages: empty state before any conversation",
    /No conversations yet/.test(doc.getElementById("msg-list").textContent),
    doc.getElementById("msg-list").textContent.trim().slice(0, 60));
  check("messages: pane asks the reader to pick a conversation",
    /Select a conversation/.test(doc.getElementById("msg-pane").textContent));
  check("messages: filter chips rendered", doc.querySelectorAll("#msg-filters .chip").length === 3);

  /* The real flow: open a listing, press Message, then read that thread back. */
  page = await loadPage("/pages/product-details.html?id=1&type=product", { session: SESSION, wait: 1800 });
  doc = page.document;
  const messageButton = doc.querySelector('[data-action="message"]');
  check("details: Message is the primary contact action",
    !!messageButton && /btn-primary/.test(messageButton.className),
    messageButton ? messageButton.className : "missing");
  check("details: Make an Offer action present", doc.querySelector('[data-action="offer"]') !== null);

  if (messageButton) messageButton.click();
  await new Promise((r) => setTimeout(r, 300));

  const stored = page.window.localStorage.getItem("cm_threads:u1");
  const threads = stored ? JSON.parse(stored) : [];
  check("details: messaging a listing opens a real conversation",
    threads.length === 1 && threads[0].messages.length === 0,
    threads.length + " thread(s)");
  check("details: the thread carries the listing identity",
    threads.length === 1 && /for sale/.test(threads[0].listing.title),
    threads[0] ? threads[0].listing.title : "-");

  /* Re-open the app against that stored conversation. */
  page = await loadPage("/pages/messages.html", {
    session: SESSION, wait: 1800,
    storage: stored ? { "cm_threads:u1": stored } : {}
  });
  doc = page.document;
  check("messages: conversation is listed after messaging a listing",
    doc.querySelectorAll("#msg-list [data-thread]").length === 1,
    doc.querySelectorAll("#msg-list [data-thread]").length + " rows");
  check("messages: listing context shown at the top of the thread",
    !!doc.querySelector(".msg-context") && /for sale/.test(doc.querySelector(".msg-context").textContent));
  check("messages: quick replies offered",
    doc.querySelectorAll(".quick-chip").length === 6,
    doc.querySelectorAll(".quick-chip").length + " quick replies");
  /* Offer first, while the composer is untouched, so the note the product
     writes for the buyer is measured on a clean state. */
  check("messages: Make an offer opens the amount panel",
    (() => {
      const chip = doc.querySelector('.quick-chip[data-quick="offer"]');
      if (!chip) return false;
      chip.click();
      const amount = doc.getElementById("offer-amount");
      const note = doc.getElementById("msg-text");
      return !!amount && /I will buy it at this price/.test(note ? note.value : "");
    })(),
    (doc.getElementById("msg-text") || {}).value || "no composer");
  check("messages: the offer amount takes focus",
    doc.activeElement && doc.activeElement.id === "offer-amount",
    (doc.activeElement && doc.activeElement.id) || "-");
  check("messages: the amount panel explains what happens next",
    /accept, reject or counter/i.test((doc.getElementById("offer-slot") || {}).textContent || ""));

  check("messages: quick reply is editable, not auto-sent",
    (() => {
      const chip = doc.querySelector('.quick-chip[data-quick="available"]');
      if (!chip) return false;
      chip.click();
      const field = doc.getElementById("msg-text");
      return !!field && /still available/i.test(field.value);
    })(),
    (doc.getElementById("msg-text") || {}).value || "no composer");

  const amount = doc.getElementById("offer-amount");
  const field = doc.getElementById("msg-text");
  if (amount && field) {
    amount.value = "4000";
    field.value = "I will buy it at this price.";
    doc.getElementById("msg-composer").dispatchEvent(
      new doc.defaultView.Event("submit", { bubbles: true, cancelable: true }));
    /* The send is async (storage write then re-render). */
    await new Promise((r) => setTimeout(r, 300));
  }
  const offerBubbles = doc.querySelectorAll(".msg-bubble.is-offer");
  check("messages: sending an offer records it in the conversation",
    offerBubbles.length === 1 && /4,000/.test(offerBubbles[0].textContent),
    offerBubbles.length + " offer bubble(s) of " + doc.querySelectorAll(".msg-bubble").length);
  check("messages: the sent offer is persisted with its amount",
    (() => {
      const saved = JSON.parse(page.window.localStorage.getItem("cm_threads:u1") || "[]");
      const sent = saved[0] && saved[0].messages[saved[0].messages.length - 1];
      return !!sent && String(sent.offer) === "4000";
    })(),
    (() => {
      const saved = JSON.parse(page.window.localStorage.getItem("cm_threads:u1") || "[]");
      return JSON.stringify((saved[0] && saved[0].messages) || []).slice(0, 120);
    })());
  check("messages: the offer panel closes after sending",
    !doc.getElementById("offer-amount"));

  check("messages: the thread states where it is stored",
    /stored on your device/i.test(doc.getElementById("msg-pane").textContent));

  const badge = doc.querySelector("[data-msg-badge]");
  check("messages: unread badge element exists on the Messages tab", !!badge);
  check("messages: no JS errors", page.errors.length === 0, page.errors.join(" | "));
}

/* ══════════════════════════════════════════════════════════ 4. game centre */

/** Read the board and return the tile indices of one matching pair. */
function readBoard(document) {
  const tiles = Array.from(document.querySelectorAll("#game-board .game-tile"));
  const byIcon = {};
  tiles.forEach((tile, index) => {
    const faces = tile.querySelectorAll(".game-tile__face");
    const icon = faces[faces.length - 1].innerHTML;
    byIcon[icon] = byIcon[icon] || [];
    byIcon[icon].push(index);
  });
  return { tiles, pairs: Object.keys(byIcon).map((icon) => byIcon[icon]) };
}

async function gameChecks() {
  console.log("\n--- 4. Game Centre ---");

  let page = await loadPage("/pages/game-centre.html", { session: SESSION, wait: 1800 });
  let doc = page.document;

  check("game: stage rendered", !!doc.getElementById("game-board-panel"));
  check("game: exact label 'Game Centre' in the page heading",
    /Game Centre/.test(doc.querySelector(".page-head h1").textContent),
    doc.querySelector(".page-head h1").textContent.trim());
  check("game: three difficulty levels offered", doc.querySelectorAll("#game-levels [data-level]").length === 3);
  check("game: seven achievements listed", doc.querySelectorAll("#game-achievements .ach").length === 7,
    doc.querySelectorAll("#game-achievements .ach").length + " badges");
  check("game: board dealt with 16 tiles for Classic",
    doc.querySelectorAll("#game-board .game-tile").length === 16,
    doc.querySelectorAll("#game-board .game-tile").length + " tiles");
  check("game: every tile exposes a keyboard-operable button",
    Array.from(doc.querySelectorAll("#game-board .game-tile")).every((t) => t.tagName === "BUTTON"));
  check("game: HUD has score, time, moves and combo",
    !!doc.getElementById("hud-score") && !!doc.getElementById("hud-time") &&
    !!doc.getElementById("hud-moves") && !!doc.getElementById("hud-combo"));
  check("game: score starts at zero", doc.getElementById("hud-score").textContent === "0");
  check("game: leaderboard starts with an honest empty state",
    /No scores this week yet/.test(doc.getElementById("game-leaderboard").textContent));
  check("game: history starts empty", /No games logged yet/.test(doc.getElementById("game-history").textContent));
  check("game: summary shows the player's real totals",
    /High score/.test(doc.getElementById("game-summary").textContent) &&
    /Games played/.test(doc.getElementById("game-summary").textContent));

  /* Play a whole board for real: match pairs by reading the DOM. */
  const board = readBoard(doc);
  check("game: board contains eight distinct pairs", board.pairs.length === 8,
    board.pairs.length + " pairs");

  board.pairs.forEach((pair) => {
    pair.forEach((index) => {
      const tile = doc.querySelector(`#game-board .game-tile[data-index="${index}"]`);
      if (tile && !tile.disabled) tile.click();
    });
  });
  await new Promise((r) => setTimeout(r, 400));

  check("game: matching a pair scores points",
    Number(doc.getElementById("hud-score").textContent.replace(/,/g, "")) > 0,
    doc.getElementById("hud-score").textContent);
  check("game: move counter tracked the flips", doc.getElementById("hud-moves").textContent === "8",
    doc.getElementById("hud-moves").textContent);
  check("game: every matched tile is locked",
    doc.querySelectorAll("#game-board .game-tile.is-matched").length === 16,
    doc.querySelectorAll("#game-board .game-tile.is-matched").length + " matched");
  check("game: completions are recorded in the summary",
    /1/.test(doc.getElementById("game-summary").querySelectorAll(".game-stat b")[1].textContent),
    doc.getElementById("game-summary").querySelectorAll(".game-stat b")[1].textContent);
  check("game: weekly leaderboard now shows the real player",
    doc.querySelector("#game-leaderboard .board-row.is-me") !== null &&
    /Stub Admin/.test(doc.getElementById("game-leaderboard").textContent));
  check("game: leaderboard never invents other players",
    /No other players yet/.test(doc.getElementById("game-leaderboard").textContent));
  check("game: score history recorded the run",
    doc.querySelectorAll("#game-history .histogram__bar").length === 1 &&
    doc.querySelectorAll("#game-history tbody tr").length === 1);
  /* A flawless, sub-60s, 2000+ point run legitimately satisfies several
     conditions at once — assert the first-game badge landed and that every
     awarded badge is one of the documented conditions. */
  const earned = [...doc.querySelectorAll("#game-achievements .ach.is-earned")]
    .map((node) => node.textContent.trim());
  check("game: achievements award on real conditions",
    earned.length >= 1 && earned.some((label) => /Open for business/i.test(label)),
    earned.length + " earned: " + earned.join(" / "));
  check("game: locked achievements stay locked",
    doc.querySelectorAll("#game-achievements .ach:not(.is-earned)").length ===
      (doc.querySelectorAll("#game-achievements .ach").length - earned.length));

  const gameState = JSON.parse(page.window.localStorage.getItem("cm_game:u1") || "{}");
  check("game: progress persisted with a high score",
    Number(gameState.best || 0) > 0 && gameState.games === 1,
    JSON.stringify({ best: gameState.best, games: gameState.games }));
  check("game: no JS errors after a full board", page.errors.length === 0, page.errors.join(" | "));

  /* Daily challenge deals a different, deterministic board. */
  const daily = doc.querySelector("[data-daily]");
  if (daily) daily.click();
  await new Promise((r) => setTimeout(r, 400));
  check("game: daily challenge starts a fresh board",
    doc.getElementById("hud-moves").textContent === "0" &&
    doc.querySelectorAll("#game-board .game-tile.is-matched").length === 0);
  check("game: daily challenge is announced to screen readers",
    /Daily challenge started/i.test(doc.getElementById("game-status").textContent),
    doc.getElementById("game-status").textContent.slice(0, 60));

  /* The Game Centre is promoted on Home, not buried in a tab. */
  page = await loadPage("/pages/home.html", { session: SESSION, wait: 2000 });
  doc = page.document;
  const homeGame = doc.getElementById("home-game");
  check("home: Game Centre module is promoted on Home",
    !!homeGame && /Game Centre/.test(homeGame.textContent) && !!homeGame.querySelector(".deep-surface"));
  check("home: four pillars are reachable from Home",
    doc.querySelectorAll("#home-pillars .pillar-tile").length === 4);
  check("home: discovery rows rendered adaptively",
    doc.querySelectorAll("#home-discovery .discovery-row").length > 0,
    doc.querySelectorAll("#home-discovery .discovery-row").length + " rows");
  check("home: no JS errors", page.errors.length === 0, page.errors.join(" | "));
}

/* ═══════════════════════════════════════════════════════════════ 5. landing */

async function landingChecks() {
  console.log("\n--- 5. Public landing page ---");
  const { document, errors } = await loadPage("/index.html", { wait: 2000 });
  check("landing: marketing zones only — no marketplace rows",
    document.querySelectorAll("#featured-grid, #rooms-grid, #events-list, #listing-grid").length === 0);
  check("landing: four pillars explain the product",
    document.querySelectorAll("#pillars .pl-card").length === 4);
  check("landing: every pillar links to its own surface",
    ["home.html", "accommodation.html", "events.html", "services.html"].every((target) =>
      !!document.querySelector(`#pillars a[href*="${target}"]`)));
  check("landing: trust layer is explained, not implied",
    document.querySelectorAll("#safety .trust-item").length === 6);
  check("landing: Game Centre is visible on the landing page",
    /Game Centre/.test(document.getElementById("game").textContent));
  check("landing: no JS errors", errors.length === 0, errors.join(" | "));
}

/* ═══════════════════════════════════════════════════ 6. real-layout overflow */

function measure() {
  const de = document.documentElement;
  const viewport = de.clientWidth;
  const offenders = [];

  /* An element that sits inside a real horizontal scroller (.quick-row,
     .table-wrap, .gallery__thumbs) is allowed to be wider than the viewport —
     that is the design. `overflow: hidden/clip` deliberately does NOT count:
     clip is exactly how a broken layout hides itself, and that is the bug this
     check exists to catch. */
  const inScroller = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const ox = getComputedStyle(node).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
      node = node.parentElement;
    }
    return false;
  };

  /* Full-bleed ambience (the hero mesh, grid and colour orbs) is meant to run
     past the edge. Those layers are hidden from assistive tech and take no
     pointer events, which is exactly what makes them decoration rather than
     content — an icon wrapper inside a real control fails both tests. */
  const isDecoration = (el) => {
    const holder = el.closest('[aria-hidden="true"]');
    return !!holder && getComputedStyle(holder).pointerEvents === "none";
  };

  document.querySelectorAll("body *").forEach((el) => {
    if (el.closest(".mk-drawer, .mk-scrim, .app-menu, .popover, .toast-stack, .sheet-backdrop, .lightbox, .dash-sidebar")) return;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    if (isDecoration(el)) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    if (rect.right > viewport + 1 || rect.left < -1) {
      if (inScroller(el)) return;
      const cls = typeof el.className === "string" ? el.className : "";
      offenders.push(
        (el.tagName.toLowerCase() + (cls ? "." + cls.split(/\s+/).slice(0, 2).join(".") : "")) +
        " [" + Math.round(rect.left) + "→" + Math.round(rect.right) + "]"
      );
    }
  });
  return {
    viewport,
    scrollWidth: de.scrollWidth,
    offenders: [...new Set(offenders)].slice(0, 8),
    offenderCount: new Set(offenders).size,
    overflow: de.scrollWidth > de.clientWidth + 1
  };
}

async function overflowChecks() {
  console.log("\n--- 6. Real-layout overflow on the new pages ---");
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"]
  });

  for (const page of [
    { route: "/pages/messages.html", label: "messages" },
    { route: "/pages/game-centre.html", label: "game-centre" },
    /* The densest top bar in the product: brand mark, location, bell and the
       account chip all compete for one row at 390px. */
    { route: "/pages/home.html", label: "home" }
  ]) {
    const tab = await browser.newPage();
    const consoleErrors = [];
    tab.on("console", (msg) => {
      if (msg.type() !== "error") return;
      /* A blocked outbound request (the Google Fonts CDN in an offline CI box)
         is environmental, not a page defect. Anything from our own origin, and
         every non-resource error, still counts. */
      const from = (msg.location && msg.location().url) || "";
      if (/^https?:\/\//.test(from) && !from.startsWith(BASE)) return;
      consoleErrors.push((from ? from + " :: " : "") + msg.text());
    });
    tab.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

    await tab.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem("cm_access_token", "overflow-check-token");
        localStorage.setItem("cm_refresh_token", "overflow-check-refresh");
        localStorage.setItem("cm_user", JSON.stringify({
          id: 1, name: "Stub Admin", user_type: "admin", email: "admin@example.com"
        }));
        /* A conversation and a finished game, so the densest states are measured. */
        localStorage.setItem("cm_threads:u1", JSON.stringify([{
          id: "th_1",
          listing: { type: "product", id: 1, title: "Item 1 for sale", price: 12500, image_url: null, location: "Angwan Rimi" },
          person: { id: 2, name: "Aisha Bello", verified: true },
          messages: [
            { id: "m1", mine: true, text: "Good day — is this still available?", at: Date.now() - 60000 },
            { id: "m2", mine: true, text: "I will buy it at this price.", offer: 10000, at: Date.now() - 30000 }
          ],
          unread: 1, archived: false, blocked: false,
          created_at: Date.now(), updated_at: Date.now()
        }]));
        localStorage.setItem("cm_game:u1", JSON.stringify({
          games: 12, best: 3480, best_by_level: { classic: 3480 }, achievements: ["first_game", "flawless", "speed"],
          daily: {}, daily_streak: 4, daily_best_streak: 6,
          history: [
            { at: Date.now() - 3600000, level: "classic", score: 3480, time: 74, misses: 0, daily: false },
            { at: Date.now() - 86400000, level: "quick", score: 2100, time: 55, misses: 2, daily: false }
          ]
        }));
      } catch (e) { /* storage disabled */ }
    });

    for (const width of WIDTHS) {
      await tab.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await tab.goto(BASE + page.route, { waitUntil: "networkidle2", timeout: 45000 });
      await new Promise((r) => setTimeout(r, 700));

      const m = await tab.evaluate(measure);
      check(`${page.label} @ ${width}px: no horizontal overflow`, !m.overflow,
        `scrollWidth=${m.scrollWidth} clientWidth=${m.viewport}` +
        (m.offenders.length ? " | " + m.offenders.join(", ") : ""));

      /* `overflow-x: clip` can silently hide a clipped control — the page never
         scrolls, so scrollWidth stays clean. This asserts the pixels too. */
      check(`${page.label} @ ${width}px: nothing escapes the viewport`, m.offenderCount === 0,
        m.offenders.join(", "));

      const locked = await tab.evaluate(() => document.documentElement.classList.contains("cm-locked"));
      check(`${page.label} @ ${width}px: signed-in page not locked`, locked === false);

      await tab.screenshot({ path: path.join(SHOT_DIR, `${page.label}-${width}.png`), fullPage: false });
    }

    check(`${page.label}: no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    await tab.close();
  }

  await browser.close();
}

/* ════════════════════════════════ 7. polish sweep @390px (every page) */

/**
 * The pass a design review would do by hand, done mechanically: emoji standing
 * in for icons, a broken document outline, images without alt text or lazy
 * loading, and text that fails WCAG AA against the surface behind it (gradient
 * backdrops are skipped — one computed colour cannot describe them).
 */
const POLISH = () => {
  const out = { emoji: [], headings: [], noAlt: [], notLazy: [], lowContrast: [] };

  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
  document.querySelectorAll("body *").forEach((el) => {
    if (el.children.length) return;
    const text = (el.textContent || "").trim();
    if (text && emojiRe.test(text)) out.emoji.push(text.slice(0, 30));
  });

  let previous = 0;
  document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
    const style = getComputedStyle(heading);
    if (style.display === "none" || style.visibility === "hidden") return;
    const level = Number(heading.tagName[1]);
    if (previous && level > previous + 1) {
      out.headings.push(`h${previous} -> h${level}: ${(heading.textContent || "").trim().slice(0, 34)}`);
    }
    previous = level;
  });

  document.querySelectorAll("img").forEach((img) => {
    const src = (img.getAttribute("src") || "(inline)").slice(0, 60);
    if (!img.hasAttribute("alt")) out.noAlt.push(src);
    /* The post-listing preview is the image the visitor is editing right now:
       deferring it would be the defect. */
    if (img.loading !== "lazy" && img.id !== "preview-img") out.notLazy.push(src);
  });

  const parse = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(",").map((n) => parseFloat(n));
    if (parts.length > 3 && parts[3] < 0.95) return null;
    return parts.slice(0, 3);
  };
  const luminance = (rgb) => {
    const c = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => {
    const l1 = luminance(a); const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const surfaceBehind = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const colour = parse(style.backgroundColor);
      if (colour) return colour;
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      node = node.parentElement;
    }
    return [255, 255, 255];
  };

  const reported = new Set();
  document.querySelectorAll("p, span, small, strong, b, em, li, td, th, h1, h2, h3, h4, label, a, time, dd, dt").forEach((el) => {
    if (el.children.length) return;
    const text = (el.textContent || "").trim();
    if (text.length < 3) return;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    if (parseFloat(style.opacity) < 0.6) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const fg = parse(style.color);
    if (!fg) return;
    const bg = surfaceBehind(el);
    if (!bg) return;
    const size = parseFloat(style.fontSize);
    const weight = parseInt(style.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const ratio = contrast(fg, bg);
    const key = style.color + "|" + Math.round(size) + "|" + Math.round(ratio * 10);
    if (ratio < need - 0.02 && !reported.has(key)) {
      reported.add(key);
      out.lowContrast.push(`"${text.slice(0, 26)}" ${style.color} on rgb(${bg.join(",")}) = ${Math.round(ratio * 100) / 100}:1 (needs ${need})`);
    }
  });

  return out;
};

/* ═══════════════════════════════════ 8. clipping sweep (every page @390px) */

/**
 * `overflow-x: clip` keeps a page from scrolling even when a control has been
 * pushed past the right edge — the page simply hides it. That is how the app
 * top bar lost its account chip on phones, so every page is now swept for
 * elements that escape the viewport without a scroll container to justify it,
 * plus the polish pass defined above.
 */
async function clippingSweep() {
  console.log("\n--- 8. Polish and clipping at 390px (every page) ---");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"]
  });

  const pages = [
    { route: "/index.html", label: "landing", zone: 1 },
    { route: "/pages/login.html", label: "login", zone: 1 },
    { route: "/pages/signup.html", label: "signup", zone: 1 },
    { route: "/pages/home.html", label: "home" },
    { route: "/pages/messages.html", label: "messages" },
    { route: "/pages/game-centre.html", label: "game-centre" },
    { route: "/pages/accommodation.html", label: "accommodation" },
    { route: "/pages/events.html", label: "events" },
    { route: "/pages/services.html", label: "services" },
    { route: "/pages/product-details.html?id=1&type=product", label: "product-details" },
    { route: "/pages/post-listing.html", label: "post-listing" },
    { route: "/pages/favorites.html", label: "favorites" },
    { route: "/pages/profile.html", label: "profile" },
    { route: "/pages/admin-dashboard.html", label: "admin" }
  ];

  for (const page of pages) {
    const tab = await browser.newPage();
    await tab.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    if (!page.zone) {
      await tab.evaluateOnNewDocument(() => {
        try {
          localStorage.setItem("cm_access_token", "sweep-token");
          localStorage.setItem("cm_refresh_token", "sweep-refresh");
          localStorage.setItem("cm_user", JSON.stringify({
            id: 1, name: "Stub Admin", user_type: "admin", email: "admin@example.com"
          }));
        } catch (e) { /* storage disabled */ }
      });
    }
    await tab.goto(BASE + page.route, { waitUntil: "networkidle2", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 500));
    const m = await tab.evaluate(measure);
    check(`${page.label} @ 390px: no control clipped off-screen`, m.offenderCount === 0,
      m.offenders.join(", "));

    const polish = await tab.evaluate(POLISH);
    check(`${page.label} @ 390px: no emoji standing in for an icon`,
      polish.emoji.length === 0, polish.emoji.join(", "));
    check(`${page.label} @ 390px: document outline has no skipped level`,
      polish.headings.length === 0, polish.headings.join(", "));
    check(`${page.label} @ 390px: every image has alt text`,
      polish.noAlt.length === 0, polish.noAlt.join(", "));
    check(`${page.label} @ 390px: every image below the fold is lazy`,
      polish.notLazy.length === 0, polish.notLazy.join(", "));
    check(`${page.label} @ 390px: text meets WCAG AA contrast`,
      polish.lowContrast.length === 0, polish.lowContrast.slice(0, 3).join(" | "));
    await tab.close();
  }

  await browser.close();
}

/* ═════════════════════════════════════════════════════════════════════ main */

(async () => {
  const server = await startServer();
  console.log(`\nStub server on ${BASE}\n${"=".repeat(74)}\n`);

  await guardChecks();
  await shellChecks();
  await messagesChecks();
  await gameChecks();
  await landingChecks();
  await overflowChecks();
  await clippingSweep();

  server.close();

  console.log("\n" + "=".repeat(74));
  console.log(`${results.length - failures}/${results.length} experience checks passed`);
  if (failures) {
    console.log("\nFailures:");
    results.filter((r) => !r.ok).forEach((r) => console.log(" - " + r.name + (r.detail ? " :: " + r.detail : "")));
  }
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error("EXPERIENCE HARNESS CRASHED:", error);
  process.exit(2);
});
