// Test: submit-news.html now hosts the new composed visitor form
// (validated submit-validation flow brought into production-safe shape).
//
// Verifies on the production page submit-news.html:
//   - All five mode labels are present
//   - Step-1 instruction text "Kies eerst wat je wilt doen…" is present
//   - "NIEUW" badge does NOT appear on mode buttons
//   - Editorial review notice is present (NL + EN spirit)
//   - Bevoegdheid (authorization) section present with required fields,
//     and never uses the word "password" / "wachtwoord" for the registratiecode
//   - Existing-listing prefill / lookup UI is present for change/hide modes
//   - No links to validation/lab/redactie internal pages
//   - i18n JSON parses
//
// Run with: node scripts/submit_news_composed_form.test.mjs

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

// ── Mode labels (6 modes) ─────────────────────────────────────────────
const MODE_LABELS = [
  'Organisatie aanmelden',
  'Praktijkverhaal delen',
  'Beide',
  'Gegevens wijzigen',
  'Verbergen / verwijderen',
  'Event aanmelden',
];
for (const label of MODE_LABELS) {
  check(`submit-news.html contains mode label "${label}"`, () => {
    assert.ok(html.includes(label), `expected mode label "${label}" in submit-news.html`);
  });
}

// ── Mode radio values ─────────────────────────────────────────────────
for (const v of ['org', 'editorial', 'both', 'change_request', 'hide_delete', 'event']) {
  check(`submit-news.html has intake_mode radio value="${v}"`, () => {
    const re = new RegExp(`name="intake_mode"\\s+value="${v}"`);
    assert.match(html, re);
  });
}

// ── Step-1 instruction "kies eerst, dan stap 2" ───────────────────────
check('submit-news.html contains step-1 instruction (kies eerst — stap 2)', () => {
  assert.match(html, /Kies eerst wat je wilt doen/i);
  assert.match(html, /stap\s*2/i);
});

// ── No NIEUW badge on mode buttons ────────────────────────────────────
check('submit-news.html has no NIEUW badge inside mode-switch / mode-option', () => {
  // Heuristic: look for "NIEUW" near any mode-option label
  const re = /<label[^>]*class="[^"]*mode-option[^"]*"[\s\S]*?<\/label>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const block = m[0];
    assert.ok(!/\bNIEUW\b/.test(block), 'mode-option must not contain NIEUW badge');
  }
});

// ── Review notice present ─────────────────────────────────────────────
check('submit-news.html contains editorial review notice (redactie kijkt mee)', () => {
  assert.match(html, /kijkt\s+(de\s+)?ESRF-redactie\s+mee|redactie\s+kijkt\s+mee/i);
  assert.match(html, /niets\s+(wordt\s+)?automatisch\s+gepubliceerd/i);
});

// ── Bevoegdheid section ───────────────────────────────────────────────
check('submit-news.html has Bevoegdheid section with required fields', () => {
  assert.match(html, /Bevoegdheid om wijziging aan te vragen/);
  assert.match(html, /name="auth_requester_name"/);
  assert.match(html, /name="auth_requester_role"/);
  assert.match(html, /name="auth_work_email"/);
  assert.match(html, /name="auth_relation"/);
  assert.match(html, /name="auth_confirm_authorized"/);
  assert.match(html, /name="auth_registration_code"/);
});

check('submit-news.html never calls the registratiecode "password"', () => {
  // Allow "wachtwoord" only if explicitly negated; we want neither label nor input named password
  const codeBlock = html.match(/auth_registration_code[\s\S]{0,800}/);
  assert.ok(codeBlock, 'registratiecode block missing');
  assert.ok(!/password|wachtwoord/i.test(codeBlock[0]), 'registratiecode must not be called password/wachtwoord');
  // type must not be password
  assert.ok(!/id="sv-auth-registration-code"[^>]*type="password"/i.test(html), 'registratiecode input must not be type=password');
});

// ── Existing-listing prefill / lookup ─────────────────────────────────
check('submit-news.html has existing-listing lookup + prefill panel', () => {
  assert.match(html, /id="sv-cr-lookup"/);
  assert.match(html, /id="sv-cr-existing-panel"/);
  assert.match(html, /Bestaande publieke gegevens/);
  assert.match(html, /companies_extracted\.json/);
});

// ── Change-request fields ─────────────────────────────────────────────
check('submit-news.html has change-request fields (target_name/url, action, description, reason)', () => {
  assert.match(html, /name="cr_target_name"/);
  assert.match(html, /name="cr_target_url"/);
  assert.match(html, /name="cr_action"/);
  assert.match(html, /name="cr_description"/);
  assert.match(html, /name="cr_reason"/);
});

// ── No links to validation/lab/redactie internal pages ────────────────
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
  check(`submit-news.html does NOT reference internal page ${target}`, () => {
    const re = new RegExp(`href=["']${target.replace(/[.]/g, '\\.')}["']`);
    assert.ok(!re.test(html), `submit-news.html must not link to ${target}`);
    // Also guard against bare anchor text references
    const refRe = new RegExp(target.replace(/[.]/g, '\\.'), 'i');
    assert.ok(!refRe.test(html), `submit-news.html must not mention ${target}`);
  });
}

// ── Production-safe submit path: mailto intake@esrf.net ───────────────
check('submit-news.html submits via mailto:intake@esrf.net (production-safe)', () => {
  assert.match(html, /mailto:intake@esrf\.net/);
});

check('submit-news.html does NOT call /api/intake-test (LAB-only endpoint)', () => {
  assert.ok(!/\/api\/intake-test/.test(html), '/api/intake-test belongs in lab, not production');
});

// ── Hero copy: NL primary share-information label ─────────────────────
check('submit-news.html hero uses common.share_information data-i18n', () => {
  assert.match(html, /data-i18n="common\.share_information"/);
  assert.match(html, /Deel je informatie/);
});

// ── Event mode: dedicated section + fields ────────────────────────────
check('submit-news.html has event section block (data-section="event")', () => {
  assert.match(html, /data-section="event"/);
  assert.match(html, /Event-gegevens/);
});

check('submit-news.html event section uses the agreed short explanation', () => {
  assert.match(html, /Voor conferenties, bijeenkomsten, webinars of andere relevante activiteiten voor het ESRF-netwerk\./);
});

const EVENT_FIELDS = [
  'event_name',
  'event_organiser',
  'event_date_start',
  'event_date_end',
  'event_time',
  'event_location',
  'event_country',
  'event_description',
  'event_audience',
  'event_tags',
  'event_website',
  'event_contact_name',
  'event_contact_email',
  'event_publication_request',
];
for (const field of EVENT_FIELDS) {
  check(`submit-news.html event section has field name="${field}"`, () => {
    const re = new RegExp(`name="${field}"`);
    assert.match(html, re);
  });
}

check('submit-news.html event tags hint mentions comma separation', () => {
  // Tags-help text — "Scheiden met komma's"
  assert.match(html, /Scheiden met komma['’]s/);
});

// ── NIS2-sector dropdown: 19 options on every relevant section ────────
const NIS2_OPTIONS = [
  ['energie', 'Energie'],
  ['vervoer', 'Vervoer'],
  ['bankwezen', 'Bankwezen'],
  ['financiele-marktinfrastructuur', 'Financiële marktinfrastructuur'],
  ['gezondheidszorg', 'Gezondheidszorg'],
  ['drinkwater', 'Drinkwater'],
  ['afvalwater', 'Afvalwater'],
  ['digitale-infrastructuur', 'Digitale infrastructuur'],
  ['ict-dienstverlening-b2b', 'ICT-dienstverlening B2B'],
  ['overheidsdiensten', 'Overheidsdiensten'],
  ['ruimtevaart', 'Ruimtevaart'],
  ['post-en-koeriersdiensten', 'Post- en koeriersdiensten'],
  ['afvalbeheer', 'Afvalbeheer'],
  ['chemische-stoffen', 'Chemische stoffen'],
  ['voedsel', 'Voedsel'],
  ['maakindustrie', 'Maakindustrie'],
  ['digitale-aanbieders', 'Digitale aanbieders'],
  ['onderzoek', 'Onderzoek'],
  ['anders-meerdere', 'Anders / meerdere sectoren'],
];

for (const [val, label] of NIS2_OPTIONS) {
  check(`submit-news.html NIS2 dropdown has option value="${val}" → ${label}`, () => {
    const re = new RegExp(`value="${val}"[^>]*>\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`);
    assert.match(html, re);
  });
}

check('submit-news.html org NIS2-sector dropdown is labelled "NIS2-sector / hoofdsector"', () => {
  assert.match(html, /<label[^>]*for="sv-sector"[^>]*>\s*NIS2-sector\s*\/\s*hoofdsector/);
  assert.match(html, /id="sv-sector"\s+name="sector"\s+data-nis2-sector="org"/);
});

check('submit-news.html editorial section has NIS2-sector + Aanvullende tags fields', () => {
  assert.match(html, /name="ed_nis2_sector"/);
  assert.match(html, /name="ed_additional_tags"/);
  assert.match(html, /<label[^>]*for="sv-ed-nis2-sector"[^>]*>\s*NIS2-sector\s*\/\s*hoofdsector/);
});

check('submit-news.html change-request section has NIS2-sector + Aanvullende tags fields', () => {
  assert.match(html, /name="cr_nis2_sector"/);
  assert.match(html, /name="cr_additional_tags"/);
});

check('submit-news.html event section has event_nis2_sector dropdown', () => {
  assert.match(html, /name="event_nis2_sector"/);
  assert.match(html, /<label[^>]*for="sv-ev-nis2-sector"[^>]*>\s*NIS2-sector\s*\/\s*hoofdsector/);
});

check('submit-news.html org section has additional_tags input', () => {
  assert.match(html, /name="additional_tags"/);
});

// ── Aanvullende tags helper text mentions komma's ────────────────────
check('submit-news.html aanvullende tags helper mentions komma\'s and example tags', () => {
  // Common helper phrasing across sections
  const re = /Gebruik\s+komma['’]s\s+tussen\s+tags,\s+bijvoorbeeld:\s*crisiscommunicatie,\s*haven,\s*cybersecurity/;
  const matches = html.match(new RegExp(re, 'g')) || [];
  assert.ok(matches.length >= 3, `expected ≥3 occurrences of the aanvullende-tags helper, got ${matches.length}`);
});

// ── Mailto/body: NIS2-sector + Aanvullende tags as separate lines ────
check('submit-news.html buildBody includes NIS2-sector line for org/both', () => {
  assert.match(html, /'\s*NIS2-sector:\s*'\s*\+\s*get\(data,\s*'sector'\)/);
});

check('submit-news.html buildBody includes Aanvullende tags line for org/both', () => {
  assert.match(html, /'\s*Aanvullende tags:\s*'\s*\+\s*get\(data,\s*'additional_tags'\)/);
});

check('submit-news.html buildBody includes editorial NIS2-sector + Aanvullende tags', () => {
  assert.match(html, /get\(data,\s*'ed_nis2_sector'\)/);
  assert.match(html, /get\(data,\s*'ed_additional_tags'\)/);
});

check('submit-news.html buildBody includes change-request NIS2-sector + Aanvullende tags', () => {
  assert.match(html, /get\(data,\s*'cr_nis2_sector'\)/);
  assert.match(html, /get\(data,\s*'cr_additional_tags'\)/);
});

check('submit-news.html buildBody event branch has NIS2-sector and Aanvullende tags as separate lines', () => {
  const ev = html.match(/EVENT_INTAKE[\s\S]*?Auto-publicatie/);
  assert.ok(ev, 'event mailto block missing');
  assert.match(ev[0], /NIS2-sector:.*event_nis2_sector/);
  assert.match(ev[0], /Aanvullende tags:.*event_tags/);
});

check('submit-news.html event publication-request offers required options', () => {
  assert.match(html, /value="agenda"[^>]*>\s*Plaatsing op de ESRF-agenda/i);
  assert.match(html, /value="dispatch"/);
  assert.match(html, /value="editorial"/);
  assert.match(html, /value="fyi"/);
});

check('submit-news.html event section says nothing is automatically published', () => {
  // No-auto-publication notice in event section
  const ev = html.match(/data-section="event"[\s\S]*?<\/fieldset>/);
  assert.ok(ev, 'event section block missing');
  assert.match(ev[0], /niets\s+wordt\s+automatisch\s+gepubliceerd/i);
  assert.match(ev[0], /redactie\s+controleert/i);
});

check('submit-news.html event mailto body carries event_intake fields', () => {
  // Structured payload marker
  assert.match(html, /EVENT_INTAKE/);
  // Recordtype carried through
  assert.match(html, /Recordtype:\s*'?event/i);
  // Subject map includes event
  assert.match(html, /event:\s*'Event aanmelden'/);
});

check('submit-news.html event mode submit button label', () => {
  assert.match(html, /Meld je event aan/);
});

// ── safety: Directory_Master untouched / no internal validation links ─
check('repo: Directory_Master not modified by this work (not present in repo)', () => {
  // Directory_Master is the editorial master and must not exist in the public repo.
  const candidates = [
    'Directory_Master.json',
    'Directory_Master.csv',
    'directory_master.json',
    'directory_master.csv',
  ];
  for (const c of candidates) {
    assert.ok(!fs.existsSync(path.join(repoRoot, c)), `Directory_Master file ${c} must not exist in this repo`);
  }
});

// ── i18n JSON parses ─────────────────────────────────────────────────
check('i18n/nl.json parses', () => { JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n/nl.json'), 'utf8')); });
check('i18n/en.json parses', () => { JSON.parse(fs.readFileSync(path.join(repoRoot, 'i18n/en.json'), 'utf8')); });

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('\nAll submit_news_composed_form checks passed.');
}
