// Tests for the Wouter review feedback round on
// branch test/regional-editorial-contributor-intake (2026-04-27).
//
// Covers exactly the items listed in the review:
//   1. validation-lab.html  — visitor/redacteur instruction is present
//   2. esrf-simulated-site.html — confusing "Nieuw"/"Nieuw in validatie"
//      labels are removed near the form/CTA, and Directory + Atlas are
//      both named at the first form reference (NL + EN consistent).
//   3. redactie-validation.html — access-code input has wider sizing
//      attributes and monospace styling so the placeholder/typed code
//      is fully visible on desktop and mobile.
//   4. redactie-validation.html — purpose section #rv-purpose explains
//      in plain Dutch what the form is for (bekijken, aanpassen,
//      volgende stap kiezen, opslaan, niets wordt automatisch
//      gepubliceerd).
//   5. redactie-validation.html — Sector / tags help text covers
//      separator (comma), free input policy, and that the definitive
//      tag set is harmonised later.
//   6. validation-lab.json — exit criteria for the affected modules
//      reference the Wouter feedback so the audit trail is explicit.
//
// Run with: node scripts/wouter_review_feedback_2026_04_27.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const validationLabHtml = fs.readFileSync(path.join(repoRoot, 'validation-lab.html'), 'utf8');
const simulatedSiteHtml = fs.readFileSync(path.join(repoRoot, 'esrf-simulated-site.html'), 'utf8');
const redactieHtml      = fs.readFileSync(path.join(repoRoot, 'redactie-validation.html'), 'utf8');
const manifest          = JSON.parse(fs.readFileSync(path.join(repoRoot, 'validation-lab.json'), 'utf8'));

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

// ── 1. validation-lab.html visitor instruction ──────────────────────────
check('validation-lab.html: visitor instruction block #vl-visitor-instruction is present', () => {
  assert.match(validationLabHtml, /id="vl-visitor-instruction"/);
});
check('validation-lab.html: instruction sentence "Kies wat je wilt opgeven en vul het samengestelde formulier hieronder in." is present', () => {
  assert.ok(
    validationLabHtml.includes('Kies wat je wilt opgeven en vul het samengestelde formulier hieronder in.'),
    'expected the verbatim instruction sentence in validation-lab.html'
  );
});
check('validation-lab.html: instruction is placed before the modules list', () => {
  const idxInstruction = validationLabHtml.indexOf('id="vl-visitor-instruction"');
  const idxModules     = validationLabHtml.indexOf('id="vl-modules"');
  assert.ok(idxInstruction > 0 && idxModules > 0, 'both anchors must exist');
  assert.ok(idxInstruction < idxModules, 'instruction must appear before #vl-modules in source order');
});

// ── 2. esrf-simulated-site.html — "Nieuw" labels removed near form/CTA ─
check('esrf-simulated-site.html: "Nieuw in validatie" pill is removed from the JOIN CTA section', () => {
  // The JOIN CTA used to carry a <span class="new-pill">Nieuw in validatie</span>.
  // After Wouter's feedback that pill must be gone next to the primary CTA copy.
  const join = simulatedSiteHtml.split('id="join"')[1] || '';
  // Capture only the CTA section (until the next <section>).
  const cta = join.split('<!-- ═══ Editorial')[0] || join;
  assert.ok(!/new-pill[^"]*"[^>]*>\s*Nieuw in validatie\s*</.test(cta),
    '"Nieuw in validatie" pill must not appear in the JOIN CTA after the form button');
});
check('esrf-simulated-site.html: "Nieuw" / "Nieuw in validatie" pill is removed from the editorial contribute section lede', () => {
  const idx = simulatedSiteHtml.indexOf('id="bijdragen"');
  assert.ok(idx > 0, 'bijdragen section must exist');
  const after = simulatedSiteHtml.slice(idx, idx + 1500);
  assert.ok(!/new-pill new-pill-soft[^"]*"[^>]*>\s*Nieuw in validatie\s*</.test(after),
    '"Nieuw in validatie" soft pill must be removed from the editorial contribute lede');
});
check('esrf-simulated-site.html: footer validation block no longer carries a standalone "Nieuw" pill on the formulier link', () => {
  const idx = simulatedSiteHtml.indexOf('<h4>Validatie</h4>');
  assert.ok(idx > 0, 'validatie footer block must exist');
  const block = simulatedSiteHtml.slice(idx, idx + 800);
  assert.ok(!/new-pill[^"]*"[^>]*>\s*Nieuw\s*</.test(block),
    'standalone "Nieuw" pill must be removed from the validatie footer entry for the form link');
});
check('esrf-simulated-site.html: first formulier reference mentions both Directory and Atlas (NL)', () => {
  // Must explicitly mention Directory in addition to Atlas, in plain Dutch.
  assert.ok(/Directory\s+én\s+(?:op\s+de\s+)?Atlas/i.test(simulatedSiteHtml),
    'expected "Directory én ... Atlas" in NL copy at the first form reference');
});
check('esrf-simulated-site.html: NL/EN consistency — "Directory and Atlas" surfaces in the page', () => {
  assert.ok(/Directory\s+and\s+Atlas/.test(simulatedSiteHtml),
    'expected the parallel English phrasing "Directory and Atlas" so NL/EN are consistent');
});
check('esrf-simulated-site.html: marked-route class no longer added to the JOIN section', () => {
  const join = simulatedSiteHtml.split('id="join"')[1] || '';
  const headLine = simulatedSiteHtml.match(/<section\s+class="join[^"]*"\s+id="join"/);
  assert.ok(headLine, 'JOIN <section> tag must exist');
  assert.ok(!/marked-route/.test(headLine[0]),
    'marked-route class (which renders the giant NIEUW IN VALIDATIE overlay) must be removed');
});

// ── 3. redactie-validation.html — toegangscode field sizing/styling ──────
check('redactie-validation.html: rv-access-code input has size and maxlength attributes', () => {
  assert.match(redactieHtml, /id="rv-access-code"[^>]*\bsize="40"/i,
    'expected size="40" on the access code input');
  assert.match(redactieHtml, /id="rv-access-code"[^>]*\bmaxlength="64"/i,
    'expected maxlength="64" on the access code input');
});
check('redactie-validation.html: dedicated #rv-access-code CSS rule exists with monospaced font-family', () => {
  // The rule .rv-access input#rv-access-code should be present with a
  // generous font-size and monospace font stack.
  assert.match(redactieHtml, /\.rv-access\s+input#rv-access-code\s*\{[^}]*font-size:\s*15px/i,
    'expected .rv-access input#rv-access-code rule with font-size:15px');
  // The base .rv-access password/text rule must declare a monospace stack.
  assert.match(redactieHtml,
    /\.rv-access\s+input\[type="password"\][\s\S]{0,400}font-family:\s*['"]IBM Plex Mono['"][^;]*monospace/i,
    'expected the rv-access password input rule to use a monospace font stack');
});
check('redactie-validation.html: mobile media query widens the access code input to 100%', () => {
  assert.match(redactieHtml,
    /@media\s*\(\s*max-width:\s*640px\s*\)\s*\{[\s\S]*?input#rv-access-code[\s\S]*?(?:flex|width)\s*:\s*1\s*1\s*100%|@media\s*\(\s*max-width:\s*640px\s*\)\s*\{[\s\S]*?input#rv-access-code[\s\S]*?width\s*:\s*100%/,
    'expected a max-width:640px rule that widens #rv-access-code to 100%');
});
check('redactie-validation.html: rv-access-code-help paragraph is present and explains placeholder visibility', () => {
  assert.match(redactieHtml, /id="rv-access-code-help"/,
    'expected helper paragraph id="rv-access-code-help"');
  assert.ok(redactieHtml.includes('breed genoeg voor de volledige toegangscode'),
    'expected helper paragraph to state the field is wide enough');
  assert.ok(redactieHtml.includes('vast lettertype'),
    'expected helper paragraph to state monospaced lettertype');
});

// ── 4. redactie-validation.html — purpose section in plain language ──────
check('redactie-validation.html: purpose section #rv-purpose with heading "Waar is dit formulier voor?" exists', () => {
  assert.match(redactieHtml, /id="rv-purpose"/, 'expected #rv-purpose anchor');
  assert.ok(redactieHtml.includes('Waar is dit formulier voor?'),
    'expected the heading "Waar is dit formulier voor?"');
});
check('redactie-validation.html: purpose section uses plain Dutch covering the five intent steps', () => {
  // Each of these phrases must appear inside the rv-purpose block — they
  // mirror the wording requested in the review (bekijken, aanpassen,
  // volgende stap of status kiezen, opslaan, niets automatisch
  // gepubliceerd).
  const idx = redactieHtml.indexOf('id="rv-purpose"');
  assert.ok(idx > 0, '#rv-purpose must exist');
  // Grab a generous slice — the purpose section is short.
  const slice = redactieHtml.slice(idx, idx + 4000);
  for (const phrase of [
    'Je bekijkt een inzending.',
    'Je past de tekst aan waar nodig.',
    'Je kiest de volgende stap of status.',
    'Je slaat het redactiebesluit op.',
    'Niets wordt automatisch gepubliceerd.'
  ]){
    assert.ok(slice.includes(phrase), 'expected purpose section to contain: ' + phrase);
  }
});

// ── 5. redactie-validation.html — Sector / tags help text ────────────────
check('redactie-validation.html: Sector / tags help text mentions comma separator and free input', () => {
  // The help text exists in two places: as f.help on the EDIT_FIELDS entry
  // (rendered at runtime under the input as .rv-field-help), and as a
  // static rule line in the "Drie regels" → fourth rule list item so
  // static text-based tests can detect it without running the JS.
  assert.match(redactieHtml, /Scheid meerdere tags met komma['\u2019]s/i,
    'expected help text to instruct comma-separated tags');
  assert.match(redactieHtml, /vrij invoerveld|Vrij invoerveld/,
    'expected help text to describe field as free input');
  assert.match(redactieHtml, /geen vaste keuzelijst/i,
    'expected help text to clarify there is no fixed selection list');
  assert.match(redactieHtml, /nieuwe tag voorstellen/i,
    'expected help text to allow proposing a new tag');
  assert.match(redactieHtml, /definitieve tagset wordt later geharmoniseerd/i,
    'expected help text to state that the definitive tagset is harmonised later');
});
check('redactie-validation.html: rv-field-help CSS class is defined for inline help under inputs', () => {
  assert.match(redactieHtml, /\.rv-field-help\s*\{/,
    'expected CSS class .rv-field-help to be defined');
});

// ── 6. validation-lab.json — exit criteria + audit pointer for Wouter feedback ─
check('validation-lab.json: top-level wouterReviewFeedback_2026_04_27 entry is present', () => {
  assert.ok(manifest.wouterReviewFeedback_2026_04_27,
    'expected top-level wouterReviewFeedback_2026_04_27 record');
  const r = manifest.wouterReviewFeedback_2026_04_27;
  assert.equal(r.reviewer, 'Wouter');
  assert.ok(Array.isArray(r.items) && r.items.length === 5,
    'expected 5 feedback items recorded (validation-lab + simulated + 3× redactie)');
  for (const item of r.items){
    assert.ok(item.page, 'each item must reference a page');
    assert.ok(item.feedback, 'each item must record the feedback');
    assert.ok(item.resolution, 'each item must record the resolution');
  }
});
check('validation-lab.json: esrf-simulated-site exitCriteria reference Wouter 2026-04-27 review', () => {
  const mod = manifest.modules.find(m => m.id === 'esrf-simulated-site');
  assert.ok(mod, 'esrf-simulated-site module must exist');
  assert.ok(mod.exitCriteria.some(c => /Wouter.*2026-04-27/.test(c)),
    'expected esrf-simulated-site exitCriteria to mention the Wouter 2026-04-27 review');
  assert.ok(mod.wouterReviewFeedback && Array.isArray(mod.wouterReviewFeedback.items),
    'expected esrf-simulated-site.wouterReviewFeedback object');
});
check('validation-lab.json: redactie-validation-form exitCriteria reference Wouter 2026-04-27 review (3 items)', () => {
  const mod = manifest.modules.find(m => m.id === 'redactie-validation-form');
  assert.ok(mod, 'redactie-validation-form module must exist');
  const wouterCriteria = mod.exitCriteria.filter(c => /Wouter.*2026-04-27/.test(c));
  assert.ok(wouterCriteria.length >= 3,
    'expected at least 3 exit criteria mentioning the Wouter 2026-04-27 review (toegangscode + purpose + tags), got ' + wouterCriteria.length);
  assert.ok(mod.wouterReviewFeedback && Array.isArray(mod.wouterReviewFeedback.items)
    && mod.wouterReviewFeedback.items.length === 3,
    'expected redactie-validation-form.wouterReviewFeedback with 3 items');
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.log(failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('All Wouter review feedback checks passed.');
