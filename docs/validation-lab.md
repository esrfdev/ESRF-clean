# ESRF.net Validation Lab

A reusable hidden environment for validating new ESRF.net pages, forms and
features against the Cloudflare Pages branch preview before promoting them to
production (`main`).

The lab lives on the branch `test/regional-editorial-contributor-intake` and is
served via the preview URL
`https://test-regional-editorial-cont.esrf-clean.pages.dev`. Hub page:
`/validation-lab.html`. Manifest: `validation-lab.json`. Renderer:
`assets/js/validation-lab.js`.

## Goals

- Reuse the same hidden branch + preview for many small experiments instead of
  spawning a new branch for each.
- Keep production fully untouched while iterating.
- Make it obvious to any human visitor that the lab is internal-only.
- Make it easy to keep modules out of the public surface (sitemap, robots,
  navigation, footer, news data, editorials list, submit pages, index).

## Adding a new hidden test module

1. Create the module page at the repo root or a subpath, e.g.
   `experiment-foo-test.html`. Include in `<head>`:
   ```html
   <meta name="robots" content="noindex,nofollow" />
   <meta name="googlebot" content="noindex,nofollow" />
   ```
2. Add a visible `TEST/VALIDATIE` banner at the top of the page, identical in
   tone to the existing modules.
3. Register the module in `validation-lab.json` under `modules[]` with these
   fields:
   - `id` — short kebab-case identifier
   - `title` — human-readable
   - `status` — one of `planned`, `in-validation`, `ready-for-review`,
     `approved`, `archived`
   - `path` — absolute path of the module page
   - `owner` — team or person responsible
   - `purpose` — one-sentence reason this module exists
   - `lastUpdated` — ISO date (`YYYY-MM-DD`)
   - `visibility` — keep `hidden`
   - `exitCriteria` — array of statements that must be true before promotion
4. Validate locally with a static server (e.g. `python3 -m http.server`) and
   confirm:
   - The hub at `/validation-lab.html` lists the new module.
   - The module page is `noindex,nofollow`.
   - The module path is **not** present in `sitemap.xml`, `robots.txt`,
     `index.html`, `news-data.json`, `editorials.html`, `submit-news.html`,
     `submit-event.html`, navigation or footer of any public page.

## Rules (do not violate)

- **noindex/nofollow** on every module page, including thank-you and
  intermediate pages.
- **No public links.** Never link from public pages. The hub may link to
  modules, but the hub itself is unlinked from the public site.
- **No sitemap entry.** Do not add module URLs to `sitemap.xml`.
- **No robots allow/disallow entry.** Keep `robots.txt` untouched; the
  `noindex` meta is the primary defense and should not be undermined by
  publishing the URL via robots.
- **Test data only.** No sensitive or operational data may be entered during
  validation.
- **Branch-only commits.** Commit only to the test branch. Never merge to
  `main` without explicit reviewer approval on the draft PR.

## Promotion to production

When a module is ready, do **not** simply merge the test branch. Instead:

1. Mark the module `status: ready-for-review` and update `lastUpdated`.
2. Verify all exit criteria pass.
3. Open a separate PR that ports the module from the validation form to its
   final production home (real form action, real intake email/endpoint, public
   meta tags, sitemap entry, navigation/footer entry as appropriate).
4. The Validation Lab artefacts — `/validation-lab.html`,
   `validation-lab.json`, `/contribute-editorial-test.html`,
   `/contribution-test-thank-you.html`, `assets/js/validation-lab.js` and this
   doc — stay out of the production PR. They keep living on the test branch.

## Files

| File | Purpose |
| --- | --- |
| `validation-lab.html` | Hidden hub page listing all current modules. |
| `validation-lab.json` | Manifest of modules, rules, preview metadata. |
| `assets/js/validation-lab.js` | Static renderer used by the hub. |
| `docs/validation-lab.md` | This document. |
| `contribute-editorial-test.html` | Existing module: regional editorial intake. |
| `contribution-test-thank-you.html` | Existing thank-you page for that module. |

## LAB-opslagknop in submit-validation.html (preview-only)

Status: `available-on-preview` per 2026-04-26.

The integrated submit form (`submit-validation.html`) ships with an
extra **LAB-opslag** button in its preview/success step. It is the
deliberate operator path for triggering one controlled sheet-only write
against the LAB_* tabs without re-opening `/api/intake` to general
traffic. The button:

- is only rendered when `window.location.hostname` matches the
  preview hostname allowlist (`*.esrf-clean.pages.dev`, `localhost`,
  `127.0.0.1`, `0.0.0.0`);
- POSTs to `/api/intake-test` with the user's preview payload, plus
  the required `lab_test: true` marker and the `ESRF Lab Test` prefix
  injected into `contact.organisation` AND `contact.name` (the prefix
  is mandated by the route handler — see `functions/api/intake-test.js`);
- forces `meta.environment = TEST/VALIDATIE`, never sets a notification
  recipient, and logs the route used so the redactie can audit;
- displays a clearly-styled status block reporting whether a row was
  written, whether it was a dry-run, that no notification was sent,
  and that `Directory_Master` was not touched;
- on a production deploy (`CF_PAGES_BRANCH=main` or unset) the route
  itself returns 404; the hostname gate is the secondary defence so
  the button never even renders for production visitors.

The frontend payload-shape contract is covered by
`functions/api/submit-validation-payload.test.mjs`, which mirrors the
inline `buildLabBody` helper in plain JS, asserts every required
backend invariant (prefix, marker, environment, place enrichment,
editorial fields), and runs the result through the real
`/api/intake-test` handler in `org`, `editorial`, and `both` modes. A
drift detector in the same file fails if the inline helpers, the LAB
button or the editorial summary minimum-length guard are removed from
`submit-validation.html`.

## First successful redactie review live save — 2026-04-26 (22:24 CEST)

Later op 2026-04-26, rond 22:24 CEST, is de eerste end-to-end
**redactie review live-save** gelukt op de Cloudflare Pages
**Preview**. Productie bleef ongewijzigd.

- Preview-formulier:
  `https://test-regional-editorial-cont.esrf-clean.pages.dev/redactie-validation.html`
- Toegangscode gebruikt: `ESRF-Redactie-D86E91`.
- Cloudflare Pages env var `REDACTIE_REVIEW_WRITE_ENABLED=true` is
  uitsluitend op het **Preview**-project gezet — Productie is niet
  aangeraakt en de Cloudflare Pages Function geeft daar nog steeds 404.
- De pagina laadde **9 echte LAB-rijen** (`mode: "lab"`).
- Voor inzending `sub_lab_20260425_1825_sheet` is één review-save
  uitgevoerd. Backend-respons: `ok: true`, `mode: "lab"`,
  `dry_run: false`, `live_write_ready: true`, `save_status: "saved"`,
  `saved_to.review_tab: "LAB_Redactie_Reviews"`,
  `saved_to.events_tab: "LAB_Workflow_Events"`,
  `saved_to.review_id: "rev_20260426202343218_224302"`,
  `rows_written: 2`, `directory_master_touched: false`,
  `automatic_publication: false`.
- De UI toonde de groene banner
  **`OPGESLAGEN IN DE REDACTIETABEL`**. Bevestigd: originele inzending
  ongewijzigd, `Directory_Master` ongewijzigd, geen website-publicatie,
  geen e-mail.

Het bewijs is vastgelegd in `validation-lab.json` →
`redactie-validation-form` → `testEvidence.liveSaveEvidence`. De
volledige procedurele context staat in
[`redactie-validation-form.md`](./redactie-validation-form.md) onder
*"Eerste geslaagde live save — 2026-04-26 22:24 CEST"*.

## First successful LAB write — 2026-04-26

The first end-to-end controlled lab-write happened on 2026-04-26 via
`/api/intake-test` with submission id `sub-test_mofo28k4_ed8v`,
landing on row 3 of `LAB_Intake_Submissions`. `Directory_Master` was
not modified and no notification was dispatched. This evidence is
recorded under `validation-lab.json` →
`integrated-submit-with-editorial` → `testEvidence.labWriteEvidence`.

## Mailrelay rollback — 2026-04-26 (Google Apps Script MailApp route disabled)

Later on 2026-04-26 an operator probe (submission id
`sub_moftdrju_f8lk`) was sent through the Cloudflare Pages **Preview**
backend with `INTAKE_NOTIFY_WEBHOOK` temporarily pointed at a Google
Apps Script `MailApp` deployment, intended to deliver the minimal
notification payload to `office@esrf.net`. The Cloudflare backend
reported the call as dispatched, but **delivery to `office@esrf.net`
was not confirmed** in the inbox during the verification window.

Under rollback event
`evt_unconfirmed_google_mailrelay_disabled_20260426_1401` the
following actions were taken:

- `INTAKE_NOTIFY_WEBHOOK` and `INTAKE_NOTIFY_TO` were **removed /
  disabled** on the Cloudflare Pages **Preview** project. (Production
  was never set on this branch and is unchanged.)
- The Google Apps Script `MailApp` deployment is treated as inert —
  no Cloudflare env var points at it.
- Sheet intake (LAB_* tabs via the spreadsheet-only Apps Script)
  remains active and is unaffected; LAB_* rows continue to append on
  every successful submission. `Directory_Master` was not touched.
- The status flag in code (`MINIMAL_NOTIFICATION_DESIGN_STATUS`) stays
  `minimal-notification-design-ready-not-enabled`. The flag was never
  flipped to `enabled` because step 7 of the activation checklist —
  delivered email at `office@esrf.net` — was never reached.

The Google Apps Script `MailApp` route is therefore marked
**disabled / delivery-unconfirmed** and is **not** the route ESRF will
ship to production.

## Outlook connector rejected on broad scope — 2026-04-26 (event evt_outlook_broad_scope_rejected_20260426_1421)

Later the same day (2026-04-26, 14:21), an attempt to authorize an
**Outlook / Microsoft 365 connector** for `office@esrf.net` was
**rejected by the operator** at the Microsoft consent screen because
the connector requested **broad / full mailbox access** (read mail /
mailbox-wide permissions) instead of a minimal send-only scope. This
decision is recorded as event
`evt_outlook_broad_scope_rejected_20260426_1421`.

Refusing this consent is the **correct security decision**: the
operational notification channel only needs `Mail.Send`, and granting
full-mailbox access would let a relay compromise read the entire
`office@esrf.net` mailbox — submitter correspondence, foundation mail,
password-reset mails — none of which the relay needs. Refusing keeps
the blast radius bounded.

As a result of this decision:

- **No Outlook connector was authorized.** No tokens issued, no
  client secret stored anywhere (not in this repo, not in Cloudflare
  Pages env vars, not in `wrangler.toml`).
- `INTAKE_NOTIFY_WEBHOOK` and `INTAKE_NOTIFY_TO` remain
  **disabled / unset** on every Cloudflare Pages environment. They
  were already unset after `evt_unconfirmed_google_mailrelay_disabled_20260426_1401`
  earlier the same day.
- **No test emails were sent.** Production was not touched.
- Sheet intake (LAB_* tabs via the spreadsheet-only Apps Script)
  remains active. `Directory_Master` not touched.
- Status flag in code (`MINIMAL_NOTIFICATION_DESIGN_STATUS`) stays
  `minimal-notification-design-ready-not-enabled`. Automatic
  notifications stay disabled.

### Recommended next routes (minimal-rights only)

The next notification route must be one of the following **minimal-
rights** options. Each must pass a manually-delivered test message
under a confirmed minimal-rights consent scope before any Cloudflare
Pages env var is set:

1. **Microsoft Graph app registration with send-only `Mail.Send`** as
   `office@esrf.net`. Application permission: `Mail.Send` only — no
   `Mail.Read`, no `Mail.ReadWrite`, no `full_access_as_app`. Mailbox
   scope narrowed via Exchange Online `New-ApplicationAccessPolicy`
   to `office@esrf.net` only. If admin consent for `Mail.Send` cannot
   be granted in isolation, this route stays rejected.
2. **Authenticated SMTP submission / mailrelay** for `office@esrf.net`
   with **SPF, DKIM, and DMARC alignment** verified end-to-end before
   any env var is set.
3. **Manual Sheet-based notification** — the redactie monitors the
   LAB_* tabs directly in the Drive spreadsheet. This is the safe
   default and is in effect today.

Operators MUST NOT re-attempt the Outlook connector flow if it again
surfaces a broad / full-mailbox consent screen, and MUST NOT re-enable
the Google Apps Script `MailApp` route as a stop-gap. Until then the
notification env vars stay unset and `/api/intake` keeps reporting
`notification_status: "dry_run_not_configured"`. See
[`apps-script-mail-notification.future.md`](./apps-script-mail-notification.future.md)
and
[`intake-minimal-notification-design.md`](./intake-minimal-notification-design.md)
for the full rollback / decision records and the minimal-rights route
descriptions.

## Sheet-monitoring decision — 2026-04-26, 14:46 UTC (route 3 selected as active operational mode)

Decision event id: `evt_sheet_monitoring_selected_20260426_1446`.

For the current lab phase the redactie notifications are handled by
**periodic Sheet monitoring** of the existing Drive spreadsheet — not
by automatic email. The user explicitly confirmed this is acceptable
as the operational mode.

- **Operational queue (watch these tabs):** `LAB_Intake_Submissions`,
  `LAB_Editorial_Intake`, `LAB_Workflow_Events`.
- **Procedure:** documented in the `LAB_Instructions` tab of the same
  spreadsheet (cadence, who-watches-which-tab, how to acknowledge a
  row). `LAB_Instructions` is a procedure tab read by humans; the
  `/api/intake` backend never writes to it.
- **Automatic email:** disabled. `INTAKE_NOTIFY_WEBHOOK` and
  `INTAKE_NOTIFY_TO` remain unset on every Cloudflare Pages
  environment; `/api/intake` keeps reporting
  `notification_status: "dry_run_not_configured"`;
  `MINIMAL_NOTIFICATION_DESIGN_STATUS` stays
  `minimal-notification-design-ready-not-enabled`.
- **Re-enabling automatic email:** requires a minimal-rights Microsoft
  365 Graph send-only `Mail.Send` route — or equivalent authenticated
  SMTP / mailrelay with SPF/DKIM/DMARC alignment — approved AND
  passing a manually-delivered test under minimal-rights consent
  before any env var is set. The Google Apps Script `MailApp` route
  stays rejected; the broad-scope Outlook connector route stays
  rejected.
- **What did NOT happen:** no env vars were enabled, no mail was
  sent, production was not touched, `Directory_Master` was not
  touched, and `main` was not merged.

This implements route (3) "Manual Sheet-based notification" from the
canonical "Recommended next routes" list above as the active
operational mode for this lab phase. Full record in
[`intake-minimal-notification-design.md`](./intake-minimal-notification-design.md).

## Why a hub instead of one-off test branches

- A single hidden branch + preview URL avoids the cost of cutting fresh
  branches for every micro-experiment.
- The manifest gives every reviewer a single place to see what is currently
  under validation, who owns it, and what "done" looks like.
- The hub plus banners make it loud and obvious to any unintended visitor that
  they are not on the production site.
