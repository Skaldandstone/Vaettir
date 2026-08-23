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

No CI job in most repos (Kall included, as of this writing) exports a
machine-readable coverage or JUnit artifact — see
[QUALITY_INTELLIGENCE.md #4](./QUALITY_INTELLIGENCE.md#4-data-contract-for-full-fidelity-metrics)
for the details. So v1 works entirely from two things every repo already
has:

- **GitHub Actions run/job history**, via `gh api` (reuses your existing
  `gh auth login` session — no separate token setup) → real pass/fail,
  duration, and timestamp per job, per run.
- **`git log --stat`** on a local clone → real change frequency per file,
  cross-referenced against a simple test-file-presence heuristic to
  produce a ranked risk-footprint table.

When a target repo starts exporting `coverage.json` or JUnit XML, this
tool should be extended to prefer that real data over the presence
heuristic — that upgrade path is intentionally documented, not silently
assumed away.

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
| `--out` | `dashboard.html` | Output file |

Output is one self-contained HTML file — no external JS/CSS, safe to open
directly, email, or publish as a static page.

## Explicitly out of scope for v1

- Modifying a target repo's own CI to export `coverage.json`/JUnit XML —
  a separate, small follow-up against that repo, not bundled here.
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
