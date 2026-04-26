# Minimal-notification design — `/api/intake` → office@esrf.net

> **Status (2026-04-26):** `minimal-notification-design-ready-not-enabled`.
> The contract is implemented in code and surfaced in every dry-run
> response and in the LAB UI preview. **No mail is sent yet.** Real
> dispatch requires a separate Apps Script deployment — the source is
> now checked into
> [`apps-script-mail-notification.gs`](./apps-script-mail-notification.gs)
> with manifest
> [`appsscript.mail-notification.json`](./appsscript.mail-notification.json)
> as a PREPARED, NOT ACTIVATED stub — see also
> [`apps-script-mail-notification.future.md`](./apps-script-mail-notification.future.md)
> for the activation checklist. Activation also requires
> ticking off the operator-driven checklist (below).

This document is the single source of truth for what the operational
notification to `office@esrf.net` may and may not contain. It exists so
that the redactie, the operator, and a future security review can audit
the wire payload **before** the mailrelay is wired up.

It complements:

- [`intake-backend.md`](./intake-backend.md) — the broader Cloudflare
  Pages backend contract.
- [`apps-script-intake-webhook.gs`](./apps-script-intake-webhook.gs) /
  [`appsscript.json`](./appsscript.json) — the spreadsheet-only first
  phase. Contains no `MailApp` / `GmailApp` / `script.send_mail` scope.
- [`apps-script-mail-notification.future.md`](./apps-script-mail-notification.future.md)
  — the deferred mail relay route (activation checklist + rollback).
- [`apps-script-mail-notification.gs`](./apps-script-mail-notification.gs)
  / [`appsscript.mail-notification.json`](./appsscript.mail-notification.json)
  — the SEPARATE prepared-not-activated mail relay source. Declares
  only `auth/script.send_mail`; mirrors `NOTIFICATION_CONTRACT`
  (`ALLOWED_FIELDS` / `FORBIDDEN_FIELDS` / `FORBIDDEN_RECIPIENTS`).

## Why a minimal payload

The notification is an **operational signal**, not a content delivery
mechanism. Its purpose is to tell the redactie that a new submission
exists in the LAB spreadsheet, where to look, and what state it is in.
The full submission (organisation listing OR editorial body) lives in
the LAB sheet and the GitHub intake issue — both are already access-
controlled. Re-sending that content over a mail relay would expand the
attack surface for no operational gain.

Concretely the design avoids:

1. **Submitter PII** — no contact email, no contact phone, no contact
   name. The notification is sent **to** the ESRF foundation inbox; it
   carries no submitter address, so a misrouted notification cannot leak
   submitter identity.
2. **Editorial body** — no `summary`, no `regional_angle`, no `lesson`,
   no `body_md_or_url`, no `description_en`. Editorial review happens in
   the LAB sheet, not via email forwarding.
3. **Operational secrets** — no `SHEETS_WEBHOOK_SECRET`, no
   `INTAKE_SHEET_WEBHOOK_URL`, no `GITHUB_TOKEN`, no
   `INTAKE_NOTIFY_WEBHOOK`, no `TURNSTILE_SECRET_KEY`. A relay must
   never be in a position to echo a secret back to its sender or to its
   inbox.
4. **Raw payload echo** — no `raw_payload_json`. The LAB sheet column
   `raw_payload_json` is intentionally left empty by the row builder
   (`buildIntakeSubmissionRow` in `functions/api/intake.js`) and the
   notification re-asserts that contract.

## The contract (`NOTIFICATION_CONTRACT`)

The exact contract is defined in `functions/api/intake.js` as the
`NOTIFICATION_CONTRACT` constant and is surfaced verbatim in the
`/api/intake` and `/api/intake-test` JSON response under
`notification_contract`. The LAB UI in `submit-validation.html` renders
the same object on every dry-run preview, so a reviewer can audit the
contract without reading source.

### Allowed keys (signal only)

| Key | Source | Purpose |
| --- | --- | --- |
| `schema_version` | constant `1` | Versioning for the relay receiver. |
| `submission_id` | backend | Cross-reference to LAB row. |
| `request_id` | backend | Cross-reference to LAB_Backend_Log. |
| `environment` | `meta.environment` | Always `TEST/VALIDATIE` on this branch. |
| `mode` | `intake_mode` | `org` / `editorial` / `both`. |
| `type` | derived | `org` / `editorial` / `org+editorial`. |
| `org_name` | `contact.organisation` | Organisation (not contact) name. |
| `country` | `contact.country_code` | ISO-3166 alpha-2. |
| `region` | `contact.region` | Sub-national region label. |
| `workflow_status` | backend | `dry_run` / `stored` / `error`. |
| `next_required_action` | backend | Human-readable redactie action. |
| `related_sheet` | constant `LAB_Intake_Submissions` | LAB tab name. |
| `related_row` | sheet upstream | Row id (when stored). |
| `related_sheet_url` | derived from `LAB_SPREADSHEET.spreadsheet_id` | Deep link to the LAB spreadsheet root only — no row anchor. |
| `validation_lab_url` | constant or ctx | Link to `submit-validation.html`. |
| `issue_url` | GitHub upstream | Intake issue URL (when known). |
| `notification_channel` | constant `esrf_mail_relay_or_webhook` | Channel name; never Gmail-specific. |
| `note` | constant | Human-readable disclaimer. |
| `notify_to_recipient` | `INTAKE_NOTIFY_TO` | OPTIONAL operational recipient — only when explicitly configured AND validated by `sanitizeNotifyRecipient`. |

### Forbidden keys (rejected by `assertNotificationSafe`)

```
contact_email, contact_phone, contact_name,
email, phone, name,
summary, regional_angle, lesson,
editorial_summary, editorial_regional_angle, editorial_lesson,
editorial_body, body_md_or_url,
description, description_en,
raw_payload_json,
shared_secret, shared_secret_present,
INTAKE_SHEET_WEBHOOK_URL, SHEETS_WEBHOOK_URL,
SHEETS_WEBHOOK_SECRET, GITHUB_TOKEN,
INTAKE_NOTIFY_WEBHOOK, TURNSTILE_SECRET_KEY
```

`assertNotificationSafe` is invoked twice on the live path and once on
the dry-run path. The notification builder also asserts that every
populated key is registered in `NOTIFICATION_CONTRACT.allowed_keys`, so
a future refactor that adds a new key without registering it throws at
build time.

### Forbidden recipients

The recipient `ai.agent.wm@gmail.com` is a legacy / non-production
agent identity in agent tooling and is **never** a documented
production recipient. It appears explicitly in
`NOTIFICATION_CONTRACT.forbidden_recipients`,
`OFFICE_IDENTITY.non_production_identities`, and the activation
checklist below.

## Status flag

The string constant `MINIMAL_NOTIFICATION_DESIGN_STATUS` is
`minimal-notification-design-ready-not-enabled` until the activation
checklist below has been completed and signed off. The flag is exposed
on:

- the JSON response of `/api/intake` and `/api/intake-test`
  (`minimal_notification_design_status`),
- the LAB UI preview on `submit-validation.html` ("design-vlag" line),
- the `notification_contract.status` field surfaced in the same
  response.

When activation completes, this constant flips to
`minimal-notification-enabled` in the same commit that wires up the
mail relay. Until then, **no mail is sent and no Cloudflare Pages env
var related to the notify webhook is configured**.

## Activation checklist (manual, separate approval required)

This is the same list returned by the live API in
`notification_contract.activation_checklist`. Each item must be ticked
off **in order** by an operator with `office@esrf.net` access:

1. First-phase spreadsheet-only Apps Script verified end-to-end
   (LAB_* rows append; OAuth consent shows only `auth/spreadsheets`).
2. Redactie sign-off on the dry-run notification copy in
   [`intake-lab-test-report-2026-04-25.md`](./intake-lab-test-report-2026-04-25.md)
   §6b.
3. Separate mail Apps Script project created under `office@esrf.net`
   with the `auth/script.send_mail` scope only. Paste the prepared
   source from [`apps-script-mail-notification.gs`](./apps-script-mail-notification.gs)
   and the manifest from
   [`appsscript.mail-notification.json`](./appsscript.mail-notification.json);
   activation steps in
   [`apps-script-mail-notification.future.md`](./apps-script-mail-notification.future.md).
4. `INTAKE_NOTIFY_WEBHOOK` env var set on the Cloudflare Pages preview
   project (only) to that separate `/exec` URL.
5. `INTAKE_NOTIFY_TO` env var set to `office@esrf.net`. Never to
   `ai.agent.wm@gmail.com` or any submitter address.
6. End-to-end test: send one `/api/intake` submission, confirm minimal
   payload arrives at `office@esrf.net`, and confirm no PII / editorial
   body / secrets in the email body. Compare against
   `notification_contract.allowed_keys` and `forbidden_keys`.
7. After verification, document the activation date in
   `docs/intake-lab-test-report-*.md` and flip
   `MINIMAL_NOTIFICATION_DESIGN_STATUS` from
   `minimal-notification-design-ready-not-enabled` to
   `minimal-notification-enabled`.

Until step 7 is committed, the notification system is design-ready but
**not** enabled. The LAB UI continues to show the contract and the
preview message; no real email is sent.

## Rollback

If anything goes wrong after activation, rollback is one of two env-var
edits on the Cloudflare Pages **preview** project — production env
vars are never touched on this branch:

1. **Disable dispatch (preferred).** Unset
   `INTAKE_NOTIFY_WEBHOOK`. The Cloudflare backend immediately falls
   back to `notification_status: "dry_run_not_configured"` on every
   request and stops calling the mail relay. No code change required.
2. **Disable the relay itself.** In the separate Apps Script project
   that hosts [`apps-script-mail-notification.gs`](./apps-script-mail-notification.gs),
   delete the active deployment so the `/exec` URL returns 404. This
   is the belt-and-braces option if a stale `INTAKE_NOTIFY_WEBHOOK` is
   suspected anywhere.

After rolling back, flip
`MINIMAL_NOTIFICATION_DESIGN_STATUS` in `functions/api/intake.js`
back to `'minimal-notification-design-ready-not-enabled'` and update
the "Status" header at the top of this document so the design and the
runtime do not diverge.

## Why the Cloudflare backend never sends mail itself

The Cloudflare Pages Function only forwards a JSON payload. It never
links against a mail SDK, never opens an SMTP connection, never holds
mail credentials. Real delivery is the relay's responsibility. This
keeps the Cloudflare blast radius bounded: a compromise of the
Cloudflare environment cannot impersonate `office@esrf.net` because the
backend does not carry the mail credential to begin with.

## Test coverage

Notification-safety is asserted in `functions/api/intake.test.mjs`:

- `notification message excludes PII and editorial body`
- `notification message exposes notify_to_recipient ONLY when configured + valid`
- `assertNotificationSafe rejects every forbidden PII / editorial key`
- `FORBIDDEN_NOTIFY_KEYS covers every documented PII / editorial body field`
- `NOTIFICATION_CONTRACT exposes the documented status flag`
- `NOTIFICATION_CONTRACT allowed_keys covers every key the builder emits`
- `NOTIFICATION_CONTRACT forbidden_keys mirrors FORBIDDEN_NOTIFY_KEYS`
- `notification message excludes operational secrets and raw_payload_json`

Plus the integration assertion `first-phase notification remains
disabled / pending in the backend`, which exercises the same builder
the production path uses.
