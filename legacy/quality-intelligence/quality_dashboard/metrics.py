"""Rolls raw GitHub Actions job history up into the metrics defined in
QUALITY_INTELLIGENCE.md #1: rolling pass rate, flakiness score, and days
since the last fully-green run across all jobs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import groupby

from quality_dashboard.github_data import JobRun

ROLLING_WINDOW = 20


@dataclass
class JobMetrics:
    job_name: str
    total_runs: int
    pass_rate: float
    flakiness_score: float
    last_conclusion: str | None
    last_run_at: datetime | None
    runs: list[JobRun]


def _flakiness(runs_newest_first: list[JobRun]) -> float:
    """Fraction of consecutive-run pairs (within the window) that disagree,
    i.e. alternate pass/fail. A steady run of failures followed by a fix
    scores low; genuinely alternating results score high.
    """
    if len(runs_newest_first) < 2:
        return 0.0
    flips = 0
    pairs = 0
    for a, b in zip(runs_newest_first, runs_newest_first[1:]):
        pairs += 1
        if a.passed != b.passed:
            flips += 1
    return flips / pairs if pairs else 0.0


def compute_job_metrics(job_runs: list[JobRun], window: int = ROLLING_WINDOW) -> list[JobMetrics]:
    by_name = sorted(job_runs, key=lambda r: r.job_name)
    results: list[JobMetrics] = []
    for job_name, group in groupby(by_name, key=lambda r: r.job_name):
        runs = sorted(group, key=lambda r: r.started_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        windowed = runs[:window]
        passed = sum(1 for r in windowed if r.passed)
        results.append(
            JobMetrics(
                job_name=job_name,
                total_runs=len(windowed),
                pass_rate=passed / len(windowed) if windowed else 0.0,
                flakiness_score=_flakiness(windowed),
                last_conclusion=windowed[0].conclusion if windowed else None,
                last_run_at=windowed[0].started_at if windowed else None,
                runs=windowed,
            )
        )
    return sorted(results, key=lambda m: m.job_name)


def days_since_last_green(job_metrics: list[JobMetrics]) -> float | None:
    """Across all jobs, how many days since every job's most recent run
    that day was a success. Approximated here as: the most recent point in
    time at which every job's *latest* run was green, using each job's own
    last run timestamp as the reference -- if any job's latest run failed,
    this looks back through its history for the most recent success and
    reports the gap from now.
    """
    now = datetime.now(timezone.utc)
    worst_gap: float | None = None
    for jm in job_metrics:
        last_green_at = None
        for run in jm.runs:
            if run.passed and run.started_at is not None:
                last_green_at = run.started_at
                break
        if last_green_at is None:
            return None  # no green run in the window at all for this job
        gap_days = (now - last_green_at).total_seconds() / 86400
        if worst_gap is None or gap_days > worst_gap:
            worst_gap = gap_days
    return worst_gap
