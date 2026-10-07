/* ==========================================================================
   auth.js – registration, login, session guards and the auth forms.

   Depends on: api.js, ui.js
   Exposed globally as `Auth`.
   ========================================================================== */

(function (window, document) {
  "use strict";

  var Auth = {
    /* ---------------------------------------------------------------------
       Session state
       --------------------------------------------------------------------- */
    user: function () {
      return API.currentUser();
    },

    isLoggedIn: function () {
      return API.isLoggedIn();
    },

    isAdmin: function () {
      var user = API.currentUser();
      return !!(user && user.user_type === "admin");
    },

    /** Redirect to the login page (remembering where the user was headed). */
    requireLogin: function (message) {
      if (API.isLoggedIn()) return true;
      UI.toast(message || "Please log in to continue", "info");
      var next = encodeURIComponent(window.location.pathname + window.location.search);
      window.setTimeout(function () {
        window.location.href = UI.pageUrl("login.html") + "?next=" + next;
      }, 700);
      return false;
    },

    requireAdmin: function () {
      if (!Auth.requireLogin()) return false;
      if (!Auth.isAdmin()) {
        UI.toast("Administrator access is required for that page", "error");
        window.setTimeout(function () { window.location.href = UI.pageUrl("home.html"); }, 900);
        return false;
      }
      return true;
    },

    /* ---------------------------------------------------------------------
       Login / signup / logout
       --------------------------------------------------------------------- */
    login: function (email, password) {
      return API.auth.login(email, password).then(function (payload) {
        API.tokens.setSession(payload.data);
        UI.renderHeader();
        return payload.data.user;
      });
    },

    signup: function (payload) {
      return API.auth.signup(payload).then(function (response) {
        API.tokens.setSession(response.data);
        UI.renderHeader();
        return response.data.user;
      });
    },

    logout: function () {
      return API.auth.logout()
        .catch(function () { /* token already invalid – clear locally anyway */ })
        .then(function () {
          API.tokens.clear();
          UI.toast("You have been logged out", "success");
          window.setTimeout(function () { window.location.href = UI.root + "index.html"; }, 600);
        });
    },

    updateProfile: function (payload) {
      return API.auth.updateMe(payload).then(function (response) {
        API.tokens.setUser(response.data);
        UI.renderHeader();
        return response.data;
      });
    },

    /* ---------------------------------------------------------------------
       Form helpers
       --------------------------------------------------------------------- */
    fieldError: function (input, message) {
      if (!input) return;
      var holder = input.parentElement.querySelector(".field-error") ||
        input.closest(".form-group") && input.closest(".form-group").querySelector(".field-error");
      input.classList.toggle("invalid", !!message);
      if (holder) holder.textContent = message || "";
    },

    clearErrors: function (form) {
      form.querySelectorAll(".field-error").forEach(function (node) { node.textContent = ""; });
      form.querySelectorAll(".invalid").forEach(function (node) { node.classList.remove("invalid"); });
    },

    /** Paint server-side validation errors returned by the API. */
    paintErrors: function (form, errors) {
      Object.keys(errors || {}).forEach(function (field) {
        var input = form.querySelector('[name="' + field + '"]');
        Auth.fieldError(input, errors[field]);
      });
    },

    setLoading: function (button, loading, label) {
      if (!button) return;
      if (loading) {
        button.dataset.original = button.dataset.original || button.innerHTML;
        button.disabled = true;
        button.classList.add("is-loading");
        button.setAttribute("aria-busy", "true");
        button.innerHTML = label || "Please wait…";
      } else {
        button.disabled = false;
        button.classList.remove("is-loading");
        button.removeAttribute("aria-busy");
        if (button.dataset.original) button.innerHTML = button.dataset.original;
      }
    },

    /**
     * Carry the "where you were heading" intent across the login ↔ signup
     * links, so someone bounced from an app page lands back there afterwards.
     */
    preserveNext: function () {
      var next = UI.queryParam("next");
      if (!next) return;
      document.querySelectorAll("[data-next-preserve]").forEach(function (link) {
        var base = String(link.getAttribute("href") || "").split("?")[0];
        link.setAttribute("href", base + "?next=" + encodeURIComponent(next));
      });
    },

    /** Client-side validation rules shared by the login & signup forms. */
    validate: {
      name: function (value) {
        if (!value || value.trim().length < 3) return "Enter your full name (at least 3 letters)";
        return "";
      },
      email: function (value) {
        if (!value) return "Email is required";
        if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(value.trim())) return "Enter a valid email address";
        return "";
      },
      phone: function (value) {
        var digits = String(value || "").replace(/[\s\-()]/g, "");
        if (!digits) return "Phone number is required";
        if (!/^(\+?234|0)[789][01]\d{8}$/.test(digits)) {
          return "Enter a valid Nigerian number, e.g. 08031234567";
        }
        return "";
      },
      password: function (value) {
        if (!value || value.length < 6) return "Password must be at least 6 characters";
        if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
          return "Password must contain a letter and a number";
        }
        return "";
      },
      confirm: function (value, other) {
        if (value !== other) return "Passwords do not match";
        return "";
      }
    },

    /* ---------------------------------------------------------------------
       Page initialisers
       --------------------------------------------------------------------- */
    initLoginPage: function () {
      var form = document.getElementById("login-form");
      if (!form) return;

      // Already logged in? go straight to the dashboard.
      if (API.isLoggedIn()) {
        UI.toast("You are already logged in", "info");
        window.setTimeout(function () { window.location.href = UI.pageUrl("home.html"); }, 700);
      }

      var emailInput = form.querySelector('[name="email"]');
      var passwordInput = form.querySelector('[name="password"]');
      var submit = form.querySelector('button[type="submit"]');

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        Auth.clearErrors(form);

        var emailError = Auth.validate.email(emailInput.value);
        var passwordError = passwordInput.value ? "" : "Password is required";
        Auth.fieldError(emailInput, emailError);
        Auth.fieldError(passwordInput, passwordError);
        if (emailError || passwordError) return;

        Auth.setLoading(submit, true, "Logging in…");
        Auth.login(emailInput.value.trim(), passwordInput.value)
          .then(function (user) {
            UI.toast("Welcome back, " + user.name.split(" ")[0] + "!", "success");
            var next = UI.queryParam("next");
            window.setTimeout(function () {
              window.location.href = next ? decodeURIComponent(next)
                : (user.user_type === "admin" ? UI.pageUrl("admin-dashboard.html") : UI.pageUrl("home.html"));
            }, 700);
          })
          .catch(function (error) {
            Auth.setLoading(submit, false);
            Auth.paintErrors(form, error.errors);
            UI.toast(error.message, "error");
          });
      });

    },

    initSignupPage: function () {
      var form = document.getElementById("signup-form");
      if (!form) return;

      var nameInput = form.querySelector('[name="name"]');
      var emailInput = form.querySelector('[name="email"]');
      var phoneInput = form.querySelector('[name="phone"]');
      var passwordInput = form.querySelector('[name="password"]');
      var confirmInput = form.querySelector('[name="confirm_password"]');
      var typeSelect = form.querySelector('[name="user_type"]');
      var submit = form.querySelector('button[type="submit"]');

      // Live email availability check (debounced).
      var checkEmail = UI.debounce(function () {
        var value = emailInput.value.trim();
        if (Auth.validate.email(value)) return;
        API.auth.checkEmail(value).then(function (payload) {
          Auth.fieldError(emailInput, payload.data.available ? "" : "That email is already registered");
        }).catch(function () { /* ignore – server will validate on submit anyway */ });
      }, 600);
      emailInput.addEventListener("blur", checkEmail);

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        Auth.clearErrors(form);

        var errors = {
          name: Auth.validate.name(nameInput.value),
          email: Auth.validate.email(emailInput.value),
          phone: Auth.validate.phone(phoneInput.value),
          password: Auth.validate.password(passwordInput.value),
          confirm_password: Auth.validate.confirm(confirmInput.value, passwordInput.value)
        };
        var hasError = Object.keys(errors).some(function (key) {
          Auth.fieldError(form.querySelector('[name="' + key + '"]'), errors[key]);
          return !!errors[key];
        });
        if (hasError) {
          UI.toast("Please fix the highlighted fields", "error");
          return;
        }

        var terms = form.querySelector("#su-terms");
        if (terms && !terms.checked) {
          UI.toast("Please confirm you will trade responsibly", "error");
          return;
        }

        Auth.setLoading(submit, true, "Creating your account…");
        Auth.signup({
          name: nameInput.value.trim(),
          email: emailInput.value.trim(),
          phone: phoneInput.value.trim(),
          password: passwordInput.value,
          confirm_password: confirmInput.value,
          user_type: typeSelect ? typeSelect.value : "student",
          department: (form.querySelector('[name="department"]') || {}).value || "",
          level: (form.querySelector('[name="level"]') || {}).value || ""
        })
          .then(function (user) {
            UI.toast("Welcome to Campus Marketplace, " + user.name.split(" ")[0] + "!", "success");
            var nextSignup = UI.queryParam("next");
            window.setTimeout(function () {
              window.location.href = nextSignup
                ? decodeURIComponent(nextSignup)
                : UI.pageUrl("home.html");
            }, 900);
          })
          .catch(function (error) {
            Auth.setLoading(submit, false);
            Auth.paintErrors(form, error.errors);
            UI.toast(error.message, "error");
          });
      });
    },

    /**
     * Live password strength meter. Deliberately favours passphrases over
     * punctuation rules — the advice is what actually makes a password strong.
     */
    initPasswordMeter: function () {
      var input = document.getElementById("su-password");
      var meter = document.getElementById("su-password-meter");
      if (!input || !meter) return;

      var label = meter.querySelector(".meter__label");
      var base = label ? label.textContent : "";
      var ADVICE = [
        "Too short — aim for at least 6 characters",
        "Weak — add a number as well",
        "Fair — mix letters and numbers",
        "Strong — a longer phrase would be even better",
        "Very strong — easy to remember, hard to guess"
      ];

      function score(value) {
        if (!value) return 0;
        var points = 0;
        if (value.length >= 6) points++;
        if (value.length >= 10) points++;
        if (/[A-Za-z]/.test(value) && /\d/.test(value)) points++;
        if (/[^A-Za-z0-9]/.test(value) || value.length >= 14) points++;
        return Math.max(1, Math.min(4, points));
      }

      function paint() {
        var level = score(input.value);
        meter.dataset.level = String(level);
        if (label) label.textContent = level ? ADVICE[level - 1] : base;
      }

      input.addEventListener("input", paint);
      paint();
    },

    /** Show/hide password buttons. */
    initPasswordToggles: function () {
      document.querySelectorAll("[data-toggle-password]").forEach(function (button) {
        button.addEventListener("click", function () {
          var input = document.getElementById(button.dataset.togglePassword);
          if (!input) return;
          var showing = input.type === "text";
          input.type = showing ? "password" : "text";
          button.textContent = showing ? "Show" : "Hide";
        });
      });
    },

    init: function () {
      Auth.initLoginPage();
      Auth.initSignupPage();
      Auth.initPasswordMeter();
      Auth.initPasswordToggles();
      Auth.preserveNext();
    }
  };

  window.Auth = Auth;
  document.addEventListener("DOMContentLoaded", function () { Auth.init(); });
})(window, document);
