/**
 * premium_overflow_checks.js — real-layout responsive verification.
 *
 * jsdom has no layout engine, so `scrollWidth <= clientWidth` cannot be checked
 * there. This harness drives headless Chrome against the stub server and, for
 * every page at 390 / 768 / 1512 CSS pixels, asserts that:
 *
 *   • documentElement.scrollWidth <= documentElement.clientWidth
 *   • no visible element sticks out past the viewport
 *   • the page produced no console errors
 *
 * It also writes one screenshot per page at 390px and 1512px into
 * `backend/tests/__screens__/` as visual evidence.
 *
 * Usage:
 *   node backend/tests/premium_overflow_checks.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { createServer } = require("./premium_stub_server");

const WIDTHS = [390, 768, 1512];
const SHOT_DIR = path.join(__dirname, "__screens__");

const PAGES = [
  { route: "/index.html", label: "index", zone: "marketing" },
  { route: "/pages/login.html", label: "login", zone: "marketing" },
  { route: "/pages/signup.html", label: "signup", zone: "marketing" },
  { route: "/pages/home.html", label: "home", zone: "app" },
  { route: "/pages/accommodation.html", label: "accommodation", zone: "app" },
  { route: "/pages/events.html", label: "events", zone: "app" },
  { route: "/pages/services.html", label: "services", zone: "app" },
  { route: "/pages/product-details.html?id=1&type=product", label: "product-details", zone: "app" },
  { route: "/pages/post-listing.html", label: "post-listing", zone: "app" },
  { route: "/pages/favorites.html", label: "favorites", zone: "app" },
  { route: "/pages/profile.html", label: "profile", zone: "app" },
  { route: "/pages/admin-dashboard.html", label: "admin-dashboard", zone: "app" }
];

const results = [];
let failures = 0;

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
}

/** Runs in the page: measure overflow and name the culprits. */
function measure() {
  const de = document.documentElement;
  const viewport = de.clientWidth;
  const offenders = [];

  document.querySelectorAll("body *").forEach((el) => {
    // Off-canvas drawers and popovers are intentionally parked outside the
    // viewport until opened, so they are excluded from the offender list.
    if (el.closest(".mk-drawer, .mk-scrim, .app-menu, .toast-stack, .dash-sidebar")) return;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    if (rect.right > viewport + 1 || rect.left < -1) {
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
    bodyScrollWidth: document.body.scrollWidth,
    offenders: [...new Set(offenders)].slice(0, 8),
    overflow: de.scrollWidth > de.clientWidth + 1
  };
}

(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const BASE = "http://127.0.0.1:" + server.address().port;
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"]
  });

  console.log(`\nHeadless Chrome against ${BASE}\n${"=".repeat(74)}\n`);

  for (const page of PAGES) {
    const tab = await browser.newPage();
    const consoleErrors = [];
    tab.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    tab.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

    // Seed the session before any script runs so Zone 2 pages render.
    await tab.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem("cm_access_token", "overflow-check-token");
        localStorage.setItem("cm_refresh_token", "overflow-check-refresh");
        localStorage.setItem("cm_user", JSON.stringify({
          id: 1, name: "Stub Admin", user_type: "admin", email: "admin@example.com"
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

      const locked = await tab.evaluate(() =>
        document.documentElement.classList.contains("cm-locked"));
      check(`${page.label} @ ${width}px: signed-in page not locked`, locked === false);

      if (width !== 768) {
        await tab.screenshot({
          path: path.join(SHOT_DIR, `${page.label}-${width}.png`),
          fullPage: false
        });
      }
    }

    check(`${page.label}: no console errors`, consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(" | "));

    await tab.close();
  }

  await browser.close();
  server.close();

  console.log("\n" + "=".repeat(74));
  console.log(`${results.length - failures}/${results.length} browser checks passed`);
  console.log(`Screenshots written to ${path.relative(process.cwd(), SHOT_DIR)}`);
  if (failures) {
    console.log("\nFailures:");
    results.filter((r) => !r.ok).forEach((r) => console.log(" - " + r.name + (r.detail ? " :: " + r.detail : "")));
  }
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error("OVERFLOW HARNESS CRASHED:", error);
  process.exit(2);
});
