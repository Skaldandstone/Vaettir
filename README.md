# quality-intelligence

A long-term QA strategy plus a real (non-mocked) dashboard that turns a
GitHub repo's actual CI history and git churn into visible, ongoing signal
about testing risk and deploy health.

Read these in order:

1. [QA_STRATEGY.md](./QA_STRATEGY.md) — what to test, how much, at what
   gate, and how to keep the signal trustworthy over time.
2. [QUALITY_INTELLIGENCE.md](./QUALITY_INTELLIGENCE.md) — the exact
   metrics (pass rate, risk footprint, deploy-health visibility) and the
   data contract for upgrading them once a repo exports real coverage
   artifacts.
3. [`quality_dashboard/`](./quality_dashboard/) — the tool that computes
   those metrics today, from data every GitHub-hosted repo with Actions CI
   already has, with zero changes required to that repo.

## What it actually measures, and from what

Most repos' CI doesn't export a machine-readable coverage or JUnit
artifact, so this tool always works from two things every GitHub-hosted
repo with Actions CI already has:

- **GitHub Actions run/job history**, via `gh api` (reuses your existing
  `gh auth login` session — no separate token setup) → real pass/fail,
  duration, and timestamp per job, per run.
- **`git log --stat`** on a local clone → real change frequency per file.

For the second half of the risk formula (how confident we are a changed
file is actually tested), the tool tries two sources in order:

1. **Real coverage data** — if a recent CI run has an artifact containing
   `coverage.json` (`pytest-cov`'s `--cov-report=json`), `coverage_data.py`
   downloads it via `gh run download` and uses the real per-file
   `percent_covered`. This is what Kall's CI now exports (see
   `--coverage-artifact`, default `backend-test-results`).
2. **Test-file-presence heuristic** — for anything the coverage artifact
   doesn't cover (frontend code, a repo with no coverage export at all),
   `git_risk.py` falls back to checking whether a plausibly-matching test
   file exists.

Each row in the risk table is tagged **measured** or **estimated** so
it's never ambiguous which one produced a given number. See
[QUALITY_INTELLIGENCE.md #4](./QUALITY_INTELLIGENCE.md#4-data-contract-for-full-fidelity-metrics)
for the full rationale.

## Usage

Requires the [`gh` CLI](https://cli.github.com/) already authenticated
(`gh auth status` to check) and a local clone of the target repo (for the
git-churn analysis — the GitHub API alone doesn't give you `git log`).

```bash
python -m quality_dashboard \
  --repo Grunklegrok/Kall \
  --clone-path /path/to/local/Kall/clone \
  --out dashboard.html
```

Flags:

| Flag | Default | Meaning |
|---|---|---|
| `--repo` | *(required)* | `owner/name` |
| `--clone-path` | *(required)* | Local path to a clone of `--repo`, used for `git log` |
| `--workflow-file` | `ci.yml` | Which workflow's run history to pull |
| `--runs` | `50` | How many recent completed runs to fetch |
| `--since-days` | `90` | Git churn lookback window |
| `--top-n` | `15` | How many riskiest files to list |
| `--coverage-artifact` | `backend-test-results` | CI artifact name containing `coverage.json`; pass `''` to always use the heuristic |
| `--out` | `dashboard.html` | Output file |

Output is one self-contained HTML file — no external JS/CSS, safe to open
directly, email, or publish as a static page.

## Explicitly out of scope for v1

- Any persistent server, database, or scheduled automation — this is an
  on-demand CLI producing a static file. Wiring it into a deploy pipeline
  (so a snapshot is generated and linked at every deploy, per
  [QUALITY_INTELLIGENCE.md #3](./QUALITY_INTELLIGENCE.md#3-deploy-health-visibility))
  is a natural next phase once the metrics themselves have been trusted
  against real history.

## Development

```bash
pip install -e .
python -m quality_dashboard --repo <owner>/<name> --clone-path <path> --out dashboard.html
```

No third-party dependencies beyond the Python standard library and an
authenticated `gh` CLI on `PATH`.
