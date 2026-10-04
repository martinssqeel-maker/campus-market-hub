/* ==========================================================================
   api.js – all communication with the Campus Marketplace Flask API.

   Responsibilities
   ----------------
   • one place that knows the API base URL
   • attach the JWT to every authenticated request
   • unwrap the { success, message, data } envelope
   • surface friendly errors (network down, session expired, validation)
   • refresh the access token automatically when it expires

   Exposed globally as `API` (no bundler required – plain <script> friendly).
   ========================================================================== */

(function (window, document) {
  "use strict";

  /* -----------------------------------------------------------------------
     Configuration
     ----------------------------------------------------------------------- */

  // When the frontend is served by Flask the API lives on the same origin.
  // Opening the HTML files directly (file://) or via Live Server (:5500)
  // falls back to 127.0.0.1:5000 – override with:
  //   <script>window.CAMPUS_API_BASE = "https://my-host/api";</script>
  var FILE_PROTOCOL = window.location.protocol === "file:";
  var LIVE_SERVER_PORTS = ["5500", "5501", "3000", "8080", "5173", "4200", "8000"];

  function resolveBaseUrl() {
    if (window.CAMPUS_API_BASE) return window.CAMPUS_API_BASE.replace(/\/$/, "");

    var port = window.location.port;
    var isLiveServer = LIVE_SERVER_PORTS.indexOf(port) !== -1;
    if (FILE_PROTOCOL || isLiveServer) {
      return window.location.protocol + "//" + window.location.hostname + ":5000/api";
    }
    return "/api";
  }

  var BASE_URL = resolveBaseUrl();

  var STORAGE = {
    access: "cm_access_token",
    refresh: "cm_refresh_token",
    user: "cm_user"
  };

  /* -----------------------------------------------------------------------
     Token helpers
     ----------------------------------------------------------------------- */
  var TokenStore = {
    get: function (kind) {
      try { return window.localStorage.getItem(STORAGE[kind]); } catch (e) { return null; }
    },
    set: function (kind, value) {
      try { window.localStorage.setItem(STORAGE[kind], value); } catch (e) { /* private mode */ }
    },
    clear: function () {
      try {
        window.localStorage.removeItem(STORAGE.access);
        window.localStorage.removeItem(STORAGE.refresh);
        window.localStorage.removeItem(STORAGE.user);
      } catch (e) { /* ignore */ }
    },
    getUser: function () {
      try {
        var raw = window.localStorage.getItem(STORAGE.user);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    setUser: function (user) {
      try { window.localStorage.setItem(STORAGE.user, JSON.stringify(user)); } catch (e) { /* ignore */ }
    },
    setSession: function (data) {
      if (!data) return;
      if (data.access_token) TokenStore.set("access", data.access_token);
      if (data.refresh_token) TokenStore.set("refresh", data.refresh_token);
      if (data.user) TokenStore.setUser(data.user);
    }
  };

  /* -----------------------------------------------------------------------
     Error type – carries the HTTP status so callers can react precisely
     ----------------------------------------------------------------------- */
  function ApiError(message, status, payload) {
    this.name = "ApiError";
    this.message = message || "Something went wrong";
    this.status = status || 0;
    this.payload = payload || {};
    this.errors = (payload && payload.errors) || null;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  /* -----------------------------------------------------------------------
     Low-level request
     ----------------------------------------------------------------------- */
  function buildUrl(path, query) {
    var url = BASE_URL + (path.charAt(0) === "/" ? path : "/" + path);
    if (query) {
      var parts = [];
      Object.keys(query).forEach(function (key) {
        var value = query[key];
        if (value === undefined || value === null || value === "") return;
        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
      });
      if (parts.length) url += (url.indexOf("?") === -1 ? "?" : "&") + parts.join("&");
    }
    return url;
  }

  function request(method, path, options) {
    options = options || {};
    var token = TokenStore.get("access");

    var headers = { "Accept": "application/json" };
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    if (options.auth !== false && token) headers["Authorization"] = "Bearer " + token;
    Object.keys(options.headers || {}).forEach(function (key) {
      headers[key] = options.headers[key];
    });

    var init = { method: method, headers: headers };
    if (options.body !== undefined) {
      init.body = options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body);
    }

    return window.fetch(buildUrl(path, options.query), init)
      .then(function (response) {
        return response.text().then(function (text) {
          var payload = {};
          if (text) {
            try { payload = JSON.parse(text); } catch (e) { payload = { message: text }; }
          }

          // --- expired / missing token ------------------------------------
          if (response.status === 401 && options.retry !== false &&
              TokenStore.get("refresh") && !options.isRefreshCall) {
            return refreshAccessToken().then(function (ok) {
              if (!ok) throw new ApiError(payload.message || "Please log in again", 401, payload);
              var retryOptions = Object.assign({}, options, { retry: false });
              return request(method, path, retryOptions);
            }).catch(function () {
              throw new ApiError(payload.message || "Your session has expired", 401, payload);
            });
          }

          if (!response.ok) {
            throw new ApiError(
              payload.message || ("Request failed (" + response.status + ")"),
              response.status,
              payload
            );
          }
          return payload;
        });
      })
      .catch(function (error) {
        if (error instanceof ApiError) throw error;
        // Network / CORS / server-down problems land here.
        throw new ApiError(
          "Cannot reach the server. Make sure the backend is running (python app.py).",
          0,
          { original: String(error) }
        );
      });
  }

  /* -----------------------------------------------------------------------
     Automatic access-token refresh (single-flight)
     ----------------------------------------------------------------------- */
  var refreshPromise = null;

  function refreshAccessToken() {
    if (refreshPromise) return refreshPromise;

    var refreshToken = TokenStore.get("refresh");
    if (!refreshToken) return Promise.resolve(false);

    refreshPromise = window.fetch(buildUrl("/auth/refresh"), {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + refreshToken,
        "Accept": "application/json"
      }
    })
      .then(function (response) {
        if (!response.ok) return false;
        return response.json().then(function (payload) {
          var token = payload && payload.data && payload.data.access_token;
          if (token) { TokenStore.set("access", token); return true; }
          return false;
        });
      })
      .catch(function () { return false; })
      .then(function (ok) {
        refreshPromise = null;
        if (!ok) TokenStore.clear();
        return ok;
      });

    return refreshPromise;
  }

  /* -----------------------------------------------------------------------
     Public convenience helpers
     ----------------------------------------------------------------------- */
  var API = {
    baseUrl: BASE_URL,
    ApiError: ApiError,
    tokens: TokenStore,

    isLoggedIn: function () { return !!TokenStore.get("access"); },
    currentUser: function () { return TokenStore.getUser(); },

    request: request,

    get: function (path, query, options) {
      return request("GET", path, Object.assign({ query: query }, options || {}));
    },
    post: function (path, body, options) {
      return request("POST", path, Object.assign({ body: body || {} }, options || {}));
    },
    put: function (path, body, options) {
      return request("PUT", path, Object.assign({ body: body || {} }, options || {}));
    },
    del: function (path, body, options) {
      return request("DELETE", path, Object.assign({ body: body }, options || {}));
    },

    /** Multipart upload with progress (used by the post-listing form). */
    upload: function (path, formData, onProgress) {
      var token = TokenStore.get("access");
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", buildUrl(path), true);
        if (token) xhr.setRequestHeader("Authorization", "Bearer " + token);
        xhr.setRequestHeader("Accept", "application/json");

        if (onProgress) {
          xhr.upload.addEventListener("progress", function (event) {
            if (event.lengthComputable) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          });
        }
        xhr.onload = function () {
          var payload = {};
          try { payload = JSON.parse(xhr.responseText); } catch (e) { payload = {}; }
          if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
          else reject(new ApiError(payload.message || "Upload failed", xhr.status, payload));
        };
        xhr.onerror = function () {
          reject(new ApiError("Upload failed – check your connection", 0, {}));
        };
        xhr.send(formData);
      });
    },

    /* ---------------------------------------------------------------------
       Endpoint shortcuts – keeps page code readable and DRY
       --------------------------------------------------------------------- */
    auth: {
      signup: function (payload) { return API.post("/auth/signup", payload, { auth: false }); },
      login: function (email, password) {
        return API.post("/auth/login", { email: email, password: password }, { auth: false });
      },
      logout: function () { return API.post("/auth/logout", {}); },
      me: function () { return API.get("/auth/me"); },
      updateMe: function (payload) { return API.put("/auth/me", payload); },
      changePassword: function (payload) { return API.post("/auth/me/password", payload); },
      checkEmail: function (email) {
        return API.post("/auth/check-email", { email: email }, { auth: false });
      }
    },

    products: {
      list: function (query) { return API.get("/products", query); },
      get: function (id) { return API.get("/products/" + id); },
      create: function (payload) { return API.post("/products", payload); },
      update: function (id, payload) { return API.put("/products/" + id, payload); },
      remove: function (id) { return API.del("/products/" + id); },
      categories: function () { return API.get("/products/categories"); }
    },

    accommodation: {
      list: function (query) { return API.get("/accommodation", query); },
      get: function (id) { return API.get("/accommodation/" + id); },
      create: function (payload) { return API.post("/accommodation", payload); },
      update: function (id, payload) { return API.put("/accommodation/" + id, payload); },
      remove: function (id) { return API.del("/accommodation/" + id); },
      types: function () { return API.get("/accommodation/types"); },
      locations: function () { return API.get("/accommodation/locations"); }
    },

    events: {
      list: function (query) { return API.get("/events", query); },
      get: function (id) { return API.get("/events/" + id); },
      create: function (payload) { return API.post("/events", payload); },
      update: function (id, payload) { return API.put("/events/" + id, payload); },
      remove: function (id) { return API.del("/events/" + id); },
      upcoming: function (limit) { return API.get("/events/upcoming", { limit: limit }); }
    },

    services: {
      list: function (query) { return API.get("/services", query); },
      get: function (id) { return API.get("/services/" + id); },
      create: function (payload) { return API.post("/services", payload); },
      update: function (id, payload) { return API.put("/services/" + id, payload); },
      remove: function (id) { return API.del("/services/" + id); }
    },

    users: {
      get: function (id) { return API.get("/users/" + id); },
      update: function (id, payload) { return API.put("/users/" + id, payload); },
      listings: function (id) { return API.get("/users/" + id + "/listings"); },
      stats: function (id) { return API.get("/users/" + id + "/stats"); },
      reviews: function (id) { return API.get("/users/" + id + "/reviews"); },
      review: function (id, payload) { return API.post("/users/" + id + "/reviews", payload); }
    },

    favorites: {
      toggle: function (itemType, itemId) {
        return API.post("/favorites", { item_type: itemType, item_id: itemId });
      },
      list: function (itemType) { return API.get("/favorites", { item_type: itemType }); },
      ids: function () { return API.get("/favorites/ids"); },
      remove: function (itemType, itemId) {
        return API.del("/favorites/" + itemType + "/" + itemId);
      }
    },

    admin: {
      stats: function () { return API.get("/admin/stats"); },
      activity: function () { return API.get("/admin/activity"); },
      pending: function (query) { return API.get("/admin/pending", query); },
      allListings: function (query) { return API.get("/admin/all-listings", query); },
      approve: function (id, itemType) {
        return API.post("/admin/approve/" + id, { item_type: itemType });
      },
      reject: function (id, itemType, reason) {
        return API.post("/admin/reject/" + id, { item_type: itemType, reason: reason || "" });
      },
      feature: function (itemType, id) { return API.post("/admin/feature/" + itemType + "/" + id, {}); },
      flag: function (itemType, id, reason) {
        return API.post("/admin/flag/" + itemType + "/" + id, { reason: reason });
      },
      deleteListing: function (itemType, id) { return API.del("/admin/listing/" + itemType + "/" + id); },
      users: function (query) { return API.get("/admin/users", query); },
      user: function (id) { return API.get("/admin/users/" + id); },
      verify: function (id, verified) {
        return API.post("/admin/verify/" + id, verified === undefined ? {} : { verified: verified });
      },
      suspend: function (id, active) {
        return API.post("/admin/suspend/" + id, active === undefined ? {} : { active: active });
      },
      makeAdmin: function (id, admin) {
        return API.post("/admin/make-admin/" + id, admin === undefined ? {} : { admin: admin });
      }
    },

    uploads: {
      image: function (file, onProgress) {
        var form = new FormData();
        form.append("image", file);
        return API.upload("/uploads/image", form, onProgress);
      }
    },

    misc: {
      health: function () { return API.get("/health", null, { auth: false }); },
      stats: function () { return API.get("/stats", null, { auth: false }); },
      meta: function () { return API.get("/meta", null, { auth: false }); },
      search: function (q, limit) { return API.get("/search", { q: q, limit: limit }, { auth: false }); },
      popular: function () { return API.get("/popular", null, { auth: false }); }
    }
  };

  /* -----------------------------------------------------------------------
     Session bootstrap – verify the stored token is still valid
     ----------------------------------------------------------------------- */
  API.loadSession = function () {
    if (!API.isLoggedIn()) return Promise.resolve(null);
    return API.auth.me()
      .then(function (payload) {
        TokenStore.setUser(payload.data.user);
        return payload.data;
      })
      .catch(function (error) {
        if (error.status === 401) TokenStore.clear();
        return null;
      });
  };

  window.API = API;
})(window, document);
