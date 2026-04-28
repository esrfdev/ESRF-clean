// Cloudflare Pages Function — middleware for the editorial area.
//
// Protects every request to /redactie/* (the dedicated editorial entry
// area). The /redactie/login page is the only allow-listed sub-route so a
// not-yet-authenticated editor can reach the token form. Every other path
// requires either a Cloudflare Access assertion OR a valid shared-secret
// session cookie (see ../_editorial_auth.js for the threat model).
//
// noindex headers are added for defence-in-depth; they are SEO hygiene and
// not the primary control — that's the auth check above.

import {
  isEditorialAuthorized,
  buildHtmlAuthChallenge,
} from '../_editorial_auth.js';

// Paths under /redactie that must remain publicly reachable so the auth
// flow itself works. /redactie/login (HTML) renders the login form and
// /redactie/login (POST handled by the function) verifies the token. Both
// share the same path; the function decides by HTTP method.
const PUBLIC_REDACTIE_PATHS = new Set([
  '/redactie/login',
  '/redactie/login/',
  '/redactie/login.html',
]);

function isPublicRedactiePath(pathname) {
  return PUBLIC_REDACTIE_PATHS.has(pathname);
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  // noindex defence-in-depth (security comes from the auth check above).
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  headers.set('cache-control', 'no-store');
  headers.set('referrer-policy', 'no-referrer');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (isPublicRedactiePath(url.pathname)) {
    const res = await next();
    return withSecurityHeaders(res);
  }

  const auth = await isEditorialAuthorized(request, env);
  if (!auth.authorized) {
    return buildHtmlAuthChallenge(url);
  }

  const res = await next();
  return withSecurityHeaders(res);
}
