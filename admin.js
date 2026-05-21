// ============ NVee Arts Admin ============
// Single-page admin for orders, customers, and invoices.
// Auth: custom JWT issued by /.netlify/functions/admin-login.

const TOKEN_STORAGE_KEY = 'nvee-admin-token';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function fmtUSD(cents) {
  return '$' + (cents / 100).toFixed(2);
}
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

// ============ TOAST ============
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

// ============ LOGIN ============
function showLoginScreen() {
  $('#admin-login-screen').hidden = false;
  $('#admin-shell').hidden = true;
}
function showAdminShell() {
  $('#admin-login-screen').hidden = true;
  $('#admin-shell').hidden = false;
  switchTab('orders');
}

async function handleLogin(e) {
  e.preventDefault();
  const pw = $('#admin-pw').value;
  const errEl = $('#admin-login-error');
  const btn = $('#admin-login-btn');
  errEl.textContent = '';
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const res = await fetch('/.netlify/functions/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setToken(data.token);
    showAdminShell();
  } catch (err) {
    errEl.textContent = err.message || 'Login failed';
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

// ============ TABS ============
function switchTab(name) {
  $$('.admin-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  ['orders', 'customers', 'invoices'].forEach((t) => {
    $('#panel-' + t).hidden = t !== name;
  });
  if (name === 'orders') loadOrders();
  if (name === 'customers') loadCustomers();
  if (name === 'invoices') loadInvoices();
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
        <a class="admin-link" href="https://dashboard.stripe.com/test/payments/${escapeHtml(o.id)}" target="_blank" rel="noopener">Open in Stripe ↗</a>
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

// ============ INVOICES ============
async function loadInvoices() {
  $('#invoices-loading').hidden = false;
  $('#invoices-empty').hidden = true;
  $('#invoices-list').innerHTML = '';
  try {
    const data = await apiFetch('/.netlify/functions/admin-invoices-list?limit=100');
    $('#invoices-loading').hidden = true;
    const invoices = data.invoices || [];
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
    paid: 'paid',
    open: 'open',
    draft: 'draft',
    void: 'voided',
    uncollectible: 'voided',
  }[inv.status] || '';
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
      </div>
    </article>`;
}

// New invoice flow
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
  btn.textContent = 'Sending…';
  try {
    const body = {
      email: $('#inv-email').value.trim(),
      name: $('#inv-name').value.trim(),
      description: $('#inv-description').value.trim(),
      amountDollars: parseFloat($('#inv-amount').value),
      sendNow: $('#inv-send-now').checked,
    };
    const data = await apiFetch('/.netlify/functions/admin-invoices-create', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    successEl.innerHTML = `
      ✓ Invoice <strong>${escapeHtml(data.number)}</strong> ${data.sent ? 'sent to ' + escapeHtml(body.email) : 'created (not yet sent)'}.
      ${data.hostedInvoiceUrl ? `<br><a href="${escapeHtml(data.hostedInvoiceUrl)}" target="_blank" rel="noopener">Open hosted page ↗</a>` : ''}
    `;
    successEl.hidden = false;
    $('#new-invoice-form').reset();
    $('#inv-send-now').checked = true;
    loadInvoices();
  } catch (err) {
    errEl.textContent = err.message || 'Failed to create invoice';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  // Login
  $('#admin-login-form').addEventListener('submit', handleLogin);
  $('#admin-logout').addEventListener('click', handleLogout);

  // Tabs
  $$('.admin-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Invoices
  $('#open-new-invoice').addEventListener('click', () => toggleNewInvoiceCard(true));
  $('#cancel-new-invoice').addEventListener('click', () => toggleNewInvoiceCard(false));
  $('#new-invoice-form').addEventListener('submit', handleCreateInvoice);

  // Decide which view to show
  if (getToken()) {
    showAdminShell();
  } else {
    showLoginScreen();
    setTimeout(() => $('#admin-pw').focus(), 100);
  }
});
