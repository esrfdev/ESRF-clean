# Intake backend — `/api/intake`

Validation-environment backend for the integrated organisation + editorial
intake form (`submit-validation.html`). Runs on Cloudflare Pages Functions.

**Status (2026-04-26):** *Security review ready, production blocked.
First lab-write activation is **spreadsheet-only**; mail
notification is **deferred** to a separate later deployment.*

The lab posture passes the security gates documented below
(`functions/api/intake.test.mjs` covers Directory_Master refusal,
shared-secret handling, dry-run default, minimal notification payload,
office@esrf.net official-identity surface, POST-only enforcement, body
size cap, required consent, and — new in this phase — the assertion
that the spreadsheet-only Apps Script reference contains no
`MailApp`/`GmailApp`/`script.send_mail` references and that
`NOTIFY_TO` is **not** required for the first lab activation).

Production activation is **blocked** until:

1. The first-phase spreadsheet-only Apps Script webhook is deployed
   under an `office@esrf.net`-owned Workspace project. This first
   webhook requests **only** the
   `https://www.googleapis.com/auth/spreadsheets` OAuth scope — no
   `script.send_mail`, no `gmail.*`. Mail delivery is handled by a
   separate, later Apps Script project (see
   [`apps-script-mail-notification.future.md`](./apps-script-mail-notification.future.md)).
2. Cloudflare Pages **preview** secrets (`INTAKE_SHEET_WEBHOOK_URL`,
   `SHEETS_WEBHOOK_SECRET`) are configured by an operator. The mail
   env vars (`INTAKE_NOTIFY_WEBHOOK`, `INTAKE_NOTIFY_TO`) stay
   **unset** during the spreadsheet-only first phase; notification
   remains pending/disabled and is surfaced in the response as
   `dry_run_not_configured` (with the would-be message preview).
3. The redactie has signed off on the dry-run notification copy and
   approved the activation gate in
   `docs/intake-lab-test-report-2026-04-25.md` §6b.

ESRF's official automation identity is **`office@esrf.net`**. The legacy
agent identity `ai.agent.wm@gmail.com` (which still appears in some
agent-tooling Google Sheets connectors) is **non-production only**: it
must never be configured as `INTAKE_NOTIFY_TO`, must never own the
production Apps Script project, and is hard-blocked as a recipient by
both `functions/api/intake.js` (via the `OFFICE_IDENTITY` constant
surfaced in the response) and `docs/apps-script-intake-webhook.gs` (via
the `FORBIDDEN_NOTIFY_RECIPIENTS` deny-list).

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
| **Notification** | ESRF mailnotificatie / mailrelay-webhook (optional) | Minimal operational ping only — no PII, no editorial text, no operational secrets. Wire-level contract is locked in [`intake-minimal-notification-design.md`](./intake-minimal-notification-design.md) and surfaced in every API response under `notification_contract`. Includes `sheet_row_id`, `issue_url` and an optional `notify_to_recipient` (default: `office@esrf.net`) so the redactie can jump to the SSoT. **Not** a Gmail-specific integration — ESRF.net does not run on Gmail. Status flag: `minimal-notification-design-ready-not-enabled` until the activation checklist in [`apps-script-mail-notification.future.md`](./apps-script-mail-notification.future.md) is signed off. |

E-mail is **never** used as a substitute for the spreadsheet. **For the
first lab-write activation, mail notification is intentionally
DISABLED / PENDING.** The first-phase Apps Script webhook is
spreadsheet-only and contains no `MailApp` calls; its `NOTIFY_TO`
Script Property is **not** set (and is ignored by this script even
if left over from a previous attempt). The Cloudflare Pages Function
also leaves `INTAKE_NOTIFY_WEBHOOK` and `INTAKE_NOTIFY_TO` unset, so
the response carries `notification_status: "dry_run_not_configured"`
and exposes the would-be minimal payload for inspection. When the
deferred mail route is later activated (via
[`apps-script-mail-notification.future.md`](./apps-script-mail-notification.future.md)
or via an external mailrelay/webhook), it remains at most a minimal
operational ping that points back to the sheet/issue. The
Cloudflare Pages Function never sends mail directly.

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
- `functions/api/intake-test.test.mjs` — tests for the preview-only
  `/api/intake-test` route (see §6).
- `functions/_middleware.test.mjs` — independent middleware tests,
  including the `/api/intake-test` bot-filter bypass and the assertion
  that `/api/intake` is **not** bypassed.

Run with:

```
node functions/api/intake.test.mjs
node functions/api/intake-test.test.mjs
node functions/_middleware.test.mjs
```

---

## 6. Preview-only test route — `/api/intake-test`

**Status (2026-04-26):** *Preview test route ready. Still no production
activation.*

`/api/intake-test` exists so we can run **one** controlled lab-write
end-to-end against the authorised office@esrf.net Apps Script Web App
without re-opening `/api/intake` to general traffic. Production deploys
short-circuit to a 404 before any handler logic runs.

### Why a separate route

`functions/_middleware.js` blocks generic HTTP-client UAs (`curl/`,
`wget`, `python-requests`, `Go-http-client`, …) outside Europe and
returns a plain 403 *before* `/api/intake`'s handler runs. That is
correct for HTML pages but makes a single controlled `curl` POST from
an authorised operator infeasible. Rather than carving general holes
into `/api/intake`, we expose a strictly-gated test route that the
middleware bypass list permits — and the route itself is the gate.

### Guardrails

1. **Preview-only.** Production environment (`CF_PAGES_BRANCH=main` or
   unset) returns 404. Preview deploy must set `CF_PAGES_BRANCH` to a
   non-`main` branch or `ESRF_PREVIEW=true`.
2. **POST-only**, OPTIONS preflight, 405 for other verbs. In production
   even GET returns 404 — the route is not advertised.
3. **Required marker.** Body must include `lab_test === true` (boolean;
   string `"true"` is rejected).
4. **Required prefix.** `contact.organisation` AND `contact.name` must
   start with `ESRF Lab Test` (case-insensitive, prefix-only). Checked
   both pre- and post-sanitisation.
5. **Forces `meta.environment = 'TEST/VALIDATIE'`** with a defence-in-
   depth re-check after sanitisation.
6. **Live writes require BOTH** `INTAKE_SHEET_WEBHOOK_URL` and
   `SHEETS_WEBHOOK_SECRET`. Missing either flips the route to dry-run.
7. **Notification stays disabled.** This route deliberately does NOT
   read `INTAKE_NOTIFY_WEBHOOK` or `INTAKE_NOTIFY_TO`.
   `notification_status` is always `disabled_for_intake_test` and
   `notification_sent` is always `false`. A minimal preview message is
   built and `assertNotificationSafe`-checked, but no recipient is ever
   surfaced.
8. **LAB_* tabs only.** Same `assertLabPayloadSafe` guard as
   `/api/intake`; Directory_Master is forbidden by name and by tab-
   prefix re-check.
9. **Same input validation** as `/api/intake` — 64 KiB body cap, JSON
   shape, content-type, origin allowlist, per-mode required fields,
   ISO-3166 country, email shape, mandatory editorial + GDPR consents,
   HTML/control-char strip, length caps.
10. **Generic JSON errors only.** No upstream stack traces, no env-var
    names, no shared-secret reflection.

### Middleware bypass

`/api/intake-test` is on `BOT_FILTER_BYPASS_PATHS` in
`functions/_middleware.js`. `/api/intake` is **not** — production stays
fully covered by the bot rule. The bypass uses a strict
`path === prefix || path.startsWith(prefix + '/')` match so an
attacker-crafted path like `/api/intake-tester-evil` does not bypass.

### Single controlled POST — exact instruction

The next step is **one** POST from an authorised operator against the
Preview deploy. `INTAKE_SHEET_WEBHOOK_URL` and `SHEETS_WEBHOOK_SECRET`
are already configured in the Preview env per the activation context;
the route will run live (`dry_run: false`). Notification env vars must
remain unset.

```bash
curl -sS -X POST \
  'https://test-regional-editorial-cont.esrf-clean.pages.dev/api/intake-test' \
  -H 'content-type: application/json' \
  -H 'origin: https://test-regional-editorial-cont.esrf-clean.pages.dev' \
  --data-binary @- <<'JSON'
{
  "lab_test": true,
  "intake_mode": "org",
  "form_duration_ms": 9999,
  "contact": {
    "name": "ESRF Lab Test Operator",
    "organisation": "ESRF Lab Test Foundation",
    "role": "Lab Operator",
    "email": "lab-test@example.org",
    "country_code": "NL",
    "country_label": "Nederland",
    "place": "Rotterdam",
    "region": "Zuid-Holland",
    "website": "https://example.org"
  },
  "organisation_listing": {
    "sector": "gov",
    "sector_label": "Overheid",
    "city": "Rotterdam",
    "description": "Lab test row — single controlled probe."
  },
  "privacy": { "gdpr_privacy_policy": true }
}
JSON
```

Expected response in live mode:

- `status: 200`
- `ok: true`, `route: "/api/intake-test"`, `lab_test: true`
- `dry_run: false`, `sheet_dry_run: false`
- `sheet.row_id` populated by the Apps Script
- `notification_status: "disabled_for_intake_test"`,
  `notification_sent: false`
- One row appended to **`LAB_Intake_Submissions`** only
  (`Directory_Master` untouched).

If the Preview env is missing either secret the route stays in dry-run
and returns `dry_run: true` with the same shape — no upstream call
made, no rows written. In neither case does the route send any email.
