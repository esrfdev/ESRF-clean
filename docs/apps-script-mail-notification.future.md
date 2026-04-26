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
