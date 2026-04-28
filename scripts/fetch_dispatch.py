#!/usr/bin/env python3
"""Fetch RSS feeds declared in data/sources.json and produce news-data.json.

Design choices:
- Per-source try/except: one broken feed must never break the whole run.
- Dedupe on URL.
- Per source cap: 8 items (per fresh fetch — historical retention preserves more).
- Historical retention: articles dated on/after RETENTION_START stay in
  news-data.json across runs, so a transient feed outage doesn't wipe history
  and the dispatch grows over the year instead of resetting daily.
- Fixed output schema for backwards compatibility with app.js:
    title, url, organisation, orgUrl, pillar, country, source, snippet, date
  Plus new fields: lang, scope ("european"|"national"), mentions.
- Adds run-status block: status ("ok"|"degraded"), unavailable_sources[], lang_counts{}.
- Writes news-data.json at repo root.

Run locally:
    pip install feedparser requests
    python3 scripts/fetch_dispatch.py
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import html
import json
import os
import re
import sys
import time
from typing import Any

import feedparser
import requests

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCES_PATH = os.path.join(ROOT, "data", "sources.json")
FILTER_PATH = os.path.join(ROOT, "data", "topic_filter.json")
DIRECTORY_PATH = os.path.join(ROOT, "companies_extracted.json")
OUT_PATH = os.path.join(ROOT, "news-data.json")

# Articles dated on/after this point are preserved across runs (historical
# retention). Picked at the start of the calendar year so the dispatch
# accumulates a year-to-date archive instead of being a 30-day rolling window.
RETENTION_START = dt.date(2026, 1, 1)
# How far back a single fetch will look for "fresh" items. Older items still
# survive via the merge with the existing news-data.json (down to RETENTION_START).
MAX_AGE_DAYS = 30
PER_SOURCE_CAP = 8
SNIPPET_CHARS = 300
HTTP_TIMEOUT = 15
# Some public broadcaster RSS endpoints (SVT, DR) block bot-UA strings; use a
# browser-style UA to be treated as a normal client.
USER_AGENT = "Mozilla/5.0 (compatible; ESRF.net dispatch-bot/1.0; +https://esrf.net)"

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def clean_snippet(raw: str) -> str:
    if not raw:
        return ""
    text = html.unescape(TAG_RE.sub(" ", raw))
    text = WS_RE.sub(" ", text).strip()
    if len(text) > SNIPPET_CHARS:
        text = text[:SNIPPET_CHARS].rstrip() + "…"
    return text


def to_iso_date(entry) -> str:
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        ts = entry.get(key)
        if ts:
            try:
                return dt.date(ts.tm_year, ts.tm_mon, ts.tm_mday).isoformat()
            except Exception:  # noqa: BLE001
                pass
    return dt.date.today().isoformat()


# Loaded once in main()
_FILTER: dict[str, Any] = {}
_DIRECTORY_NAMES: list[str] = []  # lowercase, length ≥ MIN_DIR_NAME_LEN
_DIR_PATTERNS: list[tuple[str, re.Pattern[str]]] = []  # (name, compiled \bname\b regex)

# Minimum length of an org name to be considered for mention matching.
# Raising this from 6 to 8 eliminates short/common words like 'safely',
# 'resolve', 'intersec' that were slipping through as false positives.
MIN_DIR_NAME_LEN = 8

# Common words and short ambiguous org names to exclude from the match list.
# These either clash with English/European vocabulary or are too generic to
# reliably indicate a directory mention.
_DIR_NAME_BLOCKLIST = {
    # single-word generic brand words
    "orange", "shield", "phoenix", "vision", "horizon", "summit", "sentinel",
    "atlas", "apex", "delta", "nexus", "beacon", "compass", "frontier", "alpha",
    "bravo", "charlie", "fortress", "eagle", "falcon", "lion", "bear", "titan",
    "omega", "sigma", "global", "europe", "european", "security", "defence",
    "defense", "systems", "solutions", "group", "holdings", "services",
    "technology", "technologies", "international", "limited", "corporation",
    "industries", "consulting", "advisory", "networks", "partners", "digital",
    "cyber", "secure", "shield ltd", "trust",
    # confirmed false-positives from live runs
    "safely", "resolve", "intersec", "advisor", "consent", "envira", "aquarius",
    "acronyms", "biotope", "calima", "corbel", "delair", "delska", "aureus+",
    "astrid", "celerity", "centrica", "argotec",
}


def find_mentioned_orgs(haystack: str) -> list[str]:
    """Return directory org names that appear as whole words in text.
    Uses word-boundary regex to avoid substring false positives like
    'intersec' matching 'intersecția'. Case-insensitive."""
    if not _DIR_PATTERNS:
        return []
    hay = haystack.lower()
    hits: list[str] = []
    for name, pat in _DIR_PATTERNS:
        if pat.search(hay):
            hits.append(name)
            if len(hits) >= 3:
                break
    return hits


def is_directory_mention(title: str, snippet: str) -> list[str]:
    return find_mentioned_orgs(f"{title} {snippet}")


# Sources in national scope that nevertheless carry world news (international
# desks of European newspapers). Even though they are scoped to a country,
# their articles must still reference Europe explicitly — otherwise we get
# stories about Madagascar, Sudan, etc. slipping through just because they
# mention "crise".
_WORLD_BUREAU_SOURCES = {
    "Le Monde – International",
}


def passes_topic_filter(title: str, snippet: str, source_name: str, lang: str, scope: str) -> bool:
    """Filter rules:
    1. Sources in always_keep_sources bypass the filter (these are official
       crisis/security agencies where everything is on-topic).
    2. Every other source must contain a topic keyword in title+snippet.
    3. For european-scope general media (Politico, Guardian, BBC, etc.), the
       article must ALSO reference Europe explicitly — this rejects global
       politics stories that happen to mention 'crisis' or 'cyberattack'.
    4. National-scope sources from international news desks (Le Monde International,
       etc.) also require Europe-ref.
    5. Other national-scope sources are exempt from the Europe-ref check because
       they are by definition reporting on their own European country.
    """
    if source_name in _FILTER.get("always_keep_sources", []):
        return True
    hay = f"{title} {snippet}".lower()
    # Directory mention is always enough to pass — if a European resilience
    # organisation from our directory is named, the story is relevant.
    if find_mentioned_orgs(hay):
        return True
    topic_kws = _FILTER.get("topic", {}).get(lang) or _FILTER.get("topic", {}).get("en", [])
    if not any(kw in hay for kw in topic_kws):
        return False
    require_europe = (scope == "european") or (source_name in _WORLD_BUREAU_SOURCES)
    if require_europe:
        europe_kws = _FILTER.get("europe_ref", [])
        if europe_kws and not any(kw in hay for kw in europe_kws):
            return False
    return True


def fetch_one(source: dict[str, Any], *, scope: str, lang: str) -> tuple[list[dict[str, Any]], bool]:
    """Return (articles, ok) for one source. Never raises.

    ok=False signals that the feed was unreachable or unparseable, so the
    caller can mark the source as unavailable and lean on historical retention
    rather than dropping articles already in news-data.json.
    """
    name = source["name"]
    url = source["url"]
    try:
        resp = requests.get(
            url,
            timeout=HTTP_TIMEOUT,
            headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.1"},
        )
        resp.raise_for_status()
        parsed = feedparser.parse(resp.content)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! [{name}] fetch failed: {exc}", file=sys.stderr)
        return [], False

    if parsed.bozo and not parsed.entries:
        print(f"  ! [{name}] feed not parseable", file=sys.stderr)
        return [], False

    out: list[dict[str, Any]] = []
    cutoff = dt.date.today() - dt.timedelta(days=MAX_AGE_DAYS)
    # Scan more entries than cap so the topic filter has room to reject
    for entry in parsed.entries[: PER_SOURCE_CAP * 6]:
        link = entry.get("link") or ""
        title = (entry.get("title") or "").strip()
        if not link or not title:
            continue
        date_iso = to_iso_date(entry)
        try:
            if dt.date.fromisoformat(date_iso) < cutoff:
                continue
        except Exception:  # noqa: BLE001
            pass
        snippet = clean_snippet(entry.get("summary") or entry.get("description") or "")
        # Topic filter: for european scope use source's own feed language (English for most),
        # for national scope use the target lang
        filter_lang = lang if scope == "national" else "en"
        if not passes_topic_filter(title, snippet, name, filter_lang, scope):
            continue
        mentions = is_directory_mention(title, snippet)
        out.append(
            {
                "title": title,
                "url": link,
                "organisation": name,
                "orgUrl": source.get("site", ""),
                "pillar": source.get("pillar", "stewardship"),
                "country": source.get("country", "EU"),
                "source": name,
                "snippet": snippet,
                "date": date_iso,
                "lang": lang,
                "scope": scope,
                "mentions": mentions,
            }
        )
        if len(out) >= PER_SOURCE_CAP:
            break
    print(f"  · [{name}] {len(parsed.entries)} raw → {len(out)} kept", file=sys.stderr)
    return out, True


def _load_existing_history() -> list[dict[str, Any]]:
    """Read existing news-data.json (if any) and return articles dated on/after
    RETENTION_START. Articles older than that are evicted permanently."""
    if not os.path.exists(OUT_PATH):
        return []
    try:
        with open(OUT_PATH, encoding="utf-8") as f:
            prev = json.load(f)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! could not read existing {OUT_PATH}: {exc}", file=sys.stderr)
        return []
    keep: list[dict[str, Any]] = []
    for a in prev.get("articles") or []:
        date_str = (a.get("date") or "").strip()
        try:
            d = dt.date.fromisoformat(date_str)
        except Exception:  # noqa: BLE001
            continue
        if d >= RETENTION_START:
            keep.append(a)
    print(f"Loaded {len(keep)} historical articles (≥ {RETENTION_START.isoformat()})", file=sys.stderr)
    return keep


def _dedupe_url(key_url: str) -> str:
    return key_url.split("#")[0].split("?utm_")[0]


def main() -> int:
    global _FILTER, _DIRECTORY_NAMES, _DIR_PATTERNS
    with open(SOURCES_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    with open(FILTER_PATH, encoding="utf-8") as f:
        _FILTER = json.load(f)
    try:
        with open(DIRECTORY_PATH, encoding="utf-8") as f:
            directory = json.load(f)
        # Only include org names ≥ MIN_DIR_NAME_LEN chars and not in blocklist
        _DIRECTORY_NAMES = []
        seen_names: set[str] = set()
        for o in directory:
            if not (isinstance(o, dict) and o.get("name")):
                continue
            nm = o["name"].strip().lower()
            if len(nm) < MIN_DIR_NAME_LEN or nm in _DIR_NAME_BLOCKLIST or nm in seen_names:
                continue
            seen_names.add(nm)
            _DIRECTORY_NAMES.append(nm)
        # Compile \bname\b patterns once; re.UNICODE so Dutch/French/German
        # accented characters still count as word chars at boundaries.
        _DIR_PATTERNS = [
            (nm, re.compile(rf"\b{re.escape(nm)}\b", flags=re.UNICODE))
            for nm in _DIRECTORY_NAMES
        ]
        print(f"Loaded {len(_DIRECTORY_NAMES)} directory org names for mention-matching", file=sys.stderr)
    except FileNotFoundError:
        print("Directory file not found — skipping mention matching", file=sys.stderr)

    tasks: list[tuple[dict[str, Any], str, str]] = []
    for src in cfg.get("european", []):
        tasks.append((src, "european", "eu"))
    for lang, srcs in (cfg.get("national") or {}).items():
        for src in srcs:
            tasks.append((src, "national", lang))

    print(f"Fetching {len(tasks)} sources…", file=sys.stderr)
    t0 = time.time()
    fresh: list[dict[str, Any]] = []
    unavailable: list[str] = []
    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        future_to_name = {
            pool.submit(fetch_one, src, scope=scope, lang=lang): src["name"]
            for src, scope, lang in tasks
        }
        for fut in cf.as_completed(future_to_name):
            name = future_to_name[fut]
            try:
                items, ok = fut.result()
            except Exception as exc:  # noqa: BLE001 — defensive: fetch_one shouldn't raise
                print(f"  ! [{name}] unexpected error: {exc}", file=sys.stderr)
                items, ok = [], False
            fresh.extend(items)
            if not ok:
                unavailable.append(name)
    print(f"Fetched in {time.time() - t0:.1f}s · {len(fresh)} fresh items · {len(unavailable)} unavailable", file=sys.stderr)

    # Merge historical articles (>= RETENTION_START) with the fresh fetches.
    # Fresh entries win on URL collision so updated titles/snippets get refreshed.
    history = _load_existing_history()
    merged: dict[str, dict[str, Any]] = {}
    for a in history:
        merged[_dedupe_url(a["url"])] = a
    for a in fresh:
        merged[_dedupe_url(a["url"])] = a
    deduped = list(merged.values())

    # Drop anything older than RETENTION_START (covers history items that
    # may have slipped through with a future-dated cutoff in the past).
    deduped = [
        a for a in deduped
        if (lambda d: d is not None and d >= RETENTION_START)(_safe_date(a.get("date")))
    ]

    # Sort: newest first
    deduped.sort(key=lambda a: a["date"], reverse=True)

    # Counts
    org_names = sorted({a["organisation"] for a in deduped})
    lang_counts: dict[str, int] = {}
    for a in deduped:
        lg = a.get("lang") or "eu"
        lang_counts[lg] = lang_counts.get(lg, 0) + 1
    status = "ok" if not unavailable else "degraded"

    data = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "article_count": len(deduped),
        "org_count": len(org_names),
        "focus": "European resilience & regional strengthening",
        "status": status,
        "unavailable_sources": sorted(unavailable),
        "lang_counts": lang_counts,
        "retention_start": RETENTION_START.isoformat(),
        "articles": deduped,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(
        f"Wrote {OUT_PATH} · {len(deduped)} articles · {len(org_names)} sources · "
        f"status={status} · langs={lang_counts}",
        file=sys.stderr,
    )
    return 0


def _safe_date(s: Any) -> dt.date | None:
    if not isinstance(s, str):
        return None
    try:
        return dt.date.fromisoformat(s)
    except Exception:  # noqa: BLE001
        return None


if __name__ == "__main__":
    sys.exit(main())
