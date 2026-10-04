/* Small fetch wrapper shared by all Campus Marketplace pages. */
(() => {
  'use strict';

  const apiMeta = document.querySelector('meta[name="api-base"]');
  const API_BASE = (window.CAMPUS_MARKET_API_BASE || apiMeta?.content || '/api').replace(/\/$/, '');
  const TOKEN_KEY = 'campus_market_access_token';
  const USER_KEY = 'campus_market_user';

  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.payload = payload;
    }
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
  }

  function getStoredUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function setSession(token, user) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (_) {
      throw new Error('Your browser could not save this session. Check your storage settings.');
    }
    window.dispatchEvent(new CustomEvent('campus:session-change', { detail: { user } }));
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (_) { /* Private browsing may prevent storage access. */ }
    window.dispatchEvent(new CustomEvent('campus:session-change', { detail: { user: null } }));
  }

  async function request(path, options = {}) {
    const urlPath = String(path).replace(/^\//, '');
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    const token = getToken();
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

    let body = options.body;
    if (body !== undefined && body !== null && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(`${API_BASE}/${urlPath}`, {
        method: options.method || 'GET',
        headers,
        body,
        credentials: 'same-origin',
        signal: options.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new ApiError('Could not reach Campus Marketplace. Check your connection and try again.', 0, null);
    }

    let payload = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try { payload = await response.json(); } catch (_) { payload = null; }
    } else if (response.status !== 204) {
      const text = await response.text().catch(() => '');
      payload = text ? { error: text.slice(0, 180) } : null;
    }

    if (!response.ok) {
      if (response.status === 401 && token) clearSession();
      const message = payload?.error || payload?.message || `Request failed (${response.status}).`;
      throw new ApiError(message, response.status, payload);
    }
    return payload;
  }

  const api = {
    baseUrl: API_BASE,
    ApiError,
    getToken,
    getUser: getStoredUser,
    setSession,
    clearSession,
    request,
    get(path, options = {}) { return request(path, { ...options, method: 'GET' }); },
    post(path, body, options = {}) { return request(path, { ...options, method: 'POST', body }); },
    put(path, body, options = {}) { return request(path, { ...options, method: 'PUT', body }); },
    delete(path, options = {}) { return request(path, { ...options, method: 'DELETE' }); },
  };

  window.CampusAPI = api;
})();
