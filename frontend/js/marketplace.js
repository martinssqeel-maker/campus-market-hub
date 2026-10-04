/* Shared page rendering and marketplace interactions. Uses only the public Campus API. */
(() => {
  'use strict';

  const api = window.CampusAPI;
  const FALLBACKS = {
    product: '/assets/images/product-placeholder.svg',
    accommodation: '/assets/images/home-placeholder.svg',
    event: '/assets/images/event-placeholder.svg',
    service: '/assets/images/service-placeholder.svg',
  };

  const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);

  function safeImage(url, kind = 'product') {
    const candidate = String(url || '').trim();
    if ((candidate.startsWith('/') && !candidate.startsWith('//')) || /^https:\/\//i.test(candidate)) {
      return escapeHTML(candidate);
    }
    return FALLBACKS[kind] || FALLBACKS.product;
  }

  function formatPrice(value, compact = false) {
    if (value === null || value === undefined || value === '') return 'Ask for price';
    const number = Number(value);
    if (!Number.isFinite(number)) return 'Ask for price';
    return `₦${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0, notation: compact ? 'compact' : 'standard' }).format(number)}`;
  }

  function dateParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { day: '—', month: 'TBA', full: 'Date to be announced' };
    return {
      day: new Intl.DateTimeFormat('en', { day: '2-digit' }).format(date),
      month: new Intl.DateTimeFormat('en', { month: 'short' }).format(date),
      full: new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(date),
    };
  }

  function initials(name) {
    return String(name || 'FULafia student').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  }

  function toast(message, kind = 'success') {
    const region = document.querySelector('#toast-region');
    if (!region) return;
    const item = document.createElement('div');
    item.className = `toast ${kind === 'error' ? 'is-error' : 'is-success'}`;
    item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    item.textContent = message;
    region.append(item);
    window.setTimeout(() => item.remove(), 4300);
  }

  function currentUser() { return api.getUser(); }

  function renderHeader() {
    const target = document.querySelector('#site-header');
    if (!target) return;
    const user = currentUser();
    const links = [
      ['Marketplace', '/pages/home.html', ['products', 'product-detail']],
      ['Accommodation', '/pages/accommodation.html', ['accommodation']],
      ['Events', '/pages/events.html', ['events']],
      ['Services', '/pages/services.html', ['services']],
    ];
    if (user) links.push(['Saved', '/pages/favorites.html', ['favorites']]);
    const page = document.body.dataset.page || '';
    const nav = links.map(([label, href, pages]) => `<a href="${href}" ${pages.includes(page) ? 'aria-current="page"' : ''}>${label}</a>`).join('');
    const userActions = user
      ? `<a class="header-user" href="/pages/profile.html?id=${encodeURIComponent(user.id)}" aria-label="Open your profile"><span aria-hidden="true">◉</span> ${escapeHTML((user.name || 'Student').split(' ')[0])}</a><button class="btn btn-quiet" type="button" data-logout>Sign out</button>`
      : `<a class="btn btn-secondary" href="/pages/login.html">Sign in</a>`;
    const adminLink = user?.user_type === 'admin' ? '<a href="/pages/admin-dashboard.html">Moderation</a>' : '';
    const mobileAccount = user
      ? `<span class="nav-mobile-account"><a href="/pages/profile.html?id=${encodeURIComponent(user.id)}">My profile</a><a href="/pages/favorites.html">Saved listings</a><button class="site-nav-action" type="button" data-logout>Sign out</button></span>`
      : '<span class="nav-mobile-account"><a href="/pages/login.html">Sign in</a><a href="/pages/signup.html">Create an account</a></span>';

    target.innerHTML = `<header class="site-header"><div class="container header-inner">
      <a class="brand" href="/" aria-label="Campus Marketplace home"><img src="/assets/images/campus-logo.svg" alt=""><span class="brand-wordmark"><strong>Campus Marketplace</strong><span>FEDERAL UNIVERSITY OF LAFIA</span></span></a>
      <nav class="site-nav" aria-label="Main navigation">${nav}${adminLink}${mobileAccount}</nav>
      <div class="header-actions">${userActions}<a class="btn btn-primary" href="/pages/post-listing.html" aria-label="Post a listing">＋&nbsp; Sell / share</a><button class="menu-toggle" type="button" aria-label="Open navigation" aria-expanded="false"><span></span></button></div>
    </div></header>`;

    const toggle = target.querySelector('.menu-toggle');
    const menu = target.querySelector('.site-nav');
    toggle?.addEventListener('click', () => {
      const open = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });
    menu?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      menu.classList.remove('is-open');
      toggle?.setAttribute('aria-expanded', 'false');
    }));
  }

  function renderFooter() {
    const target = document.querySelector('#site-footer');
    if (!target) return;
    target.innerHTML = `<footer class="site-footer"><div class="container">
      <div class="footer-grid">
        <div class="footer-brand"><a class="brand" href="/" aria-label="Campus Marketplace home"><img src="/assets/images/campus-logo.svg" alt=""><span class="brand-wordmark"><strong>Campus Marketplace</strong><span>FEDERAL UNIVERSITY OF LAFIA</span></span></a><p>A friendlier way for FULafia students to buy, sell, find a room and make campus connections.</p></div>
        <div class="footer-col"><h3>Explore</h3><a href="/pages/home.html">Marketplace</a><a href="/pages/accommodation.html">Accommodation</a><a href="/pages/events.html">Campus events</a><a href="/pages/services.html">Student services</a></div>
        <div class="footer-col"><h3>Your account</h3><a href="/pages/signup.html">Create an account</a><a href="/pages/login.html">Sign in</a><a href="/pages/post-listing.html">Post a listing</a><a href="/pages/profile.html">Student profiles</a><a href="/pages/favorites.html">Saved listings</a></div>
        <div class="footer-col"><h3>Marketplace promise</h3><a href="/pages/home.html">Reviewed listings</a><a href="/pages/accommodation.html">Local connections</a><a href="/pages/events.html">Made for FULafia</a><a href="mailto:campusmarketplace@fulafia.edu.ng">Contact</a></div>
      </div><div class="footer-bottom"><span>© ${new Date().getFullYear()} Campus Marketplace · Federal University of Lafia</span><span>Buy local. Share campus.</span></div>
    </div></footer>`;
  }

  function emptyState(title, message, icon = '⌕') {
    return `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon}</span><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p></div>`;
  }

  function productCard(item, kind = 'product', saved = false) {
    const owner = item.seller || item.landlord || item.creator || item.provider || {};
    const destination = `/pages/product-details.html?type=${encodeURIComponent(kind)}&id=${encodeURIComponent(item.id)}`;
    const category = item.category || (item.room_type ? item.room_type.replaceAll('_', ' ') : kind);
    const price = item.price === null || item.price === undefined ? 'Ask for price' : formatPrice(item.price);
    const subPrice = kind === 'accommodation' ? '<small> · listed rent</small>' : '';
    const location = item.location || 'Federal University of Lafia';
    const metaExtra = kind === 'accommodation' ? `${Number(item.rooms) || 1} ${Number(item.rooms) === 1 ? 'room' : 'rooms'}` : escapeHTML(category);
    const info = kind === 'accommodation'
      ? `<div class="room-facts"><span>⌂ ${escapeHTML(String(item.room_type || 'room').replaceAll('_', ' '))}</span><span>▦ ${Number(item.rooms) || 1} ${Number(item.rooms) === 1 ? 'room' : 'rooms'}</span></div>`
      : '';
    return `<article class="listing-card ${kind === 'accommodation' ? 'accom-card' : ''}">
      <a class="listing-card-image" href="${destination}" aria-label="View ${escapeHTML(item.title)}">
        <img src="${safeImage(item.image_url, kind)}" alt="${escapeHTML(item.title)}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACKS[kind] || FALLBACKS.product}'">
        <span class="card-badge badge">${escapeHTML(metaExtra)}</span>
      </a>
      <button class="favorite-btn ${saved ? 'is-favorite' : ''}" type="button" data-favorite data-saved="${saved ? 'true' : 'false'}" data-listing-type="${kind}" data-listing-id="${Number(item.id)}" aria-label="${saved ? 'Remove' : 'Save'} ${escapeHTML(item.title)} ${saved ? 'from' : 'to'} wishlist" title="${saved ? 'Remove from wishlist' : 'Save to wishlist'}">${saved ? '♥' : '♡'}</button>
      <div class="listing-card-body">
        <div class="listing-card-meta"><span>${escapeHTML(location)}</span><span>${escapeHTML(dateParts(item.created_at).full.split(',')[0])}</span></div>
        <h3><a href="${destination}">${escapeHTML(item.title)}</a></h3>
        ${info}
        <div class="listing-card-price">${price}${subPrice}</div>
        <a class="seller-mini" href="/pages/profile.html?id=${Number(owner.id || 0)}" aria-label="View ${escapeHTML(owner.name || 'student')} profile"><span class="seller-avatar">${escapeHTML(initials(owner.name))}</span><span>${escapeHTML(owner.name || 'FULafia student')}</span>${owner.verified ? '<span class="seller-verified" title="Verified student">✓</span>' : ''}</a>
      </div>
    </article>`;
  }

  function eventCard(item) {
    const date = dateParts(item.date);
    const creator = item.creator || {};
    return `<a class="event-card" href="/pages/product-details.html?type=event&id=${Number(item.id)}">
      <span class="event-date-block"><strong>${escapeHTML(date.day)}</strong><span>${escapeHTML(date.month)}</span></span>
      <span class="event-card-content"><span class="badge badge--gold">${escapeHTML(item.category || 'Campus event')}</span><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML((item.description || '').slice(0, 112))}${(item.description || '').length > 112 ? '…' : ''}</p><span class="event-meta"><span>◷ ${escapeHTML(date.full)}</span><span>⌖ ${escapeHTML(item.location || 'Campus')}</span>${creator.name ? `<span>By ${escapeHTML(creator.name)}</span>` : ''}</span></span>
    </a>`;
  }

  function setLoading(grid, count = 3) {
    if (!grid) return;
    grid.innerHTML = Array.from({ length: count }, () => '<div class="skeleton"></div>').join('');
  }

  function buildParams(form, extras = {}) {
    const params = new URLSearchParams();
    if (form) new FormData(form).forEach((value, key) => {
      if (String(value).trim()) params.set(key, String(value).trim());
    });
    Object.entries(extras).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') params.set(key, value);
    });
    return params;
  }

  function updateCount(selector, data, word = 'listing') {
    const target = document.querySelector(selector);
    if (!target) return;
    const count = Number(data?.pagination?.total ?? data?.items?.length ?? 0);
    target.innerHTML = `<strong>${count}</strong> ${count === 1 ? word : `${word}s`} found`;
  }

  function renderPagination(root, pagination, onPage) {
    if (!root) return;
    root.innerHTML = '';
    const pages = Number(pagination?.pages || 0);
    const current = Number(pagination?.page || 1);
    if (pages <= 1) return;
    const addButton = (label, page, disabled = false, active = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (active) button.classList.add('is-active');
      button.disabled = disabled;
      button.addEventListener('click', () => onPage(page));
      root.append(button);
    };
    addButton('‹', current - 1, current <= 1);
    const from = Math.max(1, current - 2);
    const to = Math.min(pages, current + 2);
    for (let page = from; page <= to; page += 1) addButton(String(page), page, false, page === current);
    addButton('›', current + 1, current >= pages);
  }

  function attachAutocomplete(input, endpoint) {
    if (!input) return;
    const listId = `suggestions-${Math.random().toString(36).slice(2, 9)}`;
    const list = document.createElement('datalist');
    list.id = listId;
    document.body.append(list);
    input.setAttribute('list', listId);
    let timer;
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      const term = input.value.trim();
      if (term.length < 2) { list.replaceChildren(); return; }
      timer = window.setTimeout(async () => {
        try {
          const result = await api.get(`${endpoint}?${new URLSearchParams({ q: term, per_page: 5 })}`);
          const items = result.items || [];
          list.replaceChildren(...items.map((item) => {
            const option = document.createElement('option');
            option.value = item.title;
            return option;
          }));
        } catch (_) { /* Suggestions are progressive enhancement. */ }
      }, 240);
    });
  }

  async function loadFeatured() {
    const productGrid = document.querySelector('[data-product-grid][data-product-limit]');
    const accommodationGrid = document.querySelector('[data-accommodation-grid][data-limit]');
    const eventGrid = document.querySelector('[data-event-grid][data-limit]');
    if (productGrid) {
      try {
        const data = await api.get(`products?per_page=${productGrid.dataset.productLimit || 4}`);
        productGrid.innerHTML = data.items.length ? data.items.map((item) => productCard(item)).join('') : emptyState('Your next find starts here', 'No listings yet. Check back soon, or be the first to post a great find.', '✦');
      } catch (error) { productGrid.innerHTML = emptyState('Listings are taking a break', error.message, '⌁'); }
    }
    if (accommodationGrid) {
      try {
        const data = await api.get(`accommodation?per_page=${accommodationGrid.dataset.limit || 3}`);
        accommodationGrid.innerHTML = data.items.length ? data.items.map((item) => productCard(item, 'accommodation')).join('') : emptyState('Room for something new', 'No accommodation listings are published yet.', '⌂');
      } catch (error) { accommodationGrid.innerHTML = emptyState('Accommodation is taking a break', error.message, '⌂'); }
    }
    if (eventGrid) {
      try {
        const data = await api.get(`events?per_page=${eventGrid.dataset.limit || 2}`);
        eventGrid.innerHTML = data.items.length ? data.items.map(eventCard).join('') : emptyState('Nothing on the calendar yet', 'Check back for student meetups, workshops and campus activities.', '◷');
      } catch (error) { eventGrid.innerHTML = emptyState('Events are taking a break', error.message, '◷'); }
    }
  }

  function setupProductBrowse() {
    const grid = document.querySelector('[data-product-grid][data-page-size]');
    const form = document.querySelector('#product-filters');
    if (!grid || !form) return;
    const pageSize = Number(grid.dataset.pageSize) || 12;
    const query = new URLSearchParams(window.location.search);
    ['q', 'category', 'location', 'min_price', 'max_price', 'sort'].forEach((key) => {
      const field = form.elements.namedItem(key);
      if (field && query.has(key)) field.value = query.get(key);
    });
    let page = Math.max(1, Number(query.get('page')) || 1);

    const load = async (newPage = 1) => {
      page = newPage;
      setLoading(grid, 4);
      const params = buildParams(form, { page, per_page: pageSize });
      try {
        const data = await api.get(`products?${params}`);
        grid.innerHTML = data.items.length ? data.items.map((item) => productCard(item)).join('') : emptyState('No matches just yet', 'Try a different keyword or widen your filters.', '⌕');
        updateCount('[data-results-count]', data, 'listing');
        renderPagination(document.querySelector('[data-pagination]'), data.pagination, load);
      } catch (error) {
        grid.innerHTML = emptyState('Could not load listings', error.message, '⌁');
        updateCount('[data-results-count]', { items: [] }, 'listing');
      }
    };
    form.addEventListener('submit', (event) => { event.preventDefault(); load(1); });
    const searchField = form.querySelector('input[name="q"]');
    attachAutocomplete(searchField, 'products');
    load(page);
  }

  function setupAccommodationBrowse() {
    const grid = document.querySelector('[data-accommodation-grid][data-page-size]');
    const form = document.querySelector('#accommodation-filters');
    if (!grid || !form) return;
    const pageSize = Number(grid.dataset.pageSize) || 12;
    const query = new URLSearchParams(location.search);
    ['q', 'room_type', 'location', 'min_price', 'max_price'].forEach((key) => {
      const field = form.elements.namedItem(key);
      if (field && query.has(key)) field.value = query.get(key);
    });
    let page = Math.max(1, Number(query.get('page')) || 1);
    const load = async (newPage = 1) => {
      page = newPage;
      setLoading(grid, 3);
      const params = buildParams(form, { page, per_page: pageSize });
      try {
        const data = await api.get(`accommodation?${params}`);
        grid.innerHTML = data.items.length ? data.items.map((item) => productCard(item, 'accommodation')).join('') : emptyState('No rooms match those filters', 'Try another area or adjust your budget.', '⌂');
        updateCount('[data-results-count]', data, 'room');
        renderPagination(document.querySelector('[data-pagination]'), data.pagination, load);
      } catch (error) { grid.innerHTML = emptyState('Could not load accommodation', error.message, '⌂'); }
    };
    form.addEventListener('submit', (event) => { event.preventDefault(); load(1); });
    attachAutocomplete(form.querySelector('input[name="q"]'), 'accommodation');
    load(page);
  }

  function setupEventsBrowse() {
    const grid = document.querySelector('[data-event-grid][data-page-size]');
    const form = document.querySelector('#event-filters');
    if (!grid || !form) return;
    const pageSize = Number(grid.dataset.pageSize) || 12;
    let page = 1;
    const load = async (newPage = 1) => {
      page = newPage;
      setLoading(grid, 3);
      const params = buildParams(form, { page, per_page: pageSize });
      try {
        const data = await api.get(`events?${params}`);
        grid.innerHTML = data.items.length ? data.items.map(eventCard).join('') : emptyState('No events found', 'Try a different search or come back later for new campus plans.', '◷');
        updateCount('[data-results-count]', data, 'event');
        renderPagination(document.querySelector('[data-pagination]'), data.pagination, load);
      } catch (error) { grid.innerHTML = emptyState('Could not load events', error.message, '◷'); }
    };
    form.addEventListener('submit', (event) => { event.preventDefault(); load(1); });
    attachAutocomplete(form.querySelector('input[name="q"]'), 'events');
    load(page);
  }

  function setupServicesBrowse() {
    const grid = document.querySelector('[data-service-grid]');
    const form = document.querySelector('#service-filters');
    if (!grid || !form) return;
    const pageSize = Number(grid.dataset.pageSize) || 12;
    let page = 1;
    const load = async (newPage = 1) => {
      page = newPage;
      setLoading(grid, 3);
      const params = buildParams(form, { page, per_page: pageSize });
      try {
        const data = await api.get(`services?${params}`);
        grid.innerHTML = data.items.length ? data.items.map((item) => productCard(item, 'service')).join('') : emptyState('No services are listed yet', 'Offer a useful skill to your campus community.', '✦');
        updateCount('[data-results-count]', data, 'service');
        renderPagination(document.querySelector('[data-pagination]'), data.pagination, load);
      } catch (error) { grid.innerHTML = emptyState('Could not load services', error.message, '✦'); }
    };
    form.addEventListener('submit', (event) => { event.preventDefault(); load(1); });
    attachAutocomplete(form.querySelector('input[name="q"]'), 'services');
    load(page);
  }

  async function loadFavorites() {
    const grid = document.querySelector('[data-favorites-grid]');
    if (!grid) return;
    if (!api.getToken() || !currentUser()) {
      location.href = `/pages/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    setLoading(grid, 3);
    try {
      const data = await api.get('favorites');
      const items = (data.items || []).filter((entry) => entry.listing);
      if (!items.length) {
        grid.innerHTML = emptyState('Your wishlist is ready for a good find', 'Tap the heart on any product, room, service or event to save it here.', '♡');
        return;
      }
      grid.innerHTML = items.map((entry) => {
        const kind = entry.listing_type;
        if (kind === 'event') {
          return `<div class="event-favorite-wrap">${eventCard(entry.listing)}<button class="favorite-btn is-favorite" type="button" data-favorite data-saved="true" data-listing-type="event" data-listing-id="${Number(entry.listing_id)}" aria-label="Remove event from wishlist" title="Remove from wishlist">♥</button></div>`;
        }
        return productCard(entry.listing, kind, true);
      }).join('');
    } catch (error) {
      grid.innerHTML = emptyState('Could not load your wishlist', error.message, '♡');
    }
  }

  function getContactLink(phone, kind) {
    const text = String(phone || '').trim();
    const digits = text.replace(/\D/g, '');
    if (!digits) return '';
    if (kind === 'whatsapp') {
      const whatsappNumber = digits.startsWith('0') && digits.length === 11
        ? `234${digits.slice(1)}`
        : digits.length === 10 && !digits.startsWith('234') ? `234${digits}` : digits;
      return `https://wa.me/${whatsappNumber}`;
    }
    return `tel:${encodeURIComponent(text)}`;
  }

  async function loadListingDetail() {
    const root = document.querySelector('[data-product-detail]');
    if (!root) return;
    const params = new URLSearchParams(location.search);
    const id = Number(params.get('id'));
    const kind = params.get('type') || 'product';
    const resource = { product: 'products', accommodation: 'accommodation', event: 'events', service: 'services' }[kind];
    if (!Number.isInteger(id) || id < 1 || !resource) {
      root.innerHTML = emptyState('Listing not found', 'This link does not point to a valid campus listing.', '⌕');
      return;
    }
    try {
      const data = await api.get(`${resource}/${id}`);
      const item = data.product || data.accommodation || data.event || data.service;
      if (!item) throw new Error('Listing could not be found.');
      const owner = item.seller || item.landlord || item.creator || item.provider || {};
      const label = { product: item.category || 'Campus find', accommodation: String(item.room_type || 'room').replaceAll('_', ' '), event: item.category || 'Campus event', service: item.category || 'Student service' }[kind];
      const imageKind = kind;
      const priceText = kind === 'event' ? dateParts(item.date).full : (item.price == null ? 'Contact for pricing' : formatPrice(item.price));
      const details = kind === 'event'
        ? `<span>◷ ${escapeHTML(dateParts(item.date).full)}</span><span>⌖ ${escapeHTML(item.location)}</span>`
        : kind === 'accommodation'
          ? `<span>⌖ ${escapeHTML(item.location)}</span><span>▦ ${Number(item.rooms) || 1} ${Number(item.rooms) === 1 ? 'room' : 'rooms'}</span>`
          : `<span>⌖ ${escapeHTML(item.location || 'Federal University of Lafia')}</span><span>◷ Listed ${escapeHTML(dateParts(item.created_at).full.split(',')[0])}</span>`;
      const phone = owner.phone || '';
      const wa = getContactLink(phone, 'whatsapp');
      const tel = getContactLink(phone, 'call');
      root.innerHTML = `<div class="breadcrumbs"><a href="/">Home</a><span><a href="/pages/${kind === 'accommodation' ? 'accommodation' : kind === 'event' ? 'events' : kind === 'service' ? 'services' : 'home'}.html">${kind === 'product' ? 'Marketplace' : kind === 'accommodation' ? 'Accommodation' : kind === 'event' ? 'Events' : 'Services'}</a></span><span>${escapeHTML(item.title)}</span></div>
        <div class="detail-grid"><div class="detail-image"><img src="${safeImage(item.image_url, imageKind)}" alt="${escapeHTML(item.title)}" onerror="this.onerror=null;this.src='${FALLBACKS[imageKind] || FALLBACKS.product}'"></div>
        <section class="detail-info"><span class="badge">${escapeHTML(label)}</span><h1>${escapeHTML(item.title)}</h1><div class="detail-price">${escapeHTML(priceText)}${kind === 'accommodation' ? '<small> / listed rent</small>' : ''}</div>
          <div class="detail-meta">${details}</div><p class="detail-description">${escapeHTML(item.description || 'No description provided.')}</p>
          <div class="seller-panel"><div class="seller-panel-head"><span class="seller-avatar">${escapeHTML(initials(owner.name))}</span><span><strong>${escapeHTML(owner.name || 'FULafia student')}${owner.verified ? ' <span class="seller-verified" title="Verified student">✓</span>' : ''}</strong><small>${kind === 'accommodation' ? 'Landlord' : kind === 'event' ? 'Event organiser' : kind === 'service' ? 'Service provider' : 'Student seller'} · <a class="text-link" href="/pages/profile.html?id=${Number(owner.id || 0)}">View profile</a></small></span></div>
            ${phone ? `<div class="seller-panel-actions"><a class="btn btn-primary" href="${escapeHTML(wa)}" target="_blank" rel="noopener noreferrer">Message on WhatsApp</a><a class="btn btn-secondary" href="${escapeHTML(tel)}">Call seller</a></div>` : '<p class="small muted">Contact details are not available for this listing.</p>'}
          </div><button class="btn btn-secondary btn-full" style="margin-top:11px" type="button" data-favorite data-listing-type="${kind}" data-listing-id="${Number(item.id)}">♡&nbsp; Save to wishlist</button>
        </section></div>`;
      document.title = `${item.title} — Campus Marketplace`;
    } catch (error) {
      root.innerHTML = emptyState('We couldn’t find that listing', error.message || 'It may have been removed or is still awaiting review.', '⌕');
    }
  }

  async function loadProfile() {
    const root = document.querySelector('[data-profile-root]');
    if (!root) return;
    const requested = Number(new URLSearchParams(location.search).get('id'));
    const user = currentUser();
    const id = Number.isInteger(requested) && requested > 0 ? requested : Number(user?.id);
    if (!id) {
      location.href = `/pages/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    const ownProfile = Number(user?.id) === id;
    try {
      const [profileData, listingData, reviewData] = await Promise.all([
        api.get(`users/${id}`),
        api.get(`users/${id}/listings?type=all&per_page=24`),
        api.get(`users/${id}/reviews?per_page=6`),
      ]);
      const profile = profileData.user;
      const groups = ['products', 'accommodations', 'events', 'services'];
      const allListings = groups.flatMap((key) => listingData[key]?.items || []);
      const reviewMarkup = (reviewData.items || []).map((review) => `<article class="seller-panel"><div class="seller-panel-head"><span class="seller-avatar">${escapeHTML(initials(review.reviewer?.name))}</span><span><strong>${escapeHTML(review.reviewer?.name || 'Student')}</strong><small class="rating-stars" aria-label="${Number(review.rating)} out of 5">${'★'.repeat(Number(review.rating))}${'☆'.repeat(5 - Number(review.rating))}</small></span></div><p class="small muted">${escapeHTML(review.comment || 'No written comment.')}</p></article>`).join('');
      const canReview = user && Number(user.id) !== id;
      const sections = allListings.length ? allListings.map((item) => {
        if (item.date) return eventCard(item);
        const kind = item.landlord ? 'accommodation' : item.provider ? 'service' : 'product';
        return productCard(item, kind);
      }).join('') : emptyState('No listings yet', ownProfile ? 'Your approved listings will appear here.' : 'This student has no published listings yet.', '✦');
      root.innerHTML = `<div class="page-intro"><span class="eyebrow">Student community</span><h1>Student profile</h1><p>Get to know the people making campus life easier.</p></div>
        <section class="profile-hero"><div class="profile-avatar">${escapeHTML(initials(profile.name))}</div><div><h1>${escapeHTML(profile.name)} ${profile.verified ? '<span class="badge">✓ Verified student</span>' : ''}</h1><p>${escapeHTML(profile.user_type === 'admin' ? 'Campus moderator' : 'FULafia student')} · Member since ${escapeHTML(dateParts(profile.created_at).full.split(',')[0])}</p><p>${escapeHTML(profile.bio || 'Part of the Federal University of Lafia community.')}</p></div>
        <div class="profile-stats"><div class="profile-stat"><strong>${Number(profileData.rating?.average || 0).toFixed(1)} <span class="rating-stars">★</span></strong><span>${Number(profileData.rating?.count || 0)} reviews</span></div><div class="profile-stat"><strong>${Number(profileData.listing_count || 0)}</strong><span>published listings</span></div></div>
        ${ownProfile ? '<button class="btn btn-secondary" type="button" data-edit-profile>Edit profile</button>' : ''}</section>
        <section class="profile-section"><div class="section-heading"><div><h2>${ownProfile ? 'Your published listings' : 'Published listings'}</h2><p class="muted small">Listings awaiting approval stay private.</p></div>${ownProfile ? '<a class="text-link" href="/pages/post-listing.html">Post a listing</a>' : ''}</div><div class="card-grid card-grid--three">${sections}</div></section>
        <section class="profile-section"><div class="section-heading"><div><h2>Student reviews</h2><p class="muted small">Feedback from the campus community.</p></div></div><div class="card-grid card-grid--three">${reviewMarkup || emptyState('No reviews yet', 'Be kind, be honest, and help students trade with confidence.', '★')}</div>
          ${canReview ? `<form class="post-form-card form-stack" id="review-form" style="max-width:600px;margin-top:20px"><h3 style="margin:0">Leave a review</h3><div class="form-alert" data-form-alert role="alert"></div><div class="form-field"><label for="review-rating">Your rating</label><select id="review-rating" name="rating" required><option value="5">★★★★★ — Great</option><option value="4">★★★★☆ — Good</option><option value="3">★★★☆☆ — Okay</option><option value="2">★★☆☆☆ — Not great</option><option value="1">★☆☆☆☆ — Poor</option></select></div><div class="form-field"><label for="review-comment">Comment (optional)</label><textarea id="review-comment" name="comment" maxlength="800" placeholder="Share a helpful, respectful note…"></textarea></div><button class="btn btn-primary" type="submit">Submit review</button></form>` : ''}
        </section>`;
      if (ownProfile) {
        root.querySelector('[data-edit-profile]')?.addEventListener('click', async () => {
          const name = window.prompt('Your display name', profile.name);
          if (!name) return;
          const phone = window.prompt('Your contact phone number', profile.phone || '') ?? profile.phone;
          const bio = window.prompt('A short profile bio', profile.bio || '') ?? profile.bio;
          try {
            const updated = await api.put(`users/${id}`, { name, phone, bio });
            api.setSession(api.getToken(), updated.user);
            toast('Profile updated.');
            loadProfile();
          } catch (error) { toast(error.message, 'error'); }
        });
      }
      const reviewForm = root.querySelector('#review-form');
      reviewForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(reviewForm);
        const alert = reviewForm.querySelector('[data-form-alert]');
        try {
          await api.post(`users/${id}/reviews`, { rating: formData.get('rating'), comment: formData.get('comment') });
          toast('Thanks for sharing your experience.');
          loadProfile();
        } catch (error) { alert.textContent = error.message; alert.classList.add('is-visible'); }
      });
    } catch (error) {
      root.innerHTML = emptyState('Profile unavailable', error.message, '◉');
    }
  }

  function setupHomeSearch() {
    const form = document.querySelector('#home-search-form');
    const input = document.querySelector('#home-search');
    if (!form) return;
    attachAutocomplete(input, 'products');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const term = input?.value.trim() || '';
      location.href = `/pages/home.html${term ? `?q=${encodeURIComponent(term)}` : ''}`;
    });
  }

  async function handleFavoriteClick(button) {
    if (!currentUser() || !api.getToken()) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/pages/login.html?next=${next}`;
      return;
    }
    const type = button.dataset.listingType || 'product';
    const id = Number(button.dataset.listingId);
    button.disabled = true;
    try {
      if (button.classList.contains('is-favorite') || button.dataset.saved === 'true') {
        await api.delete(`favorites/listing/${encodeURIComponent(type)}/${id}`);
        button.classList.remove('is-favorite');
        button.dataset.saved = 'false';
        if (button.classList.contains('favorite-btn')) button.textContent = '♡';
        else button.textContent = '♡  Save to wishlist';
        button.setAttribute('aria-label', 'Save this listing to your wishlist');
        button.title = 'Save to wishlist';
        toast('Removed from your wishlist.');
        window.dispatchEvent(new CustomEvent('campus:favorites-updated'));
      } else {
        await api.post('favorites', { listing_type: type, listing_id: id });
        button.classList.add('is-favorite');
        button.dataset.saved = 'true';
        if (button.classList.contains('favorite-btn')) button.textContent = '♥';
        else button.textContent = '♥  Remove from wishlist';
        button.setAttribute('aria-label', 'Remove this listing from your wishlist');
        button.title = 'Remove from wishlist';
        toast('Saved to your wishlist.');
        window.dispatchEvent(new CustomEvent('campus:favorites-updated'));
      }
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  }

  function init() {
    renderHeader();
    renderFooter();
    setupHomeSearch();
    const page = document.body.dataset.page;
    if (page === 'home') loadFeatured();
    if (page === 'products') setupProductBrowse();
    if (page === 'accommodation') setupAccommodationBrowse();
    if (page === 'events') setupEventsBrowse();
    if (page === 'services') setupServicesBrowse();
    if (page === 'product-detail') loadListingDetail();
    if (page === 'profile') loadProfile();
    if (page === 'favorites') loadFavorites();
    window.addEventListener('campus:favorites-updated', () => {
      if (document.body.dataset.page === 'favorites') loadFavorites();
    });

    document.addEventListener('click', (event) => {
      const favorite = event.target.closest('[data-favorite]');
      if (favorite) {
        event.preventDefault();
        event.stopPropagation();
        handleFavoriteClick(favorite);
      }
    });
    window.addEventListener('campus:session-change', renderHeader);
  }

  window.CampusUI = { escapeHTML, formatPrice, toast, safeImage, renderHeader, currentUser };
  document.addEventListener('DOMContentLoaded', init);
})();
