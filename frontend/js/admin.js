/* ==========================================================================
   admin.js – moderation dashboard for Campus Marketplace.

   Features
   --------
   • headline statistics (users, listings, pending queue, engagement)
   • moderation queue: approve / reject / flag / feature / delete
   • all-listings table with status + type filters and search
   • user management: verify, suspend, promote, delete
   • activity feed

   Depends on: api.js, ui.js, auth.js
   ========================================================================== */

(function (window, document) {
  "use strict";

  var state = {
    pending: [],
    listings: [],
    users: [],
    usersPage: 1,
    stats: null
  };

  var TYPE_LABELS = {
    product: "Product",
    accommodation: "Accommodation",
    event: "Event",
    service: "Service"
  };

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

      var badge = document.getElementById("pending-badge");
      if (badge) {
        badge.textContent = data.listings.pending_total;
        badge.classList.toggle("hidden", data.listings.pending_total === 0);
      }
      var tabCount = document.getElementById("tab-pending-count");
      if (tabCount) tabCount.textContent = data.listings.pending_total;

      var breakdown = document.getElementById("listing-breakdown");
      if (breakdown) {
        breakdown.innerHTML = ["products", "accommodation", "events", "services"].map(function (key) {
          var row = data.listings[key];
          return (
            '<li><span class="k">' + key.charAt(0).toUpperCase() + key.slice(1) + '</span>' +
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

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = Number(value || 0).toLocaleString();
  }

  /* -----------------------------------------------------------------------
     Moderation queue
     ----------------------------------------------------------------------- */
  function loadPending() {
    var host = document.getElementById("pending-list");
    if (!host) return Promise.resolve();
    host.innerHTML = UI.skeletonGrid(3);

    return API.admin.pending().then(function (payload) {
      state.pending = payload.data.items || [];
      if (!state.pending.length) {
        host.innerHTML = UI.emptyState("✅", "Nothing to review",
          "Every listing has been moderated. New submissions will appear here automatically.", "", true);
        return;
      }

      host.innerHTML =
        '<p class="text-muted">' + state.pending.length + " listing" +
          (state.pending.length === 1 ? "" : "s") + " waiting for approval</p>" +
        state.pending.map(function (item) {
          return (
            '<article class="card card-pad" style="margin-bottom:12px" data-item-id="' + item.id +
              '" data-item-type="' + item.item_type + '">' +
              '<div class="flex-between wrap">' +
                "<div>" +
                  '<span class="badge badge-pending">' + UI.escapeHtml(item.type_label) + "</span> " +
                  '<strong style="font-size:1.05rem">' + UI.escapeHtml(item.title) + "</strong>" +
                  '<div class="text-muted">' + UI.escapeHtml(String(item.description || "").slice(0, 160)) +
                    (String(item.description || "").length > 160 ? "…" : "") + "</div>" +
                  '<div class="text-muted"><small>👤 ' +
                    UI.escapeHtml((item.seller || item.landlord || item.creator || item.provider || {}).name || "—") +
                    " · 💰 " + (item.price !== undefined ? UI.money(item.price) : "Free") +
                    " · 📍 " + UI.escapeHtml(item.location || "—") +
                    " · " + UI.timeAgo(item.created_at) + "</small></div>" +
                "</div>" +
                '<div class="row-actions">' +
                  '<button class="btn btn-success btn-sm" data-action="approve">✓ Approve</button>' +
                  '<button class="btn btn-danger btn-sm" data-action="reject">✕ Reject</button>' +
                  '<button class="btn btn-outline btn-sm" data-action="flag">🚩 Flag</button>' +
                  '<button class="btn btn-outline btn-sm" data-action="view">👁 View</button>' +
                "</div>" +
              "</div>" +
            "</article>"
          );
        }).join("");
    }).catch(function (error) {
      host.innerHTML = UI.emptyState("⚠️", "Could not load the queue", error.message);
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
      UI.modal({
        title: item.title,
        bodyHtml:
          '<p class="text-muted">' + UI.escapeHtml(item.type_label) + " · ₹".replace("₹", "₦") +
            (item.price !== undefined ? UI.money(item.price) : "Free") + "</p>" +
          "<p>" + UI.escapeHtml(item.description || "") + "</p>" +
          '<ul class="spec-list">' +
            '<li><span class="k">Location</span><span class="v">' + UI.escapeHtml(item.location || "—") + "</span></li>" +
            '<li><span class="k">Submitted</span><span class="v">' + UI.formatDate(item.created_at, true) + "</span></li>" +
          "</ul>",
        footerHtml:
          '<button class="btn btn-success" data-action="approve">✓ Approve</button>' +
          '<button class="btn btn-danger" data-action="reject">✕ Reject</button>'
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

  function runAction(button, promise, successMessage) {
    button.disabled = true;
    button.textContent = "Working…";
    promise.then(function (response) {
      UI.toast(response.message || successMessage, "success");
      return Promise.all([loadPending(), loadStats(), loadListings()]);
    }).catch(function (error) {
      UI.toast(error.message, "error");
    }).then(function () {
      button.disabled = false;
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

    body.innerHTML = '<tr><td colspan="7">Loading…</td></tr>';

    return API.admin.allListings({ status: status, type: type, q: term, per_page: 50 })
      .then(function (payload) {
        state.listings = payload.data.items || [];
        if (!state.listings.length) {
          body.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No listings match those filters.</td></tr>';
          return;
        }
        body.innerHTML = state.listings.map(function (item) {
          return (
            "<tr>" +
              "<td><strong>" + UI.escapeHtml(item.title) + "</strong><br>" +
                '<small class="text-muted">' + UI.escapeHtml(item.type_label || item.item_type) + "</small></td>" +
              "<td>" + UI.escapeHtml((item.seller || item.landlord || item.creator || item.provider || {}).name || "—") +
                "</td>" +
              "<td>" + (item.price !== undefined ? UI.money(item.price) : "Free") + "</td>" +
              "<td>" + UI.escapeHtml(item.location || "—") + "</td>" +
              "<td>" + UI.statusBadge(item.status) + "</td>" +
              "<td><small>" + UI.timeAgo(item.created_at) + "</small></td>" +
              '<td><div class="row-actions">' +
                '<button class="btn btn-success btn-sm" data-row-action="approve" data-type="' + item.item_type +
                  '" data-id="' + item.id + '">Approve</button>' +
                '<button class="btn btn-outline btn-sm" data-row-action="feature" data-type="' + item.item_type +
                  '" data-id="' + item.id + '">' + (item.featured ? "Unfeature" : "Feature") + "</button>" +
                '<button class="btn btn-outline btn-sm" data-row-action="open" data-type="' + item.item_type +
                  '" data-id="' + item.id + '">Open</button>' +
                '<button class="btn btn-danger btn-sm" data-row-action="delete" data-type="' + item.item_type +
                  '" data-id="' + item.id + '">Delete</button>' +
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
    var type = button.dataset.type;
    var id = button.dataset.id;

    if (action === "approve") {
      runAction(button, API.admin.approve(id, type), "Listing published");
    } else if (action === "feature") {
      runAction(button, API.admin.feature(type, id), "Featured setting updated");
    } else if (action === "open") {
      window.open(UI.pageUrl("product-details.html") + "?type=" + type + "&id=" + id, "_blank");
    } else if (action === "delete") {
      UI.confirm("Delete listing", "This permanently removes the listing. Continue?", "Delete")
        .then(function (ok) {
          if (!ok) return;
          runAction(button, API.admin.deleteListing(type, id), "Listing deleted");
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

    body.innerHTML = '<tr><td colspan="7">Loading…</td></tr>';

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
              '<td><div class="flex gap-1" style="align-items:center">' +
                '<span class="seller-avatar" style="width:34px;height:34px;font-size:.8rem">' +
                  UI.escapeHtml(UI.initials(user.name)) + "</span>" +
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
              '<td><div class="row-actions">' +
                '<button class="btn btn-outline btn-sm" data-user-action="verify" data-id="' + user.id + '">' +
                  (user.verified ? "Unverify" : "Verify") + "</button>" +
                '<button class="btn btn-outline btn-sm" data-user-action="suspend" data-id="' + user.id + '">' +
                  (user.is_active !== false ? "Suspend" : "Reactivate") + "</button>" +
                '<button class="btn btn-outline btn-sm" data-user-action="promote" data-id="' + user.id + '">' +
                  (user.user_type === "admin" ? "Demote" : "Make admin") + "</button>" +
                '<button class="btn btn-outline btn-sm" data-user-action="open" data-id="' + user.id + '">View</button>' +
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
    var id = button.dataset.id;
    var action = button.dataset.userAction;

    if (action === "verify") {
      runUserAction(button, API.admin.verify(id), "Verification updated");
    } else if (action === "suspend") {
      var user = state.users.filter(function (row) { return String(row.id) === String(id); })[0] || {};
      var makingActive = user.is_active === false;
      UI.confirm(makingActive ? "Reactivate account" : "Suspend account",
        makingActive ? "This user will be able to log in again."
          : "Suspended users cannot log in or post listings.",
        makingActive ? "Reactivate" : "Suspend").then(function (ok) {
        if (!ok) return;
        runUserAction(button, API.admin.suspend(id, makingActive), "Account updated");
      });
    } else if (action === "promote") {
      var target = state.users.filter(function (row) { return String(row.id) === String(id); })[0] || {};
      var promote = target.user_type !== "admin";
      UI.confirm(promote ? "Grant admin rights" : "Remove admin rights",
        promote ? "This user will be able to moderate all listings."
          : "This user will lose access to the moderation dashboard.",
        promote ? "Make admin" : "Demote").then(function (ok) {
        if (!ok) return;
        runUserAction(button, API.admin.makeAdmin(id, promote), "Role updated");
      });
    } else if (action === "open") {
      API.admin.user(id).then(function (payload) {
        var user = payload.data;
        UI.modal({
          title: user.name,
          bodyHtml:
            '<ul class="spec-list">' +
              '<li><span class="k">Email</span><span class="v">' + UI.escapeHtml(user.email) + "</span></li>" +
              '<li><span class="k">Phone</span><span class="v">' + UI.escapeHtml(user.phone || "—") + "</span></li>" +
              '<li><span class="k">Type</span><span class="v">' + UI.escapeHtml(user.user_type) + "</span></li>" +
              '<li><span class="k">Department</span><span class="v">' + UI.escapeHtml(user.department || "—") + "</span></li>" +
              '<li><span class="k">Listings</span><span class="v">' +
                Object.keys(user.listings).map(function (key) {
                  return key + ": " + user.listings[key];
                }).join(" · ") + "</span></li>" +
              '<li><span class="k">Rating</span><span class="v">' +
                (user.rating_average ? user.rating_average + "/5 (" + user.rating_count + ")" : "No reviews") +
                "</span></li>" +
              '<li><span class="k">Joined</span><span class="v">' + UI.formatDate(user.created_at) + "</span></li>" +
            "</ul>" +
            '<div class="mt-2"><a class="btn btn-outline btn-block" href="' + UI.pageUrl("profile.html") +
              "?id=" + user.id + '" target="_blank">Open public profile</a></div>'
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
    }).then(function () { button.disabled = false; });
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
            return "<li><span class=\"k\">" + (row.kind === "user" ? "👤" : "📦") + "</span>" +
              '<span class="v">' + UI.escapeHtml(row.label) +
              (row.status ? " · " + UI.statusBadge(row.status) : "") +
              ' <small class="text-muted">' + UI.timeAgo(row.created_at) + "</small></span></li>";
          }).join("") + "</ul>"
        : '<p class="text-muted">No activity yet.</p>';
    }).catch(function () { host.innerHTML = ""; });
  }

  /* -----------------------------------------------------------------------
     Tabs + initialisation
     ----------------------------------------------------------------------- */
  function initTabs() {
    var tabsHost = document.getElementById("admin-tabs");
    if (!tabsHost) return;
    tabsHost.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-tab]");
      if (!button) return;
      tabsHost.querySelectorAll("button").forEach(function (node) { node.classList.remove("active"); });
      button.classList.add("active");

      document.querySelectorAll("[data-panel]").forEach(function (panel) {
        panel.classList.toggle("hidden", panel.dataset.panel !== button.dataset.tab);
      });

      if (button.dataset.tab === "queue") loadPending();
      if (button.dataset.tab === "listings") loadListings();
      if (button.dataset.tab === "users") loadUsers();
    });
  }

  function init() {
    if ((document.body && document.body.dataset.page) !== "admin") return;
    if (!Auth.requireAdmin()) return;

    initTabs();

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
    if (listingSearch) {
      listingSearch.addEventListener("input", UI.debounce(loadListings, 400));
    }
    var listingStatus = document.getElementById("listing-status");
    var listingType = document.getElementById("listing-type");
    if (listingStatus) listingStatus.addEventListener("change", loadListings);
    if (listingType) listingType.addEventListener("change", loadListings);

    var userSearch = document.getElementById("user-search");
    if (userSearch) userSearch.addEventListener("input", UI.debounce(loadUsers, 400));
    var userType = document.getElementById("user-type");
    if (userType) userType.addEventListener("change", function () {
      state.usersPage = 1;
      loadUsers();
    });

    var refresh = document.getElementById("refresh-dashboard");
    if (refresh) {
      refresh.addEventListener("click", function () {
        loadStats(); loadPending(); loadListings(); loadActivity();
        UI.toast("Dashboard refreshed", "info");
      });
    }

    loadStats();
    loadPending();
    loadActivity();

    // Auto-refresh the queue every 60 seconds (keeps the demo lively).
    window.setInterval(function () {
      if (!document.hidden && !document.getElementById("pending-list").classList.contains("hidden")) {
        loadPending();
      }
    }, 60000);
  }

  document.addEventListener("DOMContentLoaded", init);
  window.AdminDashboard = { loadStats: loadStats, loadPending: loadPending, loadListings: loadListings,
    loadUsers: loadUsers };
})(window, document);
