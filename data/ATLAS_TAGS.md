# Atlas tags — safety rules for maintainers

The Atlas (`/map.html`) and Directory (`/directory.html`) classify every
organisation with one **primary sector** and — currently for the
`Emergency & Crisis Response` sector only — a small set of **secondary
tags**. Tags are a discovery aid for the public; they are not an
operational-readiness register. These rules are what keeps them safe.

Runtime enforcement lives in `scripts/validate_atlas_data.py`. Run it
before every commit that touches `companies_extracted.json`:

```bash
python3 scripts/validate_atlas_data.py
```

## What tags may describe

Tags describe **broad public functions** of an organisation:

- The type of public-facing work it does (food aid, psychosocial support,
  search & rescue, civil protection, shelter).
- Its public identity as seen on its own website, annual report, or
  Wikipedia entry.

That is all.

## What tags and org records must never contain

The Atlas is public. Do not publish anything that would help a hostile
actor target a node, plan a cascade failure, or intercept people.

**Forbidden fields** (rejected by the validator — see `FORBIDDEN_FIELDS`):

- `capacity`, `capacity_beds`, `capacity_vehicles`, `inventory`,
  `stockpile`, `stockpile_count`
- `roster`, `deployment_roster`, `deployment_status`, `readiness`,
  `readiness_level`, `on_call`
- `volunteer_count`, `staff_count`, `personnel_count`
- `private_phone`, `private_email`, `contact_person`, `contact_chain`
- `critical_dependency`, `dependencies`, `vulnerability`,
  `vulnerabilities`, `single_point_of_failure`, `facility_access`,
  `access_codes`

**Forbidden wording** in `description_en` (regex-detected; see
`SENSITIVE_TEXT_PATTERNS`):

- Operational-intel phrases: "deployment roster", "on-call roster",
  "stockpile count", "readiness level", "single point of failure",
  "critical dependency", "key vulnerability", "access code".
- Exact capacity phrases: "holds 200 cots", "stockpile of 50
  ventilators", "capacity for 80 ambulances", etc. Model names like
  `Mi-24 helicopters` are fine — numbers in the sense of *how many this
  organisation has on standby* are not.
- Private phone numbers (E.164 long form) or private email addresses.

Short public numbers like `112`, `113`, `116 000` are not phone numbers
in this sense — they are public helplines and may be mentioned.

## Safe vs unsafe examples

| Safe | Unsafe |
| --- | --- |
| "National federation of Dutch food banks providing emergency food and basic needs through local volunteers." | "Dutch food bank holds 12 000 emergency meal parcels at warehouse X and dispatches within 4 hours." |
| "UK charity operating a 24/7 crisis helpline." | "UK helpline with 300 active counsellors; on-call roster updated weekly." |
| "Italian fire service providing civil protection and search & rescue." | "Italian fire service — 27 engines stationed at depot Y; single point of failure for Liguria." |
| "Tag: `Shelter & evacuation`." | "Tag: `evacuation-cap-500`." (Tags must stay broad categories, not parameters.) |

## Adding a new sector's tag taxonomy

If and when we extend secondary tags beyond Emergency & Crisis Response,
apply the same design:

1. **Broad capability descriptors only** — each tag is a public-facing
   theme, not a precision attribute. Target ~8–12 tags per sector. More
   than that usually means the tags are getting operational.
2. **No operational precision** — do not add tags that expose exact
   capacities, tiered readiness, certification levels that imply
   capability-to-respond, inventories, dependency graphs, or facility
   types that map to physical access (e.g. `24h-armoury`,
   `fuel-depot-primary`).
3. **Test against the "clustering question"**: if a hostile user
   selected this tag plus a country, would the resulting cluster expose
   something not already public? If yes, the tag is too narrow.
4. **Register tags in the validator** — extend `CANONICAL_TAGS` in
   `scripts/validate_atlas_data.py` and add `tag.*` i18n keys in
   `i18n/en.json` and `i18n/nl.json` first. The validator fails the
   build if an org carries an unknown tag.
5. **Do not auto-generate tags from non-public sources.** Every tag
   applied to an org should be derivable from that org's own public
   identity.

## Visitor-facing guidance

Both the Directory and the Atlas surface a short collapsed "About these
tags" note when the Emergency tag bar is visible. The copy lives under
the `atlas_safety` i18n key. Tone is calm and factual — not alarmist.
If you change the i18n, keep the same three beats:

1. Tags describe broad public function, not operational readiness.
2. Use them for discovery, not to infer emergency capability.
3. For urgent help, use official emergency channels (112 in EU).

## Review checklist before merging any change that touches tags or orgs

- [ ] `python3 scripts/validate_atlas_data.py` passes.
- [ ] No new forbidden fields or forbidden wording (validator confirms).
- [ ] Any new tag is broad and public-facing, not an operational
      attribute.
- [ ] i18n keys for any new tag exist in both `en.json` and `nl.json`.
- [ ] No private contact info (personal phone/email) anywhere.
- [ ] Visitor-facing copy, if changed, still names an **official
      emergency channel** (112 or equivalent) as the correct route for
      urgent help.
