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

  var TYPE_GLYPH = {
    product: "🛍",
    accommodation: "🏠",
    event: "📅",
    service: "🧰"
  };

  /**
   * Return an inline SVG data-URI placeholder for a listing.
   * Keeps the demo usable with zero external image dependencies.
   */
  function placeholder(type, category, label) {
    var colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.others;
    var glyph = TYPE_GLYPH[type] || "📦";
    var text = escapeHtml((label || category || "Campus Marketplace").slice(0, 26));
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="0 0 600 450">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="' + colors[0] + '"/><stop offset="100%" stop-color="' + colors[1] + '"/>' +
      "</linearGradient></defs>" +
      '<rect width="600" height="450" fill="url(#g)"/>' +
      '<circle cx="520" cy="70" r="120" fill="rgba(255,255,255,.12)"/>' +
      '<circle cx="80" cy="400" r="90" fill="rgba(255,255,255,.10)"/>' +
      '<text x="300" y="230" font-size="120" text-anchor="middle">' + glyph + "</text>" +
      '<text x="300" y="300" font-family="Segoe UI, Arial, sans-serif" font-size="24" font-weight="700" ' +
      'fill="#ffffff" text-anchor="middle">' + text + "</text>" +
      '<text x="300" y="336" font-family="Segoe UI, Arial, sans-serif" font-size="17" ' +
      'fill="rgba(255,255,255,.85)" text-anchor="middle">Campus Marketplace · UNILAFIA</text>' +
      "</svg>";
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  function imageFor(item) {
    if (item && item.image_url) {
      // Absolute URLs are used as-is; relative ones resolve against the site root.
      if (/^(https?:|data:)/.test(item.image_url)) return item.image_url;
      return ROOT + item.image_url.replace(/^\//, "");
    }
    return placeholder(item && item.type, item && item.category, item && item.title);
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
    { page: "home", label: "Home", icon: "🏠", href: "pages/home.html" },
    { page: "marketplace", label: "Browse", icon: "🛍", href: "pages/home.html#marketplace" },
    { page: "post", label: "Sell", icon: "➕", href: "pages/post-listing.html" },
    { page: "favorites", label: "Saved", icon: "❤", href: "pages/favorites.html" },
    { page: "profile", label: "Profile", icon: "👤", href: "pages/profile.html" }
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
    host.className = "bottom-nav";
    host.innerHTML = BOTTOM_LINKS.map(function (link) {
      return (
        '<a href="' + url(link.href) + '" class="' + (link.page === active ? "active" : "") + '">' +
          '<span class="icon">' + link.icon + "</span>" + link.label +
        "</a>"
      );
    }).join("");
  }

  function renderFooter() {
    var host = document.getElementById("site-footer");
    if (!host) return;
    host.className = "site-footer";
    host.innerHTML =
      '<div class="container">' +
        '<div class="footer-grid">' +
          "<div>" +
            "<h4>Campus Marketplace</h4>" +
            "<p>The official student-to-student marketplace for Federal University of Lafia – " +
            "buy and sell items, find accommodation, discover campus events and hire student services.</p>" +
          "</div>" +
          "<div><h4>Explore</h4><ul class=\"footer-list\">" +
            '<li><a href="' + url("pages/home.html") + '">Browse marketplace</a></li>' +
            '<li><a href="' + url("pages/accommodation.html") + '">Accommodation</a></li>' +
            '<li><a href="' + url("pages/events.html") + '">Campus events</a></li>' +
            '<li><a href="' + url("pages/services.html") + '">Student services</a></li>' +
          "</ul></div>" +
          "<div><h4>Account</h4><ul class=\"footer-list\">" +
            '<li><a href="' + url("pages/signup.html") + '">Create an account</a></li>' +
            '<li><a href="' + url("pages/login.html") + '">Log in</a></li>' +
            '<li><a href="' + url("pages/post-listing.html") + '">Post a listing</a></li>' +
            '<li><a href="' + url("pages/favorites.html") + '">My wishlist</a></li>' +
          "</ul></div>" +
        "</div>" +
        '<div class="footer-bottom">' +
          "© " + new Date().getFullYear() + " Campus Marketplace · Built by Martins Moses " +
          "(2023/ED/SID/OO68) · Supervisor: Mr Solomon · Powered by Flask + SQLite" +
        "</div>" +
      "</div>";
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
            ? '<img src="' + imageFor(item) + '" alt="' + escapeHtml(item.title) + '" loading="lazy">'
            : '<img src="' + imageFor(item) + '" alt="' + escapeHtml(item.title) + '" loading="lazy">') +
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
          '<div class="listing-meta"><span>📍 ' + subtitle + "</span>" +
          (item.views !== undefined ? "<span>👁 " + Number(item.views || 0) + "</span>" : "") +
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
      '<div class="empty-state"><span class="icon">' + icon + "</span><h3>" + escapeHtml(title) + "</h3>" +
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
