/* Administrator moderation dashboard. Authorization is enforced by the API as well as this UI. */
(() => {
  'use strict';
  const api = window.CampusAPI;
  const ui = window.CampusUI;
  const escapeHTML = ui?.escapeHTML || ((value) => String(value));
  const IMAGE_BY_TYPE = {
    product: '/assets/images/product-placeholder.svg',
    accommodation: '/assets/images/home-placeholder.svg',
    event: '/assets/images/event-placeholder.svg',
    service: '/assets/images/service-placeholder.svg',
  };

  function denied(root, message, login = false) {
    root.innerHTML = `<div class="page-intro"><span class="eyebrow">Campus Marketplace</span><h1>Admin moderation</h1></div><div class="inline-notice"><strong>${escapeHTML(message)}</strong> ${login ? '<a class="text-link" href="/pages/login.html?next=%2Fpages%2Fadmin-dashboard.html">Sign in to continue</a>' : '<a class="text-link" href="/">Return home</a>'}</div>`;
  }

  function renderQueue(target, pending, selectedType = 'all') {
    const items = Object.entries(pending || {}).flatMap(([type, group]) => (group || []).map((item) => ({ ...item, listing_type: type })))
      .filter((item) => selectedType === 'all' || item.listing_type === selectedType);
    if (!items.length) {
      target.innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true">✓</span><strong>All caught up</strong><p>There are no listings waiting for review in this category.</p></div>';
      return;
    }
    target.innerHTML = items.map((item) => {
      const type = item.listing_type;
      const owner = item.seller || item.landlord || item.creator || item.provider || {};
      const image = item.image_url || IMAGE_BY_TYPE[type] || IMAGE_BY_TYPE.product;
      const detailUrl = `/pages/product-details.html?type=${encodeURIComponent(type)}&id=${Number(item.id)}`;
      return `<article class="moderation-row" data-pending-row data-type="${escapeHTML(type)}">
        <a class="moderation-thumb" href="${detailUrl}" target="_blank" rel="noopener noreferrer"><img src="${escapeHTML(image)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${IMAGE_BY_TYPE[type] || IMAGE_BY_TYPE.product}'"></a>
        <div class="moderation-copy"><span class="badge badge--neutral">${escapeHTML(type.replaceAll('_', ' '))}</span><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML((item.description || '').slice(0, 140))}${(item.description || '').length > 140 ? '…' : ''}</p><p>${escapeHTML(owner.name || 'Student')} · ${escapeHTML(item.location || 'Campus')} · ${item.price == null ? '' : `₦${new Intl.NumberFormat('en-NG').format(Number(item.price))} · `}Pending review</p></div>
        <div class="moderation-actions"><button class="btn btn-primary" type="button" data-moderate="approve" data-type="${escapeHTML(type)}" data-id="${Number(item.id)}">Approve</button><button class="btn btn-secondary" type="button" data-moderate="reject" data-type="${escapeHTML(type)}" data-id="${Number(item.id)}">Reject</button></div>
      </article>`;
    }).join('');
  }

  function renderUsers(target, users) {
    if (!users.length) {
      target.innerHTML = '<div class="empty-state"><strong>No students found</strong><p>Try another name or email address.</p></div>';
      return;
    }
    target.innerHTML = users.map((user) => `<article class="moderation-row">
      <span class="profile-avatar" style="width:52px;height:52px;font-size:16px">${escapeHTML(String(user.name || '?').split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase())}</span>
      <div class="moderation-copy"><h3>${escapeHTML(user.name)}${user.verified ? ' <span class="badge">✓ Verified</span>' : ''}</h3><p>${escapeHTML(user.email)} · ${escapeHTML(user.phone || 'No phone number')} · ${Number(user.listing_count || 0)} listings</p><p>${escapeHTML(user.user_type)} · Joined ${escapeHTML(new Date(user.created_at).toLocaleDateString('en-NG'))}</p></div>
      <div class="moderation-actions">${user.verified ? '<span class="badge">Verified</span>' : `<button class="btn btn-secondary" type="button" data-verify-user="${Number(user.id)}">Verify student</button>`}</div>
    </article>`).join('');
  }

  async function loadAdminDashboard() {
    const root = document.querySelector('[data-admin-root]');
    if (!root) return;
    const user = api.getUser();
    if (!user || !api.getToken()) { denied(root, 'Sign in with an administrator account to review listings.', true); return; }
    if (user.user_type !== 'admin') { denied(root, 'This page is for Campus Marketplace administrators.'); return; }

    root.innerHTML = `<div class="page-intro"><span class="eyebrow">Campus Marketplace staff</span><h1>Moderation desk</h1><p>Review new student listings before they appear publicly. Decisions update the marketplace immediately.</p></div>
      <section class="admin-stats" data-admin-stats><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></section>
      <div class="admin-toolbar"><div><h2 style="margin:0">Pending listings</h2><span class="muted small" data-pending-total>Loading queue…</span></div><div class="filter-field"><label for="admin-type-filter">Show</label><select id="admin-type-filter" data-admin-type-filter><option value="all">All categories</option><option value="product">Products</option><option value="accommodation">Accommodation</option><option value="event">Events</option><option value="service">Services</option></select></div><button class="btn btn-secondary" type="button" data-admin-refresh>↻&nbsp; Refresh</button></div>
      <div class="admin-list" data-admin-queue><div class="loading-message">Loading submissions…</div></div>
      <section class="profile-section"><div class="admin-toolbar"><div><h2 style="margin:0">Student accounts</h2><span class="muted small">Verify student profiles after checking campus credentials.</span></div><form class="filter-field" data-admin-user-search><label for="admin-user-q">Search students</label><input id="admin-user-q" name="q" type="search" placeholder="Name, email or phone"></form></div><div class="admin-list" data-admin-users><div class="loading-message">Loading students…</div></div></section>`;

    let pending = {};
    let userQuery = '';
    async function refreshQueue() {
      const queue = root.querySelector('[data-admin-queue]');
      try {
        const [pendingData, stats] = await Promise.all([api.get('admin/pending'), api.get('admin/stats')]);
        pending = pendingData.items || {};
        root.querySelector('[data-pending-total]').textContent = `${pendingData.total || 0} listing${pendingData.total === 1 ? '' : 's'} waiting for review`;
        root.querySelector('[data-admin-stats]').innerHTML = [
          ['Students', stats.users], ['Pending review', stats.pending_listings], ['Published finds', stats.published_products], ['Rooms & events', Number(stats.published_accommodation || 0) + Number(stats.published_events || 0)],
        ].map(([label, value]) => `<article class="admin-stat-card"><span>${escapeHTML(label)}</span><strong>${Number(value || 0)}</strong></article>`).join('');
        renderQueue(queue, pending, root.querySelector('[data-admin-type-filter]').value);
      } catch (error) {
        queue.innerHTML = `<div class="inline-notice">${escapeHTML(error.message)} Check that your administrator account is active.</div>`;
      }
    }

    async function refreshUsers() {
      const target = root.querySelector('[data-admin-users]');
      try {
        const result = await api.get(`admin/users?per_page=48${userQuery ? `&q=${encodeURIComponent(userQuery)}` : ''}`);
        renderUsers(target, result.items || []);
      } catch (error) { target.innerHTML = `<div class="inline-notice">${escapeHTML(error.message)}</div>`; }
    }

    root.querySelector('[data-admin-type-filter]').addEventListener('change', (event) => renderQueue(root.querySelector('[data-admin-queue]'), pending, event.target.value));
    root.querySelector('[data-admin-refresh]').addEventListener('click', refreshQueue);
    const searchForm = root.querySelector('[data-admin-user-search]');
    searchForm.addEventListener('submit', (event) => { event.preventDefault(); userQuery = searchForm.elements.q.value.trim(); refreshUsers(); });
    searchForm.elements.q.addEventListener('input', () => {
      window.clearTimeout(searchForm._searchTimer);
      searchForm._searchTimer = window.setTimeout(() => { userQuery = searchForm.elements.q.value.trim(); refreshUsers(); }, 350);
    });

    root.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-moderate]');
      if (action) {
        action.disabled = true;
        const operation = action.dataset.moderate;
        try {
          await api.post(`admin/${operation}/${encodeURIComponent(action.dataset.type)}/${Number(action.dataset.id)}`, {});
          ui?.toast(operation === 'approve' ? 'Listing approved and published.' : 'Listing rejected.');
          await refreshQueue();
        } catch (error) { ui?.toast(error.message, 'error'); action.disabled = false; }
        return;
      }
      const verify = event.target.closest('[data-verify-user]');
      if (verify) {
        verify.disabled = true;
        try {
          await api.post(`admin/users/${Number(verify.dataset.verifyUser)}/verify`, {});
          ui?.toast('Student account verified.');
          refreshUsers();
        } catch (error) { ui?.toast(error.message, 'error'); verify.disabled = false; }
      }
    });
    refreshQueue();
    refreshUsers();
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page === 'admin') loadAdminDashboard();
  });
})();
