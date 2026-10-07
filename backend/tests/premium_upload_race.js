const puppeteer = require("puppeteer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const stubMod = require("./premium_stub_server");
const s = stubMod.createServer();
let pass = 0, fail = 0;
const check = (n, ok, extra) => { (ok ? pass++ : fail++); console.log((ok ? "PASS  " : "FAIL  ") + n + (extra !== undefined ? "  ->  " + extra : "")); };
s.listen(0, "127.0.0.1", async () => {
  const BASE = "http://127.0.0.1:" + s.address().port;
  const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1512, height: 1050 });
  const errs = []; p.on("pageerror", e => errs.push(String(e).slice(0, 160)));
  await p.evaluateOnNewDocument(() => {
    localStorage.setItem("cm_access_token", "t");
    localStorage.setItem("cm_user", JSON.stringify({ id: 1, name: "Stub Admin", user_type: "admin" }));
  });

  // Fixture: stage a real PNG in the OS temp dir so the repo stays clean.
  const img = path.join(os.tmpdir(), "cm-race-fixture-" + process.pid + ".png");
  fs.writeFileSync(img, fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "assets", "logo.png")));

  await p.goto(BASE + "/pages/post-listing.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 900));
  check("post page keeps its upload zone", await p.evaluate(() => !!document.getElementById("upload-zone")));
  check("post page keeps its image input", await p.evaluate(() => !!document.querySelector('input[type=file]')));

  await p.evaluate(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); if (el) { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } };
    set("#post-title", "Race guard test listing");
    set("#product-price", "9500");
    set("#post-location", "Angwan Rimi");
    set("#post-description", "A listing created by the automated upload-race check.");
    const cat = document.querySelector("#category-select");
    if (cat && cat.options.length) { cat.selectedIndex = 1; cat.dispatchEvent(new Event("change", { bubbles: true })); }
    var cond = document.querySelector("#product-condition");
    if (cond) { cond.value = "used"; cond.dispatchEvent(new Event("change", { bubbles: true })); }
  });

  const input = await p.$('input[type=file]');
  await input.uploadFile(img);
  await new Promise(r => setTimeout(r, 120));
  const progressElem = await p.evaluate(() => {
    const bar = document.querySelector("#upload-progress, .progress, .upload-progress");
    return { present: !!bar, visibleBefore: bar ? bar.style.display !== "none" : null };
  });
  check("upload progress appeared", progressElem.present, JSON.stringify(progressElem));

  await p.evaluate(() => {
    const f = document.querySelector("#post-form");
    if (f) { f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
  });
  await new Promise(r => setTimeout(r, 2600));

  const created = stubMod.created;
  check("exactly one listing POSTed (no double submit)", created.length === 1, "posts=" + created.length);
  const body = created[0] ? created[0].body : {};
  check("POST body carried the uploaded image_url", !!body.image_url && /stub-image-\d+\.jpg$/.test(body.image_url), body.image_url);
  check("POST body kept the typed title", body.title === "Race guard test listing", body.title);
  check("only one upload round trip", stubMod.uploadLog.length === 1, "uploads=" + stubMod.uploadLog.length);

  await p.goto(BASE + "/pages/home.html", { waitUntil: "networkidle2" });
  // The feed swaps skeleton -> rendered cards a moment after load; poll for the card instead of a fixed sleep.
  let browse = { foundCard: false, imgSrc: null, cardCount: 0 };
  {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      browse = await p.evaluate(() => {
        const grid = document.getElementById("listing-grid");
        const cards = grid ? Array.from(grid.querySelectorAll(".listing-card")) : [];
        const hit = cards.find(c => /Race guard test listing/.test(c.textContent));
        const imgEl = hit ? hit.querySelector("img") : null;
        return {
          foundCard: !!hit,
          cardCount: cards.length,
          imgSrc: imgEl ? imgEl.getAttribute("src") : (hit ? "no-img" : null),
          /* require real pixels: a broken URL would fire onerror and vanish */
          imgDecoded: !!(imgEl && imgEl.complete && imgEl.naturalWidth > 0)
        };
      });
      if (browse.foundCard && browse.imgDecoded) break;
      await new Promise(r => setTimeout(r, 300));
    }
  }
  check("created listing is visible on the browse grid", browse.foundCard, "cards=" + browse.cardCount);
  check("browsed listing renders the uploaded image, not the placeholder", browse.imgDecoded && /stub-image-1\.jpg$/.test(browse.imgSrc || ""), browse.imgSrc);
  check("no page errors across the whole flow", errs.length === 0, errs.slice(0, 3).join(" | "));

  fs.unlinkSync(img);
  console.log("\n" + pass + "/" + (pass + fail) + " upload-race checks passed");
  await b.close(); s.close();
  process.exit(fail ? 1 : 0);
});
