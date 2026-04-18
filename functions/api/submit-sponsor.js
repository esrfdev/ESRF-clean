// Cloudflare Pages Function — POST /api/submit-sponsor
// ESRF.net sponsor inquiry handler
export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Parse JSON
  let body;
  try { body = await request.json(); }
  catch(e) { return jsonErr('Invalid JSON', 400); }

  // 2. Honeypot check
  if (body.company_website_hp) {
    return jsonErr('Invalid submission', 400);
  }

  // 3. Timer check (client-reported; server rejects if too fast)
  if (!body.form_duration_ms || body.form_duration_ms < 3000) {
    return jsonErr('Form submitted too quickly', 400);
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
    if (!verify.success) return jsonErr('Turnstile verification failed', 400);
  }

  // 5. Rate-limit via KV (if bound)
  if (env.RATE_LIMIT_KV) {
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const key = 'rl:sponsor:' + ip;
    const prev = parseInt(await env.RATE_LIMIT_KV.get(key) || '0');
    if (prev >= 3) return jsonErr('Too many requests, try again later', 429);
    await env.RATE_LIMIT_KV.put(key, String(prev + 1), { expirationTtl: 3600 });
  }

  // 6. Validate fields
  const required = ['organisation', 'tier', 'contact_name', 'contact_email'];
  for (const f of required) if (!body[f]) return jsonErr(`Missing field: ${f}`, 400);
  if (!body.gdpr_consent) return jsonErr('GDPR consent required', 400);
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(body.contact_email)) return jsonErr('Invalid email', 400);

  const validTiers = ['founding', 'partner', 'supporter'];
  if (!validTiers.includes(body.tier)) return jsonErr('Invalid tier value', 400);

  // 7. Persist to KV (if bound)
  const submission = {
    ...body,
    submitted_at: new Date().toISOString(),
    ip: request.headers.get('cf-connecting-ip') || '',
    user_agent: request.headers.get('user-agent') || ''
  };
  delete submission.company_website_hp;
  delete submission.turnstile_token;

  if (env.LISTING_SUBMISSIONS) {
    const id = 'sponsor:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    await env.LISTING_SUBMISSIONS.put(id, JSON.stringify(submission));
  }

  // 8. Email via Resend (if configured)
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
        reply_to: body.contact_email,
        subject: `New sponsor inquiry: ${tierLabel} — ${body.organisation}`,
        text: formatSubmission(submission)
      })
    }).catch(() => { /* don't fail the request if email delivery fails */ });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function formatSubmission(s) {
  return Object.entries(s).map(([k, v]) => `${k}: ${v}`).join('\n');
}
