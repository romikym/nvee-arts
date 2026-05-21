// ============ NVee Arts Storefront — App ============
// Products are loaded from data/products.json so the catalog can be
// the single source of truth shared with the server-side checkout function.
let PRODUCTS = [];

async function loadProducts() {
  try {
    const res = await fetch('data/products.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to load products: ' + res.status);
    PRODUCTS = await res.json();
  } catch (err) {
    console.error('Could not load product catalog:', err);
    PRODUCTS = [];
  }
}

// Shipping is calculated by Stripe based on the configured shipping rate at checkout.
// This local rate is only used for the cart-drawer subtotal preview.
const SHIPPING_RATE = 11;
const cart = new Map();
let currentFilter = 'all';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const fmt = n => '$' + n.toFixed(0);
const getProduct = id => PRODUCTS.find(p => p.id === id);

// PRODUCT GRID
function renderProducts() {
  const grid = $('#products-grid');
  const matches = PRODUCTS.filter(p => currentFilter === 'all' || p.collection === currentFilter);
  if (matches.length === 0) {
    grid.innerHTML = '<div class="empty-state"><h3>Nothing here yet</h3><p>Try another collection.</p></div>';
    $('#shop-count').textContent = 0; return;
  }
  $('#shop-count').textContent = matches.length;
  grid.innerHTML = matches.map(p => `
    <article class="product" data-id="${p.id}">
      <div class="product-img">
        ${p.tag ? `<span class="product-tag ${p.tagClass}">${p.tag}</span>` : ''}
        <button class="product-quick-add" aria-label="Quick add" data-id="${p.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <img src="${p.image}" alt="${p.name}" loading="lazy" />
      </div>
      <div class="product-meta">${p.meta}</div>
      <h3 class="product-name">${p.name}</h3>
      <p class="product-detail">${p.detail}</p>
      <div class="product-price">${fmt(p.price)} <small>+ shipping</small></div>
    </article>
  `).join('');
}

function setFilter(filter) {
  currentFilter = filter;
  $$('#filter-row .filter-pill').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  const grid = $('#products-grid');
  grid.classList.add('fading');
  setTimeout(() => { renderProducts(); grid.classList.remove('fading'); }, 200);
}
function setFilterAndScroll(filter) {
  setFilter(filter);
  setTimeout(() => $('#shop').scrollIntoView({ behavior: 'smooth' }), 100);
}

// CART
const cartLines = () => Array.from(cart.entries()).map(([id, qty]) => ({ ...getProduct(id), qty }));
const cartItemCount = () => Array.from(cart.values()).reduce((a, b) => a + b, 0);
const cartSubtotal = () => cartLines().reduce((a, l) => a + l.price * l.qty, 0);
const cartShipping = () => cart.size === 0 ? 0 : SHIPPING_RATE;
const cartTotal = () => cartSubtotal() + cartShipping();

function addToCart(id, opts = {}) {
  cart.set(id, (cart.get(id) || 0) + 1);
  renderCart();
  bumpCartCount();
  const p = getProduct(id);
  if (!opts.silent) showToast('Added to cart', `${p.name} · ${fmt(p.price)}`);
  if (opts.openCart) openCart();
}
function setQty(id, qty) {
  if (qty <= 0) cart.delete(id);
  else cart.set(id, qty);
  renderCart();
}
function bumpCartCount() {
  const el = $('#cart-count');
  el.textContent = cartItemCount();
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}

function renderCart() {
  const items = $('#cart-items');
  const lines = cartLines();
  $('#cart-count').textContent = cartItemCount();
  $('#cart-item-count').textContent = lines.length ? ` (${cartItemCount()})` : '';
  $('#open-checkout').disabled = lines.length === 0;
  if (lines.length === 0) {
    items.innerHTML = `
      <div class="cart-empty">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        <h4>Your cart is empty</h4>
        <p style="font-size: 14px; max-width: 280px; margin: 0 auto;">Browse the shop and add a piece to get started.</p>
      </div>`;
  } else {
    items.innerHTML = lines.map(l => `
      <div class="cart-item">
        <div class="cart-item-img"><img src="${l.image}" alt=""></div>
        <div class="cart-item-body">
          <div class="cart-item-meta">${l.meta}</div>
          <div class="cart-item-name">${l.name}</div>
          <div class="cart-item-detail">${fmt(l.price)} each</div>
          <div class="cart-item-row">
            <div class="qty-stepper">
              <button onclick="setQty('${l.id}', ${l.qty - 1})">−</button>
              <span>${l.qty}</span>
              <button onclick="setQty('${l.id}', ${l.qty + 1})">+</button>
            </div>
            <div class="cart-item-price">${fmt(l.price * l.qty)}</div>
          </div>
          <button class="cart-item-remove" onclick="setQty('${l.id}', 0)">Remove</button>
        </div>
      </div>`).join('');
  }
  $('#subtotal').textContent = fmt(cartSubtotal());
  $('#shipping').textContent = cart.size === 0 ? '—' : fmt(cartShipping());
  $('#total').textContent = fmt(cartTotal());
}

function openCart() {
  $('#cart-drawer').classList.add('open');
  $('#backdrop').classList.add('open');
  document.body.classList.add('no-scroll');
}
function closeCart() {
  $('#cart-drawer').classList.remove('open');
  if (!$('#product-modal').classList.contains('open')) {
    $('#backdrop').classList.remove('open');
    document.body.classList.remove('no-scroll');
  }
}

// PRODUCT MODAL
function openProductModal(id) {
  const p = getProduct(id);
  if (!p) return;
  const tagHtml = p.tag ? `<span class="product-tag ${p.tagClass}">${p.tag}</span>` : '';
  $('#pm-image').innerHTML = `${tagHtml}<img src="${p.image}" alt="${p.name}">`;
  const specs = Object.entries(p.specs).map(([k, v]) =>
    `<div class="pm-spec"><span class="pm-spec-label">${k}</span><span class="pm-spec-value">${v}</span></div>`).join('');
  $('#pm-body').innerHTML = `
    <button class="close-btn pm-close" id="close-pm" aria-label="Close">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
    <div class="pm-eyebrow">${p.meta}</div>
    <h2 class="pm-name">${p.name}</h2>
    <div class="pm-price">${fmt(p.price)} <small>+ shipping</small></div>
    <p class="pm-description">${p.description}</p>
    <div class="pm-specs">${specs}</div>
    <div class="pm-add-row">
      <button class="pm-add-btn" onclick="addToCart('${p.id}', { openCart: true }); closeProductModal();">Add to Cart · ${fmt(p.price)}</button>
    </div>
    <div class="pm-trust">
      <div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> One of one</div>
      <div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Ships from NoHo</div>
      <div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/></svg> Signed</div>
    </div>`;
  $('#close-pm').addEventListener('click', closeProductModal);
  $('#product-modal').classList.add('open');
  $('#backdrop').classList.add('open');
  document.body.classList.add('no-scroll');
}
function closeProductModal() {
  $('#product-modal').classList.remove('open');
  if (!$('#cart-drawer').classList.contains('open')) {
    $('#backdrop').classList.remove('open');
    document.body.classList.remove('no-scroll');
  }
}

// CHECKOUT
// ============ CHECKOUT (Stripe Hosted) ============
// Stripe collects email, shipping address, and payment on its hosted page.
// We just POST the cart to our serverless function, get a session URL, and redirect.

async function startCheckout() {
  const btn = document.getElementById('open-checkout');
  if (!btn || cart.size === 0) return;
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Connecting to Stripe…';
  try {
    const items = cartLines().map(l => ({ id: l.id, quantity: l.qty }));
    const res = await fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error('Checkout failed: ' + res.status + ' ' + detail);
    }
    const data = await res.json();
    if (!data.url) throw new Error('No checkout URL returned');
    // Persist cart so we can clear it after Stripe confirms success.
    try { sessionStorage.setItem('nvee-checkout-pending', '1'); } catch (e) {}
    window.location.href = data.url;
  } catch (err) {
    console.error(err);
    showToast('Checkout error', 'Could not reach Stripe. Please try again or email Veronica.');
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// Stripe redirects back to success.html on success or to index.html?canceled=1 on cancel.
// Detect both on page load.
function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('canceled') === '1') {
    showToast('Checkout canceled', 'Your cart is still saved.');
    // Clean the URL
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
  }
}

// TOAST
function showToast(title, sub = '') {
  const container = $('#toast-container');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `
    <div class="toast-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
    <div class="toast-body"><div class="toast-title">${title}</div>${sub ? `<div class="toast-sub">${sub}</div>` : ''}</div>`;
  container.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2800);
}

// INIT
async function init() {
  await loadProducts();
  renderProducts();
  renderCart();
  $('#open-cart').addEventListener('click', openCart);
  $('#close-cart').addEventListener('click', closeCart);
  $('#backdrop').addEventListener('click', () => { closeCart(); closeProductModal(); });
  $('#open-checkout').addEventListener('click', startCheckout);
  handleStripeReturn();
  $('#filter-row').addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (pill) setFilter(pill.dataset.filter);
  });
  $$('.collection-card').forEach(c => c.addEventListener('click', () => setFilterAndScroll(c.dataset.filter)));
  $$('a[data-filter]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); setFilterAndScroll(a.dataset.filter); }));
  $('#products-grid').addEventListener('click', e => {
    const quickAdd = e.target.closest('.product-quick-add');
    if (quickAdd) { e.stopPropagation(); addToCart(quickAdd.dataset.id); return; }
    const product = e.target.closest('.product');
    if (product) openProductModal(product.dataset.id);
  });
  $('.hero-visual')?.addEventListener('click', () => openProductModal('raiders'));
  $$('.studio-tile').forEach(tile => tile.addEventListener('click', () => {
    if (tile.dataset.productId) openProductModal(tile.dataset.productId);
  }));
  $('#newsletter-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    showToast("You're on the list", `Confirmation sent to ${input.value}`);
    input.value = '';
    e.target.querySelector('button').textContent = 'Subscribed ✓';
  });

  // Contact form
  const contactForm = $('#contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', e => {
      e.preventDefault();
      // Clear previous errors
      $$('.field.has-error').forEach(f => f.classList.remove('has-error'));
      $$('.field-error').forEach(e => e.textContent = '');

      const name = $('#cf-name').value.trim();
      const email = $('#cf-email').value.trim();
      const topic = $('#cf-topic').value;
      const message = $('#cf-message').value.trim();

      let hasError = false;
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!name) {
        $('#cf-name').parentElement.classList.add('has-error');
        $('#err-name').textContent = 'Please enter your name';
        hasError = true;
      }
      if (!email) {
        $('#cf-email').parentElement.classList.add('has-error');
        $('#err-email').textContent = 'Please enter your email';
        hasError = true;
      } else if (!emailRe.test(email)) {
        $('#cf-email').parentElement.classList.add('has-error');
        $('#err-email').textContent = 'Please enter a valid email';
        hasError = true;
      }
      if (!message || message.length < 10) {
        $('#cf-message').parentElement.classList.add('has-error');
        $('#err-message').textContent = 'Please write at least a sentence';
        hasError = true;
      }

      if (hasError) {
        showToast('Almost there', 'Please fix the highlighted fields');
        return;
      }

      const btn = contactForm.querySelector('button[type="submit"]');
      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = 'Sending…';

      setTimeout(() => {
        showToast('Message sent', 'Veronica will reply within 24 hours');
        contactForm.reset();
        btn.innerHTML = 'Sent ✓';
        setTimeout(() => { btn.disabled = false; btn.innerHTML = originalHtml; }, 3500);
      }, 700);
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeProductModal(); closeCart(); }
  });
  window.addEventListener('scroll', () => {
    const nav = $('.nav');
    if (window.scrollY > 30) {
      nav.style.background = 'rgba(5, 8, 16, 0.92)';
      nav.style.boxShadow = '0 8px 30px rgba(0,0,0,0.4)';
    } else {
      nav.style.background = 'rgba(5, 8, 16, 0.65)';
      nav.style.boxShadow = 'none';
    }
  });
}
document.addEventListener('DOMContentLoaded', init);

// ============ ANIMATIONS ============
function setupScrollReveals() {
  // Auto-tag elements for reveal animations
  const revealSelectors = [
    '.section-head',
    '.collection-card',
    '.about-content > *',
    '.about-image',
    '.studio-inner > *',
    '.testimonial blockquote',
    '.testimonial cite',
    '.contact-form',
    '.contact-card',
    '.commission-cta',
    '.faq-item',
    '.newsletter-inner > *'
  ];
  revealSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => el.classList.add('reveal'));
  });

  // Stagger containers — children fade in one after another
  const staggerSelectors = ['.collections-grid', '.contact-methods', '.faq-list', '.about-stats', '.studio-visual'];
  staggerSelectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => el.classList.add('reveal-stagger'));
  });

  // IntersectionObserver — triggers .in-view when element enters viewport
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

  document.querySelectorAll('.reveal, .reveal-stagger').forEach(el => io.observe(el));
}

function animateStats() {
  const statNums = document.querySelectorAll('.stat-num');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const text = el.textContent.trim();
      // Only animate pure number stats
      const match = text.match(/^(\d+)(\+?)$/);
      if (match) {
        const target = parseInt(match[1]);
        const suffix = match[2];
        const duration = 1200;
        const start = performance.now();
        const animate = (now) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          el.textContent = Math.floor(target * eased) + suffix;
          if (t < 1) requestAnimationFrame(animate);
          else el.textContent = target + suffix;
        };
        requestAnimationFrame(animate);
      }
      io.unobserve(el);
    });
  }, { threshold: 0.5 });
  statNums.forEach(el => io.observe(el));
}

// Re-trigger reveal animations when products re-render after filter
function tagNewProductsForReveal() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;
  const products = grid.querySelectorAll('.product');
  products.forEach((p, i) => {
    p.style.opacity = '0';
    p.style.transform = 'translateY(20px)';
    p.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    p.style.transitionDelay = `${Math.min(i * 0.05, 0.5)}s`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        p.style.opacity = '1';
        p.style.transform = 'translateY(0)';
      });
    });
  });
}

// Hook into the existing renderProducts to add stagger
const _origRenderProducts = renderProducts;
renderProducts = function() {
  _origRenderProducts();
  tagNewProductsForReveal();
};

// Kick off animations once DOM is ready (init already ran by this point)
document.addEventListener('DOMContentLoaded', () => {
  setupScrollReveals();
  animateStats();
});

// ============ MOBILE MENU ============
function openMenu() {
  const m = document.getElementById('mobile-menu');
  const h = document.getElementById('open-menu');
  m.classList.add('open');
  h.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}
function closeMenu() {
  const m = document.getElementById('mobile-menu');
  const h = document.getElementById('open-menu');
  m.classList.remove('open');
  h.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('no-scroll');
}

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('open-menu');
  const closeBtn = document.getElementById('close-menu');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (document.getElementById('mobile-menu').classList.contains('open')) closeMenu();
      else openMenu();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);
  document.querySelectorAll('[data-menu-link]').forEach(a => {
    a.addEventListener('click', closeMenu);
  });
  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('mobile-menu')?.classList.contains('open')) closeMenu();
  });
});
