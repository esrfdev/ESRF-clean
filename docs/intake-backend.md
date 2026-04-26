# Intake backend — `/api/intake`

Validation-environment backend for the integrated organisation + editorial
intake form (`submit-validation.html`). Runs on Cloudflare Pages Functions.

**Status (2026-04-26, end of day):** *Security review ready,
production blocked. First lab-write activation is **spreadsheet-only**
and remains active. **Automatic notifications are disabled.**

The Google Apps Script `MailApp` mailrelay route for automatic intake
notifications was tested on 2026-04-26 with operator probe submission
`sub_moftdrju_f8lk`, but **delivery to `office@esrf.net` was not
confirmed**. As a direct consequence the Cloudflare Pages **Preview**
env vars `INTAKE_NOTIFY_WEBHOOK` and `INTAKE_NOTIFY_TO` were
**removed / disabled** under rollback event
`evt_unconfirmed_google_mailrelay_disabled_20260426_1401`. The Google
Apps Script `MailApp` route is therefore **disabled / delivery-
unconfirmed** and **not a production route**.

Later the same day (2026-04-26, 14:21), an attempt to authorize an
**Outlook / Microsoft 365 connector** for `office@esrf.net` was
**rejected by the operator** because the consent screen demanded
**broad / full mailbox access** instead of a send-only scope.
Refusing this consent is the correct security decision — the channel
only needs `Mail.Send`. This rejection is recorded as decision event
`evt_outlook_broad_scope_rejected_20260426_1421`. **No Outlook
connector was authorized; no env vars were set; no test emails were
sent; production was not touched.**

The recommended next notification routes (minimal-rights only; none
currently enabled) are: (1) Microsoft Graph app registration with
send-only `Mail.Send` as `office@esrf.net`, (2) authenticated SMTP /
mailrelay with SPF/DKIM/DMARC alignment, or (3) the manual Sheet-based
notification fallback that is in effect today. Each must pass a
manually-delivered test under minimal-rights consent before any env
var is set. See
[`apps-script-mail-notification.future.md`](./apps-script-mail-notification.future.md)
and
[`intake-minimal-notification-design.md`](./intake-minimal-notification-design.md).*

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

E-mail is **never** used as a substitute for the spreadsheet. **Mail
notification is currently DISABLED (delivery-unconfirmed).** The
first-phase Apps Script webhook is spreadsheet-only and contains no
`MailApp` calls; its `NOTIFY_TO` Script Property is **not** set (and
is ignored by this script even if left over from a previous attempt).
The Cloudflare Pages Function leaves `INTAKE_NOTIFY_WEBHOOK` and
`INTAKE_NOTIFY_TO` unset on every environment, so the response
carries `notification_status: "dry_run_not_configured"` and exposes
the would-be minimal payload for inspection.

The Google Apps Script `MailApp` route described in
[`apps-script-mail-notification.future.md`](./apps-script-mail-notification.future.md)
was tested on 2026-04-26 (operator probe submission
`sub_moftdrju_f8lk`) but did not produce a confirmed delivery in the
`office@esrf.net` inbox; the Preview env vars were **removed /
disabled** under rollback event
`evt_unconfirmed_google_mailrelay_disabled_20260426_1401`. The Google
`MailApp` route is therefore **not** the route ESRF will ship to
production.

A follow-up attempt later on 2026-04-26 to authorize an **Outlook /
Microsoft 365 connector** for `office@esrf.net` was **rejected** at
the consent screen because Microsoft requested **broad / full
mailbox access** rather than a minimal `Mail.Send`-only scope. That
rejection — the correct security decision — is recorded as event
`evt_outlook_broad_scope_rejected_20260426_1421`. Automatic
notifications stay disabled.

The recommended next notification routes are **minimal-rights only**:
(a) a Microsoft Graph app registration with send-only `Mail.Send` for
`office@esrf.net` (no `Mail.Read` / `Mail.ReadWrite` /
`full_access_as_app`, mailbox-scoped via Exchange Online
`ApplicationAccessPolicy`), (b) authenticated SMTP / mailrelay with
SPF/DKIM/DMARC alignment, or (c) the manual Sheet-based notification
fallback that is in effect today. Each must pass a manually-delivered
test under minimal-rights consent before any Cloudflare Pages env var
is set. Even when one of those routes is wired up, it remains at most
a minimal operational ping that points back to the sheet/issue. The
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
| `INTAKE_NOTIFY_WEBHOOK` | Optional notify (currently **disabled / unset**) | ESRF mailrelay-/notificatie-webhook URL. Future value must point at a **minimal-rights** relay: Microsoft Graph app registration with send-only `Mail.Send` (no `Mail.Read` / `Mail.ReadWrite` / `full_access_as_app`), authenticated SMTP submission with SPF/DKIM/DMARC alignment, Pipedream, or an internal SMTP relay. Receives the minimal, PII-free notification payload only. **Not** Gmail. **Not** the Google Apps Script `MailApp` route — disabled on 2026-04-26 after delivery to `office@esrf.net` could not be confirmed (rollback event `evt_unconfirmed_google_mailrelay_disabled_20260426_1401`). **Not** an Outlook / Microsoft 365 connector that requests broad / full mailbox access — that consent shape was rejected on 2026-04-26 (decision event `evt_outlook_broad_scope_rejected_20260426_1421`). Currently unset on every Cloudflare Pages environment. |
| `INTAKE_NOTIFY_TO` | Optional recipient (currently **disabled / unset**) | Operational recipient address — documented default `office@esrf.net`. Forwarded as `notify_to_recipient` metadata so the relay knows where to deliver. The Cloudflare backend never sends mail itself. Currently unset; will only be re-set together with `INTAKE_NOTIFY_WEBHOOK` after an operator confirms a delivered test message via a minimal-rights route (send-only `Mail.Send` Graph app, or authenticated SMTP with SPF/DKIM/DMARC alignment). |

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

---

## 7. Change-, hide- en delete-verzoeken voor bestaande vermeldingen

Naast de drie publicatiemodi (`org`, `editorial`, `both`) accepteert
`/api/intake` twee LAB-only modi voor verzoeken op een **bestaande**
vermelding:

| Mode | Doel | Toegestane `requested_action` |
|---|---|---|
| `change_request` | Bijwerken, verbergen of verwijderen van een bestaande Directory- / Atlas-vermelding | `update`, `hide`, `delete` |
| `hide_delete` | Snelle route puur voor verbergen of verwijderen | `hide`, `delete` |

### Payload-velden

```jsonc
{
  "mode": "change_request",
  "change_request": {
    "target_listing_name": "Stichting Voorbeeld Noord",
    "target_listing_url": "https://esrf.net/directory/voorbeeld-noord",
    "requested_action": "update",
    "change_description": "Adres en sector kloppen niet meer. ...",
    "reason": "Organisatie is verhuisd en kerntaken zijn verschoven.",
    "evidence_url": "https://example.org/persbericht-verhuizing",
    "requester_authorization": "authorized_representative",
    "authorization_confirmation": "yes",
    "sub_mode": "change_request"
  },
  "contact": { "name": "...", "email": "...", "role": "..." },
  "privacy": { "gdpr_privacy_policy": true }
}
```

- `target_listing_name` **of** `target_listing_url` is verplicht; bij
  voorkeur beide.
- `requested_action` wordt geserver-zijdig gevalideerd tegen
  `VALID_CHANGE_ACTIONS`. In `hide_delete`-mode is alleen `hide` of
  `delete` toegestaan.
- `requester_authorization` is een enum (`authorized_representative`,
  `employee`, `external_observer`).
- `authorization_confirmation` moet `yes` / `true` zijn voordat de
  redactie het verzoek mag honoreren.
- `evidence_url` is optioneel maar wordt door de redactie sterk
  aangemoedigd voor `delete`-verzoeken.

### Routing & opslag

- **Canonieke rij** wordt geschreven naar
  `LAB_Change_Requests` (lab tab — niet aanwezig in productie-
  spreadsheets).
- Een **gekoppelde rij** in `LAB_Intake_Submissions` met
  `submission_type: "change_request:<action>"` en
  `linked_change_request_id: chg_*` zorgt dat de redactie alle
  inkomende verzoeken in één tijdslijn ziet.
- `Directory_Master` staat in `forbidden_targets`; `assertLabPayloadSafe`
  faalt elke poging om Directory_Master als doel-tab op te geven, ook
  via een knoeiende Apps Script.
- `directory_master_touched: 'no'` en `automatic_publication: 'no'`
  worden op de rij gezet.

### Notificatie

`buildNotificationMessage` herkent change-requests en stuurt een
minimale ping met `messageType: "change_request:<action>"`. De
referentie is de `target_listing_name` / `target_listing_url` — geen
contact-PII.

### Redactie-UI

`redactie-validation.html` toont change-requests met:

- Een eigen pil **Wijziging · bijwerken / verbergen / verwijderen**.
- Side-by-side panelen **Bestaand** vs **Gevraagd**.
- Autorisatie-status (rol + bevestiging).
- Evidence-link.
- Een redactiebesluit-formulier (akkoord / niet akkoord / verheldering
  nodig + toelichting). Het besluit wordt naar
  `LAB_Redactie_Reviews` + `LAB_Workflow_Events` geschreven; de
  toepassing van de wijziging gebeurt **handmatig** in een aparte
  stap.
- Veiligheidsbanner: *"Geen automatische wijziging · Directory_Master
  wordt niet aangeraakt · niets wordt gepubliceerd."*

### 7.b Apps Script-implementatie — uit te rollen

De code in `functions/api/*.js` produceert al een volledige
change-request payload. De Apps Script-laag moet in twee stappen
bijgewerkt worden voordat alle data zichtbaar is in de redactie-UI.

**Stap 1 — verplicht (zodat live LAB-rijen als wijzigingsverzoek
verschijnen):**

1. Voeg op het tabblad `LAB_Intake_Submissions` van het lab-spreadsheet
   (`1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g`) deze 11 kolommen
   toe aan de header-rij, achter de bestaande kolommen:
   `cr_sub_mode`, `cr_requested_action`, `cr_target_listing_name`,
   `cr_target_listing_url`, `cr_change_description`, `cr_reason`,
   `cr_evidence_url`, `cr_requester_authorization`,
   `cr_authorization_confirmation`, `cr_directory_master_touched`,
   `cr_automatic_publication`.
2. Redeploy `docs/apps-script-intake-webhook.gs` als Web App. De
   `HEADERS` array bevat de kolommen al (zie `// cr_* …` blok). Zonder
   redeploy worden de kolommen leeg geschreven.
3. Redeploy `docs/apps-script-redactie-review-webhook.gs` als Web App.
   `KNOWN_READ_HEADERS` en `projectRecord` projecteren rijen met
   `submission_type` beginnend met `change_request:` of `mode` gelijk
   aan `change_request` / `hide_delete` als `record_type:
   'change_request'`. Zonder redeploy blijft de UI op de Cloudflare-
   normalisatie leunen (werkt, maar mist `cr_*`-veldwaarden).

Tot Stap 1 is uitgerold blijft de Cloudflare `redactie-review.js`
normaliseren: rijen met `submission_type` = `change_request:*` worden
nog steeds als wijzigingsverzoek getoond, maar zonder de specifieke
CR-velden (deze komen uit `raw_payload_json` als die kolom aanwezig
is, of zijn leeg).

**Stap 2 — optioneel (toegewijd `LAB_Change_Requests`-tabblad):**

1. Maak een nieuw tabblad `LAB_Change_Requests` aan met de header-rij
   uit `buildChangeRequestRow` in `functions/api/intake.js`.
2. Voeg `LAB_Change_Requests` toe aan de `HEADERS`-map in
   `docs/apps-script-intake-webhook.gs` en redeploy.
3. Zet op de Cloudflare Pages **Preview**-omgeving de env-var
   `LAB_CHANGE_REQUESTS_ENABLED=true`. Pas dan begint
   `/api/intake` (en `/api/intake-test`) een aparte rij in
   `LAB_Change_Requests` te schrijven naast de gekoppelde rij in
   `LAB_Intake_Submissions`.

Zolang `LAB_CHANGE_REQUESTS_ENABLED` niet `true` is, blijft het
gedrag exact gelijk aan vandaag: één rij in `LAB_Intake_Submissions`
met `submission_type: change_request:<action>` plus de `cr_*`-kolommen
als data-anker voor de redactie-UI.
