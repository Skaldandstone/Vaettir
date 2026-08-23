# Quality Intelligence

Companion to [QA_STRATEGY.md](./QA_STRATEGY.md). That document says what
"good testing" means; this one defines the metrics that make it visible —
precisely enough that the [`quality_dashboard`](./quality_dashboard/) tool
can compute them from real data, not vibes.

## 1. Automated test pass rate

**Definition:** per CI job (e.g. `backend`, `web`, `e2e`), the fraction of
the last N runs (default N=20) that concluded `success`, computed from
GitHub Actions run history — not a single run's result.

A single red run is noise (a transient network blip, a flaky third-party
widget); a trend across 20 runs is signal. Reporting "last run: fail"
without the rolling context invites either overreaction to a fluke or
(worse) normalization of a real regression as "just flaky today."

**Also tracked per job:**
- **Flakiness score** — how often consecutive runs alternate pass/fail
  within the window, as a proxy for non-deterministic failures distinct
  from a genuine regression (a job that fails 5 in a row and then goes
  green after a real fix looks very different from one that alternates
  pass/fail/pass/fail with no code change in between).
- **Days since last fully-green run across all jobs** — the single
  headline number for "is main currently trustworthy."

## 2. Risk footprint

**Formula:**

```
risk(path) = change_frequency(path) × (1 − test_coverage_confidence(path))
```

- **`change_frequency(path)`** — commit-touch count for that path over a
  rolling window (default: last 90 days), from `git log --stat`. A file
  or module touched in 20 of the last 90 days' commits is more likely to
  regress than one untouched in a year, independent of how good its tests
  are — churn itself is risk.
- **`test_coverage_confidence(path)`** — **v1 heuristic** (see §4 for why):
  1.0 if a corresponding test file exists and appears to reference the
  module (e.g. `backend/kall/api_growth.py` ↔ `tests/test_growth.py`
  importing `kall.api_growth` or hitting its routes), 0.4 if a test file
  exists but doesn't clearly reference the module, 0.0 if no test file
  exists at all. This is deliberately coarse — presence-of-a-test is not
  the same as good coverage — but it is honest about being coarse (see
  the data contract in §4 for the upgrade path).

**Output:** a ranked table, highest risk first. High churn + low
confidence is the "someone is actively changing this and we have weak
evidence it's tested" combination — exactly the areas that most deserve a
human's attention, not just automated confidence.

**Worked example from Kall:** `backend/kall/api_growth.py` was rewritten
today as part of the Growth-section rebuild (high churn) and previously
had zero backend tests; it should rank near the top of the risk table
*before* `tests/test_growth.py` existed, and should visibly drop once that
suite lands — this is the concrete before/after used to validate the tool
(see the Verification section of the project plan).

## 3. Deploy-health visibility

"Visible as we deploy" means a dashboard snapshot generated **at deploy
time** — not a slowly-refreshing background page someone has to remember
to check. Concretely:

- Every deploy (or, in v1 without pipeline integration, every on-demand
  run) produces one self-contained HTML file capturing: current status
  per CI job, the pass-rate trend, the top-N riskiest areas, and the
  fully-green-run headline — a snapshot of what was true right before
  this deploy went out.
- v1 is a CLI producing a static file, deliberately not wired into the
  deploy pipeline yet (see the project plan's out-of-scope section) — the
  metrics need to prove themselves against real history before automating
  when they run.
- The natural v2 step (not built yet) is generating this snapshot as a
  deploy-pipeline step and linking it from the deploy record itself, so
  "what did quality look like right before this went out" is one click
  from any past deploy, not a manually-reconstructed timeline.

## 4. Data contract for full-fidelity metrics

The v1 heuristics above (test-file-presence for coverage confidence,
GitHub Actions run history for pass rate) work with **zero changes** to a
target repo's CI — that was a deliberate scoping choice, since modifying
Kall's CI is explicitly out of scope for this pass. But they're coarser
than they need to be. When a target repo's CI is willing to export
machine-readable artifacts, the tool should prefer them:

| Artifact | Produced by | Upgrades |
|---|---|---|
| `coverage.json` (or `.coverage` → `coverage json`) | `pytest --cov --cov-report=json` | Replaces the presence heuristic with a real line/branch coverage percentage per file — `test_coverage_confidence(path)` becomes the actual number instead of 1.0/0.4/0.0. |
| JUnit XML | `pytest --junitxml=...`, Playwright's `--reporter=junit` | Replaces "job succeeded/failed" with per-test pass/fail, enabling real per-test flakiness tracking (a single flaky test in an otherwise-green job is currently invisible — it only shows up in the job's history if it fails the whole job). |
| `deploy-manifest.json` (commit SHA, timestamp, environment, image digest) | A deploy pipeline step | Lets a dashboard snapshot be looked up by deploy instead of by wall-clock time, and makes "what changed since the last deploy" a precise diff instead of an approximation. |

**This is intentionally a documented gap, not a silent limitation.** Kall
does not currently produce any of these three artifacts (confirmed by
reading `.github/workflows/ci.yml`: the backend job's coverage goes only
to the console, and the e2e job's Playwright report is uploaded solely on
failure, as an HTML report, only for humans to open by hand). Adding them
is a real, small, separate change to Kall's own CI — deliberately not
bundled into this project's first pass, and only done when asked for
explicitly against the Kall repo directly.
