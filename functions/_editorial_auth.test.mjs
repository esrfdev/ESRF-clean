// Self-contained tests for the editorial auth gate.
//
// Run with: node functions/_editorial_auth.test.mjs
// Exits 0 on success, 1 on any failed assertion.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

await import('./_editorial_auth.js');
const auth = globalThis.__esrfEditorialAuth;
assert.ok(auth, '_editorial_auth.js did not expose test hooks on globalThis');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok  - ' + name); }
  catch (e) { failures++; console.log('FAIL - ' + name); console.log('       ' + (e && e.message || e)); }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ok  - ' + name); }
  catch (e) { failures++; console.log('FAIL - ' + name); console.log('       ' + (e && e.message || e)); }
}

// ── readCookie ────────────────────────────────────────────────────────────
check('readCookie returns the named cookie value', () => {
  const req = new Request('https://esrf.net/', {
    headers: { cookie: 'foo=bar; __esrf_red=xyz; baz=1' },
  });
  assert.equal(auth.readCookie(req, '__esrf_red'), 'xyz');
  assert.equal(auth.readCookie(req, 'foo'), 'bar');
  assert.equal(auth.readCookie(req, 'absent'), '');
});

// ── constantTimeEqual ─────────────────────────────────────────────────────
check('constantTimeEqual compares equal-length strings', () => {
  assert.equal(auth.constantTimeEqual('abc', 'abc'), true);
  assert.equal(auth.constantTimeEqual('abc', 'abd'), false);
  assert.equal(auth.constantTimeEqual('abc', 'abcd'), false);
  assert.equal(auth.constantTimeEqual('', ''), true);
});

// ── isStructurallyValidAccessJwt ──────────────────────────────────────────
function makeJwt({ exp, aud } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k' })).toString('base64url');
  const claims = {};
  if (typeof exp === 'number') claims.exp = exp;
  if (aud) claims.aud = aud;
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = Buffer.from('sig').toString('base64url');
  return `${header}.${payload}.${sig}`;
}

check('isStructurallyValidAccessJwt rejects malformed tokens', () => {
  assert.equal(auth.isStructurallyValidAccessJwt('', {}), false);
  assert.equal(auth.isStructurallyValidAccessJwt('abc', {}), false);
  assert.equal(auth.isStructurallyValidAccessJwt('a.b', {}), false);
  assert.equal(auth.isStructurallyValidAccessJwt('@@.@@.@@', {}), false);
});
check('isStructurallyValidAccessJwt rejects expired tokens', () => {
  const t = makeJwt({ exp: Math.floor(Date.now() / 1000) - 7200 });
  assert.equal(auth.isStructurallyValidAccessJwt(t, {}), false);
});
check('isStructurallyValidAccessJwt accepts non-expired tokens', () => {
  const t = makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 });
  assert.equal(auth.isStructurallyValidAccessJwt(t, {}), true);
});
check('isStructurallyValidAccessJwt enforces aud when EDITORIAL_ACCESS_AUD is set', () => {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const tGood = makeJwt({ exp, aud: 'editorial' });
  const tBad = makeJwt({ exp, aud: 'something-else' });
  assert.equal(auth.isStructurallyValidAccessJwt(tGood, { EDITORIAL_ACCESS_AUD: 'editorial' }), true);
  assert.equal(auth.isStructurallyValidAccessJwt(tBad, { EDITORIAL_ACCESS_AUD: 'editorial' }), false);
});

// ── Session cookie roundtrip ──────────────────────────────────────────────
await checkAsync('buildSessionCookie + isValidSessionCookie roundtrip', async () => {
  const env = { EDITORIAL_ACCESS_SECRET: 'top-secret' };
  const c = await auth.buildSessionCookie(env);
  assert.equal(c.name, '__esrf_red');
  const req = new Request('https://esrf.net/redactie/', {
    headers: { cookie: `${c.name}=${c.value}` },
  });
  assert.equal(await auth.isValidSessionCookie(req, env), true);
});
await checkAsync('isValidSessionCookie rejects mismatched MAC', async () => {
  const env = { EDITORIAL_ACCESS_SECRET: 'top-secret' };
  const c = await auth.buildSessionCookie(env);
  const tampered = c.value.split('.')[0] + '.deadbeef';
  const req = new Request('https://esrf.net/redactie/', {
    headers: { cookie: `${c.name}=${tampered}` },
  });
  assert.equal(await auth.isValidSessionCookie(req, env), false);
});
await checkAsync('isValidSessionCookie returns false when secret is missing', async () => {
  const req = new Request('https://esrf.net/redactie/', {
    headers: { cookie: '__esrf_red=12345.deadbeef' },
  });
  assert.equal(await auth.isValidSessionCookie(req, { EDITORIAL_ACCESS_SECRET: '' }), false);
});

// ── isEditorialAuthorized ─────────────────────────────────────────────────
await checkAsync('isEditorialAuthorized = false on unauthenticated request', async () => {
  const req = new Request('https://esrf.net/redactie/');
  const r = await auth.isEditorialAuthorized(req, {});
  assert.equal(r.authorized, false);
});
await checkAsync('isEditorialAuthorized = true with Cloudflare Access JWT', async () => {
  const req = new Request('https://esrf.net/redactie/', {
    headers: {
      'cf-access-jwt-assertion': makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
      'cf-access-authenticated-user-email': 'office@esrf.net',
    },
  });
  const r = await auth.isEditorialAuthorized(req, {});
  assert.equal(r.authorized, true);
  assert.equal(r.method, 'cloudflare-access');
  assert.equal(r.email, 'office@esrf.net');
});
await checkAsync('isEditorialAuthorized = true with valid session cookie', async () => {
  const env = { EDITORIAL_ACCESS_SECRET: 'top-secret' };
  const c = await auth.buildSessionCookie(env);
  const req = new Request('https://esrf.net/redactie/', {
    headers: { cookie: `${c.name}=${c.value}` },
  });
  const r = await auth.isEditorialAuthorized(req, env);
  assert.equal(r.authorized, true);
  assert.equal(r.method, 'shared-secret-cookie');
});

// ── Email allowlist (EDITORIAL_ALLOWED_EMAILS) ────────────────────────────
check('getAllowedEmails defaults to office@esrf.net when env is empty', () => {
  assert.deepEqual(auth.getAllowedEmails({}), ['office@esrf.net']);
  assert.deepEqual(auth.getAllowedEmails({ EDITORIAL_ALLOWED_EMAILS: '' }), ['office@esrf.net']);
  assert.deepEqual(auth.getAllowedEmails({ EDITORIAL_ALLOWED_EMAILS: '   ' }), ['office@esrf.net']);
});
check('getAllowedEmails parses comma/space/semicolon list, lowercased', () => {
  assert.deepEqual(
    auth.getAllowedEmails({ EDITORIAL_ALLOWED_EMAILS: 'A@esrf.net, B@ESRF.net;c@esrf.net' }),
    ['a@esrf.net', 'b@esrf.net', 'c@esrf.net'],
  );
});
check('isEmailAllowed accepts default office@esrf.net (case-insensitive)', () => {
  assert.equal(auth.isEmailAllowed('office@esrf.net', {}), true);
  assert.equal(auth.isEmailAllowed('Office@ESRF.NET', {}), true);
  assert.equal(auth.isEmailAllowed('   office@esrf.net   ', {}), true);
});
check('isEmailAllowed rejects non-allowlisted addresses (incl. wouter.mouthaan@gmail.com)', () => {
  assert.equal(auth.isEmailAllowed('wouter.mouthaan@gmail.com', {}), false);
  assert.equal(auth.isEmailAllowed('attacker@example.com', {}), false);
  assert.equal(auth.isEmailAllowed('', {}), false);
  assert.equal(auth.isEmailAllowed(null, {}), false);
});
check('isEmailAllowed honours an env override of EDITORIAL_ALLOWED_EMAILS', () => {
  const env = { EDITORIAL_ALLOWED_EMAILS: 'office@esrf.net,coordinator@esrf.net' };
  assert.equal(auth.isEmailAllowed('coordinator@esrf.net', env), true);
  assert.equal(auth.isEmailAllowed('office@esrf.net', env), true);
  assert.equal(auth.isEmailAllowed('wouter.mouthaan@gmail.com', env), false);
});

await checkAsync('isEditorialAuthorized rejects non-allowlisted Access email', async () => {
  const req = new Request('https://esrf.net/redactie/', {
    headers: {
      'cf-access-jwt-assertion': makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
      'cf-access-authenticated-user-email': 'someone-else@esrf.net',
    },
  });
  const r = await auth.isEditorialAuthorized(req, {});
  assert.equal(r.authorized, false);
  assert.equal(r.method, 'cloudflare-access');
  assert.equal(r.reason, 'email-not-in-allowlist');
});
await checkAsync('isEditorialAuthorized rejects empty Access email even with valid JWT', async () => {
  const req = new Request('https://esrf.net/redactie/', {
    headers: { 'cf-access-jwt-assertion': makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 }) },
  });
  const r = await auth.isEditorialAuthorized(req, {});
  assert.equal(r.authorized, false);
  assert.equal(r.reason, 'email-not-in-allowlist');
});
await checkAsync('isEditorialAuthorized rejects wouter.mouthaan@gmail.com', async () => {
  const req = new Request('https://esrf.net/redactie/', {
    headers: {
      'cf-access-jwt-assertion': makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
      'cf-access-authenticated-user-email': 'wouter.mouthaan@gmail.com',
    },
  });
  const r = await auth.isEditorialAuthorized(req, {});
  assert.equal(r.authorized, false);
});
await checkAsync('isEditorialAuthorized accepts allowlisted secondary email when env is set', async () => {
  const env = { EDITORIAL_ALLOWED_EMAILS: 'office@esrf.net, redactie@esrf.net' };
  const req = new Request('https://esrf.net/redactie/', {
    headers: {
      'cf-access-jwt-assertion': makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
      'cf-access-authenticated-user-email': 'redactie@esrf.net',
    },
  });
  const r = await auth.isEditorialAuthorized(req, env);
  assert.equal(r.authorized, true);
  assert.equal(r.email, 'redactie@esrf.net');
});

// ── hasServerToServerSecret ───────────────────────────────────────────────
check('hasServerToServerSecret accepts matching x-esrf-intake-secret', () => {
  const req = new Request('https://esrf.net/api/lab-intake', {
    method: 'POST',
    headers: { 'x-esrf-intake-secret': 'sup3r' },
  });
  assert.equal(auth.hasServerToServerSecret(req, { LAB_INTAKE_SHEET_WEBHOOK_SECRET: 'sup3r' }), true);
  assert.equal(auth.hasServerToServerSecret(req, { SHEETS_WEBHOOK_SECRET: 'sup3r' }), true);
  assert.equal(auth.hasServerToServerSecret(req, { INTAKE_SHEET_WEBHOOK_SECRET: 'sup3r' }), true);
  assert.equal(auth.hasServerToServerSecret(req, { LAB_INTAKE_SHEET_WEBHOOK_SECRET: 'wrong' }), false);
});

// ── /redactie middleware integration ──────────────────────────────────────
const middleware = await import('./redactie/_middleware.js');
const loginFn = await import('./redactie/login.js');
const labIntakeGate = await import('./redactie-validation.js');

async function callMiddleware({ url, headers = {}, env = {} } = {}) {
  const req = new Request(url, { headers });
  let nextCalled = false;
  const next = async () => {
    nextCalled = true;
    return new Response('OK', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const res = await middleware.onRequest({ request: req, env, next });
  return { res, nextCalled };
}

await checkAsync('middleware redirects unauthenticated /redactie/ to /redactie/login', async () => {
  const { res, nextCalled } = await callMiddleware({ url: 'https://esrf.net/redactie/' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://esrf.net/redactie/login');
  assert.equal(nextCalled, false);
});

await checkAsync('middleware lets /redactie/login pass through unauthenticated', async () => {
  const { res, nextCalled } = await callMiddleware({ url: 'https://esrf.net/redactie/login' });
  assert.equal(res.status, 200);
  assert.equal(nextCalled, true);
  assert.match(res.headers.get('x-robots-tag') || '', /noindex/);
});

await checkAsync('middleware lets authenticated requests through (Access JWT, allowlisted email)', async () => {
  const { res, nextCalled } = await callMiddleware({
    url: 'https://esrf.net/redactie/',
    headers: {
      'cf-access-jwt-assertion': makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
      'cf-access-authenticated-user-email': 'office@esrf.net',
    },
  });
  assert.equal(res.status, 200);
  assert.equal(nextCalled, true);
  assert.match(res.headers.get('x-robots-tag') || '', /noindex/);
});

await checkAsync('middleware redirects authenticated-but-not-allowlisted email to login', async () => {
  const { res, nextCalled } = await callMiddleware({
    url: 'https://esrf.net/redactie/',
    headers: {
      'cf-access-jwt-assertion': makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
      'cf-access-authenticated-user-email': 'someone-else@esrf.net',
    },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://esrf.net/redactie/login');
  assert.equal(nextCalled, false);
});

await checkAsync('middleware redirects wouter.mouthaan@gmail.com (must NOT be allowlisted)', async () => {
  const { res } = await callMiddleware({
    url: 'https://esrf.net/redactie/',
    headers: {
      'cf-access-jwt-assertion': makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
      'cf-access-authenticated-user-email': 'wouter.mouthaan@gmail.com',
    },
  });
  assert.equal(res.status, 302);
});

await checkAsync('middleware lets authenticated requests through (cookie)', async () => {
  const env = { EDITORIAL_ACCESS_SECRET: 'top-secret' };
  const c = await auth.buildSessionCookie(env);
  const { res, nextCalled } = await callMiddleware({
    url: 'https://esrf.net/redactie/',
    env,
    headers: { cookie: `${c.name}=${c.value}` },
  });
  assert.equal(res.status, 200);
  assert.equal(nextCalled, true);
});

// ── /redactie/login function ─────────────────────────────────────────────
await checkAsync('login GET renders the form when not authenticated', async () => {
  const req = new Request('https://esrf.net/redactie/login');
  const res = await loginFn.onRequest({ request: req, env: {} });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Redactie-token/);
  assert.match(body, /method="POST"/);
});

await checkAsync('login POST without env config refuses', async () => {
  const req = new Request('https://esrf.net/redactie/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'token=anything',
  });
  const res = await loginFn.onRequest({ request: req, env: {} });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /niet geconfigureerd|configureren/i);
});

await checkAsync('login POST with wrong token refuses', async () => {
  const req = new Request('https://esrf.net/redactie/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'token=guess',
  });
  const res = await loginFn.onRequest({
    request: req,
    env: { EDITORIAL_ACCESS_TOKEN: 'real-token', EDITORIAL_ACCESS_SECRET: 'sig-key' },
  });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Token ongeldig/i);
});

await checkAsync('login POST with correct token sets cookie + redirects', async () => {
  const req = new Request('https://esrf.net/redactie/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'token=real-token',
  });
  const res = await loginFn.onRequest({
    request: req,
    env: { EDITORIAL_ACCESS_TOKEN: 'real-token', EDITORIAL_ACCESS_SECRET: 'sig-key' },
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://esrf.net/redactie/');
  const setCookie = res.headers.get('set-cookie') || '';
  assert.match(setCookie, /__esrf_red=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
});

await checkAsync('login DELETE clears the cookie', async () => {
  const req = new Request('https://esrf.net/redactie/login', { method: 'DELETE' });
  const res = await loginFn.onRequest({ request: req, env: {} });
  assert.equal(res.status, 302);
  const sc = res.headers.get('set-cookie') || '';
  assert.match(sc, /__esrf_red=;.*Max-Age=0/);
});

// ── /redactie-validation.html gate ───────────────────────────────────────
await checkAsync('redactie-validation gate redirects unauthenticated visitor', async () => {
  const req = new Request('https://esrf.net/redactie-validation.html');
  const res = await labIntakeGate.onRequest({ request: req, env: {} });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://esrf.net/redactie/login');
});

await checkAsync('redactie-validation gate serves asset for authenticated visitor', async () => {
  const env = { EDITORIAL_ACCESS_SECRET: 'top-secret' };
  const c = await auth.buildSessionCookie(env);
  const req = new Request('https://esrf.net/redactie-validation.html', {
    headers: { cookie: `${c.name}=${c.value}` },
  });
  const res = await labIntakeGate.onRequest({ request: req, env });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-robots-tag') || '', /noindex/);
});

// ── Static asset checks ──────────────────────────────────────────────────
const indexHtml = fs.readFileSync(path.join(repoRoot, 'redactie', 'index.html'), 'utf8');
check('redactie/index.html has noindex meta + canonical', () => {
  assert.match(indexHtml, /<meta\s+name="robots"\s+content="noindex/);
  assert.match(indexHtml, /<link rel="canonical"/);
});
check('redactie/index.html links to all required cards (add-org, validate, public, docs)', () => {
  assert.match(indexHtml, /redactie-validation\.html\?mode=editorial_add_org/);
  assert.match(indexHtml, /\/submit-news\.html/);
  assert.match(indexHtml, /EDITORIAL-WORKFLOW/);
});
check('redactie/index.html does not expose env-var values or secrets', () => {
  for (const needle of [
    'EDITORIAL_ACCESS_TOKEN=', 'EDITORIAL_ACCESS_SECRET=',
    'shared_secret', 'docs.google.com/spreadsheets',
  ]) {
    assert.ok(!indexHtml.includes(needle), 'unexpected leak: ' + needle);
  }
});

const headersTxt = fs.readFileSync(path.join(repoRoot, '_headers'), 'utf8');
check('_headers carries noindex on /redactie/* and /redactie/login', () => {
  assert.match(headersTxt, /\/redactie\/\*/);
  assert.match(headersTxt, /\/redactie\/login/);
  assert.match(headersTxt, /\/api\/lab-intake/);
});

const robots = fs.readFileSync(path.join(repoRoot, 'robots.txt'), 'utf8');
check('robots.txt disallows /redactie/, redactie-validation.html and /api/lab-intake', () => {
  assert.match(robots, /Disallow:\s*\/redactie\//);
  assert.match(robots, /Disallow:\s*\/redactie-validation\.html/);
  assert.match(robots, /Disallow:\s*\/api\/lab-intake/);
});

const sitemap = fs.readFileSync(path.join(repoRoot, 'sitemap.xml'), 'utf8');
check('sitemap.xml does NOT include /redactie/', () => {
  assert.ok(!sitemap.includes('/redactie/'));
  assert.ok(!sitemap.includes('redactie-validation'));
});

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed');
  process.exit(1);
} else {
  console.log('\nAll editorial-auth checks passed.');
}
