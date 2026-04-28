# Redactionele toevoeging — workflow

Dit document beschrijft hoe de ESRF-redactie een nieuwe organisatie kan
toevoegen via het interne formulier `redactie-validation.html`, en hoe
de governance rond `Directory_Master` is geborgd.

## URL

| Omgeving       | URL                                                                                        |
|----------------|--------------------------------------------------------------------------------------------|
| Lab / preview  | `https://test-regional-editorial-cont.esrf-clean.pages.dev/redactie-validation.html?mode=editorial_add_org` |
| Productie      | `https://esrf.net/redactie-validation.html?mode=editorial_add_org`                         |

De pagina is `noindex,nofollow,noarchive` (zowel via `<meta name="robots">`
als via de `X-Robots-Tag`-header in `_headers`) — uitsluitend voor
intern gebruik door de redactie.

## Modus: `editorial_add_org`

Bedoeld voor een redacteur die een organisatie toevoegt op basis van
**publieke bronnen**. De organisatie heeft niet zelf ingediend.

### Velden

| Veld                          | Verplicht | Toelichting                                                                  |
|-------------------------------|-----------|------------------------------------------------------------------------------|
| `organisation_name`           | ja        | Officiële naam zoals op de website.                                          |
| `alternate_name`              | nee       | Merknaam / afkorting.                                                        |
| `website`                     | ja        | `https://…`                                                                  |
| `source_url`                  | ja        | Publieke bron op basis waarvan je toevoegt (officiële site, krant, register).|
| `country`                     | ja        | Landnaam.                                                                    |
| `country_code`                | nee       | ISO-3166 alpha-2 (NL, BE, DE, …) — laat leeg bij twijfel.                    |
| `city`                        | nee       | Stad.                                                                        |
| `sector`                      | ja        | Bijv. kritieke-infrastructuur, overheid, gezondheidszorg.                    |
| `nace_code`                   | nee       | NACE Rev.2, bijv. `84.25` of `M.71.1`.                                       |
| `description_en`              | ja        | Korte Engelse omschrijving (≥ 20 tekens).                                    |
| `additional_tags`             | nee       | Komma-gescheiden secundaire tags.                                            |
| `contact_email`               | nee       | Alleen als bekend uit publieke bron — géén privé-adressen.                   |
| `internal_note`               | nee       | Interne redactienotitie, niet zichtbaar op de website.                       |
| `editor.name`, `editor.email` | ja        | Wie heeft toegevoegd.                                                        |
| `editorial_acknowledgement`   | ja        | Vinkje: "redactionele toevoeging op basis van publieke bron, geen impersonation". |
| `impersonation_disclaimer`    | impliciet | Backend dwingt af dat dit `true` is (jij doet je niet voor als de organisatie). |

## Backend

Het formulier POST'st naar de Cloudflare Pages Function
`functions/api/lab-intake.js`. Validatie + sanitisatie gebeurt in
`validateAndSanitizeLab()`. Honeypot (`company_website_hp`) en een
form-fill timer (≥ 1500 ms) zijn actief.

### Sheet-targets — alleen LAB-tabs

De handler schrijft uitsluitend naar LAB-prefix-tabs in de centrale
spreadsheet (`1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g`):

| Tab                       | Inhoud                                                                  |
|---------------------------|-------------------------------------------------------------------------|
| `LAB_Intake_Submissions`  | Eén rij per inzending (`submission_id`, `editor_*`, alle organisatievelden, `review_status=nieuw`). |
| `LAB_Redactie_Reviews`    | Eén rij per (initiële) review — start op `editorial_status=nieuw`, decisions worden later toegevoegd. |
| `LAB_Place_Candidates`    | Eén rij wanneer `city` + `country_code` ingevuld zijn maar de plaats nog niet in de lookup-lijst staat. |
| `LAB_Workflow_Events`     | Eén rij `editorial_add_org_received` met `status_to=nieuw`.             |
| `LAB_Backend_Log`         | Eén regel per request (`endpoint=/api/lab-intake`).                      |

`Directory_Master` staat expliciet in `forbidden_targets` en wordt
defensief afgewezen via `assertLabSheetPayloadSafe()` voordat ook maar
één byte naar de Apps Script-webhook gaat. Iedere inzending zet
`no_auto_publication=true`, `directory_master_touched=false`,
`automatic_publication=false`.

### Statussen

`LAB_Redactie_Reviews.editorial_status` gebruikt de bestaande vocabulair:

```
nieuw
in beoordeling
verduidelijking nodig
klaar voor akkoord
goedgekeurd voor websitevoorstel
afgewezen
gepubliceerd
```

(Constante `VALID_REDACTIE_STATUSES` in `lab-intake.js`.)

### Duplicate-check

De UI doet een best-effort check tegen `companies_extracted.json` op
naam (genormaliseerd) of hostname-match. Bij een treffer krijgt de
redacteur een bevestigingsdialoog en kan hij/zij bewust doorgaan. De
backend ontvangt deze treffers in `existing_matches` en logt ze in
`duplicate_hints`. De redactie blijft eindverantwoordelijk; de
controle is informatief, geen blokkade.

## Governance — Directory_Master

`Directory_Master` mag **nooit** automatisch gewijzigd worden door
formulieren of scripts. De rolloutketen is:

1. Inzending → `LAB_Intake_Submissions` + `LAB_Redactie_Reviews`
   (`status=nieuw`).
2. Redactie triage → `in beoordeling` → eventueel
   `verduidelijking nodig`.
3. Redactiebesluit → `klaar voor akkoord`.
4. Preview-deploy van het websitevoorstel.
5. Akkoord van Wouter → `goedgekeurd voor websitevoorstel`.
6. Handmatige rollout naar `Directory_Master` door de operationeel
   beheerder → status `gepubliceerd`.

Stappen 1-5 vinden plaats in LAB-tabs en in de preview-omgeving.
Alleen stap 6 raakt `Directory_Master`, en die stap wordt nooit
geautomatiseerd via dit formulier.

## In-app help

`redactie-validation.html` toont:

- een gele waarschuwingsbox bovenaan ("redactionele toevoeging — niet
  voordoen als de organisatie"),
- een bevestigingsvinkje dat afdwingt dat de redacteur dit erkent,
- een governance-blokje dat de status-flow naar `Directory_Master`
  expliciet uitlegt.

Voor publieke inzendingen verwijst de internal-banner door naar
`/submit-news.html` (de bestaande publieke flow → `/api/intake` →
`Intake_Submissions`/`Editorial_Intake`/etc., zonder LAB-prefix).

## Configuratie

Productie verwacht twee Cloudflare Pages-environment-variabelen:

| Variable                          | Beschrijving                                                                  |
|-----------------------------------|-------------------------------------------------------------------------------|
| `LAB_INTAKE_SHEET_WEBHOOK_URL`    | Apps Script webhook die naar de LAB-tabs schrijft.                            |
| `LAB_INTAKE_SHEET_WEBHOOK_SECRET` | Gedeeld geheim, meegestuurd in `x-esrf-intake-secret` + body `shared_secret`. |

Aliassen `INTAKE_SHEET_WEBHOOK_URL` / `SHEETS_WEBHOOK_URL` worden
geaccepteerd, maar in productie hoort het lab-flow zijn eigen webhook
te hebben zodat de Apps Script duidelijk weet dat hij naar
LAB-tabs moet schrijven.

Zonder webhook-config retourneert het formulier 503 met
`auto_submit_unavailable: true` — geen partiële state.

## Tests

`functions/api/lab-intake.test.mjs` dekt:

- alle verplichte velden,
- de honeypot + timer,
- de `LAB_`-tab-prefix-bewaking,
- afwijzing van `Directory_Master` in rows,
- de POST-handler end-to-end met een mock-webhook,
- duplicate-hints en place-candidate-conditie.

Run: `node functions/api/lab-intake.test.mjs`. De bestaande
`functions/api/intake.test.mjs` blijft groen — dat dekt de publieke
`/api/intake`-flow en valideert (onder meer) dat de productie
SHEET_TARGETS géén `LAB_` prefix hebben.

## Drive-documentatie

Dit `EDITORIAL-WORKFLOW.md` is de bron van waarheid in de repo. De
bestaande Drive-documentatie v0.5 die het lab-formulier en de
spreadsheet beschrijft, mag verwijzen naar dit document maar moet
nog wel separaat geüpdatet worden door de redactie zodat de
LAB-tab-namen, statussen en de exacte URL met `?mode=editorial_add_org`
ook daar consistent zijn met de implementatie.
