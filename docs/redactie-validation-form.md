# Redactieformulier — leesbaar review-formulier boven de Sheet

> **Branch:** `test/regional-editorial-contributor-intake` only.
> **Validatie-only.** Schrijft niet naar Sheet, GitHub, e-mail of Directory_Master.
> **Single source of truth blijft de Drive-spreadsheet** (LAB_Intake_Submissions /
> LAB_Editorial_Intake / LAB_Workflow_Events).

## Wat dit is

`redactie-validation.html` is een verborgen, niet-geïndexeerde redactiepagina
die rijen uit de LAB_*-tabs *leesbaar* presenteert: één inzending per keer, in
een kaart-/detail-indeling met grote velden, NL-labels en duidelijke
waarschuwingen. Het is bedoeld om beoordelen makkelijker te maken dan
rechtstreeks in de spreadsheet werken — zonder dat de spreadsheet zijn rol
als audit-spoor en SSoT verliest.

De pagina staat boven de Sheet, niet ervoor. Niets wordt automatisch
weggeschreven.

## Wat dit niet is

- **Geen publicatieflow.** De pagina genereert nooit een live editorial of
  directory-listing.
- **Geen Sheet-write.** De browser doet geen Google Sheets API call. Wijzigingen
  zijn alleen lokaal in het formulier.
- **Geen e-mail of webhook.** De pagina laadt niets externs en stuurt niets
  weg.
- **Geen Directory_Master-aanpassing.** Niet via UI, niet via export.
- **Geen PII-export by default.** Submitter-contact (naam, e-mail, telefoon)
  is verborgen en uitgesloten van de export, tenzij de operator expliciet de
  toggle "Toon contactgegevens" aanzet voor *intern* gebruik.

## Plek in de keten

```
   ┌──────────────────────────┐
   │ Public form              │  submit-validation.html
   │ /submit-validation.html  │  (lab/preview only — never production)
   └────────────┬─────────────┘
                │ POST /api/intake-test
                ▼
   ┌──────────────────────────┐
   │ LAB_* tabs in Drive      │  LAB_Intake_Submissions
   │ Sheet (single SoT)       │  LAB_Editorial_Intake
   │                          │  LAB_Workflow_Events
   └────────────┬─────────────┘
                │ redactie leest rijen
                ▼
   ┌──────────────────────────┐
   │ redactie-validation.html │  ← dit document
   │ (lokale voorbeelddata)   │  leesbare review-UI, geen Sheet-write
   └────────────┬─────────────┘
                │ operator kopieert review-update (JSON of tekst)
                ▼
   ┌──────────────────────────┐
   │ Drive-spreadsheet        │  redactie plakt handmatig terug
   │ (LAB_*)                  │  in de juiste rij
   └────────────┬─────────────┘
                │ pas hierna kan de lab-promotion pipeline draaien
                ▼
   ┌──────────────────────────┐
   │ Lab promotion (offline)  │  scripts/lab_promote/cli  (handmatig)
   └──────────────────────────┘
```

## Wat de pagina toont

Linker kolom: lijst van inzendingen (kaart per rij) met type-pil
(`Organisatie` of `Editorial`), titel, regio, land en bron-tab + rij-hint.
Filter bovenaan voor titel/regio/type.

Rechter kolom: detail- en review-formulier voor de gekozen rij:

- **Inhoud** — organisatie/titel, regio, land, sector of tags, type, samenvatting,
  optioneel body markdown (intern, ingeklapt).
- **Indiener (intern)** — standaard verborgen achter een toggle. Wanneer
  uitgeklapt is het duidelijk gemarkeerd als `INTERN`.
- **Beoordeling** — eenvoudige dropdowns en velden:
  - Procesgang (binnengekomen / in review / wacht op indiener / klaar voor
    akkoord / akkoord — gereed voor promote / afgewezen / gearchiveerd)
  - Status (in review / vraagt verheldering / goedgekeurd voor kandidaat
    / directory-kandidaat / editorial draft / lab-promote / afgewezen)
  - Herinnering / checkvraag (vrije tekst — bedoeld voor wat de redacteur
    morgen weer moet weten)
  - Volgende actie
  - Toegewezen aan
  - Deadline (datum)
  - Review-notities (intern)

## Veiligheidsbanier

Bovenaan de pagina:

- `noindex,nofollow` in `<meta name="robots">` én `<meta name="googlebot">`
- `referrer no-referrer`
- Stage-bar met `VALIDATIEOMGEVING · NIET PUBLIEK`
- Gele waarschuwingsbanner met de drie kernregels:
  - **Niet publiceren**
  - **Directory_Master niet aanpassen**
  - **Preview pas na akkoord**

De pagina is niet gelinkt vanuit productie-navigatie, footer of sitemap.
Productie kan alleen via direct intypen van het pad worden bereikt — en is
daar `noindex`.

## Export — wat zit erin, wat niet

Twee knoppen:

- **Genereer review-update (JSON)** — produceert een vlak object dat de
  redactie handmatig in de juiste LAB_*-rij plakt. Sleutels:
  ```json
  {
    "submission_id": "...",
    "record_type": "org" | "editorial",
    "source_tab": "LAB_Intake_Submissions" | "LAB_Editorial_Intake",
    "source_row_hint": "rij N",
    "environment": "TEST/VALIDATIE",
    "title": "...",
    "organization_name": "...",
    "region": "...",
    "country_code": "...",
    "type": "...",
    "review_update": {
      "process_step": "...",
      "review_status": "...",
      "reminder": "...",
      "next_required_action": "...",
      "assigned_to": "...",
      "due_date": "...",
      "review_notes_internal": "..."
    },
    "review_generated_at": "<ISO>",
    "generated_by": "redactie-validation.html (lab, browser-only)",
    "warning": "Validatie-only export. Niet automatisch ingelezen — plak handmatig in de juiste LAB_*-rij. Directory_Master niet aanpassen.",
    "contact_disclosed": false
  }
  ```
- **Genereer tekst-samenvatting** — dezelfde inhoud als compacte regel-per-veld
  tekst, prettig om in een Sheet-cel te plakken.

**Wat zit er bewust NIET in de export, behalve als de operator de toggle
"Toon contactgegevens" expliciet aanzet:**

- `contact.name`
- `contact.email`
- `contact.phone`
- `contact.role`
- `raw_payload_json`
- elk ander vrij PII-veld

Wanneer de toggle aanstaat, voegt de export een `contact_internal`-blok toe
en zet `contact_disclosed: true`. Dit is een bewuste, expliciete handeling —
de standaard is altijd zonder PII.

## Wat is wel/niet geautomatiseerd

| Stap | Geautomatiseerd? |
| --- | --- |
| Inzending indienen via `submit-validation.html` | Ja (LAB-only) |
| Schrijven naar LAB_*-tabs via `/api/intake-test` | Ja (LAB-only) |
| Notificatie naar redactie | **Nee** — periodieke Sheet monitoring (zie `intake-minimal-notification-design.md`) |
| Leesbaar review-formulier (deze pagina) | Ja, maar *alleen lokaal in de browser* |
| Terug-schrijven van review-update naar Sheet | **Nee — handmatig kopiëren** |
| Promotie naar editorial draft / directory candidate | Nee — handmatig via `scripts/lab_promote/cli`, alleen na akkoord in Sheet |
| Publicatie naar live | Nee — alleen via reguliere PR-merge na expliciete approval |

## Aanbevolen redactie-flow

1. Open `redactie-validation.html` op de Cloudflare Pages branch-preview.
2. Selecteer de inzending uit de lijst (gefilterd op regio of type indien nodig).
3. Lees de samenvatting en velden in het rechterpaneel.
4. Vul procesgang, status, reminder/checkvraag, volgende actie, assigned_to,
   deadline en review-notities in.
5. Klik **Genereer review-update (JSON)** of **tekst-samenvatting**.
6. Klik **Kopieer naar klembord**.
7. Open de Drive-spreadsheet, ga naar de juiste LAB_*-rij (zie
   `source_row_hint`) en plak de waarden in de bestaande kolommen — *niet*
   de hele JSON in één cel.
8. Pas daarna mag de lab-promotion pipeline lopen voor goedgekeurde rijen.

## Tests

Lichtgewicht Node-test: `scripts/redactie_validation.test.mjs`. Verifieert:

- Pagina bevat `noindex,nofollow` (robots én googlebot).
- Validatie-waarschuwingen aanwezig (`Niet publiceren`,
  `Directory_Master niet aanpassen`, `Preview pas na akkoord`).
- Lokale voorbeelddata bevat zowel een `record_type: 'org'` als een
  `record_type: 'editorial'`.
- `buildExportPayload` sluit standaard `contact` uit en bevat het pas
  wanneer `includeContact === true`.
- `validation-lab.json` bevat een module met id `redactie-validation-form`.

Run: `node scripts/redactie_validation.test.mjs`.
