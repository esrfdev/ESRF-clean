// Cloudflare Pages Function — POST /api/submit-sponsor
// ESRF.net sponsor inquiry handler
// Privacy-hardened: IP truncation, input sanitization, CORS, TTL on stored data

const ALLOWED_ORIGINS = ['https://www.esrf.net', 'https://esrf.net'];
const MAX_FIELD_LENGTH = 500;
const KV_TTL_SECONDS = 63072000; // 24 months (GDPR retention limit)

export async function onRequestPost(context) {
  const { request, env } = context;

  // 0. CORS — only accept requests from esrf.net
  const origin = request.headers.get('origin') || '';
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return corsResponse(jsonErr('Forbidden origin', 403), origin);
  }

  // 1. Parse JSON
  let body;
  try { body = await request.json(); }
  catch(e) { return corsResponse(jsonErr('Invalid JSON', 400), origin); }

  // 2. Honeypot check
  if (body.company_website_hp) {
    return corsResponse(jsonErr('Invalid submission', 400), origin);
  }

  // 3. Timer check (client-reported; server rejects if too fast)
  if (!body.form_duration_ms || body.form_duration_ms < 3000) {
    return corsResponse(jsonErr('Form submitted too quickly', 400), origin);
  }

  // 4. Turnstile verification
  if (env.TURNSTILE_SECRET_KEY) {
    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: body.turnstile_token || '',
        remoteip: request.headers.get('cf-connecting-ip') || ''
      })
    }).then(r => r.json());
    if (!verify.success) return corsResponse(jsonErr('Turnstile verification failed', 400), origin);
  }

  // 5. Rate-limit via KV (if bound) — uses truncated IP
  const fullIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const truncatedIp = truncateIp(fullIp);

  if (env.RATE_LIMIT_KV) {
    const key = 'rl:sponsor:' + truncatedIp;
    const prev = parseInt(await env.RATE_LIMIT_KV.get(key) || '0');
    if (prev >= 3) return corsResponse(jsonErr('Too many requests, try again later', 429), origin);
    await env.RATE_LIMIT_KV.put(key, String(prev + 1), { expirationTtl: 3600 });
  }

  // 6. Validate and sanitize fields
  const required = ['organisation', 'tier', 'contact_name', 'contact_email'];
  for (const f of required) if (!body[f]) return corsResponse(jsonErr(`Missing field: ${f}`, 400), origin);
  if (!body.gdpr_consent) return corsResponse(jsonErr('GDPR consent required', 400), origin);
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(body.contact_email)) return corsResponse(jsonErr('Invalid email', 400), origin);

  const validTiers = ['founding', 'partner', 'supporter'];
  if (!validTiers.includes(body.tier)) return corsResponse(jsonErr('Invalid tier value', 400), origin);

  // Sanitize all string inputs (strip HTML/scripts, enforce max length)
  const sanitized = {
    organisation: sanitize(body.organisation),
    tier: body.tier,
    contact_name: sanitize(body.contact_name),
    contact_email: sanitize(body.contact_email),
    message: sanitize(body.message || ''),
    gdpr_consent: true,
    submitted_at: new Date().toISOString(),
    // GDPR: only store truncated IP (last octet/segment zeroed)
    ip_truncated: truncatedIp,
    // Do NOT store user-agent (unnecessary personal data)
  };

  // 7. Persist to KV (if bound) — with automatic TTL expiry
  if (env.LISTING_SUBMISSIONS) {
    const id = 'sponsor:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    await env.LISTING_SUBMISSIONS.put(id, JSON.stringify(sanitized), {
      expirationTtl: KV_TTL_SECONDS
    });
  }

  // 8. Email via Resend (if configured)
  // Note: email contains only sanitized data, no IP or user-agent
  if (env.RESEND_API_KEY) {
    const tierLabel = { founding: 'Founding Patron', partner: 'Programme Partner', supporter: 'Community Supporter' }[body.tier] || body.tier;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer ' + env.RESEND_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        from: 'ESRF.net <noreply@esrf.net>',
        to: ['partnership@esrf.net'],
        reply_to: sanitized.contact_email,
        subject: `New sponsor inquiry: ${tierLabel} — ${sanitized.organisation}`,
        text: formatEmail(sanitized)
      })
    }).catch(() => { /* don't fail the request if email delivery fails */ });
  }

  return corsResponse(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }),
    origin
  );
}

// Handle preflight OPTIONS requests for CORS
export async function onRequestOptions(context) {
  const origin = context.request.headers.get('origin') || '';
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    }
  });
}

// --- Helpers ---

function corsResponse(response, origin) {
  const headers = new Headers(response.headers);
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers.set('access-control-allow-origin', origin);
  }
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

/** Strip HTML tags, trim, and enforce max length */
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')    // strip HTML tags
    .replace(/[<>"'`]/g, '')    // remove dangerous characters
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

/** Truncate IP for GDPR compliance — zero last octet (IPv4) or last 80 bits (IPv6) */
function truncateIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip.includes('.')) {
    // IPv4: zero last octet (e.g. 192.168.1.42 → 192.168.1.0)
    const parts = ip.split('.');
    parts[3] = '0';
    return parts.join('.');
  }
  if (ip.includes(':')) {
    // IPv6: keep first 3 segments, zero rest
    const parts = ip.split(':');
    return parts.slice(0, 3).join(':') + '::';
  }
  return 'unknown';
}

function formatEmail(s) {
  return [
    `Organisation: ${s.organisation}`,
    `Tier: ${s.tier}`,
    `Contact: ${s.contact_name}`,
    `Email: ${s.contact_email}`,
    s.message ? `Message: ${s.message}` : '',
    `Submitted: ${s.submitted_at}`,
  ].filter(Boolean).join('\n');
}
