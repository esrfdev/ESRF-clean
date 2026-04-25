# Intake backend — `/api/intake`

Validation-environment backend for the integrated organisation + editorial
intake form (`submit-validation.html`). Runs on Cloudflare Pages Functions.

This document describes:

1. The storage architecture (and why the Google Drive spreadsheet remains
   the single source of truth)
2. The required environment variables
3. The current dry-run behaviour
4. The prepared i18n keys for the 27-language rollout

---

## 1. Storage architecture — sheet stays the single source of truth

The Google Drive intake-spreadsheet that the redactie already uses is the
**operational single source of truth**. The backend does *not* replace it.
The backend is the *input channel*; the spreadsheet remains the register of
record for status, redactie-besluit, en rapportage.

Per submission, three records exist (each with its own dry-run flag):

| Role | Where | Contents |
|---|---|---|
| **Single source of truth** | Google Sheet (Drive) | Minimal flat row: status, organisation, contact, country/region, mode, pointers to issue. The redactie works in this file. |
| **Evidence / workflow** | Private GitHub issue (optional) | Full structured intake, including editorial body. Provides an immutable audit trail. The sheet row links to the issue. |
| **Notification** | ESRF mailnotificatie / mailrelay-webhook (optional) | Minimal operational ping only — no PII, no editorial text. Includes `sheet_row_id`, `issue_url` and an optional `notify_to_recipient` (default: `office@esrf.net`) so the redactie can jump to the SSoT. **Not** a Gmail-specific integration — ESRF.net does not run on Gmail. |

E-mail is **never** used as a substitute for the spreadsheet. When activated
(via `INTAKE_NOTIFY_WEBHOOK` + `INTAKE_NOTIFY_TO`, or via the Apps Script's
`NOTIFY_TO` Script Property), it is at most a minimal operational ping that
points back to the sheet/issue. The Cloudflare Pages Function never sends
mail directly; a generic relay (Apps Script `MailApp`, Pipedream,
internal SMTP relay, …) performs the actual send.

### Why a webhook (Apps Script) and not direct Sheets API?

- Avoids putting Google service-account credentials in Cloudflare.
- Apps Script runs as the spreadsheet owner — natural permission model.
- Apps Script can also do redactie-side validation (duplicate detection,
  status-column initialisation) before the row is appended.

### Apps Script contract

The backend POSTs JSON to `INTAKE_SHEET_WEBHOOK_URL`. The Apps Script is
expected to:

- Append a row to the canonical intake sheet
- Return JSON: `{ "ok": true, "row_id": "...", "sheet_url": "..." }`

The row schema (`schema_version: 1`):

```
schema_version, received_at, environment, intake_mode,
organisation, contact_name, contact_role, contact_email,
country_code, country_label, region, place,
place_known, place_addition_requested, website,
has_listing, listing_sector,
has_editorial, editorial_topic,
issue_url, issue_number,
status
```

`status` is initialised to `"new"` — the redactie updates it manually or
via a redactie-side script (`triage`, `accepted`, `rejected`, `published`,
…). Adding columns is safe: the backend only sets the columns above.

---

## 2. Environment variables

| Name | Required for | Purpose |
|---|---|---|
| `INTAKE_SHEET_WEBHOOK_URL` (alias `GOOGLE_SHEET_WEBHOOK_URL`) | **Primary** sheet writes | URL of the Apps Script webhook on the existing Drive intake-spreadsheet. |
| `TURNSTILE_SECRET_KEY` | Production anti-bot | Cloudflare Turnstile secret. Without it, Turnstile is skipped and the response includes a warning. |
| `GITHUB_TOKEN` | Optional evidence | Fine-grained PAT with `issues: write` on the private intake repo only. |
| `INTAKE_REPO` | Optional evidence | `owner/repo` of the private intake repo. |
| `INTAKE_NOTIFY_WEBHOOK` | Optional notify | ESRF mailrelay-/notificatie-webhook URL. Generic relay (Apps Script, Pipedream, internal SMTP relay, Slack-compatible endpoint, …). Receives the minimal, PII-free notification payload only. **Not** Gmail. |
| `INTAKE_NOTIFY_TO` | Optional recipient | Operational recipient address — documented default `office@esrf.net`. Forwarded as `notify_to_recipient` metadata so the relay knows where to deliver. The Cloudflare backend never sends mail itself. |

Set via Cloudflare Pages → Settings → Environment variables. Use the
**Production** environment for live, and **Preview** for branch validation
without touching the production spreadsheet.

---

## 3. Current behaviour (validation environment)

- Endpoint: `POST /api/intake`, JSON only, max 64 KiB body.
- Rejects non-POST, non-JSON, payloads from disallowed origins.
- Validates required fields per mode (`org`, `editorial`, `both`),
  consents, GDPR privacy.
- Sanitises every field (HTML/control-char strip, length cap).
- Anti-spam: honeypot field (`company_website_hp`), minimum form-fill time
  (`form_duration_ms ≥ 2500`), optional Turnstile.
- **Dry-run is per-storage-path:**
  - `sheet_dry_run: true` if `INTAKE_SHEET_WEBHOOK_URL` not set → returns
    `sheet_row_preview` with the exact row that would be written.
  - `issue_dry_run: true` if GitHub config missing → returns
    `issue_preview` with title/body/labels.
  - Notification only fires if its webhook is set.
- Every response includes `storage_architecture` block declaring the
  spreadsheet as the SSoT.

The top-level `dry_run` field reflects the *spreadsheet* state, because
the spreadsheet is the SSoT.

### Cloudflare Pages preview URL

The branch `test/regional-editorial-contributor-intake` deploys to a
Cloudflare Pages preview. The endpoint sits at
`https://<branch-preview>.esrf-clean.pages.dev/api/intake`. Pages
Functions cannot be invoked from a local static server — to exercise
the live endpoint, use the deployed preview. Locally, the validation
in `functions/api/intake.test.mjs` exercises the validation, sanitiser,
sheet-row builder and issue-preview builder in isolation.

---

## 4. i18n keys — 27-language rollout (prepared, not yet applied)

The backend is language-independent. The strings that need translation
live in `submit-validation.html` and in the JSON error messages returned
by `/api/intake`. The 27-language rollout will move all of them into
`i18n/<lang>.json` under a new `intake.*` namespace.

Prepared key list (nl + en will be authored first; the remaining 25 EU/EER
languages follow once the redactie has signed off on the backend flow):

```
intake.button.send_to_validation_backend
intake.button.send_to_validation_backend.busy
intake.button.send_to_validation_backend.again

intake.preview.heading
intake.preview.intro
intake.preview.copy
intake.preview.json
intake.preview.text
intake.preview.back

intake.backend.hint            # "Calls POST /api/intake on the Cloudflare Pages preview…"
intake.backend.dry_run         # "DRY-RUN — no row written to the spreadsheet"
intake.backend.live            # "Row added to the spreadsheet (single source of truth)"
intake.backend.architecture    # heading "Storage architecture:"
intake.backend.sheet_label     # "Spreadsheet (Drive) — single source of truth"
intake.backend.issue_label     # "GitHub issue (private) — evidence/workflow"
intake.backend.notify_label    # "ESRF mailnotificatie / mailrelay-webhook — operationele ping only (no PII)"
intake.backend.warnings        # heading
intake.backend.row_preview     # "Spreadsheet row (preview, would be added):"
intake.backend.issue_preview   # "Issue preview (would be created):"
intake.backend.unreachable     # error when fetch fails

intake.error.invalid_mode
intake.error.missing_contact_field
intake.error.invalid_email
intake.error.invalid_country_code
intake.error.org_requires_website
intake.error.editorial_missing_field
intake.error.editorial_consent_required
intake.error.gdpr_required
intake.error.payload_too_large
intake.error.invalid_json
intake.error.honeypot
intake.error.too_fast
intake.error.turnstile

intake.tech.ssot_paragraph     # the "spreadsheet remains SSoT" explainer
intake.tech.three_roles
intake.tech.what_does_not_happen
intake.tech.multilingual
```

Rollout order:

1. `nl` (current copy) and `en` are authored from the existing Dutch text.
2. The other 25 languages are translated in a single batch via the existing
   editorial DeepL pipeline, mirroring the `i18n/*.json` shape used
   elsewhere in the repo.
3. The HTML is migrated string-by-string to use the existing `i18n.js`
   helper, with `nl` as the fallback during the transition.

This rollout intentionally happens **after** the redactie has signed off on
the backend flow, so we don't translate strings that may still change.

---

## 5. Tests

- `functions/api/intake.test.mjs` — Node-only self-contained unit tests.
  Covers sanitiser, origin allowlist, validator (per mode), issue preview,
  and the new `buildSheetRow` (schema, refs, no editorial body inlined).
- `functions/_middleware.test.mjs` — independent middleware tests.

Run with:

```
node functions/api/intake.test.mjs
node functions/_middleware.test.mjs
```
