/**
 * ESRF News Aggregator — Cloudflare Worker
 * 
 * Fetches Google News RSS feeds for ESRF organisations,
 * parses articles, caches in KV, and serves via /api/news endpoint.
 * 
 * Setup:
 * 1. Create a KV namespace: `wrangler kv:namespace create "NEWS_CACHE"`
 * 2. Update wrangler.toml with the namespace ID
 * 3. Deploy: `wrangler deploy`
 * 4. Add a Cron Trigger in Cloudflare dashboard (every 6 hours recommended)
 */

// ── CONFIG ──
const GOOGLE_NEWS_RSS = 'https://news.google.com/rss/search?q=';
const MAX_ARTICLES_PER_ORG = 5;
const CACHE_KEY = 'esrf-news-latest';
const CACHE_TTL = 21600; // 6 hours in seconds
const BATCH_SIZE = 10; // Fetch 10 orgs in parallel to avoid rate limits
const BATCH_DELAY = 2000; // 2s between batches

// ── ORGANISATION LIST (top ~100 most newsworthy from the 500) ──
// Full list can be loaded from KV if needed
const TRACKED_ORGS = [
  // Vigilance
  { name: 'Thales Group', pillar: 'vigilance', country: 'FR', query: '"Thales Group" security OR resilience OR defence' },
  { name: 'TNO', pillar: 'vigilance', country: 'NL', query: '"TNO Netherlands" security OR innovation OR research' },
  { name: 'Saab', pillar: 'vigilance', country: 'SE', query: '"Saab" surveillance OR security OR defense' },
  { name: 'Leonardo', pillar: 'vigilance', country: 'IT', query: '"Leonardo" cybersecurity OR electronics OR space' },
  { name: 'Securitas', pillar: 'vigilance', country: 'SE', query: '"Securitas" security OR protection' },
  { name: 'Airbus Defence', pillar: 'vigilance', country: 'DE', query: '"Airbus Defence" OR "Airbus Space" security OR satellite' },
  { name: 'Rohde & Schwarz', pillar: 'vigilance', country: 'DE', query: '"Rohde Schwarz" cybersecurity OR communications' },
  { name: 'Indra Sistemas', pillar: 'vigilance', country: 'ES', query: '"Indra Sistemas" technology OR security OR transport' },
  { name: 'Hensoldt', pillar: 'vigilance', country: 'DE', query: '"Hensoldt" sensor OR radar OR security' },
  { name: 'Elettronica', pillar: 'vigilance', country: 'IT', query: '"Elettronica" electronic OR defence' },

  // Stewardship
  { name: 'TenneT', pillar: 'stewardship', country: 'NL', query: '"TenneT" grid OR energy OR infrastructure' },
  { name: 'Enexis', pillar: 'stewardship', country: 'NL', query: '"Enexis" energy OR grid OR Netherlands' },
  { name: 'Port of Rotterdam', pillar: 'stewardship', country: 'NL', query: '"Port of Rotterdam" logistics OR security OR infrastructure' },
  { name: 'Alliander', pillar: 'stewardship', country: 'NL', query: '"Alliander" energy OR infrastructure' },
  { name: 'DNV', pillar: 'stewardship', country: 'NO', query: '"DNV" risk OR assurance OR certification' },
  { name: 'Bureau Veritas', pillar: 'stewardship', country: 'FR', query: '"Bureau Veritas" inspection OR certification OR compliance' },
  { name: 'Fugro', pillar: 'stewardship', country: 'NL', query: '"Fugro" geo-data OR infrastructure OR resilience' },
  { name: 'BAM Infra', pillar: 'stewardship', country: 'NL', query: '"BAM" infrastructure OR construction' },
  { name: 'Atos', pillar: 'stewardship', country: 'FR', query: '"Atos" IT OR cybersecurity OR digital' },
  { name: 'Siemens', pillar: 'stewardship', country: 'DE', query: '"Siemens" infrastructure OR digitalization OR energy' },

  // Empowerment
  { name: 'Ericsson', pillar: 'empowerment', country: 'SE', query: '"Ericsson" 5G OR telecom OR innovation' },
  { name: 'Sopra Steria', pillar: 'empowerment', country: 'FR', query: '"Sopra Steria" digital OR consulting OR technology' },
  { name: 'ASML', pillar: 'empowerment', country: 'NL', query: '"ASML" semiconductor OR technology OR export' },
  { name: 'NXP Semiconductors', pillar: 'empowerment', country: 'NL', query: '"NXP Semiconductors" chip OR automotive OR security' },
  { name: 'Nokia', pillar: 'empowerment', country: 'FI', query: '"Nokia" network OR 5G OR technology' },
  { name: 'SAP', pillar: 'empowerment', country: 'DE', query: '"SAP" enterprise OR cloud OR business' },
  { name: 'Dassault Systemes', pillar: 'empowerment', country: 'FR', query: '"Dassault Systemes" simulation OR digital OR industry' },
  { name: 'Capgemini', pillar: 'empowerment', country: 'FR', query: '"Capgemini" digital OR consulting OR innovation' },

  // Solidarity  
  { name: 'Red Cross Netherlands', pillar: 'solidarity', country: 'NL', query: '"Red Cross Netherlands" OR "Rode Kruis" disaster OR relief' },
  { name: 'Médecins Sans Frontières', pillar: 'solidarity', country: 'NL', query: '"MSF" OR "Médecins Sans Frontières" crisis OR emergency' },
  { name: 'KNMI', pillar: 'solidarity', country: 'NL', query: '"KNMI" weather OR climate OR warning' },
  { name: 'THW', pillar: 'solidarity', country: 'DE', query: '"THW" OR "Technisches Hilfswerk" disaster OR relief' },
  { name: 'Croix-Rouge française', pillar: 'solidarity', country: 'FR', query: '"Croix-Rouge française" emergency OR humanitarian' },
  { name: 'SMUR', pillar: 'solidarity', country: 'FR', query: '"SMUR" OR "SAMU" emergency OR medical OR France' },
  { name: 'Veiligheidsregio Rotterdam', pillar: 'solidarity', country: 'NL', query: '"Veiligheidsregio Rotterdam" safety OR emergency' },

  // Renewal
  { name: 'Siemens Energy', pillar: 'renewal', country: 'DE', query: '"Siemens Energy" renewable OR transition OR grid' },
  { name: 'Vattenfall', pillar: 'renewal', country: 'SE', query: '"Vattenfall" energy OR renewable OR transition' },
  { name: 'Vestas', pillar: 'renewal', country: 'DK', query: '"Vestas" wind OR energy OR turbine' },
  { name: 'Ørsted', pillar: 'renewal', country: 'DK', query: '"Ørsted" offshore OR wind OR green' },
  { name: 'Neste', pillar: 'renewal', country: 'FI', query: '"Neste" renewable OR sustainable OR fuel' },
];

// ── RSS PARSER ──
function parseRSSItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractTag(itemXml, 'title');
    const link = extractTag(itemXml, 'link');
    const pubDate = extractTag(itemXml, 'pubDate');
    const description = extractTag(itemXml, 'description');
    const source = extractTag(itemXml, 'source');
    if (title && link) {
      items.push({
        title: decodeEntities(title),
        url: link,
        date: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : null,
        snippet: description ? decodeEntities(description).replace(/<[^>]+>/g, '').slice(0, 200) : '',
        source: source ? decodeEntities(source) : ''
      });
    }
  }
  return items;
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${tag}>`, 's'));
  return match ? match[1].trim() : '';
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// ── FETCH ORG NEWS ──
async function fetchOrgNews(org) {
  try {
    const query = encodeURIComponent(org.query);
    const url = `${GOOGLE_NEWS_RSS}${query}&hl=en&gl=EU&ceid=EU:en`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ESRF-NewsBot/1.0' }
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const items = parseRSSItems(xml).slice(0, MAX_ARTICLES_PER_ORG);
    return items.map(item => ({
      ...item,
      organisation: org.name,
      pillar: org.pillar,
      country: org.country
    }));
  } catch (e) {
    console.error(`Error fetching news for ${org.name}:`, e);
    return [];
  }
}

// ── BATCH FETCH ──
async function fetchAllNews() {
  const allArticles = [];
  for (let i = 0; i < TRACKED_ORGS.length; i += BATCH_SIZE) {
    const batch = TRACKED_ORGS.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(fetchOrgNews));
    results.forEach(articles => allArticles.push(...articles));
    // Rate limit between batches
    if (i + BATCH_SIZE < TRACKED_ORGS.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }

  // Deduplicate by title similarity
  const seen = new Set();
  const unique = allArticles.filter(a => {
    const key = a.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by date descending
  unique.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  return unique;
}

// ── WORKER HANDLERS ──
export default {
  // HTTP request handler — serves /api/news
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://esrf.net',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/api/news' || url.pathname === '/') {
      try {
        // Try cache first
        const cached = await env.NEWS_CACHE.get(CACHE_KEY, { type: 'json' });
        if (cached) {
          return new Response(JSON.stringify(cached), {
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, max-age=1800',
              ...corsHeaders
            }
          });
        }

        // Cache miss — fetch fresh
        const articles = await fetchAllNews();
        const data = {
          articles,
          updated: new Date().toISOString(),
          count: articles.length
        };

        // Store in KV
        await env.NEWS_CACHE.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: CACHE_TTL });

        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=1800',
            ...corsHeaders
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Service temporarily unavailable', articles: [] }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    return new Response('Not found', { status: 404 });
  },

  // Cron trigger — refreshes cache every 6 hours
  async scheduled(event, env) {
    console.log('Cron: Refreshing news cache...');
    const articles = await fetchAllNews();
    const data = {
      articles,
      updated: new Date().toISOString(),
      count: articles.length
    };
    await env.NEWS_CACHE.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: CACHE_TTL });
    console.log(`Cron: Cached ${articles.length} articles`);
  }
};
