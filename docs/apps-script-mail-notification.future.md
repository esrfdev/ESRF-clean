# Deferred ESRF mailnotificatie route — separate Apps Script deployment

> **Status (2026-04-26, end of day):** **DISABLED — DELIVERY UNCONFIRMED
> (Google Apps Script `MailApp`); BROAD-SCOPE CONSENT REJECTED (Outlook
> connector).** Automatic notifications remain disabled.
>
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
> Later the same day (2026-04-26, 14:21), an attempt to authorize an
> **Outlook / Microsoft 365 connector** for `office@esrf.net` was
> **rejected by the operator** because the consent screen demanded
> **broad / full mailbox access** rather than a send-only scope. This
> rejection is recorded as event
> `evt_outlook_broad_scope_rejected_20260426_1421`. **No connector was
> authorized; no env vars were set; no test emails were sent.**
> Refusing broad mailbox consent is the correct security decision: the
> notification channel only needs `Mail.Send`, and granting full-
> mailbox access would expand the relay's blast radius to the entire
> `office@esrf.net` mailbox.
>
> Sheet intake via the spreadsheet-only Apps Script
> ([`apps-script-intake-webhook.gs`](./apps-script-intake-webhook.gs))
> remains **active** and is unaffected by either rollback — LAB_* rows
> continue to append normally.
>
> **Recommended next notification routes (minimal-rights only; none
> currently enabled):**
>
> 1. **Microsoft Graph app registration with send-only `Mail.Send`**
>    as `office@esrf.net`, narrowed via Exchange Online
>    `New-ApplicationAccessPolicy` to that one mailbox. Only viable if
>    the tenant admin can grant `Mail.Send` *without* `Mail.Read` /
>    `Mail.ReadWrite` / `full_access_as_app`. If the only available
>    consent path is broad mailbox access (as on 2026-04-26), this
>    route stays rejected.
> 2. **Authenticated SMTP submission / mailrelay** for
>    `office@esrf.net` with **SPF, DKIM, and DMARC alignment**
>    verified end-to-end before any Cloudflare Pages env var is set.
> 3. **Manual Sheet-based notification fallback** — the redactie
>    monitors the LAB_* tabs directly in the Drive spreadsheet. This
>    is the default-safe state and is in effect today.
>
> Each route must pass a **manually-delivered test message** to
> `office@esrf.net` *and* a confirmed minimal-rights consent scope
> before `INTAKE_NOTIFY_WEBHOOK` / `INTAKE_NOTIFY_TO` are set on any
> Cloudflare Pages environment. Until then they stay unset and the
> backend keeps reporting `notification_status: "dry_run_not_configured"`.
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

## Decision event 2026-04-26, 14:21 — Outlook connector rejected on broad scope

| Field | Value |
|---|---|
| Decision event id | `evt_outlook_broad_scope_rejected_20260426_1421` |
| Date / time | 2026-04-26, 14:21 local |
| Route under review | Outlook / Microsoft 365 connector for `office@esrf.net` |
| Trigger | Operator opened the Microsoft consent flow for the connector. |
| Consent screen requested | **Broad / full mailbox access** (read mail / mailbox-wide permissions), not a minimal send-only scope. |
| Operator action | **Authorization rejected** at the consent screen. No tokens were issued. No connector was authorized. No client secret was stored anywhere — not in this repo, not in `wrangler.toml`, not in Cloudflare Pages env vars. |
| Security rationale | The operational notification channel only needs to **send** a single minimal, PII-free ping (the wire-level contract is in [`intake-minimal-notification-design.md`](./intake-minimal-notification-design.md)). Granting broad / full mailbox access would let a relay compromise *read* the entire `office@esrf.net` mailbox — submitter correspondence, foundation mail, password-reset mails — none of which the relay needs. Refusing the broad consent keeps the blast radius bounded to "send one minimal mail" if the relay is ever compromised. **Refusing was the correct call.** |
| Cloudflare Pages env vars | `INTAKE_NOTIFY_WEBHOOK` and `INTAKE_NOTIFY_TO` remain **disabled / unset** on every environment (already unset after `evt_unconfirmed_google_mailrelay_disabled_20260426_1401`). No new env var was created. |
| Production impact | None. Production env vars were not touched. |
| Sheet intake impact | None. LAB_* rows continue to append. `Directory_Master` not touched. |
| Test emails sent | **None.** |
| Status flag | `MINIMAL_NOTIFICATION_DESIGN_STATUS = 'minimal-notification-design-ready-not-enabled'` (unchanged). Automatic notifications remain disabled. |

After this rejection, the Cloudflare backend response continues to
report `notification_status: "dry_run_not_configured"` on every
`/api/intake` call.

## Recommended next notification routes (minimal-rights only)

The Google Apps Script `MailApp` route is **not** the route ESRF will
ship to production. The Outlook connector with broad / full mailbox
consent is **also not** the route ESRF will ship — that consent shape
was explicitly rejected on 2026-04-26. The next route MUST be one of
the following minimal-rights options:

### Option A — Microsoft Graph app registration with send-only `Mail.Send`

- Tenant admin registers an Azure AD application owned by the
  `office@esrf.net` tenant.
- Application permission: **`Mail.Send` only.** No `Mail.Read`, no
  `Mail.ReadWrite`, no `Mail.ReadWrite.Shared`, no
  `full_access_as_app`. If admin consent for `Mail.Send` cannot be
  granted in isolation, **this route is rejected** and the operator
  falls back to Option B or Option C.
- Mailbox scope narrowed via Exchange Online RBAC:
  `New-ApplicationAccessPolicy -AccessRight RestrictAccess -AppId
  <app-id> -PolicyScopeGroupId office@esrf.net`. The app can only
  send **as `office@esrf.net`** and cannot touch any other mailbox.
- Cloudflare Pages does **not** hold the client secret. The relay
  (running outside Cloudflare) holds the secret and acquires Graph
  tokens on its own; Cloudflare only POSTs the minimal JSON payload
  to the relay's `/exec` URL.
- Activation precondition: the relay operator MUST send a manual
  Graph `sendMail` call and **visually confirm** the test message
  arrives at `office@esrf.net` *before* any Cloudflare Pages env var
  is set.

### Option B — Authenticated SMTP submission / mailrelay with SPF/DKIM/DMARC alignment

- Authenticated SMTP submission scoped to `office@esrf.net`, owned by
  the same identity that owns the mailbox. The relay holds the SMTP
  credential.
- SPF, DKIM, and DMARC must be **aligned** for the
  `From: office@esrf.net` envelope before the relay is wired up.
  Verify with a manual test send and inspection of the receiving
  mailbox headers (`Authentication-Results: spf=pass dkim=pass
  dmarc=pass`).
- Cloudflare Pages does **not** hold the SMTP credential, does **not**
  link against an SMTP SDK, and does **not** open an SMTP connection.
  This invariant is unchanged from the rest of this document.
- Activation precondition: a **manually-delivered test message**
  must arrive at `office@esrf.net` and must show SPF/DKIM/DMARC pass
  before any Cloudflare Pages env var is set.

### Option C — Manual Sheet-based notification (default-safe, in effect today)

- The redactie monitors the LAB_* tabs directly in the existing Drive
  spreadsheet (`LAB_Intake_Submissions`, `LAB_Editorial_Intake`,
  `LAB_Place_Candidates`, `LAB_Backend_Log`, `LAB_Workflow_Events`).
- No automatic email channel. `INTAKE_NOTIFY_WEBHOOK` and
  `INTAKE_NOTIFY_TO` stay unset.
- This is the **current operational state** and the safe fallback if
  Options A and B are not approved.

### Common rules across A / B / C

- The wire-level payload contract (`NOTIFICATION_CONTRACT` in
  `functions/api/intake.js` and the table in
  [`intake-minimal-notification-design.md`](./intake-minimal-notification-design.md))
  is unchanged. `allowed_keys` only; `forbidden_keys` rejected.
- `INTAKE_NOTIFY_WEBHOOK` and `INTAKE_NOTIFY_TO` are set **only after**
  the relevant manually-delivered test confirmation under a
  minimal-rights consent scope. Production env vars stay untouched
  until a second delivered-test confirmation under production
  identity.
- Operators MUST NOT re-attempt the Outlook connector flow if it
  again surfaces a broad / full-mailbox consent screen, and MUST NOT
  re-enable the Google Apps Script `MailApp` route as a stop-gap.
- Until one of A / B passes its delivered-test gate, the documented
  state is: **automatic notifications disabled; manual Sheet-based
  notification (Option C) in effect; rollback events
  `evt_unconfirmed_google_mailrelay_disabled_20260426_1401` and
  `evt_outlook_broad_scope_rejected_20260426_1421` recorded.**
