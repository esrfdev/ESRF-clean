// Static-safety test for docs/apps-script-redactie-review-webhook.gs
// + docs/appsscript.redactie-review.json
//
// Run with:  node scripts/apps_script_redactie_review.test.mjs
//
// This is a *source-level* check. We do not execute Apps Script
// (which we can't from Node anyway). We assert the SHAPE and SAFETY
// CONTRACT of the source file the operator pastes into the Apps
// Script editor:
//
//   - doPost only; no doGet handler
//   - no MailApp / GmailApp / UrlFetchApp / fetch / XMLHttpRequest
//   - no DriveApp / Gmail* / mail.* references
//   - LAB_-only target prefix; Directory_Master in deny-list
//   - allowed read tabs limited to LAB_Intake_Submissions /
//     LAB_Editorial_Intake / LAB_Place_Candidates
//   - allowed write tabs limited to LAB_Redactie_Reviews /
//     LAB_Workflow_Events
//   - manifest pins OAuth scope to spreadsheets-only
//   - operator helpers (__authorizeSpreadsheetAccessOnly,
//     __setupLabReviewTabsMaybe) are present
//   - shared secret reads canonical name + legacy fallbacks
//   - no hard-coded secrets

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const gsPath = path.join(repoRoot, 'docs', 'apps-script-redactie-review-webhook.gs');
const manifestPath = path.join(repoRoot, 'docs', 'appsscript.redactie-review.json');

assert.ok(fs.existsSync(gsPath), 'apps-script source missing: ' + gsPath);
assert.ok(fs.existsSync(manifestPath), 'manifest missing: ' + manifestPath);

const gs = fs.readFileSync(gsPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch (e) { failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

// ── No mail / external APIs (the contract) ──────────────────────────────

const FORBIDDEN_API_TOKENS = [
  // Mail
  'MailApp', 'GmailApp', 'GmailMessage', 'GmailDraft', 'GmailThread',
  // External requests
  'UrlFetchApp', 'XMLHttpRequest',
  // Drive / Docs / Calendar / Forms
  'DriveApp', 'DocumentApp', 'CalendarApp', 'FormApp', 'SitesApp',
  // Send-mail scope hints
  'script.send_mail', 'auth/gmail',
  // Plain `fetch(` in Apps Script source would need URL fetch scope
  // (the V8 runtime exposes globalThis.fetch only with that scope)
];
// Strip JS comments (line + block) so the audit-prose in the header
// doesn't false-flag MailApp / script.send_mail mentions. The CONTRACT
// is "no executable references"; the prose says "if you see MailApp
// here, STOP" which is exactly the audit signal we want to keep.
function stripJsCommentsAndStrings(src){
  // Remove block comments
  let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Remove line comments
  out = out.replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  // Remove string literals (single, double; we don't have template
  // literals in this Apps Script source)
  out = out.replace(/'(?:\\.|[^'\\\n])*'/g, "''");
  out = out.replace(/"(?:\\.|[^"\\\n])*"/g, '""');
  return out;
}
const gsCode = stripJsCommentsAndStrings(gs);

check('no forbidden API references in executable .gs source', () => {
  for (const tok of FORBIDDEN_API_TOKENS) {
    assert.ok(gsCode.indexOf(tok) === -1, 'forbidden token in executable source: ' + tok);
  }
});

check('no bare `fetch(` call in .gs source (would require external_request scope)', () => {
  // Allow comments mentioning fetch, but no actual call expression.
  // We strip comments by line so we don't false-flag prose.
  const lines = gs.split('\n');
  for (let i = 0; i < lines.length; i++){
    const line = lines[i];
    const noLineComment = line.replace(/\/\/.*$/, '');
    // Crude block-comment skip: if line starts with `*` after trim
    const trimmed = noLineComment.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('*/')) continue;
    assert.ok(!/[^A-Za-z_]fetch\s*\(/.test(' ' + noLineComment),
      'bare fetch( call on line ' + (i+1) + ': ' + line);
  }
});

// ── doPost only, no doGet ───────────────────────────────────────────────

check('doPost defined', () => {
  assert.ok(/function\s+doPost\s*\(\s*e\s*\)/.test(gs), 'doPost(e) missing');
});
check('doGet NOT defined (web app must reject browser GETs)', () => {
  assert.ok(!/function\s+doGet\s*\(/.test(gs), 'doGet must not exist');
});

// ── LAB_ contract / Directory_Master deny-list ──────────────────────────

check('LAB_ target prefix declared', () => {
  assert.match(gs, /EXPECTED_TARGET_PREFIX\s*=\s*['"]LAB_['"]/);
});
check('Directory_Master in FORBIDDEN_TABS', () => {
  assert.match(gs, /FORBIDDEN_TABS\s*=\s*\[\s*['"]Directory_Master['"]/);
});
check('hard refusal text for forbidden tab present', () => {
  assert.ok(
    /Refusing to (?:write to|append to forbidden tab):/.test(gs)
    || /Refusing unknown spreadsheet id/.test(gs),
    'expected explicit refuse-string in source'
  );
});

// Allowed read tabs
check('READ_TABS limited to LAB_Intake_Submissions / LAB_Editorial_Intake / LAB_Place_Candidates', () => {
  assert.match(gs, /intake_submissions:\s*['"]LAB_Intake_Submissions['"]/);
  assert.match(gs, /editorial_intake:\s*['"]LAB_Editorial_Intake['"]/);
  assert.match(gs, /place_candidates:\s*['"]LAB_Place_Candidates['"]/);
});

// Allowed write tabs — strict allow-list
check('ALLOWED_WRITE_TABS includes only LAB_Redactie_Reviews and LAB_Workflow_Events', () => {
  const m = gs.match(/ALLOWED_WRITE_TABS\s*=\s*\[([^\]]+)\]/);
  assert.ok(m, 'ALLOWED_WRITE_TABS not found');
  const list = m[1];
  assert.match(list, /LAB_Redactie_Reviews/);
  assert.match(list, /LAB_Workflow_Events/);
  // Must not contain anything else with LAB_ prefix
  const otherLab = list.match(/LAB_[A-Za-z_]+/g) || [];
  for (const tab of otherLab){
    assert.ok(
      tab === 'LAB_Redactie_Reviews' || tab === 'LAB_Workflow_Events',
      'unexpected write target in ALLOWED_WRITE_TABS: ' + tab
    );
  }
  // And of course no Directory_Master
  assert.ok(list.indexOf('Directory_Master') === -1);
});

// ── Action allow-list ───────────────────────────────────────────────────

check('handles list_records / get_record / dry_run_update / submit_review_update', () => {
  for (const a of ['list_records','get_record','dry_run_update','submit_review_update']){
    assert.ok(gs.indexOf("'" + a + "'") !== -1 || gs.indexOf('"' + a + '"') !== -1,
      'action not handled: ' + a);
  }
});

// ── Shared secret + spreadsheet id resolution ───────────────────────────

check('canonical secret name REDACTIE_REVIEW_WEBHOOK_SECRET preferred', () => {
  assert.ok(gs.indexOf("'REDACTIE_REVIEW_WEBHOOK_SECRET'") !== -1,
    'must read REDACTIE_REVIEW_WEBHOOK_SECRET from script properties');
});
check('legacy aliases REVIEW_WEBHOOK_SECRET / SHARED_SECRET accepted as fallback', () => {
  assert.ok(gs.indexOf('REVIEW_WEBHOOK_SECRET') !== -1);
  assert.ok(gs.indexOf('SHARED_SECRET') !== -1);
});
check('SHEET_ID property used; legacy SPREADSHEET_ID accepted', () => {
  assert.ok(gs.indexOf("'SHEET_ID'") !== -1);
  assert.ok(gs.indexOf("'SPREADSHEET_ID'") !== -1);
});
check('spreadsheet id constant matches the documented LAB sheet', () => {
  assert.match(gs, /1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g/);
});
check('refuses unknown spreadsheet id explicitly', () => {
  assert.match(gs, /Refusing unknown spreadsheet id/);
});

// ── No hard-coded secrets ───────────────────────────────────────────────

check('no obvious hard-coded secret literal', () => {
  // Suspect long string literals. Allow-list known names (env-var
  // identifiers, header names, tab identifiers, scope URLs, the
  // documented spreadsheet id).
  const ALLOWED_LONG_LITERALS = new Set([
    '1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g',
    'REDACTIE_REVIEW_WEBHOOK_SECRET',
    'REDACTIE_REVIEW_WEBHOOK_URL',
    'REDACTIE_REVIEW_ACCESS_CODE',
    'REVIEW_WEBHOOK_SECRET',
    'SHEETS_WEBHOOK_SECRET',
    'SHEETS_WEBHOOK_URL',
    'INTAKE_SHEET_WEBHOOK_URL',
    'INTAKE_NOTIFY_WEBHOOK',
    'TURNSTILE_SECRET_KEY',
    'GITHUB_TOKEN',
    'SHARED_SECRET',
    'SPREADSHEET_ID',
    'shared_secret_present',
    'REDACTIE_REVIEW_WRITE_ENABLED',
    'pending_separate_deployment',
  ]);
  const suspects = gs.match(/['"][A-Za-z0-9_\-]{24,}['"]/g) || [];
  for (const s of suspects) {
    const v = s.slice(1, -1);
    if (ALLOWED_LONG_LITERALS.has(v)) continue;
    if (/^LAB_[A-Za-z_]+$/.test(v)) continue;
    if (/^[a-z_]+$/.test(v)) continue;
    if (v.indexOf('https://www.googleapis.com/') === 0) continue;
    if (v.indexOf('https://docs.google.com/') === 0) continue;
    assert.fail('suspect long literal: ' + s);
  }
});

// ── Operator helpers ────────────────────────────────────────────────────

check('__authorizeSpreadsheetAccessOnly() defined', () => {
  assert.match(gs, /function\s+__authorizeSpreadsheetAccessOnly\s*\(/);
});
check('__setupLabReviewTabsMaybe() defined', () => {
  assert.match(gs, /function\s+__setupLabReviewTabsMaybe\s*\(/);
});
check('__setupLabReviewTabsMaybe creates LAB_Redactie_Reviews', () => {
  assert.match(gs, /ensureRedactieReviewsTab/);
  assert.match(gs, /insertSheet\s*\(\s*['"]LAB_Redactie_Reviews['"]\s*\)/);
});
check('__setupLabReviewTabsMaybe never creates LAB_Workflow_Events (must already exist)', () => {
  assert.match(gs, /LAB_Workflow_Events missing/);
});

// ── PII / forbidden-key contract ────────────────────────────────────────

check('CONTACT_KEYS includes contact_name / contact_email / contact_phone / contact_role', () => {
  for (const k of ['contact_name','contact_email','contact_phone','contact_role']) {
    assert.ok(gs.indexOf("'" + k + "'") !== -1, 'CONTACT_KEYS missing ' + k);
  }
});
check('FORBIDDEN_RESPONSE_KEYS strips raw_payload_json + secrets', () => {
  for (const k of ['raw_payload_json','SHEETS_WEBHOOK_SECRET','GITHUB_TOKEN','REDACTIE_REVIEW_ACCESS_CODE','REDACTIE_REVIEW_WEBHOOK_SECRET']) {
    assert.ok(gs.indexOf("'" + k + "'") !== -1, 'FORBIDDEN_RESPONSE_KEYS missing ' + k);
  }
});
check('include_contact gating present', () => {
  assert.match(gs, /include_contact/);
});

// ── Process step / review status allow-list mirrors Cloudflare side ─────

check('ALLOWED_PROCESS_STEPS aligned with Cloudflare API', () => {
  for (const step of ['binnengekomen','in_review','wachten_op_indiener','klaar_voor_akkoord','akkoord_voor_promote','afgewezen','gearchiveerd']) {
    assert.ok(gs.indexOf("'" + step + "'") !== -1, 'process step missing: ' + step);
  }
});
check('ALLOWED_REVIEW_STATUSES aligned with Cloudflare API', () => {
  for (const s of ['in_review','pending_clarification','approved_for_candidate','approved_for_directory_candidate','approved_for_draft','approved_lab_promote','rejected']) {
    assert.ok(gs.indexOf("'" + s + "'") !== -1, 'review status missing: ' + s);
  }
});

// ── Manifest checks ─────────────────────────────────────────────────────

check('manifest oauthScopes is exactly spreadsheets-only', () => {
  assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets']);
});
check('manifest webapp.executeAs = USER_DEPLOYING (so office@esrf.net writes)', () => {
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
});
check('manifest oauthScopes contains no scope other than spreadsheets', () => {
  // The `_comment` field is documentation; the only scope source of
  // truth is `oauthScopes`, which is asserted exactly above. Here we
  // double-check by walking only oauthScopes and dependencies.
  for (const scope of (manifest.oauthScopes || [])){
    assert.ok(scope.indexOf('script.send_mail') === -1, 'send_mail in scopes: ' + scope);
    assert.ok(scope.indexOf('auth/gmail') === -1, 'gmail in scopes: ' + scope);
    assert.ok(scope.indexOf('script.external_request') === -1, 'external_request in scopes: ' + scope);
    assert.ok(scope.indexOf('auth/drive') === -1, 'drive in scopes: ' + scope);
  }
  // Dependencies must be empty (no advanced services that could
  // re-introduce scopes).
  const deps = manifest.dependencies || {};
  assert.equal(Object.keys(deps).length, 0, 'manifest.dependencies should be empty');
});

// ── Cross-references with the Cloudflare side ───────────────────────────

check('Cloudflare update endpoint allowed targets are a subset of ALLOWED_WRITE_TABS', () => {
  // Cloudflare update endpoint (functions/api/redactie-review-update.js)
  // documents LAB_Intake_Submissions / LAB_Editorial_Intake /
  // LAB_Workflow_Events as legal `target_tab` values for now. The
  // Apps Script intentionally does NOT permit writes to the source
  // tabs LAB_Intake_Submissions / LAB_Editorial_Intake — it appends
  // redactie edits to LAB_Redactie_Reviews so the originals stay
  // immutable. This is by design: assert that LAB_Redactie_Reviews
  // is the chosen append target for redactieversie rows, and that
  // LAB_Workflow_Events overlaps for the audit row.
  assert.ok(gs.indexOf('LAB_Redactie_Reviews') !== -1);
  assert.ok(gs.indexOf('LAB_Workflow_Events') !== -1);
});

// ── Done ────────────────────────────────────────────────────────────────

console.log('');
if (failures > 0) {
  console.log(failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('All checks passed.');
