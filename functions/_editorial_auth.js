// Shared server-side auth for the editorial / redactie area.
//
// Threat model
// ------------
// `/redactie/*`, `/redactie-validation.html` and `/api/lab-intake` are
// internal-only surfaces. They must never be reachable by an unauthenticated
// public visitor — even with `noindex` headers, a publicly reachable form
// can be submitted by anyone who guesses the URL. Robots / noindex are SEO
// hygiene, not security.
//
// Two independent gates are supported, in order of preference:
//
//   1. **Cloudflare Access** — if the deploy is fronted by an Access policy
//      every request carries a signed `Cf-Access-Jwt-Assertion` header (and
//      a matching `CF_Authorization` cookie). The header is set by the
//      Access edge after the user passes the configured identity provider.
//      Cloudflare also exposes `Cf-Access-Authenticated-User-Email` for
//      logging. We treat the *presence* of a non-empty assertion as "the
//      Access edge has authenticated this user". Full JWKS verification is
//      only required if the deploy can be reached without Access in front
//      of it; for that case we run a structural check (3 dot-separated
//      base64url segments, decodable header+payload, unexpired exp claim,
//      audience matching `EDITORIAL_ACCESS_AUD` if configured). This is
//      defence-in-depth, not a substitute for the Access policy itself.
//
//   2. **Shared-secret token** — fallback for when Access cannot be
//      configured (e.g. preview deploys, repo-only changes). The editor
//      enters a token at `/redactie/login`; on success the server sets a
//      `__esrf_red` HttpOnly + Secure cookie that contains an HMAC-SHA-256
//      MAC over the timestamp. Subsequent requests are accepted while the
//      cookie is non-expired and the MAC verifies against
//      `EDITORIAL_ACCESS_SECRET`. The token itself is never written to the
//      cookie. The expected token can be configured via:
//
//        EDITORIAL_ACCESS_TOKEN     — exact-match expected user token
//        EDITORIAL_ACCESS_SECRET    — HMAC key for cookie MAC
//
//      Both are read from Cloudflare Pages environment variables and never
//      hard-coded. If `EDITORIAL_ACCESS_TOKEN` is missing the server-side
//      gate refuses every login (fail-closed).
//
// Server-to-server
// ----------------
// The lab-intake endpoint also accepts a server-to-server call signed with
// the existing `LAB_INTAKE_SHEET_WEBHOOK_SECRET` / `SHEETS_WEBHOOK_SECRET`
// header (`x-esrf-intake-secret`). This is preserved to avoid breaking any
// scripted intake pipeline.
//
// All checks are constant-time where possible.

const COOKIE_NAME = '__esrf_red';
const COOKIE_TTL_SECONDS = 8 * 60 * 60; // 8h editorial session

// Max acceptable clock skew when validating Cloudflare Access JWT exp claim.
const JWT_EXP_SKEW_SECONDS = 60;

// -------------------------------------------------------------------------
// Cloudflare Access detection
// -------------------------------------------------------------------------

function getAccessAssertion(request) {
  return (
    request.headers.get('cf-access-jwt-assertion') ||
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    ''
  ).trim();
}

function getAccessUserEmail(request) {
  return (
    request.headers.get('cf-access-authenticated-user-email') ||
    request.headers.get('Cf-Access-Authenticated-User-Email') ||
    ''
  ).trim();
}

// Decode a base64url segment to UTF-8. Returns '' on failure.
function b64urlDecode(segment) {
  try {
    let s = String(segment).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    if (typeof atob === 'function') {
      const binary = atob(s);
      let out = '';
      for (let i = 0; i < binary.length; i++) out += String.fromCharCode(binary.charCodeAt(i));
      return decodeURIComponent(escape(out));
    }
    // Node fallback (used by tests)
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

// Lightweight structural check on a Cloudflare Access JWT. We do NOT verify
// the signature here because:
//   - When Access is correctly configured the assertion is set by the edge
//     and unforgeable to outside callers (the edge strips inbound copies).
//   - Full JWKS verification requires fetching the team's public keys and
//     would add an external dependency for a defence-in-depth check.
//
// We require:
//   - three dot-separated segments
//   - decodable header + payload JSON
//   - non-expired `exp` claim
//   - `aud` claim matches EDITORIAL_ACCESS_AUD if configured
function isStructurallyValidAccessJwt(token, env) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const headerJson = b64urlDecode(parts[0]);
  const payloadJson = b64urlDecode(parts[1]);
  if (!headerJson || !payloadJson) return false;
  let payload;
  try { payload = JSON.parse(payloadJson); }
  catch { return false; }
  if (!payload || typeof payload !== 'object') return false;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp + JWT_EXP_SKEW_SECONDS < now) return false;
  const expectedAud = env && env.EDITORIAL_ACCESS_AUD ? String(env.EDITORIAL_ACCESS_AUD).trim() : '';
  if (expectedAud) {
    const aud = payload.aud;
    const audMatch = Array.isArray(aud)
      ? aud.includes(expectedAud)
      : aud === expectedAud;
    if (!audMatch) return false;
  }
  return true;
}

// -------------------------------------------------------------------------
// Cookie helpers (shared-secret fallback)
// -------------------------------------------------------------------------

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  if (!header) return '';
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

function constantTimeEqual(a, b) {
  const aa = String(a || '');
  const bb = String(b || '');
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return diff === 0;
}

// Produce a hex-encoded HMAC-SHA-256 of message with key. Uses Web Crypto
// (Cloudflare Workers / browser) and falls back to node:crypto for tests.
async function hmacSha256Hex(keyStr, message) {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(keyStr),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    const bytes = new Uint8Array(sig);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHmac('sha256', keyStr).update(message).digest('hex');
}

// Cookie body: base64url("<issued_at>.<mac>") where mac = HMAC(secret, "<issued_at>").
// Issued_at is unix seconds; we expire COOKIE_TTL_SECONDS later.
async function buildSessionCookie(env) {
  const secret = String(env && env.EDITORIAL_ACCESS_SECRET || '').trim();
  if (!secret) throw new Error('editorial-access-secret-missing');
  const iat = Math.floor(Date.now() / 1000);
  const mac = await hmacSha256Hex(secret, String(iat));
  const value = `${iat}.${mac}`;
  return {
    name: COOKIE_NAME,
    value,
    maxAge: COOKIE_TTL_SECONDS,
  };
}

async function isValidSessionCookie(request, env) {
  const secret = String(env && env.EDITORIAL_ACCESS_SECRET || '').trim();
  if (!secret) return false;
  const raw = readCookie(request, COOKIE_NAME);
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot <= 0) return false;
  const iatStr = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const iat = Number(iatStr);
  if (!Number.isFinite(iat) || iat <= 0) return false;
  const now = Math.floor(Date.now() / 1000);
  if (iat + COOKIE_TTL_SECONDS < now) return false;
  if (iat - JWT_EXP_SKEW_SECONDS > now) return false;
  let expected;
  try { expected = await hmacSha256Hex(secret, String(iat)); }
  catch { return false; }
  return constantTimeEqual(mac, expected);
}

function buildSetCookieHeader(name, value, maxAge) {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  if (typeof maxAge === 'number' && maxAge > 0) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

function buildClearCookieHeader(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// -------------------------------------------------------------------------
// Authorisation entry point
// -------------------------------------------------------------------------

// Returns { authorized: boolean, method: string, email?: string }.
async function isEditorialAuthorized(request, env) {
  const e = env || {};

  // 1. Cloudflare Access — preferred
  const jwt = getAccessAssertion(request);
  if (jwt) {
    if (isStructurallyValidAccessJwt(jwt, e)) {
      return {
        authorized: true,
        method: 'cloudflare-access',
        email: getAccessUserEmail(request),
      };
    }
  }

  // 2. Shared-secret session cookie
  if (await isValidSessionCookie(request, e)) {
    return { authorized: true, method: 'shared-secret-cookie' };
  }

  return { authorized: false, method: 'none' };
}

// Server-to-server secret check for /api/lab-intake. Preserved from the
// original lab-intake.js logic; used as an alternative to the editorial
// session for trusted scripted callers (e.g. the Apps Script return path).
function hasServerToServerSecret(request, env) {
  const provided = String(request.headers.get('x-esrf-intake-secret') || '').trim();
  if (!provided) return false;
  const candidates = [
    env && env.LAB_INTAKE_SHEET_WEBHOOK_SECRET,
    env && env.SHEETS_WEBHOOK_SECRET,
    env && env.INTAKE_SHEET_WEBHOOK_SECRET,
  ].map(v => String(v || '').trim()).filter(Boolean);
  for (const c of candidates) {
    if (constantTimeEqual(provided, c)) return true;
  }
  return false;
}

// 401 response for protected HTML routes. Redirect to /redactie/login when
// the request looks like an interactive browser navigation; respond 401
// otherwise. We do NOT echo the requested URL into the redirect to avoid
// open-redirect issues from spoofed Referer values.
function buildHtmlAuthChallenge(url) {
  const target = new URL('/redactie/login', url);
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive',
    },
  });
}

// 401 response for protected API routes (always JSON, never HTML redirect).
function buildApiAuthChallenge() {
  return new Response(JSON.stringify({
    ok: false,
    error: 'unauthorized',
    detail: 'Editorial access required. Authenticate via Cloudflare Access or POST a shared-secret token to /redactie/login.',
  }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'www-authenticate': 'Bearer realm="editorial"',
    },
  });
}

export {
  COOKIE_NAME,
  COOKIE_TTL_SECONDS,
  isEditorialAuthorized,
  hasServerToServerSecret,
  buildHtmlAuthChallenge,
  buildApiAuthChallenge,
  buildSessionCookie,
  buildSetCookieHeader,
  buildClearCookieHeader,
  isStructurallyValidAccessJwt,
  isValidSessionCookie,
  hmacSha256Hex,
  constantTimeEqual,
  readCookie,
  getAccessAssertion,
  getAccessUserEmail,
};

if (typeof globalThis !== 'undefined') {
  globalThis.__esrfEditorialAuth = {
    COOKIE_NAME,
    COOKIE_TTL_SECONDS,
    isEditorialAuthorized,
    hasServerToServerSecret,
    buildHtmlAuthChallenge,
    buildApiAuthChallenge,
    buildSessionCookie,
    buildSetCookieHeader,
    buildClearCookieHeader,
    isStructurallyValidAccessJwt,
    isValidSessionCookie,
    hmacSha256Hex,
    constantTimeEqual,
    readCookie,
    getAccessAssertion,
    getAccessUserEmail,
  };
}
