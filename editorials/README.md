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
