// Cloudflare Pages Function — gate for /redactie-validation.html
//
// The static HTML file `redactie-validation.html` lives at the repo root and
// is therefore served by the Pages asset pipeline by default. We mount this
// Function at `/redactie-validation.html` so every request — including a
// direct hit on the .html URL — is intercepted by the editorial-auth check
// before the asset is returned.
//
// On unauthenticated requests we redirect to /redactie/login (interactive
// browsers) instead of returning a bare 401, so editors who follow a stale
// bookmark or link land on the login form and can recover.

import {
  isEditorialAuthorized,
  buildHtmlAuthChallenge,
} from './_editorial_auth.js';

async function fetchAsset(env, request) {
  if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
    return env.ASSETS.fetch(request);
  }
  // Local dev / test fallback: synthesize a tiny placeholder so the
  // protected-success path can still be validated end-to-end without the
  // Pages ASSETS binding.
  return new Response(
    '<!doctype html><meta name="robots" content="noindex,nofollow,noarchive"><title>redactie-validation</title>',
    {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  );
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  headers.set('cache-control', 'no-store');
  headers.set('referrer-policy', 'no-referrer');
  if (!headers.has('x-content-type-options')) headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const auth = await isEditorialAuthorized(request, env);
  if (!auth.authorized) {
    return buildHtmlAuthChallenge(new URL(request.url));
  }
  // Reuse the inbound request URL so ASSETS.fetch picks up the correct
  // /redactie-validation.html asset.
  const assetRes = await fetchAsset(env, request);
  return withSecurityHeaders(assetRes);
}
