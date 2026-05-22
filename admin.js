// ============ NVee Arts Admin ============
// Single-page admin for orders, customers, contact messages, invoices, products.
// Auth: custom JWT issued by /.netlify/functions/admin-login.

const TOKEN_STORAGE_KEY = 'nvee-admin-token';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function fmtUSD(cents) { return '$' + (cents / 100).toFixed(2); }
function fmtUSDPlain(dollars) { return '$' + Number(dollars).toFixed(0); }
function fmtDate(unixSec) {
  if (!unixSec) return '—';
  const d = new Date(unixSec * 1000);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtDateTime(unixSec) {
  if (!unixSec) return '—';
  const d = new Date(unixSec * 1000);
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtISO(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getToken() { return localStorage.getItem(TOKEN_STORAGE_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_STORAGE_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_STORAGE_KEY); }

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    clearToken();
    showLoginScreen();
    throw new Error('Session expired — please sign in again');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showToast(title, sub = '') {
  const container = $('#toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `
    <div class="toast-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
    <div class="toast-body"><div class="toast-title">${escapeHtml(title)}</div>${sub ? `<div class="toast-sub">${escapeHtml(sub)}</div>` : ''}</div>`;
  container.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

function showLoginScreen() {
  $('#admin-login-screen').hidden = false;
  $('#admin-shell').hidden = true;
}
function showAdminShell() {
  $('#admin-login-screen').hidden = true;
  $('#admin-shell').hidden = false;
  switchTab('dashboard');
  refreshContactBadge();
}

async function handleLogin(e) {
  e.preventDefault();
  const pw = $('#admin-pw').value;
  const errEl = $('#admin-login-error');
  const btn = $('#admin-login-btn');
  errEl.innerHTML = '';
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const res = await fetch('/.netlify/functions/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      const baseMsg = data.error || `Login failed (HTTP ${res.status})`;
      errEl.textContent = baseMsg;
      throw new Error(baseMsg);
    }
    setToken(data.token);
    showAdminShell();
  } catch (err) {
    if (!errEl.innerHTML) errEl.textContent = err.message || 'Login failed';
    btn.disabled = false;
    btn.classList.remove('loading');
    $('#admin-pw').focus();
    $('#admin-pw').select();
  }
}

function handleLogout() {
  clearToken();
  showLoginScreen();
  $('#admin-pw').value = '';
  showToast('Signed out');
}

function switchTab(name) {
  $$('.admin-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  ['dashboard', 'orders', 'customers', 'contact', 'invoices', 'products'].forEach((t) => {
    const panel = document.getElementById('panel-' + t);
    if (panel) panel.hidden = t !== name;
  });
  if (name === 'dashboard') loadDashboard();
  if (name === 'orders') loadOrders();
  if (name === 'customers') loadCustomers();
  if (name === 'contact') loadContact();
  if (name === 'invoices') loadInvoices();
  if (name === 'products') loadProductsAdmin();
}

// ============ DASHBOARD ============
function fmtRelativeTime(unixSecOrIso) {
  if (!unixSecOrIso) return '';
  const t = typeof unixSecOrIso === 'number'
    ? new Date(unixSecOrIso * 1000)
    : new Date(unixSecOrIso);
  const diffSec = (Date.now() - t.getTime()) / 1000;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return Math.floor(diffSec / 60) + 'm ago';
  if (diffSec < 86400) return Math.floor(diffSec / 3600) + 'h ago';
  if (diffSec < 86400 * 7) return Math.floor(diffSec / 86400) + 'd ago';
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function loadDashboard() {
  // Fetch all source data in parallel. Each is auth-gated.
  const subEl = $('#dash-welcome-sub');
  if (subEl) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    subEl.innerHTML = `Today is ${dateStr}. Here's what's happening with your shop.`;
  }

  let orders = [], invoices = [], products = [], messages = [];
  try {
    const [ordersData, invoicesData, productsData, messagesData] = await Promise.all([
      apiFetch('/.netlify/functions/admin-orders?limit=100').catch(() => ({ orders: [] })),
      apiFetch('/.netlify/functions/admin-invoices-list?limit=100').catch(() => ({ invoices: [] })),
      apiFetch('/.netlify/functions/admin-products-list').catch(() => ({ products: [] })),
      apiFetch('/.netlify/functions/admin-contact-list').catch(() => ({ submissions: [] })),
    ]);
    orders = ordersData.orders || [];
    invoices = invoicesData.invoices || [];
    products = productsData.products || [];
    messages = messagesData.submissions || [];
  } catch (err) {
    showToast('Couldn\'t load dashboard', err.message || '');
    return;
  }

  // --- Stats ---
  const totalRevenueCents = orders.reduce(
    (a, o) => a + (o.amount - (o.amountRefunded || 0)),
    0,
  );
  $('#dash-revenue').textContent = fmtUSD(totalRevenueCents);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  const ordersThisMonth = orders.filter(o => o.created >= startOfMonth);
  $('#dash-orders-month').textContent = ordersThisMonth.length;
  $('#dash-orders-month-sub').textContent =
    `${fmtUSD(ordersThisMonth.reduce((a, o) => a + o.amount, 0))} this month`;

  const openInvoices = invoices.filter(i => i.status === 'open' || i.status === 'draft');
  $('#dash-invoices-open').textContent = openInvoices.length;

  const available = products.filter(p => !p.soldOut);
  $('#dash-products-available').textContent = available.length;
  $('#dash-products-sub').textContent = `of ${products.length} total in catalog`;

  const unread = messages.filter(m => !m.read);
  $('#dash-messages-unread').textContent = unread.length;
  updateContactBadge(unread.length);

  // --- Activity feed (combined, sorted, top 10) ---
  const activity = [];
  for (const o of orders.slice(0, 10)) {
    activity.push({
      ts: o.created,
      kind: 'order',
      tone: o.refunded ? 'muted' : 'success',
      text: o.refunded
        ? `Order <strong>refunded</strong> · ${fmtUSD(o.amount)}`
        : `Order paid · ${fmtUSD(o.amount)}${o.customerName ? ' from ' + escapeHtml(o.customerName) : ''}`,
      tab: 'orders',
    });
  }
  for (const inv of invoices.slice(0, 10)) {
    const verb = inv.status === 'paid' ? 'paid' : inv.status === 'open' ? 'sent' : inv.status;
    activity.push({
      ts: inv.created,
      kind: 'invoice',
      tone: inv.status === 'paid' ? 'success' : 'default',
      text: `Invoice <strong>${escapeHtml(inv.number)}</strong> ${verb}${inv.customerEmail ? ' · ' + escapeHtml(inv.customerEmail) : ''}`,
      tab: 'invoices',
    });
  }
  for (const m of messages.slice(0, 10)) {
    const ts = m.createdAt ? Math.floor(new Date(m.createdAt).getTime() / 1000) : 0;
    activity.push({
      ts,
      kind: 'message',
      tone: m.read ? 'muted' : 'default',
      text: `New message from <strong>${escapeHtml(m.name || m.email)}</strong>${m.topicLabel ? ' · ' + escapeHtml(m.topicLabel) : ''}`,
      tab: 'contact',
    });
  }
  activity.sort((a, b) => b.ts - a.ts);
  const top = activity.slice(0, 8);

  const list = $('#dash-activity-list');
  const empty = $('#dash-activity-empty');
  if (top.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
  } else {
    empty.hidden = true;
    list.innerHTML = top.map(a => `
      <div class="dash-activity-item" data-quick-action="${a.tab}">
        <div class="dash-activity-dot ${a.tone}"></div>
        <div class="dash-activity-body">
          <div class="dash-activity-text">${a.text}</div>
          <div class="dash-activity-time">${fmtRelativeTime(a.ts)}</div>
        </div>
      </div>
    `).join('');
  }
}

// Quick-action button + activity-item click delegate
function handleQuickAction(e) {
  const el = e.target.closest('[data-quick-action]');
  if (!el) return;
  const action = el.dataset.quickAction;
  if (action === 'products-new') {
    switchTab('products');
    setTimeout(() => openProductModal('new', null), 80);
  } else if (action === 'invoices-new') {
    switchTab('invoices');
    setTimeout(() => toggleNewInvoiceCard(true), 80);
  } else if (action === 'orders' || action === 'contact' || action === 'invoices' || action === 'products') {
    switchTab(action);
  }
}

// ============ ORDERS ============
async function loadOrders() {
  $('#orders-loading').hidden = false;
  $('#orders-empty').hidden = true;
  $('#orders-list').innerHTML = '';
  try {
    const data = await apiFetch('/.netlify/functions/admin-orders?limit=100');
    $('#orders-loading').hidden = true;
    const orders = data.orders || [];
    if (orders.length === 0) {
      $('#orders-empty').hidden = false;
      $('#orders-count').textContent = '0';
      $('#orders-revenue').textContent = '$0';
      return;
    }
    const totalCents = orders.reduce((a, o) => a + (o.amount - (o.amountRefunded || 0)), 0);
    $('#orders-count').textContent = orders.length;
    $('#orders-revenue').textContent = fmtUSD(totalCents);
    $('#orders-list').innerHTML = orders.map(renderOrderCard).join('');
  } catch (err) {
    $('#orders-loading').hidden = true;
    showToast('Could not load orders', err.message);
  }
}
function renderOrderCard(o) {
  const refundBadge = o.refunded ? '<span class="admin-badge refunded">Refunded</span>' : '';
  const shipping = o.shipping ? `
    <div class="admin-order-ship">
      <strong>${escapeHtml(o.shipping.name)}</strong><br>
      ${escapeHtml(o.shipping.line1)}${o.shipping.line2 ? ', ' + escapeHtml(o.shipping.line2) : ''}<br>
      ${escapeHtml(o.shipping.city)}, ${escapeHtml(o.shipping.state)} ${escapeHtml(o.shipping.postal_code)}<br>
      ${o.shipping.phone ? '☎ ' + escapeHtml(o.shipping.phone) : ''}
    </div>` : '<div class="admin-order-ship admin-muted">No shipping address</div>';
  const cartIds = o.metadata.cart_ids ? o.metadata.cart_ids.split(',').map((id) => `<span class="admin-cart-pill">${escapeHtml(id)}</span>`).join('') : '';
  return `
    <article class="admin-order">
      <div class="admin-order-head">
        <div>
          <div class="admin-order-id">${escapeHtml(o.id)}</div>
          <div class="admin-order-meta">${fmtDateTime(o.created)} · ${escapeHtml(o.paymentMethod || 'card')}</div>
        </div>
        <div class="admin-order-amount">
          ${fmtUSD(o.amount)}
          ${refundBadge}
        </div>
      </div>
      <div class="admin-order-body">
        <div class="admin-order-customer">
          <div class="admin-label">Customer</div>
          <strong>${escapeHtml(o.customerName || '—')}</strong>
          <div>${escapeHtml(o.customerEmail || '—')}</div>
        </div>
        <div>
          <div class="admin-label">Ship to</div>
          ${shipping}
        </div>
        <div>
          <div class="admin-label">Items</div>
          <div class="admin-cart-pills">${cartIds || '<span class="admin-muted">—</span>'}</div>
        </div>
      </div>
      <div class="admin-order-footer">
        ${o.receiptUrl ? `<a class="admin-link" href="${escapeHtml(o.receiptUrl)}" target="_blank" rel="noopener">View receipt ↗</a>` : ''}
        <a class="admin-link" href="https://dashboard.stripe.com/payments/${escapeHtml(o.id)}" target="_blank" rel="noopener">Open in Stripe ↗</a>
      </div>
    </article>`;
}

// ============ CUSTOMERS ============
async function loadCustomers() {
  $('#customers-loading').hidden = false;
  $('#customers-empty').hidden = true;
  $('#customers-list').innerHTML = '';
  try {
    const data = await apiFetch('/.netlify/functions/admin-customers?limit=100');
    $('#customers-loading').hidden = true;
    const customers = data.customers || [];
    $('#customers-count').textContent = customers.length;
    if (customers.length === 0) {
      $('#customers-empty').hidden = false;
      return;
    }
    $('#customers-list').innerHTML = customers.map(renderCustomerCard).join('');
  } catch (err) {
    $('#customers-loading').hidden = true;
    showToast('Could not load customers', err.message);
  }
}
function renderCustomerCard(c) {
  return `
    <article class="admin-customer">
      <div class="admin-customer-avatar">${escapeHtml((c.name || c.email || '?').charAt(0).toUpperCase())}</div>
      <div class="admin-customer-body">
        <div class="admin-customer-name">${escapeHtml(c.name || c.email)}</div>
        <div class="admin-customer-email">${escapeHtml(c.email)}</div>
        <div class="admin-customer-meta">
          ${c.orderCount} order${c.orderCount !== 1 ? 's' : ''} · last on ${fmtDate(c.lastOrder)}
        </div>
      </div>
      <div class="admin-customer-spent">
        <div class="admin-customer-spent-amount">${fmtUSD(c.totalSpentCents)}</div>
        <div class="admin-customer-spent-label">total spent</div>
      </div>
    </article>`;
}

// ============ CONTACT MESSAGES ============
async function loadContact() {
  $('#contact-loading').hidden = false;
  $('#contact-empty').hidden = true;
  $('#contact-list').innerHTML = '';
  try {
    const data = await apiFetch('/.netlify/functions/admin-contact-list');
    $('#contact-loading').hidden = true;
    const submissions = data.submissions || [];
    const unread = submissions.filter(s => !s.read).length;
    $('#contact-unread').textContent = unread;
    $('#contact-total').textContent = submissions.length;
    updateContactBadge(unread);
    if (submissions.length === 0) {
      $('#contact-empty').hidden = false;
      return;
    }
    $('#contact-list').innerHTML = submissions.map(renderContactCard).join('');
  } catch (err) {
    $('#contact-loading').hidden = true;
    showToast('Could not load messages', err.message);
  }
}
function renderContactCard(s) {
  const extras = [];
  if (s.phone) extras.push(`Phone: ${escapeHtml(s.phone)}`);
  if (s.budget) extras.push(`Budget: ${escapeHtml(s.budget)}`);
  if (s.size) extras.push(`Size: ${escapeHtml(s.size)}`);
  const extrasHtml = extras.length ? `<div class="admin-contact-extras">${extras.join(' · ')}</div>` : '';
  const repliedBadge = s.replied ? '<span class="admin-badge paid">Replied</span>' : '';
  const unreadBadge = !s.read ? '<span class="admin-badge open">Unread</span>' : '';
  return `
    <article class="admin-contact-item ${s.read ? '' : 'unread'}" data-id="${escapeHtml(s.id)}">
      <div class="admin-contact-head">
        <div>
          <div class="admin-contact-meta">${escapeHtml(s.topicLabel || s.topic || 'General')} · ${fmtISO(s.createdAt)}</div>
          <div class="admin-contact-from"><strong>${escapeHtml(s.name)}</strong> · <a class="admin-link" href="mailto:${escapeHtml(s.email)}">${escapeHtml(s.email)}</a></div>
          ${extrasHtml}
        </div>
        <div class="admin-contact-status">
          ${unreadBadge}
          ${repliedBadge}
        </div>
      </div>
      <div class="admin-contact-message">${escapeHtml(s.message).replace(/\n/g, '<br>')}</div>
      <div class="admin-contact-actions">
        <a class="btn btn-ghost btn-sm" href="mailto:${escapeHtml(s.email)}?subject=Re: NVee Arts inquiry">Reply via email</a>
        <button class="btn btn-ghost btn-sm admin-contact-toggle" data-action="toggle-read" data-id="${escapeHtml(s.id)}" data-current="${s.read}">
          Mark ${s.read ? 'unread' : 'read'}
        </button>
        <button class="btn btn-ghost btn-sm admin-contact-toggle" data-action="toggle-replied" data-id="${escapeHtml(s.id)}" data-current="${s.replied}">
          Mark ${s.replied ? 'unreplied' : 'replied'}
        </button>
        <button class="btn btn-ghost btn-sm admin-danger" data-action="delete" data-id="${escapeHtml(s.id)}">Delete</button>
      </div>
    </article>`;
}
async function handleContactAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const current = btn.dataset.current === 'true';
  try {
    if (action === 'delete') {
      if (!confirm('Permanently delete this message?')) return;
      await apiFetch('/.netlify/functions/admin-contact-update', {
        method: 'POST',
        body: JSON.stringify({ id, delete: true }),
      });
      showToast('Message deleted');
    } else if (action === 'toggle-read') {
      await apiFetch('/.netlify/functions/admin-contact-update', {
        method: 'POST',
        body: JSON.stringify({ id, read: !current }),
      });
    } else if (action === 'toggle-replied') {
      await apiFetch('/.netlify/functions/admin-contact-update', {
        method: 'POST',
        body: JSON.stringify({ id, replied: !current }),
      });
    }
    loadContact();
  } catch (err) {
    showToast('Action failed', err.message);
  }
}
async function refreshContactBadge() {
  try {
    const data = await apiFetch('/.netlify/functions/admin-contact-list');
    const unread = (data.submissions || []).filter(s => !s.read).length;
    updateContactBadge(unread);
  } catch { /* ignore */ }
}
function updateContactBadge(count) {
  const b = $('#contact-badge');
  if (!b) return;
  if (count > 0) {
    b.textContent = count;
    b.hidden = false;
  } else {
    b.hidden = true;
  }
}

// ============ INVOICES ============
let allInvoicesCache = [];

async function loadInvoices() {
  $('#invoices-loading').hidden = false;
  $('#invoices-empty').hidden = true;
  $('#invoices-list').innerHTML = '';
  try {
    const data = await apiFetch('/.netlify/functions/admin-invoices-list?limit=100');
    $('#invoices-loading').hidden = true;
    const invoices = data.invoices || [];
    allInvoicesCache = invoices;
    if (invoices.length === 0) {
      $('#invoices-empty').hidden = false;
      return;
    }
    $('#invoices-list').innerHTML = invoices.map(renderInvoiceCard).join('');
  } catch (err) {
    $('#invoices-loading').hidden = true;
    showToast('Could not load invoices', err.message);
  }
}

function renderInvoiceCard(inv) {
  const statusColor = {
    paid: 'paid', open: 'open', draft: 'draft',
    void: 'voided', uncollectible: 'voided',
  }[inv.status] || '';

  // Status-aware action buttons
  const actions = [];
  if (inv.status === 'draft') {
    actions.push(`<button class="btn btn-ghost btn-sm" data-inv-action="edit" data-inv-id="${escapeHtml(inv.id)}">Edit</button>`);
    actions.push(`<button class="btn btn-ghost btn-sm" data-inv-action="send" data-inv-id="${escapeHtml(inv.id)}">Open in Stripe to send</button>`);
    actions.push(`<button class="btn btn-ghost btn-sm admin-danger" data-inv-action="delete" data-inv-id="${escapeHtml(inv.id)}">Delete</button>`);
  } else if (inv.status === 'open') {
    actions.push(`<button class="btn btn-ghost btn-sm admin-danger" data-inv-action="void" data-inv-id="${escapeHtml(inv.id)}">Delete</button>`);
  } else if (inv.status === 'paid') {
    actions.push(`<a class="btn btn-ghost btn-sm" href="https://dashboard.stripe.com/invoices/${escapeHtml(inv.id)}" target="_blank" rel="noopener">Refund in Stripe ↗</a>`);
  }

  return `
    <article class="admin-invoice">
      <div class="admin-invoice-head">
        <div>
          <div class="admin-invoice-num">${escapeHtml(inv.number)}</div>
          <div class="admin-invoice-customer">${escapeHtml(inv.customerName || '')} · ${escapeHtml(inv.customerEmail || '—')}</div>
        </div>
        <div class="admin-invoice-amount">
          <div>${fmtUSD(inv.amountDue)}</div>
          <span class="admin-badge ${statusColor}">${escapeHtml(inv.status || '')}</span>
        </div>
      </div>
      <div class="admin-invoice-body">
        <div class="admin-invoice-desc">${escapeHtml(inv.description || '—')}</div>
        <div class="admin-invoice-meta">Created ${fmtDate(inv.created)} · Due ${fmtDate(inv.dueDate)}</div>
      </div>
      <div class="admin-invoice-footer">
        ${inv.hostedInvoiceUrl ? `<a class="admin-link" href="${escapeHtml(inv.hostedInvoiceUrl)}" target="_blank" rel="noopener">Open hosted page ↗</a>` : ''}
        ${inv.invoicePdf ? `<a class="admin-link" href="${escapeHtml(inv.invoicePdf)}" target="_blank" rel="noopener">Download PDF ↓</a>` : ''}
        ${actions.length ? `<div class="admin-invoice-actions">${actions.join('')}</div>` : ''}
      </div>
    </article>`;
}

function toggleNewInvoiceCard(show) {
  const card = $('#new-invoice-card');
  card.hidden = !show;
  if (show) {
    $('#inv-email').focus();
    $('#inv-error').textContent = '';
    $('#inv-success').hidden = true;
  }
}

async function handleCreateInvoice(e) {
  e.preventDefault();
  const errEl = $('#inv-error');
  const successEl = $('#inv-success');
  const btn = $('#submit-new-invoice');
  errEl.textContent = '';
  successEl.hidden = true;
  btn.disabled = true;
  const originalText = btn.textContent;
  const saveAsDraft = $('#inv-save-draft').checked;
  btn.textContent = saveAsDraft ? 'Saving draft…' : 'Sending…';
  try {
    const body = {
      email: $('#inv-email').value.trim(),
      name: $('#inv-name').value.trim(),
      description: $('#inv-description').value.trim(),
      amountDollars: parseFloat($('#inv-amount').value),
      sendNow: $('#inv-send-now').checked,
      saveAsDraft,
    };
    const data = await apiFetch('/.netlify/functions/admin-invoices-create', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    let statusMsg;
    if (data.draft) statusMsg = `saved as a draft (status: ${data.status})`;
    else if (data.sent) statusMsg = 'sent to ' + escapeHtml(body.email);
    else statusMsg = 'finalized (not yet sent)';
    successEl.innerHTML = `
      ✓ Invoice <strong>${escapeHtml(data.number)}</strong> ${statusMsg}.
      ${data.hostedInvoiceUrl ? `<br><a href="${escapeHtml(data.hostedInvoiceUrl)}" target="_blank" rel="noopener">Open hosted page ↗</a>` : ''}
    `;
    successEl.hidden = false;
    $('#new-invoice-form').reset();
    $('#inv-send-now').checked = true;
    $('#inv-save-draft').checked = false;
    loadInvoices();
  } catch (err) {
    errEl.textContent = err.message || 'Failed to create invoice';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ---- Edit + delete (drafts/open) ----

function openInvoiceEditModal(inv) {
  $('#inv-edit-id').value = inv.id;
  $('#inv-edit-email').value = inv.customerEmail || '';
  $('#inv-edit-name').value = inv.customerName || '';
  $('#inv-edit-description').value = inv.description || '';
  // amountDue is in cents — convert to dollars for display
  $('#inv-edit-amount').value = inv.amountDue != null ? (inv.amountDue / 100).toFixed(2) : '';
  $('#invoice-edit-error').textContent = '';
  $('#invoice-edit-modal').hidden = false;
  setTimeout(() => $('#inv-edit-description').focus(), 50);
}

function closeInvoiceEditModal() {
  $('#invoice-edit-modal').hidden = true;
}

async function handleInvoiceEditSubmit(e) {
  e.preventDefault();
  const errEl = $('#invoice-edit-error');
  errEl.textContent = '';
  const btn = $('#invoice-edit-submit');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    const body = {
      id: $('#inv-edit-id').value,
      description: $('#inv-edit-description').value.trim(),
      amountDollars: parseFloat($('#inv-edit-amount').value),
      customerName: $('#inv-edit-name').value.trim(),
    };
    await apiFetch('/.netlify/functions/admin-invoices-update', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    showToast('Invoice updated');
    closeInvoiceEditModal();
    loadInvoices();
  } catch (err) {
    errEl.textContent = err.message || 'Update failed';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function handleInvoicesAction(e) {
  const btn = e.target.closest('[data-inv-action]');
  if (!btn) return;
  const action = btn.dataset.invAction;
  const id = btn.dataset.invId;
  const inv = allInvoicesCache.find(i => i.id === id);
  if (!inv) {
    showToast('Invoice not found', 'Refresh the tab and try again.');
    return;
  }
  try {
    if (action === 'edit') {
      openInvoiceEditModal(inv);
    } else if (action === 'delete') {
      if (!confirm(`Permanently delete draft invoice ${inv.number}?`)) return;
      await apiFetch('/.netlify/functions/admin-invoices-delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      showToast('Draft deleted');
      loadInvoices();
    } else if (action === 'void') {
      if (!confirm(`Delete invoice ${inv.number}?\n\nIt will be voided in Stripe and the customer can no longer pay it. This can't be undone.`)) return;
      await apiFetch('/.netlify/functions/admin-invoices-delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      showToast('Invoice deleted');
      loadInvoices();
    } else if (action === 'send') {
      // Finalize + send a draft. We re-use the create endpoint logic via a quick update:
      // simplest path is to tell the user to use Stripe dashboard, OR open hosted page link.
      // For now, alert them to use the Stripe dashboard since we don't have a dedicated finalize endpoint.
      const url = `https://dashboard.stripe.com/invoices/${id}`;
      window.open(url, '_blank', 'noopener');
      showToast('Finalize from Stripe', 'Opened the invoice in Stripe — click "Finalize" then "Send".');
    }
  } catch (err) {
    showToast('Action failed', err.message);
  }
}
// ============ PRODUCTS ============
let allProductsCache = [];
const productFilters = { status: 'all', collection: 'all', search: '', sort: 'default' };

// Slugify a name → URL-safe id. e.g. "San Fernando 818" → "san-fernando-818"
function slugify(name) {
  return (name || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function loadProductsAdmin() {
  $('#products-loading').hidden = false;
  $('#products-empty').hidden = true;
  $('#products-list-admin').innerHTML = '';
  try {
    const data = await apiFetch('/.netlify/functions/admin-products-list');
    $('#products-loading').hidden = true;
    allProductsCache = data.products || [];
    updateProductCounts();
    applyProductFilters();
  } catch (err) {
    $('#products-loading').hidden = true;
    showToast('Could not load products', err.message);
  }
}

function updateProductCounts() {
  const total = allProductsCache.length;
  const sold = allProductsCache.filter(p => p.soldOut).length;
  const avail = total - sold;
  const setCount = (key, value) => {
    const el = document.querySelector(`[data-status-count="${key}"]`);
    if (el) el.textContent = value;
  };
  setCount('all', total);
  setCount('available', avail);
  setCount('sold', sold);
}

function applyProductFilters() {
  let list = allProductsCache.slice();
  if (productFilters.status === 'available') list = list.filter(p => !p.soldOut);
  else if (productFilters.status === 'sold') list = list.filter(p => p.soldOut);
  if (productFilters.collection !== 'all') {
    list = list.filter(p => p.collection === productFilters.collection);
  }
  const q = productFilters.search.trim().toLowerCase();
  if (q) {
    list = list.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.id || '').toLowerCase().includes(q) ||
      (p.detail || '').toLowerCase().includes(q)
    );
  }
  if (productFilters.sort === 'price-desc') list.sort((a,b) => Number(b.price) - Number(a.price));
  else if (productFilters.sort === 'price-asc') list.sort((a,b) => Number(a.price) - Number(b.price));
  else if (productFilters.sort === 'name-asc') list.sort((a,b) => (a.name||'').localeCompare(b.name||''));
  else if (productFilters.sort === 'name-desc') list.sort((a,b) => (b.name||'').localeCompare(a.name||''));

  document.getElementById('products-showing').textContent =
    `Showing ${list.length} of ${allProductsCache.length}`;
  if (allProductsCache.length === 0) {
    $('#products-empty').hidden = false;
    $('#products-empty').textContent = 'No products yet. Click "+ New product" to add one.';
    $('#products-list-admin').innerHTML = '';
    return;
  } else if (list.length === 0) {
    $('#products-empty').hidden = false;
    $('#products-empty').textContent = 'No products match the current filters.';
    $('#products-list-admin').innerHTML = '';
    return;
  } else {
    $('#products-empty').hidden = true;
  }
  $('#products-list-admin').innerHTML = list.map(renderProductCard).join('');
}

function renderProductCard(p) {
  const tagBadge = p.tag ? `<span class="admin-badge open">${escapeHtml(p.tag)}</span>` : '';
  const soldBadge = p.soldOut ? '<span class="admin-badge voided">Sold</span>' : '<span class="admin-badge paid">Available</span>';
  const collectionLabel = ({
    signature: 'Signature',
    'mixed-media': 'Mixed Media',
    fluid: 'Fluid Art',
    florals: 'Florals',
  })[p.collection] || p.collection || '';
  return `
    <article class="admin-product-row ${p.soldOut ? 'sold' : ''}" data-id="${escapeHtml(p.id)}">
      <div class="admin-product-thumb">
        <img src="${escapeHtml(p.image || '')}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.opacity=0.3" />
      </div>
      <div class="admin-product-info">
        <div class="admin-product-line1">
          <strong class="admin-product-name">${escapeHtml(p.name)}</strong>
          <span class="admin-product-price">${fmtUSDPlain(p.price)}</span>
        </div>
        <div class="admin-product-line2">
          <span class="admin-product-collection">${escapeHtml(collectionLabel)}</span>
          <span class="admin-product-id">${escapeHtml(p.id)}</span>
          ${tagBadge}${soldBadge}
        </div>
        ${p.detail ? `<div class="admin-product-detail">${escapeHtml(p.detail)}</div>` : ''}
      </div>
      <div class="admin-product-actions-row">
        <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${escapeHtml(p.id)}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-action="toggle-sold" data-id="${escapeHtml(p.id)}">${p.soldOut ? 'Available' : 'Sold out'}</button>
        <button class="btn btn-ghost btn-sm admin-danger" data-action="delete" data-id="${escapeHtml(p.id)}">Delete</button>
      </div>
    </article>`;
}

async function fetchAllProducts() {
  const data = await apiFetch('/.netlify/functions/admin-products-list');
  allProductsCache = data.products || [];
  return allProductsCache;
}

// ---- Product modal: open/close + form state ----
let slugEditedManually = false;

function openProductModal(mode, product) {
  $('#prod-mode').value = mode;
  $('#product-modal-title').textContent = mode === 'new' ? 'New piece' : 'Edit piece';
  $('#product-form-error').textContent = '';
  const p = product || {};
  slugEditedManually = mode === 'edit'; // editing existing: ID locked
  $('#prod-id').value = p.id || '';
  setSlugDisplay(p.id || '—', mode === 'edit');
  $('#prod-name').value = p.name || '';
  $('#prod-price').value = p.price ?? '';
  $('#prod-shipping').value = p.shipping ?? '';
  $('#prod-collection').value = p.collection || 'signature';
  $('#prod-detail').value = p.detail || '';
  $('#prod-description').value = p.description || '';
  $('#prod-tag').value = p.tag || '';
  $('#prod-meta').value = p.meta || '';
  $('#prod-spec-size').value = (p.specs && p.specs.Size) || '';
  $('#prod-spec-medium').value = (p.specs && p.specs.Medium) || '';
  $('#prod-spec-year').value = (p.specs && p.specs.Year) || '';
  $('#prod-spec-edition').value = (p.specs && p.specs.Edition) || '';
  $('#prod-sold-out').checked = !!p.soldOut;
  $('#prod-image').value = p.image || '';

  // Reset file input + preview state
  $('#prod-file').value = '';
  showImagePreview(p.image || '');

  // Reset advanced section to collapsed
  $('#prod-advanced').hidden = true;
  $('#prod-advanced-toggle').setAttribute('aria-expanded', 'false');
  $('#prod-advanced-toggle').classList.remove('open');

  $('#product-modal').hidden = false;
  setTimeout(() => $('#prod-name').focus(), 50);
}
function closeProductModal() {
  $('#product-modal').hidden = true;
}

function setSlugDisplay(slug, locked) {
  const disp = $('#prod-id-display');
  if (disp) disp.textContent = slug || '—';
  const editBtn = $('#prod-edit-slug');
  if (editBtn) editBtn.hidden = locked;
}

function showImagePreview(url) {
  const empty = $('#prod-dropzone-empty');
  const preview = $('#prod-dropzone-preview');
  const uploading = $('#prod-dropzone-uploading');
  const img = $('#prod-image-preview');
  uploading.hidden = true;
  if (url) {
    img.src = url;
    preview.hidden = false;
    empty.hidden = true;
  } else {
    img.removeAttribute('src');
    preview.hidden = true;
    empty.hidden = false;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is a data URL like "data:image/jpeg;base64,..." — strip the prefix.
      const str = String(reader.result || '');
      const i = str.indexOf(',');
      resolve(i >= 0 ? str.slice(i + 1) : str);
    };
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}

async function uploadSelectedFile(file) {
  console.log('[upload] start', { name: file && file.name, size: file && file.size, type: file && file.type });
  const errEl = $('#product-form-error');
  if (errEl) errEl.textContent = '';

  if (!file) {
    console.warn('[upload] no file passed');
    return;
  }
  if (!file.type || !file.type.startsWith('image/')) {
    showFormError(`That file isn't a photo (type: ${file.type || 'unknown'}). Try a JPEG, PNG, or WebP image.`);
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showFormError(`Photo is too large (${(file.size/1024/1024).toFixed(1)} MB). Max is 8 MB — try resizing.`);
    return;
  }

  $('#prod-dropzone-empty').hidden = true;
  $('#prod-dropzone-preview').hidden = true;
  $('#prod-dropzone-uploading').hidden = false;

  try {
    console.log('[upload] reading file as base64…');
    const base64 = await readFileAsBase64(file);
    console.log('[upload] base64 length:', base64.length);
    console.log('[upload] POSTing to /.netlify/functions/admin-image-upload …');
    const data = await apiFetch('/.netlify/functions/admin-image-upload', {
      method: 'POST',
      body: JSON.stringify({
        name: file.name,
        contentType: file.type,
        base64,
      }),
    });
    console.log('[upload] success:', data);
    $('#prod-image').value = data.url;
    showImagePreview(data.url);
    showToast('Photo uploaded', file.name);
  } catch (err) {
    console.error('[upload] FAILED:', err);
    showFormError(`Upload failed: ${err.message || 'unknown error'}. Check the browser console + Netlify function logs.`);
    showImagePreview($('#prod-image').value); // restore prior preview
  }
}

function showFormError(message) {
  const errEl = $('#product-form-error');
  if (!errEl) return;
  errEl.textContent = message;
  errEl.style.padding = '12px 14px';
  errEl.style.background = 'rgba(255, 77, 94, 0.1)';
  errEl.style.border = '1px solid rgba(255, 77, 94, 0.35)';
  errEl.style.borderRadius = '10px';
  errEl.style.marginTop = '12px';
  errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function handleProductsAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  try {
    if (action === 'edit') {
      const product = allProductsCache.find(p => p.id === id);
      if (!product) throw new Error('Product not found in cache — refresh the tab');
      openProductModal('edit', product);
    } else if (action === 'toggle-sold') {
      const product = allProductsCache.find(p => p.id === id);
      if (!product) throw new Error('Product not found in cache — refresh the tab');
      const updated = { ...product, soldOut: !product.soldOut };
      await apiFetch('/.netlify/functions/admin-products-save', {
        method: 'POST',
        body: JSON.stringify(updated),
      });
      showToast(updated.soldOut ? 'Marked as sold out' : 'Marked as available', product.name);
      await loadProductsAdmin();
    } else if (action === 'delete') {
      if (!confirm('Permanently delete this piece? This cannot be undone.')) return;
      await apiFetch('/.netlify/functions/admin-products-delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      showToast('Piece deleted');
      await loadProductsAdmin();
    }
  } catch (err) {
    showToast('Action failed', err.message);
  }
}

async function handleProductFormSubmit(e) {
  e.preventDefault();
  console.log('[save] handleProductFormSubmit fired');
  const errEl = $('#product-form-error');
  if (errEl) {
    errEl.textContent = '';
    errEl.removeAttribute('style');
  }

  const name = $('#prod-name').value.trim();
  const id = ($('#prod-id').value.trim()) || slugify(name);
  const priceRaw = $('#prod-price').value;
  const price = parseFloat(priceRaw);
  const image = $('#prod-image').value.trim();

  console.log('[save] collected fields:', { name, id, priceRaw, price, hasImage: !!image });

  if (!name) {
    showFormError('Please give the piece a name.');
    $('#prod-name').focus();
    return;
  }
  if (!id) {
    showFormError('Could not generate a web ID from that name — try adding more characters.');
    $('#prod-name').focus();
    return;
  }
  if (isNaN(price) || price < 0) {
    showFormError('Please enter a valid price (a positive number).');
    $('#prod-price').focus();
    return;
  }
  // Image is recommended but no longer blocks save — you can save and add a photo later.
  if (!image) {
    const confirmed = confirm('No photo attached. The piece will show without an image on the shop. Save anyway?');
    if (!confirmed) return;
  }

  // Shipping is optional. Empty input → undefined so the server falls back to default.
  const shippingRaw = $('#prod-shipping').value;
  const shipping = shippingRaw === '' ? undefined : parseFloat(shippingRaw);
  if (shipping !== undefined && (isNaN(shipping) || shipping < 0)) {
    showFormError('Shipping must be a non-negative number, or leave it blank to use the default.');
    $('#prod-shipping').focus();
    return;
  }

  const product = {
    id,
    name,
    price,
    shipping, // undefined OK — server falls back to default
    collection: $('#prod-collection').value,
    image,
    meta: $('#prod-meta').value.trim(),
    tag: $('#prod-tag').value.trim(),
    tagClass: '',
    detail: $('#prod-detail').value.trim(),
    description: $('#prod-description').value.trim(),
    specs: {
      Size: $('#prod-spec-size').value.trim(),
      Medium: $('#prod-spec-medium').value.trim(),
      Year: $('#prod-spec-year').value.trim(),
      Edition: $('#prod-spec-edition').value.trim(),
    },
    soldOut: $('#prod-sold-out').checked,
  };

  const submitBtn = $('#product-form-submit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
  }
  try {
    console.log('[save] POSTing to /.netlify/functions/admin-products-save …');
    const result = await apiFetch('/.netlify/functions/admin-products-save', {
      method: 'POST',
      body: JSON.stringify(product),
    });
    console.log('[save] success:', result);
    showToast('Saved', product.name);
    closeProductModal();
    await loadProductsAdmin();
  } catch (err) {
    console.error('[save] FAILED:', err);
    showFormError(`Save failed: ${err.message || 'unknown error'}. Check the browser console + Netlify function logs.`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save piece';
    }
  }
}

// Filter / sort / search toolbar event handlers

// Filter / sort / search toolbar event handlers
function wireProductToolbar() {
  document.querySelectorAll('[data-pfilter-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      productFilters.status = btn.dataset.pfilterStatus;
      document.querySelectorAll('[data-pfilter-status]').forEach(b => b.classList.toggle('active', b === btn));
      applyProductFilters();
    });
  });
  document.querySelectorAll('[data-pfilter-collection]').forEach(btn => {
    btn.addEventListener('click', () => {
      productFilters.collection = btn.dataset.pfilterCollection;
      document.querySelectorAll('[data-pfilter-collection]').forEach(b => b.classList.toggle('active', b === btn));
      applyProductFilters();
    });
  });
  const search = document.getElementById('products-search');
  if (search) {
    search.addEventListener('input', () => {
      productFilters.search = search.value;
      applyProductFilters();
    });
  }
  const sort = document.getElementById('products-sort');
  if (sort) {
    sort.addEventListener('change', () => {
      productFilters.sort = sort.value;
      applyProductFilters();
    });
  }
}

function wireProductModal() {
  const nameEl = $('#prod-name');
  if (nameEl) {
    nameEl.addEventListener('input', () => {
      if (slugEditedManually) return;
      const newSlug = slugify(nameEl.value);
      $('#prod-id').value = newSlug;
      setSlugDisplay(newSlug, false);
    });
  }
  const editSlug = $('#prod-edit-slug');
  if (editSlug) {
    editSlug.addEventListener('click', () => {
      const current = $('#prod-id').value;
      const next = prompt('Web ID (lowercase letters, numbers, and hyphens only):', current);
      if (next === null) return;
      const cleaned = slugify(next);
      if (!cleaned) return;
      $('#prod-id').value = cleaned;
      setSlugDisplay(cleaned, false);
      slugEditedManually = true;
    });
  }
  const advToggle = $('#prod-advanced-toggle');
  if (advToggle) {
    advToggle.addEventListener('click', () => {
      const adv = $('#prod-advanced');
      const open = adv.hidden;
      adv.hidden = !open;
      advToggle.setAttribute('aria-expanded', String(open));
      advToggle.classList.toggle('open', open);
    });
  }
  const fileInput = $('#prod-file');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) uploadSelectedFile(file);
    });
  }
  const dropzone = $('#prod-dropzone');
  if (dropzone) {
    ['dragenter', 'dragover'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.add('dragging');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
        if (evt === 'dragleave' && e.target !== dropzone) return;
        dropzone.classList.remove('dragging');
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) uploadSelectedFile(file);
    });
  }
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  $('#admin-login-form').addEventListener('submit', handleLogin);
  $('#admin-logout').addEventListener('click', handleLogout);
  $$('.admin-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Hoist modal backdrops to <body> so their `position: fixed; inset: 0;`
  // genuinely covers the full viewport. Without this, a backdrop-filter or
  // transform on any ancestor creates a containing block that constrains
  // the modal to the panel it lives inside.
  document.querySelectorAll('.admin-modal-backdrop').forEach((m) => {
    if (m.parentNode !== document.body) document.body.appendChild(m);
  });

  // Dashboard quick actions + activity items
  const dashPanel = document.getElementById('panel-dashboard');
  if (dashPanel) dashPanel.addEventListener('click', handleQuickAction);

  // Invoices
  $('#open-new-invoice').addEventListener('click', () => toggleNewInvoiceCard(true));
  $('#cancel-new-invoice').addEventListener('click', () => toggleNewInvoiceCard(false));
  $('#new-invoice-form').addEventListener('submit', handleCreateInvoice);
  $('#invoices-list').addEventListener('click', handleInvoicesAction);
  $('#invoice-edit-close').addEventListener('click', closeInvoiceEditModal);
  $('#invoice-edit-cancel').addEventListener('click', closeInvoiceEditModal);
  $('#invoice-edit-form').addEventListener('submit', handleInvoiceEditSubmit);
  $('#invoice-edit-modal').addEventListener('click', (e) => {
    if (e.target.id === 'invoice-edit-modal') closeInvoiceEditModal();
  });

  // Contact
  $('#contact-list').addEventListener('click', handleContactAction);

  // Products
  $('#products-list-admin').addEventListener('click', handleProductsAction);
  $('#open-new-product').addEventListener('click', () => openProductModal('new', null));
  $('#product-modal-close').addEventListener('click', closeProductModal);
  $('#product-form-cancel').addEventListener('click', closeProductModal);
  $('#product-form').addEventListener('submit', handleProductFormSubmit);
  $('#product-modal').addEventListener('click', (e) => {
    if (e.target.id === 'product-modal') closeProductModal();
  });
  wireProductToolbar();
  wireProductModal();

  if (getToken()) {
    showAdminShell();
  } else {
    showLoginScreen();
    setTimeout(() => $('#admin-pw').focus(), 100);
  }
});
