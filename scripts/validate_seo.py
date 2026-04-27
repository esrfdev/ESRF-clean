#!/usr/bin/env python3
"""validate_seo.py — structural SEO guardrails for esrf.net.

Catches the regressions that produced Search Console issues in April 2026:

  * 404s         — internal links pointing at files that don't exist
  * "Alternate page with proper canonical tag"
                 — internal links to .../index.html when the page's
                   canonical is the directory form, or to /foo/index.html
                   when the canonical is /foo/
  * "Crawled — currently not indexed"
                 — pages that are reachable but are not in sitemap and
                   are not marked noindex
  * sitemap drift — sitemap entries whose target file does not exist
                   or whose canonical disagrees with the listed URL
  * canonical drift — pages whose canonical does not self-reference the
                   path Cloudflare Pages will serve them under

Run from repo root:

    python3 scripts/validate_seo.py            # full audit
    python3 scripts/validate_seo.py --quiet    # exit code only

Exit codes:
    0 — all checks pass
    1 — one or more checks failed (details printed to stderr)
"""

from __future__ import annotations

import os
import re
import sys
import argparse
from html.parser import HTMLParser
from urllib.parse import urlparse, urldefrag, unquote
from xml.etree import ElementTree as ET

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CANONICAL_HOST = "esrf.net"
CANONICAL_ORIGIN = f"https://{CANONICAL_HOST}"

# Pages that intentionally do not appear in sitemap and are non-indexable.
# Each must carry a robots noindex meta or be unreachable from indexable
# pages. Listed here so the script knows not to flag them as "crawled
# but not indexed" candidates.
NON_INDEXABLE_FILES = {
    "maintenance.html",
    "google7704d050956c7783.html",   # Google Search Console verification
    "404.html",                      # custom 404 page, noindex
}

# Files at the repo root that look like HTML pages but should never be
# linked or canonicalised (reserved keywords / verification stubs).
SKIP_HTML_FILES = {
    "google7704d050956c7783.html",
}


class HrefExtractor(HTMLParser):
    """Collects href / src / og:url / canonical / robots from an HTML doc."""

    def __init__(self):
        super().__init__()
        self.refs = []         # list of (kind, value) — kind in {href, src}
        self.canonical = None
        self.og_url = None
        self.robots = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and a.get("href"):
            self.refs.append(("href", a["href"]))
        elif tag == "link":
            rel = (a.get("rel") or "").lower()
            href = a.get("href")
            if href:
                if "canonical" in rel and self.canonical is None:
                    self.canonical = href
                # we don't follow stylesheet/preconnect for 404 audit
                if rel in ("icon", "stylesheet"):
                    self.refs.append(("href", href))
        elif tag == "meta":
            prop = (a.get("property") or a.get("name") or "").lower()
            content = a.get("content")
            if prop == "og:url" and content:
                self.og_url = content
            if prop == "robots" and content:
                self.robots = content.lower()
        elif tag in ("script", "img") and a.get("src"):
            self.refs.append(("src", a["src"]))


def list_html_files() -> list[str]:
    """All HTML files we want to lint, relative to REPO_ROOT."""
    out = []
    for dirpath, _dirs, files in os.walk(REPO_ROOT):
        # Skip git, drafts, .claude
        rel_dir = os.path.relpath(dirpath, REPO_ROOT)
        if rel_dir.startswith((".git", ".claude", "editorials/drafts")):
            continue
        for fn in files:
            if fn.endswith(".html") and fn not in SKIP_HTML_FILES:
                out.append(os.path.relpath(os.path.join(dirpath, fn), REPO_ROOT))
    return sorted(out)


def file_to_canonical_path(rel_path: str) -> str:
    """Map a repo file to the path Cloudflare Pages serves it under
    AND that we want as canonical. /index.html collapses to /."""
    p = "/" + rel_path.replace(os.sep, "/")
    if p.endswith("/index.html"):
        p = p[: -len("index.html")]
    return p


def parse_html(rel_path: str) -> HrefExtractor:
    with open(os.path.join(REPO_ROOT, rel_path), encoding="utf-8") as f:
        text = f.read()
    p = HrefExtractor()
    p.feed(text)
    return p


def is_external_or_special(href: str) -> bool:
    if not href:
        return True
    h = href.strip()
    if h.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
        return True
    if h.startswith("//"):                     # protocol-relative external
        return True
    if h.startswith("${") or "${" in h:        # template literal
        return True
    parsed = urlparse(h)
    if parsed.scheme and parsed.scheme not in ("http", "https"):
        return True
    if parsed.scheme in ("http", "https"):
        # Off-site link, ignore.
        return parsed.netloc.lower() not in (CANONICAL_HOST, "www." + CANONICAL_HOST)
    return False


def resolve_internal(rel_source: str, href: str) -> str | None:
    """Return the absolute on-site path (no scheme/host) for an internal href,
    or None if it's external/special. Strips fragment and query."""
    if is_external_or_special(href):
        return None
    parsed = urlparse(href)
    # On-site absolute URL
    if parsed.scheme in ("http", "https"):
        path = parsed.path or "/"
    elif href.startswith("/"):
        path = parsed.path
    else:
        # Relative to source page directory
        src_dir = os.path.dirname("/" + rel_source.replace(os.sep, "/"))
        path = os.path.normpath(os.path.join(src_dir, parsed.path))
        if not path.startswith("/"):
            path = "/" + path
    path = unquote(urldefrag(path)[0])
    return path


def path_to_repo_file(path: str) -> str | None:
    """Map a served path to the repo file that satisfies it under
    Cloudflare Pages defaults. Returns None if no file would serve it."""
    if path == "/" or path == "":
        cand = "index.html"
    elif path.endswith("/"):
        cand = path.lstrip("/") + "index.html"
    else:
        cand = path.lstrip("/")
    abs_cand = os.path.join(REPO_ROOT, cand.replace("/", os.sep))
    if os.path.isfile(abs_cand):
        return cand
    # Cloudflare Pages does NOT add .html to extensionless URLs by default
    # for these pages (we keep .html suffixes). So bare 404 means 404.
    return None


def check_404s(pages: list[str]) -> list[str]:
    """Return a list of human-readable error strings for broken internal links."""
    errors = []
    seen = {}
    for page in pages:
        try:
            parsed = parse_html(page)
        except Exception as e:
            errors.append(f"{page}: parse failed: {e}")
            continue
        for kind, ref in parsed.refs:
            target = resolve_internal(page, ref)
            if target is None:
                continue
            # Strip query — Pages serves the file regardless
            target_clean = target.split("?", 1)[0]
            if target_clean in seen:
                if seen[target_clean] is False:
                    errors.append(f"{page}: broken {kind} -> {ref} (resolved {target_clean})")
                continue
            repo_file = path_to_repo_file(target_clean)
            seen[target_clean] = repo_file is not None
            if repo_file is None:
                errors.append(f"{page}: broken {kind} -> {ref} (resolved {target_clean})")
    return errors


def check_alternate_canonical_links(pages: list[str]) -> list[str]:
    """Internal links that, once resolved, would land on a path whose page
    self-canonicalises to a different URL. Those become "Alternate page
    with proper canonical tag" in Search Console.

    We check by:
      1. Building a map: served-path -> canonical declared by that page.
      2. For every internal link, comparing resolved path to that page's
         canonical. If they differ we flag the link.
    """
    # Step 1 — page canonicals indexed by served path
    page_canonical = {}    # served_path -> canonical_path (just path part)
    for page in pages:
        served = file_to_canonical_path(page)
        try:
            parsed = parse_html(page)
        except Exception:
            continue
        if not parsed.canonical:
            continue
        cp = urlparse(parsed.canonical).path or "/"
        page_canonical[served] = cp

    errors = []
    for page in pages:
        try:
            parsed = parse_html(page)
        except Exception:
            continue
        for kind, ref in parsed.refs:
            if kind != "href":
                continue
            target = resolve_internal(page, ref)
            if target is None:
                continue
            target = target.split("?", 1)[0]
            # If the target maps to a known page whose canonical is
            # something else, this is an alternate-canonical link.
            canon = page_canonical.get(target)
            # Also handle the /foo/index.html -> /foo/ case where the
            # /foo/index.html "page" uses the same canonical as /foo/.
            if canon is None and target.endswith("/index.html"):
                canon = page_canonical.get(target[: -len("index.html")])
            if canon is None:
                continue
            if canon != target:
                errors.append(
                    f"{page}: link -> {ref} resolves to {target}, but that "
                    f"page's canonical is {canon} (alternate-canonical link)"
                )
    return errors


def check_canonical_self_consistency(pages: list[str]) -> list[str]:
    """Each page's canonical must:
      - be absolute on https://esrf.net
      - match the served path (no .html drift, no www, no trailing-slash drift)
      - agree with og:url
    """
    errors = []
    for page in pages:
        if os.path.basename(page) in NON_INDEXABLE_FILES:
            continue
        try:
            parsed = parse_html(page)
        except Exception as e:
            errors.append(f"{page}: parse failed: {e}")
            continue
        served = file_to_canonical_path(page)
        canon = parsed.canonical
        if not canon:
            errors.append(f"{page}: missing <link rel=\"canonical\">")
            continue
        cp = urlparse(canon)
        if cp.scheme != "https" or cp.netloc != CANONICAL_HOST:
            errors.append(f"{page}: canonical not on {CANONICAL_ORIGIN}: {canon}")
        canon_path = cp.path or "/"
        if canon_path != served:
            errors.append(
                f"{page}: canonical {canon} disagrees with served path {served}"
            )
        if parsed.og_url and parsed.og_url != canon:
            errors.append(
                f"{page}: og:url {parsed.og_url} != canonical {canon}"
            )
    return errors


def check_sitemap(pages: list[str]) -> list[str]:
    """Every <loc> in sitemap.xml must:
      - be on https://esrf.net (canonical host)
      - resolve to an existing repo file
      - match that file's declared canonical
    Conversely, every indexable page (not in NON_INDEXABLE_FILES) at the
    site root or under /countries/ should appear in sitemap, otherwise it
    risks "Crawled — currently not indexed".
    """
    errors = []
    sitemap = os.path.join(REPO_ROOT, "sitemap.xml")
    if not os.path.exists(sitemap):
        return [f"sitemap.xml: missing"]

    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    tree = ET.parse(sitemap)
    locs = [
        e.text.strip() for e in tree.getroot().iterfind(".//sm:loc", ns) if e.text
    ]

    sitemap_paths = set()
    for loc in locs:
        u = urlparse(loc)
        if u.scheme != "https" or u.netloc != CANONICAL_HOST:
            errors.append(f"sitemap: non-canonical loc {loc}")
            continue
        path = u.path or "/"
        sitemap_paths.add(path)
        repo_file = path_to_repo_file(path)
        if repo_file is None:
            errors.append(f"sitemap: stale loc, no file for {path}")
            continue
        # Confirm that file's canonical agrees
        try:
            parsed = parse_html(repo_file)
        except Exception:
            continue
        if parsed.canonical:
            cp = urlparse(parsed.canonical).path or "/"
            if cp != path:
                errors.append(
                    f"sitemap: {loc} disagrees with page canonical "
                    f"{parsed.canonical}"
                )

    # Reverse check: indexable pages not in sitemap.
    for page in pages:
        base = os.path.basename(page)
        if base in NON_INDEXABLE_FILES:
            continue
        # Only flag root-level .html and country dir indexes — these are
        # the indexable URLs. Editorials/drafts excluded (drafts dir not walked).
        served = file_to_canonical_path(page)
        if served not in sitemap_paths:
            try:
                parsed = parse_html(page)
            except Exception:
                continue
            robots = (parsed.robots or "")
            if "noindex" in robots:
                continue
            errors.append(
                f"{page}: served as {served} but not in sitemap.xml — would "
                f"likely become 'Crawled — currently not indexed'"
            )
    return errors


def check_redirects_file() -> list[str]:
    """Validate _redirects: every static redirect's target path must
    resolve to a real file (or to /, which is index.html). This catches
    typos in legacy-path redirects that would otherwise silently 200 with
    the homepage SPA fallback.

    Also enforce: a custom 404.html exists, so Cloudflare Pages serves
    real 404 responses for unknown paths instead of falling back to the
    homepage. This is the structural fix for the April 2026 regression
    where unknown paths returned 200 with homepage HTML.
    """
    errors = []
    # 404.html must exist
    if not os.path.isfile(os.path.join(REPO_ROOT, "404.html")):
        errors.append("404.html: missing — Cloudflare Pages will fall back to "
                      "the homepage for unknown paths, producing 'Alternate "
                      "page with proper canonical tag' issues in Search Console")

    redirects = os.path.join(REPO_ROOT, "_redirects")
    if not os.path.isfile(redirects):
        return errors  # nothing else to check

    with open(redirects, encoding="utf-8") as f:
        for lineno, raw in enumerate(f, start=1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            src, dst = parts[0], parts[1]
            # Skip wildcard / external rules — only on-site path redirects.
            if "*" in src or "*" in dst or ":splat" in dst:
                continue
            if dst.startswith(("http://", "https://")):
                # If destination is on canonical host, treat path-only.
                u = urlparse(dst)
                if u.netloc not in (CANONICAL_HOST, "www." + CANONICAL_HOST):
                    continue
                dst_path = u.path or "/"
            else:
                dst_path = dst
            # Strip query string from target path
            dst_path = dst_path.split("?", 1)[0]
            if path_to_repo_file(dst_path) is None:
                errors.append(
                    f"_redirects line {lineno}: {src} -> {dst} target does not "
                    f"resolve to a file ({dst_path})"
                )
    return errors


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    pages = list_html_files()
    failures = []

    failures += [("404", e) for e in check_404s(pages)]
    failures += [("alternate-canonical", e) for e in check_alternate_canonical_links(pages)]
    failures += [("canonical", e) for e in check_canonical_self_consistency(pages)]
    failures += [("sitemap", e) for e in check_sitemap(pages)]
    failures += [("redirects", e) for e in check_redirects_file()]

    if not failures:
        if not args.quiet:
            print(f"OK: {len(pages)} pages — no SEO/structural issues.")
        return 0

    if args.quiet:
        return 1

    print(f"FAIL: {len(failures)} issue(s) across {len(pages)} pages.\n",
          file=sys.stderr)
    grouped = {}
    for kind, msg in failures:
        grouped.setdefault(kind, []).append(msg)
    for kind, msgs in grouped.items():
        print(f"--- {kind} ({len(msgs)}) ---", file=sys.stderr)
        for m in msgs:
            print(f"  {m}", file=sys.stderr)
        print("", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
