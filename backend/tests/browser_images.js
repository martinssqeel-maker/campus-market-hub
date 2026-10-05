/**
 * Browser-level test for listing photos.
 *
 * The bug this file exists for: a photo uploaded during posting was stored as
 * a full object-storage URL, and when that URL could not be loaded by a browser
 * (private Supabase bucket, the signed S3 endpoint pasted as the public domain,
 * a truncated value) the listing simply showed an empty tile forever – with no
 * fallback and no signal.  The API now answers with a primary URL *and* a
 * same-origin fallback, and ui.js retries then degrades to a labelled tile.
 *
 * Usage (the API must already be running on :5000 with a seeded database):
 *     npm install jsdom
 *     node backend/tests/browser_images.js
 *
 * Set CM_BASE to test another host, e.g. CM_BASE=https://preview.example node …
 *
 * jsdom does not decode images, so the failing-<img> path is driven by
 * dispatching the `error` event the browser would have fired.
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

async function api(path, options = {}) {
  const response = await fetch(BASE + path, {
    ...options,
    headers: {
      ...(options.body && typeof options.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!payload.success) throw new Error(`${path} → ${JSON.stringify(payload)}`);
  return payload.data;
}

async function login(email, password) {
  return (await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  })).access_token;
}

/** A 1×1 PNG, posted as if the student had chosen a photo. */
function pngForm() {
  const bytes = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c48900" +
    "0000000a49444154789c6360000002000100ffff030000060005574bd0a400000000" +
    "49454e44ae426082", "hex");
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: "image/png" }), "desk-lamp.png");
  return form;
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
      window.fetch = (input, init) => {
        const url = typeof input === "string" && input.startsWith("http")
          ? input : new URL(input, window.location.href).href;
        return fetch(url, init);
      };
      window.IntersectionObserver = window.IntersectionObserver ||
        class { observe() {} unobserve() {} disconnect() {} };
      window.scrollTo = () => {};
      window.Element.prototype.scrollIntoView = () => {};
      if (opts.token) window.localStorage.setItem("cm_access_token", opts.token);
    }
  });
  await new Promise((resolve) => setTimeout(resolve, opts.wait || 2200));
  return { dom, window: dom.window, document: dom.window.document, errors };
}

(async () => {
  // ---------------------------------------------------------------- API pair
  const student = await login("aisha.bello@unilafia.edu.ng", "Student@123");
  const uploaded = await api("/api/uploads/image", { method: "POST", body: pngForm(), token: student });

  log("upload: returns a browser URL", typeof uploaded.url === "string" && uploaded.url.length > 0, uploaded.url);
  log("upload: returns a storage reference for the listing",
      typeof uploaded.reference === "string" && !/^(https?:|data:)/.test(uploaded.reference),
      uploaded.reference);
  log("upload: exposes the same-origin fallback",
      String(uploaded.proxy_url || "").startsWith("/api/uploads/view/"), uploaded.proxy_url);

  const listing = await api("/api/products", {
    method: "POST",
    token: student,
    body: JSON.stringify({
      title: "Desk lamp with USB port",
      description: "Small LED desk lamp, runs off a power bank. Hostel-friendly.",
      price: 3500,
      category: "hostel-essentials",
      condition: "used",
      image_url: uploaded.url
    })
  });
  log("posting: listing keeps the reference, not a signed URL",
      !/^(https?:|data:)/.test(String(listing.image_url)) || listing.image_url.startsWith(BASE),
      listing.image_url);

  const admin = await login("admin@unilafia.edu.ng", "Admin@1234");
  await api(`/api/admin/product/${listing.id}/approve`, { method: "POST", token: admin, body: "{}" });

  const published = await api(`/api/products/${listing.id}`);
  log("published listing: carries a primary image URL", !!published.image_url, published.image_url);
  log("published listing: carries an image fallback URL",
      String(published.image_fallback_url || "").startsWith("/api/uploads/view/"),
      published.image_fallback_url);

  // The fallback must actually deliver the bytes – that is the whole point.
  const absolute = (value) => {
    if (/^(https?:)?\/\//.test(value)) return value;
    return BASE + (value.startsWith("/") ? value : "/" + value);
  };
  for (const url of [published.image_url, published.image_fallback_url]) {
    const response = await fetch(absolute(url));
    log(`image fetch: ${url.slice(0, 46)}… answers ${response.status}`,
        response.status === 200 && (response.headers.get("content-type") || "").startsWith("image/"),
        response.headers.get("content-type"));
  }

  // ---------------------------------------------------------------- the grid
  const page = await loadPage("/pages/home.html");
  const doc = page.document;
  const card = [...doc.querySelectorAll(".listing-card")]
    .find((node) => /Desk lamp with USB port/.test(node.textContent));

  log("home: the new listing rendered", !!card);
  const image = card && card.querySelector(".listing-thumb img");
  log("home: photo rendered as an <img> (not the 'No photo' tile)", !!image,
      image && image.getAttribute("src"));
  log("home: <img> knows the fallback URL",
      !!image && String(image.dataset.fallbackSrc || "").includes("/api/uploads/view/"),
      image && image.dataset.fallbackSrc);
  log("home: no JS errors", page.errors.length === 0, page.errors.join(" | "));

  // ------------------------------------------------- broken URL → 1 retry
  if (image) {
    image.src = "http://127.0.0.1:1/definitely-broken.png";
    image.dispatchEvent(new page.window.Event("error"));
    await new Promise((r) => setTimeout(r, 40));
    const retried = card.querySelector(".listing-thumb img");
    log("fallback: a failed photo is retried through the API once",
        !!retried && retried.dataset.fallbackTried === "1" &&
        /\/api\/uploads\/view\//.test(retried.getAttribute("src")),
        retried && retried.getAttribute("src"));

    // ------------------------------------------------ second failure → tile
    retried.dispatchEvent(new page.window.Event("error"));
    await new Promise((r) => setTimeout(r, 40));
    const note = card.querySelector(".listing-placeholder");
    log("fallback: a still-broken photo shows a labelled tile, not a hole",
        !!note && /unavailable/i.test(note.textContent), note && note.textContent.trim());
    log("fallback: the broken <img> is hidden", !!retried && retried.style.display === "none");
  }

  // ------------------------------------------------------ detail page image
  const detail = await loadPage(`/pages/product-details.html?id=${listing.id}`, { wait: 2600 });
  const hero = detail.document.querySelector(".detail-media img");
  log("detail: hero image rendered", !!hero, hero && hero.getAttribute("src"));
  log("detail: hero image has the fallback", !!hero && !!hero.dataset.fallbackSrc);
  if (hero) {
    hero.dispatchEvent(new detail.window.Event("error"));
    await new Promise((r) => setTimeout(r, 40));
    const tile = detail.document.querySelector(".detail-media .detail-placeholder");
    log("detail: unplayable photo degrades to the placeholder block",
        !!tile || !!detail.document.querySelector('.detail-media img[data-fallback-tried="1"]'),
        tile && tile.textContent.trim());
  }
  log("detail: no JS errors", detail.errors.length === 0, detail.errors.join(" | "));

  console.log(`\n${results.length - failures}/${results.length} image checks passed`);
  if (failures) {
    console.log("\nFailures:");
    results.filter((r) => !r.ok).forEach((r) => console.log(" - " + r.name + " :: " + r.detail));
  }
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error("IMAGE TEST CRASHED:", error);
  process.exit(2);
});
