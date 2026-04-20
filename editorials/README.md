# ESRF.net — Editorial Publishing System

## Snel publiceren

1. Schrijf een Markdown-bestand in `editorials/drafts/`
2. Push naar `main`
3. Ga naar **GitHub Actions → Publish editorial → Run workflow**
4. Vul het pad in (bijv. `editorials/drafts/mijn-artikel.md`)
5. Klik **Run workflow** — klaar.

De Action genereert automatisch:
- Gestileerde HTML-pagina in het ESRF-ontwerpsysteem
- i18n-vertalingen voor alle 27 talen
- Vermelding in de Dispatch-feed
- Sitemap-entry
- Commit + push → Cloudflare Pages deployt automatisch

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
python3 scripts/publish_editorial.py editorials/drafts/mijn-artikel.md
# Bekijk het gegenereerde HTML-bestand en i18n-wijzigingen
git diff
```

## Mapstructuur

```
editorials/
├── drafts/          ← Markdown-concepten
├── published/       ← Verplaats hierheen na publicatie (optioneel)
└── README.md        ← Dit bestand
```
