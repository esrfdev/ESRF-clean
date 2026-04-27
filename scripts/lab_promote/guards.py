"""Strict guards for lab-only promotion.

Every promotion script in this package MUST call ``apply_all_guards``
before reading or writing anything. The guards refuse to run unless:

  * ``ESRF_LAB_PROMOTE=1`` is set in the environment (explicit lab opt-in).
  * The current git branch (or ``ESRF_BRANCH`` override) is NOT ``main``
    or ``master`` or ``production``.
  * The forbidden target ``Directory_Master`` does not appear in any
    target tab name passed in.
  * The row carries one of the approved ``review_status`` values.
  * Required redactie review fields are present and non-empty.

Guards raise :class:`PromotionGuardError` with a short reason on refusal.
The CLI scripts surface the message and exit non-zero.
"""

from __future__ import annotations

import os
import re
import subprocess
from typing import Iterable, Mapping


# Approved review_status values that allow a row to be promoted.
APPROVED_INTAKE_STATUSES = frozenset({
    "approved_for_candidate",
    "approved_for_directory_candidate",
    "approved_lab_promote",
})

APPROVED_EDITORIAL_STATUSES = frozenset({
    "approved_for_draft",
    "approved_for_editorial_draft",
    "approved_lab_promote",
})

# Tab names whose rows we may consume.
ALLOWED_SOURCE_TABS = frozenset({
    "LAB_Intake_Submissions",
    "LAB_Editorial_Intake",
    "LAB_Place_Candidates",
})

# Hard-blocked target tab names. Directory_Master is the production
# register and must NEVER be written by intake or promotion scripts.
FORBIDDEN_TARGET_TABS = frozenset({
    "Directory_Master",
    "directory_master",
})

# Branches on which promotion MUST refuse to run.
FORBIDDEN_BRANCHES = frozenset({"main", "master", "production", "prod"})

# PII keys that must NEVER appear in any output written to a public
# preview artefact (markdown front-matter, candidate JSON file, etc.).
PII_KEYS = frozenset({
    "contact_email", "contact_phone", "email", "phone",
    "raw_payload_json", "shared_secret",
})

# Review fields that the redactie MUST fill before a row can be promoted.
REQUIRED_REVIEW_FIELDS_INTAKE = (
    "review_status",
    "assigned_to",
    "review_notes_internal",
)

REQUIRED_REVIEW_FIELDS_EDITORIAL = (
    "editorial_status",
    "review_notes_internal",
)


class PromotionGuardError(RuntimeError):
    """Raised when a guard refuses to allow a promotion to proceed."""


def _current_branch() -> str:
    override = os.environ.get("ESRF_BRANCH")
    if override:
        return override.strip()
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            stderr=subprocess.DEVNULL,
        )
        return out.decode("utf-8").strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        return ""


def assert_lab_environment() -> None:
    """Refuse to run unless ``ESRF_LAB_PROMOTE=1`` is set."""
    flag = os.environ.get("ESRF_LAB_PROMOTE", "")
    if flag != "1":
        raise PromotionGuardError(
            "ESRF_LAB_PROMOTE is not set to 1. Lab promotion is opt-in: "
            "export ESRF_LAB_PROMOTE=1 before running. Refusing to proceed."
        )


def assert_not_main_branch() -> None:
    """Refuse to run on main / master / production branches."""
    branch = _current_branch()
    if not branch:
        # No git context available — refuse rather than silently proceed.
        raise PromotionGuardError(
            "Could not determine current git branch. Refusing to proceed. "
            "Set ESRF_BRANCH=<branch-name> if running outside git."
        )
    if branch in FORBIDDEN_BRANCHES:
        raise PromotionGuardError(
            f"Refusing to run on protected branch '{branch}'. "
            "Lab promotion is only allowed on test/* branches."
        )


def assert_target_tab_allowed(tab_name: str) -> None:
    """Refuse Directory_Master (and case-equivalents) as a target."""
    if not tab_name:
        return
    if tab_name in FORBIDDEN_TARGET_TABS:
        raise PromotionGuardError(
            f"Refusing forbidden target tab '{tab_name}'. "
            "Directory_Master is read-only in the lab pipeline."
        )
    # defence-in-depth: anything that mentions directory_master in any case
    if "directory_master" in tab_name.lower():
        raise PromotionGuardError(
            f"Refusing target tab name containing 'directory_master': '{tab_name}'."
        )


def assert_source_tab_allowed(tab_name: str) -> None:
    if tab_name not in ALLOWED_SOURCE_TABS:
        raise PromotionGuardError(
            f"Refusing unknown source tab '{tab_name}'. "
            f"Allowed: {sorted(ALLOWED_SOURCE_TABS)}"
        )


def assert_intake_row_approved(row: Mapping[str, object]) -> None:
    status = str(row.get("review_status", "")).strip()
    if status not in APPROVED_INTAKE_STATUSES:
        raise PromotionGuardError(
            f"Row review_status '{status}' is not in approved set "
            f"{sorted(APPROVED_INTAKE_STATUSES)}. Refusing."
        )
    _assert_required_fields(row, REQUIRED_REVIEW_FIELDS_INTAKE)


def assert_editorial_row_approved(row: Mapping[str, object]) -> None:
    status = str(row.get("editorial_status", "")).strip()
    if status not in APPROVED_EDITORIAL_STATUSES:
        raise PromotionGuardError(
            f"Row editorial_status '{status}' is not in approved set "
            f"{sorted(APPROVED_EDITORIAL_STATUSES)}. Refusing."
        )
    _assert_required_fields(row, REQUIRED_REVIEW_FIELDS_EDITORIAL)


def _assert_required_fields(row: Mapping[str, object], fields: Iterable[str]) -> None:
    missing = [f for f in fields if not str(row.get(f, "")).strip()]
    if missing:
        raise PromotionGuardError(
            "Missing required review fields: " + ", ".join(missing)
        )


def assert_no_pii_in_output(output: Mapping[str, object]) -> None:
    """Refuse to write any structure that still contains submitter PII keys."""
    for key in PII_KEYS:
        if key in output:
            raise PromotionGuardError(
                f"Output contains forbidden PII key '{key}'. Refusing to write."
            )


def apply_all_guards(
    *,
    source_tab: str,
    target_tab: str,
    row: Mapping[str, object],
    row_kind: str,
) -> None:
    """One-shot guard applied at the start of every promotion call.

    ``row_kind`` is either ``'intake'`` or ``'editorial'``.
    """
    assert_lab_environment()
    assert_not_main_branch()
    assert_source_tab_allowed(source_tab)
    assert_target_tab_allowed(target_tab)
    if row_kind == "intake":
        assert_intake_row_approved(row)
    elif row_kind == "editorial":
        assert_editorial_row_approved(row)
    else:
        raise PromotionGuardError(f"Unknown row_kind: {row_kind!r}")


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def safe_slug(value: str, *, fallback: str = "untitled") -> str:
    """Make a filesystem-safe slug. Refuses to produce path traversal."""
    s = (value or "").lower().strip()
    s = _SLUG_RE.sub("-", s).strip("-")
    if not s:
        s = fallback
    if ".." in s or "/" in s or "\\" in s:
        raise PromotionGuardError(f"Refusing unsafe slug derived from {value!r}")
    return s[:80]
