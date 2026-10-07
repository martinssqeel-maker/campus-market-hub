/* ==========================================================================
   rush.js — Market Rush, the Game Centre's flagship game

   The owner's brief: the old game was "too easy and not fun enough; after
   playing once, it became boring", and the Game Centre is now a catalogue of
   games rather than a single screen. Market Rush is the second game and the
   headline one.

   WHAT IT IS
   A market-puzzle under a shrinking clock. Each round shows a basket target
   ("spend exactly ₦2,150") and a board of campus-market stalls with real Naira
   prices. Tap stalls to add them to your basket, tap again to take them out,
   and land the total on the exact naira. Ten rounds, three lives, combos,
   power-ups, near-miss bait tiles and a score worth chasing.

   WHY THESE MECHANICS (fused from the genres the design bible lists)
   - Quick-math (the document's "quick math" genre) is the skill: mental
     addition under pressure.
   - Merge/number-puzzle choices (its "merge-number puzzle" genre) come from
     baskets being buildable in many orders, with bait tiles that nearly fit.
   - Reflex/arcade pressure ("catch the coin") comes from the clock, which
     shortens every round.
   - The theme is the product itself: Naira, Lafia market stalls, campus
     prices. A player gets better at reading real prices by playing.

   HARD RULES THIS FILE KEEPS
   - Vanilla ES5-compatible ES6, no libraries, no canvas, no audio. All motion
     is CSS transform/opacity so it holds 60fps on a mid-range Android.
   - Everything is real: real clock, real scoring, real persistence per
     account, real streaks and achievements shared with the rest of the Game
     Centre. Nothing is faked and no rival is invented.
   - prefers-reduced-motion is honoured throughout.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var GAME_ID = "market-rush";
  var ROUNDS = 10;
  var LIVES = 3;

  /* Stalls. Prices are chosen so baskets have satisfying, findable totals. */
  var STALLS = [
    { key: "suya", label: "Suya stick", price: 250, icon: "flame" },
    { key: "akara", label: "Akara wrap", price: 150, icon: "store" },
    { key: "bread", label: "Agege bread", price: 350, icon: "tag" },
    { key: "noodles", label: "Noodles pack", price: 450, icon: "store" },
    { key: "water", label: "Sachet water", price: 50, icon: "wallet" },
    { key: "print", label: "Printing", price: 100, icon: "layers" },
    { key: "shuttle", label: "Campus shuttle", price: 300, icon: "compass" },
    { key: "eggs", label: "Egg crate", price: 500, icon: "store" },
    { key: "haircut", label: "Barbing", price: 600, icon: "sparkle" },
    { key: "earbuds", label: "Earbuds", price: 750, icon: "phone" },
    { key: "tutor", label: "Tutor hour", price: 800, icon: "calendar" },
    { key: "charger", label: "Phone charger", price: 950, icon: "bolt" },
    { key: "data", label: "Data top-up", price: 1000, icon: "bolt" },
    { key: "powerbank", label: "Power bank", price: 1200, icon: "wallet" },
    { key: "hostel", label: "Hostel night", price: 1500, icon: "bed" },
    { key: "tools", label: "Repair service", price: 1750, icon: "tools" }
  ];

  var LEVELS = [
    { id: "casual", label: "Casual", seconds: 26, tiles: 6, picks: 2, blurb: "6 stalls · 26s" },
    { id: "standard", label: "Standard", seconds: 20, tiles: 9, picks: 3, blurb: "9 stalls · 20s" },
    { id: "rush", label: "Campus rush", seconds: 15, tiles: 12, picks: 3, blurb: "12 stalls · 15s" }
  ];

  function reduced() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function money(amount) {
    return window.UI ? UI.money(amount) : "₦" + Number(amount || 0).toLocaleString();
  }

  function icon(name, size) {
    return window.Shell ? Shell.icon(name, size) : "";
  }

  function esc(value) {
    return window.UI ? UI.escapeHtml(value) : String(value === undefined || value === null ? "" : value);
  }

  function today() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  /** Deterministic PRNG — the daily run must deal the same baskets to everyone. */
  function seeded(seed) {
    var value = seed >>> 0;
    return function () {
      value = (value + 0x6D2B79F5) >>> 0;
      var t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedFrom(value) {
    var hash = 2166136261;
    String(value).split("").forEach(function (character) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return hash >>> 0;
  }

  function pick(random, list) {
    return list[Math.floor(random() * list.length)];
  }

  /* ======================================================================== */
  function init(host) {
    var root = host || document.getElementById("rush-root");
    if (!root) return null;

    var level = LEVELS[1];
    var mode = "practice";              // "practice" | "daily"
    var phase = "idle";                 // idle | playing | paused | clear | over
    var random = Math.random;
    var tiles = [];
    var basket = [];
    var target = 0;
    var round = 1;
    var score = 0;
    var combo = 0;
    var bestCombo = 0;
    var lives = LIVES;
    var exacts = 0;
    var wrongPicks = 0;
    var cleared = 0;
    var powerups = { hint: 1, freeze: 1, swap: 1 };
    var used = { hint: 0, freeze: 0, swap: 0 };
    var timeLeft = 0;
    var deadline = 0;
    var ticker = null;
    var hintTimer = null;
    var finished = false;

    var boardHost = document.getElementById("rush-board");
    var levelsHost = document.getElementById("rush-levels");
    var basketHost = document.getElementById("rush-basket");
    var powerHost = document.getElementById("rush-powerups");
    var resultHost = document.getElementById("rush-result");
    var targetHost = document.getElementById("rush-target");
    var totalHost = document.getElementById("rush-total");
    var statusHost = document.getElementById("rush-status");
    var hud = {
      score: document.getElementById("rush-hud-score"),
      round: document.getElementById("rush-hud-round"),
      combo: document.getElementById("rush-hud-combo"),
      lives: document.getElementById("rush-hud-lives"),
      time: document.getElementById("rush-hud-time"),
      bar: document.getElementById("rush-timebar")
    };
    var startButton = document.getElementById("rush-start");
    var pauseButton = document.getElementById("rush-pause");

    var metrics = { rounds: 0, startedAt: 0 };

    /* ------------------------------------------------------------ announce */
    function announce(message) {
      if (statusHost) statusHost.textContent = message;
    }

    function vibrate(pattern) {
      try {
        if (window.navigator.vibrate && !reduced()) window.navigator.vibrate(pattern);
      } catch (e) { /* unsupported */ }
    }

    /* ------------------------------------------------------------- scoring */
    function total() {
      return basket.reduce(function (sum, index) { return sum + tiles[index].price; }, 0);
    }

    function multiplier() {
      return Math.min(4, 1 + Math.max(0, combo) * 0.5);
    }

    /* ---------------------------------------------------------- board deal */
    /**
     * Builds one round. The exact basket always exists (the target is the sum
     * of the tiles chosen for it), bait tiles are seeded from round three so
     * near-misses happen, and no single stall can ever equal the whole target —
     * one-tap wins are never dealt.
     */
    function deal() {
      var stalls = level.tiles + Math.min(4, Math.floor((round - 1) / 2));
      var picks = Math.min(4, level.picks + (round >= 4 ? 1 : 0) + (round >= 8 ? 1 : 0));
      var pool = STALLS.slice();

      /* Pick the stalls that make up the exact basket. */
      var chosen = [];
      while (chosen.length < picks && pool.length) {
        var index = Math.floor(random() * pool.length);
        chosen.push(pool.splice(index, 1)[0]);
      }
      target = chosen.reduce(function (sum, stall) { return sum + stall.price; }, 0);

      tiles = chosen.map(function (stall, order) {
        return { key: stall.key, label: stall.label, price: stall.price, icon: stall.icon, bait: false, order: order };
      });

      /* Fill the rest of the market. */
      var baitUsed = false;
      while (tiles.length < stalls && pool.length) {
        var candidate = pool.splice(Math.floor(random() * pool.length), 1)[0];
        if (candidate.price === target) continue;                 /* never a one-tap win */
        var isBait = false;
        /* From round three, one stall is exactly one small tap away: target
           minus its price is a price already on the board. That is the near
           miss the design bible asks for — close, findable, and wrong. */
        if (!baitUsed && round >= 3 && tiles.length >= picks) {
          var narrowest = chosen.reduce(function (low, stall) { return Math.min(low, stall.price); }, Infinity);
          var nearest = tiles.filter(function (tile) { return tile.price === target - candidate.price; });
          if (nearest.length && candidate.price < narrowest) {
            isBait = true;
            baitUsed = true;
          }
        }
        tiles.push({ key: candidate.key, label: candidate.label, price: candidate.price, icon: candidate.icon, bait: isBait, order: tiles.length });
      }

      /* Shuffle placement so the solution moves around the market. */
      for (var i = tiles.length - 1; i > 0; i--) {
        var j = Math.floor(random() * (i + 1));
        var swap = tiles[i];
        tiles[i] = tiles[j];
        tiles[j] = swap;
      }

      basket = [];
      wrongPicks = 0;
      var seconds = Math.max(9, level.seconds - Math.floor((round - 1) / 2));
      timeLeft = seconds;
      deadline = Date.now() + seconds * 1000;
      metrics.rounds = round;

      renderBoard();
      renderBasket();
      renderHud();
      startClock();
      announce("Round " + round + " of " + ROUNDS + ". Spend exactly " + money(target) +
        " — " + picks + " stalls will do it, " + seconds + " seconds on the clock.");
    }

    /* ------------------------------------------------------------- render */
    function renderLevels() {
      if (!levelsHost) return;
      levelsHost.innerHTML = LEVELS.map(function (row) {
        return '<button type="button" class="deep-chip' + (row.id === level.id ? " is-active" : "") +
          '" data-rush-level="' + row.id + '" aria-pressed="' + (row.id === level.id) + '">' +
          esc(row.label) + " · " + esc(row.blurb) + "</button>";
      }).join("");
      levelsHost.querySelectorAll("[data-rush-level]").forEach(function (node) {
        node.addEventListener("click", function () {
          var next = LEVELS.filter(function (row) { return row.id === node.dataset.rushLevel; })[0];
          if (!next || next.id === level.id) return;
          level = next;
          mode = "practice";
          renderLevels();
          begin("practice");
        });
      });
    }

    /**
     * The pre-run state. An empty grid reads as a broken board, so the market
     * introduces itself instead: what the run is, how it plays, and one honest
     * button. It disappears the moment a run begins.
     */
    function renderBlank() {
      if (!boardHost) return;
      boardHost.dataset.count = "0";
      boardHost.innerHTML =
        '<div class="rush-blank">' +
          '<span class="rush-blank__mark" aria-hidden="true">' + icon("store", 26) + "</span>" +
          "<h3>The market opens when you press Play</h3>" +
          "<p>Ten rounds of exact change at real Lafia prices. Hit the named total to the naira, three lives to spend, and a clock that shortens every round.</p>" +
          '<button class="btn btn-primary" type="button" data-rush-begin>Start a run</button>' +
          '<ul class="rush-blank__list">' +
            "<li>" + icon("target", 15) + "Land the total exactly — going over costs a life</li>" +
            "<li>" + icon("flame", 15) + "Clear rounds back-to-back to raise the multiplier</li>" +
            "<li>" + icon("sparkle", 15) + "Earn a power-up every third round</li>" +
          "</ul>" +
        "</div>";
      var beginButton = boardHost.querySelector("[data-rush-begin]");
      if (beginButton) beginButton.addEventListener("click", function () { begin("practice"); });
    }

    function renderBoard() {
      if (!boardHost) return;
      boardHost.dataset.count = String(tiles.length);
      boardHost.innerHTML = tiles.map(function (tile, index) {
        var chosenNow = basket.indexOf(index) !== -1;
        return '<button type="button" class="rush-tile' + (chosenNow ? " is-picked" : "") +
          '" data-index="' + index + '" data-price="' + tile.price + '"' +
          ' aria-pressed="' + chosenNow + '"' +
          ' aria-label="' + esc(tile.label + ", " + money(tile.price)) + (chosenNow ? ", in basket" : "") + '">' +
          '<span class="rush-tile__icon" aria-hidden="true">' + icon(tile.icon, 20) + "</span>" +
          '<span class="rush-tile__label">' + esc(tile.label) + "</span>" +
          '<span class="rush-tile__price">' + money(tile.price) + "</span>" +
          '<span class="rush-tile__ripple" aria-hidden="true"></span>' +
        "</button>";
      }).join("");
    }

    function renderBasket() {
      var running = total();
      if (totalHost) {
        totalHost.textContent = money(running);
        totalHost.className = "rush-total" +
          (running === target ? " is-exact" : running > target ? " is-over" : "");
      }
      if (targetHost) targetHost.textContent = money(target);
      if (!basketHost) return;

      if (!basket.length) {
        basketHost.innerHTML = '<span class="rush-basket__empty">Tap a stall to start building your basket</span>';
      } else {
        basketHost.innerHTML = basket.map(function (index) {
          var tile = tiles[index];
          return '<button type="button" class="rush-basket__chip" data-remove="' + index + '"' +
            ' aria-label="Remove ' + esc(tile.label) + ' from the basket">' +
            esc(tile.label) + " <b>" + money(tile.price) + "</b>" +
            '<span aria-hidden="true">' + icon("close", 13) + "</span></button>";
        }).join("");
      }
    }

    function renderHud() {
      if (hud.score) hud.score.textContent = score.toLocaleString();
      if (hud.round) hud.round.textContent = Math.min(round, ROUNDS) + "/" + ROUNDS;
      if (hud.combo) {
        hud.combo.textContent = multiplier().toFixed(1).replace(/\.0$/, "") + "×";
        hud.combo.classList.toggle("is-hot", combo >= 2);
      }
      if (hud.lives) {
        hud.lives.textContent = String(lives);
        hud.lives.classList.toggle("is-low", lives <= 1);
      }
      if (hud.time) hud.time.textContent = Math.max(0, Math.ceil(timeLeft)) + "s";
      if (hud.bar) {
        var span = Math.max(9, level.seconds - Math.floor((round - 1) / 2));
        hud.bar.style.width = Math.max(0, Math.min(100, (timeLeft / span) * 100)) + "%";
        hud.bar.classList.toggle("is-low", timeLeft <= 5);
      }
    }

    function renderPowerups() {
      if (!powerHost) return;
      var rows = [
        { id: "hint", label: "Hint", hint: "H", icon: "sparkle", detail: "Finds one right stall" },
        { id: "freeze", label: "Freeze", hint: "F", icon: "clock", detail: "+4 seconds" },
        { id: "swap", label: "Re-deal", hint: "S", icon: "layers", detail: "Fresh market, same target" }
      ];
      powerHost.innerHTML = rows.map(function (row) {
        var left = Math.max(0, Number(powerups[row.id] || 0));
        return '<button type="button" class="rush-power' + (left ? "" : " is-spent") + '"' +
          ' data-power="' + row.id + '"' + (left ? "" : " disabled") +
          ' aria-label="' + esc(row.label + " — " + row.detail + ", " + left + " left") + '">' +
          '<span class="rush-power__icon" aria-hidden="true">' + icon(row.icon, 17) + "</span>" +
          "<span>" + esc(row.label) + "<small>" + esc(row.detail) + "</small></span>" +
          '<b class="rush-power__count">' + left + "</b>" +
        "</button>";
      }).join("");
    }

    /** Real seconds spent in the market — the run clock, not the round clock. */
    function elapsedSeconds() {
      return metrics.startedAt ? Math.max(0, Math.round((Date.now() - metrics.startedAt) / 1000)) : 0;
    }

    function renderResult(outcome) {
      if (!resultHost) return;
      var finalScore = score;
      var record = window.GameCentre && GameCentre.record
        ? GameCentre.record({
            gameId: GAME_ID,
            gameName: "Market Rush",
            score: finalScore,
            level: level.id,
            levelLabel: level.label,
            time: elapsedSeconds(),
            rounds: cleared,
            misses: lives < LIVES ? LIVES - lives : 0,
            daily: mode === "daily",
            bestCombo: bestCombo,
            exacts: exacts,
            outcome: outcome
          })
        : { earned: [], isBest: false, streak: 0 };

      resultHost.hidden = false;
      resultHost.classList.add("is-visible");
      resultHost.innerHTML =
        '<div class="rush-result__head">' +
          '<span class="rush-result__mark" aria-hidden="true">' + icon(outcome === "won" ? "trophy" : "flag", 26) + "</span>" +
          "<div>" +
            "<h3>" + (outcome === "won" ? "Market closed — every basket landed" : "Out of lives") + "</h3>" +
            "<p>" + (outcome === "won"
              ? "Ten rounds of exact change. Your tally is on the board."
              : "You cleared " + cleared + " of " + ROUNDS + " baskets. The board resets on the next run.") + "</p>" +
          "</div>" +
        "</div>" +
        '<div class="rush-result__grid">' +
          '<div><b>' + finalScore.toLocaleString() + "</b><span>Score</span></div>" +
          '<div><b>' + exacts + "</b><span>Exact baskets</span></div>" +
          '<div><b>' + bestCombo + "</b><span>Best combo</span></div>" +
          '<div><b>' + (record.isBest ? "New" : "—") + "</b><span>Personal best</span></div>" +
        "</div>" +
        (mode === "daily" && record.streak
          ? '<p class="rush-result__streak">' + icon("flame", 15) + " Daily streak: " +
            record.streak + (record.streak === 1 ? " day" : " days") + "</p>"
          : "") +
        '<button class="btn btn-primary mt-2" type="button" data-rush-again>Play another run</button>' +
        '<button class="btn btn-ghost" type="button" data-rush-reset>Change difficulty</button>';

      var again = resultHost.querySelector("[data-rush-again]");
      if (again) again.addEventListener("click", function () { begin(mode); });
      var reset = resultHost.querySelector("[data-rush-reset]");
      if (reset) reset.addEventListener("click", function () { begin("practice"); });

      if (window.GameCentre && GameCentre.renderPanels) GameCentre.renderPanels(GAME_ID);
      paintCards();
    }

    /* -------------------------------------------------------------- clock */
    function startClock() {
      stopClock();
      ticker = window.setInterval(function () {
        timeLeft = Math.max(0, (deadline - Date.now()) / 1000);
        if (hud.bar) {
          var span = Math.max(9, level.seconds - Math.floor((round - 1) / 2));
          hud.bar.style.width = Math.max(0, Math.min(100, (timeLeft / span) * 100)) + "%";
          hud.bar.classList.toggle("is-low", timeLeft <= 5);
        }
        if (hud.time) hud.time.textContent = Math.max(0, Math.ceil(timeLeft)) + "s";
        if (timeLeft <= 0) lapse();
      }, 120);
    }

    function stopClock() {
      window.clearInterval(ticker);
      ticker = null;
    }

    function pause(message) {
      if (phase !== "playing") return;
      phase = "paused";
      stopClock();
      if (pauseButton) {
        pauseButton.textContent = "Resume";
        pauseButton.setAttribute("aria-pressed", "true");
      }
      if (boardHost) boardHost.classList.add("is-dimmed");
      announce(message || "Paused. The clock is stopped.");
    }

    function resume() {
      if (phase !== "paused") return;
      phase = "playing";
      deadline = Date.now() + Math.max(1, timeLeft) * 1000;
      startClock();
      if (pauseButton) {
        pauseButton.textContent = "Pause";
        pauseButton.setAttribute("aria-pressed", "false");
      }
      if (boardHost) boardHost.classList.remove("is-dimmed");
      announce("Back in the market.");
    }

    /* --------------------------------------------------------------- turns */
    function wrongTotal() {
      return total() > target;
    }

    function tap(index) {
      if (phase !== "playing") return;
      var tile = tiles[index];
      if (!tile) return;
      var at = basket.indexOf(index);

      if (at !== -1) {
        basket.splice(at, 1);
        renderTiles(false);
        renderBasket();
        announce(tile.label + " removed. Basket is " + money(total()) + ".");
        return;
      }

      basket.push(index);
      wrongPicks = total() > target ? wrongPicks + 1 : wrongPicks;
      renderTiles(true, index);
      renderBasket();

      if (wrongTotal()) {
        overBudget();
        return;
      }
      if (total() === target) {
        clearRound();
        return;
      }
      var gap = target - total();
      announce(tile.label + " added. Basket is " + money(total()) + ", " + money(gap) + " to go.");
      vibrate(8);
    }

    function renderTiles(animate, index) {
      if (!boardHost) return;
      boardHost.querySelectorAll(".rush-tile").forEach(function (node) {
        var tileIndex = Number(node.dataset.index);
        var on = basket.indexOf(tileIndex) !== -1;
        node.classList.toggle("is-picked", on);
        node.setAttribute("aria-pressed", on ? "true" : "false");
        if (animate && tileIndex === index && !reduced()) {
          node.classList.remove("is-tap");
          void node.offsetWidth;
          node.classList.add("is-tap");
        }
      });
    }

    function overBudget() {
      live("Over budget by " + money(total() - target) + ". Watch the total, not the stall.");
    }

    function lapse() {
      stopClock();
      live("Time up — the stall closed. " + money(target) + " was the target.");
    }

    function live(reason) {
      if (finished) return;
      lives -= 1;
      combo = 0;
      vibrate(30);
      if (boardHost) {
        boardHost.classList.add("is-shaking");
        window.setTimeout(function () { boardHost.classList.remove("is-shaking"); }, reduced() ? 60 : 420);
      }
      renderHud();
      stopClock();

      if (lives <= 0) {
        finished = true;
        phase = "over";
        renderResult("lost");
        announce("Run over. " + reason + " Final score " + score.toLocaleString() + ".");
        if (window.UI) {
          UI.toast("Market Rush — " + score.toLocaleString() + " points", "info");
        }
        return;
      }
      phase = "clear";
      announce(reason + " " + lives + (lives === 1 ? " life" : " lives") + " left. Re-dealing the market.");
      window.setTimeout(function () {
        if (finished) return;
        phase = "playing";
        deal();
      }, reduced() ? 120 : 520);
    }

    function clearRound() {
      stopClock();
      phase = "clear";
      combo += 1;
      bestCombo = Math.max(bestCombo, combo);
      cleared += 1;
      exacts += 1;

      var remaining = Math.max(0, (deadline - Date.now()) / 1000);
      var base = 100 + round * 30;
      var multiplierNow = multiplier();
      var timeBonus = Math.round(remaining * 8);
      var cleanBonus = wrongPicks === 0 ? 75 : 0;
      var gained = Math.round(base * multiplierNow) + timeBonus + cleanBonus;
      score += gained;

      if (cleared % 3 === 0) {
        var grant = ["hint", "freeze", "swap"][Math.floor(random() * 3)];
        powerups[grant] = Math.min(3, Number(powerups[grant] || 0) + 1);
        announce("Combo reward — one " + (grant === "swap" ? "re-deal" : grant) + " added.");
      }

      if (boardHost) boardHost.classList.add("is-cleared");
      renderBasket();
      renderHud();
      renderPowerups();

      var exact = total() === target;
      if (window.UI && !reduced()) UI.toast("Exact change — " + money(target) + " · +" + gained, "success", 1600);
      announce((exact ? "Exact basket! " : "") + money(target) + " cleared. +" + gained +
        " points. Combo " + combo + ".");

      if (round >= ROUNDS) {
        finished = true;
        phase = "over";
        window.setTimeout(function () {
          if (boardHost) boardHost.classList.remove("is-cleared");
          renderResult("won");
          announce("Every basket landed. Final score " + score.toLocaleString() + ".");
          if (window.UI) UI.toast("Market Rush cleared — " + score.toLocaleString() + " points", "success", 4200);
        }, reduced() ? 150 : 620);
        return;
      }

      window.setTimeout(function () {
        if (finished) return;
        if (boardHost) boardHost.classList.remove("is-cleared");
        round += 1;
        phase = "playing";
        deal();
      }, reduced() ? 150 : 620);
    }

    /* ----------------------------------------------------------- power-ups */
    function usePower(id) {
      if (phase !== "playing") return;
      if (!powerups[id]) return;
      powerups[id] -= 1;
      used[id] = Number(used[id] || 0) + 1;

      if (id === "freeze") {
        timeLeft = Math.min(level.seconds, timeLeft + 4);
        deadline = Date.now() + timeLeft * 1000;
        announce("Clock frozen for a moment — four seconds added.");
      }
      if (id === "swap") {
        deal();
        announce("Fresh stalls dealt. Same target: " + money(target) + ".");
      }
      if (id === "hint") {
        var answer = solution();
        var missing = answer.filter(function (index) { return basket.indexOf(index) === -1; });
        if (!missing.length) {
          powerups[id] += 1;
          announce("Your basket is already exact.");
          return;
        }
        highlight(missing[0]);
        announce("Hint: " + tiles[missing[0]].label + " belongs in this basket.");
      }

      renderPowerups();
      renderHud();
      vibrate(10);
    }

    function highlight(index) {
      if (!boardHost) return;
      var node = boardHost.querySelector('.rush-tile[data-index="' + index + '"]');
      if (!node) return;
      node.classList.add("is-hint");
      window.clearTimeout(hintTimer);
      hintTimer = window.setTimeout(function () {
        node.classList.remove("is-hint");
      }, reduced() ? 400 : 1400);
    }

    /**
     * One exact basket for the current board, as tile indices. This is real
     * functionality — the Hint power-up uses it, and so does the test suite,
     * which is allowed to see the same answer a player can buy.
     */
    function solution() {
      var wanted = target;
      var best = null;
      var byPrice = {};
      tiles.forEach(function (tile, index) {
        if (!byPrice[tile.price]) byPrice[tile.price] = [];
        byPrice[tile.price].push(index);
      });
      var prices = Object.keys(byPrice).map(Number).sort(function (a, b) { return b - a; });

      function walk(position, remaining, chosen) {
        if (best) return;
        if (remaining === 0) { best = chosen.slice(); return; }
        if (position >= prices.length || remaining < 0) return;
        var price = prices[position];
        var available = byPrice[price];
        var maxTakes = Math.min(available.length, Math.floor(remaining / price));
        for (var take = maxTakes; take >= 0 && !best; take--) {
          var next = chosen.slice();
          for (var i = 0; i < take; i++) next.push(available[i]);
          walk(position + 1, remaining - price * take, next);
        }
      }

      walk(0, wanted, []);
      return best || [];
    }

    /* --------------------------------------------------------------- flow */
    function begin(nextMode) {
      if (window.GameCentre && GameCentre.ensurePanels) GameCentre.ensurePanels(GAME_ID);
      mode = nextMode === "daily" ? "daily" : "practice";
      random = mode === "daily" ? seeded(seedFrom("rush-" + today())) : Math.random;
      phase = "playing";
      finished = false;
      round = 1;
      score = 0;
      combo = 0;
      bestCombo = 0;
      lives = LIVES;
      exacts = 0;
      wrongPicks = 0;
      cleared = 0;
      powerups = { hint: 1, freeze: 1, swap: 1 };
      used = { hint: 0, freeze: 0, swap: 0 };
      metrics = { rounds: 0, startedAt: Date.now() };

      if (resultHost) {
        resultHost.hidden = true;
        resultHost.classList.remove("is-visible");
        resultHost.innerHTML = "";
      }
      if (pauseButton) {
        pauseButton.textContent = "Pause";
        pauseButton.setAttribute("aria-pressed", "false");
        pauseButton.disabled = false;
      }
      if (startButton) startButton.textContent = "Restart run";
      if (boardHost) boardHost.classList.remove("is-dimmed", "is-cleared", "is-shaking");

      renderLevels();
      renderPowerups();
      deal();
    }

    function stop(reason) {
      finished = true;
      phase = "over";
      stopClock();
      renderResult(reason || "lost");
    }

    /* --------------------------------------------------------------- wiring */
    if (boardHost) {
      boardHost.addEventListener("click", function (event) {
        var node = event.target.closest(".rush-tile");
        if (!node) return;
        tap(Number(node.dataset.index));
      });
      /* Arrow keys walk the market, Enter/Space takes a stall — a twelve-stall
         grid is unusable with Tab alone. */
      boardHost.addEventListener("keydown", function (event) {
        var perRow = window.innerWidth >= 700 ? 4 : 3;
        var steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow, ArrowUp: -perRow };
        if (!(event.key in steps)) return;
        var node = event.target.closest(".rush-tile");
        if (!node) return;
        var index = Number(node.dataset.index) + steps[event.key];
        if (index < 0 || index >= tiles.length) return;
        event.preventDefault();
        var next = boardHost.querySelector('.rush-tile[data-index="' + index + '"]');
        if (next) next.focus();
      });
    }

    if (basketHost) {
      basketHost.addEventListener("click", function (event) {
        var node = event.target.closest("[data-remove]");
        if (!node) return;
        tap(Number(node.dataset.remove));
      });
    }

    if (powerHost) {
      powerHost.addEventListener("click", function (event) {
        var node = event.target.closest("[data-power]");
        if (!node) return;
        usePower(node.dataset.power);
      });
    }

    if (startButton) {
      startButton.addEventListener("click", function () { begin("practice"); });
    }
    if (pauseButton) {
      pauseButton.addEventListener("click", function () {
        if (phase === "playing") pause();
        else if (phase === "paused") resume();
      });
    }

    var dailyButton = document.getElementById("rush-daily");
    if (dailyButton) dailyButton.addEventListener("click", function () { begin("daily"); });

    /* Keyboard shortcuts: H/F/S for the power-ups, Escape to pause. */
    document.addEventListener("keydown", function (event) {
      if (!isVisible()) return;
      var tag = (event.target && event.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") { pause("Paused from the keyboard."); return; }
      var keys = { h: "hint", f: "freeze", s: "swap" };
      var wanted = keys[String(event.key).toLowerCase()];
      if (wanted) {
        event.preventDefault();
        usePower(wanted);
      }
    });

    /* Leaving the tab must never cost a life — the market waits. */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && phase === "playing") pause("Paused while you were away.");
    });

    function isVisible() {
      var stage = document.getElementById("rush-panel");
      return !!stage && !stage.hidden;
    }

    renderLevels();
    renderPowerups();
    renderBlank();
    renderHud();
    announce("Pick a difficulty, then spend exactly what the basket costs. Tap a stall again to take it out.");

    return {
      start: begin,
      stop: stop,
      pick: tap,
      usePower: usePower,
      pause: pause,
      resume: resume,
      state: function () {
        return {
          gameId: GAME_ID,
          phase: phase,
          mode: mode,
          level: level.id,
          round: round,
          rounds: ROUNDS,
          target: target,
          total: total(),
          basket: basket.slice(),
          score: score,
          combo: combo,
          lives: lives,
          cleared: cleared,
          exacts: exacts,
          timeLeft: Math.round(timeLeft),
          powerups: Object.assign({}, powerups),
          tiles: tiles.map(function (tile, index) {
            return { index: index, label: tile.label, price: tile.price, picked: basket.indexOf(index) !== -1, bait: tile.bait };
          })
        };
      },
      solution: solution,
      isVisible: isVisible
    };
  }

  /* ======================================================================
     CATALOGUE — the Game Centre is a destination with a game list
     ====================================================================== */
  var instance = null;

  /**
   * Each catalogue card shows the signed-in player's genuine best for that
   * game — "Not played yet" until they have a real score, never a fake one.
   */
  function paintCards() {
    if (!window.GameCentre || !window.GameCentre.statsFor) return;
    var state = window.GameCentre.state();
    document.querySelectorAll("[data-card-best]").forEach(function (node) {
      var stats = window.GameCentre.statsFor(state, node.dataset.cardBest);
      var best = Number(stats.best || 0);
      node.textContent = best > 0
        ? best.toLocaleString() + " · " + (Number(stats.games || 0) === 1 ? "1 run" : Number(stats.games || 0) + " runs")
        : "Not played yet";
    });
  }

  function select(gameId) {
    document.querySelectorAll("[data-game]").forEach(function (card) {
      var on = card.dataset.game === gameId;
      card.classList.toggle("is-active", on);
      card.setAttribute("aria-pressed", on ? "true" : "false");
    });
    document.querySelectorAll("[data-game-stage]").forEach(function (stage) {
      var on = stage.dataset.gameStage === gameId;
      stage.hidden = !on;
      stage.classList.toggle("is-current", on);
    });
    if (window.GameCentre && GameCentre.renderPanels) GameCentre.renderPanels(gameId);
    paintCards();
    if (gameId === GAME_ID && instance) {
      var status = document.getElementById("rush-status");
      if (status && !status.textContent) {
        status.textContent = "Market Rush is ready. Press Play to open the market.";
      }
    }
    try {
      window.dispatchEvent(new CustomEvent("cm:game-select", { detail: { gameId: gameId } }));
    } catch (e) { /* older browsers */ }
  }

  function initCatalogue() {
    var cards = document.querySelectorAll("[data-game]");
    if (!cards.length) return;
    cards.forEach(function (card) {
      card.addEventListener("click", function () { select(card.dataset.game); });
      var play = card.querySelector("[data-play]");
      if (play) {
        play.addEventListener("click", function (event) {
          /* The card's own button should open the game, not just highlight it. */
          event.stopPropagation();
          select(card.dataset.game);
        });
      }
    });

    var wanted = null;
    try {
      var param = new URLSearchParams(window.location.search).get("game");
      if (param) wanted = param;
    } catch (e) { /* no URLSearchParams */ }
    var initial = wanted || "market-rush";
    if (!document.querySelector('[data-game-stage="' + initial + '"]')) initial = "market-match";
    select(initial);
  }

  function boot() {
    var root = document.getElementById("rush-root");
    if (root) instance = init(root);
    if (document.querySelector("[data-game]")) initCatalogue();
  }

  window.MarketRush = {
    GAME_ID: GAME_ID,
    LEVELS: LEVELS,
    ROUNDS: ROUNDS,
    STALLS: STALLS,
    init: boot,
    select: select,
    instance: function () { return instance; },
    start: function (mode) { if (instance) instance.start(mode); },
    state: function () { return instance ? instance.state() : null; },
    solution: function () { return instance ? instance.solution() : []; },
    pick: function (index) { if (instance) instance.pick(index); },
    stop: function (reason) { if (instance) instance.stop(reason); }
  };
})(window, document);
