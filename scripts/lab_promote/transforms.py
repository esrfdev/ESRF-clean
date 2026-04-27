"""Pure transforms from LAB_* row dicts to local artefacts.

These functions are deliberately pure (no I/O, no env access) so the
test suite can feed in fixture rows and assert on the produced output.
The CLI scripts in :mod:`scripts.lab_promote.cli` are responsible for
applying guards and writing files.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Mapping

from .guards import (
    PII_KEYS,
    PromotionGuardError,
    assert_no_pii_in_output,
    safe_slug,
)


# Fields stripped from any structure copied into a public preview artefact.
# Editorial body lives only in LAB_Editorial_Intake.body_md_or_url and is
# re-rendered into the draft body — not into front-matter.
PUBLIC_PII_STRIPPED_FIELDS = frozenset(PII_KEYS) | frozenset({
    "contact_name",
    "contact_role",
    "notes_submitter",
})


def _today_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _strip_pii(d: Mapping[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if k not in PUBLIC_PII_STRIPPED_FIELDS}


def editorial_row_to_draft_markdown(row: Mapping[str, Any]) -> tuple[str, str]:
    """Return ``(filename, markdown_text)`` for a LAB_Editorial_Intake row.

    The draft is emitted with ``status: lab-draft`` and explicitly marks
    that no automatic i18n / live publication is permitted.
    """
    title = str(row.get("title", "")).strip() or "untitled-lab-draft"
    editorial_id = str(row.get("editorial_id", "")).strip()
    submission_id = str(row.get("submission_id", "")).strip()
    region = str(row.get("region", "")).strip()
    country = str(row.get("country_code", "")).strip()
    summary = str(row.get("summary", "")).strip()
    body = str(row.get("body_md_or_url", "")).strip()
    received_at = str(row.get("received_at", "")).strip() or _today_iso()
    review_notes = str(row.get("review_notes_internal", "")).strip()
    issue_url = str(row.get("issue_url", "")).strip()

    slug_seed = title or editorial_id or submission_id or "lab-draft"
    slug = safe_slug(f"lab-{_today_iso()}-{slug_seed}", fallback="lab-draft")
    filename = f"{slug}.md"

    front_matter = {
        "title": title,
        "slug": slug,
        "status": "lab-draft",
        "lab_environment": "TEST/VALIDATIE",
        "auto_i18n": False,
        "auto_publish": False,
        "preview_only": True,
        "date": received_at[:10] if received_at else _today_iso(),
        "region": region,
        "country_code": country,
        "lab_editorial_id": editorial_id,
        "lab_submission_id": submission_id,
        "lab_source_tab": "LAB_Editorial_Intake",
        "lab_review_notes": review_notes,
        "lab_issue_url": issue_url,
        "description": summary,
    }

    assert_no_pii_in_output(front_matter)

    yaml_lines = ["---"]
    for key, value in front_matter.items():
        yaml_lines.append(f"{key}: {_yaml_scalar(value)}")
    yaml_lines.append("---")
    yaml_lines.append("")

    body_lines = [
        f"<!-- LAB DRAFT — generated from LAB_Editorial_Intake row {editorial_id or '?'}. -->",
        "<!-- Do NOT publish from this file directly. Open a PR for redactie review. -->",
        "",
        "## Samenvatting",
        "",
        summary or "_(Geen samenvatting opgegeven.)_",
        "",
        "## Regionale invalshoek",
        "",
        body or "_(Geen body opgegeven — vul aan na redactie review.)_",
        "",
        "## Lab metadata",
        "",
        f"- Source tab: `LAB_Editorial_Intake`",
        f"- Editorial ID: `{editorial_id}`",
        f"- Submission ID: `{submission_id}`",
        f"- Region / country: `{region}` / `{country}`",
        f"- Status flag: `lab-draft` — auto i18n disabled, auto publish disabled.",
        "",
    ]

    return filename, "\n".join(yaml_lines + body_lines)


def intake_row_to_directory_candidate(row: Mapping[str, Any]) -> dict[str, Any]:
    """Return a directory/atlas candidate dict for a LAB_Intake_Submissions row.

    Only safe-to-publish fields land in the candidate. This is a STAGING
    record — the redactie reviews it via PR before any change to the
    production directory data.
    """
    safe_row = _strip_pii(dict(row))

    candidate = {
        "candidate_kind": "directory_listing",
        "lab_status": "candidate-pending-review",
        "lab_source_tab": "LAB_Intake_Submissions",
        "lab_environment": "TEST/VALIDATIE",
        "auto_promote_to_directory_master": False,
        "generated_at": _today_iso(),
        "submission_id": safe_row.get("submission_id", ""),
        "name": safe_row.get("name", ""),
        "website": safe_row.get("website", ""),
        "country_code": safe_row.get("country_code", ""),
        "country_name_local": safe_row.get("country_name_local", ""),
        "region": safe_row.get("region", ""),
        "city_raw": safe_row.get("city_raw", ""),
        "city_match_status": safe_row.get("city_match_status", ""),
        "sector_raw": safe_row.get("sector_raw", ""),
        "description_en": safe_row.get("description_en", ""),
        "review_notes_internal": safe_row.get("review_notes_internal", ""),
        "review_status": safe_row.get("review_status", ""),
        "linked_editorial_id": safe_row.get("linked_editorial_id", ""),
        "issue_url": safe_row.get("issue_url", ""),
    }

    assert_no_pii_in_output(candidate)
    return candidate


def place_row_to_candidate(row: Mapping[str, Any]) -> dict[str, Any]:
    """Return a place-addition candidate dict for a LAB_Place_Candidates row."""
    safe_row = _strip_pii(dict(row))
    candidate = {
        "candidate_kind": "place_addition",
        "lab_status": "candidate-pending-review",
        "lab_source_tab": "LAB_Place_Candidates",
        "auto_promote_to_directory_master": False,
        "generated_at": _today_iso(),
        "candidate_id": safe_row.get("candidate_id", ""),
        "city_raw": safe_row.get("city_raw", ""),
        "country_code": safe_row.get("country_code", ""),
        "region": safe_row.get("region", ""),
        "submission_count": safe_row.get("submission_count", 1),
        "suggested_match": safe_row.get("suggested_match", ""),
        "review_notes_internal": safe_row.get("review_notes_internal", ""),
    }
    assert_no_pii_in_output(candidate)
    return candidate


def merge_into_candidates_file(
    existing: Mapping[str, Any] | None, candidate: Mapping[str, Any]
) -> dict[str, Any]:
    """Merge a candidate into the on-disk staging file structure."""
    base: dict[str, Any] = {
        "schema_version": 1,
        "_comment": (
            "Lab-only staging file produced by scripts/lab_promote/. "
            "Each entry is a candidate awaiting redactie review on a "
            "GitHub branch/preview. NEVER read by production runtime."
        ),
        "lab_environment": "TEST/VALIDATIE",
        "auto_promote_to_directory_master": False,
        "candidates": [],
    }
    if existing:
        base.update({k: v for k, v in existing.items() if k != "candidates"})
        base["candidates"] = list(existing.get("candidates", []))
    # de-dupe on submission_id / candidate_id
    key_field = "submission_id" if candidate.get("submission_id") else "candidate_id"
    key = candidate.get(key_field)
    if key:
        base["candidates"] = [
            c for c in base["candidates"] if c.get(key_field) != key
        ]
    base["candidates"].append(dict(candidate))
    return base


def _yaml_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "''"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value)
    if s == "":
        return "''"
    if any(ch in s for ch in ":#\n\""):
        return json.dumps(s, ensure_ascii=False)
    return s
