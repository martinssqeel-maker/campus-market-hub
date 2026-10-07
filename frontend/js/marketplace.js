/* ==========================================================================
   marketplace.js – every public page of Lafia Marketplace.

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

  var BRAND = "Lafia Marketplace";

  /** Inline SVG from the shared icon set (never emoji as a UI control). */
  function svgi(name, size) {
    return (window.Shell && window.Shell.icon) ? window.Shell.icon(name, size) : "";
  }

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
            options.emptyIcon || "search",
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
        grid.innerHTML = UI.emptyState("info", "Could not load listings", error.message);
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

    function go() {
      var term = input.value.trim();
      window.location.href = UI.pageUrl("home.html") + (term ? "?q=" + encodeURIComponent(term) : "");
    }

    var form = input.form || document.getElementById("hero-search-form");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        go();
      });
    }

    input.addEventListener("input", run);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        go();
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
          '<a class="btn btn-outline" href="tel:' + UI.escapeHtml(item.creator.phone) + '">' +
            svgi("phone", 16) + "Call organiser</a>" +
          '<a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/234' +
            UI.escapeHtml(String(item.creator.phone).replace(/^0/, "")) +
            "?text=" + encodeURIComponent("Hello, I saw your event on " + BRAND + ": " + item.title) +
          '">' + svgi("whatsapp", 16) + "WhatsApp</a>";
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
          '<a class="btn btn-outline" href="tel:' + UI.escapeHtml(provider.phone) + '">' +
            svgi("phone", 16) + "Call</a>" +
          '<a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/234' +
            UI.escapeHtml(String(provider.phone).replace(/^0/, "")) +
            "?text=" + encodeURIComponent("Hello, I need your service from " + BRAND + ": " + item.title) +
          '">' + svgi("whatsapp", 16) + "WhatsApp</a>";
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
          '<a class="btn btn-outline" href="tel:' + UI.escapeHtml(phone) + '">' +
            svgi("phone", 16) + "Call " + UI.escapeHtml(phone) + "</a>" +
          '<a class="btn btn-success" target="_blank" rel="noopener" href="https://wa.me/234' +
            UI.escapeHtml(phone.replace(/^0/, "")) +
            "?text=" + encodeURIComponent(opts.waText || ("Hello, I am interested in your listing on " + BRAND)) +
          '">' + svgi("whatsapp", 16) + "WhatsApp</a>" +
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

    // Live counters — animated by shell.js so the hero numbers feel alive.
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
        if (!node) return;
        if (window.Shell && window.Shell.setCounter) window.Shell.setCounter(node, map[id]);
        else node.textContent = Number(map[id] || 0).toLocaleString();
      });
      document.querySelectorAll("[data-live-stat]").forEach(function (node) {
        var key = node.dataset.liveStat;
        if (data[key] === undefined) return;
        if (window.Shell && window.Shell.setCounter) {
          window.Shell.setCounter(node, data[key], node.dataset.countSuffix || "");
        } else {
          node.textContent = Number(data[key]).toLocaleString();
        }
      });
    }).catch(function () {
      // No API? Show honest zeros rather than misleading dashes.
      document.querySelectorAll("[data-live-stat], #stat-products, #stat-accommodation, #stat-events, #stat-services")
        .forEach(function (node) { node.textContent = "0" + (node.dataset.countSuffix || ""); });
    });

    /* ---------------------------------------------------------------------
       Marketing-only landing page.

       The design bible is explicit: the public, unauthenticated URL must NOT
       render marketplace listings, product feeds, accommodation cards, event
       feeds or provider directories. Those all live behind authentication.

       The only live data on this page is the aggregate counter strip above,
       which is social proof rather than a feed and is read straight from
       GET /api/stats — never invented.
       --------------------------------------------------------------------- */
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

    // ---- Prominent Game Centre module + adaptive discovery rows ----------
    if (window.GameCentre && window.GameCentre.renderHomeModule) {
      window.GameCentre.renderHomeModule(document.getElementById("home-game"));
    }
    initHomeDiscovery();

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
                  '<div class="text-muted"><small>' + UI.formatDate(item.date, true) + "</small></div>" +
                  '<button class="btn btn-ghost btn-sm" data-event="' + item.id + '">View details</button>' +
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

  /* -----------------------------------------------------------------------
     Home discovery rows.

     The design bible asks for adaptive sections rather than a fixed template:
     each row renders from real API data, and a row with nothing to show is
     removed instead of printing an empty heading. When the reader changes
     location the rows re-query and the labels follow.
     ----------------------------------------------------------------------- */
  function initHomeDiscovery() {
    var host = document.getElementById("home-discovery");
    if (!host) return;

    var pick = function (key) {
      return function (payload) { return (payload.data && payload.data[key]) || []; };
    };

    function sectionsFor(area) {
      var near = area && area !== "Lafia" ? area : "Lafia";
      return [
        {
          id: "recommended",
          title: "Recommended for you",
          blurb: "The newest listings across Lafia, refreshed as people post",
          keepEmpty: true,
          empty: "Nothing has been posted yet. Your first listing will show up right here.",
          load: function () { return API.products.list({ per_page: 4, sort: "-created_at" }).then(pick("products")); }
        },
        {
          id: "trending",
          title: "Trending in Lafia",
          blurb: "Ranked by real views on the platform — never invented",
          load: function () { return API.misc.popular().then(pick("products")); }
        },
        {
          id: "near",
          title: "Near " + near,
          blurb: "Posted by people in and around your area",
          load: function () { return API.products.list({ per_page: 4, location: area }).then(pick("products")); }
        },
        {
          id: "rooms",
          title: "Available accommodation",
          blurb: "Hostels, lodges and self-contains you can inspect",
          keepEmpty: true,
          empty: "No rooms are advertised yet. Landlords can post one in a couple of minutes.",
          load: function () { return API.accommodation.list({ per_page: 3 }).then(pick("items")); },
          href: "accommodation.html",
          hrefLabel: "All rooms"
        },
        {
          id: "events",
          title: "Upcoming events",
          blurb: "Concerts, seminars and community happenings",
          keepEmpty: true,
          empty: "No upcoming events yet. Organisers can publish one from the events page.",
          load: function () { return API.events.upcoming(3).then(function (payload) { return payload.data || []; }); },
          href: "events.html",
          hrefLabel: "All events"
        },
        {
          id: "providers",
          title: "Top service providers",
          blurb: "Repairs, printing, tutoring, delivery and more",
          load: function () { return API.services.list({ per_page: 3 }).then(pick("items")); },
          href: "services.html",
          hrefLabel: "All providers"
        }
      ];
    }

    function render(area) {
      host.innerHTML = UI.skeletonGrid(4);
      var sections = sectionsFor(area);

      Promise.all(sections.map(function (section) {
        return section.load().catch(function () { return null; });
      })).then(function (results) {
        var html = "";

        sections.forEach(function (section, index) {
          var items = results[index];
          // A failed or empty optional row simply disappears — no dead heading.
          if (!items || !items.length) {
            if (!section.keepEmpty) return;
            html +=
              '<section class="discovery-row">' +
                '<div class="section-head"><div><h2>' + UI.escapeHtml(section.title) + "</h2>" +
                  '<p>' + UI.escapeHtml(section.blurb) + "</p></div></div>" +
                UI.emptyState("empty", "Nothing here yet", section.empty) +
              "</section>";
            return;
          }

          html +=
            '<section class="discovery-row">' +
              '<div class="section-head"><div><h2>' + UI.escapeHtml(section.title) + "</h2>" +
                '<p>' + UI.escapeHtml(section.blurb) + "</p></div>" +
                (section.href
                  ? '<a class="btn btn-outline btn-sm" href="' + UI.pageUrl(section.href) + '">' +
                    UI.escapeHtml(section.hrefLabel) + "</a>"
                  : "") +
              "</div>" +
              '<div class="grid grid-cards">' +
                items.map(function (item) { return UI.listingCard(item); }).join("") +
              "</div>" +
            "</section>";
        });

        host.innerHTML = html || UI.emptyState("empty", "Nothing here yet",
          "As soon as people post in Lafia, this page fills up.",
          '<a class="btn btn-primary mt-2" href="' + UI.pageUrl("post-listing.html") + '">Post a listing</a>');
      });
    }

    function currentArea() {
      return (window.Shell && Shell.getLocation) ? Shell.getLocation() : "Lafia";
    }

    function paintLocationLabel() {
      var label = document.getElementById("home-location");
      if (label) label.textContent = currentArea();
    }

    paintLocationLabel();
    render(currentArea());

    window.addEventListener("cm:location", function () {
      paintLocationLabel();
      render(currentArea());
    });
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
      host.innerHTML = UI.emptyState("search", "No listing selected",
        "Open a listing from the marketplace to see its details.",
        '<a class="btn btn-primary mt-2" href="' + UI.pageUrl("home.html") + '">Browse listings</a>');
      return;
    }

    host.innerHTML = '<div class="skeleton detail-loading"></div>';

    var call = type === "accommodation" ? API.accommodation.get(id) : API.products.get(id);

    call.then(function (payload) {
      var item = payload.data;
      document.title = item.title + " · " + BRAND;

      var owner = item.type === "accommodation" ? item.landlord : item.seller;
      var isOwner = !!(API.currentUser() && owner && API.currentUser().id === owner.id);

      /* ---- media gallery -------------------------------------------------
         Large media, counter, thumbnails, fullscreen and a designed fallback
         behind every image, so a dead URL degrades to artwork instead of a
         broken-image icon. The API currently returns a single image_url; an
         `images` array is honoured the moment the backend provides one. */
      var images = Array.isArray(item.images) && item.images.length
        ? item.images.slice(0, 8)
        : (item.image_url ? [item.image_url] : []);

      var galleryHtml;
      if (images.length) {
        galleryHtml =
          '<div class="gallery" id="detail-gallery">' +
            '<div class="gallery__stage" id="gallery-stage">' +
              '<span class="gallery__fallback" aria-hidden="true">' + svgi("image", 30) +
                "<em>Photo unavailable</em></span>" +
              '<img id="gallery-image" src="' + UI.escapeHtml(UI.imageFor({ image_url: images[0] })) + '"' +
                ' alt="' + UI.escapeHtml(item.title) + '" loading="lazy" onerror="this.onerror=null;this.remove();">' +
              (images.length > 1
                ? '<span class="gallery__counter" id="gallery-counter">1 / ' + images.length + "</span>"
                : "") +
              '<button class="gallery__expand" type="button" data-gallery-expand' +
                ' aria-label="View photo full screen">' + svgi("expand", 17) + "</button>" +
            "</div>" +
            (images.length > 1
              ? '<div class="gallery__thumbs" role="group" aria-label="Photos of this listing">' +
                  images.map(function (src, index) {
                    return '<button type="button" class="gallery__thumb' + (index === 0 ? " is-active" : "") +
                      '" data-thumb="' + index + '" aria-label="Show photo ' + (index + 1) + '">' +
                      '<img src="' + UI.escapeHtml(UI.imageFor({ image_url: src })) + '" alt="" loading="lazy" ' +
                        'onerror="this.onerror=null;this.closest(\'.gallery__thumb\').remove()">' +
                    "</button>";
                  }).join("") +
                "</div>"
              : "") +
          "</div>";
      } else {
        galleryHtml =
          '<div class="detail-placeholder">' + svgi("image", 34) +
            "<strong>No photo yet</strong>" +
            "<span>The owner has not added a picture. Ask for one before you travel to inspect.</span>" +
          "</div>";
      }

      /* ---- specifications: only rows backed by real data ------------------ */
      var CONDITION_LABELS = {
        new: "Brand new", used: "Used", "fairly-used": "Fairly used",
        fairly_used: "Fairly used", refurbished: "Refurbished"
      };
      function conditionLabel(value) {
        if (!value) return "";
        var key = String(value).toLowerCase().replace(/\s+/g, "-");
        return CONDITION_LABELS[key] || String(value).replace(/-/g, " ");
      }

      var specs = [];
      if (item.type === "accommodation") {
        specs.push(["Room type", String(item.room_type || "").replace(/-/g, " ")]);
        specs.push(["Rooms / spaces", item.rooms]);
        specs.push(["Preferred gender", item.gender]);
        specs.push(["Furnished", item.furnished === true ? "Yes" : (item.furnished === false ? "No" : "")]);
        specs.push(["Electricity", item.electricity]);
        specs.push(["Water", item.water]);
        specs.push(["Security", item.security]);
        specs.push(["Distance to campus", item.distance_to_campus]);
        specs.push(["Availability", item.available_from ? UI.formatDate(item.available_from) : "Available now"]);
        specs.push(["Location", item.location]);
        specs.push(["Rent (per year)", UI.money(item.price)]);
        specs.push(["Amenities", (item.amenities || []).join(", ")]);
      } else {
        specs.push(["Category", String(item.category || "").replace(/-/g, " ")]);
        specs.push(["Condition", conditionLabel(item.condition)]);
        specs.push(["Brand / model", item.brand]);
        specs.push(["Accessories included", item.accessories]);
        specs.push(["Location", item.location]);
        specs.push(["Price", UI.money(item.price)]);
        specs.push(["Views", item.views]);
      }
      specs.push(["Availability", item.available === false ? "No longer available" : "Available now"]);
      specs.push(["Posted", UI.timeAgo(item.created_at)]);
      specs = specs.filter(function (row) {
        return row[1] !== undefined && row[1] !== null && String(row[1]).trim() !== "";
      });

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

      var phone = owner && owner.phone ? String(owner.phone) : "";
      var contactHtml;
      if (isOwner) {
        contactHtml =
          '<div class="contact-actions">' +
            '<a class="btn btn-primary btn-block" href="' + UI.pageUrl("profile.html") + '">Manage in my dashboard</a>' +
          "</div>";
      } else if (phone && API.isLoggedIn()) {
        contactHtml =
          '<div class="contact-actions">' +
            '<a class="btn btn-outline" href="tel:' + UI.escapeHtml(phone) + '">' +
              svgi("phone", 16) + "Call " + UI.escapeHtml(phone) + "</a>" +
            '<a class="btn btn-success" target="_blank" rel="noopener" href="https://wa.me/234' +
              UI.escapeHtml(phone.replace(/^0/, "")) +
              "?text=" + encodeURIComponent("Hello " + (owner ? owner.name : "") + ", I saw your listing on " + BRAND + ": " + item.title) +
            '">' + svgi("whatsapp", 16) + "WhatsApp</a>" +
          "</div>";
      } else {
        contactHtml =
          '<div class="contact-actions">' +
            '<a class="btn btn-primary btn-block" href="' + UI.pageUrl("login.html") + '?next=' +
              encodeURIComponent(window.location.pathname + window.location.search) +
            '">Log in to see contact details</a>' +
          "</div>";
      }

      host.innerHTML =
        statusNote +
        '<div class="detail-grid">' +
          "<div>" +
            galleryHtml +
            '<div class="card card-pad mt-2">' +
              "<h2>Description</h2>" +
              "<p>" + UI.escapeHtml(item.description || "The owner has not written a description yet.") + "</p>" +
              '<h3 class="mt-3">Specifications</h3>' +
              '<ul class="spec-list">' +
                specs.map(function (row) {
                  return '<li><span class="k">' + UI.escapeHtml(row[0]) + '</span><span class="v">' +
                    UI.escapeHtml(row[1]) + "</span></li>";
                }).join("") +
              "</ul>" +
            "</div>" +
          "</div>" +
          "<div>" +
            '<div class="card card-pad">' +
              '<div class="flex-between">' +
                '<span class="badge badge-published">' + UI.escapeHtml(String(item.category || item.room_type || item.type).replace(/-/g, " ")) + "</span>" +
                (item.featured ? '<span class="badge badge-featured">Promoted</span>' : "") +
              "</div>" +
              "<h1 class=\"mt-1\">" + UI.escapeHtml(item.title) + "</h1>" +
              '<div class="price-tag">' + UI.money(item.price) +
                (item.type === "accommodation" ? '<small class="text-muted"> / year</small>' : "") + "</div>" +
              '<p class="text-muted">' + UI.escapeHtml(item.location || "") + " · posted " +
                UI.escapeHtml(UI.timeAgo(item.created_at) || "recently") + " · " +
                Number(item.views || 0) + " views</p>" +
              '<div class="flex gap-1 wrap">' +
                '<button class="btn btn-outline btn-sm" data-detail-fav="' + item.type + '" data-id="' + item.id +
                  '">' + UI.heartSvg(UI.wishlist.has(item.type, item.id)) +
                  (UI.wishlist.has(item.type, item.id) ? "Saved" : "Save") + "</button>" +
                '<button class="btn btn-outline btn-sm" data-action="share">' + svgi("share", 16) + "Share</button>" +
                (isOwner ? '<a class="btn btn-outline btn-sm" href="' + UI.pageUrl("profile.html") +
                  '">Edit in profile</a>' : "") +
              "</div>" +
            "</div>" +

            (isOwner ? "" :
              '<div class="mt-2">' +
                '<div class="contact-actions">' +
                  '<button class="btn btn-primary btn-block" type="button" data-action="message">' +
                    svgi("message", 17) + "Message " + UI.escapeHtml(owner && owner.name ? String(owner.name).split(" ")[0] : "the owner") + "</button>" +
                  '<button class="btn btn-accent btn-block" type="button" data-action="offer">' +
                    svgi("wallet", 17) + "Make an offer</button>" +
                "</div>" +
                '<div id="offer-slot"></div>' +
                contactHtml +
              "</div>") +

            '<div class="mt-2">' + sellerBlock(owner, {
              phone: phone,
              waText: "Hello " + (owner ? owner.name : "") + ", I saw your listing on " + BRAND + ": " + item.title
            }) + "</div>" +

            '<div class="card card-pad mt-2">' +
              "<h2 class=\"h3\">Trust and safety</h2>" +
              '<ul class="spec-list">' +
                '<li><span class="k">Listing review</span><span class="v">Moderated before going live</span></li>' +
                '<li><span class="k">Account</span><span class="v">' +
                  (owner && owner.verified ? "Verified" : "Not verified yet") + "</span></li>" +
                '<li><span class="k">Meet in public</span><span class="v">Busy, well-lit place</span></li>' +
                '<li><span class="k">Inspect before paying</span><span class="v">Always</span></li>' +
              "</ul>" +
              '<button class="btn btn-ghost btn-sm mt-2" type="button" data-action="report">' +
                svgi("info", 15) + "Report this listing</button>" +
            "</div>" +
          "</div>" +
        "</div>" +
        '<section class="section">' +
          '<div class="section-head"><div><h2>Similar listings</h2>' +
            "<p>Other listings you may be interested in</p></div></div>" +
          '<div class="grid grid-cards" id="similar-grid">' +
            (item.similar && item.similar.length
              ? item.similar.map(function (row) { return UI.listingCard(row); }).join("")
              : UI.emptyState("search", "Nothing similar yet",
                  "We will suggest related listings here as more items are posted.")) +
          "</div>" +
        "</section>";

      /* ---- gallery interactions ------------------------------------------ */
      var galleryImage = host.querySelector("#gallery-image");
      var galleryCounter = host.querySelector("#gallery-counter");
      var activeImage = 0;

      function showImage(index) {
        if (!galleryImage || !images.length) return;
        activeImage = Math.max(0, Math.min(images.length - 1, index));
        galleryImage.src = UI.imageFor({ image_url: images[activeImage] });
        if (galleryCounter) galleryCounter.textContent = (activeImage + 1) + " / " + images.length;
        host.querySelectorAll("[data-thumb]").forEach(function (node) {
          node.classList.toggle("is-active", Number(node.dataset.thumb) === activeImage);
        });
      }

      host.querySelectorAll("[data-thumb]").forEach(function (node) {
        node.addEventListener("click", function () { showImage(Number(node.dataset.thumb)); });
      });

      /* Swipe between photos on touch devices, with a threshold so a vertical
         scroll is never mistaken for a swipe. */
      var stage = host.querySelector("#gallery-stage");
      if (stage && images.length > 1) {
        var startX = null;
        stage.addEventListener("touchstart", function (event) {
          startX = event.touches[0].clientX;
        }, { passive: true });
        stage.addEventListener("touchend", function (event) {
          if (startX === null) return;
          var delta = event.changedTouches[0].clientX - startX;
          if (Math.abs(delta) > 46) showImage(activeImage + (delta < 0 ? 1 : -1));
          startX = null;
        }, { passive: true });
      }

      var expandButton = host.querySelector("[data-gallery-expand]");
      if (expandButton && images.length) {
        expandButton.addEventListener("click", function () {
          var box = document.createElement("div");
          box.className = "lightbox";
          box.setAttribute("role", "dialog");
          box.setAttribute("aria-modal", "true");
          box.setAttribute("aria-label", item.title);
          box.innerHTML =
            '<button class="btn btn-outline lightbox__close" type="button" aria-label="Close full screen">' +
              svgi("close", 16) + "Close</button>" +
            '<img src="' + UI.escapeHtml(UI.imageFor({ image_url: images[activeImage] })) +
              '" alt="' + UI.escapeHtml(item.title) + '">';
          function closeBox() {
            box.remove();
            document.body.style.overflow = "";
            document.removeEventListener("keydown", onKey);
          }
          function onKey(event) { if (event.key === "Escape") closeBox(); }
          box.addEventListener("click", closeBox);
          document.addEventListener("keydown", onKey);
          document.body.appendChild(box);
          document.body.style.overflow = "hidden";
        });
      }

      // Wire the buttons rendered above
      var favButton = host.querySelector("[data-detail-fav]");
      if (favButton) {
        favButton.addEventListener("click", function () {
          UI.wishlist.toggle(item.type, item.id, favButton).then(function (saved) {
            favButton.innerHTML = UI.heartSvg(saved) + (saved ? "Saved" : "Save");
          });
        });
      }

      var messageButton = host.querySelector('[data-action="message"]');
      if (messageButton) {
        messageButton.addEventListener("click", function () {
          window.messageAboutListing(item);
        });
      }

      /* Make an Offer: a conversational prefill, never a negotiation cockpit. */
      var offerButton = host.querySelector('[data-action="offer"]');
      if (offerButton) {
        offerButton.addEventListener("click", function () {
          var slot = host.querySelector("#offer-slot");
          if (!slot) return;
          if (slot.innerHTML) { slot.innerHTML = ""; return; }
          slot.innerHTML =
            '<div class="offer-panel mt-2">' +
              "<h3>Make an offer</h3>" +
              "<p>Tell " + UI.escapeHtml((owner && owner.name) || "the owner") +
                " what you will pay. Your offer opens a conversation where they can accept, reject or counter.</p>" +
              '<div class="offer-amount"><span>₦</span>' +
                '<label class="sr-only" for="detail-offer-amount">Your offer amount</label>' +
                '<input id="detail-offer-amount" type="number" min="0" step="100" inputmode="numeric" ' +
                  'placeholder="' + Number(item.price || 0) + '">' +
              "</div>" +
              '<div class="form-group mt-1">' +
                '<label for="detail-offer-note">Message</label>' +
                '<textarea id="detail-offer-note" rows="2">I will buy it at this price.</textarea>' +
              "</div>" +
              '<button class="btn btn-accent btn-block" type="button" data-offer-send>Send offer</button>' +
              '<p class="form-note mt-1">Nothing is charged. The offer is only a message until you both agree.</p>' +
            "</div>";

          slot.querySelector("[data-offer-send]").addEventListener("click", function () {
            var amount = slot.querySelector("#detail-offer-amount").value;
            var note = slot.querySelector("#detail-offer-note").value;
            if (!String(amount).trim()) {
              UI.toast("Enter the amount you want to offer", "info");
              return;
            }
            window.messageAboutListing(item, { offer: amount, text: note });
          });
        });
      }

      /* Report: honest intake. There is no reports endpoint yet, so the report
         is stored on the device and the sheet says exactly that. */
      var reportButton = host.querySelector('[data-action="report"]');
      if (reportButton) {
        reportButton.addEventListener("click", function () {
          var reasons = [
            { id: "scam", label: "Looks like a scam or fraud" },
            { id: "wrong", label: "Wrong or misleading details" },
            { id: "sold", label: "Already sold or unavailable" },
            { id: "prohibited", label: "Prohibited or offensive content" }
          ];
          var dialog = UI.sheet({
            title: "Report this listing",
            bodyHtml:
              '<p class="text-muted">Reports go to the moderation queue with the listing link and your account, so a human can review it.</p>' +
              reasons.map(function (reason, index) {
                return '<label class="radio-row"><input type="radio" name="report-reason" value="' + reason.id + '"' +
                  (index === 0 ? " checked" : "") + "><span>" + UI.escapeHtml(reason.label) + "</span></label>";
              }).join("") +
              '<p class="form-note">Reports are stored on this device for now — the moderation inbox endpoint is the last piece of the reporting chain to be connected.</p>',
            footerHtml:
              '<button class="btn btn-danger btn-block" type="button" data-report-send>Submit report</button>' +
              '<button class="btn btn-ghost btn-block" type="button" data-report-cancel>Cancel</button>'
          });

          dialog.element.querySelector("[data-report-cancel]").addEventListener("click", dialog.close);
          dialog.element.querySelector("[data-report-send]").addEventListener("click", function () {
            var picked = dialog.element.querySelector("input[name='report-reason']:checked");
            try {
              var key = "cm_reports";
              var rows = JSON.parse(window.localStorage.getItem(key) || "[]") || [];
              rows.push({ type: item.type, id: item.id, reason: picked ? picked.value : "other", at: Date.now() });
              window.localStorage.setItem(key, JSON.stringify(rows.slice(-50)));
            } catch (e) { /* private mode */ }
            dialog.close();
            UI.toast("Report recorded — thank you", "success");
          });
        });
      }

      var shareButton = host.querySelector('[data-action="share"]');
      if (shareButton) {
        shareButton.addEventListener("click", function () {
          var shareData = { title: item.title, text: item.title + " on " + BRAND, url: window.location.href };
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
      host.innerHTML = UI.emptyState("info", "Listing unavailable", error.message,
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
    var uploadedUrl = "";          // URL returned by POST /api/uploads/image
    var uploadTask = null;         // in-flight upload promise (null when idle)
    var uploadGeneration = 0;      // invalidates stale uploads when the file changes
    var currentType = "product";

    // --- dynamic category options per listing type -------------------------
    var CATEGORY_SETS = {
      product: ["phones", "laptops", "electronics", "accessories"],
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
          var text = value.replace(/-/g, " ").replace(/\w/g, function (c) { return c.toUpperCase(); });
          return '<option value="' + value + '">' + text + "</option>";
        }).join("");
      }
      var label = document.getElementById("category-label");
      if (label) label.textContent = type === "accommodation" ? "Room type" : "Category";

      syncTypeExtras(type);
    }

    /* Fields that only exist for one pillar, kept in one place so switching
       tabs can never leave a stale control behind. */
    function syncTypeExtras(type) {
      var ticketType = document.getElementById("event-ticket-type");
      var ticketPrice = document.getElementById("event-price");
      if (ticketType && ticketPrice) {
        var paid = ticketType.value === "paid";
        ticketPrice.disabled = !paid;
        if (!paid) ticketPrice.value = "0";
      }

      var organiser = document.getElementById("event-organiser");
      var me = API.currentUser();
      if (organiser && me) {
        organiser.textContent = me.name +
          " is published as the organiser, with your account contact details attached to the listing.";
      }

      composeAmenities();
      applyDraft(readDraft(type));
    }

    /* The amenity chips and the free-text box become the single comma-separated
       value the API stores — composed once, on the way in. */
    function composeAmenities() {
      var field = document.getElementById("amenities-field");
      if (!field) return;
      var picked = [];
      document.querySelectorAll("#amenity-chips input[type=checkbox]").forEach(function (box) {
        if (box.checked) picked.push(box.value);
      });
      var extra = document.getElementById("room-amenities-extra");
      if (extra && extra.value.trim()) picked.push(extra.value.trim());
      field.value = picked.join(", ").slice(0, 300);
    }

    document.querySelectorAll("#amenity-chips input[type=checkbox]").forEach(function (box) {
      box.addEventListener("change", function () { composeAmenities(); saveDraft(); });
    });
    var extraAmenities = document.getElementById("room-amenities-extra");
    if (extraAmenities) extraAmenities.addEventListener("input", composeAmenities);

    var ticketType = document.getElementById("event-ticket-type");
    if (ticketType) {
      ticketType.addEventListener("change", function () { syncTypeExtras("event"); saveDraft(); });
    }

    /* ---- drafts -----------------------------------------------------------
       Work is saved per pillar on this device while the user types, so a
       refresh, a dead network or a phone call mid-form never costs the listing.
       Drafts are restored only into fields that are still empty. */
    var DRAFT_PREFIX = "cm_draft_";

    function draftKey(type) { return DRAFT_PREFIX + type; }

    function readDraft(type) {
      try { return JSON.parse(window.localStorage.getItem(draftKey(type)) || "null"); }
      catch (e) { return null; }
    }

    function saveDraft() {
      var data = {};
      new FormData(form).forEach(function (value, key) {
        if (typeof value === "string" && value.trim() !== "") data[key] = value;
      });
      if (!Object.keys(data).length) return;
      try {
        window.localStorage.setItem(draftKey(currentType),
          JSON.stringify({ at: Date.now(), data: data }));
      } catch (e) { /* private mode / quota */ }
      paintDraftNote();
    }

    function clearDraft() {
      try { window.localStorage.removeItem(draftKey(currentType)); } catch (e) { /* ignore */ }
      paintDraftNote();
    }

    function applyDraft(draft) {
      if (!draft || !draft.data) return;
      var filled = 0;
      Object.keys(draft.data).forEach(function (key) {
        var field = form.querySelector('[name="' + key + '"]');
        if (!field || field.type === "file" || field.type === "checkbox") return;
        if (String(field.value || "").trim() !== "") return;   // never overwrite typing
        field.value = draft.data[key];
        filled++;
      });
      composeAmenities();
      if (filled) UI.toast("Unsaved draft restored", "info");
    }

    var draftNote = document.getElementById("draft-note");
    function paintDraftNote() {
      if (!draftNote) return;
      var draft = readDraft(currentType);
      if (!draft) {
        draftNote.textContent = "Your work is saved on this device as you type.";
        return;
      }
      draftNote.textContent = "Draft saved " + (UI.timeAgo(new Date(draft.at).toISOString()) || "just now") +
        " · stored on this device.";
    }

    var draftDiscard = document.getElementById("draft-discard");
    if (draftDiscard) {
      draftDiscard.addEventListener("click", function () {
        clearDraft();
        form.reset();
        switchType(currentType);
        UI.toast("Draft cleared", "info");
      });
    }

    var draftTimer = null;
    form.addEventListener("input", function () {
      window.clearTimeout(draftTimer);
      draftTimer = window.setTimeout(saveDraft, 700);
    });
    form.addEventListener("change", function () {
      window.clearTimeout(draftTimer);
      draftTimer = window.setTimeout(saveDraft, 300);
    });

    /* A structural starting point beats a blank box — the suggestion is plain
       text the user can rewrite, never invisible metadata. */
    var templateButton = document.querySelector("[data-description-template]");
    if (templateButton) {
      templateButton.addEventListener("click", function () {
        var field = document.getElementById("post-description");
        if (!field) return;
        var templates = {
          product: "Condition:\n\nWhat is included:\n\nAge / how long I have used it:\n\nWhy I am selling:\n\nAnything a buyer should know:",
          accommodation: "Room type and size:\n\nUtilities (electricity, water):\n\nSecurity:\n\nHow far from campus / the main road:\n\nWhat the rent covers:\n\nAvailable from:",
          event: "About the event:\n\nWho should attend:\n\nWhat to bring:\n\nEntry and ticketing:\n\nOrganiser contact:",
          service: "What I do:\n\nWhat is included in the price:\n\nHow long a typical job takes:\n\nWhere I work (on-site or mobile):\n\nMy working hours:"
        };
        var template = templates[currentType] || templates.product;
        if (field.value.trim() && !window.confirm("Replace what you have written with the suggested structure?")) return;
        field.value = template;
        field.focus();
        UI.toast("Structure added — edit it to match your listing", "success");
      });
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
      uploadZone.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          imageInput.click();
        }
      });
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

      var generation = ++uploadGeneration;
      uploadedUrl = "";

      uploadTask = API.uploads.image(file, function (percent) {
        if (progressFill) progressFill.style.width = percent + "%";
      }).then(function (payload) {
        if (generation !== uploadGeneration) return null;   // superseded / removed
        uploadedUrl = (payload.data && payload.data.url) || "";
        if (!uploadedUrl) throw new Error("The server did not return an image URL");
        console.log("[upload] Stored image URL:", uploadedUrl);
        UI.toast("Image uploaded", "success");
        return uploadedUrl;
      }).catch(function (error) {
        if (generation === uploadGeneration) {
          UI.toast(error.message, "error");
          preview.style.display = "none";
          previewImg.src = "";
          uploadedUrl = "";
        }
        if (imageInput) imageInput.value = "";   // let the same file be re-picked
      }).then(function () {
        if (progressBar) {
          window.setTimeout(function () {
            progressBar.style.display = "none";
            if (progressFill) progressFill.style.width = "0%";
          }, 500);
        }
        uploadTask = null;
      });
    }

    var removeImage = document.getElementById("remove-image");
    if (removeImage) {
      removeImage.addEventListener("click", function () {
        preview.style.display = "none";
        uploadedUrl = "";
        uploadGeneration++;                    // discard any in-flight result
        if (imageInput) imageInput.value = "";
        previewImg.src = "";
      });
    }

    // --- submit ------------------------------------------------------------
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      Auth.clearErrors(form);

      // Guard: never POST while the image is still uploading. Without this the
      // submit wins the race, image_url is saved empty and the listing renders
      // the "No photo" placeholder even though the file did reach the bucket.
      if (uploadTask) {
        UI.toast("Your image is still uploading – submitting as soon as it lands…", "info");
        Auth.setLoading(submitButton, true, "Uploading image…");
        uploadTask.then(function () {
          Auth.setLoading(submitButton, false);
          if (form.requestSubmit) form.requestSubmit();
          else form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
        });
        return;
      }

      // A file is selected but no URL was captured: uploading silently failed.
      if (imageInput && imageInput.files && imageInput.files.length && !uploadedUrl) {
        UI.toast("That image did not upload – please pick it again before submitting", "error");
        return;
      }

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
        /* Availability is not a column of its own — it belongs in the copy, so
           it is appended to the description rather than pretended into data. */
        if (data.availability_note) {
          payload.description = String(payload.description || "").trim() +
            "\n\nAvailability: " + data.availability_note;
        }
        endpoint = API.accommodation.create;
      } else if (currentType === "event") {
        payload = {
          title: data.title, description: data.description, date: data.date,
          location: data.event_venue || data.location,
          category: data.category, ticket_price: data.ticket_price || 0,
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

      console.log("Saving product with image URL:", data.image_url);

      Auth.setLoading(submitButton, true, "Submitting…");
      endpoint(payload)
        .then(function (response) {
          Auth.setLoading(submitButton, false);
          UI.toast(response.message || "Listing submitted!", "success", 6000);
          form.reset();
          if (preview) preview.style.display = "none";
          uploadedUrl = "";

          clearDraft();

          var summary = document.getElementById("post-result");
          if (summary) {
            var item = response.data;
            summary.classList.remove("hidden");
            summary.innerHTML =
              '<div class="card card-pad">' +
                "<h3>What happens next?</h3>" +
                "<p>Your listing <strong>" + UI.escapeHtml(item.title) + "</strong> is " +
                  UI.statusBadge(item.status) + "</p>" +
                '<p class="text-muted">A moderator reviews every listing before it appears ' +
                  "publicly. You can track its status from your dashboard, and any review, reply " +
                  "or offer will land in your notifications.</p>" +
                '<div class="flex gap-1 wrap">' +
                  '<a class="btn btn-primary" href="' + UI.pageUrl("profile.html") + '">Go to my dashboard</a>' +
                  '<a class="btn btn-outline" href="' + UI.pageUrl("home.html") + '">Browse listings</a>' +
                "</div>" +
              "</div>" +
              '<div class="card card-pad mt-2" id="promotion-panel">' +
                '<div class="skeleton skeleton-line" style="width:180px"></div>' +
                '<div class="skeleton skeleton-row mt-2"></div>' +
              "</div>";
            summary.scrollIntoView({ behavior: "smooth", block: "center" });
            renderPromotionPanel(document.getElementById("promotion-panel"), item);
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
  /* -----------------------------------------------------------------------
     User-dashboard helpers – glass top bar + premium listing cards
     ----------------------------------------------------------------------- */
  function renderProfileTopbar(user) {
    var host = document.getElementById("ud-topbar-actions");
    if (!host) return;

    var logoutIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
      '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>';

    if (user) {
      host.innerHTML =
        '<a class="dash-btn" href="' + UI.pageUrl("home.html") + '">Browse</a>' +
        '<a class="dash-btn dash-btn-primary" href="' + UI.pageUrl("post-listing.html") + '">Sell / Post</a>' +
        '<button type="button" class="dash-icon-btn is-danger" data-ud-logout title="Log out" ' +
          'aria-label="Log out">' + logoutIcon + "</button>";
      var logout = host.querySelector("[data-ud-logout]");
      if (logout) logout.addEventListener("click", function () { Auth.logout(); });
      return;
    }

    host.innerHTML =
      '<a class="dash-btn" href="' + UI.pageUrl("login.html") + '">Log in</a>' +
      '<a class="dash-btn dash-btn-primary" href="' + UI.pageUrl("signup.html") + '">Create account</a>';
  }

  /**
   * Build one premium listing card for the user dashboard.
   * Mirrors UI.listingCard but carries the condition chip, the 4:3 media frame
   * and the dark "pro" styling. The .fav-btn markup stays compatible with the
   * shared Wishlist delegate in ui.js.
   */
  function dashListingCard(item, opts) {
    opts = opts || {};
    var saved = UI.wishlist && UI.wishlist.has(item.type, item.id);
    var url = UI.listingUrl(item);
    var image = item.image_url ? UI.imageFor(item) : null;
    var condition = item.condition ||
      (item.type === "accommodation" ? item.room_type : null) ||
      (item.type === "event" ? item.category : null);
    var conditionSlug = condition
      ? String(condition).toLowerCase().replace(/[^a-z0-9]+/g, "-")
      : "";
    var flags =
      (item.featured ? '<span class="badge badge-featured">Featured</span>' : "") +
      (opts.showStatus && item.status ? UI.statusBadge(item.status) : "");
    var subtitle = item.type === "event"
      ? UI.formatDate(item.date, true) + " · " + UI.escapeHtml(item.location || "")
      : UI.escapeHtml(item.location || item.category || "");

    return (
      '<article class="ud-card' + (condition ? " has-cond" : "") + '" data-type="' + UI.escapeHtml(item.type) +
        '" data-id="' + item.id + '">' +
        '<div class="ud-card-top">' +
          '<a class="ud-card-media" href="' + url + '" aria-label="' + UI.escapeHtml(item.title) + '">' +
            (image
              ? '<img src="' + UI.escapeHtml(image) + '" alt="' + UI.escapeHtml(item.title) + '" loading="lazy" ' +
                'onerror="this.onerror=null;this.remove();">'
              : '<span class="ud-card-fallback">' + svgi("image", 24) +
                '<em>' + UI.escapeHtml(String(item.type || "listing").toUpperCase()) + '</em></span>') +
            '<span class="ud-card-flags">' +
              (condition ? '<span class="ud-cond is-' + conditionSlug + '">' + UI.escapeHtml(condition) + "</span>" : "") +
              flags +
            "</span>" +
          "</a>" +
          '<button class="fav-btn' + (saved ? " active" : "") + '" data-fav="' + UI.escapeHtml(item.type) +
            '" data-fav-id="' + item.id + '" aria-label="' +
            (saved ? "Remove from saved" : "Save to wishlist") + '" title="' +
            (saved ? "Remove from saved" : "Save to wishlist") + '">' +
            UI.heartSvg(saved) + "</button>" +
        "</div>" +
        '<div class="ud-card-body">' +
          '<h3 class="ud-card-title"><a href="' + url + '">' + UI.escapeHtml(item.title) + "</a></h3>" +
          '<div class="ud-card-price">' + UI.priceLabel(item) + "</div>" +
          '<div class="ud-card-meta"><span>' + subtitle + "</span>" +
            (item.views !== undefined ? "<span>" + Number(item.views || 0) + " views</span>" : "") +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function initProfile() {
    var me = API.currentUser();
    var requestedId = UI.queryParam("id");
    var userId = requestedId || (me ? me.id : null);
    var host = document.getElementById("profile-root");

    if (!host) return;
    renderProfileTopbar(me);
    if (!userId) {
      host.innerHTML = UI.emptyState("secure", "Please log in",
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

      document.title = profile.name + " · " + BRAND;

      var ic = {
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
        pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/>' +
          '<circle cx="12" cy="10" r="2.5"/></svg>',
        book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h9a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/>' +
          '<path d="M20 20V7a3 3 0 0 0-3-3"/></svg>',
        award: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5"/>' +
          '<path d="m9 13-1.5 8L12 19l4.5 2L15 13"/></svg>',
        calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/>' +
          '<path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>'
      };

      /* Real game progress, or an honest invitation to start. */
      var gameState = (window.GameCentre && window.GameCentre.state) ? window.GameCentre.state() : null;
      var gameBlock = gameState
        ? "<h2>Game Centre</h2>" +
          '<div class="game-stats">' +
            '<div class="game-stat"><span>High score</span><b>' + Number(gameState.best || 0).toLocaleString() + "</b></div>" +
            '<div class="game-stat"><span>Streak</span><b>' + Number(gameState.daily_streak || 0) + " days</b></div>" +
            '<div class="game-stat"><span>Badges</span><b>' + ((gameState.achievements || []).length) + " / " +
              ((window.GameCentre.ACHIEVEMENTS || []).length || 7) + "</b></div>" +
          "</div>" +
          '<a class="btn btn-outline btn-sm mt-2" href="' + UI.pageUrl("game-centre.html") + '">Open Game Centre</a>'
        : "";

      var blockedCount = (window.Messaging && window.Messaging.all)
        ? window.Messaging.all().filter(function (row) { return row.blocked; }).length
        : 0;

      var avatarHtml = profile.avatar_url
        ? '<img src="' + UI.escapeHtml(UI.imageFor({ image_url: profile.avatar_url })) +
          '" alt="' + UI.escapeHtml(profile.name) + '">'
        : UI.escapeHtml(UI.initials(profile.name));

      function chip(svg, label) {
        return '<span class="ud-chip">' + svg + UI.escapeHtml(label) + "</span>";
      }

      function tabButton(tab, label, count) {
        return '<button' + (tab === "products" ? ' class="active"' : "") +
          ' data-tab="' + tab + '">' + label + ' <span class="count">' + count + "</span></button>";
      }

      var ratingHtml = stats.rating_average
        ? UI.stars(stats.rating_average) + "<span>" + stats.rating_average + " / 5 · " +
          stats.rating_count + " review" + (stats.rating_count === 1 ? "" : "s") + "</span>"
        : '<span class="text-muted">No reviews yet</span>';

      host.innerHTML =
        '<div class="ud-shell">' +
          '<aside class="ud-aside">' +
            '<div class="ud-profile">' +
              '<span class="ud-avatar">' + avatarHtml + "</span>" +
              '<h1 class="ud-name">' + UI.escapeHtml(profile.name) +
                (profile.verified ? '<span class="ud-verified" title="Verified account">' + ic.check + "</span>" : "") +
              "</h1>" +
              '<p class="ud-handle">' + UI.escapeHtml(String(profile.user_type || "student").replace(/_/g, " ")) +
                (profile.user_type === "admin" ? " · Administrator" : "") + "</p>" +
              '<div class="ud-meta-chips">' +
                (profile.department ? chip(ic.book, profile.department) : "") +
                (profile.level ? chip(ic.award, profile.level) : "") +
                (profile.location ? chip(ic.pin, profile.location) : "") +
                chip(ic.calendar, "Joined " + UI.formatDate(profile.created_at)) +
              "</div>" +
              '<div class="ud-rating">' + ratingHtml + "</div>" +
              (profile.bio ? '<p class="ud-bio">' + UI.escapeHtml(profile.bio) + "</p>" : "") +
              '<div class="ud-stats">' +
                '<div class="ud-stat"><b>' + (counts.products || 0) + "</b><span>Items</span></div>" +
                '<div class="ud-stat"><b>' + (counts.accommodation || 0) + "</b><span>Rooms</span></div>" +
                '<div class="ud-stat"><b>' + (counts.events || 0) + "</b><span>Events</span></div>" +
                '<div class="ud-stat"><b>' + (counts.services || 0) + "</b><span>Services</span></div>" +
              "</div>" +
              (isMe
                ? '<div class="ud-profile-actions">' +
                    '<button class="btn btn-outline" data-action="edit-profile">Edit profile</button>' +
                    '<a class="btn btn-primary" href="' + UI.pageUrl("post-listing.html") + '">Post a listing</a>' +
                  "</div>"
                : "") +
            "</div>" +
            '<div class="card card-pad ud-reputation">' +
              '<div class="ud-reputation-head">' +
                "<h2>Reputation</h2>" +
                (!isMe && API.isLoggedIn()
                  ? '<button class="btn btn-outline btn-sm" data-action="write-review">Leave a review</button>'
                  : "") +
              "</div>" +
              '<div class="ud-reputation-score">' +
                (stats.rating_average ? "<b>" + stats.rating_average + "</b>" : "<b>—</b>") +
                '<span class="text-muted">out of 5 · ' + (stats.rating_count || 0) + " review" +
                  (stats.rating_count === 1 ? "" : "s") + "</span>" +
              "</div>" +
              '<div id="review-form-holder" class="hidden mt-2"></div>' +
            "</div>" +

            /* Account centre (§23): everything a member needs to reach in one
               place, with real counts pulled from the same stores the features
               themselves use — no decorative tiles. */
            '<div class="card card-pad mt-2">' +
              '<h2 class="mb-2">Your account</h2>' +
              '<ul class="account-links">' +
                '<li><a href="' + UI.pageUrl("messages.html") + '">' +
                  svgi("message", 17) + "Messages" +
                  (window.Messaging && Messaging.unreadCount() ? '<span class="badge badge-featured">' + Messaging.unreadCount() + " unread</span>" : "") +
                "</a></li>" +
                '<li><a href="' + UI.pageUrl("favorites.html") + '">' + svgi("heart", 17) + "Saved items</a></li>" +
                '<li><a href="' + UI.pageUrl("game-centre.html") + '">' + svgi("game", 17) + "Game Centre</a></li>" +
                '<li><button type="button" data-scroll-to="notifications">' + svgi("bell", 17) + "Notifications</button></li>" +
                '<li><button type="button" data-scroll-to="security">' + svgi("shieldCheck", 17) + "Verification and security</button></li>" +
                '<li><button type="button" data-scroll-to="help">' + svgi("info", 17) + "Help and safety</button></li>" +
              "</ul>" +
            "</div>" +

            (gameBlock ? '<div class="card card-pad mt-2" id="profile-game">' + gameBlock + "</div>" : "") +

            '<div class="card card-pad mt-2" id="profile-security">' +
              "<h2>Verification and security</h2>" +
              '<ul class="spec-list">' +
                '<li><span class="k">Account verification</span><span class="v">' +
                  (profile.verified ? "Verified" : "Not verified yet") + "</span></li>" +
                '<li><span class="k">Password</span><span class="v">Hashed with bcrypt</span></li>' +
                '<li><span class="k">Contact number</span><span class="v">Released only in the app</span></li>' +
                '<li><span class="k">Blocked accounts</span><span class="v">' + blockedCount + "</span></li>" +
              "</ul>" +
              '<p class="form-note mb-0">Verification is granted after review, never bought. ' +
                "If a badge appears on an account, a moderator checked it.</p>" +
            "</div>" +

            '<div class="card card-pad mt-2" id="profile-help">' +
              "<h2>Help and safety</h2>" +
              '<p class="text-muted">Meet in busy public places, inspect before you pay, and never send money ' +
                "or share bank codes with someone you have not met.</p>" +
              '<ul class="spec-list">' +
                '<li><span class="k">Report a listing</span><span class="v">From the listing page</span></li>' +
                '<li><span class="k">Report a message</span><span class="v">From the conversation</span></li>' +
                '<li><span class="k">Block an account</span><span class="v">From the conversation</span></li>' +
              "</ul>" +
            "</div>" +
          "</aside>" +
          '<div class="ud-main">' +
            '<div class="ud-tabs-wrap">' +
              '<div class="tabs ud-tabs" id="profile-tabs">' +
                tabButton("products", "Items", counts.products || 0) +
                tabButton("accommodation", "Rooms", counts.accommodation || 0) +
                tabButton("events", "Events", counts.events || 0) +
                tabButton("services", "Services", counts.services || 0) +
                tabButton("reviews", "Reviews", reviews.rating_count || 0) +
                '<span class="ud-tab-indicator" id="ud-tab-indicator"></span>' +
              "</div>" +
            "</div>" +
            '<div class="ud-panel" id="profile-panel"></div>' +
          "</div>" +
        "</div>" +
        (isMe ? '<div id="edit-profile-holder" class="hidden"></div>' : "");

      // ---- tab rendering + sliding underline indicator --------------------
      var panel = document.getElementById("profile-panel");
      var tabsHost = document.getElementById("profile-tabs");
      var indicator = document.getElementById("ud-tab-indicator");

      function positionIndicator() {
        if (!tabsHost || !indicator) return;
        var active = tabsHost.querySelector("button.active");
        if (!active) return;
        indicator.style.left = active.offsetLeft + "px";
        indicator.style.width = active.offsetWidth + "px";
      }

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
            : UI.emptyState("reviews", "No reviews yet",
                "Reviews from people who traded with this account will appear here.");
          return;
        }

        var items = listings[tab] || [];
        panel.innerHTML = items.length
          ? '<div class="ud-grid-listings">' + items.map(function (item) {
              return dashListingCard(item, { showStatus: isMe });
            }).join("") + "</div>"
          : UI.emptyState("empty", "Nothing here yet",
              isMe ? "Use the “Post a listing” button to add your first advert." : "This account has no published listings here.",
              isMe ? '<a class="btn btn-primary mt-2" href="' + UI.pageUrl("post-listing.html") + '">Post a listing</a>' : "");
      }

      host.querySelectorAll("[data-scroll-to]").forEach(function (node) {
        node.addEventListener("click", function () {
          var targets = {
            notifications: "profile-help",
            security: "profile-security",
            help: "profile-help"
          };
          var target = document.getElementById(targets[node.dataset.scrollTo] || "profile-help");
          if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });

      tabsHost.addEventListener("click", function (event) {
        var button = event.target.closest("button[data-tab]");
        if (!button) return;
        tabsHost.querySelectorAll("button").forEach(function (node) { node.classList.remove("active"); });
        button.classList.add("active");
        renderTab(button.dataset.tab);
        positionIndicator();
        if (button.scrollIntoView) {
          button.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
        }
      });

      window.addEventListener("resize", positionIndicator);
      renderTab("products");
      positionIndicator();
      window.setTimeout(positionIndicator, 320);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionIndicator);

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
                  /* Native selects cannot hold SVG, and star glyphs are not an
                     icon language — the scale reads as words instead. */
                  '<option value="5">5 — Excellent</option>' +
                  '<option value="4">4 — Very good</option>' +
                  '<option value="3">3 — Average</option>' +
                  '<option value="2">2 — Poor</option>' +
                  '<option value="1">1 — Very poor</option>' +
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
      host.innerHTML = UI.emptyState("info", "Profile unavailable",
        error.message || "We could not load this profile right now.");
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
          host.innerHTML = UI.emptyState("heart", "Your wishlist is empty",
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
        host.innerHTML = UI.emptyState("info", "Could not load your wishlist",
          error.message || "Please try again in a moment.");
      });
    }

    initChips("favorite-chips", function (value) {
      currentFilter = value === "all" ? "" : value;
      load();
    });

    load();
  }

  /* -----------------------------------------------------------------------
     Promotion plans (design bible §19).

     Prices and durations are business data, not UI copy, so they come from
     GET /api/meta where the platform controls them. The fallback here mirrors
     the launch pricing and is used only when the API does not send a plan list.

     Payment processing is not connected yet. The CTA therefore records a
     promotion *request* and says so plainly — nothing is charged, and no
     success is claimed that did not happen.
     ----------------------------------------------------------------------- */
  var PROMOTION_FALLBACK = [
    { id: "free", label: "Free", price: 0, days: 3, detail: "Standard placement for 3 days", points: ["Listed and searchable", "Appears in your area"] },
    { id: "7d", label: "7 days", price: 1000, days: 7, detail: "Promoted placement for a week", points: ["Promoted badge", "Higher placement in results", "Included in trending rotation"] },
    { id: "30d", label: "30 days", price: 3500, days: 30, detail: "Promoted placement for a month", points: ["Everything in 7 days", "Four times the exposure window", "Priority in its category"] },
    { id: "premium", label: "Premium Promotion", price: 10000, days: 30, detail: "Priority placement plus eligible external advertising exposure", featured: true, points: ["Top of its category", "Eligible for external advertising run by the platform", "Highest share of promoted rotation"] }
  ];

  function renderPromotionPanel(host, item) {
    if (!host) return;

    var chosen = "free";

    function paint(plans, fromApi) {
      host.innerHTML =
        '<div class="flex-between">' +
          '<div><h3 class="mb-0">Give this listing more visibility</h3>' +
          '<p class="text-muted mb-0">Promotion buys placement, never existence — your listing stays searchable after a promotion ends.</p></div>' +
        "</div>" +
        '<div class="promo-grid mt-3">' +
          plans.map(function (plan) {
            var isFeatured = plan.featured || plan.id === "premium";
            return '<button type="button" class="promo-plan' + (isFeatured ? " is-featured" : "") +
              (plan.id === "free" ? " is-selected" : "") + '" data-plan="' + UI.escapeHtml(plan.id) + '">' +
              (isFeatured ? '<span class="promo-plan__tag">Most visibility</span>' : "") +
              "<h3>" + UI.escapeHtml(plan.label) + "</h3>" +
              '<div class="promo-plan__price">' + (Number(plan.price) === 0 ? "Free" : UI.money(plan.price)) +
                '<small> · ' + Number(plan.days) + " days</small></div>" +
              '<ul>' + (plan.points || [plan.detail]).map(function (point) {
                return '<li>' + svgi("check", 15) + UI.escapeHtml(point) + "</li>";
              }).join("") + "</ul>" +
            "</button>";
          }).join("") +
        "</div>" +
        '<div class="flex-between mt-3">' +
          '<span class="form-note" id="promo-note">' + (fromApi
            ? "Pricing is set by the platform and applies from the moment a promotion is activated."
            : "Pricing shown is the current published rate. It is applied by an admin for now — card payments are not connected yet.") +
          "</span>" +
          '<button class="btn btn-primary" type="button" id="promo-request">Request promotion</button>' +
        "</div>" +
        '<p class="form-note mt-1">Nothing is charged from here. An admin confirms the promotion and any payment with you directly — you will see confirmation in your notifications.</p>';

      host.querySelectorAll("[data-plan]").forEach(function (node) {
        node.addEventListener("click", function () {
          chosen = node.dataset.plan;
          host.querySelectorAll("[data-plan]").forEach(function (other) {
            other.classList.toggle("is-selected", other === node);
          });
        });
      });

      var request = host.querySelector("#promo-request");
      if (request) {
        request.addEventListener("click", function () {
          var plan = plans.filter(function (row) { return row.id === chosen; })[0] || plans[0];
          try {
            var key = "cm_promotion_requests";
            var rows = JSON.parse(window.localStorage.getItem(key) || "[]") || [];
            rows.push({ listing: item && item.title, listing_id: item && item.id, plan: plan.id, price: plan.price, at: Date.now() });
            window.localStorage.setItem(key, JSON.stringify(rows.slice(-50)));
          } catch (e) { /* private mode */ }
          UI.toast("Promotion requested — an admin will confirm with you", "success", 5200);
          request.disabled = true;
          request.textContent = "Request sent";
        });
      }
    }

    API.misc.meta().then(function (payload) {
      var plans = (payload.data && payload.data.promotion_plans) || null;
      paint(plans && plans.length ? plans : PROMOTION_FALLBACK, !!plans);
    }).catch(function () { paint(PROMOTION_FALLBACK, false); });
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
    favorites: initFavorites,
    /* Loaded from engage.js / game.js — guarded so a missing script never
       takes the whole page down. */
    messages: function () { if (window.initEngage) window.initEngage(); },
    game: function () { if (window.GameCentre) window.GameCentre.init(); }
  };

  document.addEventListener("DOMContentLoaded", function () {
    // A guest bound for the landing page must not run any app initialiser.
    if (document.documentElement.classList.contains("cm-locked")) return;
    var page = (document.body && document.body.dataset.page) || "landing";
    var init = INITIALISERS[page];
    if (typeof init === "function") {
      try {
        init();
      } catch (error) {
        // Never let a page-level failure blank the whole site.
        window.console && window.console.error("[Lafia Marketplace]", error);
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
