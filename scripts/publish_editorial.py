#!/usr/bin/env python3
"""
ESRF.net — Automated Editorial Publisher
=========================================
Reads a Markdown editorial from `editorials/drafts/` and:
  1. Generates a styled HTML page in the ESRF design system
  2. Creates i18n keys (NL source) and distributes to all 27 languages
  3. Translates body text to all 25 non-NL languages via DeepL API
  4. Adds the article to news-data.json (Dispatch feed)
  5. Updates sitemap.xml

Environment:
  DEEPL_API_KEY   — DeepL Free or Pro API key (required for translations)
                    Without it, EN fallback from front-matter is used.

Usage:
  python3 scripts/publish_editorial.py editorials/drafts/my-article.md

Markdown front-matter (YAML between --- fences):
  title:       Article title (NL)
  title_en:    Article title (EN)
  slug:        URL slug, e.g. "olietekort-europa-2026"
  pillar:      ESRF pillar (stewardship|solidarity|response|renewal|foundation)
  tags:        Comma-separated tags, e.g. "Energie, Crisiscommunicatie"
  tags_en:     English tags, e.g. "Energy, Crisis Communication"
  date:        Publication date, e.g. "2026-04-20"
  read_time:   Estimated read time in minutes, e.g. 8
  description: Meta description (NL)
  description_en: Meta description (EN)
  og_title:    Open Graph title (NL)
  og_desc:     Open Graph description (NL)

Body format:
  ## Section Title            → <h2>
  ### Tip Title               → <h3 class="ed-tip"> (auto-numbered)
  > Blockquote                → <blockquote>
  :::example                  → <div class="ed-example">
  :::callout                  → <div class="ed-callout">
  :::end                      → closes special block
  [1] URL Description         → reference (in ## Bronnen / ## References section)
  Normal paragraph            → <p>
  - list item                 → <ul><li>
  1. list item                → <ol><li>

References:
  Inline refs like [1] are converted to <sup><a href="#ref-1">[1]</a></sup>.
  A ## Bronnen or ## References section at the end lists them as an <ol>.
"""

from __future__ import annotations

import json
import os
import re
import sys
import html
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime
from typing import Any

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
I18N_DIR = os.path.join(ROOT, "i18n")
NEWS_DATA = os.path.join(ROOT, "news-data.json")
SITEMAP = os.path.join(ROOT, "sitemap.xml")

LANGS = [
    "bg","cs","da","de","el","en","es","et","fi","fr","ga","hr","hu",
    "is","it","lt","lv","mt","nl","no","pl","pt","ro","sk","sl","sv","uk"
]

# ── Language-specific translations for common visible fields ──
LANG_OVERRIDES = {
    "bg": {"tag_stewardship": "Стопанство", "refs": "Източници", "join_title": "Допринесете за устойчива Европа.", "join_cta": "Подайте сигнал →"},
    "cs": {"tag_stewardship": "Správa", "refs": "Zdroje", "join_title": "Přispějte k odolné Evropě.", "join_cta": "Podat signál →"},
    "da": {"tag_stewardship": "Forvaltning", "refs": "Kilder", "join_title": "Bidrag til et modstandsdygtigt Europa.", "join_cta": "Indsend et signal →"},
    "de": {"tag_stewardship": "Verantwortung", "refs": "Quellen", "join_title": "Tragen Sie zu einem widerstandsfähigen Europa bei.", "join_cta": "Signal einreichen →"},
    "el": {"tag_stewardship": "Διαχείριση", "refs": "Πηγές", "join_title": "Συνεισφέρετε σε μια ανθεκτική Ευρώπη.", "join_cta": "Υποβάλετε σήμα →"},
    "en": {"tag_stewardship": "Stewardship", "refs": "References", "join_title": "Contribute to a resilient Europe.", "join_cta": "Submit a signal →"},
    "es": {"tag_stewardship": "Gestión", "refs": "Fuentes", "join_title": "Contribuya a una Europa resiliente.", "join_cta": "Enviar una señal →"},
    "et": {"tag_stewardship": "Majandamine", "refs": "Allikad", "join_title": "Panustage vastupidavasse Euroopasse.", "join_cta": "Esitage signaal →"},
    "fi": {"tag_stewardship": "Vastuullisuus", "refs": "Lähteet", "join_title": "Edistä kestävää Eurooppaa.", "join_cta": "Lähetä signaali →"},
    "fr": {"tag_stewardship": "Intendance", "refs": "Sources", "join_title": "Contribuez à une Europe résiliente.", "join_cta": "Soumettre un signal →"},
    "ga": {"tag_stewardship": "Maorlathas", "refs": "Foinsí", "join_title": "Cuir le hEoraip athléimneach.", "join_cta": "Cuir comhartha isteach →"},
    "hr": {"tag_stewardship": "Upravljanje", "refs": "Izvori", "join_title": "Doprinesite otpornoj Europi.", "join_cta": "Pošaljite signal →"},
    "hu": {"tag_stewardship": "Gondnokság", "refs": "Források", "join_title": "Járuljon hozzá egy ellenálló Európához.", "join_cta": "Jelzés beküldése →"},
    "is": {"tag_stewardship": "Ráðsmennska", "refs": "Heimildir", "join_title": "Stuðla að viðnámsþolnu Evrópu.", "join_cta": "Senda merki →"},
    "it": {"tag_stewardship": "Gestione", "refs": "Fonti", "join_title": "Contribuisci a un'Europa resiliente.", "join_cta": "Invia un segnale →"},
    "lt": {"tag_stewardship": "Valdymas", "refs": "Šaltiniai", "join_title": "Prisidėkite prie atsparios Europos.", "join_cta": "Pateikti signalą →"},
    "lv": {"tag_stewardship": "Pārvaldība", "refs": "Avoti", "join_title": "Piedalieties noturīgas Eiropas veidošanā.", "join_cta": "Iesniegt signālu →"},
    "mt": {"tag_stewardship": "Amministrazzjoni", "refs": "Sorsi", "join_title": "Ikkontribwixxi għal Ewropa reżiljenti.", "join_cta": "Ibgħat sinjal →"},
    "nl": {"tag_stewardship": "Stewardship", "refs": "Bronnen", "join_title": "Draag bij aan een weerbaar Europa.", "join_cta": "Dien een signaal in →"},
    "no": {"tag_stewardship": "Forvaltning", "refs": "Kilder", "join_title": "Bidra til et motstandsdyktig Europa.", "join_cta": "Send inn et signal →"},
    "pl": {"tag_stewardship": "Zarządzanie", "refs": "Źródła", "join_title": "Przyczyń się do odpornej Europy.", "join_cta": "Zgłoś sygnał →"},
    "pt": {"tag_stewardship": "Gestão", "refs": "Fontes", "join_title": "Contribua para uma Europa resiliente.", "join_cta": "Submeter um sinal →"},
    "ro": {"tag_stewardship": "Administrare", "refs": "Surse", "join_title": "Contribuiți la o Europă rezilientă.", "join_cta": "Trimiteți un semnal →"},
    "sk": {"tag_stewardship": "Správa", "refs": "Zdroje", "join_title": "Prispejte k odolnej Európe.", "join_cta": "Podať signál →"},
    "sl": {"tag_stewardship": "Upravljanje", "refs": "Viri", "join_title": "Prispevajte k odporni Evropi.", "join_cta": "Oddajte signal →"},
    "sv": {"tag_stewardship": "Förvaltning", "refs": "Källor", "join_title": "Bidra till ett motståndskraftigt Europa.", "join_cta": "Skicka in en signal →"},
    "uk": {"tag_stewardship": "Управління", "refs": "Джерела", "join_title": "Сприяйте стійкій Європі.", "join_cta": "Надіслати сигнал →"},
}

# ── Date formatting per language ──
MONTH_NAMES = {
    "bg": ["яну","фев","мар","апр","май","юни","юли","авг","сеп","окт","ное","дек"],
    "cs": ["led","úno","bře","dub","kvě","čvn","čvc","srp","zář","říj","lis","pro"],
    "da": ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"],
    "de": ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"],
    "el": ["Ιαν","Φεβ","Μαρ","Απρ","Μαΐ","Ιουν","Ιουλ","Αυγ","Σεπ","Οκτ","Νοε","Δεκ"],
    "en": ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
    "es": ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"],
    "et": ["jaan","veebr","märts","apr","mai","juuni","juuli","aug","sept","okt","nov","dets"],
    "fi": ["tammi","helmi","maalis","huhti","touko","kesä","heinä","elo","syys","loka","marras","joulu"],
    "fr": ["janv","févr","mars","avr","mai","juin","juil","août","sept","oct","nov","déc"],
    "ga": ["Ean","Feabh","Már","Aib","Beal","Meith","Iúil","Lún","MFóm","DFóm","Sam","Noll"],
    "hr": ["sij","velj","ožu","tra","svi","lip","srp","kol","ruj","lis","stu","pro"],
    "hu": ["jan","febr","márc","ápr","máj","jún","júl","aug","szept","okt","nov","dec"],
    "is": ["jan","feb","mar","apr","maí","jún","júl","ágú","sep","okt","nóv","des"],
    "it": ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"],
    "lt": ["saus","vas","kov","bal","geg","birž","liep","rugp","rugs","spal","lapkr","gruod"],
    "lv": ["janv","febr","marts","apr","maijs","jūn","jūl","aug","sept","okt","nov","dec"],
    "mt": ["Jan","Fra","Mar","Apr","Mej","Ġun","Lul","Aww","Set","Ott","Nov","Diċ"],
    "nl": ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"],
    "no": ["jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","des"],
    "pl": ["sty","lut","mar","kwi","maj","cze","lip","sie","wrz","paź","lis","gru"],
    "pt": ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"],
    "ro": ["ian","feb","mar","apr","mai","iun","iul","aug","sept","oct","nov","dec"],
    "sk": ["jan","feb","mar","apr","máj","jún","júl","aug","sep","okt","nov","dec"],
    "sl": ["jan","feb","mar","apr","maj","jun","jul","avg","sep","okt","nov","dec"],
    "sv": ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"],
    "uk": ["січ","лют","бер","квіт","трав","черв","лип","серп","вер","жовт","лист","груд"],
}

# ── DeepL language code mapping ──
# ESRF code → DeepL target_lang code
# DeepL uses specific codes: PT-PT (not PT), EN-GB (not EN), etc.
DEEPL_LANG_MAP = {
    "bg": "BG", "cs": "CS", "da": "DA", "de": "DE", "el": "EL",
    "en": "EN-GB", "es": "ES", "et": "ET", "fi": "FI", "fr": "FR",
    "hu": "HU", "it": "IT", "lt": "LT", "lv": "LV",
    "pl": "PL", "pt": "PT-PT", "ro": "RO", "sk": "SK", "sl": "SL",
    "sv": "SV", "uk": "UK",
    # Not supported by DeepL (will use EN fallback):
    # ga (Irish), hr (Croatian), is (Icelandic), mt (Maltese), no (Norwegian)
}
# Norwegian: DeepL supports NB (Bokmål)
DEEPL_LANG_MAP["no"] = "NB"

# Languages not supported by DeepL — will get EN fallback
DEEPL_UNSUPPORTED = {"ga", "hr", "is", "mt"}


def deepl_translate_batch(texts: list[str], target_lang: str, api_key: str) -> list[str]:
    """
    Translate a batch of texts from NL to target_lang via DeepL API.
    Handles HTML tags (preserves <sup>, <a>, <strong>, <em> etc.).
    Returns translated texts in same order.
    """
    # Determine API endpoint (free vs pro key)
    if api_key.endswith(":fx"):
        base_url = "https://api-free.deepl.com/v2/translate"
    else:
        base_url = "https://api.deepl.com/v2/translate"

    # DeepL accepts max ~50 texts per request, batch if needed
    BATCH_SIZE = 50
    all_translated = []

    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i:i + BATCH_SIZE]

        # Build form data
        params = {
            "source_lang": "NL",
            "target_lang": target_lang,
            "tag_handling": "html",
            "split_sentences": "nonewlines",
        }
        # URL-encode: multiple 'text' params
        parts = [urllib.parse.urlencode(params)]
        for t in batch:
            parts.append(urllib.parse.urlencode({"text": t}))
        body = "&".join(parts).encode("utf-8")

        req = urllib.request.Request(
            base_url,
            data=body,
            headers={
                "Authorization": f"DeepL-Auth-Key {api_key}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                for item in result.get("translations", []):
                    all_translated.append(item["text"])
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            print(f"    ⚠ DeepL API error {e.code} for {target_lang}: {error_body[:200]}")
            # Fallback: return original texts
            all_translated.extend(batch)
        except Exception as e:
            print(f"    ⚠ DeepL request failed for {target_lang}: {e}")
            all_translated.extend(batch)

        # Rate limiting: small pause between batches
        if i + BATCH_SIZE < len(texts):
            time.sleep(0.3)

    return all_translated


def translate_body_keys(
    nl_keys: dict[str, str],
    i18n_prefix: str,
    meta_keys: set[str],
    api_key: str,
) -> dict[str, dict[str, str]]:
    """
    Translate all non-meta i18n keys from NL to every supported language.
    Returns {lang_code: {key: translated_value, ...}, ...}
    """
    # Separate body keys (need translation) from meta keys (already localised)
    body_keys = [(k, v) for k, v in nl_keys.items() if k not in meta_keys]
    if not body_keys:
        return {}

    key_names = [k for k, _ in body_keys]
    nl_texts = [v for _, v in body_keys]

    translations: dict[str, dict[str, str]] = {}
    target_langs = [l for l in LANGS if l != "nl"]

    print(f"\n── DeepL translation ({len(nl_texts)} keys × {len(target_langs)} languages) ──")

    for lang in target_langs:
        if lang in DEEPL_UNSUPPORTED:
            # Use EN translation as fallback for unsupported languages
            if "en" in translations:
                translations[lang] = dict(translations["en"])
                print(f"  ✓ {lang} — EN fallback (not supported by DeepL)")
            else:
                # EN not translated yet, will be filled later
                translations[lang] = None  # placeholder
                print(f"  ⏳ {lang} — deferred (waiting for EN)")
            continue

        deepl_code = DEEPL_LANG_MAP.get(lang)
        if not deepl_code:
            print(f"  ⚠ {lang} — no DeepL mapping, skipping")
            continue

        translated_texts = deepl_translate_batch(nl_texts, deepl_code, api_key)
        # DeepL sometimes HTML-encodes characters (&#x27; etc.) — decode them
        translated_texts = [html.unescape(t) for t in translated_texts]
        translations[lang] = {k: v for k, v in zip(key_names, translated_texts)}
        print(f"  ✓ {lang} — {len(translated_texts)} keys translated")

        # Small delay between languages to respect rate limits
        time.sleep(0.2)

    # Fill deferred languages with EN fallback
    en_trans = translations.get("en", {})
    for lang in target_langs:
        if translations.get(lang) is None and en_trans:
            translations[lang] = dict(en_trans)
            print(f"  ✓ {lang} — EN fallback applied")

    return translations


READ_TIME_LABELS = {
    "bg": "Четене", "cs": "Doba čtení", "da": "Læsetid", "de": "Lesezeit",
    "el": "Χρόνος ανάγνωσης", "en": "Read time", "es": "Tiempo de lectura",
    "et": "Lugemisaeg", "fi": "Lukuaika", "fr": "Temps de lecture",
    "ga": "Am léitheoireachta", "hr": "Vrijeme čitanja", "hu": "Olvasási idő",
    "is": "Lestrartími", "it": "Tempo di lettura", "lt": "Skaitymo laikas",
    "lv": "Lasīšanas laiks", "mt": "Ħin tal-qari", "nl": "Leestijd",
    "no": "Lesetid", "pl": "Czas czytania", "pt": "Tempo de leitura",
    "ro": "Timp de citire", "sk": "Čas čítania", "sl": "Čas branja",
    "sv": "Lästid", "uk": "Час читання",
}


def format_byline(lang: str, date: datetime, read_min: int) -> str:
    """Format localised byline: '20 apr 2026 · ESRF.net Editorial · Leestijd ±8 min'"""
    months = MONTH_NAMES.get(lang, MONTH_NAMES["en"])
    m = months[date.month - 1]
    rt = READ_TIME_LABELS.get(lang, "Read time")
    # Some languages use "20. apr" (with dot after day)
    dot_langs = {"cs","da","de","et","fi","is","lv","no","sk","sl","sv"}
    day_fmt = f"{date.day}." if lang in dot_langs else str(date.day)
    return f"{day_fmt} {m} {date.year} · ESRF.net Editorial · {rt} ±{read_min} min"


# ══════════════════════════════════════════════════════════════════
#  MARKDOWN PARSER
# ══════════════════════════════════════════════════════════════════

def parse_front_matter(text: str) -> tuple[dict, str]:
    """Extract YAML front matter and body."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("---", 3)
    if end == -1:
        return {}, text
    yaml_block = text[3:end].strip()
    body = text[end+3:].strip()
    meta: dict[str, str] = {}
    for line in yaml_block.split("\n"):
        if ":" in line:
            key, val = line.split(":", 1)
            meta[key.strip()] = val.strip().strip('"').strip("'")
    return meta, body


def parse_references(body: str) -> tuple[str, list[dict]]:
    """Extract references section from body. Returns (body_without_refs, refs_list)."""
    # Find ## Bronnen or ## References section
    ref_pattern = re.compile(r'^##\s+(Bronnen|References)\s*$', re.MULTILINE)
    match = ref_pattern.search(body)
    if not match:
        return body, []

    refs_text = body[match.end():].strip()
    body_clean = body[:match.start()].strip()

    refs = []
    # Parse [N] URL Description or N. URL Description
    ref_line_re = re.compile(r'^\s*\[?(\d+)\]?\.\s*(https?://\S+)\s+(.*)', re.MULTILINE)
    for m in ref_line_re.finditer(refs_text):
        refs.append({
            "num": int(m.group(1)),
            "url": m.group(2).rstrip(".,:;"),
            "desc": m.group(3).strip().rstrip("."),
        })

    # Alternative: lines starting with - [text](url)
    if not refs:
        alt_re = re.compile(r'^\s*[-*]\s*\[([^\]]+)\]\(([^)]+)\)(?:\s*[.—–-]\s*(.*))?', re.MULTILINE)
        for i, m in enumerate(alt_re.finditer(refs_text), 1):
            desc = m.group(3).strip() if m.group(3) else m.group(1)
            refs.append({"num": i, "url": m.group(2), "desc": f"{m.group(1)}. {desc}" if m.group(3) else m.group(1)})

    # Simplest: numbered lines
    if not refs:
        simple_re = re.compile(r'^\s*(\d+)\.\s+(.*)', re.MULTILINE)
        for m in simple_re.finditer(refs_text):
            num = int(m.group(1))
            line = m.group(2).strip()
            url_m = re.search(r'(https?://\S+)', line)
            url = url_m.group(1).rstrip(".,:;") if url_m else ""
            desc = re.sub(r'https?://\S+', '', line).strip().strip("- .")
            if not desc and url:
                desc = url
            refs.append({"num": num, "url": url, "desc": desc})

    return body_clean, refs


def md_inline(text: str) -> str:
    """Convert inline Markdown: **bold** → <strong>, *italic* → <em>, `code` → <code>."""
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'(?<!\*)\*([^*]+?)\*(?!\*)', r'<em>\1</em>', text)
    text = re.sub(r'_([^_]+?)_', r'<em>\1</em>', text)
    text = re.sub(r'`([^`]+?)`', r'<code>\1</code>', text)
    # Convert markdown links [text](url)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
    return text


def inline_refs(text: str) -> str:
    """Convert [1] to <sup><a href="#ref-1">[1]</a></sup>"""
    return re.sub(
        r'\[(\d+)\]',
        r'<sup><a href="#ref-\1">[\1]</a></sup>',
        text
    )


def md_to_html_blocks(body: str, i18n_prefix: str) -> tuple[list[str], dict[str, str]]:
    """
    Convert markdown body to HTML blocks and i18n keys.
    Returns (html_lines, i18n_dict).
    """
    lines = body.split("\n")
    html_out: list[str] = []
    i18n: dict[str, str] = {}
    key_counter: dict[str, int] = {}
    in_special = None  # "example" | "callout" | None
    in_list = None  # "ul" | "ol" | None
    in_tip_body = False
    tip_count = 0
    para_buffer: list[str] = []

    def next_key(base: str) -> str:
        key_counter.setdefault(base, 0)
        key_counter[base] += 1
        n = key_counter[base]
        return f"{i18n_prefix}.{base}_{n}" if n > 1 else f"{i18n_prefix}.{base}"

    def flush_para():
        nonlocal para_buffer
        if not para_buffer:
            return
        text = " ".join(para_buffer).strip()
        para_buffer = []
        if not text:
            return
        has_refs = bool(re.search(r'\[\d+\]', text))
        # Apply inline markdown (bold, italic, code, links)
        html_text = md_inline(text)
        if has_refs:
            html_text = inline_refs(html_text)
        has_html = bool(re.search(r'<[a-z]', html_text)) or has_refs
        if has_html:
            key = next_key("p_html")
            html_out.append(f'  <p data-i18n-html="{key}">')
            html_out.append(f'    {html_text}')
            html_out.append(f'  </p>')
        else:
            key = next_key("p")
            html_out.append(f'  <p data-i18n="{key}">{html_text}</p>')
        i18n[key] = html_text

    def close_list():
        nonlocal in_list
        if in_list:
            html_out.append(f"  </{in_list}>")
            in_list = None

    def close_tip_body():
        nonlocal in_tip_body
        if in_tip_body:
            flush_para()
            close_list()
            html_out.append("  </div>")
            in_tip_body = False

    for raw_line in lines:
        line = raw_line.rstrip()

        # Empty line
        if not line.strip():
            flush_para()
            continue

        # Special block markers
        if line.strip().startswith(":::example"):
            flush_para()
            close_list()
            close_tip_body()
            in_special = "example"
            html_out.append('  <div class="ed-example">')
            continue
        if line.strip().startswith(":::callout"):
            flush_para()
            close_list()
            close_tip_body()
            in_special = "callout"
            html_out.append('  <div class="ed-callout">')
            continue
        if line.strip().startswith(":::end"):
            flush_para()
            close_list()
            if in_special:
                html_out.append("  </div>")
                in_special = None
            continue

        # H2
        if line.startswith("## "):
            flush_para()
            close_list()
            close_tip_body()
            title = line[3:].strip()
            key = next_key("h2")
            html_out.append(f'  <h2 data-i18n="{key}">{html.escape(title)}</h2>')
            i18n[key] = title
            continue

        # H3 — treated as tip
        if line.startswith("### "):
            flush_para()
            close_list()
            close_tip_body()
            tip_count += 1
            title = line[4:].strip()
            key = next_key("tip_title")
            html_out.append(f'  <h3 class="ed-tip" data-i18n="{key}">{html.escape(title)}</h3>')
            html_out.append('  <div class="ed-tip-body">')
            i18n[key] = title
            in_tip_body = True
            continue

        # Blockquote
        if line.startswith("> "):
            flush_para()
            close_list()
            text = line[2:].strip()
            bq_html = md_inline(text)
            key = next_key("bq")
            has_html = bool(re.search(r'<[a-z]', bq_html))
            if has_html:
                html_out.append(f'  <blockquote data-i18n-html="{key}">{bq_html}</blockquote>')
            else:
                html_out.append(f'  <blockquote data-i18n="{key}">{bq_html}</blockquote>')
            i18n[key] = bq_html
            continue

        # Unordered list
        if re.match(r'^[-*]\s+', line.strip()):
            flush_para()
            item = re.sub(r'^[-*]\s+', '', line.strip())
            if in_list != "ul":
                close_list()
                in_list = "ul"
                html_out.append("  <ul>")
            has_refs = bool(re.search(r'\[\d+\]', item))
            item_html = md_inline(item)
            if has_refs:
                item_html = inline_refs(item_html)
            has_html = bool(re.search(r'<[a-z]', item_html)) or has_refs
            if has_html:
                key = next_key("li_html")
                html_out.append(f'    <li data-i18n-html="{key}">{item_html}</li>')
            else:
                key = next_key("li")
                html_out.append(f'    <li data-i18n="{key}">{item_html}</li>')
            i18n[key] = item_html
            continue

        # Ordered list
        if re.match(r'^\d+\.\s+', line.strip()):
            flush_para()
            item = re.sub(r'^\d+\.\s+', '', line.strip())
            if in_list != "ol":
                close_list()
                in_list = "ol"
                html_out.append("  <ol>")
            has_refs = bool(re.search(r'\[\d+\]', item))
            item_html = md_inline(item)
            if has_refs:
                item_html = inline_refs(item_html)
            has_html = bool(re.search(r'<[a-z]', item_html)) or has_refs
            if has_html:
                key = next_key("li_html")
                html_out.append(f'    <li data-i18n-html="{key}">{item_html}</li>')
            else:
                key = next_key("li")
                html_out.append(f'    <li data-i18n="{key}">{item_html}</li>')
            i18n[key] = item_html
            continue

        # Close list if we're continuing with paragraph text
        close_list()

        # Regular paragraph line (buffer for multi-line paragraphs)
        para_buffer.append(line.strip())

    # Cleanup
    flush_para()
    close_list()
    close_tip_body()

    return html_out, i18n


# ══════════════════════════════════════════════════════════════════
#  HTML TEMPLATE
# ══════════════════════════════════════════════════════════════════

def build_html(meta: dict, body_html: list[str], refs: list[dict], i18n_prefix: str, i18n_keys: dict) -> str:
    """Generate the full editorial HTML page."""
    slug = meta["slug"]
    filename = f"editorial-{slug}.html"
    pillar = meta.get("pillar", "stewardship")
    tags_list = [t.strip() for t in meta.get("tags", "").split(",") if t.strip()]
    date_str = meta.get("date", datetime.now().strftime("%Y-%m-%d"))

    # Build tags HTML
    tags_html = []
    tags_html.append(f'      <span class="ed-tag" data-i18n="{i18n_prefix}.tag_stewardship">Stewardship</span>')
    for i, tag in enumerate(tags_list):
        key = f"{i18n_prefix}.tag_{i+1}"
        tags_html.append(f'      <span class="ed-tag" data-i18n="{key}">{html.escape(tag)}</span>')
        i18n_keys[key] = tag

    # Build refs HTML
    refs_html = []
    if refs:
        refs_html.append(f'  <div class="ed-refs" id="references">')
        refs_html.append(f'    <h2 data-i18n="{i18n_prefix}.h2_refs">Bronnen</h2>')
        refs_html.append(f'    <ol>')
        for ref in refs:
            n = ref["num"]
            url = html.escape(ref["url"])
            desc = html.escape(ref["desc"])
            if url:
                refs_html.append(f'      <li id="ref-{n}">')
                refs_html.append(f'        <a href="{url}" target="_blank" rel="noopener noreferrer">{desc}</a>.')
                refs_html.append(f'      </li>')
            else:
                refs_html.append(f'      <li id="ref-{n}">{desc}</li>')
        refs_html.append(f'    </ol>')
        refs_html.append(f'  </div>')

    title_nl = meta.get("title", "Editorial")
    desc_nl = meta.get("description", "")
    og_title = meta.get("og_title", title_nl)
    og_desc = meta.get("og_desc", desc_nl)

    # Hero: split title at last space for the italic word
    words = title_nl.split()
    if len(words) > 1:
        hero_1 = " ".join(words[:-1])
        hero_2 = words[-1]
    else:
        hero_1 = title_nl
        hero_2 = ""

    body_content = "\n".join(body_html)
    refs_content = "\n".join(refs_html)
    tags_content = "\n".join(tags_html)

    return f'''<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title data-i18n="{i18n_prefix}.title_tag">{html.escape(title_nl)} — ESRF.net</title>
<meta name="description" data-i18n-attr="content" data-i18n-attr-key="{i18n_prefix}.meta_desc" content="{html.escape(desc_nl)}" />
<meta property="og:title" content="{html.escape(og_title)}" />
<meta property="og:description" content="{html.escape(og_desc)}" />
<meta property="og:type" content="article" />
<link rel="icon" href="favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=PT+Serif:ital,wght@0,400;0,700;1,400;1,700&family=Archivo:wght@400..800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css" />
<script src="consent.js" defer></script>
<script>(adsbygoogle = window.adsbygoogle || []).pauseAdRequests = 1;</script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9792236154813874" crossorigin="anonymous"></script>
<!-- Google Analytics (GA4) with Consent Mode v2 -->
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('consent', 'default', {{
    'analytics_storage': 'denied',
    'ad_storage': 'denied',
    'ad_user_data': 'denied',
    'ad_personalization': 'denied',
    'wait_for_update': 500
  }});
  gtag('js', new Date());
  gtag('config', 'G-HPFTT1GMZN');
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-HPFTT1GMZN"></script>
<style>
/* ── Editorial page styles ── */
.ed-article{{max-width:740px;margin:0 auto;padding:0 var(--pad-x) 80px}}
.ed-article p{{font-size:1.08rem;line-height:1.78;margin-bottom:1.25em;color:var(--ink-soft)}}
.ed-article h2{{font-family:'Archivo',system-ui,sans-serif;font-weight:700;font-size:1.55rem;letter-spacing:-0.02em;margin:2.8em 0 0.6em;color:var(--ink);line-height:1.18}}
.ed-article h3{{font-family:'Archivo',system-ui,sans-serif;font-weight:700;font-size:1.15rem;letter-spacing:-0.01em;margin:2em 0 0.4em;color:var(--ink);line-height:1.3}}
.ed-article ul,.ed-article ol{{margin:0 0 1.5em 1.4em;color:var(--ink-soft);line-height:1.78;font-size:1.08rem}}
.ed-article li{{margin-bottom:0.55em}}
.ed-article blockquote{{border-left:3px solid var(--accent);margin:2em 0;padding:1.2em 1.6em;background:var(--cream);font-style:italic;font-size:1.05rem;line-height:1.7;color:var(--ink-soft);border-radius:0 6px 6px 0}}
.ed-article .ed-tip{{counter-increment:tip;margin:2.4em 0 0.4em;color:var(--ink)}}
.ed-article .ed-tip::before{{content:counter(tip) ". ";font-family:'IBM Plex Mono',monospace;font-weight:500;font-size:0.92rem;color:var(--accent)}}
.ed-article .ed-tip-body{{margin-bottom:1.8em}}
.ed-article .ed-example{{background:var(--ink);color:rgba(255,255,255,0.88);padding:2em 2.4em;border-radius:8px;margin:2.4em 0;font-size:1.02rem;line-height:1.78}}
.ed-article .ed-example strong{{color:#fff;font-weight:700}}
.ed-article .ed-example p{{color:rgba(255,255,255,0.88);margin-bottom:1em}}
.ed-article .ed-example ul,.ed-article .ed-example ol{{color:rgba(255,255,255,0.88)}}
.ed-article .ed-example li{{color:rgba(255,255,255,0.82)}}
.ed-article .ed-callout{{background:var(--cream);border:1px solid rgba(15,20,25,0.08);padding:1.4em 1.8em;border-radius:8px;margin:2.4em 0}}
.ed-article .ed-callout h3{{margin-top:0}}
.ed-article sup{{font-size:0.72em;line-height:0;vertical-align:super}}
.ed-article sup a{{color:var(--accent);text-decoration:none;font-family:'IBM Plex Mono',monospace;font-weight:500}}
.ed-article sup a:hover{{text-decoration:underline}}
.ed-meta{{font-family:'IBM Plex Mono',monospace;font-size:0.82rem;color:var(--ink-dim);margin-bottom:2.4em;letter-spacing:0.01em}}
.ed-meta time{{font-weight:500}}
.ed-refs{{margin-top:3.5em;padding-top:2em;border-top:1px solid rgba(15,20,25,0.12)}}
.ed-refs h2{{font-size:1.1rem;margin-bottom:1em}}
.ed-refs ol{{font-size:0.88rem;line-height:1.65;color:var(--ink-dim);padding-left:1.6em}}
.ed-refs ol li{{margin-bottom:0.6em;word-break:break-word}}
.ed-refs ol li a{{color:var(--accent-deep);text-decoration:none}}
.ed-refs ol li a:hover{{text-decoration:underline}}
.ed-tags{{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:2em}}
.ed-tag{{font-family:'IBM Plex Mono',monospace;font-size:0.75rem;background:var(--ink);color:var(--bg);padding:3px 10px;border-radius:3px;text-transform:uppercase;letter-spacing:0.04em}}
/* ── Editorial hero: refined ── */
.phero--editorial .phero-title{{font-size:clamp(42px,7vw,96px);line-height:0.92;letter-spacing:-0.035em;font-weight:700}}
.phero-subtitle{{font-family:'Archivo',system-ui,sans-serif;font-size:clamp(18px,2.4vw,28px);font-weight:500;color:var(--ink-soft);letter-spacing:-0.01em;line-height:1.35;margin-top:-16px;margin-bottom:24px;max-width:680px}}
@media(max-width:600px){{
  .ed-article{{padding:0 20px 60px}}
  .ed-article h2{{font-size:1.3rem}}
  .ed-article .ed-example{{padding:1.4em 1.6em}}
  .phero--editorial .phero-title{{font-size:clamp(36px,10vw,52px);line-height:0.95}}
  .phero-subtitle{{font-size:18px;margin-top:-8px}}
}}
</style>
</head>
<body>

<nav class="mast" aria-label="Primary">
  <div class="mast-inner">
    <a href="index.html" class="mast-logo">ESRF.net</a>
    <button class="mast-burger" aria-label="Toggle navigation" aria-controls="primary-nav">≡</button>
    <div class="mast-nav" id="primary-nav">
      <a href="about.html" data-i18n="nav.foundation">Foundation</a>
      <a href="events.html">Events</a>
      <a href="directory.html" data-i18n="nav.directory">Directory</a>
      <a href="map.html" data-i18n="nav.atlas">Atlas</a>
      <a href="analytics.html" data-i18n="nav.analytics">Analytics</a>
      <a href="news.html" data-i18n="nav.dispatch">Dispatch</a>
      <button type="button" class="mast-cta" data-open-modal="listing" data-i18n="nav.request_listing">Claim your listing</button>
      <a href="fund.html" class="mast-contribute" data-i18n="nav.fund">Contribute</a>
    <div class="lang-switch">
      <button class="lang-current mono" aria-expanded="false" aria-controls="lang-menu">
        <span data-lang-current>NL</span>
        <span aria-hidden="true">▾</span>
      </button>
      <ul class="lang-menu" id="lang-menu" hidden></ul>
    </div>
  </div>
</nav>

<section class="phero phero--editorial">
  <div class="phero-inner">
    <div class="kicker" data-i18n="{i18n_prefix}.kicker">§ Editorial · {pillar.title()}</div>
    <h1 class="phero-title"><span data-i18n="{i18n_prefix}.hero_title_1">{html.escape(hero_1)}</span><br><i data-i18n="{i18n_prefix}.hero_title_2">{html.escape(hero_2)}</i>.</h1>
    <p class="phero-subtitle" data-i18n="{i18n_prefix}.hero_subtitle">{html.escape(meta.get('description', ''))}</p>
    <p class="phero-deck" data-i18n="{i18n_prefix}.hero_deck">{html.escape(desc_nl)}</p>
  </div>
</section>

<!-- Ad placement -->
<div class="esrf-ad-wrap">
  <span class="esrf-ad-label" data-i18n="ads.label">Advertisement</span>
  <ins class="adsbygoogle"
       style="display:block"
       data-ad-client="ca-pub-9792236154813874"
       data-ad-slot="7939911836"
       data-ad-format="horizontal"
       data-full-width-responsive="true"></ins>
</div>

<article class="ed-article" style="counter-reset:tip">

  <div class="ed-meta">
    <div class="ed-tags">
{tags_content}
    </div>
    <span data-i18n="{i18n_prefix}.byline">{format_byline("nl", datetime.strptime(date_str, "%Y-%m-%d"), int(meta.get("read_time", 8)))}</span>
  </div>

{body_content}

  <!-- References -->
{refs_content}

</article>

<!-- Ad placement -->
<div class="esrf-ad-wrap">
  <span class="esrf-ad-label" data-i18n="ads.label">Advertisement</span>
  <ins class="adsbygoogle"
       style="display:block"
       data-ad-client="ca-pub-9792236154813874"
       data-ad-slot="7631743893"
       data-ad-format="horizontal"
       data-full-width-responsive="true"></ins>
</div>

<section class="join">
  <h2 class="join-h" data-i18n-html="{i18n_prefix}.join_title_html">Draag bij aan<br>een <i>weerbaar Europa</i>.</h2>
  <p class="join-sub" data-i18n="{i18n_prefix}.join_sub">Organisaties op de ESRF.net-atlas kunnen verhalen, rapporten en analyses bijdragen aan de Dispatch.</p>
  <a href="submit-news.html" class="btn on-accent" data-i18n="{i18n_prefix}.join_cta">Dien een signaal in →</a>
</section>

<footer class="foot">
  <div class="foot-inner">
    <div class="foot-brand">
      <h3>ESRF.net</h3>
      <p data-i18n="footer.brand_desc">ESRF.net — European security and resilience, powered by 1,931 organisations across 30 countries.</p>
    </div>
    <div class="foot-col">
      <h4 data-i18n="footer.community">Community</h4>
      <ul>
        <li><a href="directory.html" data-i18n="nav.directory">Directory</a></li>
        <li><a href="map.html" data-i18n="nav.atlas">Atlas</a></li>
        <li><a href="countries/index.html" data-i18n="common.countries">Countries</a></li>
        <li><a href="events.html">Events</a></li>
        <li><a href="news.html" data-i18n="nav.dispatch">Dispatch</a></li>
        <li><a href="submit-news.html">Submit signal</a></li>
        <li><a href="analytics.html" data-i18n="nav.analytics">Analytics</a></li>
      </ul>
    </div>
    <div class="foot-col">
      <h4 data-i18n="footer.foundation">Foundation</h4>
      <ul>
        <li><a href="about.html" data-i18n="common.about">About</a></li>
        <li><a href="fund.html" class="foot-contribute" data-i18n="nav.fund">Contribute</a></li>
        <li><a href="sponsor.html" data-i18n="nav.support">Support</a></li>
        <li><a href="mailto:hello@esrf.net" data-i18n="common.contact">Contact</a></li>
      </ul>
    </div>
    <div class="foot-col">
      <h4 data-i18n="footer.legal">Legal</h4>
      <ul>
        <li><a href="privacy.html" data-i18n="footer.privacy">Privacy</a></li>
        <li><a href="terms.html" data-i18n="footer.terms">Terms</a></li>
        <li><a href="responsible-disclosure.html">Responsible Disclosure</a></li>
      </ul>
    </div>
  </div>
  <div class="foot-bar">
    <div data-i18n="common.foot_copyright">&copy; 2026 Stichting ESRF European Security and Resilience Fund</div>
    <div><span data-i18n="footer.tagline">Atlas of Organisations</span></div>
  </div>
</footer>

<script src="assets/flags.js"></script>
<script src="i18n/i18n.js"></script>
<script src="app.js"></script>
<!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{{"token": "52897243139b402dacc6d5d564320f8b"}}'></script><!-- End Cloudflare Web Analytics -->
</body>
</html>'''


# ══════════════════════════════════════════════════════════════════
#  I18N DISTRIBUTION
# ══════════════════════════════════════════════════════════════════

def distribute_i18n(
    i18n_prefix: str,
    nl_keys: dict,
    en_keys: dict,
    meta: dict,
    deepl_translations: dict[str, dict[str, str]] | None = None,
):
    """
    Write i18n keys to all 27 language JSON files.
    If deepl_translations is provided, body keys are replaced with DeepL output.
    """
    date = datetime.strptime(meta.get("date", datetime.now().strftime("%Y-%m-%d")), "%Y-%m-%d")
    read_min = int(meta.get("read_time", 8))
    tags_en = [t.strip() for t in meta.get("tags_en", meta.get("tags", "")).split(",") if t.strip()]
    title_en = meta.get("title_en", meta.get("title", ""))
    desc_en = meta.get("description_en", meta.get("description", ""))

    for lang in LANGS:
        filepath = os.path.join(I18N_DIR, f"{lang}.json")
        if not os.path.exists(filepath):
            print(f"  \u26a0 {lang}.json not found, skipping")
            continue

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        overrides = LANG_OVERRIDES.get(lang, {})

        if lang == "nl":
            # Dutch = source
            section = dict(nl_keys)
        elif lang == "en":
            # Start from EN meta keys
            section = dict(en_keys)
            # If DeepL translations available, overlay body keys
            if deepl_translations and "en" in deepl_translations:
                for k, v in deepl_translations["en"].items():
                    section[k] = v
        else:
            # Start from EN keys as base
            section = dict(en_keys)
            # Overlay DeepL translations for this language if available
            if deepl_translations and lang in deepl_translations:
                for k, v in deepl_translations[lang].items():
                    section[k] = v
            # Override localised meta fields
            section[f"{i18n_prefix}.byline"] = format_byline(lang, date, read_min)
            section[f"{i18n_prefix}.h2_refs"] = overrides.get("refs", "References")
            section[f"{i18n_prefix}.join_title_html"] = f'Contribute to<br>a <i>resilient Europe</i>.'
            if "join_title" in overrides:
                jt = overrides["join_title"]
                section[f"{i18n_prefix}.join_title_html"] = jt
            if "join_cta" in overrides:
                section[f"{i18n_prefix}.join_cta"] = overrides["join_cta"]
            if "tag_stewardship" in overrides:
                section[f"{i18n_prefix}.tag_stewardship"] = overrides["tag_stewardship"]

        # Flatten keys: remove prefix for storage
        flat = {}
        for k, v in section.items():
            short = k.replace(f"{i18n_prefix}.", "") if k.startswith(f"{i18n_prefix}.") else k
            flat[short] = v

        data[i18n_prefix] = flat

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        src = "DeepL" if (deepl_translations and lang in (deepl_translations or {})) else "meta"
        print(f"  \u2713 {lang} \u2014 {len(flat)} keys ({src})")


# ══════════════════════════════════════════════════════════════════
#  SITEMAP & DISPATCH
# ══════════════════════════════════════════════════════════════════

def update_sitemap(filename: str, date_str: str):
    """Add editorial URL to sitemap.xml if not already present."""
    with open(SITEMAP, "r", encoding="utf-8") as f:
        content = f.read()

    if filename in content:
        print(f"  ℹ {filename} already in sitemap")
        return

    entry = f"""    <url>
    <loc>https://www.esrf.net/{filename}</loc>
    <lastmod>{date_str}</lastmod>
    <changefreq>monthly</changefreq>
    </url>"""

    # Insert before </urlset>
    content = content.replace("</urlset>", f"{entry}\n</urlset>")

    with open(SITEMAP, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"  ✓ Sitemap updated with {filename}")


def update_dispatch(meta: dict, filename: str):
    """Add editorial as first article in news-data.json."""
    with open(NEWS_DATA, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Check if already present
    for art in data.get("articles", []):
        if art.get("url") == filename:
            print(f"  ℹ {filename} already in Dispatch")
            return

    new_article = {
        "title": f"Editorial — {meta.get('title', 'Untitled')}",
        "url": filename,
        "organisation": "ESRF.net",
        "orgUrl": "https://www.esrf.net",
        "pillar": meta.get("pillar", "stewardship"),
        "country": "EU",
        "source": "ESRF.net Editorial",
        "snippet": meta.get("description", ""),
        "date": f"{meta.get('date', datetime.now().strftime('%Y-%m-%d'))}T12:00:00Z",
        "lang": "nl",
        "scope": "european",
    }

    data["articles"].insert(0, new_article)
    data["article_count"] = len(data["articles"])

    with open(NEWS_DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  ✓ Dispatch updated — now {data['article_count']} articles")


# ══════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/publish_editorial.py <markdown-file>")
        print("       python3 scripts/publish_editorial.py editorials/drafts/my-article.md")
        sys.exit(1)

    md_path = os.path.join(ROOT, sys.argv[1]) if not os.path.isabs(sys.argv[1]) else sys.argv[1]
    if not os.path.exists(md_path):
        print(f"Error: {md_path} not found")
        sys.exit(1)

    with open(md_path, "r", encoding="utf-8") as f:
        raw = f.read()

    print("═" * 60)
    print("ESRF.net Editorial Publisher")
    print("═" * 60)

    # 1. Parse
    meta, body = parse_front_matter(raw)
    print(f"\n📝 Title: {meta.get('title', '?')}")
    print(f"   Slug:  {meta.get('slug', '?')}")
    print(f"   Date:  {meta.get('date', '?')}")

    slug = meta.get("slug")
    if not slug:
        print("Error: 'slug' is required in front matter")
        sys.exit(1)

    i18n_prefix = f"editorial_{slug.replace('-', '_')}"
    filename = f"editorial-{slug}.html"

    # 2. Parse references
    body, refs = parse_references(body)
    print(f"   Refs:  {len(refs)}")

    # 3. Convert body to HTML + i18n keys
    body_html, i18n_keys = md_to_html_blocks(body, i18n_prefix)

    # Add meta keys
    title_nl = meta.get("title", "Editorial")
    i18n_keys[f"{i18n_prefix}.title_tag"] = f"{title_nl} — ESRF.net"
    i18n_keys[f"{i18n_prefix}.meta_desc"] = meta.get("description", "")
    i18n_keys[f"{i18n_prefix}.kicker"] = f"§ Editorial · {meta.get('pillar', 'Stewardship').title()}"
    words = title_nl.split()
    i18n_keys[f"{i18n_prefix}.hero_title_1"] = " ".join(words[:-1]) if len(words) > 1 else title_nl
    i18n_keys[f"{i18n_prefix}.hero_title_2"] = words[-1] if len(words) > 1 else ""
    i18n_keys[f"{i18n_prefix}.hero_subtitle"] = meta.get("description", "")
    i18n_keys[f"{i18n_prefix}.hero_deck"] = meta.get("description", "")
    i18n_keys[f"{i18n_prefix}.tag_stewardship"] = "Stewardship"
    i18n_keys[f"{i18n_prefix}.byline"] = format_byline("nl", datetime.strptime(meta.get("date", "2026-01-01"), "%Y-%m-%d"), int(meta.get("read_time", 8)))
    i18n_keys[f"{i18n_prefix}.h2_refs"] = "Bronnen"
    i18n_keys[f"{i18n_prefix}.join_title_html"] = "Draag bij aan<br>een <i>weerbaar Europa</i>."
    i18n_keys[f"{i18n_prefix}.join_sub"] = "Organisaties op de ESRF.net-atlas kunnen verhalen, rapporten en analyses bijdragen aan de Dispatch."
    i18n_keys[f"{i18n_prefix}.join_cta"] = "Dien een signaal in →"

    print(f"   Keys:  {len(i18n_keys)}")

    # 4. Build English keys (use EN meta or fallback to NL)
    en_keys = dict(i18n_keys)  # Start from NL as base
    en_keys[f"{i18n_prefix}.title_tag"] = f"{meta.get('title_en', title_nl)} — ESRF.net"
    en_keys[f"{i18n_prefix}.meta_desc"] = meta.get("description_en", meta.get("description", ""))
    en_keys[f"{i18n_prefix}.hero_subtitle"] = meta.get("description_en", meta.get("description", ""))
    en_keys[f"{i18n_prefix}.hero_deck"] = meta.get("description_en", meta.get("description", ""))
    en_title = meta.get("title_en", title_nl)
    en_words = en_title.split()
    en_keys[f"{i18n_prefix}.hero_title_1"] = " ".join(en_words[:-1]) if len(en_words) > 1 else en_title
    en_keys[f"{i18n_prefix}.hero_title_2"] = en_words[-1] if len(en_words) > 1 else ""
    en_keys[f"{i18n_prefix}.byline"] = format_byline("en", datetime.strptime(meta.get("date", "2026-01-01"), "%Y-%m-%d"), int(meta.get("read_time", 8)))
    en_keys[f"{i18n_prefix}.h2_refs"] = "References"
    en_keys[f"{i18n_prefix}.join_title_html"] = "Contribute to<br>a <i>resilient Europe</i>."
    en_keys[f"{i18n_prefix}.join_sub"] = "Organisations on the ESRF.net atlas can contribute stories, reports and analyses to the Dispatch."
    en_keys[f"{i18n_prefix}.join_cta"] = "Submit a signal →"
    # Override tags
    tags_en = [t.strip() for t in meta.get("tags_en", meta.get("tags", "")).split(",") if t.strip()]
    for i, tag in enumerate(tags_en):
        en_keys[f"{i18n_prefix}.tag_{i+1}"] = tag

    # 5. Generate HTML file
    html_content = build_html(meta, body_html, refs, i18n_prefix, i18n_keys)
    out_path = os.path.join(ROOT, filename)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"\n\u2713 HTML: {filename} ({len(html_content):,} bytes)")

    # 6. DeepL translation (if API key available)
    deepl_key = os.environ.get("DEEPL_API_KEY", "").strip()
    deepl_translations = None

    # Determine which keys are "meta" (already localised by LANG_OVERRIDES)
    # Keys that are already localised per language via LANG_OVERRIDES or
    # en_keys (and should NOT be sent to DeepL for translation)
    meta_key_suffixes = {
        "title_tag", "meta_desc", "kicker",
        "tag_stewardship", "byline", "h2_refs",
        "join_title_html", "join_sub", "join_cta",
    }
    # NOTE: hero_title_1, hero_title_2, hero_subtitle, hero_deck are
    # intentionally NOT in meta_keys — DeepL translates them so that
    # the hero section matches the article body language.
    # Also include tag_N keys
    for k in i18n_keys:
        short = k.replace(f"{i18n_prefix}.", "")
        if short.startswith("tag_"):
            meta_key_suffixes.add(short)
    meta_keys_full = {f"{i18n_prefix}.{s}" for s in meta_key_suffixes}

    if deepl_key:
        deepl_translations = translate_body_keys(
            nl_keys=i18n_keys,
            i18n_prefix=i18n_prefix,
            meta_keys=meta_keys_full,
            api_key=deepl_key,
        )
    else:
        print("\n\u26a0 DEEPL_API_KEY not set \u2014 using EN fallback for non-NL languages")
        print("  Set the environment variable to enable automatic translation.")

    # 7. Distribute i18n to all 27 languages
    print(f"\n\u2500\u2500 i18n distribution ({len(LANGS)} languages) \u2500\u2500")
    distribute_i18n(i18n_prefix, i18n_keys, en_keys, meta, deepl_translations)

    # 8. Update sitemap
    print(f"\n\u2500\u2500 Sitemap \u2500\u2500")
    update_sitemap(filename, meta.get("date", datetime.now().strftime("%Y-%m-%d")))

    # 9. Update Dispatch feed
    print(f"\n\u2500\u2500 Dispatch \u2500\u2500")
    update_dispatch(meta, filename)

    translated = "with DeepL translations" if deepl_translations else "EN fallback only"
    print(f"\n{'\u2550' * 60}")
    print(f"\u2705 Published: {filename} ({translated})")
    print(f"   URL: https://www.esrf.net/editorial-{slug}")
    print(f"   i18n prefix: {i18n_prefix}")
    print(f"   Languages: {len(LANGS)}")
    print(f"{'\u2550' * 60}")
    print(f"\nNext: git add . && git commit -m 'editorial: {slug}' && git push")


if __name__ == "__main__":
    main()
