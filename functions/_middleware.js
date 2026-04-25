// Cloudflare Pages Functions — global middleware
// Bot / crawler protection for esrf.net
//
// Goal: block unwanted bot/crawler/scraper/AI-data-mining traffic originating
// from outside Europe, while keeping normal human visitors (worldwide) and
// legitimate advertising crawlers fully functional.
//
// Why a Pages Functions middleware (and not a Worker / WAF rule):
//   - The Cloudflare connector available to this repo cannot manage WAF
//     custom rules. Pages Functions run on every matched route and have
//     access to `request.cf` metadata (country, verified bot flag, ASN).
//   - A top-level `functions/_middleware.js` runs for every request routed
//     through Pages Functions, so it is the correct place for site-wide
//     request-level filtering.
//
// Design principles:
//   - Be conservative: NEVER block based on country alone. A human in the US,
//     India or Brazil must still be able to read esrf.net.
//   - Only block when we have BOTH a signal that the visitor is outside
//     Europe AND that the UA is a known-bad crawler/scraper/AI bot.
//   - Always allow Google AdSense / ad serving crawlers, regardless of
//     origin — blocking them would break monetisation. We also trust
//     Cloudflare's verified-bot signal when present to cover other good
//     bots (Googlebot, Bingbot, etc.) without relying on spoofable UA.
//   - Unknown country → treat as "could be European" → do not block humans;
//     still block unambiguously-bad UA so the rule has teeth against
//     tor/proxy-hidden scrapers.

// -------------------------------------------------------------------------
// European country allowlist (ISO 3166-1 alpha-2).
// Includes EU / EEA, UK, Switzerland, micro-states, Western Balkans,
// Moldova/Ukraine/Belarus (geographic Europe), and Russia/Turkey/Georgia/
// Armenia/Azerbaijan (traffic commonly appears as "European" for ESRF's
// audience). Keep this list maintainable — add/remove in one place.
const EUROPEAN_COUNTRIES = new Set([
  // EU member states
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // EEA / EFTA
  'IS', 'LI', 'NO', 'CH',
  // UK
  'GB',
  // Micro-states
  'AD', 'MC', 'SM', 'VA',
  // Western Balkans & nearby
  'AL', 'BA', 'ME', 'MK', 'RS', 'XK',
  // Eastern Europe (geographic)
  'BY', 'MD', 'UA',
  // Transcaucasia / wider Europe
  'RU', 'TR', 'GE', 'AM', 'AZ',
  // Additional European islands / dependencies seen in Cloudflare data
  'FO', 'GG', 'JE', 'IM', 'GI', 'AX',
]);

// -------------------------------------------------------------------------
// AdSense / advertising crawler allowlist.
// These MUST be allowed everywhere — they are how Google's ad products
// fetch pages to serve relevant ads. See:
//   https://support.google.com/adsense/answer/99376
//   https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
// UA matching is case-insensitive; we match substrings because Google
// sometimes appends version info.
const ADSENSE_UA_ALLOWLIST = [
  'Mediapartners-Google',     // AdSense crawler
  'Google-Display-Ads-Bot',   // Display ads network
  'AdsBot-Google',            // Ads quality checker (landing page)
  'AdsBot-Google-Mobile',     // Mobile ads quality
  'GoogleOther',              // Product-team fetcher sometimes used for ads
];

// -------------------------------------------------------------------------
// Known-bad bot / crawler / scraper / AI-training / security-scanner UA
// fragments. Case-insensitive substring match. Keep alphabetical within
// each logical group for maintainability.
const BAD_BOT_UA_PATTERNS = [
  // SEO / backlink crawlers (heavy, commercial, usually non-European infra)
  'AhrefsBot',
  'Barkrowler',
  'BLEXBot',
  'DataForSeoBot',
  'DotBot',
  'LinkpadBot',
  'MauiBot',
  'MegaIndex',
  'MJ12bot',
  'PetalBot',
  'SemrushBot',
  'Seekport',
  'SEOkicks',
  'serpstatbot',
  'SiteAuditBot',
  'spbot',              // OpenLinkProfiler
  'VelenPublicWebCrawler',
  'ZoominfoBot',

  // AI training / data-mining bots
  'Amazonbot',
  'anthropic-ai',
  'Applebot-Extended',  // opted-out of training per Apple docs
  'Bytespider',         // ByteDance / TikTok
  'CCBot',              // Common Crawl
  'ChatGPT-User',
  'ClaudeBot',
  'cohere-ai',
  'Diffbot',
  'FacebookBot',        // distinct from facebookexternalhit
  'FriendlyCrawler',
  'GPTBot',
  'ImagesiftBot',
  'Kangaroo Bot',
  'Meta-ExternalAgent',
  'Omgilibot',
  'PerplexityBot',
  'Scrapy',
  'Sidetrade',
  'Timpibot',
  'YouBot',

  // Generic scraping / HTTP libraries (rarely legitimate for page loads)
  'curl/',
  'Go-http-client',
  'HeadlessChrome',     // often signals automation; humans use real Chrome
  'libwww-perl',
  'node-fetch',
  'python-requests',
  'python-urllib',
  'Scrapy',
  'wget',

  // Security scanners / vuln scrapers (blocked worldwide really, but here
  // we only block them outside Europe to stay conservative with the rule)
  'Acunetix',
  'dirbuster',
  'Hydra',
  'masscan',
  'Nessus',
  'Nikto',
  'Nmap',
  'Qualys',
  'sqlmap',
  'WPScan',
  'zgrab',
  'ZmEu',
];

// Precomputed lower-cased copies for fast case-insensitive matching.
const ADSENSE_LC = ADSENSE_UA_ALLOWLIST.map(s => s.toLowerCase());
const BAD_BOT_LC = BAD_BOT_UA_PATTERNS.map(s => s.toLowerCase());

// -------------------------------------------------------------------------
// Classification helpers. Exported via globalThis for the test script so
// the same logic is exercised by tests (Pages Functions runtime doesn't
// execute the test file, so this has zero production impact).

function matchesAny(uaLower, patterns) {
  for (const p of patterns) if (uaLower.includes(p)) return true;
  return false;
}

function isAdSenseUA(uaLower) {
  return matchesAny(uaLower, ADSENSE_LC);
}

function isBadBotUA(uaLower) {
  return matchesAny(uaLower, BAD_BOT_LC);
}

function isEuropeanCountry(country) {
  return !!country && EUROPEAN_COUNTRIES.has(country.toUpperCase());
}

/**
 * Decide whether to block a request.
 *
 *   cf        — request.cf object (may be undefined in local dev)
 *   ua        — raw User-Agent string (may be empty)
 *
 * Returns an object { block: boolean, reason: string }.
 */
function shouldBlock(cf, ua) {
  const uaLower = (ua || '').toLowerCase();
  const country = cf && cf.country ? String(cf.country) : '';

  // 1. Always allow AdSense / ad crawlers, regardless of origin. This is
  //    the explicit AdSense exception required for monetisation.
  if (isAdSenseUA(uaLower)) {
    return { block: false, reason: 'adsense-allowed' };
  }

  // 2. Trust Cloudflare's verified-bot signal. `request.cf.verifiedBotCategory`
  //    is populated for bots Cloudflare has cryptographically/IP-verified
  //    (Googlebot, Bingbot, AppleBot, etc.). This is NOT spoofable via UA.
  //    We only honour this as an ALLOW for search-engine / ad categories,
  //    to avoid whitelisting categories like "AI Crawler" which is what we
  //    want to block outside Europe anyway.
  if (cf && cf.verifiedBotCategory) {
    const cat = String(cf.verifiedBotCategory).toLowerCase();
    if (cat.includes('search engine') || cat.includes('advertising')) {
      return { block: false, reason: 'verified-good-bot' };
    }
  }

  // 3. European visitor → always allow. This is the main allowlist path
  //    for our intended audience (EU energy / security professionals).
  if (isEuropeanCountry(country)) {
    return { block: false, reason: 'european-country' };
  }

  // 4. Non-European OR unknown country:
  //    Only block if the UA is clearly a known-bad bot. Humans with no
  //    cf.country (rare — satellite, Tor exit, etc.) are NOT blocked.
  if (isBadBotUA(uaLower)) {
    return { block: true, reason: 'bad-bot-outside-europe' };
  }

  // 5. Default: allow. We do not block humans by geography.
  return { block: false, reason: 'default-allow' };
}

// -------------------------------------------------------------------------
// Host canonicalisation. We want www.esrf.net -> esrf.net (path + query
// preserved) BEFORE any bot/geo blocking runs, otherwise outside-Europe
// crawlers hitting www.* get a 403 from the bot rule and never see the
// 301 to the canonical host. Returning the redirect from the middleware
// (instead of relying on the static `_redirects` file) guarantees the
// redirect wins because Pages Functions intercept the request first.
//
// Returns a Response when a redirect should be issued, otherwise null.
function canonicalHostRedirect(url) {
  // Defensive: only act on the exact www host. Never redirect the apex
  // (`esrf.net`) — that would loop. Subdomains other than www are left
  // alone; if any are added later they'll need explicit handling.
  if (url.hostname.toLowerCase() !== 'www.esrf.net') return null;
  const target = new URL(url.toString());
  target.hostname = 'esrf.net';
  target.protocol = 'https:';
  target.port = '';
  return Response.redirect(target.toString(), 301);
}

// Expose internals for the test harness only. This is a no-op at runtime
// (globalThis always exists) and adds no observable behaviour for visitors.
globalThis.__esrfBotProtection = {
  shouldBlock,
  isAdSenseUA,
  isBadBotUA,
  isEuropeanCountry,
  canonicalHostRedirect,
  EUROPEAN_COUNTRIES,
  ADSENSE_UA_ALLOWLIST,
  BAD_BOT_UA_PATTERNS,
};

// -------------------------------------------------------------------------
// Middleware entry point. Pages Functions calls this for every request
// under `functions/` routing. We pass through to `next()` for the vast
// majority of traffic; the block path returns 403 directly.
export async function onRequest(context) {
  const { request, next } = context;

  // Step 0: canonical host redirect (www.esrf.net -> esrf.net). Must run
  // before bot/geo blocking so that requests from outside Europe (which
  // would otherwise be 403'd by the bot rule for www.*) are sent to the
  // canonical host first.
  const redirect = canonicalHostRedirect(new URL(request.url));
  if (redirect) return redirect;

  const ua = request.headers.get('user-agent') || '';
  const cf = request.cf || null;

  const decision = shouldBlock(cf, ua);

  if (decision.block) {
    // Short plain-text body + hardened headers. We deliberately do not
    // reveal the exact matching rule to the client.
    return new Response('Forbidden\n', {
      status: 403,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        // Tell caches/CDNs not to keep this response; decisions can change.
        'cache-control': 'no-store',
        // Security headers — safe defaults for an error page.
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        // Discourage robots from indexing the block page.
        'x-robots-tag': 'noindex, nofollow',
        // Non-standard but useful for log correlation.
        'x-block-reason': decision.reason,
      },
    });
  }

  return next();
}
