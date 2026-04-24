#!/usr/bin/env python3
"""
validate_editorial_i18n.py

Structural guardrail for editorial i18n.

Discovers editorial HTML pages (editorial-*.html at repo root), extracts every
`data-i18n` / `data-i18n-html` key whose namespace is an editorial namespace
(editorial_*), then for every locale JSON in i18n/*.json verifies:

  1. the referenced key exists (KEY_MISSING)
  2. its value is non-empty (KEY_EMPTY)
  3. for non-NL locales, the value is not the raw Dutch source
     (DUTCH_LEAKAGE) — with allowances for proper nouns/short labels
     and the documented EN-fallback convention for lower-priority locales
  4. HTML tags and {placeholder} tokens are preserved between the NL source
     and the locale value (MARKUP_MISMATCH)

Usage:
    python3 scripts/validate_editorial_i18n.py            # validate all editorials
    python3 scripts/validate_editorial_i18n.py --strict   # treat EN-fallback as failure too
    python3 scripts/validate_editorial_i18n.py --verbose  # list every OK check
    python3 scripts/validate_editorial_i18n.py --page editorial-foo-2026.html

Exit codes:
    0 — no failures (warnings may still be present)
    1 — one or more structural failures (see --fail-on to restrict)
    2 — misconfiguration (no editorials found, missing locales dir, etc.)

By default, all "error"-level findings cause exit 1. Use --fail-on to
narrow the set of codes that force a nonzero exit — useful in CI if the
repo has legacy findings (e.g. MARKUP_MISMATCH) that should surface in
logs as warnings while still blocking NEW regressions of other codes.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
I18N_DIR = REPO_ROOT / "i18n"
SOURCE_LOCALE = "nl"

# Locales documented as allowed to use EN as body-text fallback
# (see editorials/README.md — DeepL-unsupported languages).
EN_FALLBACK_LOCALES = {"ga", "hr", "is", "mt"}

# data-i18n / data-i18n-html / data-i18n-placeholder
I18N_ATTR_RE = re.compile(
    r'''data-i18n(?:-html|-placeholder)?\s*=\s*"([^"]+)"'''
)

# Proper nouns and brand tokens that legitimately appear identically across
# locales. Matching is done on the whole-string value: if a NL value is
# composed *only* of tokens on this allowlist (plus punctuation/whitespace)
# then a locale that repeats the same string is NOT flagged as leakage.
PROPER_NOUN_ALLOWLIST = {
    # Places / orgs / brands that don't localize
    "Rotterdam", "ESRF", "ESRF.net", "ESRM", "KPN", "MESH", "DeepL",
    "Voedselbank", "Salaam", "Europa", "Nederland", "Brussel",
    "OPEC", "NATO", "EU", "UN", "NAVO",
    # Labels / section markers that the design keeps as-is in every locale
    "Editorial", "Stewardship", "Solidarity", "Response", "Renewal",
    "Foundation", "Emergency",
    "§", "·", "—", "-", "|", ":",
    # ESRF Atlas taxonomy tags (kept identical across every locale —
    # the Atlas sector tags are a canonical English taxonomy)
    "Humanitarian", "aid", "Disaster", "relief", "Civil", "protection",
    "Search", "rescue", "Shelter", "evacuation", "Food", "basic", "needs",
    "Volunteer", "response", "Psychosocial", "support",
    "Community", "resilience", "Crisis",
}

# Keys whose values are intentionally shared across locales (kickers,
# section markers, etc.). If a key NAME matches one of these regexes, we
# don't treat locale-matches-NL as leakage.
SHARED_KEY_PATTERNS = [
    re.compile(r"^kicker$"),
    re.compile(r"^tag(_[A-Za-z0-9]+)*$"),   # tag_stewardship, tag_1, tag_3 …
    re.compile(r".*_slug$"),
    re.compile(r".*_label$"),
]

# Tag-only regex for markup preservation
HTML_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")
PLACEHOLDER_RE = re.compile(r"\{[A-Za-z0-9_]+\}")


@dataclass
class Finding:
    level: str            # "error" | "warn"
    code: str             # e.g. KEY_MISSING, DUTCH_LEAKAGE
    locale: str
    namespace: str
    key: str
    detail: str = ""

    def render(self) -> str:
        head = f"[{self.level.upper():5}] {self.code:16} {self.locale}:{self.namespace}.{self.key}"
        return f"{head}  {self.detail}" if self.detail else head


@dataclass
class Report:
    findings: list[Finding] = field(default_factory=list)
    pages_scanned: list[str] = field(default_factory=list)
    keys_scanned: int = 0
    locales_checked: list[str] = field(default_factory=list)

    def add(self, f: Finding) -> None:
        self.findings.append(f)

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.level == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.level == "warn"]


# ---------- discovery ----------

def discover_editorial_pages(page_filter: str | None) -> list[Path]:
    if page_filter:
        p = REPO_ROOT / page_filter
        if not p.exists():
            raise SystemExit(f"error: page not found: {page_filter}")
        return [p]
    return sorted(REPO_ROOT.glob("editorial-*.html"))


def extract_editorial_keys(html_path: Path) -> set[str]:
    """Return the set of fully-qualified i18n keys under editorial_* namespaces."""
    text = html_path.read_text(encoding="utf-8")
    keys: set[str] = set()
    for m in I18N_ATTR_RE.finditer(text):
        key = m.group(1).strip()
        ns = key.split(".", 1)[0] if "." in key else key
        if ns.startswith("editorial_"):
            keys.add(key)
    return keys


# ---------- helpers ----------

def lookup(obj: dict, dotted: str):
    cur = obj
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return (False, None)
        cur = cur[part]
    return (True, cur)


def is_shared_key(key_name: str) -> bool:
    return any(p.match(key_name) for p in SHARED_KEY_PATTERNS)


def strip_tags(s: str) -> str:
    return HTML_TAG_RE.sub("", s)


def only_proper_nouns(value: str) -> bool:
    """True if the string is composed only of allowlisted tokens + punctuation."""
    stripped = strip_tags(value)
    # keep only letters, digits, apostrophes, periods (for ESRF.net)
    tokens = re.findall(r"[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9.'’]*", stripped)
    if not tokens:
        return True
    return all(t in PROPER_NOUN_ALLOWLIST for t in tokens)


def markup_fingerprint(s: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    tags = tuple(sorted(HTML_TAG_RE.findall(s)))
    phs = tuple(sorted(PLACEHOLDER_RE.findall(s)))
    return tags, phs


# ---------- core check ----------

def load_locale(locale: str) -> dict | None:
    p = I18N_DIR / f"{locale}.json"
    if not p.exists():
        return None
    with p.open(encoding="utf-8") as f:
        return json.load(f)


def validate(
    pages: list[Path],
    strict: bool,
    verbose: bool,
) -> Report:
    report = Report()

    if not I18N_DIR.exists():
        raise SystemExit(f"error: i18n dir not found: {I18N_DIR}")

    locale_files = sorted(I18N_DIR.glob("*.json"))
    if not locale_files:
        raise SystemExit(f"error: no locale JSON files found in {I18N_DIR}")

    source = load_locale(SOURCE_LOCALE)
    if source is None:
        raise SystemExit(f"error: source locale not found: {SOURCE_LOCALE}.json")

    # collect all keys across all given editorial pages
    all_keys: set[str] = set()
    for page in pages:
        page_keys = extract_editorial_keys(page)
        report.pages_scanned.append(page.name)
        all_keys |= page_keys

    report.keys_scanned = len(all_keys)
    if not all_keys:
        print("warning: no editorial i18n keys discovered — nothing to validate.")
        return report

    # Build a quick lookup for EN values (used in EN-fallback detection)
    en = load_locale("en") or {}

    for loc_path in locale_files:
        locale = loc_path.stem
        if locale == "i18n":  # just in case
            continue
        data = load_locale(locale)
        if data is None:
            continue
        report.locales_checked.append(locale)

        for key in sorted(all_keys):
            ns, short = key.split(".", 1) if "." in key else (key, "")
            ok_src, src_val = lookup(source, key)
            found, value = lookup(data, key)

            if not found:
                report.add(Finding("error", "KEY_MISSING", locale, ns, short,
                                   "key not present in locale"))
                continue

            if not isinstance(value, str) or not value.strip():
                report.add(Finding("error", "KEY_EMPTY", locale, ns, short,
                                   f"empty or non-string value ({type(value).__name__})"))
                continue

            # Source presence is required for NL-leakage + markup checks
            if not ok_src or not isinstance(src_val, str):
                report.add(Finding("error", "SOURCE_MISSING", locale, ns, short,
                                   f"source ({SOURCE_LOCALE}) value missing for {key}"))
                continue

            # -- markup preservation (applies to every locale, incl. nl→nl no-op) --
            src_tags, src_phs = markup_fingerprint(src_val)
            loc_tags, loc_phs = markup_fingerprint(value)
            if src_tags != loc_tags:
                report.add(Finding(
                    "error", "MARKUP_MISMATCH", locale, ns, short,
                    f"tags differ: src={list(src_tags)} loc={list(loc_tags)}"))
            if src_phs != loc_phs:
                report.add(Finding(
                    "error", "MARKUP_MISMATCH", locale, ns, short,
                    f"placeholders differ: src={list(src_phs)} loc={list(loc_phs)}"))

            # -- NL leakage (non-NL locales only) --
            if locale != SOURCE_LOCALE:
                if value.strip() == src_val.strip():
                    # Allowed when: key is a shared marker, or the value is
                    # only proper nouns/punctuation.
                    if is_shared_key(short) or only_proper_nouns(value):
                        if verbose:
                            report.add(Finding(
                                "warn", "SHARED_VALUE_OK", locale, ns, short,
                                "identical to NL — allowed (shared/proper-noun)"))
                    else:
                        report.add(Finding(
                            "error", "DUTCH_LEAKAGE", locale, ns, short,
                            f"value is identical to NL source: {value[:60]!r}"))
                elif (
                    locale != "en"
                    and en
                    and lookup(en, key)[0]
                    and value.strip() == (lookup(en, key)[1] or "").strip()
                ):
                    # EN-fallback convention: allowed for documented locales,
                    # warning elsewhere, or error in --strict.
                    if locale in EN_FALLBACK_LOCALES:
                        if verbose:
                            report.add(Finding(
                                "warn", "EN_FALLBACK_OK", locale, ns, short,
                                "value matches EN — documented fallback"))
                    else:
                        level = "error" if strict else "warn"
                        report.add(Finding(
                            level, "EN_FALLBACK", locale, ns, short,
                            "value matches EN — undocumented fallback locale"))

            if verbose and not any(
                f.locale == locale and f.namespace == ns and f.key == short
                for f in report.findings
            ):
                report.add(Finding("warn", "OK", locale, ns, short, ""))

    return report


# ---------- main ----------

def main() -> int:
    ap = argparse.ArgumentParser(description="Validate editorial i18n coverage.")
    ap.add_argument("--page", help="Validate only this editorial HTML (basename).")
    ap.add_argument("--strict", action="store_true",
                    help="Treat EN-fallback in undocumented locales as errors.")
    ap.add_argument("--verbose", action="store_true", help="List every check.")
    ap.add_argument("--json", action="store_true", help="Emit JSON report.")
    ap.add_argument("--fail-on",
                    help="Comma-separated list of codes that force exit 1 "
                         "(default: every error-level code).")
    args = ap.parse_args()

    fail_on: set[str] | None = (
        {c.strip() for c in args.fail_on.split(",") if c.strip()}
        if args.fail_on else None
    )

    try:
        pages = discover_editorial_pages(args.page)
    except SystemExit as e:
        print(str(e), file=sys.stderr)
        return 2

    if not pages:
        print("error: no editorial HTML pages found (looked for editorial-*.html).",
              file=sys.stderr)
        return 2

    report = validate(pages, strict=args.strict, verbose=args.verbose)

    if args.json:
        out = {
            "pages": report.pages_scanned,
            "locales": report.locales_checked,
            "keys_scanned": report.keys_scanned,
            "findings": [f.__dict__ for f in report.findings],
            "errors": len(report.errors),
            "warnings": len(report.warnings),
        }
        print(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        print(f"editorial i18n validator")
        print(f"  pages:   {', '.join(report.pages_scanned)}")
        print(f"  locales: {len(report.locales_checked)}")
        print(f"  keys:    {report.keys_scanned}")
        print()
        for f in report.findings:
            print(" ", f.render())
        print()
        print(f"  errors:   {len(report.errors)}")
        print(f"  warnings: {len(report.warnings)}")

    if not report.errors:
        return 0
    if fail_on is None:
        return 1
    gating = [f for f in report.errors if f.code in fail_on]
    if gating:
        print(f"\ngating codes matched: {sorted({f.code for f in gating})}")
        return 1
    print(f"\nerrors present but none match --fail-on={sorted(fail_on)} — treating as warnings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
