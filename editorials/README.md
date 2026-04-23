# ESRF.net — Editorial Publishing System

## Snel publiceren

1. Schrijf een Markdown-bestand in `editorials/drafts/`
2. Push naar `main`
3. Ga naar **GitHub Actions → Publish editorial → Run workflow**
4. Vul het pad in (bijv. `editorials/drafts/mijn-artikel.md`)
5. Klik **Run workflow** — klaar.

De Action genereert automatisch:
- Gestileerde HTML-pagina in het ESRF-ontwerpsysteem
- **DeepL-vertalingen** van alle body-tekst naar 23 talen (+ EN fallback voor 4 niet-ondersteunde talen)
- Gelokaliseerde UI-elementen (byline, tags, koppen) per taal via `LANG_OVERRIDES`
- Vermelding in de Dispatch-feed
- Sitemap-entry
- Commit + push → Cloudflare Pages deployt automatisch

## Vertalingen — hoe werkt het?

Het publish-script vertaalt automatisch via de **DeepL API**:

| Taal | Body-tekst | UI-elementen |
|------|-----------|--------------|
| NL   | Nederlands (bron) | Nederlands |
| EN   | DeepL NL→EN | Engels |
| DE   | DeepL NL→DE | Duits (Lesezeit, Quellen, ...) |
| FR   | DeepL NL→FR | Frans |
| ... (19 andere) | DeepL NL→{taal} | Gelokaliseerd per taal |
| GA, HR, IS, MT | EN fallback | Gelokaliseerd per taal |

### DeepL API-key instellen

1. Maak een gratis account op [deepl.com/pro#developer](https://www.deepl.com/pro#developer)
2. Kopieer je API-key (eindigt op `:fx` voor Free tier)
3. Voeg toe als GitHub Secret:
   **Repo → Settings → Secrets → Actions → New secret**
   - Name: `DEEPL_API_KEY`
   - Value: je API-key

Zonder key werkt het script nog steeds, maar dan krijgen niet-NL talen Engels als fallback.

### Gratis limiet

DeepL Free: **500.000 tekens/maand** — genoeg voor ~1 editorial per maand (±375K tekens voor 25 talen).

## Markdown-formaat

### Front matter (verplicht)

```yaml
---
title:          Titel van het artikel (NL)
title_en:       Title of the article (EN)
slug:           url-slug-zonder-spaties
pillar:         stewardship|solidarity|response|renewal|foundation
tags:           Tag1, Tag2, Tag3
tags_en:        Tag1EN, Tag2EN, Tag3EN
date:           2026-05-01
read_time:      8
description:    Meta-beschrijving (NL)
description_en: Meta description (EN)
og_title:       Open Graph titel
og_desc:        Open Graph beschrijving
---
```

### Bodyformaat

| Markdown              | HTML-resultaat                     |
|-----------------------|------------------------------------|
| `## Titel`            | `<h2>` sectiekop                   |
| `### Tip`             | `<h3 class="ed-tip">` (auto-nummering) |
| `> Citaat`            | `<blockquote>`                     |
| `[1]`                 | `<sup><a href="#ref-1">[1]</a></sup>` |
| `:::example`          | `<div class="ed-example">`         |
| `:::callout`          | `<div class="ed-callout">`         |
| `:::end`              | Sluit speciaal blok                |
| `- item`              | `<ul><li>`                         |
| `1. item`             | `<ol><li>`                         |
| Gewone tekst          | `<p>`                              |

### Bronnen

Plaats een `## Bronnen` sectie onderaan met genummerde referenties:

```
## Bronnen

1. https://example.com/source Beschrijving van de bron
2. https://other.org/report Naam — Rapporttitel, datum
```

Verwijs in de tekst met `[1]`, `[2]` etc.

## Lokaal testen

```bash
# Zonder vertalingen (EN fallback):
python3 scripts/publish_editorial.py editorials/drafts/mijn-artikel.md

# Met DeepL-vertalingen:
DEEPL_API_KEY="your-key:fx" python3 scripts/publish_editorial.py editorials/drafts/mijn-artikel.md

# Bekijk wijzigingen:
git diff
```

## Mapstructuur

```
editorials/
├── drafts/          ← Markdown-concepten
├── published/       ← Verplaats hierheen na publicatie (optioneel)
└── README.md        ← Dit bestand
```

## Pre-publish checklist — i18n guardrail

Before merging an editorial PR to `main`, run the i18n validator locally to
make sure the page is not shipped half-translated:

```bash
# Validate every editorial page currently in the repo:
python3 scripts/validate_editorial_i18n.py

# Validate a single editorial page:
python3 scripts/validate_editorial_i18n.py --page editorial-mijn-artikel-2026.html

# CI-style run (block only structural failures, allow legacy markup drift
# to surface as warnings — see scripts/validate_editorial_i18n.py --help):
python3 scripts/validate_editorial_i18n.py \
    --fail-on KEY_MISSING,KEY_EMPTY,DUTCH_LEAKAGE,SOURCE_MISSING
```

What the validator catches:

| Code             | Meaning |
|------------------|---------|
| `KEY_MISSING`    | An HTML page references a `data-i18n` key that doesn't exist in a locale JSON. |
| `KEY_EMPTY`      | The key exists but is blank or non-string. |
| `SOURCE_MISSING` | The NL source is missing for a referenced key — translations cannot be verified without it. |
| `DUTCH_LEAKAGE`  | A non-NL locale value is identical to the Dutch source *and* is not an allow-listed proper noun / shared label. This catches pages where DeepL translation was skipped for a key. |
| `EN_FALLBACK`    | A non-EN locale value equals the EN value. Warning by default (documented convention for `ga`, `hr`, `is`, `mt`). Upgrade to error with `--strict`. |
| `MARKUP_MISMATCH`| HTML tags or `{placeholders}` in a translated value don't match the NL source. Flags translations where DeepL or a human editor dropped `<em>`, `<sup>`, `<br>`, anchors, etc. |

**Publishing a new editorial — checklist:**

1. Write the draft in `editorials/drafts/`, push to `main`.
2. Run the `Publish editorial` GitHub Action with `DEEPL_API_KEY` configured
   so non-NL locales get real translations (not EN fallback).
3. Pull the automated commit locally and run
   `python3 scripts/validate_editorial_i18n.py --page editorial-<slug>.html`.
4. Fix any `MARKUP_MISMATCH` by hand-editing the affected locale(s) in
   `i18n/*.json` — DeepL occasionally drops inline markup.
5. For the 4 DeepL-unsupported locales (`ga`, `hr`, `is`, `mt`), EN-fallback
   is expected and is recorded as a warning only.
6. Add new proper nouns (brand names, acronyms that are identical in every
   language) to `PROPER_NOUN_ALLOWLIST` in `scripts/validate_editorial_i18n.py`
   if they trigger false `DUTCH_LEAKAGE` findings.
7. The validator also runs in CI on every push/PR — see
   `.github/workflows/validate-editorial-i18n.yml`.
