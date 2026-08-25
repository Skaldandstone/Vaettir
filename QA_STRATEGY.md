# QA Strategy

This is a project-agnostic quality strategy: what to test, how much, at what
gate, and how to keep the signal trustworthy over time. It's written to be
useful for any codebase, with [Kall](https://github.com/Grunklegrok/Kall)
used throughout as the worked example, since it's the first real project
this strategy - and the companion [quality-intelligence dashboard](./quality_dashboard/)
- was built against.

## 1. Objectives and scope

This strategy exists to answer three questions concretely, not
aspirationally: what gets tested, how much confidence a green pipeline
should buy, and who is on the hook when that confidence turns out to be
wrong. It covers everything from commit to production for a web
application with a REST API backend, a browser frontend, and (per §5)
a risk-tiered set of critical paths - auth, payments/PII, core business
state machines. It does not cover manual exploratory test-case libraries
or compliance audit trails; those are a natural extension once the
underlying product has one (Kall doesn't process regulated data today).

## 2. Roles and responsibilities

Kall is small enough that most of these are one or two people wearing
multiple hats, but the responsibilities are still distinct and should be
named explicitly rather than left implicit:

| Responsibility | Owner | What "owning" means here |
|---|---|---|
| Writing tests alongside a change | Whoever ships the change | No PR merges with new business logic and zero new tests unless the change is presentational (§5's tier table decides how much) |
| Merge-gate CI health | Whoever last touched `.github/workflows/ci.yml` | Keeping the pipeline itself fast and reliable is a maintenance job, not a one-time setup |
| Deploy-gate smoke checks | Whoever runs the deploy | Not delegable to CI - a human confirms the live environment after every deploy (§8) |
| Security-sensitive paths (auth, ownership checks, encryption) | Reviewer on any PR touching `backend/kall/auth.py`, `security.py`, or an ownership check | Held to the "critical tier" bar in §5's table regardless of who authored the change |
| Quality-intelligence dashboard review | Whoever is driving the current release | Per §14's cadence - this is a recurring duty, not a one-off report |

As the team grows past this, the same five rows are the template for
assigning them to actual named roles (QA lead, security reviewer, release
owner) rather than diffusing them.

## 3. Testing approach by type

The pyramid in §4 is about *layer* (unit vs. integration vs. e2e); this
is about *kind* of risk each layer's tests should actually check for.
Not every kind applies to every project, but each one is a deliberate
inclusion-or-exclusion decision, not an oversight:

- **Functional** - the default; covered throughout §4.
- **Security** - ownership/authorization checks on every mutable route,
  auth token handling, input validation on user-supplied content (file
  uploads, resume parsing). This is the category the security audit
  covered this session and where negative-case testing (wrong user,
  expired token, tampered payload) matters as much as the happy path.
- **Performance** - not currently a dedicated suite; the rate-limiter
  tests (`tests/test_rate_limiting.py`) are the closest thing today.
  Full load/perf testing is deferred until real traffic patterns exist to
  test against - building a load-test suite against synthetic guesses is
  lower value than doing it once production traffic gives real numbers.
- **Accessibility** - not currently covered by an automated suite. Flagged
  here as a real gap rather than silently skipped: a follow-up pass adding
  automated a11y checks (e.g. axe-core in the e2e run) to the canonical
  journey is a reasonable Phase 2 for this strategy, not assumed away.
- **Compliance** - not applicable today (no regulated data). Revisit this
  row if Kall starts handling anything that changes that.

## 4. Test pyramid targets

Three layers, in decreasing count and increasing cost/value per test:

| Layer | What it verifies | Speed | Kall example |
|---|---|---|---|
| **Unit / service** | Pure logic, one function or service in isolation | Milliseconds | `tests/test_matching.py`, `tests/test_growth.py`'s `generate_ai_plan` fallback tests |
| **API / integration** | A route through real dependency wiring (DB, auth) but no browser | Sub-second | Most of `tests/*.py`, using `TestClient` + an in-memory SQLite engine via `StaticPool` |
| **End-to-end** | A real browser against a real running backend, covering a full user journey | Seconds to minutes | `apps/web/e2e/canonical-journey.spec.ts` |

**Ratio guidance:** roughly 70% unit/service, 25% API/integration, 5% e2e.
E2E tests are expensive to write, slow to run, and the first to become
flaky - reserve them for journeys that span multiple pages/services and
would otherwise only be caught by a human clicking through the product (as
happened repeatedly in Kall's navigation-consolidation work this session:
a `currentTarget`-after-`await` bug, a dead query param, a silently-`{}`
API response - none of these were unit-testable in isolation, all were
caught by driving the real UI against a real backend).

Kall's ratio today is roughly right - one e2e spec covering the one
journey that actually spans the whole product (register → onboarding →
resume → Morning Brief → opportunity → application review/approval), and
everything else as fast API-level tests.

## 5. Coverage philosophy

**Not a blanket percentage target.** A flat "80% coverage" rule produces
either padding (tests that exercise code without asserting anything
meaningful) or wasted effort testing low-risk code to satisfy a number.
Instead, scale the expected bar by risk tier:

| Tier | Examples (Kall) | Expected bar |
|---|---|---|
| **Critical** | auth (`backend/kall/auth.py`), ownership checks on every mutable route, payment/billing webhooks, encryption (`backend/kall/security.py`) | Every code path tested, including negative cases (wrong user, expired token, tampered signature). This is where this session's security audit found the *process* worked - a full route-by-route ownership sweep, not just unit tests - matters more than a coverage number. |
| **Core business logic** | matching, tailoring, application review/approval state machines | Happy path + the state transitions that would silently corrupt data if wrong (the `approve_review()` bug found this session - approving a review never advanced `Application.status` - is exactly this category) |
| **Presentational / UI** | page layout, copy, most React components | Covered by the e2e journey passing through it, not exhaustive unit tests per component |

**When a real bug is found, it earns a regression test** (see §9) - this
is a more reliable coverage signal than a percentage, because it means
the test suite grows exactly where the codebase has already demonstrated
risk.

## 6. Test automation plan

- **Tools already in place, kept rather than replaced:** pytest +
  `TestClient` for backend unit/API tests, Playwright for e2e, `ruff` for
  lint-as-a-gate. No new framework is justified until one of these
  demonstrably can't do a job asked of it.
- **What gets automated vs. left manual:** everything in §4's unit and
  API/integration layers is automated by default - there's no manual
  equivalent that's cheaper. E2E automation is reserved for the one
  canonical journey (§4); a second or third e2e journey only gets built
  once a specific gap in that coverage causes a real incident, not
  speculatively. One-off exploratory testing of new UI (does this look
  right, does this feel right) stays manual - that's a judgment call, not
  a repeatable assertion.
- **Automation coverage target:** not a percentage of the codebase - a
  requirement that every merged PR touching backend business logic ships
  with new or updated automated tests (enforced by review, not by a CI
  coverage-threshold gate, per §5's reasoning against blanket percentages).

## 7. Defect management and reporting

- **Tracking:** GitHub Issues, in the same repo as the code (Kall doesn't
  need a separate defect tracker at its current size - introducing one
  before it's needed adds process without adding signal).
- **Severity classification:**
  - **Sev1 - Critical**: data loss, security/auth bypass, or the
    production app is down. Fix immediately, out of band from normal PR
    cadence.
  - **Sev2 - High**: a core flow is broken for some/all users but there's
    a workaround, or the bug silently corrupts state (the `approve_review`
    status bug from this session is a Sev2: nothing crashed, but
    application state quietly became wrong). Fix in the next PR, not the
    next sprint.
  - **Sev3 - Normal**: a real bug with a narrow blast radius or that only
    affects an edge case. Normal backlog cadence.
  - **Sev4 - Cosmetic**: UI/copy issues with no functional impact.
- **Reporting cadence:** Sev1/Sev2 get called out synchronously the
  moment they're found (this session's practice of surfacing a bug the
  moment live verification found it, rather than batching it into an
  end-of-session summary, is the right instinct to keep). Sev3/Sev4 are
  fine to note and batch.

## 8. Gates

Two distinct checkpoints, not one:

- **Merge gate** (today, Kall's `.github/workflows/ci.yml`): `backend`
  (ruff, `compileall`, pytest, a fresh `alembic upgrade head`), `web` (`npm
  run build`), `e2e` (the canonical-journey Playwright spec against a real
  backend + fresh DB). All three must be green before merge - this is
  cheap and fast enough to run on every push/PR.
- **Deploy gate**: a smoke test against the *actual deployed environment*
  after a release, not just CI against a throwaway database. CI passing
  proves the code is correct; it doesn't prove the deployed configuration
  (secrets, DNS, a security-group rule, a CDN cache behavior) is correct.
  This session found exactly that class of bug twice - production had
  silently drifted from `main` after a merge with no redeploy trigger, and
  a CSP change broke a third-party widget that only a live check caught.
  A deploy gate is: hit the real public URL's `/health` and one or two
  real authenticated flows immediately after every deploy, before calling
  it done.

## 9. Flakiness policy

A flaky test (passes sometimes, fails sometimes, with no code change) is
worse than a missing test - it teaches everyone to ignore red CI, which
then hides real failures too. Policy:

1. **First flake**: re-run once. If it passes, leave a note in the test
   (a comment naming the suspected cause - timing, external service,
   shared state) but don't quarantine yet.
2. **Second flake within 30 days**: quarantine (skip with a linked issue),
   don't let it keep blocking merges while pretending to be signal.
3. **Quarantined for 14 days without a fix**: delete it. A test nobody has
   fixed in two weeks was providing negative value, not zero value.

E2E and anything touching a live third-party widget (Kall's Google
Programmable Search Engine embed, external OAuth callbacks) are the most
likely flake sources - budget for this explicitly rather than being
surprised by it.

## 10. Regression suite strategy

**Rule of thumb: every bug found through manual/live verification gets a
regression test before the fix is considered done**, unless the bug is
purely a one-off infrastructure mistake (a wrong DNS entry, a forgotten
redeploy) rather than a code defect. Concrete examples from this project's
history where this rule applied correctly:

- The `approve_review()` status-advancement bug → a new
  `test_approve_review_advances_application_status` test.
- The `create_tailoring_proposal()` silent-`{}`-response bug (a session
  closing before FastAPI serialized the response) →
  `test_created_proposal_survives_session_close`, which specifically
  reproduces the session-closed-before-read condition rather than just
  re-testing the happy path.
- The rate-limiter and resume-upload-validation gaps found in the security
  audit → `tests/test_rate_limiting.py`, `tests/test_resume_upload.py`.

**When manual verification is enough on its own** (no regression test
needed): pure infrastructure/config fixes with no code logic to regress
(an AWS security-group rule, a redeploy trigger), and one-time data
migrations.

## 11. Environments

- **Local**: fast feedback, sqlite, no external services - this is where
  most iteration happens.
- **CI**: the merge gate above - ephemeral database, real dependency
  versions, no access to production secrets.
- **Staging/production smoke**: the deploy gate above - real DNS, real
  TLS, real infrastructure wiring, minimal but real user-facing checks.

## 12. Metrics and KPIs

The full formulas and data model live in
[QUALITY_INTELLIGENCE.md](./QUALITY_INTELLIGENCE.md); this is the
short version of what's tracked and why it's the right thing to track:

- **Automated test pass rate** (rolling window per CI job) - is the
  pipeline currently trustworthy, not just "did the last run pass."
- **Flakiness score** - is a red run signal or noise.
- **Risk footprint** (`change_frequency × (1 − test_coverage_confidence)`)
  - where is untested code being actively changed right now, which is a
  better predictor of the next bug than raw coverage percentage alone.
- **Days since last fully-green run** - one headline number for "can we
  ship with confidence today."

No metric here is tracked because it's easy to compute - each one maps to
a real failure mode this session actually hit (production drift, a
regression the pyramid should have caught, a CSP change silently breaking
a widget) and is designed to surface that failure mode earlier next time.

## 13. Continuous improvement and feedback loops

- **Every Sev1/Sev2 defect (§7) gets a retro question, not just a fix:**
  what layer of the pyramid (§4) should have caught this, and why didn't
  it? If the honest answer is "no layer could have," that's fine - not
  everything is automatable - but the question has to actually get asked,
  not skipped because the bug got fixed quickly.
- **The quality-intelligence dashboard itself is reviewed for drift**,
  not just the metrics it shows: if the risk-footprint table stops
  matching lived experience (a module flagged low-risk turns out to be
  where the next bug hides), the heuristic in
  [QUALITY_INTELLIGENCE.md](./QUALITY_INTELLIGENCE.md) §2 needs revisiting,
  not the codebase.
- **This document itself is not static.** It should be revised the same
  way the Growth section and mobile packaging decisions were made this
  session - driven by a real, current need, not on a calendar schedule.

## 14. Ownership and cadence

- The [quality-intelligence dashboard](./quality_dashboard/) (Phase 2 of
  this project) is the artifact someone actually looks at - not CI logs
  scattered across dozens of runs. Review it after every deploy, and
  weekly regardless of deploy cadence.
- **What triggers a deeper look, not just a glance:** a job's rolling pass
  rate drops below 90%, a previously-quiet area of the codebase shows up
  in the risk-footprint table (high churn, weak test presence) after a
  release, or "days since last fully green run" exceeds a few days.
