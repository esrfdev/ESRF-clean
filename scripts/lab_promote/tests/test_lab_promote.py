"""Tests for the lab-promote guards and transforms.

Run from the repo root with:

    ESRF_LAB_PROMOTE=1 ESRF_BRANCH=test/regional-editorial-contributor-intake \
    python3 -m unittest scripts.lab_promote.tests.test_lab_promote -v

The guard tests deliberately set / unset ESRF_LAB_PROMOTE and ESRF_BRANCH
inside each case so they don't depend on caller environment.
"""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

from scripts.lab_promote import guards, transforms
from scripts.lab_promote.cli import main as cli_main


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _approved_intake_row() -> dict:
    with (FIXTURES / "intake_approved.json").open() as f:
        return json.load(f)[0]


def _approved_editorial_row() -> dict:
    with (FIXTURES / "editorial_approved.json").open() as f:
        return json.load(f)[0]


def _unapproved_row() -> dict:
    with (FIXTURES / "intake_unapproved.json").open() as f:
        return json.load(f)[0]


class _LabEnv:
    """Context manager that sets ESRF_LAB_PROMOTE and a safe lab branch."""

    def __init__(self, *, lab_promote: str = "1", branch: str = "test/lab-fixture"):
        self.lab_promote = lab_promote
        self.branch = branch
        self._prev: dict[str, str | None] = {}

    def __enter__(self):
        for k, v in (("ESRF_LAB_PROMOTE", self.lab_promote), ("ESRF_BRANCH", self.branch)):
            self._prev[k] = os.environ.get(k)
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        return self

    def __exit__(self, *exc):
        for k, v in self._prev.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class GuardEnvironmentTests(unittest.TestCase):
    def test_refuses_without_lab_flag(self):
        with _LabEnv(lab_promote=""):
            with self.assertRaises(guards.PromotionGuardError):
                guards.assert_lab_environment()

    def test_passes_with_lab_flag(self):
        with _LabEnv():
            guards.assert_lab_environment()

    def test_refuses_main_branch(self):
        with _LabEnv(branch="main"):
            with self.assertRaises(guards.PromotionGuardError):
                guards.assert_not_main_branch()

    def test_refuses_master_branch(self):
        with _LabEnv(branch="master"):
            with self.assertRaises(guards.PromotionGuardError):
                guards.assert_not_main_branch()

    def test_passes_test_branch(self):
        with _LabEnv(branch="test/regional-editorial-contributor-intake"):
            guards.assert_not_main_branch()


class GuardTabAndStatusTests(unittest.TestCase):
    def test_refuses_directory_master_target(self):
        with self.assertRaises(guards.PromotionGuardError):
            guards.assert_target_tab_allowed("Directory_Master")

    def test_refuses_directory_master_lowercase(self):
        with self.assertRaises(guards.PromotionGuardError):
            guards.assert_target_tab_allowed("directory_master_backup")

    def test_allows_lab_target(self):
        guards.assert_target_tab_allowed("editorials/drafts/lab")
        guards.assert_target_tab_allowed("data/candidates/directory-candidates.lab.json")

    def test_refuses_unknown_source_tab(self):
        with self.assertRaises(guards.PromotionGuardError):
            guards.assert_source_tab_allowed("Sheet1")

    def test_intake_row_must_be_approved(self):
        with self.assertRaises(guards.PromotionGuardError):
            guards.assert_intake_row_approved(_unapproved_row())

    def test_intake_row_approved_passes(self):
        guards.assert_intake_row_approved(_approved_intake_row())

    def test_editorial_row_must_be_approved(self):
        bad = dict(_approved_editorial_row())
        bad["editorial_status"] = "received"
        with self.assertRaises(guards.PromotionGuardError):
            guards.assert_editorial_row_approved(bad)

    def test_editorial_row_missing_review_notes_refused(self):
        bad = dict(_approved_editorial_row())
        bad["review_notes_internal"] = ""
        with self.assertRaises(guards.PromotionGuardError):
            guards.assert_editorial_row_approved(bad)

    def test_pii_in_output_refused(self):
        with self.assertRaises(guards.PromotionGuardError):
            guards.assert_no_pii_in_output({"contact_email": "x@y.z"})

    def test_apply_all_guards_intake_happy_path(self):
        with _LabEnv(branch="test/lab-fixture"):
            guards.apply_all_guards(
                source_tab="LAB_Intake_Submissions",
                target_tab="data/candidates/directory-candidates.lab.json",
                row=_approved_intake_row(),
                row_kind="intake",
            )

    def test_apply_all_guards_blocks_directory_master(self):
        with _LabEnv(branch="test/lab-fixture"):
            with self.assertRaises(guards.PromotionGuardError):
                guards.apply_all_guards(
                    source_tab="LAB_Intake_Submissions",
                    target_tab="Directory_Master",
                    row=_approved_intake_row(),
                    row_kind="intake",
                )


class TransformTests(unittest.TestCase):
    def test_editorial_to_markdown_strips_pii(self):
        filename, md = transforms.editorial_row_to_draft_markdown(_approved_editorial_row())
        self.assertTrue(filename.endswith(".md"))
        self.assertNotIn("REDACTED", md)  # PII placeholders not copied verbatim
        self.assertNotIn("contact_email", md)
        self.assertNotIn("contact_name", md)
        # status / preview-only / auto_publish=false flags must be present
        self.assertIn("status: lab-draft", md)
        self.assertIn("auto_i18n: false", md)
        self.assertIn("auto_publish: false", md)
        self.assertIn("preview_only: true", md)
        self.assertIn("Voorbeeld regionale leadership lesson", md)
        self.assertIn("Rotterdam-Rijnmond", md)

    def test_editorial_filename_safe(self):
        row = dict(_approved_editorial_row())
        row["title"] = "../etc/passwd: bad title"
        filename, _ = transforms.editorial_row_to_draft_markdown(row)
        self.assertNotIn("..", filename)
        self.assertNotIn("/", filename)

    def test_intake_to_directory_candidate_strips_pii(self):
        candidate = transforms.intake_row_to_directory_candidate(_approved_intake_row())
        self.assertEqual(candidate["candidate_kind"], "directory_listing")
        self.assertEqual(candidate["lab_status"], "candidate-pending-review")
        self.assertFalse(candidate["auto_promote_to_directory_master"])
        for key in ("contact_email", "contact_name", "contact_role", "raw_payload_json", "notes_submitter"):
            self.assertNotIn(key, candidate)
        self.assertEqual(candidate["name"], "ESRF Lab Test Voorbeeld Organisatie")
        self.assertEqual(candidate["country_code"], "NL")

    def test_merge_into_candidates_dedupes_on_submission_id(self):
        c1 = transforms.intake_row_to_directory_candidate(_approved_intake_row())
        merged = transforms.merge_into_candidates_file(None, c1)
        merged = transforms.merge_into_candidates_file(merged, c1)
        self.assertEqual(len(merged["candidates"]), 1)
        self.assertFalse(merged["auto_promote_to_directory_master"])

    def test_place_candidate_transform(self):
        row = {
            "candidate_id": "place_lab_001",
            "first_seen_at": "2026-04-26T10:00:00Z",
            "city_raw": "Stedeke",
            "country_code": "NL",
            "region": "Utrecht",
            "submission_count": 1,
            "review_status": "approved_lab_promote",
            "review_notes_internal": "Approved 2026-04-26",
            "assigned_to": "redactie",
        }
        candidate = transforms.place_row_to_candidate(row)
        self.assertEqual(candidate["candidate_kind"], "place_addition")
        self.assertEqual(candidate["city_raw"], "Stedeke")
        self.assertFalse(candidate["auto_promote_to_directory_master"])


class CliIntegrationTests(unittest.TestCase):
    """Smoke-test the CLI end-to-end against fixtures, in --dry-run mode."""

    def test_editorial_dry_run_succeeds(self):
        with _LabEnv(branch="test/lab-fixture"):
            rc = cli_main(["editorial", str(FIXTURES / "editorial_approved.json"), "--dry-run"])
        self.assertEqual(rc, 0)

    def test_directory_dry_run_succeeds(self):
        with _LabEnv(branch="test/lab-fixture"):
            rc = cli_main(["directory", str(FIXTURES / "intake_approved.json"), "--dry-run"])
        self.assertEqual(rc, 0)

    def test_directory_unapproved_row_refused(self):
        with _LabEnv(branch="test/lab-fixture"):
            rc = cli_main(["directory", str(FIXTURES / "intake_unapproved.json"), "--dry-run"])
        # unapproved rows produce skip + non-zero exit
        self.assertNotEqual(rc, 0)

    def test_main_branch_refused(self):
        with _LabEnv(branch="main"):
            rc = cli_main(["directory", str(FIXTURES / "intake_approved.json"), "--dry-run"])
        self.assertNotEqual(rc, 0)

    def test_no_lab_flag_refused(self):
        with _LabEnv(lab_promote="", branch="test/lab-fixture"):
            rc = cli_main(["directory", str(FIXTURES / "intake_approved.json"), "--dry-run"])
        self.assertNotEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
