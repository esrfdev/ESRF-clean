// Self-contained test for functions/_middleware.js
//
// Run with:   node functions/_middleware.test.mjs
//
// Exits with code 0 on success, 1 on any failed assertion. No external
// dependencies — uses Node's built-in assert. Safe to run in CI.
//
// This tests the classification logic (shouldBlock) in isolation by
// importing the middleware module. The module exposes its helpers on
// globalThis.__esrfBotProtection for exactly this purpose.

import assert from 'node:assert/strict';

// Stub the Pages Functions runtime bits the module does NOT need for the
// classification-logic test. Importing the module itself is safe in Node:
// the top-level code only defines constants/functions and does not call
// into the Workers runtime.
await import('./_middleware.js');

const api = globalThis.__esrfBotProtection;
assert.ok(api, 'middleware did not expose test hooks on globalThis');

const { shouldBlock, isAdSenseUA, isBadBotUA, isEuropeanCountry } = api;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  — ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL — ${name}`);
    console.log(`         ${e.message}`);
  }
}

console.log('European country detection:');
check('DE is European',        () => assert.equal(isEuropeanCountry('DE'), true));
check('de (lowercase) is European', () => assert.equal(isEuropeanCountry('de'), true));
check('UA (Ukraine) is European',   () => assert.equal(isEuropeanCountry('UA'), true));
check('GB (UK) is European',   () => assert.equal(isEuropeanCountry('GB'), true));
check('CH is European',        () => assert.equal(isEuropeanCountry('CH'), true));
check('RS (Serbia) is European', () => assert.equal(isEuropeanCountry('RS'), true));
check('US is NOT European',    () => assert.equal(isEuropeanCountry('US'), false));
check('CN is NOT European',    () => assert.equal(isEuropeanCountry('CN'), false));
check('empty string is NOT European', () => assert.equal(isEuropeanCountry(''), false));
check('undefined is NOT European',    () => assert.equal(isEuropeanCountry(undefined), false));

console.log('\nAdSense UA detection:');
check('Mediapartners-Google matches',
  () => assert.equal(isAdSenseUA('mozilla/5.0 (compatible; mediapartners-google)'.toLowerCase()), true));
check('Google-Display-Ads-Bot matches',
  () => assert.equal(isAdSenseUA('google-display-ads-bot'.toLowerCase()), true));
check('AdsBot-Google matches',
  () => assert.equal(isAdSenseUA('AdsBot-Google (+http://www.google.com/adsbot.html)'.toLowerCase()), true));
check('random UA does not match',
  () => assert.equal(isAdSenseUA('mozilla/5.0 firefox'), false));

console.log('\nBad-bot UA detection:');
for (const ua of [
  'AhrefsBot/7.0',
  'SemrushBot',
  'Mozilla/5.0 (compatible; GPTBot/1.0)',
  'CCBot/2.0',
  'ClaudeBot/1.0',
  'Bytespider',
  'PetalBot',
  'python-requests/2.31.0',
  'curl/8.1.2',
  'Wget/1.21.3',
  'Go-http-client/1.1',
  'sqlmap/1.7',
  'Mozilla/5.0 (Nikto)',
  'masscan/1.3',
  'zgrab/0.x',
  'PerplexityBot/1.0',
  'Amazonbot/0.1',
  'Applebot-Extended',
]) {
  check(`matches: ${ua}`, () => assert.equal(isBadBotUA(ua.toLowerCase()), true));
}

check('normal Chrome does NOT match bad-bot list',
  () => assert.equal(isBadBotUA('mozilla/5.0 (windows nt 10.0; win64; x64) applewebkit/537.36 (khtml, like gecko) chrome/122.0.0.0 safari/537.36'), false));
check('normal Firefox does NOT match bad-bot list',
  () => assert.equal(isBadBotUA('mozilla/5.0 (x11; linux x86_64; rv:121.0) gecko/20100101 firefox/121.0'), false));
check('normal Safari iOS does NOT match bad-bot list',
  () => assert.equal(isBadBotUA('mozilla/5.0 (iphone; cpu iphone os 17_0 like mac os x) applewebkit/605.1.15'), false));

console.log('\nshouldBlock — AdSense always allowed:');
check('AdSense from US allowed', () => {
  const d = shouldBlock({ country: 'US' }, 'Mediapartners-Google');
  assert.equal(d.block, false);
  assert.equal(d.reason, 'adsense-allowed');
});
check('AdSense from DE allowed', () => {
  const d = shouldBlock({ country: 'DE' }, 'Mediapartners-Google');
  assert.equal(d.block, false);
});
check('Google-Display-Ads-Bot from RU allowed', () => {
  const d = shouldBlock({ country: 'RU' }, 'Google-Display-Ads-Bot');
  assert.equal(d.block, false);
});
check('AdsBot-Google from CN allowed', () => {
  const d = shouldBlock({ country: 'CN' }, 'AdsBot-Google');
  assert.equal(d.block, false);
});

console.log('\nshouldBlock — verified good bots:');
check('Cloudflare verified search engine bot allowed outside Europe', () => {
  const d = shouldBlock(
    { country: 'US', verifiedBotCategory: 'Search Engine Crawler' },
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
  );
  assert.equal(d.block, false);
  assert.equal(d.reason, 'verified-good-bot');
});
check('Cloudflare verified Advertising bot allowed outside Europe', () => {
  const d = shouldBlock({ country: 'US', verifiedBotCategory: 'Advertising' }, 'SomeVerifiedAdUA');
  assert.equal(d.block, false);
});
check('Cloudflare verified AI Crawler NOT auto-allowed (fall through)', () => {
  // Even if Cloudflare flags it as a verified "AI Crawler", we still apply
  // the bad-bot check; GPTBot should still be blocked outside Europe.
  const d = shouldBlock({ country: 'US', verifiedBotCategory: 'AI Crawler' }, 'GPTBot/1.0');
  assert.equal(d.block, true);
});

console.log('\nshouldBlock — European visitors:');
check('European human (DE, Firefox) allowed', () => {
  const d = shouldBlock({ country: 'DE' }, 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Firefox/121.0');
  assert.equal(d.block, false);
  assert.equal(d.reason, 'european-country');
});
check('European bot (DE, AhrefsBot) allowed — conservative rule', () => {
  // By design, we DO NOT block inside Europe. This keeps the rule narrow.
  const d = shouldBlock({ country: 'DE' }, 'AhrefsBot/7.0');
  assert.equal(d.block, false);
});
check('UK human allowed', () => {
  const d = shouldBlock({ country: 'GB' }, 'Mozilla/5.0 Chrome/122');
  assert.equal(d.block, false);
});

console.log('\nshouldBlock — non-European humans NOT blocked:');
check('US human (Chrome) allowed', () => {
  const d = shouldBlock({ country: 'US' }, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36');
  assert.equal(d.block, false);
  assert.equal(d.reason, 'default-allow');
});
check('JP human (Safari) allowed', () => {
  const d = shouldBlock({ country: 'JP' }, 'Mozilla/5.0 (iPhone) Safari/605.1.15');
  assert.equal(d.block, false);
});
check('IN human (Firefox) allowed', () => {
  const d = shouldBlock({ country: 'IN' }, 'Mozilla/5.0 Firefox/121.0');
  assert.equal(d.block, false);
});

console.log('\nshouldBlock — non-European bad bots BLOCKED:');
for (const [country, ua] of [
  ['US', 'AhrefsBot/7.0'],
  ['US', 'SemrushBot'],
  ['CN', 'Bytespider'],
  ['SG', 'PetalBot'],
  ['US', 'GPTBot/1.0'],
  ['US', 'CCBot/2.0'],
  ['US', 'ClaudeBot/1.0'],
  ['US', 'PerplexityBot/1.0'],
  ['US', 'Amazonbot/0.1'],
  ['US', 'Mozilla/5.0 (compatible; DataForSeoBot/1.0)'],
  ['US', 'python-requests/2.31.0'],
  ['US', 'curl/8.1.2'],
  ['US', 'wget/1.21'],
  ['US', 'Go-http-client/1.1'],
  ['US', 'masscan/1.3'],
  ['US', 'sqlmap/1.7'],
  ['US', 'Mozilla/5.0 (Nikto)'],
]) {
  check(`${country} + ${ua} blocked`, () => {
    const d = shouldBlock({ country }, ua);
    assert.equal(d.block, true, `expected block, got ${JSON.stringify(d)}`);
  });
}

console.log('\nshouldBlock — unknown / missing country (conservative):');
check('unknown country + human UA → allowed', () => {
  const d = shouldBlock({}, 'Mozilla/5.0 Chrome/122');
  assert.equal(d.block, false);
});
check('undefined cf + human UA → allowed', () => {
  const d = shouldBlock(undefined, 'Mozilla/5.0 Firefox/121');
  assert.equal(d.block, false);
});
check('unknown country + AhrefsBot → blocked', () => {
  // "Not European" covers both non-EU and unknown, so clear bad UA still blocks.
  const d = shouldBlock({}, 'AhrefsBot/7.0');
  assert.equal(d.block, true);
});
check('undefined cf + GPTBot → blocked', () => {
  const d = shouldBlock(undefined, 'GPTBot/1.0');
  assert.equal(d.block, true);
});

console.log('\nEdge cases:');
check('empty UA from US → allowed (no bad-bot match)', () => {
  const d = shouldBlock({ country: 'US' }, '');
  assert.equal(d.block, false);
});
check('empty UA from DE → allowed', () => {
  const d = shouldBlock({ country: 'DE' }, '');
  assert.equal(d.block, false);
});
check('case-insensitive: GPTBOT (uppercase) from US blocked', () => {
  const d = shouldBlock({ country: 'US' }, 'GPTBOT/1.0');
  assert.equal(d.block, true);
});
check('case-insensitive: mediapartners-google (lowercase) allowed', () => {
  const d = shouldBlock({ country: 'US' }, 'mediapartners-google');
  assert.equal(d.block, false);
});

console.log(`\n${failures === 0 ? 'All tests passed.' : failures + ' test(s) FAILED.'}`);
process.exit(failures === 0 ? 0 : 1);
