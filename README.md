# Vaettir

A quality intelligence and test case management platform that blends every
testing discipline - unit, functional, contract, instrumentation, smoke,
sanity, regression, e2e, and more - into one system, with an AI agent that
reverse-engineers automated tests back into human-readable BDD test cases,
scans PRs for coverage gaps, and rolls execution results up into a
release-readiness dashboard.

See [ROADMAP.md](ROADMAP.md) for the full, ticket-by-ticket build status
(what's shipped, what's partially built, what's deliberately deferred and
why) and [PRICING.md](PRICING.md) for the seat/AI-credit pricing model.

## Why

Most test case tools force everything into one shape (usually "manual test
case" or "user story"). This platform treats **test plan type** as data, not
a hardcoded enum - new plan shapes (a new compliance form, a bespoke QA
strategy template, a new testing discipline) are added as rows with a JSON
field schema, not migrations. See [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma)
and the built-in types seeded in [`packages/db/prisma/seed.ts`](packages/db/prisma/seed.ts).

## Architecture

TypeScript monorepo (pnpm + Turborepo) so web, mobile, and the AI agent share
one typed contract end-to-end (Postgres → tRPC → web/mobile).

```
apps/
  web/         Next.js web app
  mobile/      Expo (React Native) app - currently a read-only stub, see ROADMAP.md Phase 8
  api/         Fastify + tRPC API - core domain API, GitHub App webhook receiver, in-process job schedulers
packages/
  db/          Prisma schema + client (single source of truth for the data model)
  core/        Shared domain types: BDD schema, framework detection, seat/plan/feature-flag logic, importers, tests
  ai-agent/    Claude-based agent: reverse-engineering, risk assessment, strategy generation, PR-diff recommendations, failure classification
```

## What's built

The short version: everything from AI reverse-engineering through PR
scanning, self-healing suggestions, compliance evidence/sign-off, release
readiness, and seat/AI-credit billing is real and running. See ROADMAP.md
for exact ticket status - the highlights:

- **Core test case management** - projects, pluggable test plan types,
  BDD-normalized test cases (plus a structured step-table authoring format),
  requirements/acceptance criteria, bulk operations, global search.
- **AI reverse-engineering at scale** - paste/upload/repo-scan/zip-upload a
  test file (known frameworks get native structural parsing via
  `@vaettir/core`'s evaluators - Jest/Vitest/Mocha/Cypress/Playwright,
  pytest, JUnit/TestNG; unknown ones fall back to AI-assisted reading, with
  a "teach it your custom framework" heuristic loop), get back readable
  Given/When/Then test cases linked to their source. Gherkin (`.feature`)
  and Postman collection imports are plain parsers, not LLM calls. A prompt
  regression suite (`packages/ai-agent/scripts/promptRegression.ts`) guards
  against system-prompt regressions.
- **Compliance** - `ComplianceFramework`/`ComplianceControl` (SOC 2, HIPAA,
  PCI DSS, GDPR, ISO 27001 seeded, plus custom frameworks/controls),
  test-case-to-control mapping, an immutable evidence ledger
  (`ComplianceEvidence`), formal `ComplianceAuditor` sign-offs
  (`ComplianceSignOff`), a full append-only audit log, CSV coverage export,
  and configurable org data-retention policy with a read-only dry-run
  report of what's currently past the retention window (no purge job yet -
  deliberately not built unattended, see ROADMAP.md's P12-08 entry).
- **Execution ingestion** - JUnit XML ingestion (`testRuns.ingestJUnit`),
  flaky-test detection, coverage report ingestion (Istanbul/Cobertura/
  JaCoCo), CI integration scripts/GitHub Action for the common providers.
- **Smart PR scanning** - a real registered GitHub App receives
  `pull_request` webhooks, diffs changed files against tracked test
  sources, flags coverage gaps with configurable path-based severity, asks
  the agent which existing test plans/cases are relevant to a diff, and
  posts the result as a PR comment - all gated by a per-project scan
  policy.
- **Suggest-only test self-healing** - classifies a failing, previously-
  passing test as likely-brittle vs. a real regression by diffing its
  source between the last-passing and failing commits, and for a confident
  brittle case proposes a fix. Never touches the repo or opens a PR; every
  suggestion is a human-reviewed approve/reject in the UI.
- **Release readiness & quality intelligence** - releases with acceptance
  criteria that auto-compute their status live from real test results, an
  explainable readiness score, configurable release gates (soft-warn vs.
  hard-block a `READY` transition), an org-wide cross-project dashboard,
  release-to-release trend charts (pass rate, coverage, flaky count, mean
  time-to-green), and an optional daily/on-demand Slack readiness digest.
- **Migration** - a generic CSV test-case importer for teams switching off
  a spreadsheet-tracked suite (TestRail/Zephyr/Xray/qTest-specific
  importers are on the roadmap, not yet built).
- **Auth, RBAC, and org scoping** - [Clerk](https://clerk.com) handles
  identity (email/password, with SSO available whenever it's turned on in
  the Clerk dashboard); this app owns everything Clerk doesn't know about -
  `Organization`/`Membership`/`OrgRole`
  (Owner/Admin/Editor/Viewer/ComplianceAuditor) and seat type
  (`FULL`/`READ_ONLY`). Every tRPC router runs through `protectedProcedure`
  + `requireProjectAccess`, so a project's data is only reachable by
  members of the organization that owns it. Service-token API keys exist
  for CI integrations that don't go through a human session.
- **Seats, plans & AI credits** - `PlanTier` (Free/Team/Business/Corp) with
  real seeded pricing (see PRICING.md), seat management + invite flow with
  real seat-limit enforcement, a plan upgrade/downgrade flow validated
  against actual seated usage, a seat-usage dashboard, and an AI-credit
  ledger that meters every real LLM call against a monthly per-tier grant -
  an org that runs out gets a clear refusal, not a surprise bill. Payment
  provider integration (actually charging a card) is not built yet -
  pricing is real and enforced internally, but there's no Stripe checkout.
- **Testing** - Vitest is wired into the monorepo's `pnpm test` → CI
  pipeline, covering the pure business logic (seat limits, readiness
  scoring, framework parsers, CSV import, feature-flag lookup). Router-level
  integration tests and the AI-agent's live-call functions aren't
  unit-tested (the latter isn't meaningfully unit-testable at all - see the
  prompt regression suite above instead).

## Getting started

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full local-dev walkthrough
(including a `docker-compose up -d postgres` if you don't already have a
Postgres instance) and the conventions worth knowing before you dig in.
Quick version:

```bash
cp .env.example .env   # set DATABASE_URL, ANTHROPIC_API_KEY, and the Clerk keys below
pnpm install
pnpm db:generate
pnpm --filter @vaettir/db migrate
pnpm --filter @vaettir/db seed
pnpm dev
```

You'll need:
- A Postgres instance reachable at `DATABASE_URL`
- An `ANTHROPIC_API_KEY` for the AI agent (`packages/ai-agent`) - every
  AI-powered feature (reverse-engineering, risk assessment, PR
  recommendations, failure classification, strategy generation) needs this
- A [Clerk](https://clerk.com) application, with `CLERK_SECRET_KEY` (api),
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (web), and
  `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (mobile) set - the same publishable key
  for web and mobile, pointed at the same Clerk app, since both authenticate
  against the same API
- Optional: `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY`/`GITHUB_WEBHOOK_SECRET`
  for the PR-scanning GitHub App (only needed if you're testing that path)

- API: http://localhost:4000 (health check at `/health`, tRPC at `/trpc`)
- Web: http://localhost:3000 (sign up, then you'll land on `/onboarding` to
  create your organization)
- Mobile: `pnpm --filter @vaettir/mobile start` (Expo Go / simulator)

## Testing

```bash
pnpm test                                              # unit tests (packages/core, apps/api)
pnpm --filter @vaettir/ai-agent test:prompts           # prompt regression suite - real API calls, run manually
```
