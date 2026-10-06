/* ==========================================================================
   admin.js – premium moderation console for Campus Marketplace.

   What this file owns
   -------------------
   • the dashboard shell: off-canvas sidebar, collapse rail, top-bar search
     and the "Quick actions" menu
   • a single tab controller that keeps the sidebar, the segmented control
     (#admin-tabs) and the panels in sync
   • headline statistics
   • moderation queue (approve / reject / flag / feature / delete)
   • all-listings table with status + type filters and search
   • user management: verify, suspend, promote, delete
   • activity feed
   • branding & appearance settings (persisted in this browser)

   Depends on: api.js, ui.js, auth.js.  Exposed as `window.AdminDashboard`.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var BRAND_KEY = "cm_admin_branding";

  var BRAND_DEFAULTS = {
    site_name: "Campus Marketplace",
    tagline: "Buy, sell and rent around UNILAFIA",
    brand_color: "#2563eb",
    accent: "blue"
  };

  var ACCENTS = {
    blue: "#2563eb",
    violet: "#7c3aed",
    emerald: "#10b981",
    amber: "#f59e0b"
  };

  var SWATCHES = ["#2563eb", "#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#f5f5f5"];

  var TYPE_LABELS = {
    product: "Product",
    accommodation: "Accommodation",
    event: "Event",
    service: "Service"
  };

  var state = {
    booted: false,
    tab: "overview",
    pending: [],
    listings: [],
    users: [],
    usersPage: 1,
    stats: null,
    branding: null
  };

  /* -----------------------------------------------------------------------
     Icons (inline SVG – this project does not use pictograms or emoji)
     ----------------------------------------------------------------------- */
  var ICON_PATHS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    star: '<path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.4l6.1-.8z"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    badge: '<path d="M12 3l7 3v6c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-6 6"/>'
  };

  function icon(name, size) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"' +
      (size ? ' width="' + size + '" height="' + size + '"' : "") + ">" +
      (ICON_PATHS[name] || "") + "</svg>";
  }

  function iconButton(attr, action, name, title, cls) {
    return '<button type="button" class="dash-icon-btn ' + (cls || "") + '" ' + attr + '="' + action +
      '" title="' + UI.escapeHtml(title) + '" aria-label="' + UI.escapeHtml(title) + '">' +
      icon(name) + "</button>";
  }

  /* -----------------------------------------------------------------------
     Shell: sidebar, top bar, tab controller
     ----------------------------------------------------------------------- */
  var MOBILE = window.matchMedia ? window.matchMedia("(max-width: 1023px)") : null;

  function setSidebar(open) {
    var shell = document.getElementById("admin-dashboard");
    var toggle = document.getElementById("sidebar-toggle");
    var backdrop = shell && shell.querySelector("[data-dash-backdrop]");
    if (!shell) return;
    shell.classList.toggle("nav-open", !!open);
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (backdrop) backdrop.hidden = !open;
    document.body.style.overflow = open && isMobile() ? "hidden" : "";
  }

  function isMobile() {
    return MOBILE ? MOBILE.matches : window.innerWidth < 1024;
  }

  function toggleCollapsed() {
    var shell = document.getElementById("admin-dashboard");
    if (!shell) return;
    var collapsed = shell.classList.toggle("sidebar-collapsed");
    try { window.localStorage.setItem("cm_admin_sidebar", collapsed ? "collapsed" : "expanded"); }
    catch (e) { /* private mode */ }
  }

  function initShell() {
    var shell = document.getElementById("admin-dashboard");
    if (!shell) return;

    var toggle = document.getElementById("sidebar-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        setSidebar(!shell.classList.contains("nav-open"));
      });
    }

    var collapse = document.getElementById("sidebar-collapse");
    if (collapse) collapse.addEventListener("click", toggleCollapsed);

    var backdrop = shell.querySelector("[data-dash-backdrop]");
    if (backdrop) backdrop.addEventListener("click", function () { setSidebar(false); });

    shell.addEventListener("click", function (event) {
      // Follow links inside the drawer on mobile, then close it.
      if (!isMobile() || !event.target.closest("a")) return;
      if (event.target.closest(".dash-sidebar")) setSidebar(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setSidebar(false);
      if (event.key === "/" && !/input|textarea|select/i.test((event.target.tagName || ""))) {
        var search = document.getElementById("dash-search-input");
        if (search) { event.preventDefault(); search.focus(); }
      }
    });

    if (MOBILE && MOBILE.addEventListener) {
      MOBILE.addEventListener("change", function (event) {
        if (!event.matches) setSidebar(false);
      });
    }

    try {
      if (window.localStorage.getItem("cm_admin_sidebar") === "collapsed" && !isMobile()) {
        shell.classList.add("sidebar-collapsed");
      }
    } catch (e) { /* ignore */ }

    initQuickActions();
    initTabController();
    fillIdentity();
  }

  function initQuickActions() {
    var button = document.getElementById("quick-actions-toggle");
    var menu = document.getElementById("quick-actions-menu");
    if (!button || !menu) return;

    function close() {
      menu.classList.add("hidden");
      button.setAttribute("aria-expanded", "false");
    }

    button.addEventListener("click", function (event) {
      event.stopPropagation();
      var open = menu.classList.toggle("hidden");
      button.setAttribute("aria-expanded", open ? "false" : "true");
    });

    document.addEventListener("click", function (event) {
      if (!menu.classList.contains("hidden") && !event.target.closest(".dash-quick")) close();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });
  }

  /** Keep the sidebar, the segmented control and the panels in lockstep. */
  function activateTab(name) {
    if (!name) return;
    state.tab = name;

    document.querySelectorAll("#dash-sidebar .dash-nav-item").forEach(function (node) {
      node.classList.toggle("active", node.dataset.tab === name);
    });
    document.querySelectorAll("#admin-tabs button[data-tab]").forEach(function (node) {
      node.classList.toggle("active", node.dataset.tab === name);
    });
    document.querySelectorAll("[data-panel]").forEach(function (panel) {
      panel.classList.toggle("hidden", panel.dataset.panel !== name);
    });

    if (isMobile()) setSidebar(false);

    if (name === "overview") { loadStats(); loadActivity(); }
    if (name === "queue") loadPending();
    if (name === "listings") loadListings();
    if (name === "users") loadUsers();
  }

  function initTabController() {
    document.addEventListener("click", function (event) {
      var trigger = event.target.closest("[data-tab]");
      if (!trigger || !trigger.closest("#admin-dashboard")) return;
      event.preventDefault();
      var menu = document.getElementById("quick-actions-menu");
      if (menu) menu.classList.add("hidden");
      activateTab(trigger.dataset.tab);
    });
  }

  function fillIdentity() {
    var user = API.currentUser() || {};
    var name = user.name || "Administrator";
    setText("dash-user-name", name, true);
    setText("dash-user-role", String(user.user_type || "admin").replace(/_/g, " "), true);
    var avatar = document.getElementById("dash-user-avatar");
    if (avatar) avatar.textContent = UI.initials(name);
  }

  function setText(id, value, raw) {
    var node = document.getElementById(id);
    if (!node) return;
    node.textContent = raw ? value : Number(value || 0).toLocaleString();
  }

  /* -----------------------------------------------------------------------
     Dashboard statistics
     ----------------------------------------------------------------------- */
  function loadStats() {
    return API.admin.stats().then(function (payload) {
      var data = payload.data;
      state.stats = data;

      setText("stat-users", data.users.total);
      setText("stat-verified", data.users.verified);
      setText("stat-listings", data.listings.total);
      setText("stat-published", data.listings.published_total);
      setText("stat-pending", data.listings.pending_total);
      setText("stat-views", data.engagement.views);
      setText("stat-reviews", data.engagement.reviews);
      setText("stat-new-week", data.users.new_this_week);

      var pending = data.listings.pending_total;
      var badge = document.getElementById("pending-badge");
      if (badge) {
        badge.textContent = pending;
        badge.classList.toggle("hidden", pending === 0);
      }
      var navBadge = document.getElementById("nav-pending-badge");
      if (navBadge) {
        navBadge.textContent = pending;
        navBadge.classList.toggle("hidden", pending === 0);
      }
      var tabCount = document.getElementById("tab-pending-count");
      if (tabCount) tabCount.textContent = pending;

      var breakdown = document.getElementById("listing-breakdown");
      if (breakdown) {
        breakdown.innerHTML = ["products", "accommodation", "events", "services"].map(function (key) {
          var row = data.listings[key];
          return (
            '<li><span class="k">' + key.charAt(0).toUpperCase() + key.slice(1) + "</span>" +
            '<span class="v">' + row.published + " live · " + row.pending + " pending</span></li>"
          );
        }).join("");
      }
      return data;
    }).catch(function (error) {
      UI.toast(error.message, "error");
      return null;
    });
  }

  /* -----------------------------------------------------------------------
     Moderation queue
     ----------------------------------------------------------------------- */
  function queueThumb(item) {
    var url = item.image_url ? UI.imageFor(item) : null;
    if (url) {
      return '<div class="dash-queue-thumb"><img src="' + UI.escapeHtml(url) +
        '" alt="" loading="lazy"></div>';
    }
    return '<div class="dash-queue-thumb"><span class="dash-queue-fallback">' +
      UI.escapeHtml(TYPE_LABELS[item.item_type] || "Listing").toUpperCase() + "</span></div>";
  }

  function queuePrice(item) {
    if (item.item_type === "event") {
      return Number(item.ticket_price) > 0 ? UI.money(item.ticket_price) : "Free entry";
    }
    if (item.price === undefined || item.price === null || item.price === "") return "Free";
    return UI.money(item.price);
  }

  function loadPending() {
    var host = document.getElementById("pending-list");
    if (!host) return Promise.resolve();
    host.innerHTML = '<div class="dash-skeleton"></div><div class="dash-skeleton"></div>';

    return API.admin.pending().then(function (payload) {
      state.pending = payload.data.items || [];
      if (!state.pending.length) {
        host.className = "";
        host.innerHTML = UI.emptyState("Clean", "Nothing to review",
          "Every listing has been moderated. New submissions will appear here automatically.", "", true);
        return;
      }

      host.className = "dash-queue";
      host.innerHTML = state.pending.map(function (item) {
        var owner = item.seller || item.landlord || item.creator || item.provider || {};
        var description = String(item.description || "");
        return (
          '<article class="dash-queue-card" data-item-id="' + item.id +
            '" data-item-type="' + item.item_type + '">' +
            queueThumb(item) +
            '<div class="dash-queue-body">' +
              '<div class="dash-queue-top">' +
                '<span class="badge badge-pending">' + UI.escapeHtml(item.type_label || TYPE_LABELS[item.item_type] || "") + "</span>" +
                '<strong class="dash-queue-title">' + UI.escapeHtml(item.title) + "</strong>" +
              "</div>" +
              (description
                ? '<p class="dash-queue-desc">' + UI.escapeHtml(description.slice(0, 150)) +
                  (description.length > 150 ? "…" : "") + "</p>"
                : "") +
              '<div class="dash-queue-meta">' +
                "<span>Seller <strong>" + UI.escapeHtml(owner.name || "—") + "</strong></span>" +
                "<span>Price <strong>" + queuePrice(item) + "</strong></span>" +
                "<span>Location <strong>" + UI.escapeHtml(item.location || "—") + "</strong></span>" +
                "<span>Submitted <strong>" + UI.timeAgo(item.created_at) + "</strong></span>" +
              "</div>" +
              '<div class="dash-queue-actions">' +
                '<button type="button" class="dash-btn dash-btn-sm" data-action="approve">' +
                  icon("check", 15) + "Approve</button>" +
                '<button type="button" class="dash-btn dash-btn-sm" data-action="reject" ' +
                  'style="color:#fca5a5;border-color:rgba(239,68,68,.4)">' +
                  icon("x", 15) + "Reject</button>" +
                '<button type="button" class="dash-btn dash-btn-sm dash-btn-ghost" data-action="flag">' +
                  icon("flag", 15) + "Flag</button>" +
                '<button type="button" class="dash-btn dash-btn-sm dash-btn-ghost" data-action="view">' +
                  icon("eye", 15) + "View</button>" +
              "</div>" +
            "</div>" +
          "</article>"
        );
      }).join("");
    }).catch(function (error) {
      host.innerHTML = UI.emptyState("!", "Could not load the queue", error.message);
    });
  }

  function handleQueueClick(event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var card = button.closest("[data-item-id]");
    if (!card) return;

    var id = card.dataset.itemId;
    var type = card.dataset.itemType;
    var action = button.dataset.action;

    if (action === "approve") {
      runAction(button, API.admin.approve(id, type), "Approved and published");
    } else if (action === "reject") {
      askReason("Reject listing", "Why is this listing being rejected? The seller will see this reason.",
        "Reject").then(function (reason) {
        if (reason === null) return;
        runAction(button, API.admin.reject(id, type, reason), "Listing rejected");
      });
    } else if (action === "flag") {
      askReason("Flag listing", "Flagging hides the listing immediately. Provide a reason.",
        "Flag").then(function (reason) {
        if (reason === null) return;
        runAction(button, API.admin.flag(type, id, reason || "Flagged by an administrator"),
          "Listing flagged and hidden");
      });
    } else if (action === "view") {
      var item = state.pending.filter(function (row) {
        return String(row.id) === String(id) && row.item_type === type;
      })[0];
      if (!item) return;
      var image = item.image_url
        ? '<div class="detail-media mb-2"><img src="' + UI.escapeHtml(UI.imageFor(item)) + '" alt=""></div>'
        : "";
      UI.modal({
        title: item.title,
        bodyHtml:
          image +
          '<p class="text-muted">' + UI.escapeHtml(item.type_label || "") + " · " + queuePrice(item) + "</p>" +
          "<p>" + UI.escapeHtml(item.description || "") + "</p>" +
          '<ul class="spec-list">' +
            '<li><span class="k">Location</span><span class="v">' + UI.escapeHtml(item.location || "—") + "</span></li>" +
            '<li><span class="k">Submitted</span><span class="v">' + UI.formatDate(item.created_at, true) + "</span></li>" +
          "</ul>",
        footerHtml:
          '<button class="btn btn-success" data-action="approve">Approve</button>' +
          '<button class="btn btn-danger" data-action="reject">Reject</button>'
      });
    }
  }

  function askReason(title, message, confirmLabel) {
    return new Promise(function (resolve) {
      var dialog = UI.modal({
        title: title,
        bodyHtml:
          "<p>" + UI.escapeHtml(message) + "</p>" +
          '<div class="form-group"><textarea id="reason-input" rows="3" ' +
          'placeholder="e.g. The photo does not match the description"></textarea></div>',
        footerHtml:
          '<button class="btn btn-outline" data-action="cancel">Cancel</button>' +
          '<button class="btn btn-danger" data-action="ok">' + UI.escapeHtml(confirmLabel) + "</button>"
      });
      dialog.element.querySelector('[data-action="cancel"]').addEventListener("click", function () {
        dialog.close(); resolve(null);
      });
      dialog.element.querySelector('[data-action="ok"]').addEventListener("click", function () {
        var value = dialog.element.querySelector("#reason-input").value.trim();
        dialog.close();
        resolve(value);
      });
    });
  }

  var ACTION_MESSAGES = {
    approve: "Listing published",
    reject: "Listing rejected",
    flag: "Listing flagged and hidden",
    feature: "Featured setting updated",
    delete: "Listing deleted"
  };

  function runAction(button, promise, successMessage) {
    if (button) { button.disabled = true; button.classList.add("is-loading"); }
    promise.then(function (response) {
      UI.toast(response.message || successMessage, "success");
      return Promise.all([loadPending(), loadStats(), loadListings(), loadActivity()]);
    }).catch(function (error) {
      UI.toast(error.message, "error");
    }).then(function () {
      if (button && button.isConnected) button.disabled = false;
    });
  }

  /* -----------------------------------------------------------------------
     All listings table
     ----------------------------------------------------------------------- */
  function loadListings() {
    var body = document.getElementById("listings-body");
    if (!body) return Promise.resolve();

    var status = (document.getElementById("listing-status") || {}).value || "";
    var type = (document.getElementById("listing-type") || {}).value || "";
    var term = (document.getElementById("listing-search") || {}).value || "";

    body.innerHTML = '<tr><td colspan="7" class="text-muted">Loading…</td></tr>';

    return API.admin.allListings({ status: status, type: type, q: term, per_page: 50 })
      .then(function (payload) {
        state.listings = payload.data.items || [];
        if (!state.listings.length) {
          body.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No listings match those filters.</td></tr>';
          return;
        }
        body.innerHTML = state.listings.map(function (item) {
          var owner = item.seller || item.landlord || item.creator || item.provider || {};
          return (
            "<tr>" +
              "<td><strong>" + UI.escapeHtml(item.title) + "</strong><br>" +
                '<small class="text-muted">' + UI.escapeHtml(item.type_label || TYPE_LABELS[item.item_type] || item.item_type) + "</small></td>" +
              "<td>" + UI.escapeHtml(owner.name || "—") + "</td>" +
              "<td>" + (item.item_type === "event"
                ? (Number(item.ticket_price) > 0 ? UI.money(item.ticket_price) : "Free")
                : UI.money(item.price)) + "</td>" +
              "<td>" + UI.escapeHtml(item.location || "—") + "</td>" +
              "<td>" + UI.statusBadge(item.status) + "</td>" +
              "<td><small>" + UI.timeAgo(item.created_at) + "</small></td>" +
              '<td><div class="row-actions" style="justify-content:flex-end">' +
                iconButton("data-row-action", "approve", "check", "Approve", "is-success") +
                iconButton("data-row-action", "feature", "star", item.featured ? "Remove from featured" : "Feature", "is-brand") +
                iconButton("data-row-action", "open", "external", "Open listing", "") +
                iconButton("data-row-action", "delete", "trash", "Delete", "is-danger") +
              "</div></td>" +
            "</tr>"
          );
        }).join("");
      })
      .catch(function (error) {
        body.innerHTML = '<tr><td colspan="7" class="text-muted">' + UI.escapeHtml(error.message) + "</td></tr>";
      });
  }

  function handleListingsClick(event) {
    var button = event.target.closest("[data-row-action]");
    if (!button) return;
    var action = button.dataset.rowAction;
    var row = button.closest("tr");
    var index = row ? Array.prototype.indexOf.call(row.parentNode.children, row) : -1;
    var item = state.listings[index];
    if (!item) return;
    var type = item.item_type;
    var id = item.id;

    if (action === "approve") {
      runAction(button, API.admin.approve(id, type), ACTION_MESSAGES.approve);
    } else if (action === "feature") {
      runAction(button, API.admin.feature(type, id), ACTION_MESSAGES.feature);
    } else if (action === "open") {
      window.open(UI.pageUrl("product-details.html") + "?type=" + type + "&id=" + id, "_blank");
    } else if (action === "delete") {
      UI.confirm("Delete listing", "This permanently removes the listing. Continue?", "Delete")
        .then(function (ok) {
          if (!ok) return;
          runAction(button, API.admin.deleteListing(type, id), ACTION_MESSAGES.delete);
        });
    }
  }

  /* -----------------------------------------------------------------------
     Users table
     ----------------------------------------------------------------------- */
  function loadUsers() {
    var body = document.getElementById("users-body");
    if (!body) return Promise.resolve();

    var term = (document.getElementById("user-search") || {}).value || "";
    var userType = (document.getElementById("user-type") || {}).value || "";

    body.innerHTML = '<tr><td colspan="7" class="text-muted">Loading…</td></tr>';

    return API.admin.users({ q: term, user_type: userType, page: state.usersPage, per_page: 20 })
      .then(function (payload) {
        var users = payload.data.items || [];
        state.users = users;

        if (!users.length) {
          body.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No users found.</td></tr>';
          return;
        }
        body.innerHTML = users.map(function (user) {
          return (
            "<tr>" +
              '<td><div class="flex gap-1 align-center">' +
                '<span class="seller-avatar avatar-sm">' + UI.escapeHtml(UI.initials(user.name)) + "</span>" +
                "<div><strong>" + UI.escapeHtml(user.name) + "</strong><br>" +
                  '<small class="text-muted">' + UI.escapeHtml(user.email) + "</small></div></div></td>" +
              "<td>" + UI.escapeHtml(user.phone || "—") + "</td>" +
              "<td>" + UI.escapeHtml(String(user.user_type).replace(/_/g, " ")) +
                (user.user_type === "admin" ? ' <span class="badge badge-admin">admin</span>' : "") + "</td>" +
              "<td>" + (user.verified ? '<span class="badge badge-verified">Verified</span>'
                : '<span class="badge">Unverified</span>') + "</td>" +
              "<td>" + (user.is_active !== false ? '<span class="badge badge-published">Active</span>'
                : '<span class="badge badge-rejected">Suspended</span>') + "</td>" +
              "<td><small>" + UI.formatDate(user.created_at) + "</small></td>" +
              '<td><div class="row-actions" style="justify-content:flex-end">' +
                iconButton("data-user-action", "verify", "badge", user.verified ? "Remove verification" : "Verify user", "is-success") +
                iconButton("data-user-action", "suspend", "ban", user.is_active !== false ? "Suspend account" : "Reactivate account",
                  user.is_active !== false ? "is-danger" : "is-success") +
                iconButton("data-user-action", "promote", "shield", user.user_type === "admin" ? "Remove admin rights" : "Make administrator", "is-brand") +
                iconButton("data-user-action", "open", "eye", "View profile", "") +
              "</div></td>" +
            "</tr>"
          );
        }).join("");

        var paginationHost = document.getElementById("users-pagination");
        UI.renderPagination(paginationHost, payload.data.pagination, function (page) {
          state.usersPage = page;
          loadUsers();
        });
      })
      .catch(function (error) {
        body.innerHTML = '<tr><td colspan="7" class="text-muted">' + UI.escapeHtml(error.message) + "</td></tr>";
      });
  }

  function handleUsersClick(event) {
    var button = event.target.closest("[data-user-action]");
    if (!button) return;
    var row = button.closest("tr");
    var index = row ? Array.prototype.indexOf.call(row.parentNode.children, row) : -1;
    var user = state.users[index];
    if (!user) return;
    var id = user.id;

    if (button.dataset.userAction === "verify") {
      runUserAction(button, API.admin.verify(id), "Verification updated");
    } else if (button.dataset.userAction === "suspend") {
      var makingActive = user.is_active === false;
      UI.confirm(makingActive ? "Reactivate account" : "Suspend account",
        makingActive ? "This user will be able to log in again."
          : "Suspended users cannot log in or post listings.",
        makingActive ? "Reactivate" : "Suspend").then(function (ok) {
        if (!ok) return;
        runUserAction(button, API.admin.suspend(id, makingActive), "Account updated");
      });
    } else if (button.dataset.userAction === "promote") {
      var promote = user.user_type !== "admin";
      UI.confirm(promote ? "Grant admin rights" : "Remove admin rights",
        promote ? "This user will be able to moderate all listings."
          : "This user will lose access to the moderation dashboard.",
        promote ? "Make admin" : "Demote").then(function (ok) {
        if (!ok) return;
        runUserAction(button, API.admin.makeAdmin(id, promote), "Role updated");
      });
    } else if (button.dataset.userAction === "open") {
      API.admin.user(id).then(function (payload) {
        var full = payload.data;
        UI.modal({
          title: full.name,
          bodyHtml:
            '<ul class="spec-list">' +
              '<li><span class="k">Email</span><span class="v">' + UI.escapeHtml(full.email) + "</span></li>" +
              '<li><span class="k">Phone</span><span class="v">' + UI.escapeHtml(full.phone || "—") + "</span></li>" +
              '<li><span class="k">Type</span><span class="v">' + UI.escapeHtml(full.user_type) + "</span></li>" +
              '<li><span class="k">Department</span><span class="v">' + UI.escapeHtml(full.department || "—") + "</span></li>" +
              '<li><span class="k">Listings</span><span class="v">' +
                Object.keys(full.listings).map(function (key) {
                  return key + ": " + full.listings[key];
                }).join(" · ") + "</span></li>" +
              '<li><span class="k">Rating</span><span class="v">' +
                (full.rating_average ? full.rating_average + "/5 (" + full.rating_count + ")" : "No reviews") +
                "</span></li>" +
              '<li><span class="k">Joined</span><span class="v">' + UI.formatDate(full.created_at) + "</span></li>" +
            "</ul>" +
            '<div class="mt-2"><a class="btn btn-outline btn-block" href="' + UI.pageUrl("profile.html") +
              "?id=" + full.id + '" target="_blank">Open public profile</a></div>'
        });
      }).catch(function (error) { UI.toast(error.message, "error"); });
    }
  }

  function runUserAction(button, promise, message) {
    button.disabled = true;
    promise.then(function (response) {
      UI.toast(response.message || message, "success");
      return Promise.all([loadUsers(), loadStats()]);
    }).catch(function (error) {
      UI.toast(error.message, "error");
    }).then(function () { if (button.isConnected) button.disabled = false; });
  }

  /* -----------------------------------------------------------------------
     Activity feed
     ----------------------------------------------------------------------- */
  function loadActivity() {
    var host = document.getElementById("activity-list");
    if (!host) return Promise.resolve();
    return API.admin.activity().then(function (payload) {
      var items = payload.data.items || [];
      host.innerHTML = items.length
        ? '<ul class="spec-list">' + items.slice(0, 12).map(function (row) {
            return '<li><span class="k">' + (row.kind === "user" ? "New user" : TYPE_LABELS[row.kind] || "Listing") + "</span>" +
              '<span class="v">' + UI.escapeHtml(row.label) +
              (row.status ? " · " + UI.statusBadge(row.status) : "") +
              ' <small class="text-muted">' + UI.timeAgo(row.created_at) + "</small></span></li>";
          }).join("") + "</ul>"
        : '<p class="text-muted">No activity yet.</p>';
    }).catch(function () { host.innerHTML = ""; });
  }

  /* -----------------------------------------------------------------------
     Global search – routes the query to the listings or users table
     ----------------------------------------------------------------------- */
  function initSearch() {
    var input = document.getElementById("dash-search-input");
    if (!input) return;

    var run = UI.debounce(function () {
      var term = input.value.trim();
      var listingSearch = document.getElementById("listing-search");
      var userSearch = document.getElementById("user-search");
      if (listingSearch) listingSearch.value = term;
      if (userSearch) userSearch.value = term;
      if (state.tab === "users") { state.usersPage = 1; loadUsers(); }
      else { if (state.tab !== "listings") activateTab("listings"); else loadListings(); }
    }, 420);

    input.addEventListener("input", run);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); run(); }
    });
  }

  /* -----------------------------------------------------------------------
     Branding & appearance settings
     ----------------------------------------------------------------------- */
  function readBranding() {
    try {
      var raw = window.localStorage.getItem(BRAND_KEY);
      if (!raw) return Object.assign({}, BRAND_DEFAULTS);
      var parsed = JSON.parse(raw);
      return Object.assign({}, BRAND_DEFAULTS, parsed && typeof parsed === "object" ? parsed : {});
    } catch (e) {
      return Object.assign({}, BRAND_DEFAULTS);
    }
  }

  function shade(hex, amount) {
    var value = String(hex || "").replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(value)) return hex;
    var out = "#";
    for (var i = 0; i < 3; i++) {
      var channel = parseInt(value.substr(i * 2, 2), 16);
      var next = Math.max(0, Math.min(255, Math.round(channel + amount * 255)));
      out += ("0" + next.toString(16)).slice(-2);
    }
    return out;
  }

  function hexToRgba(hex, alpha) {
    var value = String(hex || "").replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(value)) return hex;
    return "rgba(" +
      parseInt(value.substr(0, 2), 16) + ", " +
      parseInt(value.substr(2, 2), 16) + ", " +
      parseInt(value.substr(4, 2), 16) + ", " + alpha + ")";
  }

  function applyBranding(settings) {
    var shell = document.getElementById("admin-dashboard");
    var color = settings.brand_color;
    if (shell) {
      shell.style.setProperty("--d-brand", color);
      shell.style.setProperty("--d-brand-hover", shade(color, -0.12));
      shell.style.setProperty("--d-brand-soft", hexToRgba(color, 0.16));
      shell.style.setProperty("--brand", color);
      shell.style.setProperty("--brand-dark", shade(color, -0.12));
      shell.style.setProperty("--brand-light", hexToRgba(color, 0.16));
    }
    var previewMark = document.getElementById("preview-mark");
    if (previewMark) {
      previewMark.style.background = color;
      previewMark.textContent = UI.initials(settings.site_name || BRAND_DEFAULTS.site_name);
    }
    setText("preview-name", settings.site_name || BRAND_DEFAULTS.site_name, true);
    setText("preview-tagline", settings.tagline || BRAND_DEFAULTS.tagline, true);
    var swatch = document.getElementById("preview-swatch");
    if (swatch) swatch.style.background = color;
    var swatchSoft = document.getElementById("preview-swatch-soft");
    if (swatchSoft) swatchSoft.style.background = hexToRgba(color, 0.25);
    var brandText = document.querySelector("#dash-sidebar .dash-brand-text strong");
    if (brandText) brandText.textContent = settings.site_name || BRAND_DEFAULTS.site_name;
  }

  function initBranding() {
    var form = document.getElementById("branding-form");
    var colorPicker = document.getElementById("brand-color");
    var colorHex = document.getElementById("brand-color-hex");
    var swatchHost = document.getElementById("brand-swatches");
    if (!form) return;

    var current = readBranding();
    var nameInput = document.getElementById("brand-site-name");
    var taglineInput = document.getElementById("brand-tagline");
    var accentSelect = document.getElementById("brand-accent");

    if (nameInput) nameInput.value = current.site_name;
    if (taglineInput) taglineInput.value = current.tagline;
    if (colorPicker) colorPicker.value = current.brand_color;
    if (colorHex) colorHex.value = current.brand_color;
    if (accentSelect) accentSelect.value = current.accent;
    applyBranding(current);

    function setColor(value) {
      if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
      current.brand_color = value;
      if (colorPicker) colorPicker.value = value;
      if (colorHex) colorHex.value = value;
      applyBranding(current);
    }

    if (colorPicker) colorPicker.addEventListener("input", function () { setColor(colorPicker.value); });
    if (colorHex) {
      colorHex.addEventListener("input", function () { setColor(colorHex.value.trim()); });
    }

    if (swatchHost) {
      swatchHost.innerHTML = SWATCHES.map(function (color) {
        return '<button type="button" class="dash-swatch" data-color="' + color +
          '" style="background:' + color + '" aria-label="Use ' + color + '"></button>';
      }).join("");
      swatchHost.addEventListener("click", function (event) {
        var swatch = event.target.closest("[data-color]");
        if (!swatch) return;
        setColor(swatch.dataset.color);
        if (accentSelect) accentSelect.value = "custom";
      });
    }

    if (accentSelect) {
      accentSelect.addEventListener("change", function () {
        var preset = ACCENTS[accentSelect.value];
        if (preset) setColor(preset);
      });
    }

    if (nameInput) nameInput.addEventListener("input", function () { applyBranding(readForm()); });
    if (taglineInput) taglineInput.addEventListener("input", function () { applyBranding(readForm()); });

    function readForm() {
      return {
        site_name: nameInput && nameInput.value.trim() ? nameInput.value.trim() : BRAND_DEFAULTS.site_name,
        tagline: taglineInput && taglineInput.value.trim() ? taglineInput.value.trim() : BRAND_DEFAULTS.tagline,
        brand_color: current.brand_color,
        accent: accentSelect ? accentSelect.value : current.accent
      };
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      state.branding = readForm();
      try { window.localStorage.setItem(BRAND_KEY, JSON.stringify(state.branding)); }
      catch (e) { /* private mode – preview still applies */ }
      applyBranding(state.branding);
      UI.toast("Branding saved for this device", "success");
    });

    var reset = document.getElementById("branding-reset");
    if (reset) {
      reset.addEventListener("click", function () {
        current = Object.assign({}, BRAND_DEFAULTS);
        try { window.localStorage.removeItem(BRAND_KEY); } catch (e) { /* ignore */ }
        if (nameInput) nameInput.value = current.site_name;
        if (taglineInput) taglineInput.value = current.tagline;
        if (accentSelect) accentSelect.value = current.accent;
        setColor(current.brand_color);
        UI.toast("Branding reset to defaults", "info");
      });
    }
  }

  /* -----------------------------------------------------------------------
     Initialisation
     ----------------------------------------------------------------------- */
  function init() {
    if ((document.body && document.body.dataset.page) !== "admin") return;
    if (state.booted) return;          // guard against the script running twice
    if (!Auth.requireAdmin()) return;
    state.booted = true;

    initShell();
    initSearch();
    initBranding();

    var queueHost = document.getElementById("pending-list");
    if (queueHost) queueHost.addEventListener("click", handleQueueClick);

    var listingsBody = document.getElementById("listings-body");
    if (listingsBody) listingsBody.addEventListener("click", handleListingsClick);

    var usersBody = document.getElementById("users-body");
    if (usersBody) usersBody.addEventListener("click", handleUsersClick);

    var listingForm = document.getElementById("listing-filters");
    if (listingForm) {
      listingForm.addEventListener("submit", function (event) {
        event.preventDefault();
        loadListings();
      });
    }
    var listingSearch = document.getElementById("listing-search");
    if (listingSearch) listingSearch.addEventListener("input", UI.debounce(loadListings, 400));
    var listingStatus = document.getElementById("listing-status");
    var listingType = document.getElementById("listing-type");
    if (listingStatus) listingStatus.addEventListener("change", loadListings);
    if (listingType) listingType.addEventListener("change", loadListings);

    var userSearch = document.getElementById("user-search");
    if (userSearch) userSearch.addEventListener("input", UI.debounce(loadUsers, 400));
    var userType = document.getElementById("user-type");
    if (userType) {
      userType.addEventListener("change", function () {
        state.usersPage = 1;
        loadUsers();
      });
    }

    var refresh = document.getElementById("refresh-dashboard");
    if (refresh) {
      refresh.addEventListener("click", function () {
        loadStats(); loadPending(); loadListings(); loadActivity();
        UI.toast("Dashboard refreshed", "info");
      });
    }

    // Prime every panel so switching tabs is instant.
    loadStats();
    loadPending();
    loadActivity();

    // Auto-refresh the queue every 60 seconds while it is on screen.
    window.setInterval(function () {
      var host = document.getElementById("pending-list");
      if (document.hidden || !host) return;
      var panel = document.querySelector('[data-panel="queue"]');
      if (panel && !panel.classList.contains("hidden")) loadPending();
    }, 60000);
  }

  document.addEventListener("DOMContentLoaded", init);
  window.AdminDashboard = {
    loadStats: loadStats,
    loadPending: loadPending,
    loadListings: loadListings,
    loadUsers: loadUsers,
    activateTab: activateTab
  };
})(window, document);
