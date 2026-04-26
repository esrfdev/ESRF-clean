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

// ── Edit-mode checks ─────────────────────────────────────────────────────
check('edit-mode UI heading present (Redactieversie / Publicatievoorstel)', () => {
  assert.ok(html.includes('Redactieversie / Publicatievoorstel'),
    'expected the edit-mode section heading in the HTML');
});

check('edit-mode warning copy present (publicatievoorstel + audit + geen automatische live publicatie)', () => {
  assert.match(html, /publicatievoorstel/i);
  assert.match(html, /originele inzending blijft/i);
  assert.match(html, /[Gg]een automatische live publicatie/);
});

check('original section labelled as read-only / bron / audit', () => {
  assert.ok(html.includes('Originele inzending'), 'expected "Originele inzending" label');
  assert.ok(/BRON · NIET BEWERKBAAR · BEWAARD VOOR AUDIT/.test(html),
    'expected the explicit read-only/audit marker');
});

check('all required editable field keys exist in EDIT_FIELDS', () => {
  const keys = (hooks.EDIT_FIELDS || []).map(f => f.key);
  for (const required of [
    'edited_title',
    'edited_organization',
    'edited_summary',
    'edited_region',
    'edited_sector_or_tags',
    'edited_public_body',
    'editorial_note',
    'change_note',
    'edited_by'
  ]) {
    assert.ok(keys.includes(required), 'missing edit field key: ' + required);
  }
});

check('all editable fields carry a Dutch label', () => {
  for (const f of hooks.EDIT_FIELDS || []) {
    assert.ok(typeof f.label === 'string' && f.label.length > 0,
      'edit field ' + f.key + ' missing label');
  }
});

check('export carries original_reference snapshot of submitted source', () => {
  const r = hooks.SAMPLE.find(x => x.record_type === 'editorial');
  const out = hooks.buildExportPayload(r, {
    process_step: 'in_review', review_status: 'in_review',
    reminder: '', next_required_action: '', assigned_to: '',
    due_date: '', review_notes_internal: ''
  }, false, null);
  assert.ok(out.original_reference, 'original_reference must be present');
  assert.equal(out.original_reference.submission_id, r.submission_id);
  assert.equal(out.original_reference.title, r.title);
  assert.equal(out.original_reference.summary, r.summary);
  assert.equal(out.original_reference.source_tab, r.source_tab);
});

check('export carries edited_publication_proposal that mirrors original when no edits made', () => {
  const r = hooks.SAMPLE.find(x => x.record_type === 'editorial');
  const out = hooks.buildExportPayload(r, {
    process_step: 'in_review', review_status: 'in_review',
    reminder: '', next_required_action: '', assigned_to: '',
    due_date: '', review_notes_internal: ''
  }, false, null);
  assert.ok(out.edited_publication_proposal, 'edited_publication_proposal must be present');
  assert.equal(out.edited_publication_proposal.edited_title, r.title);
  assert.equal(out.edited_publication_proposal.edited_summary, r.summary);
  assert.deepEqual(out.changed_fields, [],
    'with no edits, changed_fields should be an empty array');
  assert.equal(out.edited_at, '', 'edited_at should be empty when no fields changed');
});

check('export reports changed_fields, change_note, edited_by and edited_at when edits applied', () => {
  const r = hooks.SAMPLE.find(x => x.record_type === 'editorial');
  const edits = {
    edited_title: r.title + ' (redactieversie)',
    edited_summary: 'Door redactie aangepaste samenvatting voor publicatie.',
    edited_region: r.region,
    editorial_note: 'Redactie heeft toon en feiten gecontroleerd.',
    change_note: 'Titel verkort en feitelijke claim verwijderd.',
    edited_by: 'AB'
  };
  const out = hooks.buildExportPayload(r, {
    process_step: 'klaar_voor_akkoord', review_status: 'approved_for_draft',
    reminder: '', next_required_action: '', assigned_to: 'redactie',
    due_date: '', review_notes_internal: ''
  }, false, edits);

  assert.notEqual(out.edited_publication_proposal.edited_title, r.title,
    'edited_title should reflect the edit');
  assert.equal(out.edited_publication_proposal.edited_summary,
    'Door redactie aangepaste samenvatting voor publicatie.');
  assert.equal(out.change_note, 'Titel verkort en feitelijke claim verwijderd.');
  assert.equal(out.edited_by, 'AB');
  assert.ok(out.changed_fields.length >= 2,
    'changed_fields should include the modified keys, got: ' + JSON.stringify(out.changed_fields));
  assert.ok(out.changed_fields.includes('edited_title'));
  assert.ok(out.changed_fields.includes('edited_summary'));
  assert.ok(out.changed_fields.includes('change_note'));
  assert.ok(out.changed_fields.includes('edited_by'));
  assert.match(out.edited_at, /^\d{4}-\d{2}-\d{2}T/, 'edited_at must be an ISO timestamp when edits exist');

  // Original reference must still reflect the submitted source — never the edits.
  assert.equal(out.original_reference.title, r.title,
    'original_reference must preserve the original title even after edits');
  assert.equal(out.original_reference.summary, r.summary,
    'original_reference must preserve the original summary even after edits');
});

check('export still excludes contact email by default when edits are applied', () => {
  const r = hooks.SAMPLE.find(x => x.record_type === 'editorial');
  const edits = { edited_title: 'iets nieuws', edited_by: 'AB', change_note: 'omdat' };
  const out = hooks.buildExportPayload(r, {
    process_step: 'in_review', review_status: 'in_review',
    reminder: '', next_required_action: '', assigned_to: '',
    due_date: '', review_notes_internal: ''
  }, /* includeContact */ false, edits);
  assert.equal(out.contact_disclosed, false);
  assert.equal(out.contact_internal, undefined);
  // Defence in depth: serialise everything and ensure no email-shaped string slipped in.
  const blob = JSON.stringify(out);
  assert.ok(!/@/.test(blob),
    'export payload must not contain any email-shaped string by default, even with edits');
});

check('export warning string mentions publicatievoorstel + original_reference + Directory_Master + no auto-publish', () => {
  const r = hooks.SAMPLE[0];
  const out = hooks.buildExportPayload(r, {
    process_step: 'in_review', review_status: 'in_review',
    reminder: '', next_required_action: '', assigned_to: '',
    due_date: '', review_notes_internal: ''
  }, false, null);
  assert.match(out.warning, /publicatievoorstel/i,
    'warning should describe edits as a publicatievoorstel');
  assert.match(out.warning, /original_reference/,
    'warning should reference original_reference');
  assert.match(out.warning, /Directory_Master/,
    'warning must keep the Directory_Master refusal copy');
  assert.match(out.warning, /auto-publicatie/i,
    'warning must rule out automatic publication');
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

// ── Access panel + LAB-mode wiring ───────────────────────────────────────
check('access panel renders with SAMPLE-MODE pill and LAB-toegang heading', () => {
  assert.ok(html.includes('LAB-toegang'), 'expected "LAB-toegang" heading');
  assert.ok(html.includes('SAMPLE-MODE'), 'expected SAMPLE-MODE pill');
  assert.ok(html.includes('rv-access'), 'expected access panel container');
});

check('access panel input is a password field (no autocomplete)', () => {
  assert.match(html, /id="rv-access-code"[^>]*type="password"/i,
    'expected access code input type=password');
  assert.match(html, /autocomplete="off"/i, 'expected autocomplete off');
});

check('no localStorage / sessionStorage / document.cookie code calls on the page', () => {
  // Allow mentions in copy/comments (the page explicitly tells the
  // operator that no localStorage/cookie is used). Disallow actual
  // method calls or property writes.
  const methodCalls = [
    /localStorage\.(?:setItem|getItem|removeItem|clear|key)/,
    /sessionStorage\.(?:setItem|getItem|removeItem|clear|key)/,
    /window\.localStorage/,
    /window\.sessionStorage/,
    /document\.cookie\s*=/,
  ];
  for (const re of methodCalls){
    assert.ok(!re.test(html), 'redactie page must not call ' + re);
  }
});

check('frontend posts to /api/redactie-review (server-validated access code)', () => {
  assert.ok(html.includes('/api/redactie-review'),
    'expected the page to reference /api/redactie-review');
  assert.match(html, /access_code/, 'expected access_code field name in fetch body');
});

check('hooks expose STATUS_STEP_REMINDERS map covering all process steps', () => {
  const map = hooks.STATUS_STEP_REMINDERS;
  assert.ok(map && typeof map === 'object');
  for (const k of ['binnengekomen','in_review','wachten_op_indiener','klaar_voor_akkoord','akkoord_voor_promote','afgewezen','gearchiveerd']){
    assert.ok(typeof map[k] === 'string' && map[k].length > 0,
      'missing reminder for step: ' + k);
  }
});

check('stepReminderFor returns a reminder for a known step and empty for unknown', () => {
  assert.ok(hooks.stepReminderFor('in_review').length > 0);
  assert.equal(hooks.stepReminderFor('zzz_nonexistent_step'), '');
});

check('access panel warning copy: LAB only, geen automatische publicatie, Directory_Master niet aanpassen', () => {
  assert.ok(html.includes('geen automatische publicatie'), 'expected access copy: geen automatische publicatie');
  assert.ok(html.includes('Directory_Master niet aanpassen'));
});

check('contact still hidden by default — page emits "VERBORGEN" mark by default', () => {
  // The contact section starts hidden until the operator toggles it on.
  // We just check the markup constants are present.
  assert.ok(html.includes('VERBORGEN'), 'expected VERBORGEN contact mark');
  assert.ok(html.includes('rv-show-contact'), 'expected rv-show-contact toggle id');
});

// ── New role-based UX checks (2026-04-26) ───────────────────────────────
check('numbered redaction workflow panel is visible (5 steps, plain Dutch)', () => {
  assert.match(html, /rv-workflow/, 'expected rv-workflow panel container');
  assert.match(html, /Ontvangen/);
  assert.match(html, /In redactie/);
  assert.match(html, /Controle nodig/);
  assert.match(html, /Goedgekeurd voor concept/);
  assert.match(html, /Afgewezen \/ geparkeerd/);
});

check('primary action label is role-based, mode-aware (sample + lab variants)', () => {
  // Sample-mode primary label MUST be explicit that nothing is saved.
  assert.ok(html.includes('Maak testvoorbeeld — niets wordt opgeslagen'),
    'expected sample-mode primary label');
  // LAB-mode primary label: review-before-save, not a technical export label.
  assert.ok(html.includes('Bekijk redactiebeoordeling vóór opslaan'),
    'expected lab-mode primary label');
});

check('"Wat gebeurt er na deze knop?" instruction block is present', () => {
  assert.ok(html.includes('Wat gebeurt er na deze knop?'),
    'expected the explicit instruction heading next to the primary action');
  assert.ok(html.includes('Wat er wel gebeurt'));
  assert.ok(html.includes('Wat er níet gebeurt'));
  assert.ok(html.includes('Wat jij hierna doet'));
});

check('technical export actions live inside a collapsed <details> block', () => {
  // The technical export block is built dynamically via el('details', ...).
  // We assert the constructor + its label/class, plus the role-based labels
  // for the buttons inside it.
  assert.match(html, /el\(\s*['"]details['"][^)]*rv-tech/,
    'expected runtime construction of <details class="rv-tech">');
  assert.ok(html.includes('Technische export voor beheer'),
    'expected technical-export details summary in plain Dutch');
  assert.ok(html.includes('Alleen gebruiken als beheer hierom vraagt'),
    'expected explicit "Alleen gebruiken als beheer hierom vraagt" hint');
  // Role-based labels for the technical buttons (no longer at the top
  // level — only inside the collapsed details block).
  assert.ok(html.includes('Kopieer technische audit-export'));
  assert.ok(html.includes('Download auditbestand (JSON)'));
  assert.ok(html.includes('Kopieer tekstsamenvatting voor beheer'));
});

check('old ambiguous primary labels are NOT used as primary actions anymore', () => {
  // These labels were ambiguous to non-technical editors. They must not
  // appear as the primary, top-level action button text. They may still
  // appear inside the technical <details> block for beheer, but never as
  // a primary button. We therefore look for the original ambiguous
  // primary-button markup that USED to exist.
  assert.ok(!/class="rv-btn rv-btn-primary"[^>]*id="rv-export-json"/.test(html),
    'old "Genereer review-update (JSON)" primary button must be removed');
  // Also assert the literal old primary label string no longer occurs as
  // a plain button label. (It can still be referenced in docs / comments.)
  // Keep this lenient: just check the button id is gone.
  assert.ok(!html.includes('id="rv-export-text"'),
    'old "Genereer tekst-samenvatting" button id must be removed');
  assert.ok(!html.includes('id="rv-copy"'),
    'old generic "Kopieer naar klembord" button id must be removed (folded into role-based actions)');
});

check('explicit edit-field warnings are present when bewerken is on', () => {
  assert.ok(html.includes('Wijzig hier alleen de redactieversie, niet de originele inzending.'),
    'expected edit-mode warning: change only the redactieversie');
  assert.ok(html.includes('Gebruik geen persoonlijke contactgegevens in publicatietekst.'),
    'expected edit-mode warning: no personal contact details in publication text');
});

check('primary action area carries a mode-aware status note', () => {
  assert.ok(html.includes('TESTVOORBEELD · niets wordt opgeslagen'),
    'expected sample-mode primary status note');
  assert.ok(html.includes('LAB-MODE · echte rij, nog steeds geen automatische opslag'),
    'expected lab-mode primary status note');
});

// ── docs file exists ─────────────────────────────────────────────────────
check('docs/redactie-validation-form.md exists', () => {
  const p = path.join(repoRoot, 'docs', 'redactie-validation-form.md');
  assert.ok(fs.existsSync(p), 'docs file missing');
  const md = fs.readFileSync(p, 'utf8');
  assert.match(md, /single source of truth/i);
  assert.match(md, /Directory_Master/);
  // New activation/architecture sections
  assert.match(md, /REDACTIE_REVIEW_ACCESS_CODE/);
  assert.match(md, /\/api\/redactie-review/);
  assert.match(md, /dry-run/i);
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.log(failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('All checks passed.');
