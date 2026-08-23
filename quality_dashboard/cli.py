"""python -m quality_dashboard --repo Grunklegrok/Kall --clone-path /path/to/local/clone --out dashboard.html"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from quality_dashboard.git_risk import compute_risk_footprint
from quality_dashboard.github_data import GitHubDataError, fetch_workflow_runs
from quality_dashboard.metrics import compute_job_metrics
from quality_dashboard.report import render_dashboard


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a quality-intelligence dashboard from real CI + git history.")
    parser.add_argument("--repo", required=True, help="owner/name, e.g. Grunklegrok/Kall")
    parser.add_argument("--clone-path", required=True, help="Path to a local clone of --repo, used for git-churn risk analysis")
    parser.add_argument("--workflow-file", default="ci.yml", help="Workflow file name to pull run history for (default: ci.yml)")
    parser.add_argument("--runs", type=int, default=50, help="How many recent completed runs to fetch (default: 50)")
    parser.add_argument("--since-days", type=int, default=90, help="Git churn lookback window in days (default: 90)")
    parser.add_argument("--top-n", type=int, default=15, help="How many riskiest files to show (default: 15)")
    parser.add_argument("--out", default="dashboard.html", help="Output HTML file path")
    args = parser.parse_args(argv)

    try:
        job_runs = fetch_workflow_runs(args.repo, args.workflow_file, limit=args.runs)
    except GitHubDataError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    job_metrics = compute_job_metrics(job_runs)

    clone_path = Path(args.clone_path)
    if not clone_path.exists():
        print(f"error: --clone-path {clone_path} does not exist", file=sys.stderr)
        return 1
    risk_entries = compute_risk_footprint(clone_path, since_days=args.since_days, top_n=args.top_n)

    html = render_dashboard(args.repo, job_metrics, risk_entries)
    Path(args.out).write_text(html, encoding="utf-8")
    print(f"Wrote {args.out} ({len(job_runs)} job-runs, {len(risk_entries)} risk entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
