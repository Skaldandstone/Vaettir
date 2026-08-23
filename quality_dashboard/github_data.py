"""Fetches real GitHub Actions run/job history via the `gh` CLI.

Reuses the user's existing `gh auth login` session via subprocess rather than
adding a separate token/auth flow.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from datetime import datetime


class GitHubDataError(RuntimeError):
    pass


def _gh_api(path: str) -> dict | list:
    result = subprocess.run(
        ["gh", "api", path],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise GitHubDataError(f"gh api {path} failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


@dataclass
class JobRun:
    run_id: int
    job_name: str
    conclusion: str | None
    status: str
    started_at: datetime | None
    completed_at: datetime | None
    head_sha: str

    @property
    def duration_seconds(self) -> float | None:
        if self.started_at is None or self.completed_at is None:
            return None
        return (self.completed_at - self.started_at).total_seconds()

    @property
    def passed(self) -> bool:
        return self.conclusion == "success"


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def fetch_workflow_runs(repo: str, workflow_file: str, limit: int = 50) -> list[JobRun]:
    """Fetches the last `limit` completed runs of `workflow_file` (e.g. 'ci.yml')
    for `repo` ('owner/name'), flattened to one JobRun per job per run, newest first.
    """
    workflows = _gh_api(f"repos/{repo}/actions/workflows")
    workflow_id = None
    for wf in workflows.get("workflows", []):
        if wf["path"].endswith(workflow_file):
            workflow_id = wf["id"]
            break
    if workflow_id is None:
        raise GitHubDataError(f"No workflow matching '{workflow_file}' found in {repo}")

    runs_payload = _gh_api(f"repos/{repo}/actions/workflows/{workflow_id}/runs?per_page={limit}&status=completed")
    job_runs: list[JobRun] = []
    for run in runs_payload.get("workflow_runs", []):
        jobs_payload = _gh_api(f"repos/{repo}/actions/runs/{run['id']}/jobs")
        for job in jobs_payload.get("jobs", []):
            job_runs.append(
                JobRun(
                    run_id=run["id"],
                    job_name=job["name"],
                    conclusion=job.get("conclusion"),
                    status=job.get("status", "unknown"),
                    started_at=_parse_dt(job.get("started_at")),
                    completed_at=_parse_dt(job.get("completed_at")),
                    head_sha=run["head_sha"],
                )
            )
    return job_runs
