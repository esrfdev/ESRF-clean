#!/usr/bin/env python3
"""Fetch RSS feeds declared in data/sources.json and produce news-data.json.

Design choices:
- Per-source try/except: one broken feed must never break the whole run.
- Dedupe on URL.
- Max article age: 30 days.
- Per source cap: 8 items (keeps overall list balanced).
- Fixed output schema for backwards compatibility with app.js:
    title, url, organisation, orgUrl, pillar, country, source, snippet, date
  Plus new fields: lang, scope ("european"|"national").
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
OUT_PATH = os.path.join(ROOT, "news-data.json")

MAX_AGE_DAYS = 30
PER_SOURCE_CAP = 8
SNIPPET_CHARS = 300
HTTP_TIMEOUT = 15
# Some public broadcaster RSS endpoints (SVT, DR) block bot-UA strings; use a
# browser-style UA to be treated as a normal client.
USER_AGENT = "Mozilla/5.0 (compatible; ESRF.net dispatch-bot/1.0; +https://www.esrf.net)"

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


# Loaded once in main() and passed to fetch_one
_FILTER: dict[str, Any] = {}


def passes_topic_filter(title: str, snippet: str, source_name: str, lang: str) -> bool:
    """Keep article if the source is always_keep OR if title+snippet contain a
    topic keyword in the locale. Our source catalogue is already geographically
    scoped to Europe, so we do not require an explicit Europe reference here
    (that would reject relevant national stories like 'Germany floods')."""
    if source_name in _FILTER.get("always_keep_sources", []):
        return True
    hay = f"{title} {snippet}".lower()
    topic_kws = _FILTER.get("topic", {}).get(lang) or _FILTER.get("topic", {}).get("en", [])
    return any(kw in hay for kw in topic_kws)


def fetch_one(source: dict[str, Any], *, scope: str, lang: str) -> list[dict[str, Any]]:
    """Return list of article dicts for one source. Never raises."""
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
        return []

    if parsed.bozo and not parsed.entries:
        print(f"  ! [{name}] feed not parseable", file=sys.stderr)
        return []

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
        if not passes_topic_filter(title, snippet, name, filter_lang):
            continue
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
            }
        )
        if len(out) >= PER_SOURCE_CAP:
            break
    print(f"  · [{name}] {len(parsed.entries)} raw → {len(out)} kept", file=sys.stderr)
    return out


def main() -> int:
    global _FILTER
    with open(SOURCES_PATH, encoding="utf-8") as f:
        cfg = json.load(f)
    with open(FILTER_PATH, encoding="utf-8") as f:
        _FILTER = json.load(f)

    tasks: list[tuple[dict[str, Any], str, str]] = []
    for src in cfg.get("european", []):
        tasks.append((src, "european", "eu"))
    for lang, srcs in (cfg.get("national") or {}).items():
        for src in srcs:
            tasks.append((src, "national", lang))

    print(f"Fetching {len(tasks)} sources…", file=sys.stderr)
    t0 = time.time()
    articles: list[dict[str, Any]] = []
    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fetch_one, src, scope=scope, lang=lang) for src, scope, lang in tasks]
        for fut in cf.as_completed(futures):
            articles.extend(fut.result())
    print(f"Fetched in {time.time() - t0:.1f}s · {len(articles)} raw items", file=sys.stderr)

    # Dedupe on URL, keep earliest entry
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for a in articles:
        key = a["url"].split("#")[0].split("?utm_")[0]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(a)

    # Sort: newest first
    deduped.sort(key=lambda a: a["date"], reverse=True)

    # Counts
    org_names = sorted({a["organisation"] for a in deduped})
    data = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "article_count": len(deduped),
        "org_count": len(org_names),
        "focus": "European resilience & regional strengthening",
        "articles": deduped,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Wrote {OUT_PATH} · {len(deduped)} articles · {len(org_names)} sources", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
