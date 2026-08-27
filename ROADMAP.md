# Vaettir Roadmap

This is the working backlog for the platform beyond the initial scaffold
(see [README.md](README.md) for what's already built: core data model, AI
reverse-engineering MVP, web/mobile/api scaffolding).

Structure: **Phase → Epic → Ticket**. Each ticket has an id (stable enough to
reference in commits/PRs before it exists in Linear), a size estimate
(S = ~1 day, M = ~2-3 days, L = ~1 week, XL = needs breaking down further
before starting), and suggested Linear labels. A machine-readable version of
every ticket below is in [roadmap.csv](roadmap.csv) for bulk import into
Linear (Settings → Import/Export → CSV).

Suggested Linear project-per-phase, with each Epic as a Linear
sub-project/milestone or a label - whichever your workspace convention
prefers.

---

## Phase 0 - Foundations (done)

Shipped in the initial scaffold: monorepo (pnpm/Turborepo), Prisma schema
with pluggable `TestPlanType`/`ComplianceFramework`, BDD-normalized
`TestCase` model, Fastify+tRPC API, Next.js web shell, Expo mobile shell,
AI reverse-engineering MVP (single-file paste → BDD test cases), CI
typecheck workflow. Not re-listed here - see git history.

---

## Phase 1 - Platform Foundations

Auth, multi-tenancy, and hardening the CRUD surface the AI/dashboard
features will sit on top of. Nothing else is safely multi-user without this.

### Epic 1.1 - Auth & Identity
- ✅ **P1-01** (M) Add authentication (NextAuth or Clerk) with email/password + at least one SSO provider (Google Workspace). `labels: area:api, area:web, type:feature` - done via Clerk; SSO provider config is an org-by-org Clerk dashboard setting, not code (see P1-04 for enterprise SAML specifically).
- ✅ **P1-02** (M) Session/JWT handling in the tRPC context; replace `publicProcedure` with `protectedProcedure` across all routers. `labels: area:api, type:security`
- ✅ **P1-03** (L) Role-based access control model: `Owner`, `Admin`, `Editor`, `Viewer`, `ComplianceAuditor` roles scoped per Organization/Project. `labels: area:api, area:db, type:feature`
- **P1-04** (M) SSO/SAML support for enterprise orgs (compliance customers will require this). `labels: area:api, type:feature, compliance` - needs a Clerk Enterprise SSO/SAML connection configured per customer; not started.
- ✅ **P1-05** (S) API keys / service tokens for CI integrations (test result ingestion, PR scanning) that don't go through a human session. `labels: area:api, type:feature`

### Epic 1.2 - Multi-tenancy hardening
- ✅ **P1-06** (M) Enforce `organizationId`/`projectId` scoping in every query via a Prisma middleware or repository layer - audit the existing routers, which currently trust client-supplied `projectId`. `labels: area:api, type:security` - done via `requireProjectAccess`/`requireOrgRole` on every protected procedure, not a Prisma middleware; verified live that a cross-project id is correctly rejected, not just silently trusted.
- ✅ **P1-07** (S) Add `createdById`/`updatedById` audit columns to core models (`TestCase`, `TestPlan`, `Release`, `RiskFlag`). `labels: area:db`
- ✅ **P1-08** (M) Org/project settings UI: members, roles, project repo linking. `labels: area:web, type:feature`
- ✅ **P1-09** (S) Seed script for a demo org/project so new devs and CI have consistent fixture data instead of manually pasting project ids. `labels: dx`

### Epic 1.3 - Core CRUD UI hardening
- ✅ **P1-10** (M) Test case create/edit forms in web, supporting **both authoring formats**: BDD (given/when/then) and the structured step table (`TestCaseStep` - action / expected action-or-data / expected result / expected response, with org-configurable field labels via `Organization.stepFieldLabels`). A test case needs at least one format populated, not necessarily both. `labels: area:web, type:feature`
- ✅ **P1-16** (S) Step field label settings: org settings UI for renaming the four `TestCaseStep` field labels (stored in `Organization.stepFieldLabels`) - the default names ("Test Step", "Expected Action / Data", "Expected Result", "Expected Response") are explicitly placeholders; this is what lets a team make them their own without waiting on a code change. `labels: area:web, type:feature`
- ✅ **P1-11** (M) Test plan create/edit UI, including dynamic form rendering from `TestPlanType.fieldSchema` (JSON Schema → form). `labels: area:web, type:feature`
- ✅ **P1-12** (S) Requirement + AcceptanceCriterion CRUD UI, linkable to test plans. `labels: area:web, type:feature`
- ✅ **P1-13** (M) Bulk operations: tag test cases, bulk move between test plans, bulk archive. `labels: area:web, type:feature`
- ✅ **P1-14** (S) Global search across test cases/plans (Postgres full-text to start; revisit if scale demands a search index). `labels: area:api, area:web` - done via case-insensitive substring match; full-text is the noted future upgrade once relevance ranking matters.
- **P1-15** (M) Replace ad-hoc `useEffect` fetch patterns in web with `@trpc/react-query` for caching/invalidation (current pages do manual state, fine for a scaffold, not for a real app). `labels: area:web, type:tech-debt` - still open; broad-blast-radius refactor across every page, deliberately left for a supervised session rather than done unattended.

---

## Phase 2 - AI Reverse-Engineering at Scale

The MVP does one pasted file at a time, synchronously. This phase makes it a
real ingestion pipeline.

### Epic 2.1 - Repo-wide scanning
- ✅ **P2-01** (L) `ReverseEngineerJob` worker: background queue (BullMQ + Redis, or a simple Postgres-backed job table to start) processing `REPO_SCAN` jobs file-by-file. `labels: area:api, type:feature` - Postgres-backed (in-process poller), not BullMQ/Redis; matches the "start simple" framing, revisit only if it needs to scale beyond one API process.
- ✅ **P2-02** (M) GitHub repo connector: clone/checkout a repo (or use the Contents API) given a `Project.repoUrl`, walk test-file glob patterns per detected framework. `labels: area:api, type:feature, integration:github`
- ✅ **P2-03** (S) Job status UI: progress bar, per-file results, retry-failed-files. `labels: area:web, type:feature`
- ✅ **P2-04** (M) Deduplication: re-running a scan on an unchanged file should not create duplicate `TestCase`s - key on `(filePath, functionName)` + content hash, update in place if the source changed. `labels: area:api, type:feature`
- ✅ **P2-05** (M) Diff-aware re-scan: on a new commit, only re-run the agent on changed test files (uses the same file-list logic Phase 6's PR scanner needs - build this once, share it). `labels: area:api, type:feature` - `changeImpact.ts`'s clone/resolve-ref logic is shared, not duplicated, exactly as this ticket asked.

### Epic 2.2 - Quality & feedback loop
- ✅ **P2-06** (M) Human review workflow for AI-reverse-engineered test cases: `PENDING_REVIEW` → `APPROVED`/`REJECTED` status, diff view (AI output vs. edited-by-human). `labels: area:web, area:api, type:feature`
- **P2-07** (M) Edit-and-resubmit: when a human edits an AI-generated test case, capture that as a labeled example; periodically review edit patterns to tighten the system prompt. `labels: area:ai, type:feature`
- ✅ **P2-08** (S) Confidence-based triage: auto-surface all test cases below a configurable confidence threshold into a review queue. `labels: area:web, type:feature` - the review queue (`testCases.pendingReview`) already surfaces every AI case awaiting a decision, sorted lowest-confidence-first; no separate numeric cutoff exists to configure, but the triage-ordering intent is met.
- **P2-09** (M) Batch cost/latency controls: chunk large files, cap concurrent agent calls, add per-org rate limiting on reverse-engineering jobs. `labels: area:ai, type:infra` - per-org rate limiting done (200 jobs/hour, rolling window); concurrent-call capping already existed (the worker processes one job at a time, globally); chunking large files is still not built (they're currently skipped outright above `MAX_FILE_BYTES`, not chunked and processed).
- **P2-10** (S) Prompt regression test suite: a fixed set of sample test files (one per known framework) with expected BDD output, run in CI to catch prompt-change regressions. `labels: area:ai, type:testing` - *(delightfully recursive: this is a test suite for the thing that writes test cases)*

### Epic 2.3 - Multi-format input
- ✅ **P2-11** (M) File upload support (not just paste) - zip of a test directory, single file upload. `labels: area:web, type:feature`
- ✅ **P2-12** (S) Postman/Newman collection import → BDD (structurally different from code-based frameworks: request/assertion pairs, not functions). `labels: area:ai, type:feature` - extracts each request's `pm.test(...)` assertions; a request with no test script is skipped.
- ✅ **P2-13** (M) Gherkin/`.feature` file import - these are already BDD; this path validates/normalizes into the schema rather than inferring from scratch, and should reuse far less of the agent. `labels: area:ai, type:feature` - plain parser, zero LLM calls, exactly as scoped.

---

## Phase 3 - Compliance & Governance

This is the platform's differentiator per your original brief: don't
shoehorn compliance into generic test plans.

### Epic 3.1 - Framework & control management
- ✅ **P3-01** (M) Compliance framework/control admin UI: browse seeded frameworks (SOC 2, HIPAA, PCI DSS, GDPR, ISO 27001), add custom frameworks/controls. `labels: area:web, compliance`
- **P3-02** (L) Import well-known control sets from structured sources (AICPA TSC for SOC 2, NIST CSF, etc.) rather than hand-seeding - build an importer, not just static seed data, since these get revised. `labels: area:api, compliance`
- ✅ **P3-03** (M) Test case ↔ control mapping UI (many-to-many, already modeled via `TestCaseComplianceControl`) with coverage-per-control view: "which controls have zero mapped test cases." `labels: area:web, compliance`
- ✅ **P3-04** (S) Control coverage report export (PDF/CSV) for auditor handoff. `labels: area:web, compliance, type:feature` — shipped CSV export (`compliance.exportReport` + a client-side CSV button on the compliance page). Lists every control's mapped test cases with review status, and flags zero-mapped controls as gaps in a dedicated column. PDF was skipped: CSV is what most auditors actually want to import into their own tooling, and adding a PDF renderer is a real dependency for marginal benefit - can revisit if requested. Verified against live Kall data: mapped control correctly listed the test case + status, unmapped control came back with an empty array (the gap case).

### Epic 3.2 - Evidence & audit trail
- **P3-05** (L) Evidence attachment model: link a `TestResult` (a passing execution) as evidence for a control, with immutable timestamped record. `labels: area:db, area:api, compliance`
- ✅ **P3-06** (M) Full audit log (who changed what test case/plan/control mapping, when) - required for most compliance frameworks' own controls around change management. `labels: area:api, area:db, compliance` — shipped as a new append-only `AuditLog` model (no update/delete mutation exposed - an editable audit log defeats its own purpose) with a `recordAudit()` helper called from test case create/quickCreate/update/delete/approve/reject, test plan create/update, and compliance mapTestCase/unmapTestCase. A new project-scoped Audit Log page lists entries reverse-chronologically with an entity-type filter. Scoped to the mutations an auditor actually asks about rather than every mutation in the app; skipped `createFramework`/`createControl` since those are global shared reference data with no project/org to attach the log entry to, not something the "who changed this project's stuff" trail is about. Verified against live Kall data: create/edit/approve/map/unmap/delete on a real test case each produced the correct entry in the correct order, and the entity-type filter correctly isolated the mapping events.
- P3-05 (evidence attachment linking a `TestResult` to a control) not started: skipped for now because there are zero `TestResult` rows in the live database - execution ingestion (Phase 5) hasn't been built yet, so the feature would have nothing real to link and no way to verify it against live data. Revisit once Phase 5 lands.
- **P3-07** (M) Sign-off workflow: a `ComplianceAuditor` role can formally approve a control's evidence for a given period/release, with a durable signed record. `labels: area:web, area:api, compliance`
- **P3-08** (S) Retention policy configuration per org (how long evidence/audit logs are kept), since different frameworks mandate different retention windows. `labels: area:api, compliance`

### Epic 3.3 - Custom compliance plan types
- **P3-09** (M) "Add your own compliance form" flow: org admin defines a new `TestPlanType` (category `COMPLIANCE`) with a custom `fieldSchema` via a form builder, no code change required - this is the feature that proves the "don't shoehorn" design decision actually works end-to-end. `labels: area:web, area:api, compliance, type:feature`
- **P3-10** (S) Template library: starter field schemas for common internal audit / vendor-security-questionnaire style plans, so "custom" doesn't mean "start from a blank JSON Schema." `labels: area:web, compliance`

---

## Phase 4 - QA Testing Strategy Generation

Structured strategy plans (scope, risk areas, environments, entry/exit
criteria - the Testlio-style structure referenced in the original brief).
`qa-strategy` plan type already exists in the schema; this phase builds
generation + the UI around it.

- **P4-01** (M) Strategy plan authoring UI rendering the `qa-strategy` field schema (risk areas, environments, entry/exit criteria) as a structured, guided form rather than raw JSON. `labels: area:web, type:feature`
- **P4-02** (L) AI-assisted strategy generation: given a project's codebase summary (languages, frameworks detected, existing test coverage) plus a short prompt from the user ("we're shipping payments in Q3"), draft a starter strategy plan. `labels: area:ai, type:feature`
- **P4-03** (M) Risk-area inference: cross-reference `RiskFlag`s, historical `TestResult` failure rates, and compliance control gaps to suggest risk areas automatically rather than requiring the user to type them from scratch. `labels: area:ai, area:api, type:feature`
- **P4-04** (M) Strategy-to-plan linking: a QA strategy should be able to spawn/reference concrete `TestPlan`s (e.g. "regression plan for payments") so the strategy isn't just a document but an actual coordination hub. `labels: area:api, area:db, type:feature`
- **P4-05** (S) Strategy plan versioning/history (strategies evolve release to release; need to see what changed). `labels: area:db, area:api, type:feature`
- **P4-06** (M) Exit-criteria tracking dashboard: live status of each strategy's exit criteria against current test/coverage data. `labels: area:web, type:feature` - *(this is a preview of the Phase 7 dashboard, scoped to one strategy)*

---

## Phase 5 - Execution Ingestion & Framework Evaluators

Blending real test results from many frameworks/CI systems into the
platform, and moving known frameworks off pure-LLM parsing onto real
parsers for speed/cost/determinism.

### Epic 5.1 - Result ingestion
- **P5-01** (M) Generic JUnit XML ingestion endpoint (the de facto universal format - Jest, pytest, Go, Cypress, Playwright, and most CI systems can all emit or convert to it). `labels: area:api, type:feature`
- **P5-02** (S) GitHub Actions integration: a reusable workflow step/action that posts `TestRun`/`TestResult`s to the API at the end of a CI run. `labels: integration:github, type:feature`
- **P5-03** (M) CircleCI + Jenkins ingestion adapters (translate their native result formats/webhooks to the same `TestRun` shape). `labels: area:api, type:feature`
- **P5-04** (M) Test result ↔ `TestCase` matching: map an incoming `externalTestId` (e.g. `"CartTest::test_empty_checkout_throws"`) to an existing `TestCase.source` record via `TestCaseSource.externalTestId`; surface unmatched results for manual linking when auto-onboarding (`P5-14`) is off or low-confidence. `labels: area:api, type:feature`
- **P5-05** (S) Flaky test detection: flag a `TestCase` as flaky when its results alternate PASS/FAIL across runs on the same commit/branch beyond a threshold. `labels: area:api, type:feature`
- **P5-06** (M) Coverage data ingestion (Istanbul/nyc, coverage.py, JaCoCo) - separate from pass/fail results, feeds the release-readiness coverage-gap logic in Phase 7. `labels: area:api, type:feature`
- **P5-15** (M) **Failure evidence capture**: a thin reporter/plugin for the major front-end test runners (Playwright, Cypress, WebdriverIO) that captures a screenshot on every run and, for video, keeps a rolling trailing buffer - but only *uploads* either as a `TestResultArtifact` when the test actually fails. Passing runs discard the capture immediately, so this doesn't quietly balloon storage. Headless/no-display runs simply produce nothing, which is the expected case, not an error. Schema (`TestResultArtifact`, types `SCREENSHOT`/`VIDEO`) is already in place; this ticket is the runner-side capture + the ingestion endpoint's multipart upload path (built alongside `P5-01`). `labels: area:api, type:feature`
- **P5-14** (L) **Continuous coverage listening**: when a `TestResult` arrives with no `TestCaseSource` match (`P5-04`), don't just queue it for manual linking - fetch that test's source via the repo connector (`P2-02`, using `TestResult.externalFilePath` + the run's commit sha) and auto-enqueue a scoped `ReverseEngineerJob` (`inputType: CI_UNMATCHED_RESULT`) against just that file/function. The resulting `TestCase` lands in the same AI-review queue as any other reverse-engineered case (`P2-06`), and on success its `TestCaseSource.externalTestId` is set so the *next* run of that test matches immediately instead of re-flagging. This is what turns reverse-engineering from something someone has to remember to run into a standing guarantee: every test CI actually executes ends up with a readable counterpart, without a human ever pasting anything in. Depends on `P2-02` (repo connector) and `P2-01`'s job worker. `labels: area:api, area:ai, type:feature`

### Epic 5.2 - Native framework evaluators
- **P5-07** (L) Native JS/TS parser (via `@babel/parser` or `ts-morph`) for Jest/Vitest/Mocha structure extraction - pulls `describe`/`it` blocks, assertions, and test names deterministically, then hands only the extracted structure to the AI agent for BDD phrasing (cheaper, faster, more reliable than raw-source-to-agent for well-known frameworks). `labels: area:ai, type:feature, perf`
- **P5-08** (L) Native Python parser (`ast` module via a small Python microservice, or a JS-side heuristic) for pytest structure extraction. `labels: area:ai, type:feature`
- **P5-09** (M) Native JUnit/TestNG (Java) annotation-based extraction. `labels: area:ai, type:feature`
- **P5-10** (M) Cypress/Playwright structural extraction (these are JS, so likely shares P5-07's parser with framework-specific step detection for `cy.*`/`page.*` calls). `labels: area:ai, type:feature`
- **P5-11** (S) Framework evaluator registry/interface so adding a new native evaluator is a plugin, not a router change - formalizes the fallback-to-AI path that already exists conceptually in `@vaettir/core`'s `detectFramework`. `labels: area:core, type:architecture`

### Epic 5.3 - Custom framework evaluation
- **P5-12** (M) "Teach the platform your framework" flow: user provides 2-3 example test files from their custom/internal framework; the agent infers the structural pattern (how are test names decided? assertions? setup/teardown?) and the platform stores that as a reusable per-project heuristic instead of re-inferring from scratch every file. `labels: area:ai, type:feature`
- **P5-13** (S) Custom framework confidence tracking + prompt to "graduate" a well-understood custom framework into a saved evaluator config. `labels: area:ai, type:feature`

---

## Phase 6 - Smart PR Scanning

Given a diff, propose which test plans/cases should run and flag coverage
gaps. This is the feature that connects "what changed" to "what should be
tested," and feeds Phase 7's risk flags.

- **P6-01** (L) GitHub App: install on a repo, receive `pull_request` webhooks (opened/synchronize), verify webhook signatures. `labels: integration:github, type:feature, area:api`
- **P6-02** (M) Diff analysis: fetch changed files for a PR, map file paths to existing `TestCaseSource.filePath`s to find directly-affected test cases. `labels: area:api, type:feature`
- **P6-03** (L) Coverage-gap detection: changed files/functions with no mapped `TestCaseSource` at all → create a `RiskFlag` (`source: PR_SCAN_COVERAGE_GAP`) with severity based on file criticality (e.g. payments/auth paths weighted higher - configurable per project). `labels: area:api, type:feature`
- **P6-04** (L) AI-assisted test plan recommendation: given the diff (not just file paths - actual changed code), ask the agent which existing test plans are relevant and whether new test cases are warranted, returned as a structured recommendation. `labels: area:ai, type:feature`
- **P6-05** (M) PR comment bot: post the recommendation (relevant test plans, coverage gaps, suggested new test cases) as a GitHub PR comment. `labels: integration:github, type:feature`
- **P6-06** (S) Configurable PR scan policy per project (which branches trigger scans, risk-weighting rules, comment vs. silent-flag-only mode). `labels: area:web, type:feature`
- **P6-07** (M) GitLab equivalent (merge request webhooks) - once the GitHub path is proven, this should mostly be adapter work if P6-01 through P6-05 are built with the provider abstracted. `labels: integration:gitlab, type:feature`

---

## Phase 7 - Release Readiness & Quality Intelligence Dashboard

The rollup: CI/CD release-to-release visibility, coverage against defined
release acceptance criteria, and risk highlighting.

Split across two pages rather than one: **Test Strategy** (pre-execution -
risk, mitigations, coverage, run recommendations; what used to be
`risk-analysis`) leads into **Release Readiness** (post-execution - how
well a release adhered to that plan, actual results and readiness now).

### Epic 7.1 - Release model & acceptance tracking
- ✅ **P7-01** (M) Release management UI: create/manage `Release`s, attach `TestPlan`s (including a `release-readiness` typed plan) and acceptance criteria. `labels: area:web, type:feature`
- **P7-02** (M) Live acceptance-criteria status: each `AcceptanceCriterion` auto-computes `MET`/`NOT_MET`/`AT_RISK` from underlying test results rather than requiring manual status updates. `labels: area:api, type:feature` - still manual (editable dropdown on the readiness page); auto-computing from `TestResult` needs the Phase 5 result-matching pipeline first.
- ✅ **P7-03** (S) Release readiness score: single rollup number/traffic-light per release from criteria status + open risk flags + compliance control coverage. `labels: area:api, type:feature` - explainable weighted formula (criteria completion minus severity-weighted open-flag penalty, any open CRITICAL forces BLOCKED); compliance control coverage isn't factored in yet.

### Epic 7.2 - Dashboard
- ✅ **P7-04** (L) Release readiness dashboard page: readiness score, acceptance criteria checklist, open risk flags (from PR scanning + coverage gaps + failing/flaky tests), trend vs. previous releases. `labels: area:web, type:feature` - trend vs. previous releases not built (see P7-07).
- ✅ **P7-05** (M) Granular drill-down: from the dashboard, click into any risk flag/failing test/uncovered file down to the actual `TestCase`/`TestCaseSource`. `labels: area:web, type:feature` - test plans/cases link through; individual risk-flag-to-source-line drill-down not built.
- **P7-06** (M) Holistic cross-project view: an org-level dashboard rolling up readiness across all projects/releases (useful once you have more than one team). `labels: area:web, type:feature`
- **P7-07** (M) Release-to-release trend charts: pass rate, flaky test count, coverage %, mean time-to-green over the last N releases. `labels: area:web, type:feature`
- **P7-08** (S) Configurable release gates: block a release status from moving to `READY` while criteria are unmet (soft warning vs. hard block, per-org policy). `labels: area:api, type:feature`
- **P7-09** (M) Slack/email digest: daily or pre-release readiness summary pushed to a channel. `labels: integration:slack, type:feature`

---

## Phase 8 - Mobile Parity

The mobile app is currently a read-only test-case list stub.

- **P8-01** (M) Auth in mobile (shares Phase 1's auth, native login flow). `labels: area:mobile, type:feature`
- **P8-02** (M) Test case detail + BDD view in mobile (parity with web's detail page). `labels: area:mobile, type:feature`
- **P8-03** (L) Release readiness dashboard, mobile-adapted view - the highest-value mobile use case is likely "check release status from your phone," not full authoring. `labels: area:mobile, type:feature`
- **P8-04** (M) Push notifications for release-readiness state changes / compliance sign-off requests. `labels: area:mobile, type:feature`
- **P8-05** (M) Mobile approval flows: compliance sign-off and AI-reverse-engineered test case review, approvable from mobile. `labels: area:mobile, type:feature`
- **P8-06** (S) Offline-friendly read caching for test case browsing (spotty connectivity shouldn't blank the app). `labels: area:mobile, type:feature`
- **P8-07** (M) App store submission prep (iOS/Android): icons, splash, privacy manifest, EAS build config. `labels: area:mobile, type:infra`

---

## Phase 9 - Integrations & Ecosystem

- **P9-01** (M) Jira integration: link `Requirement`s to Jira issues bidirectionally, sync status. `labels: integration:jira, type:feature`
- **P9-02** (M) Linear integration: same as above for teams using Linear for requirements (note: distinct from *using* Linear to track this platform's own build - this is the product feature). `labels: integration:linear, type:feature`
- **P9-03** (S) Slack notifications: configurable events (new risk flag, review-queue item, sign-off request) → Slack channel. `labels: integration:slack, type:feature`
- **P9-04** (M) Datadog/PagerDuty linkage: connect a production incident to the test plan/case that should have caught it, closing the loop from incident → coverage gap → new test case. `labels: integration:datadog, integration:pagerduty, type:feature`
- **P9-05** (L) Public API + API docs (OpenAPI/tRPC-to-OpenAPI) for orgs wanting to build their own integrations. `labels: area:api, type:feature`
- **P9-06** (M) Webhook system (outbound) so external systems can react to platform events without polling. `labels: area:api, type:feature`
- **P9-07** (L) Zapier/Make.com app listing, once the webhook system exists - lower priority, only worth it after real integration demand shows up. `labels: integration:zapier, type:feature`

---

## Phase 10 - Platform Hardening

Things that stop mattering less as the platform gets real users and real
compliance customers.

### Epic 10.1 - Security & compliance (of the platform itself)
- **P10-01** (L) The platform will itself need SOC 2 (customers storing compliance evidence here will ask). Start the control implementation early - logging, access review, vendor management - not as an afterthought. `labels: compliance, type:infra`
- **P10-02** (M) Secrets management audit: `ANTHROPIC_API_KEY`, GitHub App private key, DB credentials - move from `.env` to a proper secrets manager (AWS Secrets Manager / Doppler / Vault) before any production deploy. `labels: type:security, type:infra`
- **P10-03** (M) Dependency/vulnerability scanning in CI (`npm audit`/Snyk/Dependabot) - flag before it's a customer-facing incident. `labels: type:security, type:infra`
- **P10-04** (S) Rate limiting + abuse protection on public-facing endpoints (especially the AI reverse-engineering endpoint - it's a direct line to a paid LLM API). `labels: type:security, area:api`

### Epic 10.2 - Observability & reliability
- **P10-05** (M) Structured logging + error tracking (Sentry) across api/web/mobile. `labels: type:infra`
- **P10-06** (M) Metrics/tracing (OpenTelemetry) - especially around AI agent latency/cost, since that's the most expensive and most failure-prone path. `labels: type:infra`
- **P10-07** (S) Uptime/health checks + alerting for the API and the job worker (Phase 2's queue). `labels: type:infra`
- **P10-08** (M) Database backup/restore runbook + tested recovery process - before there's real customer data to lose. `labels: type:infra`

### Epic 10.3 - Deployment & DX
- **P10-09** (M) Production deployment pipeline (pick a target: Vercel for web, Fly.io/Render/ECS for api+worker, EAS for mobile) with staging + prod environments. `labels: type:infra`
- **P10-10** (S) Full CI: extend the current typecheck-only workflow to run lint, unit tests, and (once P1 auth exists) integration tests against a real Postgres service container. `labels: type:infra, dx`
- **P10-11** (M) Unit + integration test suite for the API routers and the AI agent's parsing logic - the platform that manages tests should not itself be undertested. `labels: type:testing, dx`
- **P10-12** (S) Local dev docs: one-command local setup (`docker-compose` for Postgres + Redis once the job queue exists), contribution guide. `labels: dx`
- **P10-13** (M) Design system / shared UI package (`packages/ui`) once web has enough screens that inconsistency becomes visible - don't build this speculatively before then. `labels: area:web, type:tech-debt`

---

## Phase 11 - Migration & Import

We're asking teams to switch off an entrenched incumbent (TestRail,
Zephyr, qTest, Xray, PractiTest - see
[COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) for what each does
well and what their users complain about). The switching cost is real
existing test cases, real suite/plan structure, and real run history -
a migration path that loses any of those isn't a migration path.
`ReverseEngineerJob` (Phase 2) is the template: a typed job with status
tracking that a background worker processes; import jobs follow the
same shape.

### Epic 11.1 - Import pipeline foundation
- **P11-01** (L) Generic `ImportJob` model + pipeline: source enum, status tracking, field-mapping config stored as JSON, dedupe-by-external-id - the shared foundation every source-specific importer plugs into. `labels: area:db, area:api, type:feature`
- **P11-02** (M) Field-mapping UI: preview parsed records against target `TestCase`/`TestPlan` fields, let the user adjust mapping and custom-field targets before committing - nothing writes until confirmed. `labels: area:web, type:feature`

### Epic 11.2 - Source-specific importers
- **P11-03** (L) TestRail importer: cases/suites/sections → `TestPlan`/`TestCase`, runs/results → `TestRun`/`TestResult`, via TestRail's REST API (`get_cases`/`get_suites`/`get_runs`/`get_results`). Build this first - it's the best-documented API in the category and the lowest-risk way to prove the import pipeline itself. `labels: area:api, integration, type:feature`
- **P11-04** (L) Zephyr Scale (Jira) importer: test cases/cycles/executions via the Zephyr Scale REST API v2, folder structure → `TestPlan` hierarchy. Highest-complaint-volume source platform (see competitive analysis), so highest-value migration target despite a less uniform API than TestRail's. `labels: area:api, integration, type:feature`
- **P11-05** (M) Xray (Jira) importer: bulk CSV/JSON export via a JQL query → `TestCase`/`TestPlan`. Automation *result* ingestion is already covered by Phase 5's generic Cucumber/JUnit/NUnit ingestion - that's the same format Xray itself consumes. `labels: area:api, integration, type:feature`
- **P11-06** (L) qTest importer: `test-cases`/`test-runs`/`test-logs` resources via the qTest REST API v3, module hierarchy → `TestPlan` hierarchy. `labels: area:api, integration, type:feature`
- **P11-07** (M) Generic CSV/Excel importer with a reusable column-mapping template - the catch-all for PractiTest, TestLink, and any spreadsheet-tracked suite without a first-class importer. `labels: area:api, area:web, type:feature`

### Epic 11.3 - Historical run data
- **P11-08** (L) Historical run-data backfill: import pass/fail execution history with *original* timestamps (not import date), so pass-rate trends, flaky-test detection (`P5-05`), and release-to-release charts (`P7-07`) aren't empty or skewed on day one. A cold-start dashboard with no history is itself an adoption blocker. `labels: area:api, type:feature`

### Epic 11.4 - Migration UX
- **P11-09** (M) Post-import diff/summary report: what imported cleanly, what was skipped or ambiguous and needs manual review, what dedupe collisions were found. `labels: area:web, type:feature`
- **P11-10** (M) "Migration assistant" wizard: connect source credentials → scope preview (counts of what will import) → field mapping → import → diff report, as one guided flow rather than disconnected tools. `labels: area:web, type:feature`
- **P11-11** (S) Import job re-run/incremental sync: re-running an import against the same source only pulls new/changed records (reuses `P11-01`'s external-id dedupe) - supports running in parallel with the old tool during a phased migration instead of forcing a hard cutover. `labels: area:api, type:feature`

---

## Phase 12 - Billing, Plans & Seats

Seat-based SaaS pricing. Schema already landed (`PlanTier`, `Membership`
with `seatType: FULL | READ_ONLY`, `Organization.planTierId`,
`Organization.dataRetentionYears`) and seeded with the tier boundaries as
specified: **Free** (≤3 full seats, 0 read-only seats), **Team** (4–50 full
seats, 10 included read-only seats), **Business** (51–75), **Corp** (76+).
Per-seat pricing is deliberately left null in the seed data - cost
structure isn't decided yet; `packages/core/src/plan.ts` already has the
pure seat-limit logic (`canAddSeat`, `minimumTierForSeatCount`) ready for
whatever billing provider gets wired in.

### Epic 12.1 - Seat management
- **P12-01** (M) Seat management UI: org settings page listing members, their role, and seat type (full/read-only), with add/remove/change-seat-type actions gated through `canAddSeat`. `labels: area:web, type:feature`
- **P12-02** (M) Invite flow: invite by email to a specific role + seat type; invite acceptance creates the `Membership` only after `canAddSeat` passes, with a clear "seat limit reached, upgrade to invite more people" state rather than a silent failure. `labels: area:web, area:api, type:feature`
- **P12-03** (S) Read-only seat UI enforcement: a `VIEWER`-role, `READ_ONLY`-seat member should not see edit/create affordances anywhere in the UI, not just be blocked server-side - the seat type is a product experience, not only a permission check. `labels: area:web, type:feature`

### Epic 12.2 - Plan lifecycle
- **P12-04** (M) Plan upgrade/downgrade flow: changing `Organization.planTierId`, validated against current seat counts (can't downgrade below what's actually seated - surface which seats would need to be removed first). `labels: area:api, area:web, type:feature`
- **P12-05** (L) Payment provider integration (Stripe is the default assumption pending a final decision) once pricing is set: subscription creation, seat-count-driven quantity updates, webhook-driven plan sync so `PlanTier` stays the source of truth for entitlements while the provider stays the source of truth for money. `labels: area:api, integration, type:feature`
- **P12-06** (S) Usage/seat-count dashboard for org admins: current seats used vs. included at this tier, a clear "you're at 9/10, next seat requires Team" style prompt before someone hits a wall mid-invite. `labels: area:web, type:feature`

### Epic 12.3 - Plan-gated features & data retention
- **P12-07** (M) Feature-flag-by-tier plumbing: a simple `planTier.key -> Set<featureFlag>` lookup (data, not scattered `if` checks) so specific tiers can gate specific feature sets once those are mapped - deliberately built as an empty, ready-to-fill table now rather than hardcoded later. `labels: area:api, type:architecture`
- **P12-08** (L) Data retention enforcement job: a scheduled job that purges/archives data older than `Organization.dataRetentionYears` (default 5) - evidence, audit logs, test results - respecting the higher retention windows compliance-heavy orgs may configure (`P3-08`). This is a real deletion job, not just a documented policy, and needs a dry-run mode and an audit trail of its own before it's trusted to run automatically. `labels: area:api, compliance, type:feature`
- **P12-09** (S) Retention policy surfaced in the compliance UI: show an org's actual configured retention window next to the evidence/audit views it governs (`P3-01`), so it isn't a number nobody can see outside the database. `labels: area:web, compliance`

---

## Suggested sequencing

This is a lot of surface area; the phases aren't strictly sequential, but a
reasonable dependency-respecting order is:

1. **Phase 1** (auth/multi-tenancy) unblocks almost everything else safely shipping to real users. `P1-01`/`P1-02`/`P1-03`/`P1-06` are built (email+password auth, JWT sessions, `Membership`-based RBAC, real org/project scoping on every router) - `P1-04` (SSO/SAML), `P1-05` (API keys), `P1-07`–`P1-15` (audit columns, settings UI, CRUD forms, search) are still open.
2. **Phase 2 + Phase 5** (ingestion pipeline + evaluators) in parallel - both are "make the AI/data layer real" work.
3. **Phase 3** (compliance) can start as soon as Phase 1 lands roles - it's largely independent of Phase 2/5/6.
4. **Phase 6** (PR scanning) depends on Phase 5's result-matching to be useful, and feeds Phase 7 directly.
5. **Phase 7** (dashboard) is the payoff phase - hold it until Phase 3/5/6 have real data flowing in, or it'll be a dashboard with nothing to show.
6. **Phase 4** (QA strategy generation) can slot in anytime after Phase 1; it's largely self-contained.
7. **Phase 8/9** (mobile parity, integrations) are pull-based - build them once specific customers/use cases demand them, not speculatively.
8. **Phase 10** (hardening) isn't "last" - P10-01 through P10-04 should start the moment there's real customer data, likely alongside Phase 3.
9. **Phase 11** (migration/import) isn't "last" either, despite the number - `P11-01`/`P11-02` (the import pipeline foundation) and `P11-03` (the TestRail importer) should start as soon as Phase 1's auth/multi-tenancy lands, since customer acquisition depends on painless switching, not on every other phase being done first. The historical-run-backfill piece (`P11-08`) benefits from Phase 5's `TestRun`/`TestResult` ingestion work existing first, but the case/plan importers don't need to wait for it.
10. **Phase 12** (billing/seats) - schema and enforcement logic are already in (see above), so `P12-01`–`P12-03` (seat management UI, invites, read-only UI enforcement) can build directly on the now-real auth/RBAC layer. `P12-05` (payment provider integration) is explicitly blocked on a cost-structure decision, not on engineering sequencing - don't start it until pricing is set. `P12-08` (retention enforcement job) should land before Phase 10's SOC 2 work (`P10-01`) closes out, since "we retain data for 5 years" is itself a control an auditor will ask to see enforced, not just documented.
