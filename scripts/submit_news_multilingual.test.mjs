// Test: submit-news.html now ships TWO working forms (NL + EN), and
// the language switch never shows Dutch labels to non-Dutch visitors.
//
// Wouter's revised multilingual strategy:
//   - Dutch visitors see the existing full Dutch composed form.
//   - Every non-Dutch language sees a full English mirror — same six
//     modes, same ten ESRF sectors, English authority/verification
//     wording, free additional-tags field, no automatic publication,
//     no Directory_Master writes.
//   - The Dutch form may attempt the /api/intake sheet route (Dutch
//     backend only). The English form is mailto-only, never calls
//     /api/intake, and never links to lab/redactie/validation pages.
//
// Run with: node scripts/submit_news_multilingual.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

const html = fs.readFileSync(path.join(repoRoot, 'submit-news.html'), 'utf8');

/* Slice the page into the NL container and the EN container so we can
   make assertions per variant without false positives leaking across. */
function sliceContainer(lang){
  const re = new RegExp(`<div\\s+data-form-lang="${lang}"[\\s\\S]*?<!-- /data-form-lang="${lang}" -->`);
  const m = html.match(re);
  assert.ok(m, `data-form-lang="${lang}" container missing`);
  return m[0];
}
const nlBlock = sliceContainer('nl');
const enBlock = sliceContainer('en');

/* ── Both variants exist ─────────────────────────────────────────── */
check('submit-news.html has data-form-lang="nl" container', () => {
  assert.match(html, /<div\s+data-form-lang="nl"/);
});
check('submit-news.html has data-form-lang="en" container', () => {
  assert.match(html, /<div\s+data-form-lang="en"/);
});

/* ── Pre-render lang detection script in <head> ──────────────────── */
check('submit-news.html resolves form lang BEFORE first paint', () => {
  // Inline script in <head> that sets window.__esrfFormLang and injects
  // a CSS rule so non-NL visitors never see Dutch labels flashing.
  assert.match(html, /window\.__esrfFormLang/);
  assert.match(html, /sv-form-lang-style/);
  assert.match(html, /\[data-form-lang="en"\]\{display:none!important\}/);
  assert.match(html, /\[data-form-lang="nl"\]\{display:none!important\}/);
});

/* ── NL form: Dutch labels and the six modes ─────────────────────── */
const NL_MODE_LABELS = [
  'Organisatie aanmelden',
  'Praktijkverhaal delen',
  'Beide',
  'Gegevens wijzigen',
  'Verbergen / verwijderen',
  'Event aanmelden',
];
for (const label of NL_MODE_LABELS) {
  check(`NL form contains Dutch mode label "${label}"`, () => {
    assert.ok(nlBlock.includes(label), `NL block missing ${label}`);
  });
}

check('NL form: ESRF-sector label is in Dutch ("hoofdcategorie")', () => {
  assert.match(nlBlock, /ESRF-sector\s*\/\s*hoofdcategorie/);
});
check('NL form: contains review notice "redactie kijkt mee"', () => {
  assert.match(nlBlock, /ESRF-redactie mee/);
});
check('NL form: GDPR consent label is Dutch', () => {
  assert.match(nlBlock, /privacybeleid/);
});

/* ── EN form: English labels for the same six modes ──────────────── */
const EN_MODE_LABELS = [
  'List an organisation',
  'Share a story from practice',
  'Both',
  'Change details',
  'Hide / delete',
  'Submit an event',
];
for (const label of EN_MODE_LABELS) {
  check(`EN form contains English mode label "${label}"`, () => {
    assert.ok(enBlock.includes(label), `EN block missing ${label}`);
  });
}

/* Same six radio values must appear in BOTH forms (canonical, untranslated). */
for (const v of ['org', 'editorial', 'both', 'change_request', 'hide_delete', 'event']) {
  check(`NL form has intake_mode value="${v}"`, () => {
    assert.match(nlBlock, new RegExp(`name="intake_mode"\\s+value="${v}"`));
  });
  check(`EN form has intake_mode value="${v}"`, () => {
    assert.match(enBlock, new RegExp(`name="intake_mode"\\s+value="${v}"`));
  });
}

check('EN form: ESRF-sector label is in English ("primary category")', () => {
  assert.match(enBlock, /ESRF sector\s*\/\s*primary category/);
});
check('EN form: review notice is English ("editorial team takes a look")', () => {
  assert.match(enBlock, /ESRF editorial team takes a look/i);
  assert.match(enBlock, /Nothing is automatically published/i);
});
check('EN form: GDPR consent label is English ("privacy policy")', () => {
  assert.match(enBlock, /I agree to the <a href="privacy\.html">privacy policy<\/a>/);
});
check('EN form: explicit no-auto-publication notice in change section', () => {
  assert.match(enBlock, /No automatic change/i);
  assert.match(enBlock, /No automatic approval/i);
});
check('EN form: explicit no-auto-publication notice in event section', () => {
  assert.match(enBlock, /No automatic publication/i);
});

/* ── EN form: English authority / verification wording ───────────── */
check('EN form: authority section uses English title', () => {
  assert.match(enBlock, /Authority to request this change/);
});
check('EN form: authority asks for "authorised" + work email + relation', () => {
  assert.match(enBlock, /authorised/i);
  assert.match(enBlock, /name="auth_requester_name"/);
  assert.match(enBlock, /name="auth_requester_role"/);
  assert.match(enBlock, /name="auth_work_email"/);
  assert.match(enBlock, /name="auth_relation"/);
  assert.match(enBlock, /name="auth_confirm_authorized"/);
  assert.match(enBlock, /name="auth_registration_code"/);
});
check('EN form: registration-code helper does NOT call it password', () => {
  const block = enBlock.match(/auth_registration_code[\s\S]{0,800}/);
  assert.ok(block, 'EN registration-code block missing');
  assert.ok(!/password/i.test(block[0]), 'EN registration-code must not be called password');
});

/* ── ESRF 10 canonical sectors with stable canonical values ─────── */
const ESRF_SECTOR_VALUES = [
  'noodhulp-crisisrespons',
  'beveiliging-bescherming',
  'risico-continuiteit',
  'digitale-infrastructuur-cybersecurity',
  'kennis-training-onderzoek',
  'gezondheid-medische-productie',
  'kritieke-infrastructuur',
  'dual-use-technologie-productie',
  'transport-maritiem-luchtvaart',
  'energie-netwerkweerbaarheid',
];
for (const v of ESRF_SECTOR_VALUES) {
  check(`EN form preserves canonical sector value="${v}"`, () => {
    assert.match(enBlock, new RegExp(`<option\\s+value="${v}">`));
  });
}
/* And EN should label them in English. */
const EN_SECTOR_SAMPLES = [
  ['noodhulp-crisisrespons', 'Emergency Response & Crisis Response'],
  ['digitale-infrastructuur-cybersecurity', 'Digital Infrastructure & Cybersecurity'],
  ['energie-netwerkweerbaarheid', 'Energy & Network Resilience'],
  ['transport-maritiem-luchtvaart', 'Transport, Maritime & Aviation'],
];
for (const [val, label] of EN_SECTOR_SAMPLES) {
  check(`EN form sector option ${val} → "${label}"`, () => {
    const escaped = label.replace(/&/g, '&amp;').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(enBlock, new RegExp(`value="${val}"[^>]*>\\s*${escaped}`));
  });
}

/* Each select has 10 sector options + 1 placeholder. */
function countOptions(block, selectId){
  const sel = block.match(new RegExp(`<select[^>]*id="${selectId}"[\\s\\S]*?</select>`));
  if (!sel) return null;
  return (sel[0].match(/<option\b/g) || []).length;
}
for (const id of ['sv-en-sector', 'sv-en-ed-nis2-sector', 'sv-en-cr-nis2-sector', 'sv-en-ev-nis2-sector']) {
  check(`EN form <select id="${id}"> has 11 <option> tags (10 sectors + placeholder)`, () => {
    const n = countOptions(enBlock, id);
    assert.equal(n, 11, `expected 11 options for #${id}, got ${n}`);
  });
}

/* ── Free additional_tags field present in every relevant section ── */
for (const name of ['additional_tags', 'ed_additional_tags', 'cr_additional_tags', 'event_tags']) {
  check(`EN form has free tag field name="${name}"`, () => {
    assert.match(enBlock, new RegExp(`name="${name}"`));
  });
}

/* ── EN form is mailto-only: never calls /api/intake ─────────────── */
check('EN form submit handler does NOT call /api/intake', () => {
  // Find the IIFE wired to #sv-form-en and assert no fetch('/api/intake')
  // appears inside it.
  // Slice from the EN IIFE's getElementById up to the FIRST "})();" — non-greedy
  const enHandler = html.match(/getElementById\('sv-form-en'\)[\s\S]*?^}\)\(\);/m);
  assert.ok(enHandler, 'EN form handler block missing');
  assert.ok(!/fetch\([^)]*\/api\/intake/.test(enHandler[0]),
    'EN form must not call fetch("/api/intake")');
});
check('EN form submit handler uses mailto:intake@esrf.net', () => {
  // Slice from the EN IIFE's getElementById up to the FIRST "})();" — non-greedy
  const enHandler = html.match(/getElementById\('sv-form-en'\)[\s\S]*?^}\)\(\);/m);
  assert.ok(enHandler);
  assert.match(enHandler[0], /mailto:intake@esrf\.net/);
});

/* ── Defence in depth: NL handler refuses /api/intake on non-NL ─── */
check('NL submit handler short-circuits /api/intake when lang != "nl"', () => {
  // The shared submit() in the NL IIFE checks __esrfFormLang and falls
  // through to mailtoFor() BEFORE calling fetch('/api/intake').
  const idxGuard = html.indexOf("(window.__esrfFormLang || 'nl') !== 'nl'");
  const idxFetch = html.indexOf("fetch('/api/intake'");
  assert.ok(idxGuard !== -1, 'non-NL guard expression missing');
  assert.ok(idxFetch !== -1, 'fetch(/api/intake) missing');
  assert.ok(idxGuard < idxFetch, 'non-NL guard must precede fetch(/api/intake)');
  // And the guard must call mailtoFor and return without attempting the API.
  const guardBlock = html.slice(idxGuard, idxFetch);
  assert.match(guardBlock, /mailtoFor\(data, mode\)/);
  assert.match(guardBlock, /\breturn;/);
});

/* ── Live language switch swaps the visible variant ──────────────── */
check('submit-news.html listens for esrf:langchange to swap variants', () => {
  assert.match(html, /addEventListener\('esrf:langchange'/);
});

/* ── EN form has its own success box with English copy ──────────── */
check('EN form has its own English mailto-success block', () => {
  assert.match(enBlock, /id="form-success-en"/);
  assert.match(enBlock, /Your mail client has opened/i);
  assert.match(enBlock, /Back to ESRF\.net/i);
});

/* ── Forbidden internal pages: NEITHER form may link to lab pages ── */
const FORBIDDEN = [
  'submit-validation.html',
  'request-listing-validation.html',
  'esrf-simulated-site.html',
  'contribute-editorial-test.html',
  'redactie-validation.html',
  'redactie-review.html',
  'validation-lab.html',
];
for (const target of FORBIDDEN) {
  check(`submit-news.html does NOT mention internal page ${target}`, () => {
    const refRe = new RegExp(target.replace(/[.]/g, '\\.'), 'i');
    assert.ok(!refRe.test(html), `must not mention ${target}`);
  });
  check(`EN form does NOT link to ${target}`, () => {
    const re = new RegExp(`href=["']${target.replace(/[.]/g, '\\.')}["']`);
    assert.ok(!re.test(enBlock), `EN form must not link to ${target}`);
  });
}

/* ── Recordtype line emitted for both NL and EN bodies ──────────── */
check('EN buildBody emits a Recordtype: header for every mode', () => {
  // Slice from the EN IIFE's getElementById up to the FIRST "})();" — non-greedy
  const enHandler = html.match(/getElementById\('sv-form-en'\)[\s\S]*?^}\)\(\);/m);
  assert.ok(enHandler);
  assert.match(enHandler[0], /Recordtype:\s*'\s*\+\s*\(recordtypeMap\[mode\]\s*\|\|\s*mode\)/);
});

/* ── EN buildBody flags Language: en and No auto publication ────── */
check('EN buildBody includes Language: en marker', () => {
  // Slice from the EN IIFE's getElementById up to the FIRST "})();" — non-greedy
  const enHandler = html.match(/getElementById\('sv-form-en'\)[\s\S]*?^}\)\(\);/m);
  assert.ok(enHandler);
  assert.match(enHandler[0], /Language:\s*en/);
});

/* ── Directory_Master must remain absent from the public repo ─── */
check('repo: no Directory_Master file present', () => {
  for (const c of ['Directory_Master.json','Directory_Master.csv','directory_master.json','directory_master.csv']) {
    assert.ok(!fs.existsSync(path.join(repoRoot, c)), `${c} must not exist`);
  }
});

/* ── i18n still parses (we did not break translation files) ─────── */
check('i18n/nl.json parses', () => { JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n/nl.json'), 'utf8')); });
check('i18n/en.json parses', () => { JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n/en.json'), 'utf8')); });

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll submit_news_multilingual checks passed.');
}
