"""Downloads and parses the real coverage.json artifact a target repo's CI
uploads (see QUALITY_INTELLIGENCE.md #4 for the data-contract rationale).

Falls back to returning None when no such artifact exists yet on any recent
run -- callers are expected to fall back to the presence heuristic in
git_risk.py, not fail outright. Most repos won't have this artifact from day
one; that's the whole reason the heuristic exists.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from quality_dashboard.github_data import GitHubDataError, fetch_run_ids


def _download_artifact(repo: str, run_id: int, artifact_name: str, dest: Path) -> bool:
    result = subprocess.run(
        ["gh", "run", "download", str(run_id), "--repo", repo, "--name", artifact_name, "--dir", str(dest)],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


def fetch_latest_coverage(
    repo: str,
    workflow_file: str = "ci.yml",
    artifact_name: str = "backend-test-results",
    search_depth: int = 15,
) -> dict[str, float] | None:
    """Returns {file_path: percent_covered} from the most recent run that has
    a coverage.json in its `artifact_name` artifact, or None if no recent run
    has one (e.g. the CI workflow doesn't export it yet).
    """
    try:
        run_ids = fetch_run_ids(repo, workflow_file, limit=search_depth)
    except GitHubDataError:
        return None

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        for run_id in run_ids:
            run_dir = tmp_path / str(run_id)
            if not _download_artifact(repo, run_id, artifact_name, run_dir):
                continue
            coverage_file = next(run_dir.rglob("coverage.json"), None)
            if coverage_file is None:
                continue
            try:
                payload = json.loads(coverage_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            files = payload.get("files", {})
            return {
                path: data.get("summary", {}).get("percent_covered", 0.0)
                for path, data in files.items()
            }
    return None
