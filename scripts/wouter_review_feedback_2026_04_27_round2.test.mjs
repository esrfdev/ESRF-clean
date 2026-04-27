// Tests for the Wouter review feedback round 2 on
// branch test/regional-editorial-contributor-intake (2026-04-27).
//
// Covers:
//   1. submit-validation.html — step 1 instruction "Kies eerst wat je
//      wilt doen. Daarna ga je hieronder door naar stap 2 om de gegevens
//      in te vullen." is present and placed inside the first fieldset.
//   2. submit-validation.html — change_request / hide_delete modes show
//      a lookup field (sv-cr-lookup) and an "Bestaande publieke gegevens"
//      panel (sv-cr-existing-panel) that prefills from the public
//      directory data (companies_extracted.json).
//   3. submit-validation.html — Bevoegdheid (authorization) section is
//      present with all required fields, the registration-code label
//      uses "registratiecode" / "verificatiecode" (never the words
//      "password" or "wachtwoord" in the UI), and the authorization
//      confirmation checkbox carries the agreed copy.
//   4. submit-validation.html — domain-match logic in the inline JS
//      (extractDomain / rootDomain / domainsMatch) handles the simple
//      cases (work mail vs website, http://, www. prefix, sub-domains).
//   5. submit-validation.html — buildPayload extends payload.change_request
//      records with payload.existing_directory_listing and
//      payload.authorization (incl. authorization_method,
//      authorization_status, email_domain_match,
//      registration_code_provided, manual_verification_required).
//   6. redactie-validation.html — change_request render shows the
//      verification status (rv-cr-authorization) and the prefilled
//      public directory data block (rv-cr-existing-directory).
//   7. Directory_Master guard remains in place — the new code does not
//      introduce any code path that mutates Directory_Master, and the
//      "geen automatische wijziging" / "manual_verification_required"
//      copy stays.
//   8. validation-lab.json — listing-change-or-delete-request module
//      records the round-2 exit criteria with explicit Wouter 2026-04-27
//      attribution and lists the new payload fields.
//
// Run with: node scripts/wouter_review_feedback_2026_04_27_round2.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const submitHtml   = fs.readFileSync(path.join(repoRoot, 'submit-validation.html'), 'utf8');
const redactieHtml = fs.readFileSync(path.join(repoRoot, 'redactie-validation.html'), 'utf8');
const manifest     = JSON.parse(fs.readFileSync(path.join(repoRoot, 'validation-lab.json'), 'utf8'));

let failures = 0;
function check(name, fn){
  try { fn(); console.log('  ok  — ' + name); }
  catch(e){ failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

// ── 1. Step 1 instruction ──────────────────────────────────────────────
check('submit-validation.html: step 1 has #sv-step1-next instruction paragraph', () => {
  assert.match(submitHtml, /id="sv-step1-next"/,
    'expected #sv-step1-next anchor inside fieldset 1');
});
check('submit-validation.html: step 1 instruction copy is verbatim', () => {
  assert.ok(
    submitHtml.includes('Kies eerst wat je wilt doen. Daarna ga je hieronder door naar stap 2 om de gegevens in te vullen.'),
    'expected the verbatim Wouter step-1 instruction sentence'
  );
});
check('submit-validation.html: step 1 instruction comes before the mode-switch', () => {
  const idxInstr = submitHtml.indexOf('id="sv-step1-next"');
  const idxSwitch = submitHtml.indexOf('class="mode-switch"');
  assert.ok(idxInstr > 0 && idxSwitch > 0, 'both anchors must exist');
  assert.ok(idxInstr < idxSwitch, 'instruction must come before .mode-switch');
});

// ── 2. Existing-listing prefill (lookup + panel) ────────────────────────
check('submit-validation.html: change/hide section has #sv-cr-lookup search field', () => {
  assert.match(submitHtml, /<input[^>]*\btype="search"[^>]*\bid="sv-cr-lookup"|<input[^>]*\bid="sv-cr-lookup"[^>]*\btype="search"/,
    'expected a <input type="search" id="sv-cr-lookup"> in the change section');
});
check('submit-validation.html: existing-listing panel #sv-cr-existing-panel is wired', () => {
  assert.match(submitHtml, /id="sv-cr-existing-panel"/, 'expected the panel anchor');
  assert.match(submitHtml, /id="sv-cr-existing-list"/, 'expected the dl anchor');
  assert.ok(submitHtml.includes('Bestaande publieke gegevens'),
    'expected the visible heading "Bestaande publieke gegevens"');
});
check('submit-validation.html: prefill explicitly states original is not overwritten', () => {
  assert.ok(submitHtml.includes('niet overschreven'),
    'expected copy stating that original is not overwritten');
});
check('submit-validation.html: lookup loads companies_extracted.json (Directory + Atlas)', () => {
  assert.match(submitHtml, /fetch\(\s*['"]companies_extracted\.json['"]/,
    'expected fetch of companies_extracted.json for the public directory lookup');
});

// ── 3. Bevoegdheid (authorization) section ──────────────────────────────
check('submit-validation.html: Bevoegdheid fieldset #sv-authorization-fieldset exists', () => {
  assert.match(submitHtml, /id="sv-authorization-fieldset"/,
    'expected the dedicated authorization fieldset');
  assert.ok(submitHtml.includes('Bevoegdheid om wijziging aan te vragen'),
    'expected the heading copy "Bevoegdheid om wijziging aan te vragen"');
});
check('submit-validation.html: Bevoegdheid section asks for naam/functie/werkmail/relatie', () => {
  for (const id of ['sv-auth-name','sv-auth-role','sv-auth-email','sv-auth-relation']){
    assert.match(submitHtml, new RegExp('id="'+id+'"'),
      'expected field id ' + id + ' inside Bevoegdheid section');
  }
});
check('submit-validation.html: relation select offers the agreed roles', () => {
  for (const v of ['employee','board','communications','contact','other']){
    assert.match(submitHtml, new RegExp('value="'+v+'"'),
      'expected relation option value="'+v+'"');
  }
});
check('submit-validation.html: confirmation checkbox copy "Ik bevestig dat ik bevoegd ben…" is present', () => {
  assert.match(submitHtml, /id="sv-auth-confirm-authorized"/,
    'expected #sv-auth-confirm-authorized checkbox');
  assert.ok(/Ik bevestig dat ik <strong>bevoegd<\/strong> ben om namens deze organisatie een wijziging of verwijdering aan te vragen/.test(submitHtml),
    'expected verbatim authorization-confirmation copy');
});
check('submit-validation.html: registration-code label uses "registratiecode" — no "password" / "wachtwoord" in UI', () => {
  // The label must talk about registratiecode/verificatiecode, never about password/wachtwoord.
  assert.ok(submitHtml.includes('Registratiecode van de organisatie, als je die hebt'),
    'expected the verbatim registration-code label copy');
  assert.match(submitHtml, /\bregistratiecode\b/i, 'expected the word registratiecode in the UI');
  // The visible UI must not use "password" or "wachtwoord".
  // We allow them in inline comments / autocomplete attribute values? No —
  // the field uses type="text" + autocomplete="off", so neither word should
  // appear in the visible text. Strip script tags conservatively to avoid
  // false-positives on JS strings, then assert the words are absent in text.
  const visible = submitHtml.replace(/<script[\s\S]*?<\/script>/gi, '')
                            .replace(/<style[\s\S]*?<\/style>/gi, '');
  assert.ok(!/\bpassword\b/i.test(visible),
    'no "password" should appear in the visible UI');
  assert.ok(!/\bwachtwoord\b/i.test(visible),
    'no "wachtwoord" should appear in the visible UI');
});
check('submit-validation.html: registration-code field is type="text" (not type="password")', () => {
  // Find the input element with id sv-auth-registration-code
  const m = submitHtml.match(/<input[^>]*id="sv-auth-registration-code"[^>]*>/);
  assert.ok(m, 'expected the registration-code input element');
  assert.ok(!/type="password"/.test(m[0]),
    'registration-code input must NOT be type="password"');
  assert.ok(/type="text"/.test(m[0]),
    'registration-code input must be type="text"');
});

// ── 4. Domain-match logic — text-based check on the helper functions ────
check('submit-validation.html: extractDomain / rootDomain / domainsMatch helpers exist', () => {
  assert.match(submitHtml, /function\s+extractDomain\s*\(/,
    'expected function extractDomain(...)');
  assert.match(submitHtml, /function\s+rootDomain\s*\(/,
    'expected function rootDomain(...)');
  assert.match(submitHtml, /function\s+domainsMatch\s*\(/,
    'expected function domainsMatch(...)');
});
check('submit-validation.html: domain-match logic correctness on simple inputs (sandbox eval)', () => {
  // Pull the three helper functions out of the inline script and execute
  // them in an isolated VM context. This proves the logic actually works
  // — not just that the names are present.
  const grab = (name) => {
    const re = new RegExp(`function\\s+${name}\\s*\\([\\s\\S]*?\\n  \\}`, 'm');
    const m = submitHtml.match(re);
    if (!m) throw new Error('could not isolate function ' + name + ' from inline script');
    return m[0];
  };
  const src = grab('extractDomain') + '\n' + grab('rootDomain') + '\n' + grab('domainsMatch')
    + '\nthis.extractDomain = extractDomain; this.rootDomain = rootDomain; this.domainsMatch = domainsMatch;';
  // Evaluate in a fresh function scope so we don't pollute globals.
  const ctx = {};
  // eslint-disable-next-line no-new-func
  (new Function(src)).call(ctx);
  assert.equal(ctx.extractDomain('Sanne@Veiligheidsregio-Rijnmond.nl'), 'veiligheidsregio-rijnmond.nl');
  assert.equal(ctx.extractDomain('https://www.example.org/path'), 'example.org');
  assert.equal(ctx.rootDomain('mail.sub.example.org'), 'example.org');
  assert.equal(ctx.rootDomain('foo.example.co.uk'), 'example.co.uk');
  assert.equal(ctx.domainsMatch('user.foo@bar.example.org', 'www.example.org'), true);
  assert.equal(ctx.domainsMatch('user@gmail.com', 'example.org'), false);
  assert.equal(ctx.domainsMatch('', 'example.org'), false);
});

// ── 5. Payload extension (existing_directory_listing + authorization) ──
check('submit-validation.html: buildPayload assigns payload.existing_directory_listing for change/hide', () => {
  assert.match(submitHtml, /payload\.existing_directory_listing\s*=/,
    'expected payload.existing_directory_listing assignment in buildPayload');
});
check('submit-validation.html: buildPayload assigns payload.authorization with the required fields', () => {
  const idx = submitHtml.indexOf('payload.authorization');
  assert.ok(idx > 0, 'payload.authorization must be assigned in buildPayload');
  const slice = submitHtml.slice(idx, idx + 1600);
  for (const k of [
    'requester_name', 'requester_role', 'work_email', 'relation',
    'confirmed_authorized', 'registration_code_provided',
    'email_domain_match', 'authorization_method',
    'authorization_status', 'manual_verification_required'
  ]){
    assert.ok(slice.includes(k),
      'expected payload.authorization to carry field "' + k + '"');
  }
  assert.ok(/manual_verification_required\s*:\s*true/.test(slice),
    'manual_verification_required must always be true (no automatic approval)');
});
check('submit-validation.html: existing_directory_listing carries original_unchanged: true', () => {
  assert.match(submitHtml, /original_unchanged:\s*true/,
    'expected original_unchanged: true on existing_directory_listing');
});

// ── 6. Redactie-validation.html displays verification status ────────────
check('redactie-validation.html: rv-cr-authorization section is rendered for CR records', () => {
  assert.match(redactieHtml, /rv-cr-authorization/,
    'expected rv-cr-authorization class on the new section');
  assert.ok(redactieHtml.includes('Bevoegdheid om wijziging aan te vragen — verificatiestatus'),
    'expected the heading copy in redactie-validation.html');
});
check('redactie-validation.html: domain-match label phrasing matches submit form ("domein lijkt te kloppen" / "redactie moet dit handmatig controleren")', () => {
  assert.ok(redactieHtml.includes('domein lijkt te kloppen'),
    'expected positive domain-match copy');
  assert.ok(redactieHtml.includes('redactie moet dit handmatig controleren'),
    'expected handmatige-controle copy on mismatch');
});
check('redactie-validation.html: registration-code, methode, status, manual-check rows are rendered', () => {
  for (const phrase of [
    'Registratiecode opgegeven',
    'Verificatiemethode',
    'Verificatiestatus',
    'Handmatige redactiecontrole'
  ]){
    assert.ok(redactieHtml.includes(phrase),
      'expected verification row label "' + phrase + '" in redactie-validation.html');
  }
});
check('redactie-validation.html: rv-cr-existing-directory section renders prefilled directory data', () => {
  assert.match(redactieHtml, /rv-cr-existing-directory/,
    'expected the rv-cr-existing-directory class on the prefilled-data section');
  assert.ok(redactieHtml.includes('Bestaande publieke gegevens (Directory + Atlas)'),
    'expected the heading "Bestaande publieke gegevens (Directory + Atlas)"');
});
check('redactie-validation.html: tolerates flat authorization_* columns (LAB rows shape)', () => {
  // The branch handles both nested r.authorization and flat
  // authorization_* properties. Sanity-check both code paths exist.
  assert.match(redactieHtml, /r\.authorization\b/,
    'expected nested r.authorization access');
  assert.match(redactieHtml, /authorization_method/,
    'expected fallback to flat authorization_method column');
});

// ── 7. Directory_Master guard / no automatic approval — copy intact ────
check('submit-validation.html: Directory_Master guard copy ("nooit automatisch gewijzigd") still present', () => {
  assert.match(submitHtml, /Directory_Master[\s\S]{0,80}nooit automatisch/,
    'expected the existing Directory_Master nooit-automatisch guard copy');
});
check('submit-validation.html: "Geen automatische goedkeuring" copy is present in the Bevoegdheid section', () => {
  assert.ok(submitHtml.includes('Geen automatische goedkeuring'),
    'expected explicit "Geen automatische goedkeuring" copy under Bevoegdheid');
});
check('redactie-validation.html: Directory_Master untouched copy still present', () => {
  assert.ok(redactieHtml.includes('Directory_Master'),
    'expected Directory_Master to still be referenced in the review panel');
  assert.match(redactieHtml, /Directory_Master[\s\S]{0,200}niet aangeraakt/,
    'expected "Directory_Master ... niet aangeraakt" guard copy');
});

// ── 8. validation-lab.json — round-2 audit trail + payload fields ──────
check('validation-lab.json: top-level wouterReviewFeedback_2026_04_27_round2 entry exists', () => {
  assert.ok(manifest.wouterReviewFeedback_2026_04_27_round2,
    'expected top-level wouterReviewFeedback_2026_04_27_round2 record');
  const r = manifest.wouterReviewFeedback_2026_04_27_round2;
  assert.equal(r.reviewer, 'Wouter');
  assert.equal(r.date, '2026-04-27');
  assert.ok(Array.isArray(r.items) && r.items.length >= 3,
    'expected the round-2 record to list at least 3 items');
});
check('validation-lab.json: listing-change-or-delete-request exitCriteria reference Wouter 2026-04-27 (round 2)', () => {
  const m = manifest.modules.find(m => m.id === 'listing-change-or-delete-request');
  assert.ok(m, 'listing-change-or-delete-request module must exist');
  const wouterCriteria = m.exitCriteria.filter(c => /Wouter feedback 2026-04-27/.test(c));
  assert.ok(wouterCriteria.length >= 4,
    'expected at least 4 exit criteria mentioning the Wouter 2026-04-27 round, got ' + wouterCriteria.length);
});
check('validation-lab.json: listing-change-or-delete-request payloadFields include the new authorization & existing-listing keys', () => {
  const m = manifest.modules.find(m => m.id === 'listing-change-or-delete-request');
  const joined = (m.payloadFields || []).join(' | ');
  for (const key of [
    'existing_directory_listing',
    'authorization',
    'authorization_method',
    'authorization_status',
    'email_domain_match',
    'registration_code_provided',
    'manual_verification_required'
  ]){
    assert.ok(joined.includes(key),
      'expected payloadFields to mention "' + key + '"');
  }
});
check('validation-lab.json: redactie-validation-form module records Wouter 2026-04-27 round-2 verificatiestatus exit criterion', () => {
  const m = manifest.modules.find(m => m.id === 'redactie-validation-form');
  assert.ok(m, 'redactie-validation-form module must exist');
  const hit = m.exitCriteria.some(c => /Wouter feedback 2026-04-27/.test(c) && /verificatiestatus/i.test(c));
  assert.ok(hit, 'expected redactie-validation-form to track the verificatiestatus exit criterion');
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.log(failures + ' check(s) FAILED');
  process.exit(1);
}
console.log('All Wouter feedback round-2 (2026-04-27) checks passed.');
