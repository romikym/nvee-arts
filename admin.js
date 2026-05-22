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
  switchTab('orders');
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
      if (data.debug) {
        const d = data.debug;
        errEl.innerHTML = `
          <strong>${baseMsg}</strong>
          <div style="margin-top:8px; padding:10px 12px; background:rgba(255,77,94,0.08); border-radius:8px; font-family:ui-monospace,monospace; font-size:11px; line-height:1.6; color:#fff; text-align:left;">
            submitted length: <strong>${d.submittedLength}</strong><br>
            configured length: <strong>${d.configuredLength}</strong><br>
            lengths match: <strong>${d.lengthsMatch}</strong><br>
            submitted hash prefix: ${d.submittedSha256Prefix}<br>
            configured hash prefix: ${d.configuredSha256Prefix}<br>
            hashes match: <strong>${d.hashesMatch}</strong><br>
            configured starts with whitespace: <strong>${d.configuredStartsWithSpace}</strong><br>
            configured ends with whitespace: <strong>${d.configuredEndsWithSpace}</strong><br>
            configured has newline: <strong>${d.configuredHasNewline}</strong>
          </div>`;
      } else {
        errEl.textContent = baseMsg;
      }
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
  ['orders', 'customers', 'contact', 'invoices', 'products'].forEach((t) => {
    const panel = document.getElementById('panel-' + t);
    if (panel) panel.hidden = t !== name;
  });
  if (name === 'orders') loadOrders();
  if (name === 'customers') loadCustomers();
  if (name === 'contact') loadContact();
  if (name === 'invoices') loadInvoices();
  if (name === 'products') loadProductsAdmin();
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
    paid: 'paid', open: 'open', draft: 'draft',
    void: 'voided', uncollectible: 'voided',
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

// ============ PRODUCTS ============
async function loadProductsAdmin() {
  $('#products-loading').hidden = false;
  $('#products-empty').hidden = true;
  $('#products-list-admin').innerHTML = '';
  try {
    const data = await apiFetch('/.netlify/functions/admin-products-list');
    $('#products-loading').hidden = true;
    const products = data.products || [];
    if (products.length === 0) {
      $('#products-empty').hidden = false;
      return;
    }
    $('#products-list-admin').innerHTML = products.map(renderProductCard).join('');
  } catch (err) {
    $('#products-loading').hidden = true;
    showToast('Could not load products', err.message);
  }
}
function renderProductCard(p) {
  const soldBadge = p.soldOut ? '<span class="admin-badge voided">Sold</span>' : '';
  const tagBadge = p.tag ? `<span class="admin-badge open">${escapeHtml(p.tag)}</span>` : '';
  return `
    <article class="admin-product-card ${p.soldOut ? 'sold' : ''}" data-id="${escapeHtml(p.id)}">
      <div class="admin-product-img">
        <img src="${escapeHtml(p.image || '')}" alt="${escapeHtml(p.name)}" onerror="this.style.opacity=0.3" />
      </div>
      <div class="admin-product-body">
        <div class="admin-product-row">
          <strong>${escapeHtml(p.name)}</strong>
          <span class="admin-product-price">${fmtUSDPlain(p.price)}</span>
        </div>
        <div class="admin-product-meta">${escapeHtml(p.meta || '')} · <code>${escapeHtml(p.id)}</code></div>
        <div class="admin-product-badges">${soldBadge}${tagBadge}</div>
      </div>
      <div class="admin-product-actions">
        <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${escapeHtml(p.id)}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-action="toggle-sold" data-id="${escapeHtml(p.id)}">${p.soldOut ? 'Mark available' : 'Mark sold'}</button>
        <button class="btn btn-ghost btn-sm admin-danger" data-action="delete" data-id="${escapeHtml(p.id)}">Delete</button>
      </div>
    </article>`;
}
let allProductsCache = [];
async function fetchAllProducts() {
  const data = await apiFetch('/.netlify/functions/admin-products-list');
  allProductsCache = data.products || [];
  return allProductsCache;
}
function openProductModal(mode, product) {
  $('#product-mode').value = mode;
  $('#product-modal-title').textContent = mode === 'new' ? 'New product' : 'Edit product';
  $('#product-form-error').textContent = '';
  const p = product || {};
  $('#prod-id').value = p.id || '';
  $('#prod-id').readOnly = mode === 'edit';
  $('#prod-name').value = p.name || '';
  $('#prod-price').value = p.price ?? '';
  $('#prod-collection').value = p.collection || 'signature';
  $('#prod-image').value = p.image || '';
  $('#prod-meta').value = p.meta || '';
  $('#prod-tag').value = p.tag || '';
  $('#prod-detail').value = p.detail || '';
  $('#prod-description').value = p.description || '';
  $('#prod-spec-size').value = (p.specs && p.specs.Size) || '';
  $('#prod-spec-medium').value = (p.specs && p.specs.Medium) || '';
  $('#prod-spec-year').value = (p.specs && p.specs.Year) || '';
  $('#prod-spec-edition').value = (p.specs && p.specs.Edition) || '';
  $('#prod-sold-out').checked = !!p.soldOut;
  $('#product-modal').hidden = false;
  setTimeout(() => $('#prod-name').focus(), 50);
}
function closeProductModal() {
  $('#product-modal').hidden = true;
}
async function handleProductsAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  try {
    if (action === 'edit') {
      if (!allProductsCache.length) await fetchAllProducts();
      const product = allProductsCache.find(p => p.id === id);
      openProductModal('edit', product);
    } else if (action === 'toggle-sold') {
      if (!allProductsCache.length) await fetchAllProducts();
      const product = allProductsCache.find(p => p.id === id);
      if (!product) throw new Error('Product not found in cache');
      product.soldOut = !product.soldOut;
      await apiFetch('/.netlify/functions/admin-products-save', {
        method: 'POST',
        body: JSON.stringify(product),
      });
      showToast(product.soldOut ? 'Marked sold' : 'Marked available');
      await fetchAllProducts();
      loadProductsAdmin();
    } else if (action === 'delete') {
      if (!confirm('Permanently delete this product? This cannot be undone.')) return;
      await apiFetch('/.netlify/functions/admin-products-delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      showToast('Product deleted');
      await fetchAllProducts();
      loadProductsAdmin();
    }
  } catch (err) {
    showToast('Action failed', err.message);
  }
}
async function handleProductFormSubmit(e) {
  e.preventDefault();
  const errEl = $('#product-form-error');
  errEl.textContent = '';
  const product = {
    id: $('#prod-id').value.trim(),
    name: $('#prod-name').value.trim(),
    price: parseFloat($('#prod-price').value),
    collection: $('#prod-collection').value,
    image: $('#prod-image').value.trim(),
    meta: $('#prod-meta').value.trim(),
    tag: $('#prod-tag').value.trim(),
    tagClass: '', // back-compat with existing renderer
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
  if (!product.id || !product.name || isNaN(product.price)) {
    errEl.textContent = 'ID, name, and price are required.';
    return;
  }
  try {
    await apiFetch('/.netlify/functions/admin-products-save', {
      method: 'POST',
      body: JSON.stringify(product),
    });
    showToast('Saved', product.name);
    closeProductModal();
    await fetchAllProducts();
    loadProductsAdmin();
  } catch (err) {
    errEl.textContent = err.message || 'Save failed';
  }
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  $('#admin-login-form').addEventListener('submit', handleLogin);
  $('#admin-logout').addEventListener('click', handleLogout);
  $$('.admin-tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Invoices
  $('#open-new-invoice').addEventListener('click', () => toggleNewInvoiceCard(true));
  $('#cancel-new-invoice').addEventListener('click', () => toggleNewInvoiceCard(false));
  $('#new-invoice-form').addEventListener('submit', handleCreateInvoice);

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

  if (getToken()) {
    showAdminShell();
  } else {
    showLoginScreen();
    setTimeout(() => $('#admin-pw').focus(), 100);
  }
});
