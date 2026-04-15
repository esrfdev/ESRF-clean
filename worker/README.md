# ESRF News Worker

Cloudflare Worker that aggregates news for ESRF network organisations via Google News RSS.

## Setup

### Prerequisites
- [Cloudflare account](https://dash.cloudflare.com) with Workers enabled (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### Steps

1. **Install Wrangler & Login**
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **Create KV Namespace**
   ```bash
   cd worker
   wrangler kv:namespace create "NEWS_CACHE"
   ```
   Copy the returned namespace ID.

3. **Update `wrangler.toml`**
   Replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` with the actual ID.

4. **Deploy**
   ```bash
   wrangler deploy
   ```

5. **Route Configuration**
   In Cloudflare Dashboard → your zone (esrf.net) → Workers Routes:
   - Pattern: `www.esrf.net/api/news*`
   - Worker: `esrf-news-worker`

   Alternatively, if using Cloudflare Pages Functions, move the worker to `functions/api/news.js`.

6. **Cron Trigger**
   Automatically configured via `wrangler.toml`. Runs every 6 hours.
   Verify in Dashboard → Workers → esrf-news-worker → Triggers.

## How it works

1. **Cron trigger** fires every 6 hours
2. Worker fetches Google News RSS for ~40 tracked organisations (batched, rate-limited)
3. Results are deduplicated, sorted, and cached in KV
4. Frontend (`/news.html`) fetches `/api/news` and renders the feed
5. If the Worker API is unavailable, the frontend falls back to demo data

## Costs

- **Workers Free Tier**: 100,000 requests/day, 10ms CPU per invocation
- **KV Free Tier**: 100,000 reads/day, 1,000 writes/day
- **Estimated usage**: ~4 cron runs/day (writes) + page views (reads)
- **Total cost**: $0 within free tier for typical traffic

## Expanding the org list

Edit `TRACKED_ORGS` in `news-worker.js` to add more organisations.
For the full 500-org list, store it in KV and load dynamically:

```js
const orgList = await env.NEWS_CACHE.get('org-list', { type: 'json' });
```
