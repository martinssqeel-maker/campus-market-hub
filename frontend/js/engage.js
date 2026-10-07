/* ==========================================================================
   engage.js — in-app messaging (lafia.marketplace)

   The design bible makes buyer/seller conversation a core surface: a
   conversation list, listing context at the top of each thread, quick message
   actions and a conversational Make an Offer flow.

   INTEGRATION BOUNDARY
   --------------------
   The backend currently exposes no messaging or offer endpoints, so this module
   is deliberately split in two halves:

     • the *model* (threads, messages, offers, unread state, block/report flags)
       lives in `Messaging` behind a promise-based API that mirrors the shape a
       REST client would have;
     • the *store* is `localStorage`, keyed per account.

   Nothing here pretends to be server-delivered: threads are created only from
   real listing/seller data the user actually acted on, and the composer states
   plainly that the thread is stored on this device. Swapping the store for a
   network client later means replacing `readAll`/`writeAll` and the four
   `api*` methods — no page code changes.

   Exposed globally as `Messaging`.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var KEY = "cm_threads";
  var MAX_MESSAGES = 400;

  /* MD §13 — natural, non-robotic shortcuts. Editable before sending. */
  var QUICK_ACTIONS = [
    { id: "available", label: "Is this available?", text: "Good day — is this still available?" },
    { id: "lastprice", label: "What's your last price?", text: "What is your last price for this?" },
    { id: "inspect", label: "Can I inspect it?", text: "Can I come and inspect it before I decide?" },
    { id: "where", label: "Where are you located?", text: "Where exactly are you located?" },
    { id: "deliver", label: "Can you deliver?", text: "Can you deliver it, and how much would that cost?" },
    { id: "offer", label: "Make an offer", offer: true }
  ];

  /* ----------------------------------------------------------------------- */
  function currentUserKey() {
    var user = window.API && window.API.currentUser ? window.API.currentUser() : null;
    return (user && user.id) ? "u" + user.id : "anon";
  }

  function storageKey() { return KEY + ":" + currentUserKey(); }

  function readAll() {
    try {
      var raw = window.localStorage.getItem(storageKey());
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function writeAll(threads) {
    try { window.localStorage.setItem(storageKey(), JSON.stringify(threads.slice(0, 60))); }
    catch (e) { /* private mode / quota — the UI keeps working for this session */ }
    try { window.dispatchEvent(new CustomEvent("cm:messages")); } catch (e) { /* older engines */ }
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function personOf(listing) {
    var owner = listing && (listing.seller || listing.landlord || listing.creator || listing.provider);
    return owner ? { id: owner.id, name: owner.name, verified: !!owner.verified } : { id: null, name: "Listing owner" };
  }

  function listingMeta(listing) {
    return {
      type: listing.type || "product",
      id: listing.id,
      title: listing.title || "Listing",
      price: listing.price !== undefined ? listing.price : listing.ticket_price,
      image_url: listing.image_url || null,
      location: listing.location || ""
    };
  }

  /* ----------------------------------------------------------------------- */
  var Messaging = {
    quickActions: QUICK_ACTIONS,

    all: function () {
      return readAll().sort(function (a, b) { return (b.updated_at || 0) - (a.updated_at || 0); });
    },

    get: function (id) {
      return readAll().filter(function (row) { return row.id === id; })[0] || null;
    },

    unreadCount: function () {
      return readAll().reduce(function (total, row) {
        return total + (row.archived ? 0 : Number(row.unread || 0));
      }, 0);
    },

    /**
     * Open (or create) the conversation about a listing. Called from the
     * listing detail page and from "Message" buttons anywhere in the app.
     */
    openThread: function (listing) {
      if (!listing || listing.id === undefined) return null;
      var threads = readAll();
      var existing = threads.filter(function (row) {
        return row.listing && Number(row.listing.id) === Number(listing.id) &&
          row.listing.type === (listing.type || "product");
      })[0];
      if (existing) return existing.id;

      var thread = {
        id: uid("th"),
        listing: listingMeta(listing),
        person: personOf(listing),
        messages: [],
        unread: 0,
        archived: false,
        blocked: false,
        created_at: Date.now(),
        updated_at: Date.now()
      };
      threads.unshift(thread);
      writeAll(threads);
      return thread.id;
    },

    /** Append a message. `opts.offer` turns it into an offer bubble. */
    send: function (threadId, text, opts) {
      opts = opts || {};
      var body = String(text || "").trim();
      if (!body && opts.offer === undefined) return null;

      var threads = readAll();
      var thread = threads.filter(function (row) { return row.id === threadId; })[0];
      if (!thread) return null;

      var message = {
        id: uid("m"),
        mine: true,
        text: body,
        at: Date.now()
      };
      if (opts.offer !== undefined && opts.offer !== null && opts.offer !== "") {
        message.offer = Number(opts.offer) || 0;
        if (!message.text) message.text = "I will buy it at this price.";
      }

      thread.messages = (thread.messages || []).concat([message]).slice(-MAX_MESSAGES);
      thread.updated_at = Date.now();
      writeAll(threads);
      return message;
    },

    markRead: function (threadId) {
      var threads = readAll();
      threads.forEach(function (row) {
        if (row.id === threadId) { row.unread = 0; row.updated_at = row.updated_at || Date.now(); }
      });
      writeAll(threads);
    },

    archive: function (threadId, archived) {
      var threads = readAll();
      threads.forEach(function (row) { if (row.id === threadId) row.archived = archived !== false; });
      writeAll(threads);
    },

    block: function (threadId, blocked) {
      var threads = readAll();
      threads.forEach(function (row) { if (row.id === threadId) row.blocked = blocked !== false; });
      writeAll(threads);
    },

    remove: function (threadId) {
      writeAll(readAll().filter(function (row) { return row.id !== threadId; }));
    },

    /* ---- Store boundary: swap these four for network calls later --------- */
    apiList: function () { return Promise.resolve({ data: { threads: Messaging.all() } }); },
    apiSend: function (threadId, text, opts) {
      var message = Messaging.send(threadId, text, opts);
      return message
        ? Promise.resolve({ data: { message: message } })
        : Promise.reject(new Error("That conversation is no longer available"));
    },
    apiArchive: function (threadId, archived) {
      Messaging.archive(threadId, archived);
      return Promise.resolve({ data: { archived: archived !== false } });
    },
    apiRemove: function (threadId) {
      Messaging.remove(threadId);
      return Promise.resolve({ data: { removed: true } });
    }
  };

  /* =======================================================================
     PAGE RENDERER — pages/messages.html
     ======================================================================= */
  function initMessages() {
    var shell = document.getElementById("msg-shell");
    var listHost = document.getElementById("msg-list");
    var paneHost = document.getElementById("msg-pane");
    var countHost = document.getElementById("msg-count");
    if (!shell || !listHost || !paneHost) return;

    if (!window.Auth || !Auth.requireLogin || !Auth.requireLogin("Please log in to see your messages")) return;

    var activeId = null;
    var filter = "all";

    function render() {
      var threads = Messaging.all().filter(function (row) {
        if (filter === "unread") return Number(row.unread || 0) > 0;
        if (filter === "archived") return !!row.archived;
        return !row.archived;
      });

      if (countHost) {
        countHost.textContent = threads.length
          ? threads.length + (threads.length === 1 ? " conversation" : " conversations")
          : "No conversations";
      }

      if (!threads.length) {
        listHost.innerHTML = UI.emptyState(
          "message",
          filter === "archived" ? "Nothing archived" : "No conversations yet",
          filter === "unread"
            ? "You have read every reply. New messages will show here."
            : "When you message a seller or make an offer, the conversation will be listed here.",
          '<a class="btn btn-primary mt-2" href="' + UI.pageUrl("home.html") + '">Browse listings</a>'
        ).replace('class="empty-state"', 'class="empty-state" style="padding:var(--sp-6) var(--sp-4)"');
        renderPane(null);
        return;
      }

      if (!activeId || !threads.some(function (row) { return row.id === activeId; })) {
        activeId = threads[0].id;
      }

      listHost.innerHTML = threads.map(function (row) {
        var last = (row.messages || [])[row.messages.length - 1];
        var preview = last
          ? (last.offer !== undefined ? "Offer: " + UI.money(last.offer) : last.text)
          : "No messages yet — start the conversation";
        return '<button type="button" class="msg-thread__row' + (row.id === activeId ? " is-active" : "") +
          '" data-thread="' + UI.escapeHtml(row.id) + '">' +
          '<span class="msg-thread__avatar">' + UI.escapeHtml(UI.initials(row.person && row.person.name)) + "</span>" +
          "<span>" +
            '<span class="msg-thread__name">' + UI.escapeHtml((row.person && row.person.name) || "Listing owner") +
              (row.person && row.person.verified ? '<span class="badge badge-verified">Verified</span>' : "") +
            "</span>" +
            '<span class="msg-thread__last">' + UI.escapeHtml(String(preview).slice(0, 90)) + "</span>" +
          "</span>" +
          '<span class="msg-thread__side">' +
            '<span class="msg-thread__time">' + UI.timeAgo(last ? new Date(last.at).toISOString() : null) + "</span>" +
            (Number(row.unread || 0) > 0 ? '<span class="msg-unread">' + row.unread + "</span>" : "") +
          "</span>" +
        "</button>";
      }).join("");

      listHost.querySelectorAll("[data-thread]").forEach(function (node) {
        node.addEventListener("click", function () {
          activeId = node.dataset.thread;
          Messaging.markRead(activeId);
          shell.dataset.view = "thread";
          render();
        });
      });

      renderPane(Messaging.get(activeId));
    }

    function renderPane(thread) {
      if (!thread) {
        paneHost.innerHTML =
          '<div class="empty-state" style="border:0;background:transparent">' +
            '<span class="empty-mark" aria-hidden="true">' + Shell.icon("message", 22) + "</span>" +
            "<h3>Select a conversation</h3>" +
            "<p>Listing details, prices and quick replies appear here.</p>" +
          "</div>";
        return;
      }

      var listing = thread.listing || {};
      var image = UI.imageFor({ image_url: listing.image_url });
      var stream = (thread.messages || []).map(function (message) {
        var cls = "msg-bubble" + (message.mine ? " is-me" : "") + (message.offer !== undefined ? " is-offer" : "");
        return '<div class="' + cls + '">' +
          (message.offer !== undefined
            ? '<div class="msg-bubble__offer">' + UI.money(message.offer) + "</div>"
            : "") +
          (message.text ? "<div>" + UI.escapeHtml(message.text) + "</div>" : "") +
          "<time>" + UI.escapeHtml(new Date(message.at).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) + "</time>" +
        "</div>";
      }).join("");

      paneHost.innerHTML =
        '<div class="msg-pane__head">' +
          '<button type="button" class="icon-btn" data-msg-back aria-label="Back to conversations">' + Shell.icon("arrowLeft", 18) + "</button>" +
          "<span>" +
            "<strong>" + UI.escapeHtml((thread.person && thread.person.name) || "Listing owner") + "</strong>" +
            "<small>Usually replies through Lafia Marketplace</small>" +
          "</span>" +
          '<span class="msg-pane__tools">' +
            '<button type="button" class="icon-btn" data-msg-archive aria-label="Archive conversation" title="Archive">' + Shell.icon("archive", 17) + "</button>" +
            '<button type="button" class="icon-btn" data-msg-block aria-label="Block this account" title="Block">' + Shell.icon("block", 17) + "</button>" +
          "</span>" +
        "</div>" +

        '<div class="msg-context">' +
          '<span class="msg-context__thumb">' + (image
            ? '<img src="' + UI.escapeHtml(image) + '" alt="" loading="lazy" onerror="this.remove()">'
            : Shell.icon("image", 20)) + "</span>" +
          "<span>" +
            "<strong>" + UI.escapeHtml(listing.title || "Listing") + "</strong>" +
            "<small>" + UI.escapeHtml(listing.location || "Lafia") + " · " + UI.escapeHtml(String(listing.type || "").replace(/-/g, " ")) + "</small>" +
          "</span>" +
          '<span class="msg-context__price">' + (listing.price !== undefined && listing.price !== null ? UI.money(listing.price) : "—") + "</span>" +
        "</div>" +

        '<div class="msg-stream" id="msg-stream">' +
          (stream || '<div class="empty-state" style="border:0;background:transparent;padding:var(--sp-5)">' +
            "<h3>Say hello</h3><p>Use a quick reply below, or write your own message.</p></div>") +
        "</div>" +

        '<form class="msg-composer" id="msg-composer">' +
          '<div class="quick-row" role="group" aria-label="Quick replies">' +
            QUICK_ACTIONS.map(function (action) {
              return '<button class="quick-chip" type="button" data-quick="' + action.id + '">' + UI.escapeHtml(action.label) + "</button>";
            }).join("") +
          "</div>" +
          '<div id="offer-slot" aria-live="polite"></div>' +
          '<div class="msg-input-row">' +
            '<label class="sr-only" for="msg-text">Write a message</label>' +
            '<textarea id="msg-text" rows="1" placeholder="Write a message…" maxlength="1200"></textarea>' +
            '<button class="btn btn-primary" type="submit">' + Shell.icon("send", 16) + "Send</button>" +
          "</div>" +
          '<p class="form-note mt-1">This conversation is stored on your device for now — server sync arrives with the messaging service.</p>' +
        "</form>";

      var streamHost = paneHost.querySelector("#msg-stream");
      if (streamHost) streamHost.scrollTop = streamHost.scrollHeight;

      var composer = paneHost.querySelector("#msg-composer");
      var textarea = paneHost.querySelector("#msg-text");
      var offerSlot = paneHost.querySelector("#offer-slot");
      var archived = !!thread.archived;

      var back = paneHost.querySelector("[data-msg-back]");
      if (back) back.addEventListener("click", function () { shell.dataset.view = "list"; render(); });

      var archiveBtn = paneHost.querySelector("[data-msg-archive]");
      if (archiveBtn) {
        if (archived) archiveBtn.classList.add("is-danger");
        archiveBtn.addEventListener("click", function () {
          Messaging.apiArchive(thread.id, !archived).then(function () {
            UI.toast(archived ? "Conversation restored" : "Conversation archived", "success");
            render();
          });
        });
      }

      var blockBtn = paneHost.querySelector("[data-msg-block]");
      if (blockBtn) {
        if (thread.blocked) blockBtn.classList.add("is-danger");
        blockBtn.addEventListener("click", function () {
          UI.confirm(
            thread.blocked ? "Unblock this account?" : "Block this account?",
            thread.blocked
              ? "They will be able to message you again."
              : "You will stop seeing new messages from them in this conversation.",
            thread.blocked ? "Unblock" : "Block"
          ).then(function (ok) {
            if (!ok) return;
            Messaging.apiBlock ? Messaging.apiBlock(thread.id, !thread.blocked) : Messaging.block(thread.id, !thread.blocked);
            UI.toast(thread.blocked ? "Account unblocked" : "Account blocked", "success");
            render();
          });
        });
      }

      composer.addEventListener("submit", function (event) {
        event.preventDefault();
        var value = textarea.value;
        var offerField = composer.querySelector("#offer-amount");
        var offer = offerField && offerField.value !== "" ? offerField.value : undefined;
        if (!String(value).trim() && offer === undefined) {
          UI.toast("Write a message or enter an amount first", "info");
          return;
        }
        Messaging.apiSend(thread.id, value, { offer: offer }).then(function () {
          render();
        }).catch(function (error) { UI.toast(error.message, "error"); });
      });

      composer.querySelectorAll("[data-quick]").forEach(function (node) {
        node.addEventListener("click", function () {
          var action = QUICK_ACTIONS.filter(function (row) { return row.id === node.dataset.quick; })[0];
          if (!action) return;
          if (action.offer) {
            offerSlot.innerHTML =
              '<div class="offer-panel mb-2">' +
                "<h3>Make an offer</h3>" +
                "<p>Name the price you will pay. It is attached to this conversation so " +
                  UI.escapeHtml((thread.person && thread.person.name) || "the owner") + " can accept, reject or counter it.</p>" +
                '<div class="offer-amount"><span>₦</span>' +
                  '<label class="sr-only" for="offer-amount">Your offer amount</label>' +
                  '<input id="offer-amount" type="number" min="0" step="50" inputmode="numeric" placeholder="0">' +
                "</div>" +
                "<p class=\"form-note\">The note “I will buy it at this price.” is added automatically — edit it if you like.</p>" +
              "</div>";
            if (!textarea.value) textarea.value = "I will buy it at this price.";
            /* Focus the amount, not the note: the amount is the one thing the
               buyer must supply, and the note is already written for them. */
            var amountInput = offerSlot.querySelector("#offer-amount");
            if (amountInput) amountInput.focus();
            return;
          }
          textarea.value = action.text;
          textarea.focus();
        });
      });
    }

    /* Filters: All / Unread / Archived — the same chip contract as every other
       list surface in the product. */
    document.querySelectorAll("#msg-filters .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("#msg-filters .chip").forEach(function (node) { node.classList.remove("active"); });
        chip.classList.add("active");
        filter = chip.dataset.value || "all";
        activeId = null;
        render();
      });
    });

    window.addEventListener("cm:messages", function () {
      if (window.Shell && Shell.paintMessageBadge) Shell.paintMessageBadge();
    });

    shell.dataset.view = "list";
    var preset = UI.queryParam("thread");
    if (preset) { activeId = preset; Messaging.markRead(preset); shell.dataset.view = "thread"; }
    render();
  }

  /** Open a listing conversation from anywhere in the product. */
  function messageAboutListing(listing, options) {
    options = options || {};
    var id = Messaging.openThread(listing);
    if (!id) {
      UI.toast("That listing cannot be messaged right now", "error");
      return;
    }
    if (options.offer !== undefined) {
      Messaging.send(id, options.text || "I will buy it at this price.", { offer: options.offer });
    } else if (options.text) {
      Messaging.send(id, options.text);
    }
    window.location.href = UI.pageUrl("messages.html") + "?thread=" + encodeURIComponent(id);
  }

  window.Messaging = Messaging;
  window.messageAboutListing = messageAboutListing;
  window.initEngage = initMessages;
})(window, document);
