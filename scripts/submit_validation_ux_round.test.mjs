// Tests for the small UX round on submit-validation.html on
// branch test/regional-editorial-contributor-intake (2026-04-27).
//
// Covers:
//   1. Each mode-option in the .mode-switch carries a short plain-language
//      tagline (em.mode-tagline) matching the agreed copy.
//   2. The top-of-form review notice (#sv-editorial-review-notice) is present
//      and tells the visitor the redactie checks each submission and that
//      nothing is published automatically.
//   3. None of the mode selection buttons inside .mode-switch contain a
//      "Nieuw" pill (the round explicitly does not bring those back).
//   4. Dynamic required-field handling for the organisation field:
//        - the static markup keeps required + visible "*" by default
//        - the inline JS togglet required + req-indicator off voor de
//          change_request/hide_delete modi.
//
// Run with: node scripts/submit_validation_ux_round.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const html = fs.readFileSync(path.join(repoRoot, 'submit-validation.html'), 'utf8');

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

// ── 1. Mode taglines (plain Dutch, agreed verbatim) ─────────────────────
const MODE_TAGLINES = [
  { mode: 'org',            tag: 'Voor nieuwe opname in Directory en Atlas.' },
  { mode: 'editorial',      tag: 'Voor een mogelijk editorial of voorbeeld uit de praktijk.' },
  { mode: 'both',           tag: 'Voor een organisatie én een praktijkverhaal in één keer.' },
  { mode: 'change_request', tag: 'Voor correctie van een bestaande vermelding.' },
  { mode: 'hide_delete',    tag: 'Voor verzoeken om een bestaande vermelding niet langer te tonen.' }
];

function modeOptionBlock(mode){
  // Capture the <label class="mode-option" data-mode="${mode}" ...> ... </label>
  const re = new RegExp(
    '<label[^>]*class="mode-option"[^>]*data-mode="' + mode + '"[^>]*>([\\s\\S]*?)</label>',
    'i'
  );
  const m = html.match(re);
  if (!m) throw new Error('mode-option block for mode=' + mode + ' not found');
  return m[0];
}

for (const { mode, tag } of MODE_TAGLINES) {
  check(`mode-option[data-mode="${mode}"]: tagline "${tag}" is present`, () => {
    const block = modeOptionBlock(mode);
    assert.ok(/<em\s+class="mode-tagline"\s*>/i.test(block),
      'expected an <em class="mode-tagline"> inside the mode option for ' + mode);
    assert.ok(block.includes(tag),
      'expected the verbatim tagline copy for ' + mode + ': ' + tag);
  });
}

check('CSS rule for .mode-tagline is defined', () => {
  assert.match(html, /\.mode-option\s+em\.mode-tagline\s*\{/,
    'expected a .mode-option em.mode-tagline CSS rule so the tagline renders distinctly');
});

// ── 2. Top-of-form editorial-review notice in plain language ────────────
check('top notice block #sv-editorial-review-notice is present', () => {
  assert.match(html, /id="sv-editorial-review-notice"/,
    'expected the new top-of-form review notice block');
});
check('top notice mentions "Na verzending kijkt de ESRF-redactie mee."', () => {
  assert.ok(html.includes('Na verzending kijkt de ESRF-redactie mee.'),
    'expected verbatim "Na verzending kijkt de ESRF-redactie mee." copy');
});
check('top notice mentions "niets automatisch gepubliceerd"', () => {
  assert.ok(/niets automatisch (gepubliceerd|aangepast)/i.test(html),
    'expected the notice to state that niets automatisch wordt gepubliceerd of aangepast');
});
check('top notice block is sourced before the form (above #sv-form)', () => {
  const idxNotice = html.indexOf('id="sv-editorial-review-notice"');
  const idxForm = html.indexOf('id="sv-form"');
  assert.ok(idxNotice > 0 && idxForm > 0, 'both anchors must exist');
  assert.ok(idxNotice < idxForm, 'notice must appear before the form in source order');
});

// ── 3. No "Nieuw" pills inside the mode selection buttons ───────────────
check('.mode-switch contains no new-pill / "Nieuw" badges on the mode buttons', () => {
  const re = /<div\s+class="mode-switch"[\s\S]*?<\/div>/i;
  const m = html.match(re);
  assert.ok(m, '.mode-switch container must exist');
  const block = m[0];
  assert.ok(!/new-pill/.test(block),
    'mode-switch must not contain a "new-pill" element on selection buttons');
  assert.ok(!/>\s*Nieuw\s*</.test(block),
    'mode-switch must not contain a standalone "Nieuw" badge on selection buttons');
});

// ── 4. Dynamic required-field handling for the organisation field ───────
check('organisation field markup carries required + req span by default', () => {
  // Static default state: required attribuut én een <span class="req"> in het label.
  assert.match(html, /<input\s+type="text"\s+id="sv-org"[^>]*\brequired\b[^>]*name="organisation"|<input\s+type="text"\s+id="sv-org"[^>]*name="organisation"[^>]*\brequired\b/i,
    'expected #sv-org input to carry the required attribute by default');
  assert.match(html, /<label\s+for="sv-org">[^<]*<span\s+class="req"\s+id="sv-org-req"[^>]*>\*<\/span>/i,
    'expected the organisation label to expose the req-indicator with id="sv-org-req"');
});

check('organisation hint explains the optional-for-change/hide rule', () => {
  // The hint text must mention dat het veld optioneel is bij wijzigen of
  // verbergen/verwijderen, zodat de UI consistent blijft met de validatie.
  assert.match(html, /id="sv-org-hint"/,
    'expected #sv-org-hint helper paragraph next to the organisation input');
  const idx = html.indexOf('id="sv-org-hint"');
  const slice = html.slice(idx, idx + 600);
  assert.ok(/wijzigen of verbergen\/verwijderen/i.test(slice) || /wijzigen.*verbergen|verbergen.*wijzigen/i.test(slice),
    'expected the hint to mention the change / hide-delete carve-out');
  assert.ok(/optioneel/i.test(slice),
    'expected the hint to mark the field as optional in those modes');
});

check('applyMode togglet required + req-indicator voor sv-org per modus', () => {
  // Inspecteer de inline JS — dit is een lichte tekstcheck, geen jsdom run.
  // Bij change_request / hide_delete (showChange===true) MOET het required
  // attribuut weg en de req-span verborgen worden.
  const idx = html.indexOf('function applyMode(');
  assert.ok(idx > 0, 'applyMode function must exist in inline JS');
  const slice = html.slice(idx, idx + 4000);

  assert.match(slice, /const\s+orgInput\s*=\s*document\.getElementById\(\s*['"]sv-org['"]\s*\)/,
    'applyMode must reference the orgInput element');
  assert.match(slice, /const\s+orgReq\s*=\s*document\.getElementById\(\s*['"]sv-org-req['"]\s*\)/,
    'applyMode must reference the orgReq indicator');
  assert.match(slice, /orgIsRequired\s*=\s*!showChange/,
    'orgIsRequired must be derived from !showChange (false for change/hide_delete)');
  assert.match(slice, /orgInput\.setAttribute\(\s*['"]required['"]/,
    'applyMode must set the required attribute when org is required');
  assert.match(slice, /orgInput\.removeAttribute\(\s*['"]required['"]/,
    'applyMode must remove the required attribute when org is optional');
  assert.match(slice, /orgReq\.hidden\s*=\s*!orgIsRequired/,
    'applyMode must toggle the visible req-indicator');
});

// ── Summary ─────────────────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.log(failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('All submit-validation UX-round checks passed.');
