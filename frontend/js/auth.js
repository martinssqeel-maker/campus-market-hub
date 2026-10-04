/* Authentication, session navigation and listing submission forms. */
(() => {
  'use strict';
  const api = window.CampusAPI;
  const ui = window.CampusUI;

  function showFormMessage(form, message, success = false) {
    const box = form?.querySelector('[data-form-alert]') || document.querySelector('[data-form-alert]');
    if (!box) return;
    box.textContent = message;
    box.classList.toggle('success', success);
    box.classList.add('is-visible');
  }

  function clearFormMessage(form) {
    const box = form?.querySelector('[data-form-alert]') || document.querySelector('[data-form-alert]');
    if (box) { box.textContent = ''; box.classList.remove('is-visible', 'success'); }
  }

  function safeNext() {
    const next = new URLSearchParams(location.search).get('next');
    if (!next) return '/';
    try {
      const parsed = new URL(next, location.origin);
      return parsed.origin === location.origin && !parsed.pathname.startsWith('//')
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : '/';
    } catch (_) { return '/'; }
  }

  function setBusy(form, busy, label) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.innerHTML;
      button.disabled = true;
      button.textContent = label || 'Please wait…';
    } else {
      button.disabled = false;
      if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
    }
  }

  async function submitLogin(form) {
    clearFormMessage(form);
    if (!form.checkValidity()) { form.reportValidity(); return; }
    setBusy(form, true, 'Signing in…');
    try {
      const data = await api.post('auth/login', Object.fromEntries(new FormData(form).entries()));
      api.setSession(data.access_token, data.user);
      location.replace(safeNext());
    } catch (error) {
      showFormMessage(form, error.message || 'Sign in failed. Please try again.');
    } finally { setBusy(form, false); }
  }

  async function submitSignup(form) {
    clearFormMessage(form);
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const values = Object.fromEntries(new FormData(form).entries());
    if (String(values.password || '').length < 8) {
      showFormMessage(form, 'Choose a password with at least 8 characters.');
      return;
    }
    setBusy(form, true, 'Creating account…');
    try {
      const data = await api.post('auth/signup', values);
      api.setSession(data.access_token, data.user);
      location.replace('/');
    } catch (error) {
      showFormMessage(form, error.message || 'Could not create your account. Please try again.');
    } finally { setBusy(form, false); }
  }

  function setupAuthForms() {
    const login = document.querySelector('#login-form');
    const signup = document.querySelector('#signup-form');
    login?.addEventListener('submit', (event) => { event.preventDefault(); submitLogin(login); });
    signup?.addEventListener('submit', (event) => { event.preventDefault(); submitSignup(signup); });

    document.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-toggle-password]');
      if (toggle) {
        const input = document.getElementById(toggle.dataset.togglePassword);
        if (!input) return;
        const showing = input.type === 'password';
        input.type = showing ? 'text' : 'password';
        toggle.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
      }

      const logout = event.target.closest('[data-logout]');
      if (logout) {
        event.preventDefault();
        signOut(logout);
      }
    });
  }

  async function signOut(button) {
    if (button) button.disabled = true;
    try {
      if (api.getToken()) await api.post('auth/logout', {});
    } catch (_) { /* Clear the local session even if the device is offline. */ }
    api.clearSession();
    location.replace('/');
  }

  const API_ROUTES = {
    product: 'products',
    accommodation: 'accommodation',
    event: 'events',
    service: 'services',
  };

  function setupListingForm() {
    const form = document.querySelector('#listing-form');
    if (!form) return;
    const tabs = [...document.querySelectorAll('[data-listing-type]')];
    const fileInput = form.querySelector('input[type="file"]');
    const preview = form.querySelector('[data-upload-preview]');
    const allowedTypes = new Set(['product', 'accommodation', 'event', 'service']);
    let type = new URLSearchParams(location.search).get('type') || 'product';
    if (!allowedTypes.has(type)) type = 'product';

    function chooseType(newType) {
      if (!allowedTypes.has(newType)) return;
      type = newType;
      tabs.forEach((tab) => {
        const active = tab.dataset.listingType === type;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      form.querySelectorAll('[data-show-for]').forEach((field) => {
        const shown = field.dataset.showFor.split(',').map((value) => value.trim()).includes(type);
        field.hidden = !shown;
        field.querySelectorAll('input, select, textarea').forEach((input) => { input.disabled = !shown; });
      });

      const category = form.elements.namedItem('category');
      const price = form.elements.namedItem('price');
      const locationField = form.elements.namedItem('location');
      const rooms = form.elements.namedItem('rooms');
      const roomType = form.elements.namedItem('room_type');
      const eventDate = form.elements.namedItem('date');
      if (category) category.required = ['product', 'event', 'service'].includes(type);
      if (price) price.required = ['product', 'accommodation'].includes(type);
      if (price) price.placeholder = type === 'service' ? 'Leave blank if negotiable' : 'e.g. 12000';
      if (form.querySelector('[data-price-hint]')) form.querySelector('[data-price-hint]').textContent = type === 'service' ? 'Optional — leave blank if negotiable.' : 'Use a fair, clear price.';
      if (locationField) locationField.required = true;
      if (rooms) rooms.required = type === 'accommodation';
      if (roomType) roomType.required = type === 'accommodation';
      if (eventDate) eventDate.required = type === 'event';
      clearFormMessage(form);
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => chooseType(tab.dataset.listingType)));
    chooseType(type);

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) { if (preview) { preview.removeAttribute('src'); preview.style.display = 'none'; } return; }
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
        fileInput.value = '';
        showFormMessage(form, 'Choose a JPG, PNG, WEBP or GIF image.');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        fileInput.value = '';
        showFormMessage(form, 'Images must be 5 MiB or smaller.');
        return;
      }
      clearFormMessage(form);
      if (preview) {
        preview.src = URL.createObjectURL(file);
        preview.style.display = 'block';
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearFormMessage(form);
      if (!api.getToken() || !api.getUser()) {
        location.href = `/pages/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
        return;
      }
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const route = API_ROUTES[type];
      setBusy(form, true, 'Sending for review…');
      try {
        const result = await api.post(route, new FormData(form));
        showFormMessage(form, `${result.message || 'Your listing was submitted.'} Moderators review new posts before they are published.`, true);
        form.reset();
        if (preview) { preview.removeAttribute('src'); preview.style.display = 'none'; }
        chooseType(type);
        ui?.toast('Listing submitted for review.');
      } catch (error) {
        showFormMessage(form, error.message || 'Could not submit your listing. Please try again.');
      } finally { setBusy(form, false); }
    });
  }

  function init() {
    setupAuthForms();
    setupListingForm();
    window.addEventListener('campus:session-change', () => window.CampusUI?.renderHeader());
  }

  document.addEventListener('DOMContentLoaded', init);
})();
