# CI/CD Workflows — esrfdev/ESRF-clean

Dit document beschrijft alle GitHub Actions workflows die in deze repository draaien en wat te doen bij een faalmelding.

## Overzicht

| Workflow | Doel | Schema | Bij falen |
|----------|------|--------|-----------|
| **Daily Backup** | Dagelijkse ZIP-backup van de site als GitHub Release | Dagelijks 04:00 CEST | Eenmalige fout meestal vanzelf opgelost de volgende run |
| **Validate counts** | Controleert of de getallen op de site (bijv. "1,931 organisations across 30 countries") kloppen met de databronnen | Bij elke push naar main | Meestal opgelost door een `chore(counts): refresh generated_at timestamp` commit; check of er direct erna een succesvolle run is |
| **Validate editorial i18n** | Controleert of vertalingen (NL/EN) consistent zijn op alle pagina's | Bij elke push naar main | Bekijk de logs — doorgaans een ontbrekende vertaalsleutel |
| **Refresh dispatch (news-data.json)** | Ververst de news feed | Periodiek + handmatig | Meestal een tijdelijk probleem met een externe nieuwsbron; volgt vanzelf |
| **Publish editorial** | Publiceert nieuwe artikelen vanuit de editorial pipeline | Bij content push | Check of alle frontmatter velden correct zijn |
| **Events** | Verwerkt events-updates | Bij events push | Check of de events JSON valid is |

## Wat te doen bij een GitHub e-mailmelding "Run failed"

1. **Niet panikeren** — veel fouten worden binnen minuten automatisch opgelost door een follow-up commit.
2. **Check de Actions-pagina**: [github.com/esrfdev/ESRF-clean/actions](https://github.com/esrfdev/ESRF-clean/actions)
3. Kijk of er **direct na de gefaalde run een succesvolle run is** met dezelfde of een gerelateerde commit message.
4. Als de laatste run nog steeds rood is: vraag de operationeel directeur om de logs te bekijken.

## Veelvoorkomende patronen

- **"Validate counts: All jobs have failed"** → meestal opgelost door volgende commit met `chore(counts): refresh generated_at timestamp`
- **"Daily Backup failed"** → check of GitHub Actions tijdelijke storing had; volgende run draait vanzelf weer
- **"Validate editorial i18n failed"** → ontbrekende vertaling of inconsistente i18n-sleutel

## Live status

- Daily Backup: actief, draait elke nacht 04:00 CEST
- Alle backups beschikbaar op: [github.com/esrfdev/ESRF-clean/releases](https://github.com/esrfdev/ESRF-clean/releases)
- Workflow logs: [github.com/esrfdev/ESRF-clean/actions](https://github.com/esrfdev/ESRF-clean/actions)
