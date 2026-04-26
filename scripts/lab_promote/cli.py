"""Command-line entry points for lab promotion.

Two commands are exposed:

  python3 -m scripts.lab_promote.cli editorial <rows.json> [<rows.json> ...]
  python3 -m scripts.lab_promote.cli directory <rows.json>

Each input file is a JSON list of LAB_* row dicts. An offline export
from the Drive spreadsheet (or a fixture in
``scripts/lab_promote/fixtures``) feeds these scripts.

The CLI:
  * Applies all guards (lab env flag, branch check, approved status,
    required review fields, no Directory_Master).
  * Skips rows that fail guards with a short reason and a non-zero
    final exit code.
  * Writes editorial drafts under ``editorials/drafts/lab/``.
  * Writes directory / place candidates into a single staging file
    ``data/candidates/directory-candidates.lab.json`` (NOT Directory_Master).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from .guards import (
    PromotionGuardError,
    apply_all_guards,
)
from .transforms import (
    editorial_row_to_draft_markdown,
    intake_row_to_directory_candidate,
    merge_into_candidates_file,
    place_row_to_candidate,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
EDITORIAL_DRAFTS_DIR = REPO_ROOT / "editorials" / "drafts" / "lab"
CANDIDATES_DIR = REPO_ROOT / "data" / "candidates"
CANDIDATES_FILE = CANDIDATES_DIR / "directory-candidates.lab.json"


def _load_rows(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and isinstance(data.get("rows"), list):
        return list(data["rows"])
    if isinstance(data, list):
        return list(data)
    raise PromotionGuardError(
        f"{path}: expected a JSON list of rows or {{'rows': [...]}}"
    )


def _read_existing_candidates() -> dict[str, Any] | None:
    if not CANDIDATES_FILE.exists():
        return None
    with CANDIDATES_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_candidates(payload: dict[str, Any]) -> None:
    CANDIDATES_DIR.mkdir(parents=True, exist_ok=True)
    with CANDIDATES_FILE.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


def _write_draft(filename: str, content: str) -> Path:
    EDITORIAL_DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    out = EDITORIAL_DRAFTS_DIR / filename
    with out.open("w", encoding="utf-8") as f:
        f.write(content)
    return out


def _promote_editorial(input_paths: list[Path], *, dry_run: bool) -> int:
    failures = 0
    written: list[str] = []
    for path in input_paths:
        rows = _load_rows(path)
        for row in rows:
            try:
                apply_all_guards(
                    source_tab="LAB_Editorial_Intake",
                    target_tab="editorials/drafts/lab",
                    row=row,
                    row_kind="editorial",
                )
                filename, markdown = editorial_row_to_draft_markdown(row)
            except PromotionGuardError as exc:
                failures += 1
                print(
                    f"[skip] {path}: editorial_id={row.get('editorial_id', '?')}: {exc}",
                    file=sys.stderr,
                )
                continue
            if dry_run:
                print(f"[dry-run] would write {EDITORIAL_DRAFTS_DIR}/{filename} ({len(markdown)} bytes)")
                written.append(filename)
                continue
            target = _write_draft(filename, markdown)
            print(f"[ok] wrote {target.relative_to(REPO_ROOT)}")
            written.append(str(target.relative_to(REPO_ROOT)))
    if not written and failures == 0:
        print("[warn] no rows processed; nothing written.")
    return 1 if failures else 0


def _promote_directory(input_paths: list[Path], *, dry_run: bool) -> int:
    failures = 0
    existing = _read_existing_candidates()
    payload = existing
    appended = 0

    for path in input_paths:
        rows = _load_rows(path)
        for row in rows:
            source_tab = (
                "LAB_Place_Candidates"
                if row.get("candidate_id") and not row.get("name")
                else "LAB_Intake_Submissions"
            )
            try:
                apply_all_guards(
                    source_tab=source_tab,
                    target_tab="data/candidates/directory-candidates.lab.json",
                    row=row,
                    row_kind="intake",
                )
                if source_tab == "LAB_Place_Candidates":
                    candidate = place_row_to_candidate(row)
                else:
                    candidate = intake_row_to_directory_candidate(row)
            except PromotionGuardError as exc:
                failures += 1
                print(
                    f"[skip] {path}: submission_id={row.get('submission_id') or row.get('candidate_id', '?')}: {exc}",
                    file=sys.stderr,
                )
                continue
            payload = merge_into_candidates_file(payload, candidate)
            appended += 1
            print(
                f"[ok] queued candidate {candidate.get('submission_id') or candidate.get('candidate_id')}"
                f" -> {CANDIDATES_FILE.relative_to(REPO_ROOT)}"
            )

    if appended and not dry_run and payload is not None:
        _write_candidates(payload)
        print(f"[ok] wrote {CANDIDATES_FILE.relative_to(REPO_ROOT)} ({appended} candidate(s) added/replaced)")
    elif appended and dry_run:
        print(f"[dry-run] would update {CANDIDATES_FILE.relative_to(REPO_ROOT)} with {appended} candidate(s)")
    elif not appended and failures == 0:
        print("[warn] no rows processed; nothing written.")
    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="lab-promote",
        description="Lab-only controlled promotion from LAB_* rows to local artefacts.",
    )
    parser.add_argument(
        "kind",
        choices=("editorial", "directory"),
        help="What to promote: 'editorial' rows -> draft markdown, 'directory' rows -> candidate JSON.",
    )
    parser.add_argument(
        "rows",
        nargs="+",
        type=Path,
        help="One or more JSON files containing LAB_* row dicts.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Apply all guards but do not write any files.",
    )
    args = parser.parse_args(argv)

    try:
        if args.kind == "editorial":
            return _promote_editorial(args.rows, dry_run=args.dry_run)
        return _promote_directory(args.rows, dry_run=args.dry_run)
    except PromotionGuardError as exc:
        print(f"[fatal] {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
