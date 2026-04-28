# Editorial Access — Cloudflare Access + MFA

This document describes the **production security model** for the internal
ESRF.net editorial area:

- `/redactie/` (portal) and `/redactie/index.html`
- `/redactie-validation.html` (validation form)
- `/api/lab-intake` (server endpoint that writes to the LAB sheets)

These surfaces are **not** for public visitors. They are protected by
**Cloudflare Access** with an **MFA-enforcing identity provider** as the
primary control, and by **server-side defence-in-depth** in this repo.

---

## 1. Threat model — short version

The editorial routes accept input that triggers writes to a Google Sheet
(`LAB_*` tabs). Even though `Directory_Master` is never touched
automatically, an attacker who reaches these routes can:

- pollute the candidate queue with fake organisations;
- exhaust the webhook quota;
- read sensitive context-of-work that is in the page copy.

`noindex` headers and a hidden URL are **not** sufficient — anyone who
guesses the URL can submit. Therefore the routes must be gated at the
edge **before** the request is allowed to hit the application.

---

## 2. Primary control — Cloudflare Access

Configure these in the Cloudflare dashboard (Zero Trust → Access →
Applications). All three protected paths can live under **one Access
application** if you list multiple paths, or you can split them.

### 2.1 Application

- **Type:** Self-hosted
- **Application name:** `ESRF Editorial`
- **Session duration:** 8 hours (max — matches the in-app cookie TTL)
- **Domain rules** (add all three paths):
  - `esrf.net/redactie/*`
  - `esrf.net/redactie-validation.html`
  - `esrf.net/redactie-validation.html*` (covers query strings)
  - `esrf.net/api/lab-intake`
- **Identity providers:** the org's MFA-enforcing IdP (e.g. Google
  Workspace, Microsoft Entra ID, Okta) — **MFA must be required** in
  the IdP itself or in the Access policy below.

### 2.2 Policy

Create exactly one policy on the application:

- **Policy name:** `Allow office@esrf.net`
- **Action:** `Allow`
- **Configure rules → Include → Emails:** `office@esrf.net`
- **Require → Authentication method:**
  - select `mfa` (multi-factor) — Cloudflare Access then refuses any
    session that did not pass MFA at the IdP.
  - or pick a more specific method such as `swk` (security key) /
    `otp` if your IdP supports it.

To rotate the editor without redeploying code: edit the Include list in
this policy. The repo's allowlist defaults to `office@esrf.net`, but it
can be overridden via the `EDITORIAL_ALLOWED_EMAILS` env var (see §4).

### 2.3 Access JWT audience (recommended)

Copy the **Application Audience (AUD) tag** from the Access app
overview. Set it as a Pages env var:

    EDITORIAL_ACCESS_AUD = <aud-tag-from-cloudflare>

When this env var is set the repo's defence-in-depth check verifies
that incoming JWTs carry the matching `aud` claim. If you skip this
step, the structural check still runs but the audience binding does
not.

---

## 3. Defence-in-depth — what the repo enforces

Even with Cloudflare Access in front of the deploy, the repo enforces
these checks **inside** the Pages Function — so a misconfigured Access
policy cannot silently open the area:

1. `functions/_editorial_auth.js`
   - Reads the `Cf-Access-Jwt-Assertion` header.
   - Performs a structural JWT check (3 segments, decodable, non-expired
     `exp`, optional `aud` match).
   - Reads the `Cf-Access-Authenticated-User-Email` header set by the
     Access edge.
   - Rejects the request unless the email appears in
     `EDITORIAL_ALLOWED_EMAILS` (default: `office@esrf.net`,
     case-insensitive).
2. `functions/redactie/_middleware.js` — gates every
   `/redactie/*` request through that helper.
3. `functions/redactie-validation.js` — gates `/redactie-validation.html`
   through that helper before calling `env.ASSETS.fetch`.
4. `functions/api/lab-intake.js` — calls the helper as the very first
   step of `onRequestPost`, **before** body parse / sheet write.

The shared-secret token + signed cookie path is preserved as a
**emergency fallback** for preview deploys where Cloudflare Access
cannot be put in front. It is *not* the recommended production path.

---

## 4. Required Cloudflare Pages environment variables

Set these in **Pages → ESRF-clean → Settings → Environment variables**
(Production scope):

| Variable | Required? | Purpose |
| --- | --- | --- |
| `EDITORIAL_ALLOWED_EMAILS` | **Recommended** | Comma-separated allowlist for the Cloudflare Access email check. Default if missing: `office@esrf.net`. |
| `EDITORIAL_ACCESS_AUD` | Recommended | AUD tag of the Access application. When set, JWTs without a matching `aud` are rejected by the in-app check. |
| `LAB_INTAKE_SHEET_WEBHOOK_URL` | **Required** for prod use | Apps Script endpoint URL that owns the `LAB_*` sheet writes. |
| `LAB_INTAKE_SHEET_WEBHOOK_SECRET` | **Required** for prod use | Shared secret sent as `x-esrf-intake-secret` to the Apps Script. Also accepted as a server-to-server credential by `/api/lab-intake`. |
| `EDITORIAL_ACCESS_TOKEN` | Optional | Emergency-fallback editorial token for `/redactie/login`. Leave unset in production once Cloudflare Access is live. |
| `EDITORIAL_ACCESS_SECRET` | Optional | HMAC key for the fallback session cookie. Only used if `EDITORIAL_ACCESS_TOKEN` is set. |

Environment variables that contain secrets (`*_SECRET`,
`*_ACCESS_TOKEN`) MUST be marked as **Encrypted** in the Pages UI.

`EDITORIAL_ALLOWED_EMAILS` is a public identifier list (it documents who
the area is intended for) — it can be stored as a regular variable.

---

## 5. Operational checklist (one-time, before the area goes live)

- [ ] Cloudflare Access application `ESRF Editorial` created with the
      three domain rules in §2.1.
- [ ] Policy `Allow office@esrf.net` set, with **Action = Allow** and
      **Require = MFA**.
- [ ] Identity provider attached and verified (test login lands the
      coordinator at `/redactie/`).
- [ ] `EDITORIAL_ACCESS_AUD` populated in Pages env vars.
- [ ] `EDITORIAL_ALLOWED_EMAILS=office@esrf.net` populated in Pages env
      vars (or left unset to use the default).
- [ ] `LAB_INTAKE_SHEET_WEBHOOK_URL` and
      `LAB_INTAKE_SHEET_WEBHOOK_SECRET` populated.
- [ ] Apps Script flow `lab_editorial` deployed on the LAB sheet and
      writes only to `LAB_*` tabs.
- [ ] `robots.txt` and `sitemap.xml` confirmed clean (no editorial
      paths leaked) — already enforced by the test suite.
- [ ] Verified that an unauthenticated `curl https://esrf.net/redactie/`
      receives a Cloudflare Access redirect / login challenge (NOT the
      editorial portal HTML).
- [ ] Verified that an unauthenticated `curl -X POST .../api/lab-intake`
      returns 401 with `{"ok":false,"error":"unauthorized"}`.
- [ ] Verified that a logged-in but non-allowlisted Cloudflare account
      receives 401/302 from the in-app email check.

---

## 6. Rotation / incident response

- **Rotate the editor:** add the new address to the Cloudflare Access
  policy *and* update `EDITORIAL_ALLOWED_EMAILS`. The repo allowlist
  enforces both.
- **Suspect compromise:** revoke the user in the IdP, then in the
  Cloudflare Access policy. Optionally rotate
  `LAB_INTAKE_SHEET_WEBHOOK_SECRET` to invalidate any cached
  server-to-server credentials.
- **Lost MFA device:** recover via the IdP. The repo cannot bypass
  Cloudflare Access; recovery happens in the identity provider.

---

## 7. Related files

- `functions/_editorial_auth.js` — shared auth helpers + email allowlist.
- `functions/redactie/_middleware.js` — gates `/redactie/*`.
- `functions/redactie/login.js` — emergency fallback token form.
- `functions/redactie-validation.js` — gates `/redactie-validation.html`.
- `functions/api/lab-intake.js` — gates `POST /api/lab-intake`.
- `_headers` — secondary `noindex` and security headers.
- `robots.txt` / `sitemap.xml` — confirm editorial paths are excluded.
- `docs/EDITORIAL-WORKFLOW.md` — end-to-end workflow / governance doc.
