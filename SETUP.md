# ESRF.net — Cloudflare Pages Setup Guide

This guide explains how to configure the backend services required for the listing request form (`/request-listing.html`), the sponsor inquiry form (`/sponsor.html`), and the Cloudflare Pages Functions that handle them.

All checks degrade gracefully: without the bindings below, forms still work — they just skip the relevant checks. This makes local development easy.

---

## 1. Cloudflare Turnstile (bot protection)

Turnstile is a privacy-friendly CAPTCHA alternative by Cloudflare. It is required in production to prevent automated spam submissions.

### Steps

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Turnstile** (in the left sidebar).
2. Click **Add site**.
3. Enter your hostname (e.g. `esrf.net`), choose **Managed** widget type.
4. Copy the **Site Key** and **Secret Key** that are generated.

### Configure the site key (frontend)

In `request-listing.html` and `sponsor.html`, replace the placeholder sitekey:

```html
<!-- Before -->
<div class="cf-turnstile" data-sitekey="0x4AAAAAAAWILL_BE_REPLACED"></div>

<!-- After -->
<div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY_HERE"></div>
```

### Configure the secret key (backend)

In your Cloudflare Pages project:

1. Go to **Pages** → your project → **Settings** → **Environment variables**.
2. Add a new variable:
   - **Name:** `TURNSTILE_SECRET_KEY`
   - **Value:** your secret key
   - Set for both **Production** and **Preview** environments.

---

## 2. KV Namespaces (submission storage + rate limiting)

Two KV namespaces are used:

| Binding name         | Purpose                                      |
|----------------------|----------------------------------------------|
| `LISTING_SUBMISSIONS`| Stores all form submissions as JSON          |
| `RATE_LIMIT_KV`      | Tracks per-IP submission count (1 hour TTL)  |

### Create the KV namespaces

In Cloudflare Dashboard → **Workers & Pages** → **KV**:

1. Click **Create a namespace** → name it `esrfnet-submissions` → **Add**.
2. Click **Create a namespace** → name it `esrfnet-ratelimit` → **Add**.

### Bind the namespaces to your Pages project

1. Go to **Pages** → your project → **Settings** → **Functions**.
2. Scroll to **KV namespace bindings**.
3. Add binding:
   - Variable name: `LISTING_SUBMISSIONS` → namespace: `esrfnet-submissions`
4. Add binding:
   - Variable name: `RATE_LIMIT_KV` → namespace: `esrfnet-ratelimit`
5. Repeat for both **Production** and **Preview**.

### Reading submissions

To read stored submissions, use Wrangler CLI:

```bash
npx wrangler kv:key list --namespace-id=<YOUR_NAMESPACE_ID>
npx wrangler kv:key get --namespace-id=<YOUR_NAMESPACE_ID> "sub:1234567890:abc123"
```

Or browse them in the Cloudflare Dashboard under **Workers & Pages** → **KV** → `esrfnet-submissions`.

---

## 3. Resend (email notifications)

When a form is submitted, ESRF.net sends a notification email to `hello@esrf.net`. This uses [Resend](https://resend.com) — a developer-friendly transactional email API.

### Steps

1. Sign up at [resend.com](https://resend.com) and verify your sending domain (`esrf.net`).
2. Go to **API Keys** → **Create API Key**.
3. Copy the key.

### Configure

In Cloudflare Pages → **Settings** → **Environment variables**:

- **Name:** `RESEND_API_KEY`
- **Value:** your Resend API key

The `from` address is `ESRF.net <noreply@esrf.net>` — make sure this domain is verified in Resend.

---

## 4. Local development

For local development with Wrangler:

```bash
npx wrangler pages dev . --kv LISTING_SUBMISSIONS --kv RATE_LIMIT_KV
```

Without the env vars (`TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`), the functions skip those checks automatically — no errors, no blocked submissions.

To add env vars locally, create a `.dev.vars` file in the project root (already gitignored):

```
TURNSTILE_SECRET_KEY=your_secret_key_here
RESEND_API_KEY=re_xxxx_xxxxxxxx
```

---

## 5. Summary of required env vars

| Variable              | Required for        | Where to get it                      |
|-----------------------|---------------------|--------------------------------------|
| `TURNSTILE_SECRET_KEY`| Bot protection      | Cloudflare Turnstile dashboard       |
| `RESEND_API_KEY`      | Email notifications | resend.com API keys                  |

KV bindings (`LISTING_SUBMISSIONS`, `RATE_LIMIT_KV`) are configured as namespace bindings in Pages settings, not as environment variables.

---

## 6. Without any configuration

The forms still work without any of the above:

- Turnstile widget renders but verification is skipped server-side
- Submissions are not stored (no KV)
- No notification emails are sent (no Resend)
- Honeypot and timer checks still run client- and server-side
- GDPR consent is still validated

This means the forms are safe to deploy immediately and can be enhanced incrementally.
