/* ==========================================================================
   game.js — Campus Marketplace Game Centre

   The design bible asks for exactly one genuinely polished game in V1, with a
   daily challenge, high score, weekly leaderboard, streaks, achievements and
   score history — and an architecture that can host more games later.

   The game: MARKET MATCH — a memory game built from the four marketplace
   pillars. Flip two tiles, match the pairs, keep the streak alive. Skill is
   memory and speed; luck is a shuffled deck, so the board is fair.

   Everything below is real: real timers, real scoring, real persistence per
   account. Nothing is simulated, and the leaderboard never invents names — it
   shows the signed-in player, and says so when nobody else has played yet.

   Architecture note: games register into `GAMES`. V2 can add a second entry
   and the page, achievements and history all keep working.
   ========================================================================== */

(function (window, document) {
  "use strict";

  /* ------------------------------------------------------------------ icons */
  var TILE_ICONS = ["tag", "bed", "calendar", "tools", "phone", "wallet", "store", "bolt", "compass", "sparkle"];

  var LEVELS = [
    { id: "quick", label: "Quick", pairs: 6, cols: 4, par: 70, blurb: "6 pairs" },
    { id: "classic", label: "Classic", pairs: 8, cols: 4, par: 120, blurb: "8 pairs" },
    { id: "expert", label: "Expert", pairs: 10, cols: 5, par: 190, blurb: "10 pairs" }
  ];

  /**
   * The catalogue. The design bible now wants a Game Centre that lists games
   * rather than a single stage, so each entry carries the identity the card
   * renders with. Adding a third game means adding an entry here and a stage to
   * the page — the store, achievements, streak, weekly board and history are
   * already shared.
   */
  var GAMES = [
    {
      id: "market-rush",
      name: "Market Rush",
      tagline: "Spend exactly what the basket costs before the stall closes",
      blurb: "Ten rounds of exact change against a shrinking clock. Build the basket, dodge the bait stalls, chase the combo.",
      icon: "bolt",
      accent: "amber",
      badge: "New",
      levels: [],
      meta: "10 rounds · 3 lives · combos and power-ups"
    },
    {
      id: "market-match",
      name: "Market Match",
      tagline: "Match the pairs before the market closes",
      blurb: "A memory board built from the four marketplace pillars. Flip two tiles, match the pairs, keep the combo alive.",
      icon: "grid",
      accent: "green",
      badge: "Daily challenge",
      levels: LEVELS,
      meta: "6 / 8 / 10 pairs · memory and speed",
      tileIcons: TILE_ICONS
    }
  ];

  var ACHIEVEMENTS = [
    /* Shared across the catalogue. */
    { id: "first_game", label: "Open for business", detail: "Finished your first game", icon: "store" },
    { id: "first_daily", label: "Daily habit", detail: "Completed a daily challenge", icon: "calendar" },
    { id: "streak_3", label: "Three in a row", detail: "3-day daily challenge streak", icon: "flame" },
    { id: "streak_7", label: "Week strong", detail: "7-day daily challenge streak", icon: "flame" },
    /* Market Match. */
    { id: "flawless", label: "Photographic", detail: "Finished Market Match without a single miss", icon: "sparkle" },
    { id: "speed", label: "Lightning hands", detail: "Cleared Classic in under 60 seconds", icon: "bolt" },
    { id: "score_2000", label: "Market master", detail: "Scored 2,000 or more in one game", icon: "trophy" },
    /* Market Rush — earned on the exact-change board. */
    { id: "rush_first", label: "Market runner", detail: "Finished a run of Market Rush", icon: "store" },
    { id: "rush_combo5", label: "Bulk buyer", detail: "Built a five-round combo in one run", icon: "flame" },
    { id: "rush_exact10", label: "Sharp change", detail: "Landed ten exact baskets in one run", icon: "target" },
    { id: "rush_1500", label: "Market mogul", detail: "Scored 1,500 or more in Market Rush", icon: "wallet" }
  ];

  var STORE_KEY = "cm_game";

  /* ----------------------------------------------------------------- helpers */
  function currentUser() {
    var user = window.API && window.API.currentUser ? window.API.currentUser() : null;
    return user && user.id ? user : null;
  }

  function storageKey() {
    var user = currentUser();
    return STORE_KEY + ":" + (user ? "u" + user.id : "anon");
  }

  /*
   * The store keeps the top-level fields as Market Match's record (they were
   * written before the catalogue existed and other surfaces read them), and
   * gains two additions:
   *   sessions  — runs across the whole Game Centre, for the Home module
   *   by_game   — per-game record, history and daily runs for every other game
   */
  var EMPTY = {
    games: 0,
    best: 0,
    best_by_level: {},
    history: [],
    achievements: [],
    daily: {},
    daily_streak: 0,
    daily_best_streak: 0,
    last_played: null,
    sessions: 0,
    by_game: {},
    daily_runs: {}
  };

  function load() {
    try {
      var raw = window.localStorage.getItem(storageKey());
      if (!raw) return JSON.parse(JSON.stringify(EMPTY));
      var parsed = JSON.parse(raw) || {};
      return Object.assign(JSON.parse(JSON.stringify(EMPTY)), parsed);
    } catch (e) { return JSON.parse(JSON.stringify(EMPTY)); }
  }

  function save(state) {
    try { window.localStorage.setItem(storageKey(), JSON.stringify(state)); }
    catch (e) { /* private mode — session keeps working */ }
    try { window.dispatchEvent(new CustomEvent("cm:game", { detail: state })); } catch (e) { /* ignore */ }
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function today() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  function dayBefore(iso) {
    var parts = String(iso).split("-").map(Number);
    var date = new Date(parts[0], parts[1] - 1, parts[2]);
    date.setDate(date.getDate() - 1);
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  /** Deterministic PRNG so the daily challenge deals the same board to everyone. */
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

  function shuffle(list, random) {
    var items = list.slice();
    var rand = random || Math.random;
    for (var i = items.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var swap = items[i];
      items[i] = items[j];
      items[j] = swap;
    }
    return items;
  }

  function seconds(total) {
    var value = Math.max(0, Math.round(total));
    var minutes = Math.floor(value / 60);
    return minutes + ":" + String(value % 60).padStart(2, "0");
  }

  /* =======================================================================
     SHARED STORE — one record, one streak, one achievements list

     Market Match's record lives in the top-level fields because it was written
     before the catalogue existed and other surfaces already read it. Every
     other game gets a block in `by_game`, so scores never mix and the panels
     can show the game you are actually looking at.
     ======================================================================= */

  function byGame(state, gameId) {
    state.by_game = state.by_game || {};
    if (!state.by_game[gameId]) {
      state.by_game[gameId] = { games: 0, best: 0, best_by_level: {}, history: [], daily: {} };
    }
    var block = state.by_game[gameId];
    block.history = block.history || [];
    block.best_by_level = block.best_by_level || {};
    block.daily = block.daily || {};
    return block;
  }

  /** The view the shared panels render: either the legacy record or a block. */
  function statsFor(state, gameId) {
    if (!gameId || gameId === "market-match") {
      return {
        games: Number(state.games || 0),
        best: Number(state.best || 0),
        best_by_level: state.best_by_level || {},
        history: state.history || [],
        daily: state.daily || {}
      };
    }
    var block = byGame(state, gameId);
    return {
      games: Number(block.games || 0),
      best: Number(block.best || 0),
      best_by_level: block.best_by_level,
      history: block.history,
      daily: block.daily
    };
  }

  /**
   * Daily bookkeeping for any game. One streak for the whole centre: playing a
   * daily challenge in Market Rush keeps the same flame alive that Market Match
   * started, and a second daily on the same day never counts twice.
   */
  function noteDaily(state, gameId, score) {
    var key = today();
    state.daily_runs = state.daily_runs || {};
    var runKey = gameId + ":" + key;
    var already = !!state.daily_runs[runKey];

    if (already) {
      state.daily_runs[runKey].score = Math.max(Number(state.daily_runs[runKey].score || 0), Number(score || 0));
    } else {
      state.daily_runs[runKey] = { score: Number(score || 0), at: Date.now(), game: gameId };
    }

    if (!already && state.daily_claimed !== key) {
      var yesterday = dayBefore(key);
      var playedYesterday = Object.keys(state.daily_runs).some(function (rowKey) {
        return rowKey.indexOf(":" + yesterday) === rowKey.length - yesterday.length - 1;
      }) || !!(state.daily && state.daily[yesterday]);
      state.daily_streak = playedYesterday ? Number(state.daily_streak || 0) + 1 : 1;
      state.daily_best_streak = Math.max(Number(state.daily_best_streak || 0), Number(state.daily_streak || 0));
      state.daily_claimed = key;
    }

    /* Market Match's summary cell still reads the legacy map. */
    if (gameId === "market-match") {
      state.daily[key] = state.daily[key] || { score: 0, at: Date.now() };
      state.daily[key].score = Math.max(Number(state.daily[key].score || 0), Number(score || 0));
    }

    var block = byGame(state, gameId);
    block.daily[key] = block.daily[key] || { score: 0, at: Date.now() };
    block.daily[key].score = Math.max(Number(block.daily[key].score || 0), Number(score || 0));

    return Number(state.daily_streak || 0);
  }

  /** Lives on the Game Centre page — the panels are only there. */
  function hasPanels() {
    return !!document.getElementById("game-summary");
  }

  /* =======================================================================
     SHARED PANELS — streaks, scores, weekly board, history and achievements.
     Every panel renders the game you are looking at, so two games never appear
     to share one score.
     ======================================================================= */

  /*
   * Games register how they start. Panel buttons stay dumb: they name a game
   * and say whether it was the daily run, and whoever owns that game deals it.
   */
  var STARTERS = {};

  function registerStarter(gameId, starter) {
    if (gameId && typeof starter === "function") STARTERS[gameId] = starter;
  }

  /** Opens the right stage when a panel's own Play button is pressed. */
  function wireStart(scope) {
    function open(gameId, daily) {
      var stage = document.querySelector('[data-game-stage="' + gameId + '"]');
      if (stage && stage.hidden) {
        if (window.MarketRush && window.MarketRush.select) window.MarketRush.select(gameId);
        else stage.hidden = false;
      }
      if (STARTERS[gameId]) STARTERS[gameId](!!daily);
      var panel = document.getElementById(gameId === "market-match" ? "game-board-panel" : "rush-panel");
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      try {
        window.dispatchEvent(new CustomEvent(daily ? "cm:memory-daily" : "cm:memory-start"));
      } catch (e) { /* older browsers */ }
    }
    (scope || document).querySelectorAll("[data-start]").forEach(function (node) {
      node.addEventListener("click", function () { open("market-match", false); });
    });
    (scope || document).querySelectorAll("[data-daily]").forEach(function (node) {
      node.addEventListener("click", function () { open("market-match", true); });
    });
  }

  /*
   * Peer globals are guarded where the Game Centre touches them, the way the
   * rest of the app guards `window.API` and `window.Shell`: a script that fails
   * to load must never take the whole page down with it.
   */
  function esc(value) {
    return window.UI ? UI.escapeHtml(value) : String(value === undefined || value === null ? "" : value);
  }

  function ago(value) {
    return window.UI ? UI.timeAgo(value) : "";
  }

  function emptyState(icon, title, body, action) {
    if (window.UI) return UI.emptyState(icon, title, body, action);
    return '<div class="empty-state"><strong>' + esc(title) + "</strong><p>" + esc(body) + "</p>" +
      (action || "") + "</div>";
  }

  function renderSummaryPanel(gameId) {
    var host = document.getElementById("game-summary");
    if (!host) return;
    var state = load();
    var stats = statsFor(state, gameId);
    var streak = Number(state.daily_streak || 0);
    var dailyKey = today();
    var playedToday = !!(stats.daily && stats.daily[dailyKey]);
    var rush = gameId === "market-rush";

    host.innerHTML =
      '<div class="game-stat"><span>High score</span><b>' + stats.best.toLocaleString() + '</b><small>' +
        (rush ? "Best exact-change run" : "Across every level") + '</small></div>' +
      '<div class="game-stat"><span>Games played</span><b>' + stats.games + '</b><small>Since you joined</small></div>' +
      '<div class="game-stat"><span>Daily streak</span><b>' + streak + (streak === 1 ? " day" : " days") + '</b><small>Best: ' +
        Number(state.daily_best_streak || 0) + '</small></div>' +
      '<div class="game-stat"><span>Today</span><b>' + (playedToday ? Number(stats.daily[dailyKey].score).toLocaleString() : "Not yet") +
        '</b><small>' + (playedToday ? "Daily challenge score" : "Daily challenge open") + '</small></div>';
  }

  /**
   * Weekly board. A leaderboard is only meaningful with real players, so this
   * renders the signed-in account's genuine weekly best for the selected game
   * and states plainly that no other accounts have posted a score — it never
   * invents a rival.
   */
  function renderLeaderboardPanel(gameId) {
    var host = document.getElementById("game-leaderboard");
    if (!host) return;
    var user = currentUser();
    var stats = statsFor(load(), gameId || "market-match");
    var weekAgo = Date.now() - 7 * 86400000;
    var mine = (stats.history || []).filter(function (row) { return row.at >= weekAgo; });
    var best = mine.reduce(function (top, row) { return Math.max(top, Number(row.score || 0)); }, 0);

    if (!best) {
      host.innerHTML = emptyState(
        "trophy", "No scores this week yet",
        "Clear a board to put your name on the board. Scores reset every Monday.",
        '<button class="btn btn-primary mt-2" type="button" data-start>Play now</button>'
      );
      wireStart(host);
      return;
    }

    host.innerHTML =
      '<div class="board-row is-me">' +
        '<span class="board-row__rank">1</span>' +
        "<span><strong>" + esc((user && user.name) || "You") + "</strong>" +
          "<small>Your weekly best · " + mine.length + (mine.length === 1 ? " run" : " runs") + "</small></span>" +
        '<span class="board-row__score">' + best.toLocaleString() + "</span>" +
      "</div>" +
      '<div class="board-row">' +
        '<span class="board-row__rank">—</span>' +
        "<span><strong>No other players yet</strong>" +
          "<small>The weekly board fills as more accounts play. Rank is calculated from real scores only.</small></span>" +
        '<span class="board-row__score">—</span>' +
      "</div>";
  }

  function renderHistoryPanel(gameId) {
    var host = document.getElementById("game-history");
    if (!host) return;
    var rows = (statsFor(load(), gameId || "market-match").history || []).slice(-7);
    if (!rows.length) {
      host.innerHTML = emptyState(
        "chart", "No games logged yet",
        "Your last seven results — score, level and time — will appear here."
      );
      return;
    }
    var peak = rows.reduce(function (top, row) { return Math.max(top, Number(row.score || 0)); }, 1);
    host.innerHTML =
      '<div class="histogram" role="img" aria-label="Scores from your last ' + rows.length + ' games">' +
        rows.map(function (row) {
          var height = Math.max(6, Math.round((Number(row.score || 0) / peak) * 100));
          return '<span class="histogram__col">' +
            '<span class="histogram__bar" style="height:' + height + '%" title="' +
              esc(row.score.toLocaleString() + " · " + row.level + " · " + seconds(row.time)) + '"></span>' +
            "<small>" + new Date(row.at).toLocaleDateString("en-NG", { day: "numeric", month: "short" }) + "</small>" +
          "</span>";
        }).join("") +
      "</div>" +
      /* Wrapped so a four-column table scrolls inside its card on a 390px
         viewport instead of being clipped by the page-level overflow guard. */
      '<div class="table-wrap mt-3"><table><thead><tr><th scope="col">When</th><th scope="col">Level</th>' +
        '<th scope="col">Time</th><th scope="col">Score</th></tr></thead><tbody>' +
        rows.slice().reverse().map(function (row) {
          return "<tr><td>" + ago(new Date(row.at).toISOString()) + "</td>" +
            "<td>" + esc(String(row.level).replace(/^\w/, function (c) { return c.toUpperCase(); })) +
              (row.daily ? " · daily" : "") + "</td>" +
            "<td>" + seconds(row.time) + "</td>" +
            "<td>" + Number(row.score).toLocaleString() + "</td></tr>";
        }).join("") +
      "</tbody></table></div>";
  }

  function renderAchievementsPanel() {
    var host = document.getElementById("game-achievements");
    if (!host) return;
    var have = load().achievements || [];
    host.innerHTML = ACHIEVEMENTS.map(function (row) {
      var earned = have.indexOf(row.id) !== -1;
      return '<div class="ach ' + (earned ? "is-earned" : "is-locked") + '">' +
        '<span class="ach__mark" aria-hidden="true">' + Shell.icon(earned ? row.icon : "block", 20) + "</span>" +
        "<span><strong>" + row.label + "</strong><small>" + row.detail + "</small></span>" +
      "</div>";
    }).join("");
  }

  function renderPanels(gameId) {
    if (!hasPanels()) return;
    var id = gameId || activeGameId || "market-match";
    activeGameId = id;
    renderSummaryPanel(id);
    renderLeaderboardPanel(id);
    renderHistoryPanel(id);
    renderAchievementsPanel();
  }

  /* Which game the shared panels are describing. */
  var activeGameId = "market-match";

  /**
   * The single write path for every game in the catalogue.
   *
   * It records the run against that game, keeps the shared daily streak
   * honest across games, awards achievements from the shared list, repaints the
   * panels and tells the player what happened. Market Match still writes its own
   * legacy record in finish(); this is the generic equivalent the newer games
   * use, so no game needs to know how persistence works.
   */
  function record(result) {
    var outcome = { earned: [], isBest: false, streak: 0, best: 0, games: 0 };
    if (!result || !result.gameId) return outcome;

    var gameId = result.gameId;
    var score = Math.max(0, Math.round(Number(result.score || 0)));
    var state = load();
    var block = byGame(state, gameId);
    var dailyClaimBefore = state.daily_claimed;

    outcome.isBest = score > Number(block.best || 0);
    block.games = Number(block.games || 0) + 1;
    block.best = Math.max(Number(block.best || 0), score);
    if (result.level) {
      block.best_by_level[result.level] = Math.max(Number(block.best_by_level[result.level] || 0), score);
    }
    block.history = block.history.concat([{
      at: Date.now(),
      level: result.level || "run",
      score: score,
      time: Math.round(Number(result.time || 0)),
      rounds: Number(result.rounds || 0),
      daily: !!result.daily
    }]).slice(-24);

    state.sessions = Number(state.sessions || 0) + 1;
    state.last_played = Date.now();
    outcome.streak = result.daily ? noteDaily(state, gameId, score) : Number(state.daily_streak || 0);
    var newDailyStreakDay = !!result.daily && dailyClaimBefore !== today() && state.daily_claimed === today();

    var checks = {};
    if (gameId === "market-rush") {
      checks.first_game = true;
      checks.rush_first = true;
      checks.rush_combo5 = Number(result.bestCombo || 0) >= 5;
      checks.rush_exact10 = Number(result.exacts || 0) >= 10;
      checks.rush_1500 = score >= 1500;
      checks.score_2000 = score >= 2000;
    }

    state.achievements = state.achievements || [];
    Object.keys(checks).forEach(function (id) {
      if (checks[id] && state.achievements.indexOf(id) === -1) {
        state.achievements.push(id);
        outcome.earned.push(id);
      }
    });

    save(state);

    outcome.best = Number(block.best || 0);
    outcome.games = Number(block.games || 0);
    outcome.sessions = Number(state.sessions || 0);

    renderPanels(gameId);

    /* A win deserves to be told twice: a toast for the moment, and a row in the
       notification centre so the player can still find it tomorrow. */
    function entry(href) {
      return window.Shell && window.Shell.page ? Shell.page(href) : null;
    }
    var centre = window.Shell && window.Shell.pushNotification ? window.Shell.pushNotification : null;
    var gameName = result.gameName || gameId;

    if (window.UI) {
      if (outcome.isBest && score > 0) {
        UI.toast("New personal best — " + score.toLocaleString() + " points", "success", 4200);
      }
      if (newDailyStreakDay) {
        UI.toast(outcome.streak === 1
          ? "Daily streak started — 1 day"
          : "Daily streak — " + outcome.streak + " days running", "success", 4200);
      }
      outcome.earned.forEach(function (id) {
        var achievement = ACHIEVEMENTS.filter(function (row) { return row.id === id; })[0];
        if (achievement) UI.toast("Achievement unlocked: " + achievement.label, "success", 5200);
      });
    }

    if (centre) {
      if (outcome.isBest && score > 0) {
        centre({
          id: "game:" + gameId + ":best:" + score,
          title: "New personal best — " + gameName,
          body: "You scored " + score.toLocaleString() + ". Open the Game Centre to beat it.",
          icon: "trophy", href: entry("game-centre.html")
        });
      }
      if (newDailyStreakDay) {
        centre({
          id: "game:streak:" + today(),
          title: "Daily streak — " + outcome.streak + (outcome.streak === 1 ? " day" : " days"),
          body: outcome.streak === 1
            ? "You finished today's challenge. Play tomorrow to keep the flame alive."
            : "Play tomorrow's daily challenge to keep the flame alive.",
          icon: "flame", href: entry("game-centre.html")
        });
      }
      outcome.earned.forEach(function (id) {
        var achievement = ACHIEVEMENTS.filter(function (row) { return row.id === id; })[0];
        if (!achievement) return;
        centre({
          id: "achievement:" + id,
          title: "Achievement unlocked: " + achievement.label,
          body: achievement.detail,
          icon: achievement.icon, href: entry("game-centre.html")
        });
      });
    }

    return outcome;
  }

  /** Public shim so a game can ask for the panels without knowing the ids. */
  function ensurePanels(gameId) {
    renderPanels(gameId);
  }

  /* =======================================================================
     BOARD
     ======================================================================= */
  function initGameCentre() {
    var root = document.getElementById("game-root");
    if (!root) return;

    var user = currentUser();
    var state = load();
    var level = LEVELS[1];
    var mode = "practice";        // "practice" | "daily"
    var board = [];
    var first = null;
    var lock = false;
    var started = 0;
    var timer = null;
    var elapsed = 0;
    var score = 0;
    var combo = 0;
    var moves = 0;
    var misses = 0;
    var matched = 0;

    var tiles = document.getElementById("game-board");
    var hudScore = document.getElementById("hud-score");
    var hudTime = document.getElementById("hud-time");
    var hudMoves = document.getElementById("hud-moves");
    var hudCombo = document.getElementById("hud-combo");
    var status = document.getElementById("game-status");
    var levelsHost = document.getElementById("game-levels");

    function announce(message) {
      if (status) status.textContent = message;
    }

    /* ------------------------------------------------------------ rendering */
    function renderLevels() {
      if (!levelsHost) return;
      levelsHost.innerHTML = LEVELS.map(function (row) {
        return '<button type="button" class="deep-chip' + (row.id === level.id ? " is-active" : "") +
          '" data-level="' + row.id + '" aria-pressed="' + (row.id === level.id) + '">' +
          row.label + " · " + row.blurb + "</button>";
      }).join("");
      levelsHost.querySelectorAll("[data-level]").forEach(function (node) {
        node.addEventListener("click", function () {
          var picked = LEVELS.filter(function (row) { return row.id === node.dataset.level; })[0];
          if (!picked) return;
          level = picked;
          mode = "practice";
          deal(false);
        });
      });
    }

    function renderHud() {
      if (hudScore) hudScore.textContent = score.toLocaleString();
      if (hudTime) hudTime.textContent = seconds(elapsed);
      if (hudMoves) hudMoves.textContent = String(moves);
      if (hudCombo) {
        hudCombo.textContent = combo > 1 ? "×" + combo : "×1";
        hudCombo.classList.toggle("is-hot", combo > 1);
      }
    }

    function renderBoard() {
      if (!tiles) return;
      tiles.style.gridTemplateColumns = "repeat(" + level.cols + ", minmax(0, 1fr))";
      tiles.innerHTML = board.map(function (tile, index) {
        return '<button type="button" class="game-tile" data-index="' + index + '"' +
          ' aria-label="Hidden tile">' +
          '<span class="game-tile__face game-tile__face--back" aria-hidden="true">' + Shell.icon("grid", 22) + "</span>" +
          '<span class="game-tile__face game-tile__face--front" aria-hidden="true">' + Shell.icon(tile.icon, 34) + "</span>" +
        "</button>";
      }).join("");
    }

    function deal(isDaily) {
      mode = isDaily ? "daily" : "practice";
      if (isDaily) level = LEVELS[1];

      var icons = shuffle(TILE_ICONS, isDaily ? seeded(seedFrom("lafia-" + today())) : Math.random)
        .slice(0, level.pairs);
      var deck = [];
      icons.forEach(function (icon, pairIndex) {
        deck.push({ icon: icon, pair: pairIndex });
        deck.push({ icon: icon, pair: pairIndex });
      });
      board = shuffle(deck, isDaily ? seeded(seedFrom("deck-" + today())) : Math.random);

      first = null;
      lock = false;
      score = 0;
      combo = 0;
      moves = 0;
      misses = 0;
      matched = 0;
      elapsed = 0;
      started = Date.now();

      renderLevels();
      renderBoard();
      renderHud();
      startTimer();
      announce(isDaily
        ? "Daily challenge started — everyone gets this exact board today."
        : level.label + " board dealt. " + level.pairs + " pairs to find.");
    }

    function startTimer() {
      window.clearInterval(timer);
      timer = window.setInterval(function () {
        elapsed = (Date.now() - started) / 1000;
        renderHud();
      }, 250);
    }

    function stopTimer() {
      window.clearInterval(timer);
      timer = null;
      elapsed = (Date.now() - started) / 1000;
      renderHud();
    }

    /* ---------------------------------------------------------------- turns */
    function flip(node, index) {
      var tile = board[index];
      node.classList.remove("is-miss");
      node.classList.add("is-flipped");
      node.setAttribute("aria-label", "Revealed tile");

      if (!first) { first = { index: index, node: node, tile: tile }; return; }

      moves++;
      if (first.index === index) { renderHud(); return; }

      if (first.tile.pair === tile.pair) {
        matched++;
        combo = Math.min(combo + 1, 5);
        score += 100 * combo;
        first.node.classList.add("is-matched");
        node.classList.add("is-matched");
        first.node.disabled = true;
        node.disabled = true;
        first = null;
        renderHud();
        vibrate(12);
        announce("Match found. " + matched + " of " + level.pairs + " pairs cleared.");
        if (matched === level.pairs) finish();
        return;
      }

      misses++;
      combo = 0;
      var a = first.node;
      var b = node;
      a.classList.add("is-miss");
      b.classList.add("is-miss");
      lock = true;
      renderHud();
      announce("Not a pair — try again.");
      window.setTimeout(function () {
        a.classList.remove("is-flipped", "is-miss");
        b.classList.remove("is-flipped", "is-miss");
        a.setAttribute("aria-label", "Hidden tile");
        b.setAttribute("aria-label", "Hidden tile");
        lock = false;
      }, prefersReducedMotion() ? 90 : 620);
      first = null;
    }

    function vibrate(pattern) {
      try {
        if (navigator.vibrate && !prefersReducedMotion()) navigator.vibrate(pattern);
      } catch (e) { /* unsupported */ }
    }

    /* --------------------------------------------------------------- finish */
    function finish() {
      stopTimer();
      var bonus = Math.max(0, Math.round((level.par - elapsed) * 5));
      if (misses === 0) bonus += 250;
      var finalScore = score + bonus;

      state.games = Number(state.games || 0) + 1;
      state.best = Math.max(Number(state.best || 0), finalScore);
      state.best_by_level = state.best_by_level || {};
      state.best_by_level[level.id] = Math.max(Number(state.best_by_level[level.id] || 0), finalScore);
      state.history = (state.history || []).concat([{
        at: Date.now(),
        level: level.id,
        score: finalScore,
        time: Math.round(elapsed),
        misses: misses,
        daily: mode === "daily"
      }]).slice(-24);
      state.last_played = Date.now();

      var earned = [];

      if (mode === "daily") {
        var key = today();
        if (!state.daily[key]) {
          state.daily[key] = { score: finalScore, at: Date.now() };
          var previous = dayBefore(key);
          state.daily_streak = state.daily[previous] ? Number(state.daily_streak || 0) + 1 : 1;
          state.daily_best_streak = Math.max(Number(state.daily_best_streak || 0), state.daily_streak);
        } else {
          state.daily[key].score = Math.max(Number(state.daily[key].score || 0), finalScore);
        }
      }

      var checks = {
        first_game: true,
        first_daily: mode === "daily",
        streak_3: Number(state.daily_streak || 0) >= 3,
        streak_7: Number(state.daily_streak || 0) >= 7,
        flawless: misses === 0,
        speed: level.id === "classic" && elapsed < 60,
        score_2000: finalScore >= 2000
      };
      state.achievements = state.achievements || [];
      Object.keys(checks).forEach(function (id) {
        if (checks[id] && state.achievements.indexOf(id) === -1) {
          state.achievements.push(id);
          earned.push(id);
        }
      });

      save(state);
      renderPanels("market-match");
      renderHud();

      announce("Board cleared in " + seconds(elapsed) + " with a score of " + finalScore.toLocaleString() + ".");
      if (window.UI) {
        UI.toast("Board cleared — " + finalScore.toLocaleString() + " points", "success");
      }
      earned.forEach(function (id) {
        var achievement = ACHIEVEMENTS.filter(function (row) { return row.id === id; })[0];
        if (achievement && window.UI) UI.toast("Achievement unlocked: " + achievement.label, "success", 5200);
      });
    }


    /* ------------------------------------------------------------- listeners */
    if (tiles) {
      tiles.addEventListener("click", function (event) {
        var node = event.target.closest(".game-tile");
        if (!node || lock || node.disabled || node.classList.contains("is-flipped")) return;
        flip(node, Number(node.dataset.index));
      });

      /* Arrow-key navigation across the grid — a 16-tile board is unusable with
         Tab alone, and the design bible puts keyboard access in the system. */
      tiles.addEventListener("keydown", function (event) {
        var steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: level.cols, ArrowUp: -level.cols };
        if (!(event.key in steps)) return;
        var node = event.target.closest(".game-tile");
        if (!node) return;
        var target = Number(node.dataset.index) + steps[event.key];
        if (target < 0 || target >= board.length) return;
        event.preventDefault();
        var next = tiles.querySelector('[data-index="' + target + '"]');
        if (next && !next.disabled) next.focus();
      });
    }

    /* The shared Play/Daily buttons on this page start this board. */
    registerStarter("market-match", function (daily) {
      var panel = document.getElementById("game-board-panel");
      if (panel && panel.scrollIntoView) {
        panel.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      }
      deal(!!daily);
    });
    wireStart(document);

    var restart = document.getElementById("game-restart");
    if (restart) restart.addEventListener("click", function () { deal(mode === "daily"); });

    if (!user) {
      announce("Sign in to keep your scores, streaks and achievements.");
    }

    renderLevels();
    /* Whatever the catalogue has open wins — never clobber the selected game. */
    renderPanels(activeGameId);
    deal(false);
  }

  /* =======================================================================
     HOME MODULE — the Game Centre promoted near the top of Home
     ======================================================================= */
  function renderHomeModule(host) {
    if (!host) return;
    var state = load();
    var streak = Number(state.daily_streak || 0);
    var dailyKey = today();
    var game = GAMES[0];
    var stats = statsFor(state, game.id);
    var playedToday = !!(stats.daily && stats.daily[dailyKey]);

    host.innerHTML =
      '<div class="deep-surface game-module">' +
        "<div>" +
          '<span class="game-badge">' + Shell.icon("game", 14) + "Game Centre</span>" +
          '<h2 style="margin:var(--sp-3) 0 var(--sp-2)">' + UI.escapeHtml(game.name) + "</h2>" +
          '<p style="max-width:52ch">' + UI.escapeHtml(game.tagline) +
            ". Everything runs offline on your phone — no downloads, no data cost.</p>" +
          '<div class="game-actions mt-3">' +
            '<a class="btn btn-primary" href="' + UI.pageUrl("game-centre.html") + '">' +
              (playedToday ? "Play again" : "Play today's challenge") + "</a>" +
            '<a class="btn btn-ghost" href="' + UI.pageUrl("game-centre.html") + '#achievements">Achievements</a>' +
          "</div>" +
        "</div>" +
        '<div class="game-module__stats">' +
          '<div class="game-module__stat"><b>' + Number(stats.best || 0).toLocaleString() + "</b><span>High score</span></div>" +
          '<div class="game-module__stat"><b>' + streak + "</b><span>Day streak</span></div>" +
          '<div class="game-module__stat"><b>' + Number(stats.games || 0) + "</b><span>Runs</span></div>" +
        "</div>" +
      "</div>";
  }

  window.GameCentre = {
    GAMES: GAMES,
    ACHIEVEMENTS: ACHIEVEMENTS,
    LEVELS: LEVELS,
    init: initGameCentre,
    renderHomeModule: renderHomeModule,
    renderPanels: renderPanels,
    ensurePanels: ensurePanels,
    statsFor: function (state, gameId) { return statsFor(state || load(), gameId); },
    registerStarter: registerStarter,
    record: record,
    state: load,
    today: today
  };
})(window, document);
