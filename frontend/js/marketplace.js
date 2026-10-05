/* ==========================================================================
   marketplace.js – every public page of Campus Marketplace.

   The page is chosen by <body data-page="…"> and a dispatcher at the bottom
   runs only the initialiser that is relevant:

     landing       index.html            hero stats, featured, events, search
     home          pages/home.html       full browse experience (all listings)
     product       pages/product-details.html
     accommodation pages/accommodation.html
     events        pages/events.html
     services      pages/services.html
     post          pages/post-listing.html
     profile       pages/profile.html
     favorites     pages/favorites.html

   Depends on: api.js, ui.js, auth.js
   ========================================================================== */

(function (window, document) {
  "use strict";

  /* =======================================================================
     Shared pieces
     ======================================================================= */

  /**
   * Generic, reusable listing grid: fetch View skeleton View cards View pagination.
   * Every browse page uses this so behaviour stays identical everywhere.
   */
  function ListingFeed(options) {
    var state = {
      page: 1,
      perPage: options.perPage || 12,
      filters: Object.assign({}, options.filters || {}),
      loading: false
    };

    var grid = document.getElementById(options.gridId);
    var paginationHost = document.getElementById(options.paginationId);
    var countHost = options.countId ? document.getElementById(options.countId) : null;

    function load() {
      if (!grid) return Promise.resolve();
      state.loading = true;
      grid.innerHTML = UI.skeletonGrid(6);

      var query = Object.assign({ page: state.page, per_page: state.perPage }, state.filters);
      return options.fetcher(query).then(function (payload) {
        var data = payload.data || {};
        var items = data.items || [];
        state.loading = false;

        if (!items.length) {
          grid.innerHTML = UI.emptyState(
            options.emptyIcon || "🔍",
            options.emptyTitle || "Nothing here yet",
            options.emptyMessage || "Try changing your filters or check back later.",
            options.emptyAction || ""
          );
          if (paginationHost) paginationHost.innerHTML = "";
          if (countHost) countHost.textContent = "0 listings";
          return items;
        }

        grid.innerHTML = items.map(function (item) {
          return UI.listingCard(item, options.cardOptions || {});
        }).join("");

        if (countHost && data.pagination) {
          countHost.textContent = data.pagination.total + " listing" +
            (data.pagination.total === 1 ? "" : "s");
        }
        UI.renderPagination(paginationHost, data.pagination, function (page) {
          state.page = page;
          load();
          if (grid.getBoundingClientRect().top < 0) {
            grid.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
        return items;
      }).catch(function (error) {
        state.loading = false;
        grid.innerHTML = UI.emptyState("⚠️", "Could not load listings", error.message);
        return [];
      });
    }

    return {
      load: load,
      state: state,
      reload: function (filters) {
        if (filters) state.filters = Object.assign({}, filters);
        state.page = 1;
        return load();
      },
      setFilter: function (key, value) {
        state.filters[key] = value;
        state.page = 1;
        return load();
      }
    };
  }

  /** Wire a row of filter chips to a callback. */
  function initChips(containerId, onSelect) {
    var host = document.getElementById(containerId);
    if (!host) return;
    host.addEventListener("click", function (event) {
      var chip = event.target.closest(".chip");
      if (!chip) return;
      host.querySelectorAll(".chip").forEach(function (node) { node.classList.remove("active"); });
      chip.classList.add("active");
      onSelect(chip.dataset.value);
    });
  }

  /* -----------------------------------------------------------------------
     Navbar search with live autocomplete
     ----------------------------------------------------------------------- */
  function initGlobalSearch(inputId, suggestionsId) {
    var input = document.getElementById(inputId);
    var box = document.getElementById(suggestionsId);
    if (!input || !box) return;

    var lastResults = null;

    var run = UI.debounce(function () {
      var term = input.value.trim();
      if (term.length < 2) { box.classList.add("hidden"); box.innerHTML = ""; return; }

      API.misc.search(term, 6).then(function (payload) {
        var data = payload.data || {};
        lastResults = data;
        var rows = [];
        ["products", "accommodation", "events", "services"].forEach(function (key) {
          (data[key] || []).forEach(function (item) {
            rows.push(
              '<button type="button" data-href="' + UI.listingUrl(item) + '">' +
                '<span class="sugg-title">' + UI.escapeHtml(item.title) + "</span>" +
                '<span class="sugg-meta">' + UI.escapeHtml(item.type) + " · " +
                (item.type === "event" ? UI.formatDate(item.date)
                  : UI.money(item.price !== undefined ? item.price : item.ticket_price)) +
                " · " + UI.escapeHtml(item.location || "") + "</span>" +
              "</button>"
            );
          });
        });

        if (!rows.length) {
          box.innerHTML = '<button type="button" disabled>No matches for “' + UI.escapeHtml(term) + "”</button>";
        } else {
          box.innerHTML = rows.join("");
        }
        box.classList.remove("hidden");
        box.querySelectorAll("button[data-href]").forEach(function (button) {
          button.addEventListener("click", function () {
            window.location.href = button.dataset.href;
          });
        });
      }).catch(function () { box.classList.add("hidden"); });
    }, 300);

    input.addEventListener("input", run);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        window.location.href = UI.pageUrl("home.html") + "?q=" + encodeURIComponent(input.value.trim());
      }
      if (event.key === "Escape") box.classList.add("hidden");
    });
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".search-wrap")) box.classList.add("hidden");
    });
  }

  /* -----------------------------------------------------------------------
     Event / service detail modal (lightweight, reuses the API payload)
     ----------------------------------------------------------------------- */
  function openEventModal(id) {
    API.events.get(id).then(function (payload) {
      var item = payload.data;
      var body =
        '<p class="text-muted">' + UI.formatDate(item.date, true) + " · " +
          UI.escapeHtml(item.location) + " · " + UI.escapeHtml(item.category) + "</p>" +
        "<p>" + UI.escapeHtml(item.description) + "</p>" +
        '<ul class="spec-list">' +
          '<li><span class="k">Ticket</span><span class="v">' +
            (Number(item.ticket_price) > 0 ? UI.money(item.ticket_price) : "Free") + "</span></li>" +
          '<li><span class="k">Organiser</span><span class="v">' +
            UI.escapeHtml(item.creator ? item.creator.name : "—") + "</span></li>" +
        "</ul>";
      var footer = "";
      if (item.creator && item.creator.phone && API.isLoggedIn()) {
        footer =
          '<a class="btn btn-outline" href="tel:' + UI.escapeHtml(item.creator.phone) + '">📞 Call organiser</a>' +
          '<a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/234' +
            UI.escapeHtml(String(item.creator.phone).replace(/^0/, "")) +
            "?text=" + encodeURIComponent("Hello, I saw your event on Campus Marketplace: " + item.title) +
          '">Contact WhatsApp</a>';
      } else if (!API.isLoggedIn()) {
        footer = '<a class="btn btn-primary" href="' + UI.pageUrl("login.html") + '">Log in for contact details</a>';
      }
      UI.modal({ title: item.title, bodyHtml: body, footerHtml: footer });
    }).catch(function (error) { UI.toast(error.message, "error"); });
  }

  function openServiceModal(id) {
    API.services.get(id).then(function (payload) {
      var item = payload.data;
      var provider = item.provider || {};
      var body =
        '<p class="text-muted">' + UI.escapeHtml(item.category) + " · " + UI.escapeHtml(item.location) + "</p>" +
        "<p>" + UI.escapeHtml(item.description) + "</p>" +
        '<ul class="spec-list">' +
          '<li><span class="k">Price</span><span class="v">' + UI.money(item.price) + " " +
            UI.escapeHtml(item.price_unit || "") + "</span></li>" +
          '<li><span class="k">Provider</span><span class="v">' + UI.escapeHtml(provider.name || "—") +
            (provider.verified ? " ✔" : "") + "</span></li>" +
          '<li><span class="k">Rating</span><span class="v">' +
            (provider.rating_average ? UI.stars(provider.rating_average) + " (" + provider.rating_count + ")"
              : "No reviews yet") + "</span></li>" +
        "</ul>";
      var footer = "";
      if (provider.phone && API.isLoggedIn()) {
        footer =
          '<a class="btn btn-outline" href="tel:' + UI.escapeHtml(provider.phone) + '">📞 Call</a>' +
          '<a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/234' +
            UI.escapeHtml(String(provider.phone).replace(/^0/, "")) +
            "?text=" + encodeURIComponent("Hello, I need your service from Campus Marketplace: " + item.title) +
          '">Contact WhatsApp</a>';
      } else if (!API.isLoggedIn()) {
        footer = '<a class="btn btn-primary" href="' + UI.pageUrl("login.html") + '">Log in for contact details</a>';
      }
      UI.modal({ title: item.title, bodyHtml: body, footerHtml: footer });
    }).catch(function (error) { UI.toast(error.message, "error"); });
  }

  /* -----------------------------------------------------------------------
     Profile summary card used by the details pages
     ----------------------------------------------------------------------- */
  function sellerBlock(person, opts) {
    if (!person) return "";
    opts = opts || {};
    var rating = person.rating_average
      ? UI.stars(person.rating_average) + ' <small class="text-muted">(' + person.rating_count + ")</small>"
      : '<small class="text-muted">No ratings yet</small>';

    var contact = "";
    if (opts.phone) {
      var phone = String(opts.phone);
      contact =
        '<div class="contact-actions">' +
          '<a class="btn btn-outline" href="tel:' + UI.escapeHtml(phone) + '">📞 Call ' + UI.escapeHtml(phone) + "</a>" +
          '<a class="btn btn-success" target="_blank" rel="noopener" href="https://wa.me/234' +
            UI.escapeHtml(phone.replace(/^0/, "")) +
            "?text=" + encodeURIComponent(opts.waText || "Hello, I am interested in your listing on Campus Marketplace") +
          '">Contact WhatsApp</a>' +
        "</div>";
    } else {
      contact = '<div class="contact-actions">' +
        '<a class="btn btn-primary" href="' + UI.pageUrl("login.html") + '?next=' +
        encodeURIComponent(window.location.pathname + window.location.search) +
        '">Log in to see contact details</a></div>';
    }

    return (
      '<div class="card card-pad">' +
        '<div class="seller-box">' +
          '<span class="seller-avatar">' + UI.escapeHtml(UI.initials(person.name)) + "</span>" +
          "<div>" +
            "<strong>" + UI.escapeHtml(person.name) + "</strong>" +
            (person.verified ? ' <span class="badge badge-verified">Verified</span>' : "") +
            "<div>" + rating + "</div>" +
          "</div>" +
        "</div>" +
        contact +
        '<div class="mt-2"><a class="btn btn-outline btn-block" href="' +
          UI.pageUrl("profile.html") + "?id=" + person.id + '">View profile & listings</a></div>' +
      "</div>"
    );
  }

  /* =======================================================================
     LANDING PAGE (index.html)
     ======================================================================= */
  function initLanding() {
    initGlobalSearch("hero-search", "hero-suggestions");

    // Live counters
    API.misc.stats().then(function (payload) {
      var data = payload.data;
      var map = {
        "stat-products": data.products,
        "stat-accommodation": data.accommodation,
        "stat-events": data.events,
        "stat-services": data.services,
        "stat-users": data.users
      };
      Object.keys(map).forEach(function (id) {
        var node = document.getElementById(id);
        if (node) node.textContent = Number(map[id]).toLocaleString();
      });
    }).catch(function () { /* the hero simply keeps its dashes */ });

    // Featured / latest products
    var featuredGrid = document.getElementById("featured-grid");
    if (featuredGrid) {
      API.products.list({ per_page: 8, sort: "-created_at", featured: true })
        .then(function (payload) {
          var items = payload.data.items;
          if (!items.length) {
            // Fall back to the newest listings when nothing is featured yet.
            return API.products.list({ per_page: 8 }).then(function (fallback) {
              return fallback.data.items;
            });
          }
          return items;
        })
        .then(function (items) {
          featuredGrid.innerHTML = items.length
            ? items.map(function (item) { return UI.listingCard(item); }).join("")
            : UI.emptyState("Products", "No listings yet", "Be the first to post an item on Campus Marketplace.",
                '<a class="btn btn-primary mt-2" href="' + UI.pageUrl("post-listing.html") + '">Post a listing</a>');
        })
        .catch(function (error) {
          featuredGrid.innerHTML = UI.emptyState("⚠️", "Could not load listings", error.message);
        });
    }

    // Latest accommodation
    var roomsGrid = document.getElementById("rooms-grid");
    if (roomsGrid) {
      API.accommodation.list({ per_page: 3 })
        .then(function (payload) {
          var items = payload.data.items;
          roomsGrid.innerHTML = items.length
            ? items.map(function (item) { return UI.listingCard(item); }).join("")
            : UI.emptyState("Rooms", "No rooms listed yet", "Accommodation listings will appear here.");
        })
        .catch(function (error) { roomsGrid.innerHTML = UI.emptyState("⚠️", "Unavailable", error.message); });
    }

    // Upcoming events
    var eventsHost = document.getElementById("events-list");
    if (eventsHost) {
      API.events.upcoming(4).then(function (payload) {
        var items = payload.data || [];
        eventsHost.innerHTML = items.length
          ? items.map(function (item) {
              return (
                '<article class="card card-pad" data-event-id="' + item.id + '">' +
                  '<span class="badge badge-featured">' + UI.escapeHtml(item.category) + "</span>" +
                  '<h3 class="mt-1">' + UI.escapeHtml(item.title) + "</h3>" +
                  '<p class="text-muted mb-1">Events ' + UI.formatDate(item.date, true) + "<br>" +
                    UI.escapeHtml(item.location) + "</p>" +
                  '<div class="flex-between"><strong>' +
                    (Number(item.ticket_price) > 0 ? UI.money(item.ticket_price) : "Free entry") +
                  '</strong><button class="btn btn-outline btn-sm" data-event="' + item.id +
                    '">Details</button></div>' +
                "</article>"
              );
            }).join("")
          : UI.emptyState("Events", "No upcoming events", "Campus events will show up here.");
      }).catch(function () { eventsHost.innerHTML = ""; });

      eventsHost.addEventListener("click", function (event) {
        var button = event.target.closest("[data-event]");
        if (button) openEventModal(button.dataset.event);
      });
    }

    // Popular categories
    var categoryHost = document.getElementById("category-strip");
    if (categoryHost) {
      API.products.categories().then(function (payload) {
        var categories = payload.data.categories.filter(function (row) { return row.count > 0; });
        categoryHost.innerHTML = categories.map(function (row) {
          return '<a class="chip" href="' + UI.pageUrl("home.html") + "?category=" + row.name + '">' +
            UI.escapeHtml(row.name.replace(/-/g, " ")) + ' <span class="badge">' + row.count + "</span></a>";
        }).join("");
      }).catch(function () { categoryHost.innerHTML = ""; });
    }
  }

  /* =======================================================================
     BROWSE / MARKETPLACE PAGE (pages/home.html)
     ======================================================================= */
  function initHome() {
    var initialFilters = {};
    var q = UI.queryParam("q");
    var category = UI.queryParam("category");
    if (q) initialFilters.q = q;
    if (category) initialFilters.category = category;

    // --- sell / post shortcut tile behaves like a CTA, nothing to fetch ----

    var feed = ListingFeed({
      gridId: "listing-grid",
      paginationId: "listing-pagination",
      countId: "listing-count",
      perPage: 12,
      filters: initialFilters,
      fetcher: function (query) { return API.products.list(query); },
      emptyIcon: "Products",
      emptyTitle: "No items match your filters",
      emptyMessage: "Try a different category, price range or search term."
    });

    var searchInput = document.getElementById("market-search");
    if (searchInput && q) searchInput.value = q;
    var sortSelect = document.getElementById("market-sort");

    // Category chips
    initChips("category-chips", function (value) {
      var categoryField = document.getElementById("filter-category");
      if (categoryField) categoryField.value = value === "all" ? "" : value;
      feed.setFilter("category", value === "all" ? "" : value);
    });

    // Remember chip state coming from a deep link
    if (category) {
      var chip = document.querySelector('#category-chips .chip[data-value="' + category + '"]');
      if (chip) {
        document.querySelectorAll("#category-chips .chip").forEach(function (n) { n.classList.remove("active"); });
        chip.classList.add("active");
      }
    }

    // Filter form (price range, location, condition)
    var filterForm = document.getElementById("filter-form");
    if (filterForm) {
      filterForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var filters = { sort: sortSelect ? sortSelect.value : "-created_at" };
        new FormData(filterForm).forEach(function (value, key) {
          if (String(value).trim() !== "" && value !== "all") filters[key] = value;
        });
        var chipValue = document.querySelector("#category-chips .chip.active");
        if (chipValue && chipValue.dataset.value !== "all") filters.category = chipValue.dataset.value;
        feed.reload(filters);
      });

      var reset = filterForm.querySelector('[data-action="reset"]');
      if (reset) {
        reset.addEventListener("click", function () {
          filterForm.reset();
          document.querySelectorAll("#category-chips .chip").forEach(function (node, index) {
            node.classList.toggle("active", index === 0);
          });
          if (searchInput) searchInput.value = "";
          var panel = document.getElementById("filter-panel");
          if (panel) panel.classList.remove("open");
          feed.reload({});
        });
      }
    }

    if (sortSelect) {
      sortSelect.addEventListener("change", function () {
        feed.setFilter("sort", sortSelect.value);
      });
    }

    var togglePanel = document.getElementById("toggle-filters");
    if (togglePanel) {
      togglePanel.addEventListener("click", function () {
        var panel = document.getElementById("filter-panel");
        var open = panel.classList.toggle("open");
        togglePanel.setAttribute("aria-expanded", open ? "true" : "false");
        togglePanel.textContent = open ? "Hide filters" : "Filters";
      });
    }

    feed.load();

    // ---- Sidebar: accommodation teaser -----------------------------------
    var sideRooms = document.getElementById("side-rooms");
    if (sideRooms) {
      API.accommodation.list({ per_page: 3 }).then(function (payload) {
        var items = payload.data.items;
        sideRooms.innerHTML = items.length
          ? items.map(function (item) {
              return (
                '<a class="card card-pad side-room-card" href="' +
                  UI.listingUrl(item) + '">' +
                  "<strong>" + UI.escapeHtml(item.title) + "</strong>" +
                  '<div class="listing-price">' + UI.money(item.price) + '<small class="text-muted"> / year</small></div>' +
                  '<small class="text-muted">' + UI.escapeHtml(item.location) + "</small>" +
                "</a>"
              );
            }).join("")
          : '<p class="text-muted">No rooms advertised yet.</p>';
      }).catch(function () { sideRooms.innerHTML = ""; });
    }

    // ---- Sidebar: upcoming events ---------------------------------------
    var sideEvents = document.getElementById("side-events");
    if (sideEvents) {
      API.events.upcoming(3).then(function (payload) {
        var items = payload.data || [];
        sideEvents.innerHTML = items.length
          ? items.map(function (item) {
              return (
                '<div class="side-event-item">' +
                  "<strong>" + UI.escapeHtml(item.title) + "</strong>" +
                  '<div class="text-muted"><small>Events ' + UI.formatDate(item.date, true) + "</small></div>" +
                  '<button class="btn btn-ghost btn-sm" data-event="' + item.id + '">View details View</button>' +
                "</div>"
              );
            }).join("")
          : '<p class="text-muted">No upcoming events.</p>';
      }).catch(function () { sideEvents.innerHTML = ""; });

      sideEvents.addEventListener("click", function (event) {
        var button = event.target.closest("[data-event]");
        if (button) openEventModal(button.dataset.event);
      });
    }
  }

  /* =======================================================================
     PRODUCT / ACCOMMODATION DETAILS PAGE
     ======================================================================= */
  function initProductDetails() {
    var type = (UI.queryParam("type") || "product").toLowerCase();
    var id = UI.queryParam("id");
    var host = document.getElementById("detail-root");
    if (!host) return;

    if (!id) {
      host.innerHTML = UI.emptyState("❓", "No listing selected",
        "Open a listing from the marketplace to see its details.",
        '<a class="btn btn-primary mt-2" href="' + UI.pageUrl("home.html") + '">Browse listings</a>');
      return;
    }

    host.innerHTML = '<div class="skeleton detail-loading"></div>';

    var call = type === "accommodation" ? API.accommodation.get(id) : API.products.get(id);

    call.then(function (payload) {
      var item = payload.data;
      document.title = item.title + " · Campus Marketplace";

      var owner = item.type === "accommodation" ? item.landlord : item.seller;
      var isOwner = !!(API.currentUser() && owner && API.currentUser().id === owner.id);

      var specs = item.type === "accommodation"
        ? [
            ["Room type", String(item.room_type || "").replace(/-/g, " ")],
            ["Rooms / spaces", item.rooms],
            ["Preferred gender", item.gender],
            ["Furnished", item.furnished ? "Yes" : "No"],
            ["Location", item.location],
            ["Price (per year)", UI.money(item.price)],
            ["Amenities", (item.amenities || []).join(", ") || "—"],
            ["Advertised", UI.timeAgo(item.created_at)]
          ]
        : [
            ["Category", item.category],
            ["Condition", item.condition],
            ["Location", item.location],
            ["Price", UI.money(item.price)],
            ["Views", item.views],
            ["Posted", UI.timeAgo(item.created_at)]
          ];

      var statusNote = "";
      if (isOwner && item.status !== "published") {
        statusNote =
          '<div class="card card-pad mb-2 status-note">' +
            "<strong>Status: </strong>" + UI.statusBadge(item.status) +
            (item.status === "pending"
              ? '<p class="mb-0 mt-1">Your listing is awaiting admin approval. It will appear publicly shortly.</p>'
              : item.rejection_reason
                ? '<p class="mb-0 mt-1">Reason: ' + UI.escapeHtml(item.rejection_reason) + "</p>"
                : "") +
          "</div>";
      }

      host.innerHTML =
        statusNote +
        '<div class="detail-grid">' +
          "<div>" +
            '<div class="detail-media">' + (item.image_url
              ? '<img src="' + UI.imageFor(item) + '" alt="' + UI.escapeHtml(item.title) + '">'
              : '<div class="detail-placeholder"><strong>No photo available</strong><span>The owner did not add an image to this listing.</span></div>') + '</div>' +
            '<div class="card card-pad mt-2">' +
              "<h2>Description</h2>" +
              "<p>" + UI.escapeHtml(item.description || "No description provided.") + "</p>" +
              '<ul class="spec-list">' +
                specs.map(function (row) {
                  return '<li><span class="k">' + row[0] + '</span><span class="v">' +
                    UI.escapeHtml(row[1]) + "</span></li>";
                }).join("") +
              "</ul>" +
            "</div>" +
          "</div>" +
          "<div>" +
            '<div class="card card-pad">' +
              '<div class="flex-between">' +
                '<span class="badge badge-featured">' + UI.escapeHtml(item.category || item.room_type) + "</span>" +
                (item.featured ? '<span class="badge badge-featured">Featured</span>' : "") +
              "</div>" +
              "<h1 class=\"mt-1\">" + UI.escapeHtml(item.title) + "</h1>" +
              '<div class="price-tag">' + UI.money(item.price) +
                (item.type === "accommodation" ? '<small class="text-muted"> / year</small>' : "") + "</div>" +
              '<p class="text-muted">' + UI.escapeHtml(item.location || "") + " · " +
                Number(item.views || 0) + " views</p>" +
              '<div class="flex gap-1 wrap">' +
                '<button class="btn btn-outline btn-sm" data-detail-fav="' + item.type + '" data-id="' + item.id +
                  '">' + (UI.wishlist.has(item.type, item.id) ? "Saved Saved" : "Save Save") + "</button>" +
                '<button class="btn btn-outline btn-sm" data-action="share">🔗 Share</button>' +
                (isOwner ? '<a class="btn btn-outline btn-sm" href="' + UI.pageUrl("profile.html") +
                  '">Edit in profile</a>' : "") +
              "</div>" +
            "</div>" +
            '<div class="mt-2">' + sellerBlock(owner, {
              phone: owner && owner.phone,
              waText: "Hello " + (owner ? owner.name : "") + ", I saw your listing on Campus Marketplace: " + item.title
            }) + "</div>" +
            '<div class="card card-pad mt-2">' +
              "<h3>Safety tips</h3>" +
              '<ul class="spec-list"><li><span class="k">Meet in public</span><span class="v">Campus gate / hostel</span></li>' +
              '<li><span class="k">Inspect before paying</span><span class="v">Always</span></li>' +
              '<li><span class="k">Report suspicious ads</span><span class="v">Use the admin contact</span></li></ul>' +
            "</div>" +
          "</div>" +
        "</div>" +
        '<section class="section">' +
          '<div class="section-head"><div><h2>Similar listings</h2>' +
            "<p>Other items you may be interested in</p></div></div>" +
          '<div class="grid grid-cards" id="similar-grid">' +
            (item.similar && item.similar.length
              ? item.similar.map(function (row) { return UI.listingCard(row); }).join("")
              : UI.emptyState("🔍", "Nothing similar yet", "Check back later for more listings.", "", true)) +
          "</div>" +
        "</section>";

      // Wire the buttons rendered above
      var favButton = host.querySelector("[data-detail-fav]");
      if (favButton) {
        favButton.addEventListener("click", function () {
          UI.wishlist.toggle(item.type, item.id, favButton).then(function (saved) {
            favButton.innerHTML = saved ? "Saved Saved" : "Save Save";
          });
        });
      }
      var shareButton = host.querySelector('[data-action="share"]');
      if (shareButton) {
        shareButton.addEventListener("click", function () {
          var shareData = { title: item.title, text: item.title + " on Campus Marketplace", url: window.location.href };
          if (navigator.share) {
            navigator.share(shareData).catch(function () { /* dismissed */ });
          } else if (navigator.clipboard) {
            navigator.clipboard.writeText(window.location.href).then(function () {
              UI.toast("Link copied to clipboard", "success");
            });
          } else {
            UI.toast("Copy this page's URL to share it", "info");
          }
        });
      }
    }).catch(function (error) {
      host.innerHTML = UI.emptyState("⚠️", "Listing unavailable", error.message,
        '<a class="btn btn-primary mt-2" href="' + UI.pageUrl("home.html") + '">Back to marketplace</a>');
    });
  }

  /* =======================================================================
     ACCOMMODATION PAGE
     ======================================================================= */
  function initAccommodation() {
    var feed = ListingFeed({
      gridId: "room-grid",
      paginationId: "room-pagination",
      countId: "room-count",
      perPage: 9,
      fetcher: function (query) { return API.accommodation.list(query); },
      emptyIcon: "Rooms",
      emptyTitle: "No rooms match your filters",
      emptyMessage: "Try a wider price range or another area around campus."
    });

    initChips("room-type-chips", function (value) {
      feed.setFilter("room_type", value === "all" ? "" : value);
    });

    var form = document.getElementById("room-filter-form");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var filters = {};
        new FormData(form).forEach(function (value, key) {
          if (String(value).trim() !== "" && value !== "all") filters[key] = value;
        });
        var active = document.querySelector("#room-type-chips .chip.active");
        if (active && active.dataset.value !== "all") filters.room_type = active.dataset.value;
        feed.reload(filters);
      });
      var reset = form.querySelector('[data-action="reset"]');
      if (reset) {
        reset.addEventListener("click", function () {
          form.reset();
          document.querySelectorAll("#room-type-chips .chip").forEach(function (node, index) {
            node.classList.toggle("active", index === 0);
          });
          feed.reload({});
        });
      }
    }

    var locationSelect = document.getElementById("room-location");
    if (locationSelect) {
      API.accommodation.locations().then(function (payload) {
        (payload.data || []).forEach(function (row) {
          var option = document.createElement("option");
          option.value = row.location;
          option.textContent = row.location + " (" + row.count + ")";
          locationSelect.appendChild(option);
        });
      }).catch(function () { /* keep the plain text input usable */ });
    }

    feed.load();
  }

  /* =======================================================================
     EVENTS PAGE
     ======================================================================= */
  function initEvents() {
    var feed = ListingFeed({
      gridId: "event-grid",
      paginationId: "event-pagination",
      countId: "event-count",
      perPage: 9,
      fetcher: function (query) { return API.events.list(query); },
      cardOptions: { showFavorite: true },
      emptyIcon: "Events",
      emptyTitle: "No events found",
      emptyMessage: "Check the filters or come back later for new campus events."
    });

    initChips("event-category-chips", function (value) {
      feed.setFilter("category", value === "all" ? "" : value);
    });

    var upcomingToggle = document.getElementById("events-upcoming");
    if (upcomingToggle) {
      upcomingToggle.addEventListener("change", function () {
        feed.setFilter("upcoming", upcomingToggle.checked ? "true" : "");
      });
    }

    var form = document.getElementById("event-filter-form");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var filters = {};
        new FormData(form).forEach(function (value, key) {
          if (String(value).trim() !== "" && value !== "all") filters[key] = value;
        });
        var active = document.querySelector("#event-category-chips .chip.active");
        if (active && active.dataset.value !== "all") filters.category = active.dataset.value;
        if (upcomingToggle && upcomingToggle.checked) filters.upcoming = "true";
        feed.reload(filters);
      });
      var reset = form.querySelector('[data-action="reset"]');
      if (reset) {
        reset.addEventListener("click", function () {
          form.reset();
          if (upcomingToggle) upcomingToggle.checked = false;
          document.querySelectorAll("#event-category-chips .chip").forEach(function (node, index) {
            node.classList.toggle("active", index === 0);
          });
          feed.reload({});
        });
      }
    }

    // Deep link: ?id=12 opens the modal straight away.
    var deepId = UI.queryParam("id");
    if (deepId) openEventModal(deepId);

    var grid = document.getElementById("event-grid");
    if (grid) {
      // Clicking an event card opens the details modal in place, so filters and
      // scroll position are preserved instead of reloading the page with ?id=.
      grid.addEventListener("click", function (event) {
        var button = event.target.closest("[data-event]");
        if (button) { openEventModal(button.dataset.event); return; }

        var card = event.target.closest('.listing-card[data-type="event"]');
        if (card) {
          event.preventDefault();
          openEventModal(card.dataset.id);
        }
      });
    }

    feed.load();
  }

  /* =======================================================================
     SERVICES PAGE
     ======================================================================= */
  function initServices() {
    var feed = ListingFeed({
      gridId: "service-grid",
      paginationId: "service-pagination",
      countId: "service-count",
      perPage: 9,
      fetcher: function (query) { return API.services.list(query); },
      emptyIcon: "Services",
      emptyTitle: "No services found",
      emptyMessage: "Try another service category."
    });

    initChips("service-category-chips", function (value) {
      feed.setFilter("category", value === "all" ? "" : value);
    });

    var form = document.getElementById("service-filter-form");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var filters = {};
        new FormData(form).forEach(function (value, key) {
          if (String(value).trim() !== "" && value !== "all") filters[key] = value;
        });
        var active = document.querySelector("#service-category-chips .chip.active");
        if (active && active.dataset.value !== "all") filters.category = active.dataset.value;
        feed.reload(filters);
      });
    }

    var deepId = UI.queryParam("id");
    if (deepId) openServiceModal(deepId);

    var grid = document.getElementById("service-grid");
    if (grid) {
      grid.addEventListener("click", function (event) {
        var button = event.target.closest("[data-service]");
        if (button) { openServiceModal(button.dataset.service); return; }

        var card = event.target.closest('.listing-card[data-type="service"]');
        if (card) {
          event.preventDefault();
          openServiceModal(card.dataset.id);
        }
      });
    }

    feed.load();
  }

  /* =======================================================================
     POST LISTING PAGE
     ======================================================================= */
  function initPostListing() {
    var form = document.getElementById("post-form");
    if (!form) return;

    if (!Auth.requireLogin("Please log in to post a listing")) return;

    var typeTabs = document.querySelectorAll("[data-listing-type]");
    var sections = document.querySelectorAll("[data-type-section]");
    var submitButton = form.querySelector('button[type="submit"]');
    var uploadZone = document.getElementById("upload-zone");
    var imageInput = document.getElementById("image-input");
    var preview = document.getElementById("upload-preview");
    var previewImg = document.getElementById("preview-img");
    var progressBar = document.getElementById("upload-progress");
    var progressFill = progressBar ? progressBar.querySelector("span") : null;
    var uploadedUrl = "";
    var currentType = "product";

    // --- dynamic category options per listing type -------------------------
    var CATEGORY_SETS = {
      product: ["books", "electronics", "phones", "laptops", "furniture",
                "hostel-essentials", "clothing", "food", "sports", "others"],
      accommodation: ["single", "self-contain", "hostel", "flat", "shared"],
      event: ["academic", "social", "sports", "religious", "career", "entertainment", "advert", "others"],
      service: ["laundry", "printing", "tutoring", "barbing", "cleaning", "delivery",
                "photography", "tech-repair", "catering", "others"]
    };

    function switchType(type) {
      currentType = type;
      typeTabs.forEach(function (tab) {
        tab.classList.toggle("active", tab.dataset.listingType === type);
      });
      sections.forEach(function (section) {
        section.classList.toggle("hidden", section.dataset.typeSection !== type);
      });

      var categorySelect = form.querySelector("#category-select");
      if (categorySelect) {
        categorySelect.innerHTML = CATEGORY_SETS[type].map(function (value) {
          return '<option value="' + value + '">' + value.replace(/-/g, " ") + "</option>";
        }).join("");
      }
      var label = document.getElementById("category-label");
      if (label) label.textContent = type === "accommodation" ? "Room type" : "Category";
    }

    typeTabs.forEach(function (tab) {
      tab.addEventListener("click", function () { switchType(tab.dataset.listingType); });
    });
    switchType(form.querySelector("[data-listing-type].active") ?
      form.querySelector("[data-listing-type].active").dataset.listingType : "product");

    // --- image upload ------------------------------------------------------
    // Pre-select the listing type from a deep link (e.g. post-listing.html#event)
    var hash = (window.location.hash || "").replace("#", "").toLowerCase();
    if (CATEGORY_SETS[hash]) switchType(hash);

    if (uploadZone && imageInput) {
      uploadZone.addEventListener("click", function () { imageInput.click(); });
      ["dragenter", "dragover"].forEach(function (eventName) {
        uploadZone.addEventListener(eventName, function (event) {
          event.preventDefault();
          uploadZone.classList.add("dragover");
        });
      });
      ["dragleave", "drop"].forEach(function (eventName) {
        uploadZone.addEventListener(eventName, function (event) {
          event.preventDefault();
          uploadZone.classList.remove("dragover");
        });
      });
      uploadZone.addEventListener("drop", function (event) {
        if (event.dataTransfer.files.length) handleFile(event.dataTransfer.files[0]);
      });
      imageInput.addEventListener("change", function () {
        if (imageInput.files.length) handleFile(imageInput.files[0]);
      });
    }

    function handleFile(file) {
      if (!/^image\//.test(file.type)) {
        UI.toast("Please choose an image file (jpg, png, gif or webp)", "error");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        UI.toast("That image is larger than 5 MB", "error");
        return;
      }

      preview.style.display = "block";
      previewImg.src = URL.createObjectURL(file);
      if (progressBar) progressBar.style.display = "block";

      API.uploads.image(file, function (percent) {
        if (progressFill) progressFill.style.width = percent + "%";
      }).then(function (payload) {
        uploadedUrl = payload.data.url;
        UI.toast("Image uploaded", "success");
      }).catch(function (error) {
        UI.toast(error.message, "error");
        preview.style.display = "none";
        uploadedUrl = "";
      }).then(function () {
        if (progressBar) {
          window.setTimeout(function () {
            progressBar.style.display = "none";
            if (progressFill) progressFill.style.width = "0%";
          }, 500);
        }
      });
    }

    var removeImage = document.getElementById("remove-image");
    if (removeImage) {
      removeImage.addEventListener("click", function () {
        preview.style.display = "none";
        uploadedUrl = "";
        if (imageInput) imageInput.value = "";
        previewImg.src = "";
      });
    }

    // --- submit ------------------------------------------------------------
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      Auth.clearErrors(form);

      var data = {};
      new FormData(form).forEach(function (value, key) {
        if (String(value).trim() !== "") data[key] = String(value).trim();
      });
      data.image_url = uploadedUrl || data.image_url || "";

      var payload;
      var endpoint;

      if (currentType === "product") {
        payload = {
          title: data.title, description: data.description, price: data.price,
          category: data.category, location: data.location, condition: data.condition,
          image_url: data.image_url
        };
        endpoint = API.products.create;
      } else if (currentType === "accommodation") {
        payload = {
          title: data.title, description: data.description, price: data.price,
          location: data.location, room_type: data.category, rooms: data.rooms,
          gender: data.gender, furnished: data.furnished === "on" || data.furnished === "true",
          amenities: data.amenities, image_url: data.image_url
        };
        endpoint = API.accommodation.create;
      } else if (currentType === "event") {
        payload = {
          title: data.title, description: data.description, date: data.date,
          location: data.location, category: data.category, ticket_price: data.ticket_price || 0,
          image_url: data.image_url
        };
        endpoint = API.events.create;
      } else {
        payload = {
          title: data.title, description: data.description, price: data.price,
          price_unit: data.price_unit, category: data.category, location: data.location,
          image_url: data.image_url
        };
        endpoint = API.services.create;
      }

      if (!payload.title || payload.title.length < 3) {
        Auth.fieldError(form.querySelector('[name="title"]'), "Please enter a title (3+ characters)");
        UI.toast("Please check the form", "error");
        return;
      }

      Auth.setLoading(submitButton, true, "Submitting…");
      endpoint(payload)
        .then(function (response) {
          Auth.setLoading(submitButton, false);
          UI.toast(response.message || "Listing submitted!", "success", 6000);
          form.reset();
          if (preview) preview.style.display = "none";
          uploadedUrl = "";

          var summary = document.getElementById("post-result");
          if (summary) {
            var item = response.data;
            summary.classList.remove("hidden");
            summary.innerHTML =
              '<div class="card card-pad">' +
                "<h3>What happens next?</h3>" +
                "<p>Your listing <strong>" + UI.escapeHtml(item.title) + "</strong> is " +
                  UI.statusBadge(item.status) + "</p>" +
                '<p class="text-muted">An administrator reviews every listing before it appears ' +
                  "publicly. You can track its status from your profile page.</p>" +
                '<div class="flex gap-1 wrap">' +
                  '<a class="btn btn-primary" href="' + UI.pageUrl("profile.html") + '">Go to my profile</a>' +
                  '<a class="btn btn-outline" href="' + UI.pageUrl("home.html") + '">Browse marketplace</a>' +
                "</div>" +
              "</div>";
            summary.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        })
        .catch(function (error) {
          Auth.setLoading(submitButton, false);
          Auth.paintErrors(form, error.errors);
          UI.toast(error.message, "error");
        });
    });
  }

  /* =======================================================================
     PROFILE PAGE
     ======================================================================= */
  function initProfile() {
    var me = API.currentUser();
    var requestedId = UI.queryParam("id");
    var userId = requestedId || (me ? me.id : null);
    var host = document.getElementById("profile-root");

    if (!host) return;
    if (!userId) {
      host.innerHTML = UI.emptyState("Secure", "Please log in",
        "Log in to view your profile, listings and reviews.",
        '<a class="btn btn-primary mt-2" href="' + UI.pageUrl("login.html") + '">Log in</a>');
      return;
    }

    var isMe = !!(me && Number(me.id) === Number(userId));
    host.innerHTML = '<div class="skeleton profile-loading"></div>';

    Promise.all([
      API.users.get(userId),
      API.users.listings(userId),
      API.users.reviews(userId),
      API.users.stats(userId)
    ]).then(function (results) {
      var profile = results[0].data;
      var listings = results[1].data;
      var reviews = results[2].data;
      var stats = results[3].data;
      var counts = listings.counts || {};

      document.title = profile.name + " · Campus Marketplace";

      host.innerHTML =
        '<div class="profile-hero">' +
          '<div class="flex-between wrap">' +
            '<div class="flex gap-2 align-center">' +
              '<span class="profile-avatar">' + UI.escapeHtml(UI.initials(profile.name)) + "</span>" +
              "<div>" +
                "<h1>" + UI.escapeHtml(profile.name) +
                  (profile.verified ? ' <span class="badge badge-verified">Verified</span>' : "") +
                  (profile.user_type === "admin" ? ' <span class="badge badge-admin">Admin</span>' : "") +
                "</h1>" +
                '<div class="meta">' +
                  "<span>Academic " + UI.escapeHtml(profile.user_type.replace(/_/g, " ")) + "</span>" +
                  (profile.department ? "<span>📚 " + UI.escapeHtml(profile.department) + "</span>" : "") +
                  (profile.level ? "<span>🏅 " + UI.escapeHtml(profile.level) + "</span>" : "") +
                  (profile.location ? "<span>" + UI.escapeHtml(profile.location) + "</span>" : "") +
                  "<span>🗓 Joined " + UI.formatDate(profile.created_at) + "</span>" +
                "</div>" +
              "</div>" +
            "</div>" +
            "<div>" +
              (isMe ? '<button class="btn btn-outline btn-sm" data-action="edit-profile">Edit profile</button> ' : "") +
              (isMe ? '<a class="btn btn-primary btn-sm" href="' + UI.pageUrl("post-listing.html") + '">Post listing</a>' : "") +
            "</div>" +
          "</div>" +
          (profile.bio ? '<p class="mt-2">' + UI.escapeHtml(profile.bio) + "</p>" : "") +
        "</div>" +

        '<div class="stat-grid mt-2">' +
          '<div class="stat-tile"><div class="value">' + (counts.products || 0) +
            '</div><div class="label">Items</div></div>' +
          '<div class="stat-tile"><div class="value">' + (counts.accommodation || 0) +
            '</div><div class="label">Rooms</div></div>' +
          '<div class="stat-tile"><div class="value">' + (counts.events || 0) +
            '</div><div class="label">Events</div></div>' +
          '<div class="stat-tile"><div class="value">' + (counts.services || 0) +
            '</div><div class="label">Services</div></div>' +
        "</div>" +

        '<div class="mt-2">' +
          '<div class="card card-pad">' +
            '<div class="flex-between">' +
              "<div>" +
                "<strong>Reputation</strong>" +
                '<div>' + (stats.rating_average
                  ? UI.stars(stats.rating_average) + " " + stats.rating_average + "/5 from " +
                    stats.rating_count + " review" + (stats.rating_count === 1 ? "" : "s")
                  : '<span class="text-muted">No reviews yet</span>') +
                "</div>" +
              "</div>" +
              (!isMe && API.isLoggedIn()
                ? '<button class="btn btn-outline btn-sm" data-action="write-review">Leave a review</button>'
                : "") +
            "</div>" +
            '<div id="review-form-holder" class="hidden mt-2"></div>' +
          "</div>" +
        "</div>" +

        '<div class="mt-3">' +
          '<div class="tabs" id="profile-tabs">' +
            '<button class="active" data-tab="products">Items <span class="count">' +
              (counts.products || 0) + "</span></button>" +
            '<button data-tab="accommodation">Rooms <span class="count">' +
              (counts.accommodation || 0) + "</span></button>" +
            '<button data-tab="events">Events <span class="count">' + (counts.events || 0) + "</span></button>" +
            '<button data-tab="services">Services <span class="count">' +
              (counts.services || 0) + "</span></button>" +
            '<button data-tab="reviews">Reviews <span class="count">' + (reviews.rating_count || 0) + "</span></button>" +
          "</div>" +
          '<div id="profile-panel"></div>' +
        "</div>" +

        (isMe ? '<div class="mt-3" id="edit-profile-holder" class="hidden"></div>' : "");

      // ---- tab rendering --------------------------------------------------
      var panel = document.getElementById("profile-panel");
      var tabsHost = document.getElementById("profile-tabs");

      function renderTab(tab) {
        if (tab === "reviews") {
          panel.innerHTML = (reviews.reviews && reviews.reviews.length)
            ? reviews.reviews.map(function (review) {
                return (
                  '<div class="review-item">' +
                    '<div class="review-head">' +
                      '<span class="seller-avatar avatar-review">' +
                        UI.escapeHtml(UI.initials(review.author.name)) + "</span>" +
                      "<div><strong>" + UI.escapeHtml(review.author.name) + "</strong>" +
                        "<div>" + UI.stars(review.rating) + ' <small class="text-muted">' +
                        UI.timeAgo(review.created_at) + "</small></div></div>" +
                    "</div>" +
                    "<p class=\"mb-0\">" + UI.escapeHtml(review.comment || "") + "</p>" +
                  "</div>"
                );
              }).join("")
            : UI.emptyState("Reviews", "No reviews yet", "Reviews from other students will appear here.", "", true);
          return;
        }

        var items = listings[tab] || [];
        panel.innerHTML = items.length
          ? '<div class="grid grid-cards">' + items.map(function (item) {
              return UI.listingCard(item, { showStatus: isMe });
            }).join("") + "</div>"
          : UI.emptyState("Other", "Nothing here yet",
              isMe ? "Use the “Post listing” button to add your first advert." : "This user has no published listings here.",
              isMe ? '<a class="btn btn-primary mt-2" href="' + UI.pageUrl("post-listing.html") + '">Post a listing</a>' : "",
              true);
      }

      tabsHost.addEventListener("click", function (event) {
        var button = event.target.closest("button[data-tab]");
        if (!button) return;
        tabsHost.querySelectorAll("button").forEach(function (node) { node.classList.remove("active"); });
        button.classList.add("active");
        renderTab(button.dataset.tab);
      });
      renderTab("products");

      // ---- owner actions --------------------------------------------------
      var editButton = host.querySelector('[data-action="edit-profile"]');
      if (editButton) {
        editButton.addEventListener("click", function () {
          var holder = document.getElementById("edit-profile-holder");
          holder.classList.remove("hidden");
          holder.innerHTML =
            '<div class="card card-pad">' +
              "<h3>Edit my profile</h3>" +
              '<form id="edit-profile-form" class="form-row form-row-2">' +
                '<div class="form-group"><label for="ep-name">Full name</label>' +
                  '<input id="ep-name" name="name" type="text" value="' + UI.escapeHtml(profile.name) + '"></div>' +
                '<div class="form-group"><label for="ep-phone">Phone</label>' +
                  '<input id="ep-phone" name="phone" type="tel" value="' + UI.escapeHtml(profile.phone || "") + '"></div>' +
                '<div class="form-group"><label for="ep-dept">Department</label>' +
                  '<input id="ep-dept" name="department" type="text" value="' +
                  UI.escapeHtml(profile.department || "") + '"></div>' +
                '<div class="form-group"><label for="ep-level">Level</label>' +
                  '<input id="ep-level" name="level" type="text" value="' + UI.escapeHtml(profile.level || "") + '"></div>' +
                '<div class="form-group"><label for="ep-loc">Location</label>' +
                  '<input id="ep-loc" name="location" type="text" value="' +
                  UI.escapeHtml(profile.location || "") + '"></div>' +
                '<div class="form-group"><label for="ep-wa">WhatsApp</label>' +
                  '<input id="ep-wa" name="whatsapp" type="tel" value="' +
                  UI.escapeHtml(profile.whatsapp || "") + '"></div>' +
                '<div class="form-group form-span"><label for="ep-bio">Bio</label>' +
                  '<textarea id="ep-bio" name="bio" rows="3">' + UI.escapeHtml(profile.bio || "") + "</textarea></div>" +
                '<div class="form-group form-span">' +
                  '<button class="btn btn-primary" type="submit">Save changes</button>' +
                  '<button class="btn btn-outline" type="button" data-action="cancel-edit">Cancel</button>' +
                "</div>" +
              "</form>" +
            "</div>";
          holder.scrollIntoView({ behavior: "smooth", block: "start" });

          var editForm = document.getElementById("edit-profile-form");
          holder.querySelector('[data-action="cancel-edit"]').addEventListener("click", function () {
            holder.classList.add("hidden");
            holder.innerHTML = "";
          });
          editForm.addEventListener("submit", function (event) {
            event.preventDefault();
            var payload = {};
            new FormData(editForm).forEach(function (value, key) {
              if (String(value).trim() !== "") payload[key] = String(value).trim();
            });
            Auth.updateProfile(payload).then(function () {
              UI.toast("Profile updated", "success");
              window.setTimeout(function () { window.location.reload(); }, 800);
            }).catch(function (error) { UI.toast(error.message, "error"); });
          });
        });
      }

      // ---- review form ----------------------------------------------------
      var reviewButton = host.querySelector('[data-action="write-review"]');
      if (reviewButton) {
        reviewButton.addEventListener("click", function () {
          var holder = document.getElementById("review-form-holder");
          holder.classList.remove("hidden");
          holder.innerHTML =
            '<form id="review-form">' +
              '<div class="form-group"><label for="rv-rating">Rating</label>' +
                '<select id="rv-rating" name="rating">' +
                  '<option value="5">★★★★★ Excellent</option>' +
                  '<option value="4">★★★★ Very good</option>' +
                  '<option value="3">★★★ Average</option>' +
                  '<option value="2">★★ Poor</option>' +
                  '<option value="1">★ Very poor</option>' +
                "</select></div>" +
              '<div class="form-group"><label for="rv-comment">Comment</label>' +
                '<textarea id="rv-comment" name="comment" rows="3" ' +
                'placeholder="How was your experience dealing with this user?"></textarea></div>' +
              '<button class="btn btn-primary" type="submit">Submit review</button>' +
            "</form>";

          document.getElementById("review-form").addEventListener("submit", function (event) {
            event.preventDefault();
            var data = {};
            new FormData(event.target).forEach(function (value, key) { data[key] = value; });
            API.users.review(userId, data).then(function (response) {
              UI.toast(response.message || "Review saved", "success");
              window.setTimeout(function () { window.location.reload(); }, 900);
            }).catch(function (error) { UI.toast(error.message, "error"); });
          });
        });
      }
    }).catch(function (error) {
      host.innerHTML = UI.emptyState("⚠️", "Profile unavailable", error.message);
    });
  }

  /* =======================================================================
     FAVORITES / WISHLIST PAGE
     ======================================================================= */
  function initFavorites() {
    var host = document.getElementById("favorites-root");
    if (!host) return;

    if (!Auth.requireLogin("Please log in to see your wishlist")) return;

    var currentFilter = "";

    function load() {
      host.innerHTML = '<div class="grid grid-cards">' + UI.skeletonGrid(3) + "</div>";
      API.favorites.list(currentFilter || undefined).then(function (payload) {
        var items = payload.data.items || [];
        if (!items.length) {
          host.innerHTML = UI.emptyState("💔", "Your wishlist is empty",
            "Tap the heart on any listing to save it here for later.",
            '<a class="btn btn-primary mt-2" href="' + UI.pageUrl("home.html") + '">Browse listings</a>');
          return;
        }
        host.innerHTML =
          '<p class="text-muted" id="fav-count">' + items.length + " saved listing" +
            (items.length === 1 ? "" : "s") + "</p>" +
          '<div class="grid grid-cards">' +
            items.map(function (row) { return UI.listingCard(row.listing); }).join("") +
          "</div>";
        UI.wishlist.load();
      }).catch(function (error) {
        host.innerHTML = UI.emptyState("⚠️", "Could not load your wishlist", error.message);
      });
    }

    initChips("favorite-chips", function (value) {
      currentFilter = value === "all" ? "" : value;
      load();
    });

    load();
  }

  /* =======================================================================
     Dispatcher
     ======================================================================= */
  var INITIALISERS = {
    landing: initLanding,
    home: initHome,
    marketplace: initHome,
    product: initProductDetails,
    accommodation: initAccommodation,
    events: initEvents,
    services: initServices,
    post: initPostListing,
    profile: initProfile,
    favorites: initFavorites
  };

  document.addEventListener("DOMContentLoaded", function () {
    var page = (document.body && document.body.dataset.page) || "landing";
    var init = INITIALISERS[page];
    if (typeof init === "function") {
      try {
        init();
      } catch (error) {
        // Never let a page-level failure blank the whole site.
        window.console && window.console.error("[Campus Marketplace]", error);
      }
    }
  });

  // Expose a few helpers for admin.js and inline page scripts.
  window.Marketplace = {
    ListingFeed: ListingFeed,
    initChips: initChips,
    openEventModal: openEventModal,
    openServiceModal: openServiceModal,
    sellerBlock: sellerBlock
  };
})(window, document);
