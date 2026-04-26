# Minimal-notification design — `/api/intake` → office@esrf.net

> **Status (2026-04-26, end of day):**
> `minimal-notification-design-ready-not-enabled`. The contract is
> implemented in code and surfaced in every dry-run response and in
> the LAB UI preview. **No mail is sent. Automatic notifications stay
> disabled.**
>
> **Operational decision (2026-04-26, 14:01):** The Google Apps Script
> `MailApp` mailrelay route was tested with operator probe submission
> `sub_moftdrju_f8lk`, but delivery to `office@esrf.net` was **not
> confirmed**. The Cloudflare Pages **Preview** env vars
> `INTAKE_NOTIFY_WEBHOOK` and `INTAKE_NOTIFY_TO` were **removed /
> disabled** under rollback event
> `evt_unconfirmed_google_mailrelay_disabled_20260426_1401`. The Google
> Apps Script `MailApp` route is therefore marked
> **disabled / delivery-unconfirmed** and is **not** a production route.
> Sheet intake (LAB_* tabs via the spreadsheet-only Apps Script) stays
> active.
>
> **Operational decision (2026-04-26, 14:21) — Outlook connector
> rejected on scope:** A follow-up attempt to authorize an **Outlook /
> Microsoft 365 connector** for `office@esrf.net` was **rejected by the
> operator** because the consent screen requested **broad / full
> mailbox access** (read mail, mailbox-wide permissions) rather than a
> minimal send-only scope. Refusing this consent is the correct
> security decision: the notification channel only needs to **send** a
> minimal operational ping; granting full-mailbox access would expand
> the blast radius of a relay compromise to the entire `office@esrf.net`
> mailbox, including submitter correspondence and unrelated foundation
> mail. This decision is recorded as event
> `evt_outlook_broad_scope_rejected_20260426_1421`. **No Outlook
> connector was authorized; no env vars were enabled; production was
> not touched; no test emails were sent.**
>
> **Recommended next routes (all disabled until manually delivered
> test confirmed AND minimal-rights only):**
>
> 1. **Microsoft Graph app registration with send-only `Mail.Send`**
>    scoped to `office@esrf.net` (application permission narrowed via
>    Exchange Online RBAC `ApplicationAccessPolicy` to that one
>    mailbox), if the tenant admin can grant `Mail.Send` *without*
>    `Mail.Read` / `Mail.ReadWrite` / `full_access_as_app`. If the
>    only available consent is broad mailbox access, this route stays
>    rejected.
> 2. **Authenticated SMTP submission / mailrelay** for
>    `office@esrf.net` with **SPF, DKIM, and DMARC alignment**
>    verified end-to-end before any env var is set.
> 3. **Manual Sheet-based notification fallback** — the redactie
>    monitors the LAB_* tabs directly in the existing Drive
>    spreadsheet. This is the safe default and is what is in effect
>    today.
>
> Until one of these routes has passed a manually-delivered test
> confirmation under minimal-rights consent, the notification env vars
> stay unset, automatic notifications stay disabled, and the backend
> keeps reporting `notification_status: "dry_run_not_configured"`.
>
> The prepared Apps Script `MailApp` source at
> [`apps-script-mail-notification.gs`](./apps-script-mail-notification.gs)
> with manifest
> [`appsscript.mail-notification.json`](./appsscript.mail-notification.json)
> remains in-tree as a reference artefact only; see the disabled-status
> notice and rollback record at the top of
> [`apps-script-mail-notification.future.md`](./apps-script-mail-notification.future.md).

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

## Rollback record — 2026-04-26 (Google Apps Script MailApp route disabled)

| Field | Value |
|---|---|
| Rollback event id | `evt_unconfirmed_google_mailrelay_disabled_20260426_1401` |
| Operator probe submission id | `sub_moftdrju_f8lk` |
| Tested route | Google Apps Script `MailApp.sendEmail` deployment hit via Cloudflare Pages Preview `INTAKE_NOTIFY_WEBHOOK` |
| Intended recipient | `office@esrf.net` |
| Delivery to `office@esrf.net` | **NOT CONFIRMED** during the verification window |
| Cloudflare Pages Preview env vars | `INTAKE_NOTIFY_WEBHOOK` and `INTAKE_NOTIFY_TO` **removed / disabled** |
| Sheet intake | Unaffected — LAB_* tabs continue to receive rows |
| `Directory_Master` | Untouched |
| Production env vars | Untouched (never set on this branch for this route) |
| Status flag after rollback | `MINIMAL_NOTIFICATION_DESIGN_STATUS = 'minimal-notification-design-ready-not-enabled'` (unchanged — was never flipped to `enabled` because step 7 of the activation checklist was never reached) |

Recommended next step is **not** to retry the Google Apps Script
`MailApp` route. The recommended next notification route is one of
the **minimal-rights** routes documented under "Recommended next
routes" above (Microsoft Graph send-only `Mail.Send`, authenticated
SMTP / mailrelay with SPF/DKIM/DMARC alignment, or manual Sheet-based
notification), enabled only after an operator manually verifies a
delivered test message arrives at the `office@esrf.net` inbox **and**
the consent scope is confirmed to be send-only. See
[`apps-script-mail-notification.future.md`](./apps-script-mail-notification.future.md)
for the full rollback record and route description.

## Decision record — 2026-04-26, 14:21 (Outlook connector rejected on broad scope)

| Field | Value |
|---|---|
| Decision event id | `evt_outlook_broad_scope_rejected_20260426_1421` |
| Date / time | 2026-04-26, 14:21 local |
| Route under review | Outlook / Microsoft 365 connector for `office@esrf.net` |
| Trigger | Operator opened the Microsoft consent flow to authorize the connector. |
| Consent screen requested | **Broad / full mailbox access** (read mail / mailbox-wide permissions), not a minimal send-only scope. |
| Operator action | **Authorization rejected.** No tokens were issued, no connector was authorized, no client secret was stored anywhere in this repo or in Cloudflare Pages env vars. |
| Why this is the correct security decision | The notification channel only needs to **send** a minimal, PII-free operational ping (the wire-level contract is locked in this document). Granting broad / full mailbox access would let a relay compromise read the entire `office@esrf.net` mailbox — submitter correspondence, foundation mail, password-reset mails — none of which the relay needs. Refusing broad consent keeps the blast radius bounded to "send one minimal mail" if the relay is ever compromised. |
| Cloudflare Pages env vars | `INTAKE_NOTIFY_WEBHOOK` and `INTAKE_NOTIFY_TO` remain **disabled / unset** on every environment (they were already unset after `evt_unconfirmed_google_mailrelay_disabled_20260426_1401`). No new env var was created for this route. |
| Production impact | None. Production env vars were not touched. No production deployment was modified. |
| Sheet intake impact | None. Sheet intake via the spreadsheet-only Apps Script remains active; LAB_* rows continue to append. `Directory_Master` not touched. |
| Test emails sent | **None.** |
| Status flag | `MINIMAL_NOTIFICATION_DESIGN_STATUS = 'minimal-notification-design-ready-not-enabled'` (unchanged). Automatic notifications stay disabled. |

### Recommended next routes after this rejection (minimal-rights only)

This is the canonical list. **Any future route must be one of these
*and* must pass a manually-delivered test before env vars are set.**

1. **Microsoft Graph app registration with send-only `Mail.Send`** as
   `office@esrf.net`, *if* the tenant admin can grant `Mail.Send` as
   a narrowly-scoped application permission (no `Mail.Read`, no
   `Mail.ReadWrite`, no `full_access_as_app`) and restrict it to the
   single `office@esrf.net` mailbox via Exchange Online
   `New-ApplicationAccessPolicy`. If the only consent path available
   is broad mailbox access — as was the case for the Outlook
   connector on 2026-04-26 — this route stays **rejected** and must
   not be enabled.
2. **Authenticated SMTP submission / mailrelay** for
   `office@esrf.net`, with **SPF, DKIM, and DMARC alignment**
   verified end-to-end before any Cloudflare Pages env var is set.
   The relay must hold the SMTP credential; Cloudflare Pages must not.
3. **Manual Sheet-based notification fallback** — the redactie
   monitors the LAB_* tabs directly in the Drive spreadsheet. This is
   the **default-safe** state today and remains in effect until one
   of the routes above is approved.

Operators MUST NOT re-attempt the Outlook connector flow as a stop-gap
if it again surfaces a broad / full-mailbox consent screen. The
recorded decision is that broad mailbox access is **out of scope** for
the operational notification channel.

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
