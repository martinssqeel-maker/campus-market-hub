/* ==========================================================================
   shell.js — Lafia Marketplace shared shell, route guard and motion layer.

   Loaded in <head> so the route guard can run *before* the browser paints the
   page body (scroll down to "ROUTE GUARD" for that part).

   It owns exactly four things:

     1. the two-zone chrome — a glass marketing navbar for Zone 1
        (index/login/signup) and the app top bar + mobile bottom nav for Zone 2
     2. the route guard that keeps guests out of app pages
     3. motion: sticky-nav blur, scroll reveals, animated counters
     4. small icon set (consistent SVGs — never emoji as UI controls)

   Depends on api.js (loaded at the end of <body>) only *inside* functions.
   Exposed globally as `Shell`.
   ========================================================================== */

(function (window, document) {
  "use strict";

  /* -----------------------------------------------------------------------
     Paths — pages may live in /pages/ while assets stay at the site root
     ----------------------------------------------------------------------- */
  var inPages = /\/pages\//.test(window.location.pathname);
  var ROOT = inPages ? "../" : "";

  function url(path) { return ROOT + path; }
  function page(p) { return ROOT + "pages/" + p; }

  function queryParam(name) {
    var match = new RegExp("[?&]" + name + "=([^&#]*)").exec(window.location.search);
    if (!match) return "";
    try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
  }

  /* -----------------------------------------------------------------------
     Brand
     ----------------------------------------------------------------------- */
  var BRAND = {
    name: "Lafia Marketplace",
    short: "Lafia Market",
    initials: "LM",
    tagline: "Built for Lafia",
    /* The campus remains a flagship audience, so it lives in the fine print
       rather than in the name itself. */
    sub: "Lafia, Nasarawa State"
  };

  /* -----------------------------------------------------------------------
     Icons — one consistent stroke set (24×24, currentColor)
     ----------------------------------------------------------------------- */
  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    tag: '<path d="M3 7.5V4a1 1 0 0 1 1-1h3.5a2 2 0 0 1 1.4.6l9.6 9.6a2 2 0 0 1 0 2.8l-3.5 3.5a2 2 0 0 1-2.8 0L3.6 8.9A2 2 0 0 1 3 7.5Z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
    bed: '<path d="M3 20V9"/><path d="M3 12h16a2 2 0 0 1 2 2v6"/><path d="M3 18h18"/><path d="M7 12V8h6l2 4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    tools: '<path d="M14.5 5.5a4 4 0 0 1 0 5.6l-6.6 6.6a2 2 0 0 1-2.8 0l-1.3-1.3a2 2 0 0 1 0-2.8l6.6-6.6a4 4 0 0 1 5.6 0Z"/><path d="M15 9h5"/><path d="M18 6v6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    heart: '<path d="M12 20s-7-4.4-7-9.4A4 4 0 0 1 12 7a4 4 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z"/>',
    user: '<path d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="9.5" cy="8" r="3.5"/><path d="M21 20v-1a4 4 0 0 0-3-3.9"/>',
    users: '<path d="M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="9.5" cy="8" r="3.5"/><path d="M21 20v-1a4 4 0 0 0-3-3.9"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8"/>',
    grid: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    sparkle: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17.5 19.6 19l1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z"/>',
    bolt: '<path d="m13 2-2 9h6l-8 11 2-9H5z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    shieldCheck: '<path d="M12 3l7 3v6c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="17" cy="14.5" r="1.2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-6 6"/>',
    quote: '<path d="M9 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2H5"/><path d="M19 7h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2h-1"/>',
    pin: '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    trend: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    phone: '<path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2.2 2A15 15 0 0 1 4 5.2 2 2 0 0 1 6 3Z"/>',
    whatsapp: '<path d="M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    store: '<path d="M4 9h16l-1 11H5z"/><path d="M3 9l1.6-4.4A1 1 0 0 1 5.5 4h13a1 1 0 0 1 .9.6L21 9"/><path d="M9 9v1a3 3 0 0 0 6 0V9"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    share: '<path d="M12 3v12"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'
  };

  function icon(name, size) {
    var body = ICONS[name] || ICONS.info;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      (size ? ' width="' + size + '" height="' + size + '"' : "") + ">" + body + "</svg>";
  }

  /* -----------------------------------------------------------------------
     Tiny helpers
     ----------------------------------------------------------------------- */
  function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); }).join("");
  }

  function zone() {
    return document.documentElement.getAttribute("data-zone") || "app";
  }

  function currentUser() {
    try { return window.API && window.API.currentUser ? window.API.currentUser() : null; }
    catch (e) { return null; }
  }

  function isLoggedIn() {
    try { return !!(window.API && window.API.isLoggedIn && window.API.isLoggedIn()); }
    catch (e) { return false; }
  }

  /* =======================================================================
     ROUTE GUARD
     Runs synchronously while <head> is parsed — before any body content is
     painted — so a guest never sees a flash of app UI.
     ======================================================================= */
  var GUARD = { status: "open", target: "", zone: zone() };

  function readToken() {
    try { return window.localStorage.getItem("cm_access_token"); } catch (e) { return null; }
  }

  function gateMarkup(target) {
    return '<div class="cm-gate" role="alert">' +
      '<div class="cm-gate__spinner" aria-hidden="true"></div>' +
      "<strong>Taking you to sign in…</strong>" +
      "<p>This part of Lafia Marketplace needs an account.</p>" +
      '<a class="btn btn-primary" href="' + esc(target) + '">Continue to sign in</a>' +
      "</div>";
  }

  function runGuard() {
    if (GUARD.zone !== "app") {
      GUARD.status = "public";
    } else if (readToken()) {
      GUARD.status = "authenticated";
    } else {
      var target = ROOT + "index.html?next=" +
        encodeURIComponent(window.location.pathname + window.location.search);

      GUARD.status = "redirect";
      GUARD.target = target;

      // `cm-locked` hides every body child except the gate, so the app UI is
      // never visible for even one frame while the redirect is in flight.
      document.documentElement.classList.add("cm-locked");

      // Mounted immediately (and re-checked once the body exists) so there is
      // always something explaining the redirect, never a blank frame.
      var mount = function () {
        if (document.querySelector(".cm-gate")) return;
        var holder = document.createElement("div");
        holder.innerHTML = gateMarkup(target);
        (document.body || document.documentElement).appendChild(holder.firstChild);
      };

      mount();
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mount);
      }
    }

    // Always publish the decision, so tests and inline scripts can observe it.
    window.__cmRouteGuard = GUARD;
    try {
      window.dispatchEvent(new CustomEvent("cm:guard", { detail: GUARD }));
    } catch (e) { /* older engines */ }

    if (GUARD.status === "redirect") {
      // The actual navigation. Kept last so the recorded state above always
      // survives even in environments where navigation is a no-op (jsdom).
      window.location.replace(GUARD.target);
    }
  }

  runGuard();

  /* =======================================================================
     ZONE 1 — marketing navbar, drawer, footer
     ======================================================================= */
  var MARKETING_LINKS = [
    { label: "Features", href: "#features" },
    { label: "Categories", href: "#categories" },
    { label: "How it works", href: "#how" },
    { label: "Explore", href: "#preview" },
    { label: "FAQ", href: "#faq" }
  ];

  function brandMarkup(compact) {
    return '<a class="mk-brand" href="' + esc(url("index.html")) + '" aria-label="' + esc(BRAND.name) + ' home">' +
      '<span class="mk-brand__mark" aria-hidden="true">' + BRAND.initials + "</span>" +
      '<span class="mk-brand__text"><strong>' + esc(BRAND.name) + "</strong>" +
      "<small>" + esc(compact ? "Lafia, Nigeria" : BRAND.tagline) + "</small></span></a>";
  }

  function renderMarketingHeader() {
    var host = document.getElementById("site-header");
    if (!host) return;

    var user = currentUser();
    // A guest bounced here by the route guard carries the page they wanted in
    // ?next=. Keep passing it along so signing in returns them to it.
    var next = queryParam("next");
    var withNext = function (path) {
      return next ? path + "?next=" + encodeURIComponent(next) : path;
    };
    var actions = user
      ? '<a class="btn btn-ghost btn-sm" href="' + esc(page("home.html")) + '">Open app</a>' +
        '<a class="btn btn-primary btn-sm" href="' + esc(page("post-listing.html")) + '">Post a listing</a>'
      : '<a class="btn btn-ghost btn-sm" href="' + esc(withNext(page("login.html"))) + '">Log in</a>' +
        '<a class="btn btn-primary btn-sm" href="' + esc(withNext(page("signup.html"))) + '">Get started</a>';

    host.className = "mk-nav";
    host.innerHTML =
      '<div class="container mk-nav__inner">' +
        brandMarkup() +
        '<nav class="mk-nav__links" aria-label="Primary">' +
          MARKETING_LINKS.map(function (link) {
            return '<a href="' + esc(link.href) + '">' + esc(link.label) + "</a>";
          }).join("") +
        "</nav>" +
        '<div class="mk-nav__actions">' + actions +
          '<button class="mk-burger" type="button" aria-label="Open menu" aria-expanded="false"' +
            ' aria-controls="mk-drawer"><span></span><span></span><span></span></button>' +
        "</div>" +
      "</div>";

    var burger = host.querySelector(".mk-burger");
    if (burger) {
      burger.addEventListener("click", function () { openDrawer(); });
    }
  }

  var drawerNodes = [];

  function closeDrawer() {
    drawerNodes.forEach(function (node) { if (node && node.remove) node.remove(); });
    drawerNodes = [];
    document.body.style.overflow = "";
  }

  function openDrawer() {
    closeDrawer();
    var user = currentUser();

    var scrim = document.createElement("div");
    scrim.className = "mk-scrim";
    scrim.addEventListener("click", closeDrawer);

    var drawer = document.createElement("aside");
    drawer.className = "mk-drawer";
    drawer.id = "mk-drawer";
    drawer.setAttribute("aria-label", "Mobile navigation");
    drawer.innerHTML =
      '<div class="mk-drawer__head">' + brandMarkup(true) +
        '<button type="button" class="modal-close" aria-label="Close menu">' + icon("close", 18) + "</button>" +
      "</div>" +
      MARKETING_LINKS.map(function (link) {
        return '<a href="' + esc(link.href) + '">' + esc(link.label) + icon("chevronRight", 16) + "</a>";
      }).join("") +
      '<a href="' + esc(page("home.html")) + '">Browse the marketplace' + icon("chevronRight", 16) + "</a>" +
      '<div class="mk-drawer__foot">' +
        (user
          ? '<a class="btn btn-outline btn-block" href="' + esc(page("profile.html")) + '">My profile</a>' +
            '<a class="btn btn-primary btn-block" href="' + esc(page("post-listing.html")) + '">Post a listing</a>'
          : '<a class="btn btn-outline btn-block" href="' + esc(page("login.html")) + '">Log in</a>' +
            '<a class="btn btn-primary btn-block" href="' + esc(page("signup.html")) + '">Create free account</a>') +
      "</div>";

    drawer.querySelector(".modal-close").addEventListener("click", closeDrawer);
    drawer.addEventListener("click", function (event) {
      if (event.target.closest("a")) closeDrawer();
    });

    document.body.appendChild(scrim);
    document.body.appendChild(drawer);
    document.body.style.overflow = "hidden";
    drawerNodes = [scrim, drawer];

    document.addEventListener("keydown", function onKey(event) {
      if (event.key === "Escape") { closeDrawer(); document.removeEventListener("keydown", onKey); }
    });
  }

  function renderMarketingFooter() {
    var host = document.getElementById("site-footer");
    if (!host) return;

    var year = new Date().getFullYear();
    var user = currentUser();

    host.className = "mk-footer";
    host.innerHTML =
      '<div class="container">' +
        '<div class="mk-footer__grid">' +
          '<div class="mk-footer__about">' + brandMarkup() +
            "<p>Buy, sell, rent and connect across Lafia — from FULAFIA hostels to Balarabe market. " +
            "Every listing is reviewed before it goes live.</p>" +
            '<div class="mk-footer__social">' +
              '<a href="mailto:hello@lafiamarketplace.ng" aria-label="Email us">' + icon("mail", 18) + "</a>" +
              '<a href="#faq" aria-label="Help and safety">' + icon("shieldCheck", 18) + "</a>" +
              '<a href="#preview" aria-label="Explore listings">' + icon("compass", 18) + "</a>" +
            "</div>" +
          "</div>" +
          "<div><h4>Marketplace</h4><ul>" +
            '<li><a href="' + esc(page("home.html")) + '">All listings</a></li>' +
            '<li><a href="' + esc(page("home.html")) + '?category=phones">Phones &amp; tablets</a></li>' +
            '<li><a href="' + esc(page("home.html")) + '?category=laptops">Laptops</a></li>' +
            '<li><a href="' + esc(page("home.html")) + '?category=accessories">Accessories</a></li>' +
          "</ul></div>" +
          "<div><h4>Explore</h4><ul>" +
            '<li><a href="' + esc(page("accommodation.html")) + '">Hostels &amp; lodges</a></li>' +
            '<li><a href="' + esc(page("services.html")) + '">Services</a></li>' +
            '<li><a href="' + esc(page("events.html")) + '">Events &amp; adverts</a></li>' +
            '<li><a href="' + esc(page("post-listing.html")) + '">Post a listing</a></li>' +
          "</ul></div>" +
          "<div><h4>Account</h4><ul>" +
            (user
              ? '<li><a href="' + esc(page("profile.html")) + '">My profile</a></li>' +
                '<li><a href="' + esc(page("favorites.html")) + '">Saved items</a></li>' +
                '<li><button type="button" data-shell-logout>Log out</button></li>'
              : '<li><a href="' + esc(page("login.html")) + '">Log in</a></li>' +
                '<li><a href="' + esc(page("signup.html")) + '">Create an account</a></li>') +
            '<li><a href="#faq">Safety guidance</a></li>' +
          "</ul></div>" +
        "</div>" +
        '<div class="mk-footer__bottom">' +
          "<span>&copy; " + year + " " + esc(BRAND.name) + " &middot; A marketplace built for Lafia</span>" +
          '<nav aria-label="Legal">' +
            '<a href="#faq">Help</a><a href="#faq">Safety</a>' +
            '<a href="#faq">Terms</a><a href="#faq">Privacy</a>' +
          "</nav>" +
        "</div>" +
      "</div>";

    wireLogout(host);
  }

  function wireLogout(scope) {
    (scope || document).querySelectorAll("[data-shell-logout], [data-action='logout']").forEach(function (node) {
      node.addEventListener("click", function (event) {
        event.preventDefault();
        if (window.Auth && window.Auth.logout) window.Auth.logout();
        else if (window.API && window.API.tokens) {
          window.API.tokens.clear();
          window.location.href = url("index.html");
        }
      });
    });
  }

  /* =======================================================================
     ZONE 2 — app top bar + mobile bottom nav
     ======================================================================= */
  var BOTTOM_LINKS = [
    { id: "home", label: "Home", icon: "home", href: page("home.html") },
    { id: "explore", label: "Explore", icon: "compass", href: page("home.html") + "#marketplace" },
    { id: "post", label: "Sell", icon: "plus", href: page("post-listing.html"), fab: true },
    { id: "favorites", label: "Saved", icon: "heart", href: page("favorites.html") },
    { id: "profile", label: "Profile", icon: "user", href: page("profile.html") }
  ];

  function renderAppHeader() {
    var host = document.getElementById("site-header");
    if (!host) return;

    var user = currentUser();
    var adminLink = user && user.user_type === "admin"
      ? '<a href="' + esc(page("admin-dashboard.html")) + '" role="menuitem">' + icon("shield", 17) + "Admin console</a>"
      : "";

    host.className = "app-topbar";
    host.innerHTML =
      '<div class="container app-topbar__inner">' +
        brandMarkup(true) +
        '<form class="app-search" id="app-search" role="search" autocomplete="off">' +
          icon("search", 17) +
          '<label class="sr-only" for="app-search-input">Search Lafia Marketplace</label>' +
          '<input id="app-search-input" type="search" placeholder="Search listings, rooms, services…">' +
          '<div id="app-search-suggestions" class="suggestions hidden" role="listbox"></div>' +
        "</form>" +
        '<span class="app-topbar__spacer"></span>' +
        '<div class="app-actions">' +
          '<a class="btn btn-primary btn-sm app-post-cta" href="' + esc(page("post-listing.html")) + '">' +
            icon("plus", 16) + "Post listing</a>" +
          (user
            ? '<div class="app-menu-wrap">' +
                '<button type="button" class="app-avatar" id="app-avatar" aria-haspopup="true" aria-expanded="false">' +
                  '<span class="app-avatar__initials">' + esc(initials(user.name)) + "</span>" +
                  '<span class="app-avatar__name">' + esc(String(user.name).split(" ")[0]) + "</span>" +
                  icon("chevronDown", 15) +
                "</button>" +
                '<div class="app-menu hidden" id="app-menu" role="menu">' +
                  '<div class="app-menu__head"><strong>' + esc(user.name) + "</strong>" +
                    "<small>" + esc(String(user.user_type || "member").replace(/_/g, " ")) + "</small></div>" +
                  '<a href="' + esc(page("profile.html")) + '" role="menuitem">' + icon("user", 17) + "My profile</a>" +
                  '<a href="' + esc(page("favorites.html")) + '" role="menuitem">' + icon("heart", 17) + "Saved items</a>" +
                  '<a href="' + esc(page("post-listing.html")) + '" role="menuitem">' + icon("plus", 17) + "Post a listing</a>" +
                  adminLink +
                  '<div class="app-menu__sep"></div>' +
                  '<button type="button" class="is-danger" data-shell-logout role="menuitem">' +
                    icon("logout", 17) + "Log out</button>" +
                "</div>" +
              "</div>"
            : '<a class="btn btn-outline btn-sm" href="' + esc(page("login.html")) + '">Log in</a>') +
        "</div>" +
      "</div>";

    wireAppSearch();
    wireAvatarMenu();
    wireLogout(host);
  }

  function wireAvatarMenu() {
    var button = document.getElementById("app-avatar");
    var menu = document.getElementById("app-menu");
    if (!button || !menu) return;

    button.addEventListener("click", function (event) {
      event.stopPropagation();
      var open = menu.classList.contains("hidden");
      menu.classList.toggle("hidden", !open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", function (event) {
      if (menu.classList.contains("hidden")) return;
      if (!event.target.closest(".app-menu-wrap")) {
        menu.classList.add("hidden");
        button.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !menu.classList.contains("hidden")) {
        menu.classList.add("hidden");
        button.setAttribute("aria-expanded", "false");
      }
    });
  }

  function wireAppSearch() {
    var form = document.getElementById("app-search");
    var input = document.getElementById("app-search-input");
    var box = document.getElementById("app-search-suggestions");
    if (!form || !input) return;

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var term = input.value.trim();
      window.location.href = page("home.html") + (term ? "?q=" + encodeURIComponent(term) : "");
    });

    if (!box || !(window.API && window.API.misc && window.API.misc.search)) return;

    var timer = null;
    function debounce(fn, wait) {
      return function () {
        var args = arguments, self = this;
        window.clearTimeout(timer);
        timer = window.setTimeout(function () { fn.apply(self, args); }, wait);
      };
    }

    var run = debounce(function () {
      var term = input.value.trim();
      if (term.length < 2) { box.classList.add("hidden"); box.innerHTML = ""; return; }
      window.API.misc.search(term, 5).then(function (payload) {
        var data = payload.data || {};
        var rows = [];
        ["products", "accommodation", "events", "services"].forEach(function (key) {
          (data[key] || []).forEach(function (item) {
            rows.push('<button type="button" data-href="' +
              esc(window.UI && window.UI.listingUrl ? window.UI.listingUrl(item) : page("home.html") + "?q=" + encodeURIComponent(term)) +
              '"><span class="sugg-title">' + esc(item.title) + "</span>" +
              '<span class="sugg-meta">' + esc(item.type || key) + " · " +
              esc(item.location || "Lafia") + "</span></button>");
          });
        });
        box.innerHTML = rows.length
          ? rows.join("")
          : '<button type="button" disabled>No matches for &ldquo;' + esc(term) + "&rdquo;</button>";
        box.classList.remove("hidden");
        box.querySelectorAll("button[data-href]").forEach(function (node) {
          node.addEventListener("click", function () { window.location.href = node.dataset.href; });
        });
      }).catch(function () { box.classList.add("hidden"); });
    }, 280);

    input.addEventListener("input", run);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") box.classList.add("hidden");
    });
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".app-search")) box.classList.add("hidden");
    });
  }

  function renderAppBottomNav() {
    var host = document.getElementById("bottom-nav");
    if (!host) return;

    var active = (document.body && document.body.dataset.page) || "";
    var map = { home: "home", marketplace: "home", product: "explore", accommodation: "explore", events: "explore", services: "explore", post: "post", favorites: "favorites", profile: "profile" };
    var activeId = map[active] || "";

    host.className = "app-bottomnav";
    host.setAttribute("aria-label", "App navigation");
    host.innerHTML = BOTTOM_LINKS.map(function (link) {
      var cls = [];
      if (link.fab) cls.push("app-nav-fab");
      if (link.id === activeId) cls.push("active");
      var inner = link.fab
        ? '<i aria-hidden="true">' + icon(link.icon, 24) + "</i>"
        : icon(link.icon, 22);
      return '<a href="' + esc(link.href) + '"' + (cls.length ? ' class="' + cls.join(" ") + '"' : "") +
        (link.id === activeId ? ' aria-current="page"' : "") + ">" + inner +
        "<span>" + esc(link.label) + "</span></a>";
    }).join("");

    document.body.classList.add("has-app-shell");
  }

  /* =======================================================================
     MOTION — sticky nav, reveals, counters
     ======================================================================= */
  function initStickyNav() {
    var nav = document.querySelector(".mk-nav");
    if (!nav) return;

    var apply = function () {
      nav.classList.toggle("is-stuck", window.scrollY > 8);
    };
    apply();
    window.addEventListener("scroll", apply, { passive: true });
  }

  function initReveals() {
    var nodes = document.querySelectorAll(".reveal");
    if (!nodes.length) return;

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      nodes.forEach(function (node) { node.classList.add("is-visible"); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    nodes.forEach(function (node) { observer.observe(node); });
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /**
   * Animate one element from 0 to `value`. Reused by the landing page stats so
   * the hero numbers come from the live API rather than hard-coded copy.
   */
  function setCounter(el, value, suffix) {
    if (!el) return;
    var target = Number(value) || 0;
    var label = suffix === undefined ? (el.dataset.countSuffix || "") : suffix;

    if (prefersReducedMotion() || !target) {
      el.textContent = target.toLocaleString() + label;
      return;
    }

    var duration = 1100;
    var started = null;
    el.dataset.counted = "done";

    function tick(now) {
      if (started === null) started = now;
      var progress = Math.min((now - started) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(target * eased).toLocaleString() + label;
      if (progress < 1) window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  }

  function animateStaticCounters() {
    document.querySelectorAll("[data-count-to]").forEach(function (el) {
      if (el.dataset.counted === "done") return;
      setCounter(el, Number(el.dataset.countTo), el.dataset.countSuffix || "");
    });
  }

  /* =======================================================================
     Shell orchestration
     ======================================================================= */
  function renderHeader() {
    if (zone() === "marketing") renderMarketingHeader();
    else renderAppHeader();
  }

  function renderFooter() {
    if (zone() === "marketing") {
      renderMarketingFooter();
      return;
    }
    // The app shell uses the bottom nav instead of a marketing footer.
    var host = document.getElementById("site-footer");
    if (host) host.innerHTML = "";
    host && (host.className = "");
  }

  /* Point canonical/og:url/og:image at the *real* origin so the tags are
     correct on a Vercel preview URL, a custom domain, or localhost — instead
     of hard-coding a domain we might not own. */
  function absolutiseMeta() {
    if (!window.location || typeof window.location.origin !== "string" || !window.location.origin) return;
    var origin = window.location.origin;
    var set = function (selector, value) {
      var node = document.querySelector(selector);
      if (node) node.setAttribute(node.tagName === "LINK" ? "href" : "content", value);
    };
    var canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute("href", origin + "/");
    set('meta[property="og:url"]', origin + "/");
    ["og:image", "twitter:image"].forEach(function (name) {
      var node = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
      if (!node) return;
      var current = node.getAttribute("content") || "";
      if (/^https?:\/\//.test(current)) return;
      try { node.setAttribute("content", new URL(current.replace(/^\.\//, ""), origin + "/").href); }
      catch (e) { /* leave the authored value in place */ }
    });
  }

  function renderShell() {
    if (GUARD.status === "redirect") return;   // never build chrome for a guest
    renderHeader();
    renderFooter();
    if (zone() === "app") renderAppBottomNav();
    wireLogout(document);
    initStickyNav();
    initReveals();
    animateStaticCounters();
    if (zone() === "marketing") absolutiseMeta();
  }

  document.addEventListener("DOMContentLoaded", renderShell);

  /* =======================================================================
     Export
     ======================================================================= */
  window.Shell = {
    BRAND: BRAND,
    ROOT: ROOT,
    url: url,
    page: page,
    icon: icon,
    esc: esc,
    initials: initials,
    zone: zone,
    guard: GUARD,
    setCounter: setCounter,
    animateStaticCounters: animateStaticCounters,
    renderHeader: renderHeader,
    renderFooter: renderFooter,
    renderBottomNav: renderAppBottomNav,
    renderShell: renderShell,
    absolutiseMeta: absolutiseMeta,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer
  };
})(window, document);
