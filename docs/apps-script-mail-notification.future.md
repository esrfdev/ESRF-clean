# Deferred ESRF mailnotificatie route — separate Apps Script deployment

> **Status (2026-04-26, end of day):** **DISABLED — DELIVERY UNCONFIRMED.**
> The Google Apps Script `MailApp` mailrelay route was tested on
> 2026-04-26 against `office@esrf.net` but **delivery was not
> confirmed** (no message landed in the `office@esrf.net` inbox during
> the test window). As a direct consequence, the Cloudflare Pages
> Preview env vars `INTAKE_NOTIFY_WEBHOOK` and `INTAKE_NOTIFY_TO` were
> **removed / disabled** under rollback event
> `evt_unconfirmed_google_mailrelay_disabled_20260426_1401` (see §"Rollback
> event" below). This route is therefore **not a production route** and
> must not be re-enabled in its current Google Apps Script `MailApp`
> form.
>
> Sheet intake via the spreadsheet-only Apps Script
> ([`apps-script-intake-webhook.gs`](./apps-script-intake-webhook.gs))
> remains **active** and is unaffected by this rollback — LAB_* rows
> continue to append normally.
>
> **Recommended next notification route (not yet enabled):** an
> **official Microsoft 365 / Outlook / SMTP relay** for
> `office@esrf.net`, owned by the same Workspace identity that owns the
> mailbox. This SMTP relay is to be enabled **only after a delivered
> test email is confirmed** (operator manually verifies a test message
> arrives at `office@esrf.net`). Until then `INTAKE_NOTIFY_WEBHOOK` and
> `INTAKE_NOTIFY_TO` stay unset on every Cloudflare Pages environment
> and the backend keeps reporting
> `notification_status: "dry_run_not_configured"`.
>
> **Earlier status (2026-04-26, morning) — superseded:** the source for
> this route was checked into
> [`apps-script-mail-notification.gs`](./apps-script-mail-notification.gs)
> with manifest
> [`appsscript.mail-notification.json`](./appsscript.mail-notification.json)
> as PREPARED, NOT ACTIVATED. After the unconfirmed-delivery test on the
> same day, that prepared source is retained **only as a reference
> artefact**; it is no longer the recommended activation path.
>
> ⚠️ This route requires an **additional OAuth scope**
> (`https://www.googleapis.com/auth/script.send_mail`) which the
> first-phase spreadsheet-only webhook does **not** request. It must
> therefore live in a **separate Apps Script project / deployment**
> from the first-phase webhook so that the spreadsheet-only consent
> screen never surfaces mail scopes.

## Why a separate deployment

During an OAuth flow under `office@esrf.net`, the consent screen for
the first-phase intake webhook surfaced the additional scope
`https://www.googleapis.com/auth/script.send_mail` because the
script source contained `MailApp.sendEmail` calls. The authorization
was correctly stopped.

To unblock the first lab-write activation we made the following
security decision:

1. The **first** lab-write Apps Script (the one that backs
   `INTAKE_SHEET_WEBHOOK_URL`) is **spreadsheet-only**. It contains
   no `MailApp` / `GmailApp` / `script.send_mail` references and
   therefore requests only
   `https://www.googleapis.com/auth/spreadsheets`.
2. The **mail notification** is split out into a **separate, later
   Apps Script project** documented in this file. That project has
   its own `appsscript.json`, its own OAuth consent (with the
   `script.send_mail` scope), and its own deployment URL. It is
   **not** part of the first lab-write activation.

This split makes the OAuth consent screens unambiguous: an operator
who is authorising the first-phase webhook can refuse anything that
is not `auth/spreadsheets`, and an operator who later authorises the
deferred mail route can knowingly approve `script.send_mail`.

## Pre-conditions before this route is implemented

- [ ] First-phase spreadsheet-only Apps Script deployed under
      `office@esrf.net` and verified end-to-end against the
      Cloudflare lab preview (LAB_* rows appended; no MailApp scope
      in OAuth consent).
- [ ] Redactie has signed off on the dry-run notification copy in
      [`intake-lab-test-report-2026-04-25.md`](./intake-lab-test-report-2026-04-25.md)
      §6b.
- [ ] Operator decides whether the deferred route lives in:
      (a) a second container-bound Apps Script project under
          `office@esrf.net`, called from the first-phase webhook via
          a second internal HTTPS call after a successful sheet
          write, OR
      (b) an external mailrelay/webhook (Pipedream, n8n, internal
          SMTP relay) hit directly by the Cloudflare Pages Function
          via `INTAKE_NOTIFY_WEBHOOK`.

Until those gates pass, the first-phase webhook reports
`mail_notification_status: "pending_separate_deployment"` on every
successful sheet write, and the Cloudflare backend reports
`notification_status: "dry_run_not_configured"` (or, more precisely,
`pending_separate_deployment` once `INTAKE_NOTIFY_WEBHOOK` is
explicitly left unset and the first-phase webhook is reachable).

## Prepared source — separate Apps Script project (when activated)

The full source is checked in at
[`apps-script-mail-notification.gs`](./apps-script-mail-notification.gs)
and the manifest at
[`appsscript.mail-notification.json`](./appsscript.mail-notification.json).
Both files are clearly labelled `PREPARED, NOT ACTIVATED`. They MUST be
pasted into a **new** Apps Script project under `office@esrf.net` —
**never** merged into the first-phase spreadsheet-only project (whose
manifest is `docs/appsscript.json` and only requests
`auth/spreadsheets`).

The prepared source enforces, server-side:

1. **Shared-secret verification** against the Script Property
   `NOTIFY_SHARED_SECRET` (must match Cloudflare's
   `INTAKE_NOTIFY_SECRET`, or the legacy `SHEETS_WEBHOOK_SECRET` when
   the dedicated secret is unset).
2. **Allow-list** (`ALLOWED_FIELDS`) — mirrors
   `NOTIFICATION_CONTRACT.allowed_keys` in `functions/api/intake.js`;
   any field outside the list is silently dropped before send.
3. **Forbidden-field rejection** (`FORBIDDEN_FIELDS`) — any presence
   of submitter PII, editorial body, raw payload echo, or operational
   secrets returns 4xx and does NOT send mail.
4. **Recipient deny-list** (`FORBIDDEN_RECIPIENTS`) — explicitly
   blocks `ai.agent.wm@gmail.com` even if `NOTIFY_TO` is misconfigured.
5. **Recipient match check** — if the wire payload contains
   `notify_to_recipient`, it must equal `NOTIFY_TO` exactly; mismatch
   returns 4xx.
6. **Single `MailApp.sendEmail()` call** — plain text only, no HTML,
   no attachments, no inline images, capped subject length.

The manifest declares `auth/script.send_mail` as the **only** OAuth
scope, so the consent screen surfaces exactly that scope and nothing
else. The first-phase spreadsheet-only `appsscript.json` (in
[`docs/appsscript.json`](./appsscript.json)) deliberately does NOT
include `script.send_mail`.

## Activation sequence (future, gated)

1. Confirm first-phase spreadsheet-only deployment is healthy
   (rows appearing in LAB_* tabs, no MailApp scope on consent).
2. Create a **new** Apps Script project, owned by
   `office@esrf.net`. Paste the future `appsscript.json` (above)
   and the future mail-notification source.
3. Authorize. The consent screen MUST surface
   `https://www.googleapis.com/auth/script.send_mail` and nothing
   else. If anything else appears, STOP.
4. Deploy as a Web app. Take the `/exec` URL.
5. Set Cloudflare Pages env var `INTAKE_NOTIFY_WEBHOOK` to that
   URL, and `INTAKE_NOTIFY_TO=office@esrf.net`. Leave
   `INTAKE_SHEET_WEBHOOK_URL` pointed at the first-phase webhook.
6. Re-run the dry-run end-to-end test from
   `intake-lab-test-report-2026-04-25.md`.

Until step 1 is verified, this route stays a paper trail.

## Activation gate vs. the minimal-notification design

The wire-level contract for what this future route may emit is locked
in [`intake-minimal-notification-design.md`](./intake-minimal-notification-design.md).
That document is the SSoT for:

- the exact `allowed_keys` / `forbidden_keys` of the notification
  payload (mirrored verbatim by `NOTIFICATION_CONTRACT` in
  `functions/api/intake.js`),
- the `MINIMAL_NOTIFICATION_DESIGN_STATUS` flag (currently
  `minimal-notification-design-ready-not-enabled`),
- the manual activation checklist that must be ticked off **before**
  this route can be deployed.

The activation checklist below is the same one surfaced in the API
response under `notification_contract.activation_checklist` and in the
LAB UI on `submit-validation.html`. It is reproduced here so an
operator working from the future-mail doc has the full picture in one
place.

### Real-mail-test activation checklist (manual; separate approval required)

Each item must be approved and ticked off in order by an operator with
`office@esrf.net` access. **Do NOT skip steps.** Skipping step 6 in
particular would be a sev-2 finding in any subsequent security review.

- [ ] **1. First-phase spreadsheet-only deployment is healthy.** LAB_*
      rows append correctly via the existing Cloudflare Pages preview;
      OAuth consent for the first-phase Apps Script shows ONLY
      `auth/spreadsheets`. Reference: §6 of
      [`intake-lab-test-report-2026-04-25.md`](./intake-lab-test-report-2026-04-25.md).
- [ ] **2. Redactie sign-off** on the dry-run notification copy in
      `intake-lab-test-report-2026-04-25.md` §6b. Sign-off must be
      explicit (commit or PR comment) — silent acceptance does not
      count.
- [ ] **3. Separate Apps Script project created** under
      `office@esrf.net`. Paste the prepared source from
      [`apps-script-mail-notification.gs`](./apps-script-mail-notification.gs)
      and the manifest from
      [`appsscript.mail-notification.json`](./appsscript.mail-notification.json)
      into a NEW project — do NOT add the source to the spreadsheet-only
      project. Manifest declares `auth/script.send_mail` and nothing
      else (no `auth/spreadsheets`, no broader Gmail scope). Source
      contains exactly one `MailApp.sendEmail()` call gated on
      shared-secret verification (the test
      `mail-relay source is the ONLY place that calls MailApp.sendEmail`
      in `functions/api/intake.test.mjs` enforces this).
- [ ] **4. OAuth consent for the new project** surfaces ONLY
      `https://www.googleapis.com/auth/script.send_mail`. If anything
      else appears, STOP — the manifest is wrong.
- [ ] **5. Deploy the separate project as a Web app**, take the
      `/exec` URL, and store it as `INTAKE_NOTIFY_WEBHOOK` on the
      Cloudflare Pages **preview** project only. Production project
      env vars are untouched in this branch.
- [ ] **6. Set `INTAKE_NOTIFY_TO=office@esrf.net`** on the same
      Cloudflare Pages preview project. NEVER set this to
      `ai.agent.wm@gmail.com` or to any submitter address. The
      notification builder rejects anything that does not pass
      `sanitizeNotifyRecipient`, but the env var is the human-facing
      gate.
- [ ] **7. Send one real `/api/intake` submission** from the LAB form.
      Confirm:
        - `notification_status: "sent"` in the API response,
        - the email arrives at `office@esrf.net`,
        - the email body contains ONLY the keys in
          `notification_contract.allowed_keys`,
        - the email body contains NONE of the keys in
          `notification_contract.forbidden_keys` (no submitter email,
          no submitter phone, no editorial summary / regional_angle /
          lesson, no `raw_payload_json`, no shared secret),
        - the recipient is `office@esrf.net` only — verify message
          headers.
- [ ] **8. Document the activation** in a new
      `docs/intake-lab-test-report-YYYY-MM-DD.md`. Include the email
      message id, the `submission_id`, and a redacted copy of the
      message body proving the contract.
- [ ] **9. Flip the design flag** in code. In
      `functions/api/intake.js`, change
      `MINIMAL_NOTIFICATION_DESIGN_STATUS` from
      `'minimal-notification-design-ready-not-enabled'` to
      `'minimal-notification-enabled'`. Update
      [`intake-minimal-notification-design.md`](./intake-minimal-notification-design.md)
      "Status" header to match. Commit the flip together with the
      activation report from step 8.

Until step 9 is committed, the contract is "design ready, not
enabled". `notification_status` continues to report
`dry_run_not_configured` and the LAB UI continues to show
`design-vlag: minimal-notification-design-ready-not-enabled`.

## Rollback procedure (post-activation)

If a real-mail issue surfaces after activation — wrong recipient,
unexpected leakage in the body, redactie wants to pause — rollback is
a single Cloudflare Pages env-var edit on the **preview** project:

1. **Disable the dispatch**: unset
   `INTAKE_NOTIFY_WEBHOOK` on Cloudflare Pages (preview project only).
   The Cloudflare backend immediately falls back to
   `notification_status: "dry_run_not_configured"` on every request
   and stops calling the relay. The first-phase spreadsheet write is
   unaffected and keeps logging into the LAB_* tabs.
2. **Belt-and-braces**: in the separate Apps Script project hosting
   [`apps-script-mail-notification.gs`](./apps-script-mail-notification.gs),
   delete the active deployment so the `/exec` URL returns 404 even
   if a stale `INTAKE_NOTIFY_WEBHOOK` is still configured somewhere
   we forgot.
3. **Flip the design flag back**: in `functions/api/intake.js`,
   restore `MINIMAL_NOTIFICATION_DESIGN_STATUS` to
   `'minimal-notification-design-ready-not-enabled'` and revert the
   "Status" header in
   [`intake-minimal-notification-design.md`](./intake-minimal-notification-design.md).
   Commit the revert together with a short post-mortem in
   `docs/intake-lab-test-report-YYYY-MM-DD.md`.

Production env vars (and Directory_Master) are never touched at any
point in this rollback.

## Rollback event 2026-04-26 — Google Apps Script MailApp route disabled

| Field | Value |
|---|---|
| Rollback event id | `evt_unconfirmed_google_mailrelay_disabled_20260426_1401` |
| Date / time | 2026-04-26, 14:01 local |
| Test submission id (operator probe) | `sub_moftdrju_f8lk` |
| Route under test | Google Apps Script `MailApp.sendEmail` deployment, hit via Cloudflare Pages Preview `INTAKE_NOTIFY_WEBHOOK` |
| Intended recipient | `office@esrf.net` (`INTAKE_NOTIFY_TO`) |
| Observed delivery to `office@esrf.net` | **NOT CONFIRMED** — no inbound message visible in the `office@esrf.net` mailbox during the verification window. |
| Cloudflare backend response | `notification_status` reported as dispatched to the relay; the relay's own logs were not sufficient to prove inbox arrival. |
| Action taken | Cloudflare Pages **Preview** env vars `INTAKE_NOTIFY_WEBHOOK` and `INTAKE_NOTIFY_TO` were **removed / disabled**. The Apps Script project for the mail-relay was not deleted, but it is treated as inert: no Cloudflare env var points at it, and operators MUST NOT re-attach it without first switching to the Microsoft 365 / SMTP route below. |
| Sheet intake impact | None. Sheet intake via the spreadsheet-only Apps Script remains active; LAB_* rows continue to append on every successful submission. `Directory_Master` not touched. |
| Production impact | None. Production Cloudflare Pages env vars were never set for this route on this branch and are not touched by the rollback. |

After this rollback the Cloudflare backend response reverts to
`notification_status: "dry_run_not_configured"` on every `/api/intake`
call, matching the documented default-safe behaviour.

## Recommended next notification route — Microsoft 365 / Outlook / SMTP relay

The Google Apps Script `MailApp` route is **not** the route ESRF will
ship to production. The recommended next route is an **official
Microsoft 365 / Outlook / SMTP relay** for `office@esrf.net`:

- Authentication: a Microsoft 365 / Exchange Online connector or
  authenticated SMTP submission scoped to the `office@esrf.net`
  mailbox identity (the same identity that owns the inbox).
- Delivery: the relay accepts the same minimal, PII-free notification
  payload defined by `NOTIFICATION_CONTRACT` in
  `functions/api/intake.js` (allowed_keys only; forbidden_keys
  rejected) and sends a single plain-text email to `office@esrf.net`.
- Scope: the relay is the **only** thing that holds mail credentials.
  The Cloudflare Pages Function never holds an SMTP credential, never
  links against a mail SDK, and never opens an SMTP connection (this
  invariant is unchanged from the rest of this document).
- Activation precondition: an operator MUST first send a manual test
  message through the candidate relay and **visually confirm** it
  arrives at `office@esrf.net`. Only after that delivered-test
  confirmation may `INTAKE_NOTIFY_WEBHOOK` (pointing at the relay) and
  `INTAKE_NOTIFY_TO=office@esrf.net` be set on the Cloudflare Pages
  Preview project. Production env vars stay untouched until a second
  delivered-test confirmation under production identity.
- Until those two delivered-test confirmations exist, this document is
  the SSoT that the notification route is **disabled / delivery-
  unconfirmed**.

Operators MUST NOT re-enable the Google Apps Script `MailApp` route as
a stop-gap while waiting for the SMTP relay. The documented next route
is SMTP via Microsoft 365 / Outlook, not a re-attempt of the route
that failed delivery on 2026-04-26.
