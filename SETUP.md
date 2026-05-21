# NVee Arts — Stripe + Netlify setup

This guide walks Veronica (or whoever is operating the site) through getting the
real checkout live. The site itself is a static HTML/JS/CSS bundle; the only
moving part is one tiny serverless function on Netlify that talks to Stripe.

End-to-end you'll do this once and then never again:

1. Make a Stripe account and grab the API keys.
2. Push this folder to GitHub.
3. Connect the GitHub repo to Netlify.
4. Paste the Stripe secret key into Netlify's environment variables.
5. Test a purchase with a Stripe test card.
6. Activate Stripe (give them tax info / bank account) when ready for real money.

Expect 30–45 minutes the first time.

---

## 1. Create a Stripe account

1. Go to https://dashboard.stripe.com/register
2. Sign up with the email you want orders to go to.
3. You'll land in **Test mode** by default — that's exactly what you want for
   the first run-through. Real money is *off* until Stripe is activated.

## 2. Grab the test keys

1. In the Stripe dashboard, top-right, make sure the **Test mode** toggle is on.
2. Go to **Developers → API keys** (https://dashboard.stripe.com/test/apikeys).
3. Copy the **Secret key** (starts with `sk_test_...`). Keep this private —
   never paste it into the website code or commit it to GitHub. It only goes
   into Netlify's environment variables (step 4).
4. The **Publishable key** (`pk_test_...`) is not needed for this site because
   we use Stripe-hosted Checkout (Stripe collects the card on their own page).

## 3. Push this folder to GitHub

If you don't already have a Git repo for this site:

```bash
cd "NVEE Arts"
git init
git add .
git commit -m "Initial commit with Stripe checkout"
```

Then on https://github.com/new create a new (private is fine) repository and
follow the "push an existing repository" instructions GitHub shows you.

## 4. Connect Netlify

1. Sign up / log in at https://app.netlify.com.
2. Click **Add new site → Import an existing project**.
3. Pick GitHub, authorize, and select your NVee Arts repo.
4. Build settings — Netlify reads `netlify.toml` automatically, so you can
   leave the defaults:
   - Build command: *(none)*
   - Publish directory: `.`
5. Click **Deploy site**. The first deploy takes a minute.

Once it's up you'll have a URL like `dreamy-tesla-12abcd.netlify.app`. You can
rename it under **Site configuration → Site details → Change site name**, or
attach a custom domain (e.g. `nveearts.com`) under **Domain management**.

## 5. Add the Stripe secret key to Netlify

This is the step that connects the site to your Stripe account.

1. In Netlify, open your site → **Site configuration → Environment variables**.
2. Click **Add a variable**.
3. Key: `STRIPE_SECRET_KEY`
4. Value: paste the `sk_test_...` key from step 2.
5. Save.
6. Go to **Deploys** → **Trigger deploy → Deploy site** to redeploy with the
   new env var.

## 6. Run a test purchase

1. Open your Netlify URL.
2. Add a piece to the cart.
3. Click **Checkout**. You should be redirected to a real Stripe Checkout page.
4. Use a Stripe test card:
   - Card: `4242 4242 4242 4242`
   - Expiration: any future date
   - CVC: any 3 digits
   - ZIP: any 5 digits
5. Submit. Stripe will redirect back to `/success.html` with a thank-you page.
6. Check your Stripe dashboard under **Payments** — you should see the test
   transaction.

If anything fails, open the browser DevTools console and the Netlify
**Functions → create-checkout-session → Logs** to see what happened. The most
common issue is forgetting the redeploy after adding the env var.

## 7. Going live (real money)

When you're ready to take real money:

1. In Stripe, click **Activate account** in the dashboard. Stripe will ask for:
   - Business info (sole proprietor is fine — use your legal name)
   - Tax ID / SSN (so they can issue you a 1099-K at year-end)
   - Bank account for payouts
   This usually takes 10–15 minutes and a few business days to approve.
2. Once activated, turn off **Test mode** in the Stripe dashboard.
3. Grab the **live** secret key from https://dashboard.stripe.com/apikeys
   (it'll start with `sk_live_...`).
4. In Netlify → Environment variables → replace `STRIPE_SECRET_KEY` with the
   live key. Redeploy.
5. Run one real purchase yourself with your own card to confirm everything
   works end-to-end (you can refund yourself afterward).

That's it — you're live.

---

## Day-to-day operations

### When a piece sells

Each piece is one-of-one, so once it sells, you need to remove it from the
catalog so nobody buys it again:

1. Open `data/products.json`.
2. Delete the entry for the sold piece (or set its `tag` to `"Sold"` and add
   a `"soldOut": true` flag — but the current code doesn't honor that flag yet;
   the simplest thing is to delete the entry).
3. Commit + push to GitHub. Netlify will auto-deploy in ~30 seconds.

### Adding a new piece

1. Drop the image into `images/` (jpg or png, ideally square-ish, under 500KB).
2. Add an entry to `data/products.json` following the same shape as the others.
   Required fields: `id`, `name`, `price`, `image`, `collection`, `meta`,
   `detail`, `description`, `specs`, `tag`, `tagClass`.
3. Commit + push.

### Adjusting shipping

The shipping rate is set in two places (they should match):

- Cart-drawer preview: `SHIPPING_RATE` in `app.js` (in dollars).
- Stripe Checkout actual charge: `SHIPPING_FLAT_CENTS` in
  `netlify/functions/create-checkout-session.js` (in cents).

If you ever need different shipping rates per item or region, the cleanest
upgrade is to switch to Stripe's
[built-in shipping rates](https://stripe.com/docs/payments/during-payment/charge-shipping).

### Refunds

Refunds happen entirely in the Stripe dashboard — find the payment, click
**Refund**, money goes back to the buyer's card. No code changes needed.

### Seeing orders

Stripe is your source of truth: **Payments** in the dashboard shows everything
including the shipping address Stripe collected from the buyer.

---

## Local development

If you want to test changes before pushing to Netlify:

```bash
npm install -g netlify-cli
cd "NVEE Arts"
netlify functions:invoke create-checkout-session --no-identity --payload '{"items":[{"id":"single-rose","quantity":1}]}'
# Or run the full local dev server (proxies functions + static site):
netlify dev
```

Create a `.env` file (copied from `.env.example`) with your test key for local
runs — `.env` is gitignored.

## File map

```
NVEE Arts/
├── index.html                # main page
├── app.js                    # frontend logic + cart + Stripe redirect
├── style.css                 # styles
├── success.html              # post-payment thank-you page
├── data/
│   └── products.json         # product catalog (single source of truth)
├── netlify/
│   └── functions/
│       ├── create-checkout-session.js  # Stripe Checkout session creator
│       └── package.json                # function dependencies
├── images/                   # product photos + logos
├── netlify.toml              # Netlify deploy config
├── .env.example              # template for local .env
├── .gitignore
└── SETUP.md                  # this file
```
