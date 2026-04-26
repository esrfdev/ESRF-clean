# Redactieformulier — leesbaar review-formulier boven de Sheet

## Voor de redacteur — in eenvoudige taal

Dit formulier is een **testpagina** waarop je inzendingen kunt bekijken en beoordelen.

Wat je moet weten in één oogopslag:

- **Dit is een testomgeving.** Niets wordt op de website gepubliceerd.
- **De inzending van de indiener verandert niet.** Wat de indiener heeft ingestuurd blijft staan zoals het was.
- **De vaste hoofdtabel met organisaties verandert niet.** Deze pagina raakt die tabel nooit aan.
- **In teststand wordt niets opgeslagen.** Je kunt rustig dingen uitproberen.
- **Pas als beheer dit scherm activeert** wordt jouw beoordeling opgeslagen in de redactietabel en komt er een notitie in het activiteitenlogboek. Er gaat dan nog steeds niets automatisch naar de website en er wordt geen e-mail verstuurd.

### Hoe gebruik je het scherm?

1. **Kies een inzending** in de lijst links.
2. Lees rustig de inhoud rechts. **Ontvangen** betekent: lees en controleer of alles begrijpelijk is.
3. Wil je iets aan de tekst voor publicatie veranderen? Klik op **Tekst voor publicatie aanpassen**. Je verandert dan alleen de redactieversie — niet de inzending van de indiener. Dit is stap **In redactie**.
4. Twijfel je of mis je informatie? Zet de stap op **Controle nodig** en vraag een collega mee te kijken.
5. Klaar voor publicatie? Kies **Goedgekeurd voor concept**. Een collega van beheer maakt dan het conceptartikel of de conceptvermelding aan.
6. Niet geschikt? Kies **Afgewezen / geparkeerd** en zet kort in de notitie waarom.

### De vijf stappen

1. **Ontvangen** — lees de inzending en controleer of alles begrijpelijk is.
2. **In redactie** — pas alleen de tekst voor publicatie aan.
3. **Controle nodig** — vraag extra informatie of laat iemand meekijken.
4. **Goedgekeurd voor concept** — de tekst mag naar een conceptartikel of conceptvermelding.
5. **Afgewezen / geparkeerd** — doe voorlopig niets en noteer waarom.

### De hoofdknop onderaan

Wat je ziet, hangt ervan af of het scherm in teststand staat of door beheer is geactiveerd:

- **In teststand:** *Maak testvoorbeeld — er wordt niets opgeslagen.* Je ziet dan alleen een leesbare samenvatting van jouw beoordeling. Er wordt niets opgeslagen.
- **Als beheer dit scherm heeft geactiveerd:** *Opslaan in redactietabel.* Jouw beoordeling wordt opgeslagen in de redactietabel en er komt een notitie in het activiteitenlogboek. De inzending van de indiener verandert niet, de vaste hoofdtabel met organisaties wordt niet aangeraakt en er wordt niets gemaild of gepubliceerd.

Direct onder de knop staat altijd het blokje **Wat gebeurt er als ik klik?** met drie regels:

- *Wat er wel gebeurt* — wat de knop precies doet.
- *Wat er níet gebeurt* — bevestiging dat de inzending niet verandert, dat er niets op de website komt en dat er geen e-mail uitgaat.
- *Wat jij hierna doet* — je hoeft niets te kopiëren of te plakken.

### Toegangscode

- **Teststand:** je ziet voorbeeldinzendingen. Geen toegangscode nodig.
- **Echte inzendingen:** beheer geeft je een toegangscode. Vul die in en klik op *Echte inzendingen laden*. De code blijft alleen in dit tabblad; hij wordt niet onthouden, niet in een cookie en niet op je computer.

### Het beheer-blok onderaan ("Alleen voor beheer bij storing")

Onderaan staat een ingeklapt blok met technische knoppen voor beheer. **Gebruik dit niet voor normaal redactiewerk.** Dit blok is alleen bedoeld als opslaan een keer niet lukt en beheer je vraagt een technisch bestand op te sturen.

---

## Voor beheer — technische details

> **Branch:** `test/regional-editorial-contributor-intake` only.
> **Validatie-only voor de productie.** Productie schrijft niets — Cloudflare
> Pages Functions zijn preview-only en geven 404 op productie.
> **Single source of truth blijft de Drive-spreadsheet** (LAB_Intake_Submissions /
> LAB_Editorial_Intake / LAB_Redactie_Reviews / LAB_Workflow_Events).
> **Geen kopiëren/plakken in de gewone werkflow.** Zodra de redactie-Apps-
> Script en bijbehorende Cloudflare preview env vars geactiveerd zijn,
> slaat de redactiepagina de redactiebeoordeling rechtstreeks op in
> `LAB_Redactie_Reviews` (append-only) en logt een gebeurtenis in
> `LAB_Workflow_Events`. De originele inzending in
> `LAB_Intake_Submissions` / `LAB_Editorial_Intake` blijft staan.
> **LAB read + write API achter access-code + 4-gate activatie.** Zonder
> de env vars draait de pagina in sample-mode en wordt er niets opgeslagen.
> **Directory_Master blijft hard-deny** — geen UI, geen API, geen Apps
> Script raakt die tab aan.
> **Technische export blijft als noodluik.** Alleen openen wanneer
> automatisch opslaan niet werkt en beheer hierom vraagt.

## API-architectuur (lab-only)

Twee Cloudflare Pages Functions ondersteunen het redactieformulier
(beide preview-only, productie geeft 404). De serverless functions
praten met een **gescheiden** Apps Script Web App (bron in
`docs/apps-script-redactie-review-webhook.gs`, manifest in
`docs/appsscript.redactie-review.json`). De Apps Script is
spreadsheet-only, leest LAB_*-tabs en schrijft alleen append-only naar
`LAB_Redactie_Reviews` en `LAB_Workflow_Events`. Directory_Master
staat hard op de deny-list.

- `POST /api/redactie-review` — **read**. Vraagt LAB_Intake_Submissions
  en LAB_Editorial_Intake aan via een server-side Apps Script read-
  webhook. De server valideert de review-toegangscode. Wanneer code
  én webhook ontbreken: `mode: 'sample'` met lokale voorbeeldrijen.
  Wanneer code geldig maar webhook ontbreekt: `mode: 'sample'` met een
  duidelijke `activation_required`-lijst. Wanneer code én webhook
  geldig: `mode: 'lab'` met echte rijen, contact-velden gestript tenzij
  `include_contact: true`.

- `POST /api/redactie-review-update` — **save (preview-only)**. Bouwt
  de canonieke review-update payload, valideert `target_tab` (alleen
  `LAB_*` en niet in `forbidden_targets`) en — zodra alle vier de
  activatie-poorten passen — stuurt die door naar de Apps-Script
  Web App met `action: "submit_review_update"`. Apps Script schrijft
  één rij naar `LAB_Redactie_Reviews` en één rij naar
  `LAB_Workflow_Events` (beide append-only). Zonder volledige activatie
  blijft het endpoint dry-run en geeft het `save_status: "not_saved"`
  terug met de reden welke env var ontbreekt. Bij upstream-fouten
  geeft het `save_status: "failed"`. Directory_Master wordt zowel
  Cloudflare-side als in Apps Script hard geweigerd. Contact-velden en
  `raw_payload_json` worden defensief uit de outbound payload gestript.

  Vier gates voor live opslaan, alle vier vereist:
  1. `REDACTIE_REVIEW_ACCESS_CODE` geconfigureerd én geldige code in body.
  2. `REDACTIE_REVIEW_WEBHOOK_URL` (Apps Script `/exec`).
  3. `REDACTIE_REVIEW_WEBHOOK_SECRET` (shared secret, server-side only).
  4. `REDACTIE_REVIEW_WRITE_ENABLED=true` (expliciete toggle).

Vereiste env vars (preview project):

| env var | doel | status |
| --- | --- | --- |
| `REDACTIE_REVIEW_ACCESS_CODE` | gates real-data read; zonder → sample | **ontbreekt → sample-mode** |
| `REDACTIE_REVIEW_WEBHOOK_URL` | Apps Script /exec voor read | **ontbreekt → sample-mode** |
| `REDACTIE_REVIEW_WEBHOOK_SECRET` | shared secret in body | **ontbreekt → sample-mode** |
| `REDACTIE_REVIEW_WRITE_ENABLED` | expliciete toggle (`true`) voor live opslaan | **vereist voor live opslaan; zonder → dry-run** |
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
                │ redactie leest rijen via /api/redactie-review
                ▼
   ┌──────────────────────────┐
   │ redactie-validation.html │  ← dit document
   │ (LAB-mode of sample)     │  leesbare review-UI
   └────────────┬─────────────┘
                │ klik "Opslaan in redactietabel"
                │ POST /api/redactie-review-update
                │ (preview-only, access-code + 4-gate activatie)
                ▼
   ┌──────────────────────────┐
   │ Apps Script Web App      │  spreadsheet-only OAuth
   │ submit_review_update     │  hard deny: Directory_Master
   └────────────┬─────────────┘
                │ append-only writes
                ▼
   ┌──────────────────────────┐
   │ LAB_Redactie_Reviews     │  redactiebeslissing (audit-rij)
   │ LAB_Workflow_Events      │  gebeurtenis (audit-log)
   │ (origineel blijft staan) │  intake-tabs ongewijzigd
   └────────────┬─────────────┘
                │ pas na akkoord: handmatige lab-promotion
                ▼
   ┌──────────────────────────┐
   │ Lab promotion (offline)  │  scripts/lab_promote/cli  (handmatig)
   └──────────────────────────┘

   ── Geen kopiëren/plakken in de gewone werkflow ──
   ── Directory_Master blijft hard-deny op elk niveau ──
   ── Geen automatische publicatie ──
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
- **Geen automatische live publicatie.** In LAB-mode schrijft de
  hoofdknop *Opslaan in redactietabel* de redactieversie automatisch
  weg in `LAB_Redactie_Reviews` + `LAB_Workflow_Events` (append-only,
  via `/api/redactie-review-update`). In sample-mode wordt niets
  opgeslagen. Geen kopiëren/plakken in de gewone werkflow; technische
  export is alleen een fallback voor beheer wanneer automatisch
  opslaan niet werkt.

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

## Acties onderaan de pagina (2026-04-26 — automatisch opslaan)

De actieknoppen onderaan zijn ingedeeld zodat de redacteur zonder
technische uitleg precies weet wat een knop doet, en wat hij níet
doet. Het normale pad is **opslaan in de redactietabel** —
kopiëren/plakken is geen onderdeel van de werkflow meer. Directory_Master
wordt nooit aangeraakt en er is geen automatische publicatie naar de
publieke site of e-mail.

### Hoofdactie (zichtbaar, role-based, mode-aware)

- **Sample- / fallback-mode** (geen access code, of activatie-vars
  ontbreken op de preview): knoplabel
  **`Maak testvoorbeeld — niets wordt opgeslagen`**. Boven de knop
  staat een gele pil **`TESTVOORBEELD · niets wordt opgeslagen`**.
  De knop genereert alleen een lokaal voorbeeld; er wordt geen API
  aangeroepen voor opslaan.
- **LAB-mode** (geldige access code én alle webhook-env vars): knoplabel
  **`Opslaan in redactietabel`**. Boven de knop staat een groene
  banner **`LAB-MODE · opslaan in LAB_Redactie_Reviews +
  LAB_Workflow_Events · originele inzending blijft staan ·
  Directory_Master wordt nooit aangeraakt`**. Klikken op deze knop
  POST't naar `/api/redactie-review-update`, dat de Apps Script
  webhook aanroept met `action: submit_review_update`. Apps Script
  schrijft één rij naar `LAB_Redactie_Reviews` (audit-rij) en één
  rij naar `LAB_Workflow_Events` (gebeurtenis-log). Geen kopiëren,
  geen plakken.

Direct onder de hoofdknop staat een **`Wat gebeurt er na deze knop?`**
instructieblok met drie regels in eenvoudig Nederlands. In LAB-mode:

1. *Wat er wel gebeurt:* je redactiebeslissing wordt rechtstreeks
   opgeslagen als nieuwe rij in `LAB_Redactie_Reviews`; een gebeurtenis
   wordt vastgelegd in `LAB_Workflow_Events`.
2. *Wat er níet gebeurt:* de originele inzending blijft staan,
   `Directory_Master` wordt niet aangeraakt, er wordt niets gemaild en
   er is geen automatische publicatie.
3. *Wat jij hierna doet:* controleer de bevestiging onder de knop
   (`save_status: saved`). Geen handmatig kopiëren of plakken meer.

Onder de hoofdactie verschijnt na een save een statusbanner:

- `Opgeslagen in redactietabel` (groen) — bevestigt naar welke tab
  geschreven is, welke `review_id` is toegekend en bevestigt expliciet
  dat originele inzending en `Directory_Master` ongewijzigd zijn.
- `Niet opgeslagen` (grijs) — alleen in sample-mode of wanneer een
  activatie-var ontbreekt. De banner noemt exact welke env var ontbreekt
  en de tekst *"Opslaan is nog niet actief; er wordt niets opgeslagen."*
- `Opslaan mislukt` (rood) — netwerk- of upstream-fout. Niets is
  geschreven; de redacteur kan opnieuw klikken.

Naast de hoofdknop staat **`Wis voorbeeld — begin opnieuw`**
(rv-btn-warn). Die knop wist alleen het preview-paneel en de
status-banner; geen Sheet, geen export wordt geraakt.

### Technische export voor beheer (ingeklapt — fallback)

De vroegere knoppen *Genereer review-update (JSON)*, *Genereer
tekst-samenvatting* en *Kopieer naar klembord* zijn **geen onderdeel
van de gewone werkflow**. Ze leven nu onder een ingeklapt
`<details class="rv-tech">` blok met titel
**`Technische export voor beheer (alleen openen als beheer hierom
vraagt)`**. De eerste regel binnenin luidt letterlijk:

> **Gebruik de technische export alleen als automatisch opslaan niet
> werkt en beheer hierom vraagt.**

Daaronder staat de aanvullende waarschuwing dat deze knoppen alleen
een audit-bestand voor archief of debug maken — er wordt niets
automatisch in de Sheet geschreven.

Knoppen binnen het blok (role-based labels):

- **`Kopieer technische audit-export`** — bouwt JSON en zet die op je
  klembord.
- **`Download auditbestand (JSON)`** — bouwt JSON en biedt een
  lokaal `.json`-bestand aan (browser-only `Blob`/`URL.createObjectURL`,
  geen netwerk).
- **`Kopieer tekstsamenvatting voor beheer`** — bouwt de tekstvariant
  en zet die op je klembord.

Onder de knoppen staat dezelfde drie-regel instructieblok
(*wat wel / wat níet / wat jij hierna doet*).

### Welke informatie de export bevat

Twee samenvatting-formaten:

- **Tekst-samenvatting (hoofdknop output)** — leesbaar regel-per-veld,
  prettig om in een Sheet-cel te plakken.
- **JSON (technische export, fallback)** — vlak object dat beheer
  alleen gebruikt als audit-bestand wanneer automatisch opslaan niet
  werkt en beheer hierom expliciet vraagt. Geen onderdeel van de
  gewone werkflow. Sleutels:
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
    "warning": "Validatie-only fallback-export voor beheer. Bewerkingen vormen alleen een publicatievoorstel — de originele inzending (original_reference) blijft de bron. Geen auto-publicatie. Normale werkflow: \"Opslaan in redactietabel\" schrijft automatisch naar LAB_Redactie_Reviews + LAB_Workflow_Events. Deze export alleen gebruiken als automatisch opslaan niet werkt en beheer hierom vraagt. Directory_Master niet aanpassen.",
    "contact_disclosed": false
  }
  ```

  > De `original_reference` blok is altijd aanwezig (ook als er geen
  > bewerkingen zijn gemaakt) en is een bevroren kopie van de submitted
  > velden. Het `edited_publication_proposal`-blok is altijd aanwezig en
  > is óf identiek aan de bron (bij geen wijzigingen) óf een door
  > redactie aangepaste versie. `changed_fields` somt op welke
  > proposal-velden afwijken.

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
| Leesbaar review-formulier (deze pagina) | Ja, LAB-mode laadt echte rijen |
| Terug-schrijven van redactiebeslissing naar Sheet | **Ja — `Opslaan in redactietabel` schrijft append-only naar `LAB_Redactie_Reviews` + `LAB_Workflow_Events`. Géén kopiëren/plakken in de gewone werkflow.** |
| Wijziging van originele intake-rij | **Nee** — origineel blijft staan; redactiebeslissing leeft alleen in `LAB_Redactie_Reviews` |
| Aanpassing aan `Directory_Master` | **Nee — hard-deny op Cloudflare en in Apps Script** |
| Promotie naar editorial draft / directory candidate | Nee — handmatig via `scripts/lab_promote/cli`, alleen na akkoord in Sheet |
| Publicatie naar live | Nee — alleen via reguliere PR-merge na expliciete approval |

## Zichtbare 5-stappen redactie-workflow

Bovenaan de pagina staat een gele/grijze panel met de vaste volgorde
die elke inzending doorloopt. De labels matchen 1-op-1 met de
process_step / review_status keuzes in het formulier:

1. **Ontvangen** — alleen lezen en controleren. Niet bewerken,
   niet beantwoorden. *(process_step: `binnengekomen`)*
2. **In redactie** — tekst aanpassen in de redactieversie. De
   originele inzending blijft staan. *(process_step: `in_review`)*
3. **Controle nodig** — bron, contact of inhoud laten controleren
   voordat je verder gaat. *(process_step: `wachten_op_indiener`,
   review_status: `pending_clarification`)*
4. **Goedgekeurd voor concept** — klaar om lab-draft of
   directory-candidate te maken via beheer.
   *(process_step: `klaar_voor_akkoord` / `akkoord_voor_promote`,
   review_status: `approved_for_*`)*
5. **Afgewezen / geparkeerd** — niet verder verwerken. Reden in
   review-notities. *(process_step: `afgewezen` / `gearchiveerd`,
   review_status: `rejected`)*

## Regels bij bewerken (zichtbaar naast de invoervelden)

In edit-mode staat naast de bewerkbare velden een rood-roze
*Regels bij bewerken* blok:

- *Wijzig hier alleen de redactieversie, niet de originele inzending.*
- *Gebruik geen persoonlijke contactgegevens in publicatietekst.*
- *Bij twijfel: zet de status op “Controle nodig” en laat een collega
  meelezen.*

## Aanbevolen redactie-flow (nieuwe UX)

1. Open `redactie-validation.html` op de Cloudflare Pages branch-preview.
2. Lees de **5-stappen workflow** bovenaan en bepaal in welke stap
   de huidige inzending zit.
3. Selecteer de inzending uit de lijst (gefilterd op regio of type indien nodig).
4. Lees de samenvatting en velden in het rechterpaneel.
5. (Optioneel) Open **Bewerken — stel redactieversie op** om een
   publicatievoorstel te maken. Volg de *Regels bij bewerken*; de
   originele inzending blijft read-only.
6. Vul procesgang, status, reminder/checkvraag, volgende actie,
   assigned_to, deadline en review-notities in.
7. Klik op de hoofdknop:
   - in sample-mode heet die **`Maak testvoorbeeld — niets wordt
     opgeslagen`** en genereert alleen een lokaal voorbeeld;
   - in LAB-mode heet die **`Opslaan in redactietabel`** en POST't
     naar `/api/redactie-review-update`. Bij succes verschijnt
     onder de knop een groene banner *Opgeslagen in redactietabel*
     met de toegekende `review_id`, de naam van de tab waar geschreven
     is en de bevestiging dat originele inzending en
     `Directory_Master` ongewijzigd zijn.
   In geen enkel geval is er kopiëren of plakken nodig in de gewone
   werkflow; er wordt nooit gemaild en er is geen automatische
   publicatie.
8. Alleen als de banner *Opslaan mislukt* of *Niet opgeslagen* toont
   en beheer expliciet om een audit-bestand vraagt: open
   **Technische export voor beheer** (ingeklapt) en kies daar
   *Kopieer technische audit-export*, *Download auditbestand (JSON)*
   of *Kopieer tekstsamenvatting voor beheer*. Letterlijke
   instructie binnenin: *"Gebruik de technische export alleen als
   automatisch opslaan niet werkt en beheer hierom vraagt."*
9. Pas daarna mag de lab-promotion pipeline lopen voor goedgekeurde
   rijen.

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

## Activatiestappen — overgang van sample naar echte LAB-save

> Geen van de stappen wordt automatisch uitgevoerd. Wouter zet de
> env vars op het Cloudflare Pages **preview** project, nooit op
> productie. De Apps Script wordt onder `office@esrf.net` gedraaid,
> nooit onder `ai.agent.wm@gmail.com`.

### Activatie-checklist (één keer per preview-project)

- [ ] Apps Script onder `office@esrf.net` gedeployed met
  `docs/apps-script-redactie-review-webhook.gs` als bron en
  `docs/appsscript.redactie-review.json` als manifest
  (Spreadsheet-only OAuth scope).
- [ ] Script Properties gezet: `REDACTIE_REVIEW_WEBHOOK_SECRET`
  (≥ 32 char, sterk random), `SHEET_ID`. Geen `MAIL_*` /
  `NOTIFY_*` properties.
- [ ] `__authorizeSpreadsheetAccessOnly` gerund — OAuth consent
  toont uitsluitend `https://www.googleapis.com/auth/spreadsheets`.
- [ ] `__setupLabReviewTabsMaybe` gerund —
  `LAB_Redactie_Reviews` bestaat met veilige kolomkoppen.
- [ ] Cloudflare Pages **preview** env vars gezet:
  `REDACTIE_REVIEW_ACCESS_CODE` (16+ char), `REDACTIE_REVIEW_WEBHOOK_URL`
  (Apps Script `/exec`), `REDACTIE_REVIEW_WEBHOOK_SECRET` (zelfde
  als Script Property), `REDACTIE_REVIEW_WRITE_ENABLED=true`.
  *Productie krijgt deze vars niet.*
- [ ] Eén read-test op de preview: `mode: "lab"` + echte rijen.
- [ ] Eén save-test op de preview: groene banner *Opgeslagen in
  redactietabel*, één extra rij in `LAB_Redactie_Reviews`, één extra
  rij in `LAB_Workflow_Events`, origineel ongewijzigd,
  `Directory_Master` ongewijzigd.

### Niet-technische stroom (zo komt LAB-data in beeld)

```
   Drive-spreadsheet
   (LAB_Intake_Submissions / LAB_Editorial_Intake)
            │
            │  doPost (Sheets-only OAuth, shared secret)
            ▼
   Apps Script Web App
   docs/apps-script-redactie-review-webhook.gs
            │
            │  POST /exec  (REDACTIE_REVIEW_WEBHOOK_URL)
            │  body { shared_secret, action, ... }
            ▼
   Cloudflare Pages Function
   /api/redactie-review  (preview-only, access-code-gated)
            │
            │  fetch  (origin allowlist, contact stripped)
            ▼
   redactie-validation.html  (LAB-mode of sample, geen kopieer-stap)
            │
            │  klik "Opslaan in redactietabel"
            ▼
   /api/redactie-review-update  (preview-only, 4-gate activatie)
            │
            │  doPost (action: submit_review_update, shared_secret)
            ▼
   LAB_Redactie_Reviews + LAB_Workflow_Events   (append-only, audit-spoor)

   ── Directory_Master wordt nooit aangeraakt ──
   ── Originele inzending blijft staan in intake-tab ──
   ── Geen automatische publicatie ──
```

### Apps Script — bron en manifest

De referentie-implementatie staat in dit repo en is **bron**, geen
deployment:

- `docs/apps-script-redactie-review-webhook.gs` — `doPost` only,
  geen `MailApp` / `GmailApp` / `UrlFetchApp`. Leest uitsluitend
  `LAB_Intake_Submissions`, `LAB_Editorial_Intake` (en optioneel
  `LAB_Place_Candidates`). Schrijft uitsluitend append-only naar
  `LAB_Redactie_Reviews` en `LAB_Workflow_Events`. Hard deny-list voor
  `Directory_Master`.
- `docs/appsscript.redactie-review.json` — manifest met *alleen*
  `https://www.googleapis.com/auth/spreadsheets` als oauthScope.

### Stappen

1. Maak een **nieuw, gescheiden** Apps Script-project onder
   `office@esrf.net`. Geen hergebruik van het intake-project.
2. Plak de inhoud van `docs/apps-script-redactie-review-webhook.gs`
   als `Code.gs`.
3. Project Settings → vink "Show appsscript.json manifest file in
   editor" aan → plak `docs/appsscript.redactie-review.json` als
   `appsscript.json`. Dit pint de OAuth-scope op spreadsheets-only.
4. Project Settings → Script Properties:
   - `REDACTIE_REVIEW_WEBHOOK_SECRET` → een nieuwe, sterke random
     string (≥ 32 karakters). Niet committen, niet delen buiten Wouter
     en de Cloudflare Pages env vars.
   - `SHEET_ID` → `1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g`.
   *Zet géén* `NOTIFY_*`, `MAIL_*` of andere mail-properties.
5. Run **`__authorizeSpreadsheetAccessOnly`** vanuit de Apps Script-
   editor. Het OAuth consent-scherm moet uitsluitend de scope
   `https://www.googleapis.com/auth/spreadsheets` tonen. Als
   `script.send_mail`, `gmail.*`, `drive.*` of
   `script.external_request` opduikt: **STOP** en herchek dat de bron
   ongewijzigd is overgenomen.
6. Run **`__setupLabReviewTabsMaybe`** om `LAB_Redactie_Reviews` met
   veilige kolomkoppen aan te maken (idempotent — niet-destructief).
   `LAB_Workflow_Events` moet al bestaan vanuit het intake-project; zo
   niet, fail luid en herstel via het intake-project eerst.
7. Deploy → New deployment → "Web app". Execute as: *Me*
   (office@esrf.net). Who has access: *Anyone with the link*.
8. Cloudflare Pages → **preview** project (niet productie!) → Settings
   → Environment variables:
   - `REDACTIE_REVIEW_ACCESS_CODE` → een nieuwe, voldoende lange string
     (16+ karakters; alleen door redactie gedeeld).
   - `REDACTIE_REVIEW_WEBHOOK_URL` → de `/exec` URL uit stap 7.
   - `REDACTIE_REVIEW_WEBHOOK_SECRET` → exact dezelfde string als de
     Apps Script Script Property in stap 4.
   - `REDACTIE_REVIEW_WRITE_ENABLED=true` — pas zetten **nadat** de
     read-test (stap 9) groen is en je één save-test (stap 10) hebt
     gedraaid.
9. Deploy preview, open `/redactie-validation.html`, voer de access
   code in. Verwacht: `LAB-MODE — live`, echte LAB-rijen verschijnen,
   contact-velden ontbreken (tenzij later expliciet `include_contact`
   wordt aangezet). De primaire knop heet nu
   **`Opslaan in redactietabel`**.
10. **Eén save-test:** kies een lab-fixture-rij, vul status/herinnering/
    deadline in en klik op **`Opslaan in redactietabel`**. Verwacht:
    groene banner *Opgeslagen in redactietabel* met een verse
    `review_id` en bevestiging dat naar `LAB_Redactie_Reviews` is
    geschreven. Open vervolgens de Drive-spreadsheet en controleer:
    één nieuwe rij in `LAB_Redactie_Reviews`, één nieuwe rij in
    `LAB_Workflow_Events`, originele rij in
    `LAB_Intake_Submissions`/`LAB_Editorial_Intake` ongewijzigd,
    `Directory_Master` ongewijzigd, geen e-mail verzonden.

### Eén keer testen — read

Vanaf de Cloudflare preview-branch, met access code geconfigureerd:

```bash
curl -sS -H 'content-type: application/json' \
     -H "origin: $PREVIEW_ORIGIN" \
     "$PREVIEW_ORIGIN/api/redactie-review" \
     --data-raw "{\"access_code\":\"$REDACTIE_REVIEW_ACCESS_CODE\"}" \
  | jq '{ok, mode, n: (.records|length), first: .records[0].submission_id}'
```

Verwacht:
- `ok: true`
- `mode: "lab"`
- `n` ≥ 1 (echte LAB-rijen, niet `sub_lab_demo_*`)
- `first` is een echte submission_id uit de Sheet.

### Eén keer testen — save (live, preview-only)

> Vereist: alle vier de gates passen (`REDACTIE_REVIEW_WRITE_ENABLED=true`,
> webhook URL/secret gezet, geldige access code).

```bash
curl -sS -H 'content-type: application/json' \
     -H "origin: $PREVIEW_ORIGIN" \
     "$PREVIEW_ORIGIN/api/redactie-review-update" \
     --data-raw "$(cat <<EOF
{
  "access_code": "$REDACTIE_REVIEW_ACCESS_CODE",
  "submission_id": "<echte submission_id>",
  "record_type": "org",
  "target_tab": "LAB_Redactie_Reviews",
  "review_update": {
    "process_step": "in_review",
    "review_status": "in_review",
    "next_required_action": "Verifieer regio + sector",
    "assigned_to": "WM",
    "due_date": "2026-05-10"
  }
}
EOF
)" \
  | jq '{ok, mode, save_status, save_message, saved_to}'
```

Verwacht:
- `ok: true`
- `mode: "lab"`
- `save_status: "saved"`
- `save_message`: bevestigt opslaan in `LAB_Redactie_Reviews` +
  gebeurtenis in `LAB_Workflow_Events`, originele inzending
  ongewijzigd, `Directory_Master` ongewijzigd.
- `saved_to.review_tab: "LAB_Redactie_Reviews"`,
  `saved_to.events_tab: "LAB_Workflow_Events"`,
  `saved_to.review_id` aanwezig.

Als één van de gates faalt: `save_status: "not_saved"` met
`save_message: "Opslaan is nog niet actief; er wordt niets opgeslagen."`
en een `live_write_blocked_reason` die exact noemt welke env var
ontbreekt. Bij upstream-fouten: `save_status: "failed"` met
`upstream_error`.

> Het Apps Script `doPost` heeft óók een `dry_run_update`-actie zodat
> Wouter het zonder Cloudflare-laag rechtstreeks kan testen. Stuur in
> dat geval `{"action":"dry_run_update","shared_secret":"…", … }` direct
> naar `/exec` — er wordt niets weggeschreven.

### Eerste geslaagde live save — 2026-04-26 22:24 CEST

Op 2026-04-26 rond 22:24 CEST is de eerste echte redactie review-save
gelukt op de Cloudflare Pages **Preview**. Productie is **niet**
aangeraakt.

- **Preview-omgeving:** branch
  `test/regional-editorial-contributor-intake`,
  `https://test-regional-editorial-cont.esrf-clean.pages.dev/redactie-validation.html`.
- **Toegangscode gebruikt:** `ESRF-Redactie-D86E91`.
- **Activatie-toggle:** `REDACTIE_REVIEW_WRITE_ENABLED=true` is
  uitsluitend op het Preview-project gezet. Productie is niet
  geraakt; daar geeft de Cloudflare Pages Function nog steeds 404.
- **Read-stap:** de pagina laadde **9 echte LAB-rijen**
  (`mode: "lab"`).
- **Save-stap:** één review-save uitgevoerd voor inzending
  `sub_lab_20260425_1825_sheet`. Backend-respons:
  - `ok: true`
  - `mode: "lab"`
  - `dry_run: false`
  - `live_write_ready: true`
  - `save_status: "saved"`
  - `saved_to.review_tab: "LAB_Redactie_Reviews"`
  - `saved_to.events_tab: "LAB_Workflow_Events"`
  - `saved_to.review_id: "rev_20260426202343218_224302"`
  - `rows_written: 2`
  - `directory_master_touched: false`
  - `automatic_publication: false`
- **In de UI:** groene banner **`OPGESLAGEN IN DE REDACTIETABEL`**.
  De originele inzending bleef ongewijzigd, `Directory_Master` werd
  niet aangeraakt, er werd niets op de website gepubliceerd en er is
  geen e-mail verstuurd.

Dit bevestigt dat alle vier de gates passen op Preview en dat de
end-to-end keten — Cloudflare Pages Function → Apps Script Web App
(`office@esrf.net`) → `LAB_Redactie_Reviews` + `LAB_Workflow_Events` —
werkt zoals beschreven. Het bewijs is ook vastgelegd in
`validation-lab.json` →
`redactie-validation-form` → `testEvidence.liveSaveEvidence`.

### Live-save uitschakelen (incident-respons)

Verwijder of zet `REDACTIE_REVIEW_WRITE_ENABLED` op iets anders dan
`true` op het preview-project. De API valt onmiddellijk terug op
`save_status: "not_saved"` met *"Opslaan is nog niet actief; er
wordt niets opgeslagen."* — zonder code-deploy. De redactiepagina
gaat dan vanzelf terug naar het sample/fallback-pad.

## Veiligheidsregels die de endpoints afdwingen

- `target_tab` moet starten met `LAB_` en in `ALLOWED_REVIEW_TARGET_TABS`
  staan (`LAB_Intake_Submissions`, `LAB_Editorial_Intake`,
  `LAB_Workflow_Events`, `LAB_Redactie_Reviews`).
- `Directory_Master` staat in `forbidden_targets` — elke poging om die
  als target te gebruiken faalt server-side, zowel Cloudflare-side
  als in Apps Script.
- Process step en review status worden gevalideerd tegen de
  documentatie-vaste set; niet-gedocumenteerde keuzes geven 400.
- Contact en `raw_payload_json` worden uit elke response, payload én
  outbound webhook-body gestript. `include_contact` op de save-route is
  hard-coded `false` — het frontend kan PII niet smokkelen.
- Live save is gegate door vier env vars (toegangscode, webhook URL,
  webhook secret, write-enabled toggle). Eén ervan wegnemen schakelt
  live save direct uit zonder code-deploy.
- Cloudflare Pages Functions returneren 404 in productie — preview-only.
