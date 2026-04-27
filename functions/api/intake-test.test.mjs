// Self-contained test for functions/api/intake-test.js
//
// Run with:   node functions/api/intake-test.test.mjs
//
// Exits 0 on success, 1 on any failure. No external dependencies.

import assert from 'node:assert/strict';

// Importing intake.js first so the named exports are registered before
// intake-test.js consumes them. Both modules also publish helpers on
// globalThis for the existing test harness.
await import('./intake.js');
await import('./intake-test.js');
const test = globalThis.__esrfIntakeTest;
assert.ok(test, 'intake-test.js did not expose test hooks on globalThis');

const { onRequest, isPreviewEnv, hasLabTestPrefix, LAB_TEST_PREFIX } = test;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok  — ' + name); }
  catch (e) { failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}
async function asyncCheck(name, fn) {
  try { await fn(); console.log('  ok  — ' + name); }
  catch (e) { failures++; console.log('FAIL — ' + name); console.log('       ' + (e && e.message || e)); }
}

// ─── helpers ────────────────────────────────────────────────────────────
function callIntakeTest(method, opts) {
  opts = opts || {};
  const headers = new Map(Object.entries(opts.headers || {}));
  const request = {
    method,
    url: 'https://test-regional-editorial-cont.esrf-clean.pages.dev/api/intake-test',
    headers: {
      get(k) { return headers.get(String(k).toLowerCase()) || headers.get(k) || null; },
    },
    text: async () => opts.body || '',
    cf: {},
  };
  // Default to a Preview-marked env so the route is reachable. Pass
  // `opts.env` to override, or `opts.envReplace = true` to replace
  // entirely (e.g. to simulate an empty production env).
  const env = opts.envReplace
    ? (opts.env || {})
    : Object.assign(
        { CF_PAGES_BRANCH: 'test/regional-editorial-contributor-intake' },
        opts.env || {},
      );
  return onRequest({ request, env });
}

const PREVIEW_ORIGIN = 'https://test-regional-editorial-cont.esrf-clean.pages.dev';

const baseLabContact = {
  name: 'ESRF Lab Test Operator',
  organisation: 'ESRF Lab Test Foundation',
  role: 'Lab Operator',
  email: 'lab-test@example.org',
  phone: '+31 6 12345678',
  country_code: 'NL',
  country_label: 'Nederland',
  place: 'Rotterdam',
  region: 'Zuid-Holland',
  website: 'https://example.org',
};
const baseLabOrg = { sector: 'gov', sector_label: 'Overheid', city: 'Rotterdam', description: 'Lab test row.' };
const basePrivacy = { gdpr_privacy_policy: true };

function labBody(overrides) {
  return JSON.stringify(Object.assign({
    intake_mode: 'org',
    lab_test: true,
    form_duration_ms: 9999,
    contact: baseLabContact,
    organisation_listing: baseLabOrg,
    privacy: basePrivacy,
  }, overrides || {}));
}

// ─── isPreviewEnv ───────────────────────────────────────────────────────
check('isPreviewEnv: ESRF_PREVIEW=true enables route', () => {
  assert.equal(isPreviewEnv({ ESRF_PREVIEW: 'true' }), true);
  assert.equal(isPreviewEnv({ ESRF_PREVIEW: '1' }), true);
});
check('isPreviewEnv: CF_PAGES_BRANCH=main is production', () => {
  assert.equal(isPreviewEnv({ CF_PAGES_BRANCH: 'main' }), false);
});
check('isPreviewEnv: CF_PAGES_BRANCH set to a non-main branch is preview', () => {
  assert.equal(isPreviewEnv({ CF_PAGES_BRANCH: 'test/regional-editorial-contributor-intake' }), true);
});
check('isPreviewEnv: empty env is treated as production (safe default)', () => {
  assert.equal(isPreviewEnv({}), false);
});
check('isPreviewEnv: ESRF_PREVIEW=true wins over branch=main', () => {
  // Operator-controlled override: explicit Preview flag must win, but
  // we still want to make sure a stray `true` cannot smuggle into prod.
  // This test documents current behaviour: ESRF_PREVIEW=true does
  // override branch=main. Production deploy must therefore NOT set
  // ESRF_PREVIEW. (Documented in route header + docs/intake-backend.md.)
  assert.equal(isPreviewEnv({ ESRF_PREVIEW: 'true', CF_PAGES_BRANCH: 'main' }), true);
});

// ─── hasLabTestPrefix ───────────────────────────────────────────────────
check('hasLabTestPrefix: case-insensitive, prefix-only', () => {
  assert.equal(hasLabTestPrefix('ESRF Lab Test Foundation'), true);
  assert.equal(hasLabTestPrefix('esrf lab test rotterdam'), true);
  assert.equal(hasLabTestPrefix('  ESRF Lab Test  '), true);
  assert.equal(hasLabTestPrefix('Acme'), false);
  assert.equal(hasLabTestPrefix(''), false);
  assert.equal(hasLabTestPrefix(null), false);
  // Must be a *prefix* — embedded match is rejected.
  assert.equal(hasLabTestPrefix('Foo ESRF Lab Test Bar'), false);
});
check('hasLabTestPrefix: confirms documented prefix value', () => {
  assert.equal(LAB_TEST_PREFIX, 'ESRF Lab Test');
});

// ─── HTTP method handling ───────────────────────────────────────────────
await asyncCheck('GET /api/intake-test in Preview returns 405', async () => {
  const res = await callIntakeTest('GET');
  assert.equal(res.status, 405);
});
await asyncCheck('PUT /api/intake-test in Preview returns 405', async () => {
  const res = await callIntakeTest('PUT');
  assert.equal(res.status, 405);
});
await asyncCheck('DELETE /api/intake-test in Preview returns 405', async () => {
  const res = await callIntakeTest('DELETE');
  assert.equal(res.status, 405);
});
await asyncCheck('OPTIONS preflight from allowed origin returns 204', async () => {
  const res = await callIntakeTest('OPTIONS', { headers: { origin: PREVIEW_ORIGIN } });
  assert.equal(res.status, 204);
});

// ─── Production gate ────────────────────────────────────────────────────
await asyncCheck('POST in production (CF_PAGES_BRANCH=main) returns 404', async () => {
  const res = await callIntakeTest('POST', {
    env: { CF_PAGES_BRANCH: 'main' },
    headers: { origin: 'https://www.esrf.net', 'content-type': 'application/json' },
    body: labBody(),
  });
  assert.equal(res.status, 404);
  const text = await res.text();
  // Must not leak which check failed beyond a generic 404.
  assert.ok(/Not found/i.test(text));
  assert.ok(!/lab_test|prefix|webhook|secret/i.test(text));
});
await asyncCheck('GET in production returns 404 (route not advertised)', async () => {
  const res = await callIntakeTest('GET', { env: { CF_PAGES_BRANCH: 'main' } });
  assert.equal(res.status, 404);
});
await asyncCheck('Empty env (no CF_PAGES_BRANCH) treated as production → 404', async () => {
  const res = await callIntakeTest('POST', {
    envReplace: true,
    env: {},
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: labBody(),
  });
  assert.equal(res.status, 404);
});

// ─── Origin allowlist ───────────────────────────────────────────────────
await asyncCheck('POST from disallowed origin in Preview returns 403', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    body: labBody(),
  });
  assert.equal(res.status, 403);
});

// ─── Content-Type / payload-size ────────────────────────────────────────
await asyncCheck('POST with non-JSON content-type returns 415', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'text/plain' },
    body: labBody(),
  });
  assert.equal(res.status, 415);
});
await asyncCheck('POST with body > 64 KiB returns 413', async () => {
  const big = 'x'.repeat(64 * 1024 + 1);
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: '{"lab_test":true,"intake_mode":"org","contact":{"name":"' + big + '"}}',
  });
  assert.equal(res.status, 413);
});
await asyncCheck('POST with invalid JSON returns 400', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
});
await asyncCheck('POST with JSON array (not object) returns 400', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: '[1,2,3]',
  });
  assert.equal(res.status, 400);
});

// ─── Required lab_test marker ───────────────────────────────────────────
await asyncCheck('POST without lab_test marker returns 400', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({
      intake_mode: 'org',
      form_duration_ms: 9999,
      contact: baseLabContact,
      organisation_listing: baseLabOrg,
      privacy: basePrivacy,
    }),
  });
  assert.equal(res.status, 400);
  const t = await res.text();
  assert.ok(/lab_test/.test(t));
});
await asyncCheck('POST with lab_test=false is rejected', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: labBody({ lab_test: false }),
  });
  assert.equal(res.status, 400);
});
await asyncCheck('POST with lab_test as string "true" is rejected (must be boolean)', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: labBody({ lab_test: 'true' }),
  });
  assert.equal(res.status, 400);
});

// ─── Required ESRF Lab Test prefix ──────────────────────────────────────
await asyncCheck('POST without ESRF Lab Test prefix on organisation is 400', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: labBody({ contact: { ...baseLabContact, organisation: 'Acme Corp' } }),
  });
  assert.equal(res.status, 400);
  const t = await res.text();
  assert.ok(/organisation/i.test(t));
});
await asyncCheck('POST without ESRF Lab Test prefix on contact name is 400', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: labBody({ contact: { ...baseLabContact, name: 'Anna Jansen' } }),
  });
  assert.equal(res.status, 400);
});

// ─── Successful dry-run path (no secrets) ───────────────────────────────
await asyncCheck('POST with valid lab body (no webhook secrets) succeeds in dry-run', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: labBody(),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.route, '/api/intake-test');
  assert.equal(j.lab_test, true);
  assert.equal(j.environment, 'TEST/VALIDATIE');
  assert.equal(j.dry_run, true);
  assert.equal(j.sheet_dry_run, true);
  assert.equal(j.notification_status, 'disabled_for_intake_test');
  assert.equal(j.notification_sent, false);
  // Sheet-webhook preview must target only LAB_* tabs.
  const tabs = Object.keys(j.sheet_webhook_payload_preview.rows);
  assert.ok(tabs.length >= 1);
  for (const t of tabs) {
    assert.ok(t.startsWith('LAB_'), 'tab not LAB_-prefixed: ' + t);
    assert.notEqual(t, 'Directory_Master');
  }
  assert.equal(j.sheet_webhook_payload_preview.target_prefix, 'LAB_');
  assert.ok(j.sheet_webhook_payload_preview.forbidden_targets.includes('Directory_Master'));
  // Notification must NOT contain any recipient or PII keys.
  const msg = j.notification_message_preview;
  assert.equal(msg.notify_to_recipient, undefined);
  for (const forbidden of ['contact_email','email','phone','contact_phone','contact_name','name','summary','editorial_body','raw_payload_json','shared_secret','SHEETS_WEBHOOK_SECRET','GITHUB_TOKEN']) {
    assert.ok(!Object.prototype.hasOwnProperty.call(msg, forbidden), 'notification leaked ' + forbidden);
  }
  // /api/intake-test surfaces the same minimal-notification design contract
  // and not-enabled status flag as /api/intake.
  assert.equal(j.minimal_notification_design_status, 'minimal-notification-design-ready-not-enabled');
  assert.ok(j.notification_contract, 'response must surface notification_contract');
  assert.equal(j.notification_contract.status, 'minimal-notification-design-ready-not-enabled');
  assert.ok(j.notification_contract.allowed_keys.includes('submission_id'));
  assert.ok(j.notification_contract.forbidden_keys.includes('shared_secret'));
  assert.ok(j.notification_contract.forbidden_keys.includes('raw_payload_json'));
  assert.ok(j.notification_contract.forbidden_recipients.includes('ai.agent.wm@gmail.com'));
});

// ─── Directory_Master forbidden — covered by builders + asserts ─────────
await asyncCheck('Successful response never targets Directory_Master', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: labBody({ intake_mode: 'both', editorial_contribution: {
      topic: 'Lab test topic', summary: 'Lab test summary', regional_angle: 'Lab test angle',
      lesson: 'Lab test lesson',
      consent: { edit_and_publish: true, editorial_may_contact: true, no_confidential_information: true },
    }}),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  const text = JSON.stringify(j);
  assert.ok(!/Directory_Master["']?\s*:/i.test(text) || /forbidden_targets/.test(text),
    'Directory_Master appears outside forbidden_targets list');
  // Specifically no rows under Directory_Master.
  assert.equal(j.sheet_webhook_payload_preview.rows.Directory_Master, undefined);
});

// ─── Notification disabled even if INTAKE_NOTIFY_* are set ──────────────
await asyncCheck('Notification is NOT sent even if INTAKE_NOTIFY_* env vars are configured', async () => {
  const res = await callIntakeTest('POST', {
    env: {
      CF_PAGES_BRANCH: 'test/regional-editorial-contributor-intake',
      INTAKE_NOTIFY_WEBHOOK: 'https://example.org/should-not-be-called',
      INTAKE_NOTIFY_TO: 'office@esrf.net',
    },
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: labBody(),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.notification_status, 'disabled_for_intake_test');
  assert.equal(j.notification_sent, false);
  assert.equal(j.notification_message_preview.notify_to_recipient, undefined);
});

// ─── Notification simulate — opt-in, no real dispatch ──────────────────
await asyncCheck('notification_simulate=true returns simulated_no_dispatch and never calls fetch', async () => {
  // Replace fetch with a tripwire so we can prove no network call is
  // made when simulate is on. The route never reaches fetch in
  // dry-run anyway, but the assertion makes the contract explicit.
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; return new Response('{}'); };
  try {
    const res = await callIntakeTest('POST', {
      env: {
        CF_PAGES_BRANCH: 'test/regional-editorial-contributor-intake',
        // Even with notify env vars present, simulate must not dispatch.
        INTAKE_NOTIFY_WEBHOOK: 'https://example.org/should-not-be-called',
        INTAKE_NOTIFY_TO: 'office@esrf.net',
      },
      headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
      body: labBody({ notification_simulate: true }),
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.notification_status, 'simulated_no_dispatch');
    assert.equal(j.notification_simulate, true);
    assert.equal(j.notification_sent, false);
    // notify_to_recipient must NEVER appear on this route, simulate or not.
    assert.equal(j.notification_message_preview.notify_to_recipient, undefined);
    // No real network call.
    assert.equal(fetchCalls, 0, 'simulate must not dispatch a real notification');
  } finally {
    globalThis.fetch = realFetch;
  }
});
await asyncCheck('notification_simulate omitted defaults to disabled_for_intake_test', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: labBody(),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.notification_status, 'disabled_for_intake_test');
  assert.equal(j.notification_simulate, false);
});

// ─── Live-write requires BOTH webhook URL AND secret ────────────────────
await asyncCheck('Live mode requires BOTH INTAKE_SHEET_WEBHOOK_URL and SHEETS_WEBHOOK_SECRET', async () => {
  // URL only → still dry-run.
  let res = await callIntakeTest('POST', {
    env: {
      CF_PAGES_BRANCH: 'test/regional-editorial-contributor-intake',
      INTAKE_SHEET_WEBHOOK_URL: 'https://example.org/webhook',
    },
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: labBody(),
  });
  assert.equal(res.status, 200);
  let j = await res.json();
  assert.equal(j.dry_run, true, 'URL-only must stay dry-run');
  // Secret only → still dry-run.
  res = await callIntakeTest('POST', {
    env: {
      CF_PAGES_BRANCH: 'test/regional-editorial-contributor-intake',
      SHEETS_WEBHOOK_SECRET: 'shh',
    },
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: labBody(),
  });
  assert.equal(res.status, 200);
  j = await res.json();
  assert.equal(j.dry_run, true, 'secret-only must stay dry-run');
});

// ─── Live-write: shared secret is NOT echoed back in the response ──────
await asyncCheck('Shared secret is never reflected in the response payload', async () => {
  const SECRET = 'top-secret-shh-12345-do-not-leak';
  // We mock fetch globally so the route does not actually hit the
  // network. The mock captures the wire body so we can also assert
  // the secret IS forwarded to the upstream (as documented).
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true, row_id: 'row_lab_test_001' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const res = await callIntakeTest('POST', {
      env: {
        CF_PAGES_BRANCH: 'test/regional-editorial-contributor-intake',
        INTAKE_SHEET_WEBHOOK_URL: 'https://example.org/webhook',
        SHEETS_WEBHOOK_SECRET: SECRET,
      },
      headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
      body: labBody(),
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    const responseText = JSON.stringify(j);
    assert.ok(!responseText.includes(SECRET), 'response leaked the shared secret');
    // The route must still report dry_run=false on success.
    assert.equal(j.dry_run, false);
    assert.equal(j.sheet_dry_run, false);
    // Captured wire body must include the secret (header + body) so
    // the Apps Script can verify it.
    assert.ok(captured, 'fetch was not called');
    assert.ok(String(captured.init.body).includes(SECRET), 'secret missing from wire body');
    assert.equal(captured.init.headers['x-esrf-intake-secret'], SECRET);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─── Sheet upstream error returns generic message ───────────────────────
await asyncCheck('Sheet upstream non-200 yields a generic warning, no upstream body leaked', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('SECRET-DIAGNOSTIC-DETAIL', { status: 500 });
  try {
    const res = await callIntakeTest('POST', {
      env: {
        CF_PAGES_BRANCH: 'test/regional-editorial-contributor-intake',
        INTAKE_SHEET_WEBHOOK_URL: 'https://example.org/webhook',
        SHEETS_WEBHOOK_SECRET: 'whatever',
      },
      headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
      body: labBody(),
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    const text = JSON.stringify(j);
    assert.ok(!text.includes('SECRET-DIAGNOSTIC-DETAIL'));
    assert.ok((j.warnings || []).some(w => /Sheet upstream/i.test(w)));
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─── Validation errors do not leak stacks or env-var names ──────────────
await asyncCheck('Validation error message is generic', async () => {
  const res = await callIntakeTest('POST', {
    headers: { origin: PREVIEW_ORIGIN, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 400);
  const t = await res.text();
  assert.ok(!/at\s+\w+\s+\(/.test(t), 'response leaked a stack trace');
  assert.ok(!/SHEETS_WEBHOOK_SECRET|GITHUB_TOKEN|INTAKE_SHEET_WEBHOOK_URL/.test(t), 'response leaked env var name');
});

// ─── Middleware bypass list contains /api/intake-test ───────────────────
await asyncCheck('Middleware bypass list includes /api/intake-test', async () => {
  await import('../_middleware.js');
  const mw = globalThis.__esrfBotProtection;
  assert.ok(mw && Array.isArray(mw.BOT_FILTER_BYPASS_PATHS));
  assert.ok(mw.BOT_FILTER_BYPASS_PATHS.includes('/api/intake-test'),
    'BOT_FILTER_BYPASS_PATHS must include /api/intake-test');
  // /api/intake itself must NOT be on the bypass list — production stays
  // protected by the bot rule.
  assert.ok(!mw.BOT_FILTER_BYPASS_PATHS.includes('/api/intake'),
    '/api/intake must remain bot-filter-protected');
  // shouldBypassBotFilter helper must agree.
  assert.equal(mw.shouldBypassBotFilter(new URL('https://x/api/intake-test')), true);
  assert.equal(mw.shouldBypassBotFilter(new URL('https://x/api/intake-test/extra')), true);
  assert.equal(mw.shouldBypassBotFilter(new URL('https://x/api/intake')), false);
  assert.equal(mw.shouldBypassBotFilter(new URL('https://x/api/intake-tester-evil')), false);
});

// ─── Summary ────────────────────────────────────────────────────────────
if (failures) {
  console.log('\n' + failures + ' test(s) FAILED');
  process.exit(1);
}
console.log('\nall tests passed');
