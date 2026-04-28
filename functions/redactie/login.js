// Cloudflare Pages Function — /redactie/login
//
// GET  : renders a minimal Dutch login form (token field).
// POST : verifies the submitted token against EDITORIAL_ACCESS_TOKEN
//        (Cloudflare Pages env var). On match, sets the HMAC-signed
//        editorial session cookie and redirects to /redactie/. On mismatch
//        or missing config, returns a 401 with a generic error message.
//
// The token itself is never stored in the cookie or echoed back to the
// client — only an HMAC-signed timestamp issued at login time. See
// ../_editorial_auth.js for the cookie format.

import {
  COOKIE_NAME,
  COOKIE_TTL_SECONDS,
  buildSessionCookie,
  buildSetCookieHeader,
  buildClearCookieHeader,
  constantTimeEqual,
  isEditorialAuthorized,
} from '../_editorial_auth.js';

const LOGIN_HTML = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow,noarchive" />
<title>Redactie — inloggen (intern)</title>
<style>
  body { margin:0; font-family:'Archivo',system-ui,sans-serif; background:#f7f7f4; color:#1a1a1a; line-height:1.55; }
  main { max-width:480px; margin:0 auto; padding:48px 24px; }
  h1 { font-family:'PT Serif',Georgia,serif; font-size:24px; margin:0 0 8px; }
  p { color:#555; margin:0 0 16px; font-size:14px; }
  label { display:block; margin-top:14px; font-weight:600; font-size:14px; }
  input[type="password"], input[type="text"] {
    width:100%; border:1px solid #d8d6cf; border-radius:4px; padding:10px;
    font:inherit; background:#fff; margin-top:6px;
  }
  button { margin-top:18px; background:#b03a2e; color:#fff; border:0; border-radius:4px;
    padding:10px 18px; font:inherit; font-weight:600; cursor:pointer; }
  .err { background:#fce8e8; border:1px solid #d28a8a; padding:10px 12px;
    border-radius:4px; margin-top:18px; font-size:14px; }
  .note { background:#fff8e1; border:1px solid #f0c060; padding:10px 12px;
    border-radius:4px; margin:16px 0; font-size:13px; }
  code { font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:13px; }
</style>
</head>
<body>
<main>
  <h1>Redactie — inloggen</h1>
  <p>Interne ingang voor de ESRF-redactie. Niet bestemd voor publieke
     bezoekers. Voer het redactie-token in dat de coördinator je heeft
     gegeven.</p>
  <div class="note">
    <strong>Voorkeur.</strong> Productie hoort achter Cloudflare Access te
    staan. Deze tokenpagina is de fallback voor preview-omgevingen of
    wanneer Access tijdelijk niet werkt.
  </div>
  __ERROR__
  <form method="POST" action="/redactie/login" autocomplete="off">
    <label for="token">Redactie-token
      <input type="password" id="token" name="token" required autocomplete="off" />
    </label>
    <button type="submit">Inloggen</button>
  </form>
</main>
</body>
</html>
`;

function htmlResponse(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  });
}

function renderLogin(errorMessage) {
  const safeErr = errorMessage
    ? `<div class="err">${escapeHtml(errorMessage)}</div>`
    : '';
  return htmlResponse(LOGIN_HTML.replace('__ERROR__', safeErr), 200);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  // If the editor is already authorised, send them straight to the area.
  const auth = await isEditorialAuthorized(request, env);
  if (auth.authorized) {
    const target = new URL('/redactie/', request.url);
    return new Response(null, {
      status: 302,
      headers: {
        location: target.toString(),
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow, noarchive',
      },
    });
  }
  return renderLogin('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const expected = String(env && env.EDITORIAL_ACCESS_TOKEN || '').trim();
  const sessionSecret = String(env && env.EDITORIAL_ACCESS_SECRET || '').trim();

  // Fail-closed if the deploy is missing config. Show a generic message —
  // do not leak which env var is missing to outside callers.
  if (!expected || !sessionSecret) {
    return renderLogin(
      'Inloggen is op deze omgeving (nog) niet geconfigureerd. Vraag de coördinator om Cloudflare Access aan te zetten of EDITORIAL_ACCESS_TOKEN/EDITORIAL_ACCESS_SECRET te configureren.'
    );
  }

  let provided = '';
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      const params = new URLSearchParams(text);
      provided = String(params.get('token') || '').trim();
    } else if (ct.includes('application/json')) {
      const j = await request.json();
      provided = String((j && j.token) || '').trim();
    } else {
      // Try form-data as a fallback.
      try {
        const fd = await request.formData();
        provided = String(fd.get('token') || '').trim();
      } catch { provided = ''; }
    }
  } catch {
    provided = '';
  }

  if (!provided || !constantTimeEqual(provided, expected)) {
    return renderLogin('Token ongeldig. Controleer met de coördinator.');
  }

  let cookie;
  try { cookie = await buildSessionCookie(env); }
  catch {
    return renderLogin(
      'Sessie kan niet worden ondertekend (server config ontbreekt). Vraag de coördinator om EDITORIAL_ACCESS_SECRET te configureren.'
    );
  }

  const target = new URL('/redactie/', request.url);
  return new Response(null, {
    status: 303,
    headers: {
      location: target.toString(),
      'set-cookie': buildSetCookieHeader(cookie.name, cookie.value, cookie.maxAge),
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

export async function onRequestDelete(context) {
  const target = new URL('/redactie/login', context.request.url);
  return new Response(null, {
    status: 302,
    headers: {
      location: target.toString(),
      'set-cookie': buildClearCookieHeader(COOKIE_NAME),
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive',
    },
  });
}

export async function onRequest(context) {
  const m = context.request.method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return onRequestGet(context);
  if (m === 'POST') return onRequestPost(context);
  if (m === 'DELETE') return onRequestDelete(context);
  return new Response('Method not allowed\n', {
    status: 405,
    headers: { 'allow': 'GET, POST, DELETE', 'content-type': 'text/plain' },
  });
}

void COOKIE_TTL_SECONDS; // referenced for documentation
