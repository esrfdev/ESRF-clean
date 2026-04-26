# Redactieformulier — leesbaar review-formulier boven de Sheet

> **Branch:** `test/regional-editorial-contributor-intake` only.
> **Validatie-only.** Schrijft niet naar Sheet, GitHub, e-mail of Directory_Master.
> **Single source of truth blijft de Drive-spreadsheet** (LAB_Intake_Submissions /
> LAB_Editorial_Intake / LAB_Workflow_Events).
> **LAB read API achter access-code.** Standaard sample-mode in de browser;
> echte LAB-rijen verschijnen pas wanneer `REDACTIE_REVIEW_ACCESS_CODE` is
> ingesteld op de Cloudflare Pages preview én de redacteur de code invult.
> Een live write-pad bestaat niet — de update-API is dry-run.

## API-architectuur (lab-only)

Twee Cloudflare Pages Functions ondersteunen het redactieformulier
(beide preview-only, productie geeft 404):

- `POST /api/redactie-review` — **read**. Vraagt LAB_Intake_Submissions
  en LAB_Editorial_Intake aan via een server-side Apps Script read-
  webhook. De server valideert de review-toegangscode. Wanneer code
  én webhook ontbreken: `mode: 'sample'` met lokale voorbeeldrijen.
  Wanneer code geldig maar webhook ontbreekt: `mode: 'sample'` met een
  duidelijke `activation_required`-lijst. Wanneer code én webhook
  geldig: `mode: 'lab'` met echte rijen, contact-velden gestript tenzij
  `include_contact: true`.

- `POST /api/redactie-review-update` — **dry-run**. Bouwt de canonieke
  review-update payload (precies zoals `redactie-validation.html` 'm
  ook offline genereert) maar voert geen write uit. Refuseert elk
  `target_tab` dat niet `LAB_*` is of in `forbidden_targets`
  voorkomt. `live_write_ready` staat hard op `false`; live write is
  bewust niet geïmplementeerd op deze branch.

Vereiste env vars (preview project):

| env var | doel | status |
| --- | --- | --- |
| `REDACTIE_REVIEW_ACCESS_CODE` | gates real-data read; zonder → sample | **ontbreekt → sample-mode** |
| `REDACTIE_REVIEW_WEBHOOK_URL` | Apps Script /exec voor read | **ontbreekt → sample-mode** |
| `REDACTIE_REVIEW_WEBHOOK_SECRET` | shared secret in body | **ontbreekt → sample-mode** |
| `REDACTIE_REVIEW_WRITE_ENABLED` | hard toggle voor live write | **niet activeerbaar op deze branch** |
| `ESRF_PREVIEW` of `CF_PAGES_BRANCH ≠ main` | preview-only gate | bestaande conventie |

Veiligheidsregels die in de endpoints zelf staan:

- Geen request wordt verwerkt als `CF_PAGES_BRANCH === 'main'` of
  `ESRF_PREVIEW` niet expliciet preview is.
- Origin-allowlist is hergebruikt van `/api/intake`.
- Toegangscode wordt server-side vergeleken met constant-time-style
  byte-vergelijking; een leeg of fout antwoord geeft altijd sample-mode
  (geen lekkage of de code überhaupt is geconfigureerd).
- Forbidden keys (`raw_payload_json`, alle `*_TOKEN`, `SHEETS_*`,
  `REDACTIE_REVIEW_*`) worden uit elke response gestript voordat ze
  de origin verlaten.
- Contact-velden (`contact`, `contact_internal`) worden standaard
  gestript en alleen meegegeven wanneer de redacteur expliciet
  `include_contact: true` stuurt **én** de access code geldig is.

## Frontend-toegangspaneel

Bovenaan de pagina staat een compact toegangspaneel:

- Mode-pil: `SAMPLE-MODE` (geel) of `LAB-MODE — live` (groen).
- Wachtwoordveld voor de review-toegangscode. **Geen localStorage,
  geen sessionStorage, geen cookie** — de code leeft alleen in de
  closure van het script en wordt bij elke load opnieuw verstuurd.
  *Wis code · terug naar sample* maakt de input leeg en herstelt de
  lokale voorbeelddata.
- Statusregel met de servermessage (`access code not configured`,
  `review code missing or incorrect`, `access code valid · live LAB
  read`).
- `activation_required` lijst die exact noemt welke env vars nog
  nodig zijn om over te schakelen naar echte LAB-data.
- Onder *Procesgang* in de review-sectie verschijnt een korte
  herinnering per stap (uit `STATUS_STEP_REMINDERS`, server-side de
  bron). De hint herzetzet zich live wanneer de redacteur de stap
  wijzigt.

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

## Edit-mode — Redactieversie / Publicatievoorstel

De pagina ondersteunt naast lezen/beoordelen ook een **edit-mode** waarmee
redactie een *redactieversie* van de inzending opbouwt. Dit is een
voorstel voor publicatie, geen aanpassing van de bron.

Belangrijk:

- **De originele inzending is en blijft de bron.** Edits worden lokaal in
  de browser bijgehouden onder `editsById[submission_id]`. Het SAMPLE-record
  wordt nooit gemuteerd. De Drive-spreadsheet (LAB_*-tab) blijft het
  audit-spoor van wat er oorspronkelijk binnenkwam.
- **Bewerken wijzigt alleen het publicatievoorstel.** De export bevat
  twee blokken naast elkaar — `original_reference` (bron, audit) en
  `edited_publication_proposal` (redactieversie). Pas in een latere,
  handmatige stap kan deze redactieversie worden meegenomen naar de
  lab-promotion pipeline.
- **Geen automatische live publicatie.** Knoppen genereren alleen
  kopieerbare JSON of tekst — niets verlaat de browser, geen Sheet-write,
  geen e-mail, geen webhook.

### Activeren

Klik in het detail-paneel op **Bewerken — stel redactieversie op**. De
sectie *Redactieversie / Publicatievoorstel* (geel-getint) verschijnt
onder de sectie *Originele inzending (read-only · bron / audit)*. Een
oranje banner herhaalt dat bewerkingen alleen het voorstel raken en
nooit live gaan.

### Editbare velden (NL labels)

| key | label |
| --- | --- |
| `edited_title` | Titel / naam |
| `edited_organization` | Organisatie |
| `edited_summary` | Samenvatting / omschrijving |
| `edited_region` | Regio |
| `edited_sector_or_tags` | Sector / tags |
| `edited_public_body` | Publicatie-veilige tekst (body) |
| `editorial_note` | Redactienotitie (publiek) |
| `change_note` | Wijzigingsnotitie (intern, waarom?) |
| `edited_by` | Bewerkt door (initialen / naam) |

Onder elk editbaar veld toont de UI het corresponderende **originele**
veld als een read-only invoerveld (grijs gemarkeerd), zodat redactie
direct kan vergelijken zonder context-switch.

### Change tracking

Onder de edit-sectie staat een lichtgewicht change-tracker (cyaan) die
realtime opsomt welke velden afwijken van de originele inzending. Bij
0 wijzigingen toont de tracker *"Geen wijzigingen ten opzichte van de
originele inzending."* Hetzelfde wordt geëxporteerd als
`changed_fields: [...]`.

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
    "original_reference": {
      "submission_id": "...",
      "record_type": "...",
      "source_tab": "...",
      "source_row_hint": "...",
      "received_at": "...",
      "title": "...",
      "organization_name": "...",
      "region": "...",
      "country_code": "...",
      "sector_raw": "...",
      "topic_tags": "...",
      "language": "...",
      "type": "...",
      "summary": "...",
      "body_md_or_url": "...",
      "website": "..."
    },
    "edited_publication_proposal": {
      "edited_title": "...",
      "edited_organization": "...",
      "edited_summary": "...",
      "edited_region": "...",
      "edited_sector_or_tags": "...",
      "edited_public_body": "...",
      "editorial_note": "...",
      "change_note": "...",
      "edited_by": "..."
    },
    "changed_fields": ["edited_title", "edited_summary"],
    "change_note": "...",
    "edited_by": "...",
    "edited_at": "<ISO when changed_fields is non-empty>",
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
    "warning": "Validatie-only export. Bewerkingen vormen alleen een publicatievoorstel — de originele inzending (original_reference) blijft de bron. Niet automatisch ingelezen, geen auto-publicatie — plak handmatig in de juiste LAB_*-rij. Directory_Master niet aanpassen.",
    "contact_disclosed": false
  }
  ```

  > De `original_reference` blok is altijd aanwezig (ook als er geen
  > bewerkingen zijn gemaakt) en is een bevroren kopie van de submitted
  > velden. Het `edited_publication_proposal`-blok is altijd aanwezig en
  > is óf identiek aan de bron (bij geen wijzigingen) óf een door
  > redactie aangepaste versie. `changed_fields` somt op welke
  > proposal-velden afwijken.
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
- Edit-mode velden zijn aanwezig in de HTML
  (Redactieversie / Publicatievoorstel, edited_title, edited_summary,
  edited_region, edited_sector_or_tags, editorial_note, change_note,
  edited_by, edited_public_body).
- Originele inzending wordt read-only weergegeven naast de edit-sectie.
- Export draagt `original_reference` en `edited_publication_proposal`
  in de payload.
- Export bevat `changed_fields`, `change_note`, `edited_by` en — bij
  daadwerkelijke wijzigingen — een `edited_at` timestamp.
- Edit-warning copy ("publicatievoorstel", "originele inzending blijft
  als bron", "geen automatische live publicatie") staat in de pagina.

Run: `node scripts/redactie_validation.test.mjs`.

## Activatiestappen — overgang van sample naar echte LAB-data

> Geen van de stappen wordt automatisch uitgevoerd. Wouter zet de
> env vars op het Cloudflare Pages **preview** project, nooit op
> productie.

1. Maak een nieuw, *read-only* Apps Script-project onder
   `office@esrf.net`. Scope uitsluitend `https://www.googleapis.com/auth/spreadsheets.readonly`.
2. Implementeer `doPost(e)`: lees `LAB_Intake_Submissions` en
   `LAB_Editorial_Intake` als objecten en geef terug als
   `{ records: [...] }`. Verifieer in de Apps Script dat
   `e.postData` een matchende `shared_secret` bevat.
3. Publiceer als Web App, kopieer de `/exec` URL.
4. Cloudflare Pages → preview project → Settings → Environment vars:
   - `REDACTIE_REVIEW_ACCESS_CODE` → een nieuwe, voldoende lange string
     (16+ karakters; alleen door redactie gedeeld).
   - `REDACTIE_REVIEW_WEBHOOK_URL` → de `/exec` URL.
   - `REDACTIE_REVIEW_WEBHOOK_SECRET` → exact dezelfde string als in
     de Apps Script Script Properties.
5. Deploy preview, open `/redactie-validation.html`, voer de access
   code in. Verwacht: `LAB-MODE — live`, echte rijen verschijnen,
   contactvelden ontbreken (tenzij later expliciet `include_contact`
   wordt aangezet).
6. Een live write-pad is op deze branch *bewust niet ingebouwd*. Voor
   de volgende veilige stap: maak een tweede Apps Script-project, met
   alléén `auth/spreadsheets` scope op specifieke status-kolommen of
   een append-only `LAB_Workflow_Events` tab — nooit Directory_Master.
   Pas dán is `REDACTIE_REVIEW_WRITE_ENABLED=true` zinvol.

## Veiligheidsregels die de endpoints afdwingen

- `target_tab` moet starten met `LAB_` en in `ALLOWED_REVIEW_TARGET_TABS`
  staan (`LAB_Intake_Submissions`, `LAB_Editorial_Intake`,
  `LAB_Workflow_Events`).
- `Directory_Master` staat in `forbidden_targets` — elke poging om die
  als target te gebruiken faalt server-side.
- Process step en review status worden gevalideerd tegen de
  documentatie-vaste set; niet-gedocumenteerde keuzes geven 400.
- Contact en `raw_payload_json` worden uit elke response en elk dry-run
  payload gestript.
- Live write is uitgeschakeld: `live_write_ready: false` in elke
  response op deze branch.
