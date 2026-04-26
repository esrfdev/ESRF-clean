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

## First successful LAB write — 2026-04-26

The first end-to-end controlled lab-write happened on 2026-04-26 via
`/api/intake-test` with submission id `sub-test_mofo28k4_ed8v`,
landing on row 3 of `LAB_Intake_Submissions`. `Directory_Master` was
not modified and no notification was dispatched. This evidence is
recorded under `validation-lab.json` →
`integrated-submit-with-editorial` → `testEvidence.labWriteEvidence`.

## Why a hub instead of one-off test branches

- A single hidden branch + preview URL avoids the cost of cutting fresh
  branches for every micro-experiment.
- The manifest gives every reviewer a single place to see what is currently
  under validation, who owns it, and what "done" looks like.
- The hub plus banners make it loud and obvious to any unintended visitor that
  they are not on the production site.
