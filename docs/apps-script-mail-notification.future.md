# Deferred ESRF mailnotificatie route — separate Apps Script deployment

> **Status (2026-04-26):** **NOT ACTIVATED.** This route exists as
> documentation only. There is no code, no deployment, and no OAuth
> consent associated with it yet. It will be implemented and
> activated **only after** the first spreadsheet-only lab write
> succeeds end-to-end via
> [`apps-script-intake-webhook.gs`](./apps-script-intake-webhook.gs).
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

## Sketch — separate Apps Script project (when activated)

Outline only. Do **not** copy this into the first-phase webhook:

```javascript
// In a SEPARATE Apps Script project, with its own appsscript.json
// requesting https://www.googleapis.com/auth/script.send_mail.

function doPost(e) {
  // 1. Verify shared secret (same SHEETS_WEBHOOK_SECRET model).
  // 2. Strict allow-list of fields (see ALLOWED_NOTIFY_FIELDS in the
  //    git history of apps-script-intake-webhook.gs prior to this
  //    split).
  // 3. Strict deny-list for PII / editorial body fields.
  // 4. Strict deny-list for non-production recipient identities
  //    (e.g. ai.agent.wm@gmail.com).
  // 5. MailApp.sendEmail(...) with the minimal, PII-free payload.
}
```

The `appsscript.json` for that separate project will look like:

```json
{
  "timeZone": "Europe/Amsterdam",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.send_mail"
  ]
}
```

The first-phase spreadsheet-only `appsscript.json` (in
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
      `office@esrf.net`. Manifest declares `auth/script.send_mail` and
      nothing else (no `auth/spreadsheets`, no broader Gmail scope).
      Source contains exactly one `MailApp.sendEmail()` call gated on
      shared-secret verification.
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
