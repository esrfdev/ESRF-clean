// Lightweight Node test for redactie-validation.html.
//
// Runs without jsdom: parses the HTML as text + extracts the inline JS
// SAMPLE / buildExportPayload via Function() so we can test:
//
//   - noindex/nofollow meta on robots and googlebot
//   - safety copy ("Niet publiceren" / "Directory_Master niet aanpassen"
//     / "Preview pas na akkoord")
//   - sample records cover both record_type: 'org' and 'editorial'
//   - buildExportPayload excludes contact email by default and only
//     includes it when includeContact === true
//   - validation-lab.json manifest contains an entry with
//     id 'redactie-validation-form'
//
// Run with: node scripts/redactie_validation.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const htmlPath = path.join(repoRoot, 'redactie-validation.html');
const manifestPath = path.join(repoRoot, 'validation-lab.json');

const html = fs.readFileSync(htmlPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

// ── Static HTML checks ──────────────────────────────────────────────────
check('robots noindex,nofollow meta present', () => {
  assert.match(html, /<meta\s+name="robots"\s+content="noindex,nofollow"/i);
});
check('googlebot noindex,nofollow meta present', () => {
  assert.match(html, /<meta\s+name="googlebot"\s+content="noindex,nofollow"/i);
});
check('referrer no-referrer meta present', () => {
  assert.match(html, /<meta\s+name="referrer"\s+content="no-referrer"/i);
});
check('safety copy: Niet publiceren', () => {
  assert.ok(html.includes('Niet publiceren'), 'expected "Niet publiceren" in HTML');
});
check('safety copy: Directory_Master niet aanpassen', () => {
  assert.ok(html.includes('Directory_Master niet aanpassen'), 'expected Directory_Master safety copy');
});
check('safety copy: Preview pas na akkoord', () => {
  assert.ok(html.includes('Preview pas na akkoord'), 'expected "Preview pas na akkoord"');
});
check('stage-bar VALIDATIEOMGEVING + NIET PUBLIEK present', () => {
  assert.ok(html.includes('VALIDATIEOMGEVING'));
  assert.ok(html.includes('NIET PUBLIEK'));
});
check('no public sitemap link injection (no <a href="sitemap.xml")', () => {
  assert.ok(!/href="sitemap\.xml"/i.test(html), 'page should not link to sitemap.xml');
});
check('not linked from public footer (no foot-contribute / mailto:hello)', () => {
  // mirror request-listing-validation: this page does not render a public footer
  assert.ok(!/<footer\s+class="foot"/.test(html), 'redactie page should not include the public footer');
});

// ── Extract the inline JS bundle and exercise buildExportPayload + SAMPLE ─
function extractInlineScript(){
  // Grab the last <script> ... </script> in the file (the inline IIFE).
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m, last = null;
  while ((m = re.exec(html)) !== null) last = m[1];
  if (!last) throw new Error('no inline <script> block found');
  return last;
}

const inlineJs = extractInlineScript();

// We can't run the IIFE wholesale (it touches document/window). But we can
// shim a minimal window/document and run it in a sandboxed Function. The
// IIFE only touches window.__esrfRedactieReview at the relevant moment for
// our purposes (assigning the export hook); DOMContentLoaded never fires
// in this shim, so renderAll never runs.
function loadInlineHooks(){
  const sandboxWindow = {};
  const sandboxDocument = {
    addEventListener: () => {},
    getElementById: () => null,
    createElement: () => ({ appendChild: () => {}, setAttribute: () => {}, addEventListener: () => {} }),
    createTextNode: () => ({}),
  };
  const fn = new Function('window', 'document', 'navigator', inlineJs);
  fn(sandboxWindow, sandboxDocument, { clipboard: { writeText: () => {} } });
  if (!sandboxWindow.__esrfRedactieReview) {
    throw new Error('inline script did not expose window.__esrfRedactieReview');
  }
  return sandboxWindow.__esrfRedactieReview;
}

const hooks = loadInlineHooks();

check('SAMPLE has at least one org and one editorial record', () => {
  const types = hooks.SAMPLE.map(r => r.record_type);
  assert.ok(types.includes('org'), 'SAMPLE should include record_type=org');
  assert.ok(types.includes('editorial'), 'SAMPLE should include record_type=editorial');
});

check('SAMPLE records all carry submission_id, title, source_tab', () => {
  for (const r of hooks.SAMPLE) {
    assert.ok(r.submission_id, 'submission_id missing on ' + JSON.stringify(r));
    assert.ok(r.title, 'title missing on ' + r.submission_id);
    assert.ok(/^LAB_/.test(r.source_tab), 'source_tab must be LAB_* on ' + r.submission_id);
  }
});

check('buildExportPayload excludes contact by default', () => {
  const r = hooks.SAMPLE[0];
  const out = hooks.buildExportPayload(r, {
    process_step: 'in_review',
    review_status: 'in_review',
    reminder: 'r',
    next_required_action: 'n',
    assigned_to: 'redactie',
    due_date: '2026-05-03',
    review_notes_internal: 'note'
  }, /* includeContact */ false);
  assert.equal(out.contact_disclosed, false, 'contact_disclosed should be false by default');
  assert.equal(out.contact_internal, undefined, 'contact_internal should not be present');
  // Defence in depth: serialize and ensure no email leaked.
  const blob = JSON.stringify(out);
  assert.ok(!/@/.test(blob), 'export payload must not contain any email-shaped strings by default');
  assert.ok(!('raw_payload_json' in out), 'raw_payload_json must never be in export');
});

check('buildExportPayload includes contact only when explicitly toggled', () => {
  const r = hooks.SAMPLE[0];
  const out = hooks.buildExportPayload(r, {
    process_step: 'in_review',
    review_status: 'in_review',
    reminder: 'r',
    next_required_action: 'n',
    assigned_to: 'redactie',
    due_date: '2026-05-03',
    review_notes_internal: 'note'
  }, /* includeContact */ true);
  assert.equal(out.contact_disclosed, true);
  assert.ok(out.contact_internal, 'contact_internal should be present when toggled');
  assert.equal(out.contact_internal.email, r.contact.email);
});

check('buildExportPayload carries warning string and review_update shape', () => {
  const r = hooks.SAMPLE[1];
  const out = hooks.buildExportPayload(r, {
    process_step: 'klaar_voor_akkoord',
    review_status: 'approved_for_draft',
    reminder: '',
    next_required_action: '',
    assigned_to: 'redactie',
    due_date: '',
    review_notes_internal: ''
  }, false);
  assert.match(out.warning, /Directory_Master/);
  assert.equal(out.review_update.process_step, 'klaar_voor_akkoord');
  assert.equal(out.review_update.review_status, 'approved_for_draft');
  assert.equal(out.environment, 'TEST/VALIDATIE');
});

// ── validation-lab.json manifest check ───────────────────────────────────
check('validation-lab.json includes redactie-validation-form module', () => {
  const ids = (manifest.modules || []).map(m => m.id);
  assert.ok(ids.includes('redactie-validation-form'),
    'expected module id redactie-validation-form, got: ' + ids.join(', '));
  const mod = manifest.modules.find(m => m.id === 'redactie-validation-form');
  assert.equal(mod.path, '/redactie-validation.html');
  assert.equal(mod.visibility, 'hidden');
  assert.equal(mod.directoryMasterTouched, false);
  assert.equal(mod.automaticEmailEnabled, false);
  assert.ok(Array.isArray(mod.documentation) && mod.documentation.includes('/docs/redactie-validation-form.md'));
  assert.ok(Array.isArray(mod.exitCriteria) && mod.exitCriteria.length >= 3);
});

// ── docs file exists ─────────────────────────────────────────────────────
check('docs/redactie-validation-form.md exists', () => {
  const p = path.join(repoRoot, 'docs', 'redactie-validation-form.md');
  assert.ok(fs.existsSync(p), 'docs file missing');
  const md = fs.readFileSync(p, 'utf8');
  assert.match(md, /single source of truth/i);
  assert.match(md, /Directory_Master/);
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.log(failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('All checks passed.');
