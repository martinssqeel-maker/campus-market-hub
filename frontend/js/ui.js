/* ==========================================================================
   ui.js – shared presentation layer.

   Renders the header/footer/bottom-nav on every page (so the markup lives in
   exactly one place – DRY), plus formatting helpers, toasts, modals,
   placeholder images, listing cards and the wishlist heart behaviour.

   Exposed globally as `UI`.
   ========================================================================== */

(function (window, document) {
  "use strict";

  /* -----------------------------------------------------------------------
     Path handling – pages live in /pages/ but assets live at the root
     ----------------------------------------------------------------------- */
  var inPages = /\/pages\//.test(window.location.pathname);
  var ROOT = inPages ? "../" : "";

  function url(path) { return ROOT + path; }

  function pageUrl(page) { return url("pages/" + page); }

  /* -----------------------------------------------------------------------
     Small utilities
     ----------------------------------------------------------------------- */
  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function money(amount) {
    var number = Number(amount || 0);
    return "₦" + number.toLocaleString("en-NG", { maximumFractionDigits: 0 });
  }

  function formatDate(value, withTime) {
    if (!value) return "—";
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    var options = { day: "numeric", month: "short", year: "numeric" };
    if (withTime) { options.hour = "2-digit"; options.minute = "2-digit"; }
    return date.toLocaleDateString("en-NG", options);
  }

  function timeAgo(value) {
    if (!value) return "";
    var then = new Date(value).getTime();
    if (isNaN(then)) return "";
    var seconds = Math.floor((Date.now() - then) / 1000);
    if (seconds < 60) return "just now";
    var units = [
      ["minute", 60], ["hour", 60], ["day", 24], ["week", 7], ["month", 4.35], ["year", 12]
    ];
    var count = seconds / 60;
    var label = "minute";
    for (var i = 0; i < units.length; i++) {
      label = units[i][0];
      if (i === units.length - 1 || count < units[i + 1][1]) break;
      count = count / units[i + 1][1];
    }
    var rounded = Math.max(1, Math.floor(count));
    return rounded + " " + label + (rounded === 1 ? "" : "s") + " ago";
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); })
      .join("");
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { fn.apply(self, args); }, wait || 300);
    };
  }

  /** Build a query string from a filter object (empty values dropped). */
  function toQuery(filters) {
    var parts = [];
    Object.keys(filters || {}).forEach(function (key) {
      var value = filters[key];
      if (value === undefined || value === null || value === "" || value === "all") return;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  /* -----------------------------------------------------------------------
     Placeholder artwork – generated inline so the site works offline
     ----------------------------------------------------------------------- */
  var CATEGORY_COLORS = {
    books: ["#0f766e", "#14b8a6"],
    electronics: ["#1d4ed8", "#60a5fa"],
    phones: ["#7c3aed", "#a78bfa"],
    laptops: ["#0e7490", "#22d3ee"],
    furniture: ["#92400e", "#f59e0b"],
    "hostel-essentials": ["#be123c", "#fb7185"],
    clothing: ["#7c2d12", "#fb923c"],
    food: ["#15803d", "#4ade80"],
    sports: ["#1e3a8a", "#38bdf8"],
    laundry: ["#0369a1", "#38bdf8"],
    printing: ["#4c1d95", "#c084fc"],
    tutoring: ["#065f46", "#34d399"],
    barbing: ["#831843", "#f472b6"],
    cleaning: ["#0d9488", "#5eead4"],
    delivery: ["#a16207", "#fde047"],
    photography: ["#312e81", "#818cf8"],
    "tech-repair": ["#155e75", "#67e8f9"],
    catering: ["#b45309", "#fbbf24"],
    social: ["#be185d", "#f472b6"],
    academic: ["#1e40af", "#60a5fa"],
    career: ["#0f766e", "#2dd4bf"],
    religious: ["#6d28d9", "#c4b5fd"],
    entertainment: ["#9d174d", "#f9a8d4"],
    advert: ["#b91c1c", "#fca5a5"],
    others: ["#334155", "#94a3b8"]
  };

  var TYPE_GLYPH = { product: "ITEM", accommodation: "ROOM", event: "EVENT", service: "SERVICE" };

  function placeholder(type, category, label) {
    return "";
  }

  var ABSOLUTE_URL_RE = /^(https?:|data:|blob:|\/\/)/i;

  /** Resolve any stored image reference into a URL this page can request. */
  function resolveImage(value) {
    var text = String(value == null ? "" : value).trim();
    if (!text) return null;
    if (ABSOLUTE_URL_RE.test(text)) return text;
    // Relative references are root-relative, and pages live under /pages/.
    return ROOT + text.replace(/^\/+/, "");
  }

  function imageFor(item) {
    return item ? resolveImage(item.image_url) : null;
  }

  /**
   * The same-origin API route that streams this file, tried when the primary
   * URL fails.  Object storage is only reachable from the browser when the
   * bucket is public *and* its public domain is correct; the API can always
   * read it, so a listing never shows a hole because of bucket settings.
   */
  function imageFallbackFor(item) {
    return item ? resolveImage(item.image_fallback_url) : null;
  }

  /** <img> markup for a listing, wired for the automatic fallback below. */
  function imageTag(item, alt, eager) {
    var src = imageFor(item);
    if (!src) return "";
    var fallback = imageFallbackFor(item);
    return (
      '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt || (item && item.title) || "") + '"' +
      ' loading="' + (eager ? "eager" : "lazy") + '" decoding="async"' +
      (fallback ? ' data-fallback-src="' + escapeHtml(fallback) + '"' : "") + ">"
    );
  }

  /* -----------------------------------------------------------------------
     Broken-image recovery

     The "No photo" tile used to mean "nobody uploaded a picture".  It could
     equally mean "the picture is in Supabase/R2 and the URL we were given is
     not readable by a browser", which looked identical to the student and was
     invisible to the poster.  So a failing <img> is retried through the API
     first (once), and the tile is only shown when that fails too.

     ``error`` does not bubble, hence the capture-phase listener.
     ----------------------------------------------------------------------- */
  function brokenPhoto(img) {
    img.style.display = "none";
    if (img.dataset.photoMarked) return;
    img.dataset.photoMarked = "1";
    var note = document.createElement("span");
    var inDetail = img.closest && img.closest(".detail-media");
    note.className = inDetail ? "detail-placeholder" : "listing-placeholder";
    note.innerHTML = inDetail
      ? "<strong>Photo unavailable</strong><span>The image could not be loaded from storage.</span>"
      : "<span>Photo unavailable</span><small>Could not load from storage</small>";
    img.insertAdjacentElement("afterend", note);
  }

  /** True when `src` (or `fallback`) actually renders – used after an upload. */
  function checkImage(src, fallback) {
    return new Promise(function (resolve) {
      var candidates = [src, fallback].filter(Boolean);
      if (!candidates.length) { resolve(false); return; }
      var index = 0;
      var probe = new window.Image();
      var timer = window.setTimeout(function () { probe.onload = probe.onerror = null; resolve(false); }, 12000);
      function next() {
        if (index >= candidates.length) {
          window.clearTimeout(timer);
          resolve(false);
          return;
        }
        var url = candidates[index++];
        probe.onload = function () {
          window.clearTimeout(timer);
          // A cached/redirected error page can still fire `load`, so check that
          // real pixels arrived.
          resolve(probe.naturalWidth === undefined || probe.naturalWidth > 0);
        };
        probe.onerror = next;
        probe.src = url;
      }
      next();
    });
  }

  function handleImageError(event) {
    var img = event.target;
    if (!img || img.tagName !== "IMG" || !img.dataset) return;
    var fallback = img.dataset.fallbackSrc;
    if (fallback && !img.dataset.fallbackTried && fallback !== img.getAttribute("src")) {
      img.dataset.fallbackTried = "1";
      img.src = fallback;                 // re-fires `error` if this fails too
      return;
    }
    brokenPhoto(img);
  }

  if (!window.__campusImageFallbackInstalled) {
    window.__campusImageFallbackInstalled = true;
    document.addEventListener("error", handleImageError, true);
  }

  /* -----------------------------------------------------------------------
     Toasts
     ----------------------------------------------------------------------- */
  function toastStack() {
    var stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type, timeout) {
    if (!message) return;
    var node = document.createElement("div");
    node.className = "toast " + (type || "info");
    node.setAttribute("role", "status");
    node.textContent = message;
    toastStack().appendChild(node);
    window.setTimeout(function () {
      node.style.opacity = "0";
      node.style.transform = "translateY(-6px)";
      window.setTimeout(function () { node.remove(); }, 250);
    }, timeout || 3800);
  }

  /* -----------------------------------------------------------------------
     Modal
     ----------------------------------------------------------------------- */
  function modal(options) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h3>' + escapeHtml(options.title || "") + "</h3>" +
          '<button class="modal-close" aria-label="Close">&times;</button></div>' +
        '<div class="modal-body">' + (options.bodyHtml || "") + "</div>" +
        (options.footerHtml ? '<div class="modal-foot">' + options.footerHtml + "</div>" : "") +
      "</div>";

    function close() { backdrop.remove(); document.body.style.overflow = ""; }
    backdrop.querySelector(".modal-close").addEventListener("click", close);
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) close();
    });
    document.addEventListener("keydown", function onKey(event) {
      if (event.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    });

    document.body.appendChild(backdrop);
    document.body.style.overflow = "hidden";
    return { element: backdrop, close: close };
  }

  function confirmDialog(title, message, confirmLabel) {
    return new Promise(function (resolve) {
      var dialog = modal({
        title: title,
        bodyHtml: "<p>" + escapeHtml(message) + "</p>",
        footerHtml:
          '<button class="btn btn-outline" data-action="cancel">Cancel</button>' +
          '<button class="btn btn-danger" data-action="ok">' +
          escapeHtml(confirmLabel || "Confirm") + "</button>"
      });
      dialog.element.querySelector('[data-action="cancel"]').addEventListener("click", function () {
        dialog.close(); resolve(false);
      });
      dialog.element.querySelector('[data-action="ok"]').addEventListener("click", function () {
        dialog.close(); resolve(true);
      });
    });
  }

  /* -----------------------------------------------------------------------
     Header, bottom navigation and footer
     ----------------------------------------------------------------------- */
  var NAV_LINKS = [
    { page: "home", label: "Home", href: "pages/home.html" },
    { page: "marketplace", label: "Marketplace", href: "pages/home.html#marketplace" },
    { page: "accommodation", label: "Accommodation", href: "pages/accommodation.html" },
    { page: "events", label: "Events", href: "pages/events.html" },
    { page: "services", label: "Services", href: "pages/services.html" }
  ];

  var BOTTOM_LINKS = [
    { page: "home", label: "Home", icon: "home", href: "pages/home.html" },
    { page: "marketplace", label: "Browse", icon: "browse", href: "pages/home.html#marketplace" },
    { page: "post", label: "Sell", icon: "plus", href: "pages/post-listing.html" },
    { page: "favorites", label: "Saved", icon: "heart", href: "pages/favorites.html" },
    { page: "profile", label: "Profile", icon: "user", href: "pages/profile.html" }
  ];

  function currentPage() {
    return (document.body && document.body.dataset.page) || "";
  }

  function navLinkHtml(link, activePage) {
    var active = link.page === activePage ? " class=\"active\"" : "";
    return '<a href="' + url(link.href) + '"' + active + ">" + link.label + "</a>";
  }

  function renderHeader() {
    var host = document.getElementById("site-header");
    if (!host) return;

    var user = API.currentUser();
    var active = currentPage();
    var links = NAV_LINKS.map(function (link) {
      return navLinkHtml(link, active);
    }).join("");

    var actions;
    if (user) {
      var adminLink = user.user_type === "admin"
        ? '<a class="btn btn-outline btn-sm" href="' + pageUrl("admin-dashboard.html") + '">Admin</a>'
        : "";
      actions =
        '<a class="btn btn-primary btn-sm" href="' + pageUrl("post-listing.html") + '">Sell / Post</a>' +
        adminLink +
        '<a class="user-chip" href="' + pageUrl("profile.html") + '" title="My profile">' +
          '<span class="avatar">' + escapeHtml(initials(user.name)) + "</span>" +
          "<span>" + escapeHtml(String(user.name).split(" ")[0]) + "</span>" +
        "</a>" +
        '<button class="btn btn-ghost btn-sm" data-action="logout">Log out</button>';
    } else {
      actions =
        '<a class="btn btn-outline btn-sm" href="' + pageUrl("login.html") + '">Log in</a>' +
        '<a class="btn btn-primary btn-sm" href="' + pageUrl("signup.html") + '">Sign up</a>' +
        '<a class="btn btn-accent btn-sm" href="' + pageUrl("post-listing.html") + '">Sell</a>';
    }

    host.className = "site-header";
    host.innerHTML =
      '<div class="container header-inner">' +
        '<a class="brand" href="' + url("index.html") + '">' +
          '<img src="' + url("assets/images/logo.svg") + '" alt="Campus Marketplace logo">' +
          '<span class="brand-text"><strong>Campus Marketplace</strong>' +
          "<small>Federal University of Lafia</small></span>" +
        "</a>" +
        '<div class="header-shell">' +
          '<button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false">' +
            "<span></span><span></span><span></span></button>" +
          '<nav class="main-nav" id="main-nav">' + links +
            '<div class="nav-actions">' + actions + "</div></nav>" +
        "</div>" +
      "</div>";

    var toggle = host.querySelector(".nav-toggle");
    var nav = host.querySelector(".main-nav");
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    var logoutBtn = host.querySelector('[data-action="logout"]');
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        Auth.logout();
      });
    }
  }

  function renderBottomNav() {
    var host = document.getElementById("bottom-nav");
    if (!host) return;
    var active = currentPage();
    var user = API.currentUser();
    var links = user ? BOTTOM_LINKS : [
      { page: "marketplace", label: "Browse", icon: "browse", href: "pages/home.html#marketplace" },
      { page: "accommodation", label: "Rooms", icon: "room", href: "pages/accommodation.html" },
      { page: "events", label: "Events", icon: "calendar", href: "pages/events.html" },
      { page: "login", label: "Log in", icon: "user", href: "pages/login.html" },
      { page: "signup", label: "Sign up", icon: "plus", href: "pages/signup.html" }
    ];
    host.className = "bottom-nav";
    host.innerHTML = links.map(function (link) {
      return (
        '<a href="' + url(link.href) + '" class="' + (link.page === active ? "active" : "") + '">' +
          '<span class="icon icon-' + link.icon + '" aria-hidden="true"></span>' + link.label +
        "</a>"
      );
    }).join("");
  }

  function renderFooter() {
    var host = document.getElementById("site-footer");
    if (!host) return;
    var user = API.currentUser();
    var accountLinks = user
      ? '<li><a href="' + pageUrl("profile.html") + '">My profile</a></li>' +
        '<li><a href="' + pageUrl("favorites.html") + '">Saved items</a></li>' +
        '<li><button class="footer-action" data-action="logout">Log out</button></li>'
      : '<li><a href="' + pageUrl("login.html") + '">Log in</a></li>' +
        '<li><a href="' + pageUrl("signup.html") + '">Create an account</a></li>';
    host.className = "site-footer";
    host.innerHTML =
      '<div class="container"><div class="footer-grid">' +
        '<div><h4>Campus Marketplace</h4><p>Browse student listings, accommodation, events and services around Lafia.</p></div>' +
        '<div><h4>Explore</h4><ul class="footer-list">' +
          '<li><a href="' + url("pages/home.html") + '">Marketplace</a></li>' +
          '<li><a href="' + url("pages/accommodation.html") + '">Accommodation</a></li>' +
          '<li><a href="' + url("pages/events.html") + '">Events</a></li>' +
          '<li><a href="' + url("pages/services.html") + '">Services</a></li></ul></div>' +
        '<div><h4>Account</h4><ul class="footer-list">' + accountLinks + '</ul></div>' +
        '</div><div class="footer-bottom">© ' + new Date().getFullYear() +
        ' Campus Marketplace · A student marketplace for Lafia</div></div>';
    var logout = host.querySelector('[data-action="logout"]');
    if (logout) logout.addEventListener("click", function () { Auth.logout(); });
  }

  /* -----------------------------------------------------------------------
     Listing cards
     ----------------------------------------------------------------------- */
  function statusBadge(status) {
    if (!status) return "";
    return '<span class="badge badge-' + escapeHtml(status) + '">' + escapeHtml(status) + "</span>";
  }

  function priceLabel(item) {
    if (item.type === "service") {
      return money(item.price) + ' <small class="text-muted">' + escapeHtml(item.price_unit || "") + "</small>";
    }
    if (item.type === "event") {
      return Number(item.ticket_price) > 0
        ? money(item.ticket_price) + ' <small class="text-muted">per ticket</small>'
        : '<span class="text-success">Free entry</span>';
    }
    return money(item.price);
  }

  function listingUrl(item) {
    if (item.type === "accommodation") return pageUrl("product-details.html") + "?type=accommodation&id=" + item.id;
    if (item.type === "event") return pageUrl("events.html") + "?id=" + item.id;
    if (item.type === "service") return pageUrl("services.html") + "?id=" + item.id;
    return pageUrl("product-details.html") + "?id=" + item.id;
  }

  /**
   * Render one listing card.
   * @param {object} item   listing payload from the API
   * @param {object} opts   { showStatus, showFavorite, compact }
   */
  function listingCard(item, opts) {
    opts = opts || {};
    var saved = Wishlist.has(item.type, item.id);
    var subtitle = item.type === "event"
      ? formatDate(item.date, true) + " · " + escapeHtml(item.location || "")
      : escapeHtml(item.location || item.category || "");

    return (
      '<article class="listing-card" data-type="' + escapeHtml(item.type) + '" data-id="' + item.id + '">' +
        '<a class="listing-thumb" href="' + listingUrl(item) + '" aria-label="' + escapeHtml(item.title) + '">' +
          (item.image_url
            ? imageTag(item, item.title)
            : '<span class="listing-placeholder"><span>No photo</span><small>Image not provided</small></span>') +
          '<span class="listing-flags">' +
            (item.featured ? '<span class="badge badge-featured">Featured</span>' : "") +
            (opts.showStatus ? statusBadge(item.status) : "") +
          "</span>" +
        "</a>" +
        (opts.showFavorite === false ? "" :
          '<button class="fav-btn' + (saved ? " active" : "") + '" data-fav="' + escapeHtml(item.type) +
          '" data-fav-id="' + item.id + '" aria-label="Save to wishlist" title="Save to wishlist">' +
          (saved ? "♥" : "♡") + "</button>") +
        '<div class="listing-body">' +
          '<h3 class="listing-title"><a href="' + listingUrl(item) + '">' + escapeHtml(item.title) + "</a></h3>" +
          '<div class="listing-price">' + priceLabel(item) + "</div>" +
          '<div class="listing-meta"><span>' + subtitle + "</span>" +
          (item.views !== undefined ? "<span>" + Number(item.views || 0) + " views</span>" : "") +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function skeletonGrid(count) {
    var out = "";
    for (var i = 0; i < (count || 6); i++) {
      out += '<div class="skeleton skeleton-card"></div>';
    }
    return out;
  }

  function emptyState(icon, title, message, actionHtml) {
    return (
      '<div class="empty-state"><span class="empty-mark" aria-hidden="true">' + escapeHtml(icon || "") + "</span><h3>" + escapeHtml(title) + "</h3>" +
      "<p>" + escapeHtml(message) + "</p>" + (actionHtml || "") + "</div>"
    );
  }

  function renderPagination(container, pagination, onPage) {
    if (!container) return;
    if (!pagination || pagination.pages <= 1) { container.innerHTML = ""; return; }

    var html = '<button data-page="' + (pagination.page - 1) + '"' +
      (pagination.has_prev ? "" : " disabled") + ">‹ Prev</button>";

    var start = Math.max(1, pagination.page - 2);
    var end = Math.min(pagination.pages, start + 4);
    start = Math.max(1, end - 4);
    for (var page = start; page <= end; page++) {
      html += '<button data-page="' + page + '" class="' + (page === pagination.page ? "active" : "") +
        '">' + page + "</button>";
    }
    html += '<button data-page="' + (pagination.page + 1) + '"' +
      (pagination.has_next ? "" : " disabled") + ">Next ›</button>";
    html += '<span class="page-info">' + pagination.total + " listing" +
      (pagination.total === 1 ? "" : "s") + "</span>";

    container.innerHTML = html;
    container.querySelectorAll("button[data-page]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (button.disabled) return;
        onPage(Number(button.dataset.page));
      });
    });
  }

  function stars(rating) {
    var value = Math.round(Number(rating) || 0);
    var out = "";
    for (var i = 1; i <= 5; i++) {
      out += i <= value ? "★" : '<span class="empty">★</span>';
    }
    return '<span class="stars">' + out + "</span>";
  }

  /* -----------------------------------------------------------------------
     Wishlist (favourite) behaviour – shared by every listing grid
     ----------------------------------------------------------------------- */
  var Wishlist = {
    ids: {},
    loaded: false,
    pending: {},

    has: function (type, id) {
      return (this.ids[type] || []).indexOf(Number(id)) !== -1;
    },

    load: function () {
      var self = this;
      if (!API.isLoggedIn()) { this.ids = {}; this.loaded = true; return Promise.resolve({}); }
      return API.favorites.ids().then(function (payload) {
        self.ids = (payload.data && payload.data.ids) || {};
        self.loaded = true;
        return self.ids;
      }).catch(function () {
        self.ids = {}; self.loaded = true; return {};
      });
    },

    toggle: function (type, id, button) {
      var self = this;
      if (!API.isLoggedIn()) {
        toast("Please log in to save items to your wishlist", "info");
        window.setTimeout(function () { window.location.href = pageUrl("login.html"); }, 900);
        return Promise.resolve(false);
      }

      var key = type + ":" + id;
      if (self.pending[key]) return Promise.resolve(false);
      self.pending[key] = true;
      if (button) button.disabled = true;

      return API.favorites.toggle(type, id).then(function (payload) {
        var saved = payload.data.saved;
        var list = self.ids[type] || (self.ids[type] = []);
        if (saved) {
          if (list.indexOf(Number(id)) === -1) list.push(Number(id));
        } else {
          self.ids[type] = list.filter(function (value) { return Number(value) !== Number(id); });
        }
        document.querySelectorAll('[data-fav="' + type + '"][data-fav-id="' + id + '"]').forEach(function (btn) {
          btn.classList.toggle("active", saved);
          btn.innerHTML = saved ? "♥" : "♡";
          btn.disabled = false;
        });
        toast(payload.message || (saved ? "Saved to wishlist" : "Removed from wishlist"), "success");
        return saved;
      }).catch(function (error) {
        toast(error.message, "error");
        if (button) button.disabled = false;
        return false;
      }).then(function (result) {
        delete self.pending[key];
        return result;
      });
    },

    /** Delegated click handler for every ♡ button on the page. */
    init: function () {
      document.addEventListener("click", function (event) {
        var button = event.target.closest("[data-fav]");
        if (!button) return;
        event.preventDefault();
        Wishlist.toggle(button.dataset.fav, button.dataset.favId, button);
      });
      this.load();
    }
  };

  /* -----------------------------------------------------------------------
     Page shell – wires the shared chrome on DOMContentLoaded
     ----------------------------------------------------------------------- */
  function renderShell() {
    renderHeader();
    renderBottomNav();
    renderFooter();
    Wishlist.init();
    highlightNavAnchor();
  }

  /** Support "#marketplace" style deep links inside the nav. */
  function highlightNavAnchor() {
    if (!window.location.hash) return;
    var target = document.querySelector(window.location.hash);
    if (target) window.setTimeout(function () { target.scrollIntoView({ behavior: "smooth" }); }, 200);
  }

  /* -----------------------------------------------------------------------
     Query-string helper used by detail pages
     ----------------------------------------------------------------------- */
  function queryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  /* -----------------------------------------------------------------------
     Export
     ----------------------------------------------------------------------- */
  window.UI = {
    root: ROOT,
    url: url,
    pageUrl: pageUrl,
    escapeHtml: escapeHtml,
    money: money,
    formatDate: formatDate,
    timeAgo: timeAgo,
    initials: initials,
    debounce: debounce,
    toQuery: toQuery,
    placeholder: placeholder,
    imageFor: imageFor,
    imageFallbackFor: imageFallbackFor,
    imageTag: imageTag,
    checkImage: checkImage,
    resolveImage: resolveImage,
    toast: toast,
    modal: modal,
    confirm: confirmDialog,
    listingCard: listingCard,
    statusBadge: statusBadge,
    priceLabel: priceLabel,
    listingUrl: listingUrl,
    stars: stars,
    skeletonGrid: skeletonGrid,
    emptyState: emptyState,
    renderPagination: renderPagination,
    renderShell: renderShell,
    renderHeader: renderHeader,
    queryParam: queryParam,
    wishlist: Wishlist
  };

  document.addEventListener("DOMContentLoaded", renderShell);
})(window, document);
