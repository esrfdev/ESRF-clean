# Intake lab automation — `/api/intake` (lab/preview)

Lab/preview automation for the integrated organisation + editorial intake
form (`submit-validation.html`). Lives on the
`test/regional-editorial-contributor-intake` branch — **never** production.

> **Latest dry-run evidence:** see
> [`intake-lab-test-report-2026-04-25.md`](./intake-lab-test-report-2026-04-25.md)
> for the end-to-end browser dry-run (submission `sub_moelllvt_i21b`),
> the notification-contract verification, and the operational
> readiness checklist for activating the Apps Script webhook —
> including the **safe `wrangler pages secret` CLI route** (§6a),
> the **decision gate before any real email is sent** (§6b), and
> the **rollback procedure** (§6c).

This document covers:

1. The lab tabs and the SSoT contract
2. Environment variables (priority order, dual naming)
3. Backend response: workflow steps and notification contract
4. End-to-end test steps in the preview environment
5. Production-overgang (what changes when this graduates)

---

## 1. Lab tabs — the Google Sheet stays the single source of truth

The Google Drive spreadsheet **`ESRF Directory CRM - actuele brondata
2026-04-24`** (spreadsheet id
`1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g`) is and remains the
operational single source of truth.

In lab/preview the backend writes **only** to the following tabs (the
backend payload always carries `target_prefix: "LAB_"` and lists
`Directory_Master` as a forbidden target):

| Tab | Purpose | One row per |
|---|---|---|
| `LAB_Intake_Submissions` | Master submission register | submission |
| `LAB_Editorial_Intake` | Editorial-bearing submissions only | editorial |
| `LAB_Place_Candidates` | Unknown / requested place additions | place candidate |
| `LAB_Backend_Log` | Every `/api/intake` request, success or error | request |
| `LAB_Workflow_Events` | State-change events / status transitions | event |

The exact column headers are documented in
[`docs/apps-script-intake-webhook.gs`](./apps-script-intake-webhook.gs)
and matched by the row builders in `functions/api/intake.js`.

`Directory_Master` is **never** automatically modified by this backend.
The Apps Script reference rejects any payload that targets
`Directory_Master` or omits the `LAB_` prefix.

---

## 2. Environment variables

Set via Cloudflare Pages → Settings → Environment variables. Use the
**Preview** environment for the lab branch; **Production** stays unset
until the redactie signs off.

| Name | Purpose | Notes |
|---|---|---|
| `INTAKE_SHEET_WEBHOOK_URL` | Apps Script webhook URL (preferred name) | Highest priority |
| `SHEETS_WEBHOOK_URL` | Documented alias accepted by the backend | Used if the canonical name is absent |
| `GOOGLE_SHEET_WEBHOOK_URL` | Legacy alias | Fallback only |
| `SHEETS_WEBHOOK_SECRET` (alias `INTAKE_SHEET_WEBHOOK_SECRET`) | Optional shared secret; sent as `x-esrf-intake-secret` header | Apps Script must verify this |
| `INTAKE_NOTIFY_WEBHOOK` | Optional **ESRF mailrelay-/notificatie-webhook** URL | Receives the minimal, PII-free notification payload. Generic relay (Apps Script, Pipedream, custom mailrelay, Slack-compatible endpoint, …). **Not** a Gmail-specific integration — ESRF.net does not run on Gmail. |
| `INTAKE_NOTIFY_TO` | Optional operational recipient address | Documented default: `office@esrf.net`. Forwarded as `notify_to_recipient` metadata in the notification message. The Cloudflare backend never sends mail directly; the relay (e.g. the Apps Script's `NOTIFY_TO` Script Property) performs the actual `MailApp.sendEmail()` call. |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret | Without it, Turnstile is skipped (warning emitted) |
| `GITHUB_TOKEN` + `INTAKE_REPO` | Optional: open a private intake issue as evidence record | `INTAKE_REPO` is `owner/repo` |

**Priority order for the sheet webhook URL** (first non-empty wins):

1. `INTAKE_SHEET_WEBHOOK_URL`
2. `SHEETS_WEBHOOK_URL`
3. `GOOGLE_SHEET_WEBHOOK_URL`

Secrets are never returned to the client and never logged.

### 2a. Apps Script — Script Properties (canonical names)

The Apps Script that backs `INTAKE_SHEET_WEBHOOK_URL`
(reference: `docs/apps-script-intake-webhook.gs`) is configured via
*Apps Script → Project Settings → Script Properties*. New deployments
must set the canonical property names below. Legacy aliases are
accepted as a fallback so deployments that already use the old names
keep working without manual reconfiguration; new deployments should
leave the legacy names unset.

| Property | Status | Purpose |
|---|---|---|
| `SHEETS_WEBHOOK_SECRET` | **canonical, required** | Must match the Cloudflare backend's `SHEETS_WEBHOOK_SECRET` (sent on inbound requests as the `x-esrf-intake-secret` header, or in the JSON body as `shared_secret`). |
| `SHEET_ID` | **canonical, optional** | Spreadsheet id to write to. Optional: the script also resolves it from the inbound payload's `spreadsheet_id` and from the constant in the source. |
| `SHARED_SECRET` | legacy alias (fallback) | Legacy alias for `SHEETS_WEBHOOK_SECRET`. Read only if the canonical name is unset. Do not set on new deployments. |
| `SPREADSHEET_ID` | legacy alias (fallback) | Legacy alias for `SHEET_ID`. Read only if the canonical name is unset. Do not set on new deployments. |
| `NOTIFY_TO` | optional, **unset by default** | Operational ESRF inbox (e.g. `office@esrf.net`). Leave unset to disable mail notifications. When set, the Apps Script sends a minimal, PII-free `MailApp.sendEmail()` after each successful sheet write. This is **not** a Gmail-as-ESRF route — MailApp delivers from the script-owner Workspace identity. |
| `NOTIFY_FROM_NAME` | optional | Display name on the `From:` line (default `ESRF intake bot`). |
| `NOTIFY_SUBJECT_PREFIX` | optional | Subject prefix (default `[ESRF intake]`). |

`Directory_Master` is **never** auto-written. The Apps Script refuses
any payload whose `target_prefix` is not `LAB_` or whose row map
includes `Directory_Master`.

---

## 3. Backend response — workflow + notification contract

Every successful `POST /api/intake` returns JSON with these top-level
fields (and the existing `ok`, `mode`, `received_at`, etc.):

```json
{
  "ok": true,
  "submission_id": "sub_…",
  "request_id": "req_…",
  "dry_run": true,
  "sheet_dry_run": true,
  "issue_dry_run": true,
  "workflow": {
    "status": "dry_run | stored | error",
    "next_required_action": "…human-readable string…",
    "steps": [
      { "step": "received",                       "status": "ok",      "at": "…", "detail": "…" },
      { "step": "validated",                      "status": "ok",      "at": "…", "detail": "…" },
      { "step": "stored_or_dry_run",              "status": "stored | dry_run | error", "at": "…", "detail": "…" },
      { "step": "notification_prepared_or_sent",  "status": "sent | dry_run_not_configured | error", "at": "…", "detail": "…" },
      { "step": "next_required_action",           "status": "…",        "at": "…", "detail": "…" }
    ]
  },
  "sheet_webhook_payload_preview": { /* exact JSON the Apps Script would receive */ },
  "notification_status": "sent | dry_run_not_configured | error",
  "notification_message": { /* exact minimal message that would be POSTed */ },
  "storage_architecture": {
    "single_source_of_truth": "google_sheet",
    "spreadsheet_id": "1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g",
    "spreadsheet_label": "ESRF Directory CRM - actuele brondata 2026-04-24",
    "target_prefix": "LAB_",
    "lab_tabs": { "intake_submissions": "LAB_Intake_Submissions", "…": "…" },
    "forbidden_targets": ["Directory_Master"]
  },
  "warnings": [ "…human-readable strings…" ]
}
```

### Notification contract (minimal — no PII, no editorial body)

The notification channel is the **ESRF mailnotificatie /
operationele notificatie / mailrelay-webhook**. It is intentionally
generic — any HTTP endpoint that knows how to deliver an email (Apps
Script's `MailApp`, Pipedream, a custom mailrelay, a Slack-compatible
incoming webhook, …) can be plugged in. ESRF.net does **not** run on
Gmail and there is no Gmail-specific code path.

The notification message contains **only**:

```
schema_version
submission_id
request_id
environment
mode
type                  // org | editorial | org+editorial
org_name
country               // ISO-3166 alpha-2
region
workflow_status
next_required_action
related_sheet         // e.g. "LAB_Intake_Submissions"
related_row           // sheet row id once known
issue_url             // when GitHub evidence record is configured
notification_channel  // always "esrf_mail_relay_or_webhook"
notify_to_recipient   // OPTIONAL — operational ESRF inbox (e.g. office@esrf.net) — only present when INTAKE_NOTIFY_TO is set
note
```

It MUST NOT contain `contact_email`, `contact_phone`, `contact_name`,
`editorial.summary`, `editorial.regional_angle`, `editorial.lesson` or
any other free-form editorial body. The
`functions/api/intake.test.mjs` tests *"notification message excludes
PII and editorial body"* and *"notification message exposes
notify_to_recipient ONLY when configured + valid"* enforce this. The
test *"workflow event row labels notification channel as ESRF mail
relay/webhook (not Gmail)"* enforces the channel naming.

If `INTAKE_NOTIFY_WEBHOOK` is unset, the response carries
`notification_status: "dry_run_not_configured"` and the exact would-be
message is returned in `notification_message` so the redactie can
inspect it.

#### Activating real mail delivery to `office@esrf.net`

Two activation paths, depending on where you want the actual
`MailApp.sendEmail()` call to live:

1. **Apps Script (recommended for the lab — single deploy unit).**
   On the Apps Script project that backs `INTAKE_SHEET_WEBHOOK_URL`,
   open *Project Settings → Script Properties* and set the canonical
   properties (see §2a):
   - `SHEETS_WEBHOOK_SECRET` — required; must match the Cloudflare
     `SHEETS_WEBHOOK_SECRET` env var.
   - `SHEET_ID` — optional; the lab spreadsheet id.
   Then, to enable mail notifications, **opt in** by adding
   `NOTIFY_TO` (e.g. an ESRF inbox such as `office@esrf.net`). It is
   unset by default — no email is sent until an operator sets it.
   After the next successful intake write, the Apps Script sends a
   minimal MailApp notification to that inbox. Clear the property to
   disable. The Apps Script reference
   (`docs/apps-script-intake-webhook.gs`) implements this with the
   same allow-list / forbidden-fields guarantees as the backend
   payload, so PII cannot leak into the email body. MailApp delivers
   from the script-owner Workspace identity to the configured ESRF
   inbox — this is **not** a Gmail-as-ESRF route.

2. **External mailrelay / webhook (e.g. Pipedream, n8n,
   internal SMTP relay).** Set `INTAKE_NOTIFY_WEBHOOK` on Cloudflare
   Pages to the relay URL, and `INTAKE_NOTIFY_TO=office@esrf.net` so
   the relay knows the operational recipient. The Cloudflare backend
   POSTs the same minimal JSON to the relay; the relay translates it
   to email.

In both paths **the Cloudflare Pages Function never sends email
itself**. No SMTP credentials live in Cloudflare. No real email is
sent until the operator opts in by setting the relevant property /
env var. The lab readiness checklist in
[`intake-lab-test-report-2026-04-25.md`](./intake-lab-test-report-2026-04-25.md)
documents the exact activation steps.

---

## 4. End-to-end test steps (preview environment)

Test against the lab preview at
<https://test-regional-editorial-cont.esrf-clean.pages.dev/submit-validation.html>.

Initial state: no env vars set on the preview environment → full dry-run.

1. Open the preview URL in a clean browser window.
2. Fill in the **organisation** path with a fictitious org and submit.
3. Click "Backend test — geen productieopslag tenzij validatiesecrets actief zijn".
4. Verify the panel shows:
   - `workflow.status: dry_run`
   - `workflow.steps` with five entries (received, validated,
     stored_or_dry_run=`dry_run`, notification_prepared_or_sent=`dry_run_not_configured`,
     next_required_action)
   - `Sheet-doel (lab)` lists the lab spreadsheet id, `target_prefix: LAB_`
     and the five LAB_* tabs
   - `Notificatie.status: dry_run_not_configured` and a preview message
     with no `contact_email`, no `contact_name`, no editorial body
   - `LAB-rijen (preview)` lists exactly the rows that would be appended
     (one for `LAB_Intake_Submissions`, plus the log + workflow event)
5. Repeat for the **editorial** path. Verify a `LAB_Editorial_Intake`
   row appears in the preview.
6. Repeat for the **both** path. Verify both rows appear.
7. Repeat with an unknown place. Verify a `LAB_Place_Candidates` row
   appears in the preview.
8. (Optional) Set `INTAKE_SHEET_WEBHOOK_URL` to a deployed Apps Script
   webhook (the example in `docs/apps-script-intake-webhook.gs`) and a
   shared `SHEETS_WEBHOOK_SECRET`, then re-run step 7. The panel should
   now show `workflow.status: stored` and a real row id from the sheet.

The Node-only test suite covers the same dry-run paths without needing
the deployed preview:

```
node functions/api/intake.test.mjs
node functions/_middleware.test.mjs
```

---

## 5. Productie-overgang

This lab automation graduates only when:

1. The redactie signs off on the contents of the lab tabs and the
   workflow / notification copy.
2. A canonical Apps Script (based on `apps-script-intake-webhook.gs`)
   is deployed against the production tabs (without the `LAB_` prefix)
   on a separate sheet. **Directory_Master remains read-only.**
3. The Cloudflare Pages **Production** environment receives the
   non-lab webhook URL and a fresh shared secret. The Preview
   environment continues to point at the lab tabs.
4. The 27-language i18n keys listed in `docs/intake-backend.md` are
   authored.

Until then the production form remains the existing
`request-listing.html` and `submit-news.html`; the lab backend never
publishes anything.
