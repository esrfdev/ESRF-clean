#!/usr/bin/env python3
"""Generate events.json from curated manual events + automated sources.

Inputs
------
- data/curated_events.json: Manually maintained list. Add direct/manual events
  here; they are never overwritten. Schema matches events.json (see below).
- data/event_sources.json:  Automated sources (RSS/Atom/iCal/HTML). Each source
  is fetched best-effort; failures are logged and skipped so the whole run
  never breaks because of one broken feed.

Output
------
- events.json at repo root. Same schema as before, so events.html keeps working
  without changes. Fields per event:
    event_name, organiser, dates, city, country, type, sector_relevance (list),
    url, description, lat (optional), lon (optional), source (optional label),
    auto (bool, true for automated entries).

Dedupe
------
Duplicates are possible both within automated sources and between a manual
curated entry and an automated one (e.g. ENISA publishes an event we already
added by hand). The dedupe key is a tuple of normalised identifiers:
  1. URL (host + path, lowercased, stripped of tracking params).
  2. Normalised title (lowercase, whitespace-collapsed, punctuation stripped).
  3. Start-date text (normalised).
  4. City (lowercased).
An automated event is considered a duplicate of a curated one if:
  - its URL matches, OR
  - its (normalised title + city) matches, OR
  - its (normalised title + start-date) matches.
Curated events always win: when a duplicate is detected, the curated entry is
kept verbatim and the automated one is dropped. Among automated entries, the
first one wins and later ones are dropped.

Run locally
-----------
    pip install feedparser requests beautifulsoup4 icalendar
    python3 scripts/fetch_events.py
"""
from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import sys
from typing import Any, Iterable
from urllib.parse import urlsplit, urlunsplit

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CURATED_PATH = os.path.join(ROOT, "data", "curated_events.json")
SOURCES_PATH = os.path.join(ROOT, "data", "event_sources.json")
OUT_PATH = os.path.join(ROOT, "events.json")

HTTP_TIMEOUT = 20
USER_AGENT = "Mozilla/5.0 (compatible; ESRF.net events-bot/1.0; +https://www.esrf.net)"
MAX_PER_SOURCE = 25
# Drop events whose parsed start date is older than this many days.
MAX_PAST_DAYS = 30

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")
PUNCT_RE = re.compile(r"[^\w\s]", flags=re.UNICODE)

MONTH_NAMES = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}


def strip_html(raw: str) -> str:
    if not raw:
        return ""
    return WS_RE.sub(" ", html.unescape(TAG_RE.sub(" ", raw))).strip()


def norm_title(s: str) -> str:
    s = (s or "").lower()
    s = PUNCT_RE.sub(" ", s)
    return WS_RE.sub(" ", s).strip()


def norm_url(u: str) -> str:
    if not u:
        return ""
    try:
        sp = urlsplit(u.strip())
        # Drop fragment; drop query entirely — tracking params dominate.
        return urlunsplit((sp.scheme.lower(), sp.netloc.lower(), sp.path.rstrip("/"), "", "")).lower()
    except Exception:
        return u.strip().lower()


def norm_city(s: str) -> str:
    return WS_RE.sub(" ", (s or "").lower()).strip()


def norm_dates(s: str) -> str:
    # Collapse whitespace and dash variants so "7 May 2026" == "7  May  2026".
    s = (s or "").lower().replace("–", "-").replace("—", "-")
    return WS_RE.sub(" ", s).strip()


def parse_start_date(dates: str) -> dt.date | None:
    """Best-effort parse of the start date from a free-form 'dates' string.
    Returns None if nothing could be extracted. Mirrors the logic in
    events.html so ordering stays consistent.
    """
    if not dates:
        return None
    s = dates.strip()
    # '7 May 2026' or '26-29 May 2026' or '7–9 May 2026'
    m = re.search(r"(\d{1,2})\s*[–-]?\s*\d{0,2}\s+([A-Za-z]+)\s+(\d{4})", s)
    if m:
        mon = MONTH_NAMES.get(m.group(2).lower())
        if mon:
            try:
                return dt.date(int(m.group(3)), mon, int(m.group(1)))
            except ValueError:
                return None
    # 'May 2026'
    m = re.search(r"([A-Za-z]+)\s+(\d{4})", s)
    if m:
        mon = MONTH_NAMES.get(m.group(1).lower())
        if mon:
            try:
                return dt.date(int(m.group(2)), mon, 1)
            except ValueError:
                return None
    # ISO fragment '2026-05-07'
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    return None


def format_dates_from_iso(start: dt.date, end: dt.date | None = None) -> str:
    """Render a date range in the same 'dates' text style used by curated events."""
    months = ["January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"]
    if end and end != start:
        if end.year == start.year and end.month == start.month:
            return f"{start.day}\u2013{end.day} {months[start.month-1]} {start.year}"
        if end.year == start.year:
            return f"{start.day} {months[start.month-1]} \u2013 {end.day} {months[end.month-1]} {start.year}"
        return f"{start.day} {months[start.month-1]} {start.year} \u2013 {end.day} {months[end.month-1]} {end.year}"
    return f"{start.day} {months[start.month-1]} {start.year}"


# ---------------------------------------------------------------------------
# Source fetchers. Each returns a list[dict] of normalised events and never
# raises — problems are logged to stderr and an empty list is returned.
# ---------------------------------------------------------------------------

def _http_get(url: str) -> bytes | None:
    try:
        import requests  # local import so script imports still work without deps
        resp = requests.get(
            url,
            timeout=HTTP_TIMEOUT,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/rss+xml, application/atom+xml, application/xml, text/calendar, text/html;q=0.8, */*;q=0.1",
            },
        )
        resp.raise_for_status()
        return resp.content
    except Exception as exc:  # noqa: BLE001
        print(f"  ! fetch failed: {url}: {exc}", file=sys.stderr)
        return None


def fetch_rss(source: dict[str, Any]) -> list[dict[str, Any]]:
    body = _http_get(source["url"])
    if not body:
        return []
    try:
        import feedparser
        parsed = feedparser.parse(body)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! [{source['name']}] parse failed: {exc}", file=sys.stderr)
        return []
    if not parsed.entries:
        return []
    out: list[dict[str, Any]] = []
    for entry in parsed.entries[:MAX_PER_SOURCE]:
        title = (entry.get("title") or "").strip()
        link = (entry.get("link") or "").strip()
        if not title or not link:
            continue
        description = strip_html(entry.get("summary") or entry.get("description") or "")
        start = _date_from_entry(entry)
        dates_text = format_dates_from_iso(start) if start else ""
        ev = _build_event(
            source,
            event_name=title,
            url=link,
            description=description[:500],
            dates=dates_text,
        )
        out.append(ev)
    return out


def fetch_ical(source: dict[str, Any]) -> list[dict[str, Any]]:
    body = _http_get(source["url"])
    if not body:
        return []
    try:
        from icalendar import Calendar
        cal = Calendar.from_ical(body)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! [{source['name']}] ical parse failed: {exc}", file=sys.stderr)
        return []
    out: list[dict[str, Any]] = []
    for comp in cal.walk():
        if comp.name != "VEVENT":
            continue
        title = str(comp.get("SUMMARY") or "").strip()
        url = str(comp.get("URL") or "").strip()
        description = strip_html(str(comp.get("DESCRIPTION") or ""))
        location = str(comp.get("LOCATION") or "").strip()
        start = comp.get("DTSTART")
        end = comp.get("DTEND")
        start_d = _coerce_date(start.dt if start else None)
        end_d = _coerce_date(end.dt if end else None)
        if not title or not start_d:
            continue
        city = source.get("city") or _city_from_location(location) or ""
        ev = _build_event(
            source,
            event_name=title,
            url=url or source.get("site", ""),
            description=description[:500],
            dates=format_dates_from_iso(start_d, end_d),
            city=city,
        )
        out.append(ev)
        if len(out) >= MAX_PER_SOURCE:
            break
    return out


def fetch_html(source: dict[str, Any]) -> list[dict[str, Any]]:
    """Very conservative HTML fallback: reserved for future per-site parsers.
    For now, we do not attempt generic HTML scraping — it produces too many
    false events. Returning [] keeps the workflow safe.
    """
    print(f"  · [{source['name']}] html type not implemented — skipping", file=sys.stderr)
    return []


def _coerce_date(value: Any) -> dt.date | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    return None


def _date_from_entry(entry) -> dt.date | None:
    # Try common RSS/Atom start-date fields first, then fall back to publish time.
    for key in ("start_time_parsed", "dtstart_parsed", "published_parsed", "updated_parsed"):
        ts = entry.get(key)
        if ts:
            try:
                return dt.date(ts.tm_year, ts.tm_mon, ts.tm_mday)
            except Exception:
                pass
    # feedparser exposes some custom fields as strings
    for key in ("start", "dtstart", "start_date"):
        val = entry.get(key)
        if isinstance(val, str):
            d = parse_start_date(val)
            if d:
                return d
    return None


_CITY_SEP = re.compile(r"[,/|]")


def _city_from_location(location: str) -> str:
    if not location:
        return ""
    # Usually "City, Country" — take the first component.
    return _CITY_SEP.split(location, 1)[0].strip()


def _build_event(
    source: dict[str, Any],
    *,
    event_name: str,
    url: str,
    description: str,
    dates: str,
    city: str | None = None,
    country: str | None = None,
) -> dict[str, Any]:
    return {
        "event_name": event_name,
        "organiser": source.get("organiser", source.get("name", "")),
        "dates": dates or "",
        "city": city or source.get("city", ""),
        "country": country or source.get("country", "EU"),
        "type": source.get("default_type", "conference"),
        "sector_relevance": list(source.get("default_sectors", [])),
        "url": url,
        "description": description or "",
        "source": source.get("name", ""),
        "auto": True,
    }


FETCHERS = {
    "rss": fetch_rss,
    "atom": fetch_rss,  # feedparser handles both
    "ical": fetch_ical,
    "ics": fetch_ical,
    "html": fetch_html,
}


# ---------------------------------------------------------------------------
# Dedupe
# ---------------------------------------------------------------------------

def _event_keys(e: dict[str, Any]) -> set[tuple[str, str]]:
    """Return the set of dedupe keys for this event. Each key is a tuple
    (kind, value). Two events are duplicates iff they share at least one key."""
    keys: set[tuple[str, str]] = set()
    u = norm_url(e.get("url", ""))
    if u:
        keys.add(("url", u))
    t = norm_title(e.get("event_name", ""))
    city = norm_city(e.get("city", ""))
    dates = norm_dates(e.get("dates", ""))
    if t and city:
        keys.add(("title+city", f"{t}|{city}"))
    if t and dates:
        keys.add(("title+dates", f"{t}|{dates}"))
    return keys


def dedupe(curated: list[dict[str, Any]], automated: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge curated + automated, removing duplicates. Curated always wins.

    Algorithm:
    - Collect the union of dedupe keys across all curated events.
    - For each automated event, if any of its keys is already claimed by a
      curated event OR by an earlier automated event, skip it. Otherwise add
      it and register its keys.
    """
    claimed: dict[tuple[str, str], str] = {}  # key -> "curated" or source name
    merged: list[dict[str, Any]] = []

    for e in curated:
        merged.append(e)
        for k in _event_keys(e):
            claimed.setdefault(k, "curated")

    dropped = 0
    for e in automated:
        ks = _event_keys(e)
        hit = next((k for k in ks if k in claimed), None)
        if hit is not None:
            dropped += 1
            continue
        merged.append(e)
        for k in ks:
            claimed[k] = e.get("source", "auto")

    print(f"dedupe: {len(curated)} curated + {len(automated)} automated → {len(merged)} kept ({dropped} dropped)", file=sys.stderr)
    return merged


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load_json(path: str, default: Any) -> Any:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def is_recent(e: dict[str, Any], cutoff: dt.date) -> bool:
    """Keep events whose start date is unknown OR >= cutoff."""
    d = parse_start_date(e.get("dates", ""))
    if d is None:
        return True
    return d >= cutoff


def main() -> int:
    curated_raw = load_json(CURATED_PATH, [])
    if not isinstance(curated_raw, list):
        print("curated_events.json must be a JSON array — aborting", file=sys.stderr)
        return 1
    # Ensure curated events are marked auto=False for transparency (non-destructive).
    curated = [{**e, "auto": False} for e in curated_raw]

    sources_cfg = load_json(SOURCES_PATH, {"sources": []})
    sources = sources_cfg.get("sources", []) if isinstance(sources_cfg, dict) else []

    automated: list[dict[str, Any]] = []
    for src in sources:
        kind = (src.get("type") or "rss").lower()
        fetcher = FETCHERS.get(kind)
        if not fetcher:
            print(f"  ! [{src.get('name')}] unknown type '{kind}'", file=sys.stderr)
            continue
        try:
            items = fetcher(src)
        except Exception as exc:  # noqa: BLE001 — never let one source kill the run
            print(f"  ! [{src.get('name')}] crashed: {exc}", file=sys.stderr)
            items = []
        print(f"  · [{src.get('name')}] {len(items)} events", file=sys.stderr)
        automated.extend(items)

    # Drop past events that are clearly over (helps with stale feeds).
    cutoff = dt.date.today() - dt.timedelta(days=MAX_PAST_DAYS)
    automated = [e for e in automated if is_recent(e, cutoff)]

    merged = dedupe(curated, automated)

    # Sort: parsable dates first, ascending; unparsable at the end in original order.
    def sort_key(e: dict[str, Any]) -> tuple[int, str]:
        d = parse_start_date(e.get("dates", ""))
        if d is None:
            return (1, e.get("event_name", ""))
        return (0, d.isoformat())

    merged.sort(key=sort_key)

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
        f.write("\n")

    auto_count = sum(1 for e in merged if e.get("auto"))
    print(f"Wrote {OUT_PATH} · {len(merged)} events ({len(merged)-auto_count} curated, {auto_count} automated)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
