# Lab-only controlled promotion workflow

> **Branch:** `test/regional-editorial-contributor-intake` only.
> **Never** runs on `main`. **Never** writes `Directory_Master`.
> **Never** sends notifications. **Never** publishes to the live site.

This document describes the controlled, lab-only path from a redactie-
approved row in the LAB_* tabs of the intake spreadsheet (id
`1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g`) to a reviewable change in
this repository's `editorials/drafts/lab/` or `data/candidates/` folders,
then through GitHub branch/preview, and only after explicit human
approval into `main` and live.

The Sheet remains the single source of truth. The promotion scripts are
read-only against the Sheet (offline JSON exports today; a Sheet
connector path is documented but not enabled). The scripts only write
into staging files inside this repo.

## End-to-end flow

```
   ┌──────────────────────────┐
   │ Public form              │  submit-validation.html
   │ /submit-validation.html  │  (lab/preview only — never production)
   └────────────┬─────────────┘
                │ POST /api/intake-test
                ▼
   ┌──────────────────────────┐
   │ LAB_* tabs in Drive      │  LAB_Intake_Submissions
   │ Sheet (single SoT)       │  LAB_Editorial_Intake
   │                          │  LAB_Place_Candidates
   │                          │  LAB_Backend_Log
   │                          │  LAB_Workflow_Events
   └────────────┬─────────────┘
                │ redactie reviews & sets review_status,
                │ assigned_to, review_notes_internal
                ▼
   ┌──────────────────────────┐
   │ Approved row             │  review_status ∈
   │ (redaction complete)     │    {approved_for_candidate,
   │                          │     approved_for_directory_candidate,
   │                          │     approved_for_draft,
   │                          │     approved_for_editorial_draft,
   │                          │     approved_lab_promote}
   └────────────┬─────────────┘
                │ operator exports approved row(s) to JSON
                │ and runs scripts/lab_promote/cli.py
                ▼
   ┌──────────────────────────┐
   │ Local artefact            │  editorials/drafts/lab/<slug>.md
   │ (lab-only)                │  OR data/candidates/directory-candidates.lab.json
   └────────────┬─────────────┘
                │ commit on test/regional-editorial-contributor-intake
                │ open / refresh draft PR -> Cloudflare branch preview
                ▼
   ┌──────────────────────────┐
   │ Human approval            │  redactie + maintainer review preview,
   │ on draft PR               │  approve PR, merge to main
   └────────────┬─────────────┘
                ▼
   ┌──────────────────────────┐
   │ main / live              │  existing publish_editorial.py / atlas
   │                          │  pipelines run on main, NOT here
   └──────────────────────────┘
```

The promotion scripts only ever produce artefacts on the lab branch. No
step in this package merges to main, edits Directory_Master, or sends
email. Every guard refuses by default.

## Guards (all must pass — see `scripts/lab_promote/guards.py`)

| Guard | Refuses unless |
|---|---|
| `assert_lab_environment` | `ESRF_LAB_PROMOTE=1` is set in the env. |
| `assert_not_main_branch` | Current git branch (or `ESRF_BRANCH` override) is not `main` / `master` / `production` / `prod`. |
| `assert_source_tab_allowed` | Source tab is one of `LAB_Intake_Submissions`, `LAB_Editorial_Intake`, `LAB_Place_Candidates`. |
| `assert_target_tab_allowed` | Target name is not `Directory_Master` (case-insensitive substring match). |
| `assert_intake_row_approved` | `review_status` ∈ approved set, and `assigned_to` + `review_notes_internal` are non-empty. |
| `assert_editorial_row_approved` | `editorial_status` ∈ approved set, and `review_notes_internal` is non-empty. |
| `assert_no_pii_in_output` | Output dict does not contain `contact_email`, `contact_phone`, `email`, `phone`, `raw_payload_json`, `shared_secret`. |

PII fields (`contact_name`, `contact_role`, `contact_email`,
`contact_phone`, `notes_submitter`, `raw_payload_json`) are stripped
from every public preview artefact via
`PUBLIC_PII_STRIPPED_FIELDS` in `scripts/lab_promote/transforms.py`.

## CLI

Both commands are dry-run-friendly and operate on offline JSON exports
of approved rows.

```bash
export ESRF_LAB_PROMOTE=1
# Optional — ESRF_BRANCH overrides git branch detection (CI / sandbox).
export ESRF_BRANCH=test/regional-editorial-contributor-intake

# Editorial: LAB_Editorial_Intake rows -> editorials/drafts/lab/<slug>.md
python3 -m scripts.lab_promote.cli editorial \
    scripts/lab_promote/fixtures/editorial_approved.json --dry-run

# Directory / atlas: LAB_Intake_Submissions / LAB_Place_Candidates rows
# -> data/candidates/directory-candidates.lab.json
python3 -m scripts.lab_promote.cli directory \
    scripts/lab_promote/fixtures/intake_approved.json --dry-run

# Drop --dry-run to actually write files.
```

The directory candidate file (`data/candidates/directory-candidates.lab.json`)
is a *staging* file. It carries `auto_promote_to_directory_master: false`
and is never read by the production runtime. Promotion to Directory_Master
is a separate, manual PR that ports the approved candidate fields into
the production data.

## What the scripts will NOT do

* Write `Directory_Master` (refused at multiple layers).
* Run on `main` / `master` / `production` (refused).
* Trigger automatic translations or i18n keys (the editorial draft is
  emitted with `auto_i18n: false` and `auto_publish: false`).
* Send email or any notification.
* Touch production HTML, `news-data.json`, `sitemap.xml`, or
  `companies_extracted.json`.
* Read the live Sheet automatically. Today the operator exports the
  approved rows to JSON; a Sheet connector route can be added later
  but only against the `LAB_*` tabs and only behind the same guards.

## Tests

```
python3 -m unittest scripts.lab_promote.tests.test_lab_promote -v
```

Covers: lab-flag guard, branch guard, Directory_Master refusal (target
and case-equivalents), unknown source-tab refusal, approved-status
gate, missing-review-fields refusal, PII-stripping, editorial markdown
front-matter (`status: lab-draft`, `auto_i18n: false`, `auto_publish:
false`, `preview_only: true`), filename slug safety (no `..` / `/`),
candidate de-duplication on `submission_id`, place-candidate transform,
and CLI integration paths (happy path, unapproved-row refusal,
main-branch refusal, missing-flag refusal). 26 tests, all pure-Python,
no live Sheet calls, no network.

## Manual test procedure — one approved Sheet row → preview candidate

1. **Pick one approved row** in `LAB_Editorial_Intake` (or
   `LAB_Intake_Submissions`) with `editorial_status` /
   `review_status` set to one of the approved values, with
   `review_notes_internal` filled in by the redactie, and with all
   PII columns left as the spreadsheet provides them (the script
   will strip them).
2. **Export that single row** to a JSON file shaped exactly like
   `scripts/lab_promote/fixtures/editorial_approved.json` (a JSON
   list with one dict whose keys match the LAB_* column headers).
   Save it as e.g. `/tmp/lab_one_row.json`.
3. **Confirm you are on the lab branch**:
   `git rev-parse --abbrev-ref HEAD` should print
   `test/regional-editorial-contributor-intake`.
4. **Run dry-run**:
   ```
   ESRF_LAB_PROMOTE=1 python3 -m scripts.lab_promote.cli editorial \
       /tmp/lab_one_row.json --dry-run
   ```
   Expected output: `[dry-run] would write …/editorials/drafts/lab/lab-<date>-<slug>.md`.
5. **Run for real** (no `--dry-run`). Open the produced `.md` file
   and verify:
   - YAML front-matter contains `status: lab-draft`, `auto_i18n: false`,
     `auto_publish: false`, `preview_only: true`.
   - No `contact_email` / `contact_name` / `contact_phone` field is
     present.
   - The body has `## Samenvatting`, `## Regionale invalshoek`, and
     `## Lab metadata` sections.
6. **Commit** the new draft (only the new file under
   `editorials/drafts/lab/`). Do not touch any other file in the
   same commit.
7. **Push** to `origin/test/regional-editorial-contributor-intake`.
   Cloudflare Pages builds a branch preview. Production is not
   touched.
8. **Open or refresh the draft PR** for the lab branch. Redactie
   reviews the preview. Only after PR approval does anyone consider
   merging anything to `main`.

For directory candidates the procedure is identical with
`directory` instead of `editorial`; the artefact lands in
`data/candidates/directory-candidates.lab.json`. `Directory_Master`
is never modified by this process.
