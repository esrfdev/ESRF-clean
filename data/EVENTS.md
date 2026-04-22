# Events data

The event calendar on `/events.html` is driven by `events.json` at the repo
root. That file is **generated** by `scripts/fetch_events.py`. Don't edit it
directly — your changes will be overwritten by the next refresh.

## Two inputs

1. **`data/curated_events.json`** — manually maintained events. This is where
   you add direct/manual entries. Anything here is preserved verbatim and
   always wins over automated duplicates.
2. **`data/event_sources.json`** — automated sources (RSS/Atom/iCal). The
   script fetches these weekly, normalises the entries, and merges them with
   the curated list.

## Adding a manual event

Open `data/curated_events.json` and append an entry with the existing schema:

```json
{
  "event_name": "...",
  "organiser": "...",
  "dates": "7 May 2026",
  "city": "Brussels",
  "country": "Belgium",
  "type": "conference",
  "sector_relevance": ["Digital Infrastructure & Cybersecurity"],
  "url": "https://example.org/event",
  "description": "...",
  "lat": 50.85,
  "lon": 4.35
}
```

Commit and push. The weekly workflow will re-run `fetch_events.py` and your
event will appear in `events.json`.

To publish sooner, run the **"Refresh events (events.json)"** workflow from
the Actions tab (`workflow_dispatch`), or run it locally:

```bash
pip install feedparser requests beautifulsoup4 icalendar
python3 scripts/fetch_events.py
```

## Adding an automated source

Edit `data/event_sources.json` and add an entry under `sources`:

```json
{
  "name": "Acme Security Events",
  "type": "rss",
  "url": "https://example.org/events/feed",
  "site": "https://example.org/events",
  "organiser": "Acme",
  "country": "EU",
  "default_type": "conference",
  "default_sectors": ["Security & Protection"]
}
```

Supported types: `rss`, `atom`, `ical` (`ics`). `html` is a stub reserved for
per-site parsers.

## Dedupe behaviour

Duplicates are collapsed on any of these matches:

- Normalised URL (host + path, tracking params stripped), OR
- Normalised title + city, OR
- Normalised title + start date.

Curated events always win. When an automated source returns an event that
matches a curated one, the automated copy is dropped. Among automated
sources, the first encounter wins.

Automated entries carry `"auto": true` so the frontend can distinguish them
if ever needed. Curated entries are written back with `"auto": false`.

## Schedule

- Weekly: Monday 04:00 UTC (`.github/workflows/events.yml`).
- Manual: Actions → "Refresh events (events.json)" → "Run workflow".
- Per source: broken feeds are logged to stderr and skipped. One bad source
  never breaks the whole run.
