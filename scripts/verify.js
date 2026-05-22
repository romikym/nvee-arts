#!/usr/bin/env node
// NVee Arts pre-deploy verifier.
//
// Run before every `git push`:
//   npm test
// (or: `node scripts/verify.js`)
//
// Checks:
//   1. NUL byte truncation across all source files (OneDrive sync corruption)
//   2. JS syntax across all .js files
//   3. JSON validity across all .json files
//   4. CSS brace balance
//   5. Admin HTML IDs cross-reference with admin.js
//   6. Critical event listeners are wired in init (the silent killer)
//   7. Single source of truth for the product catalog
//   8. Hardcoded secrets not committed to code
//   9. All admin endpoints have requireAuth
//
// Exits non-zero on any failure so it can gate a git pre-push hook later.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const log = (s) => process.stdout.write(s + '\n');
const ok = (s) => log('  \x1b[32m✓\x1b[0m ' + s);
const warn = (s) => log('  \x1b[33m⚠\x1b[0m ' + s);
const fail = (s) => log('  \x1b[31m✗\x1b[0m ' + s);
const header = (s) => log('\n\x1b[1m' + s + '\x1b[0m');

let errors = 0;
let warnings = 0;

function walk(dir, ignore = ['node_modules', '.git', '.netlify', 'dist', 'build']) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignore.includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, ignore));
    else out.push(p);
  }
  return out;
}

function rel(p) { return path.relative(ROOT, p); }

// ============ 1. NUL byte check ============
header('1. NUL byte truncation check');
const allFiles = walk(ROOT).filter((p) =>
  /\.(js|json|html|css|toml|md|gitignore)$/.test(p) || path.basename(p) === '.gitignore'
);
let nulIssues = 0;
for (const p of allFiles) {
  const buf = fs.readFileSync(p);
  const clean = buf.subarray(0, buf.length - countTrailingNul(buf));
  if (clean.length !== buf.length) {
    fail(`${rel(p)} has ${buf.length - clean.length} trailing NUL byte(s)`);
    nulIssues++;
    errors++;
  }
}
if (nulIssues === 0) ok(`all ${allFiles.length} source files clean`);

function countTrailingNul(buf) {
  let n = 0;
  for (let i = buf.length - 1; i >= 0 && buf[i] === 0; i--) n++;
  return n;
}

// ============ 2. JS syntax ============
header('2. JS syntax');
const jsFiles = allFiles.filter((p) => p.endsWith('.js') && !p.includes('node_modules'));
for (const p of jsFiles) {
  try {
    execSync(`node --check "${p}"`, { stdio: 'pipe' });
    ok(rel(p));
  } catch (err) {
    fail(rel(p) + ' — ' + String(err.stderr || err).split('\n').slice(0, 3).join(' '));
    errors++;
  }
}

// ============ 3. JSON validity ============
header('3. JSON validity');
const jsonFiles = allFiles.filter((p) => p.endsWith('.json') && !p.includes('node_modules'));
for (const p of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(p, 'utf8'));
    ok(rel(p));
  } catch (err) {
    fail(rel(p) + ' — ' + err.message);
    errors++;
  }
}

// ============ 4. CSS brace balance ============
header('4. CSS brace balance');
const cssFiles = allFiles.filter((p) => p.endsWith('.css'));
for (const p of cssFiles) {
  const src = fs.readFileSync(p, 'utf8');
  const opens = (src.match(/\{/g) || []).length;
  const closes = (src.match(/\}/g) || []).length;
  if (opens === closes) ok(`${rel(p)} (${opens}/${closes})`);
  else { fail(`${rel(p)} unbalanced: ${opens} opens / ${closes} closes`); errors++; }
}

// ============ 5. Admin HTML ↔ JS cross-ref ============
header('5. Admin HTML ↔ admin.js ID cross-reference');
const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, 'admin.js'), 'utf8');
const htmlIds = new Set([...adminHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const jsRefs = new Set();
for (const m of adminJs.matchAll(/['"`]#([a-zA-Z][a-zA-Z0-9_-]*)['"`]/g)) jsRefs.add(m[1]);
for (const m of adminJs.matchAll(/getElementById\(['"]([a-zA-Z][a-zA-Z0-9_-]*)['"]\)/g)) jsRefs.add(m[1]);
// Strip dynamic concatenation noise like 'panel-'
const dynamicNoise = new Set(['panel-']);
const missingInHtml = [...jsRefs].filter((id) => !htmlIds.has(id) && !dynamicNoise.has(id));
if (missingInHtml.length === 0) ok(`all ${jsRefs.size} JS ID refs map to HTML (${htmlIds.size} IDs total)`);
else {
  for (const id of missingInHtml.sort()) { fail(`admin.js references "#${id}" but it's not in admin.html`); errors++; }
}

// ============ 6. Critical event listeners wired ============
header('6. Critical event listeners wired in init()');
const criticalListeners = [
  // Click delegators that fire row actions (Edit/Delete/etc.) — if missing, buttons are dead
  { pattern: /\$\(['"]#products-list-admin['"]\)\s*\.addEventListener\(\s*['"]click['"]/, name: '#products-list-admin click → handleProductsAction' },
  { pattern: /\$\(['"]#contact-list['"]\)\s*\.addEventListener\(\s*['"]click['"]/, name: '#contact-list click → handleContactAction' },
  { pattern: /\$\(['"]#invoices-list['"]\)\s*\.addEventListener\(\s*['"]click['"]/, name: '#invoices-list click → handleInvoicesAction' },
  // Form submits
  { pattern: /\$\(['"]#product-form['"]\)\s*\.addEventListener\(\s*['"]submit['"]/, name: '#product-form submit → handleProductFormSubmit' },
  { pattern: /\$\(['"]#new-invoice-form['"]\)\s*\.addEventListener\(\s*['"]submit['"]/, name: '#new-invoice-form submit → handleCreateInvoice' },
  { pattern: /\$\(['"]#invoice-edit-form['"]\)\s*\.addEventListener\(\s*['"]submit['"]/, name: '#invoice-edit-form submit → handleInvoiceEditSubmit' },
  { pattern: /\$\(['"]#admin-login-form['"]\)\s*\.addEventListener\(\s*['"]submit['"]/, name: '#admin-login-form submit → handleLogin' },
  // Wiring helpers
  { pattern: /wireProductModal\s*\(\s*\)/, name: 'wireProductModal() called' },
  { pattern: /wireProductToolbar\s*\(\s*\)/, name: 'wireProductToolbar() called' },
];
for (const { pattern, name } of criticalListeners) {
  if (pattern.test(adminJs)) ok(name);
  else { fail(name + ' is MISSING — buttons/forms tied to it will silently fail'); errors++; }
}

// ============ 7. Single source of truth for products ============
header('7. Single source of truth (Blobs) for product catalog');
// Every function that touches products should use makeStore('products'), not read products.json directly.
const productTouchingFns = [
  'get-products.js',
  'admin-products-list.js',
  'admin-products-save.js',
  'admin-products-delete.js',
  'create-payment-intent.js',
];
for (const f of productTouchingFns) {
  const p = path.join(ROOT, 'netlify/functions', f);
  if (!fs.existsSync(p)) { fail(`${f} missing`); errors++; continue; }
  const src = fs.readFileSync(p, 'utf8');
  if (!src.includes("makeStore('products')")) {
    fail(`${f} does not use makeStore('products') — may read a stale catalog`);
    errors++;
  } else ok(`${f} reads from Blobs`);
}

// ============ 8. No hardcoded secrets in code ============
header('8. No hardcoded secrets in code');
const secretPatterns = [
  { pattern: /sk_(test|live)_[A-Za-z0-9_]{20,}/, name: 'Stripe secret key' },
  { pattern: /pk_(test|live)_[A-Za-z0-9_]{20,}/, name: 'Stripe publishable key (should be env var)' },
  { pattern: /nfp_[A-Za-z0-9_]{20,}/, name: 'Netlify auth token' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, name: 'PEM private key' },
];
const codeFiles = allFiles.filter((p) => /\.(js|html|css|md)$/.test(p) && !p.includes('node_modules'));
let secretsFound = 0;
for (const p of codeFiles) {
  const src = fs.readFileSync(p, 'utf8');
  for (const { pattern, name } of secretPatterns) {
    if (pattern.test(src)) {
      fail(`Possible ${name} hardcoded in ${rel(p)}`);
      secretsFound++;
      errors++;
    }
  }
}
if (secretsFound === 0) ok('no hardcoded secrets detected');

// ============ 9. Admin endpoints require auth ============
header('9. Admin endpoints check auth');
// admin-login.js is the exception: it's the endpoint that ISSUES the token,
// so it can't itself require one. Everything else under admin-* must auth.
const authExempt = new Set(['admin-login.js']);
const adminFunctions = fs.readdirSync(path.join(ROOT, 'netlify/functions'))
  .filter((f) => f.startsWith('admin-') && f.endsWith('.js'));
for (const f of adminFunctions) {
  if (authExempt.has(f)) {
    ok(`${f} (token issuer — auth-exempt by design)`);
    continue;
  }
  const src = fs.readFileSync(path.join(ROOT, 'netlify/functions', f), 'utf8');
  if (!src.includes('requireAuth')) {
    fail(`${f} does not call requireAuth — public access!`);
    errors++;
  } else ok(f);
}

// ============ Summary ============
header('Summary');
if (errors === 0 && warnings === 0) {
  log('\n  \x1b[32m✓ All checks passed.\x1b[0m  Safe to git push.\n');
} else {
  log(`\n  \x1b[31m✗ ${errors} error(s)\x1b[0m, ${warnings} warning(s). DO NOT PUSH until fixed.\n`);
  process.exit(1);
}
