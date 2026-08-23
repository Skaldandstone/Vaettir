# QI Platform

A quality intelligence and test case management platform that blends every
testing discipline — unit, functional, contract, instrumentation, smoke,
sanity, regression, e2e, and more — into one system, with an AI agent that
reverse-engineers automated tests back into human-readable BDD test cases.

## Why

Most test case tools force everything into one shape (usually "manual test
case" or "user story"). This platform treats **test plan type** as data, not
a hardcoded enum — new plan shapes (a new compliance form, a bespoke QA
strategy template, a new testing discipline) are added as rows with a JSON
field schema, not migrations. See [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma)
and the built-in types seeded in [`packages/db/prisma/seed.ts`](packages/db/prisma/seed.ts).

## Architecture

TypeScript monorepo (pnpm + Turborepo) so web, mobile, and the AI agent share
one typed contract end-to-end (Postgres → tRPC → web/mobile).

```
apps/
  web/         Next.js web app
  mobile/      Expo (React Native) app — same tRPC contract as web
  api/         Fastify + tRPC API — core domain API
packages/
  db/          Prisma schema + client (single source of truth for the data model)
  core/        Shared domain types: BDD schema, framework detection, zod contracts
  ai-agent/    Reverse-engineering agent (test source -> BDD test case), built on the Claude API
```

## Current scope (v1)

- Core test case management: projects, pluggable test plan types, BDD-normalized
  test cases, requirements/acceptance criteria.
- AI reverse-engineering: paste or upload an automated test file (any
  framework — known frameworks get heuristic detection via `@qi/core`'s
  `detectFramework`, unknown ones fall back to AI-assisted structural
  reading) and get back readable Given/When/Then test cases, linked back to
  the source file/function via `TestCaseSource`.
- Compliance scaffolding: `ComplianceFramework` / `ComplianceControl` models
  with SOC 2, HIPAA, PCI DSS, GDPR, and ISO 27001 seeded — ready to map test
  cases to specific controls.

## Roadmap (not yet built)

- QA testing strategy generation (structured strategy plans: scope, risk
  areas, environments, entry/exit criteria) — `qa-strategy` plan type exists
  in the schema, generation flow is next.
- Smart PR scanning: given a diff, propose which test plans/cases should run
  and flag changed files with no mapped coverage (`RiskFlag` model exists;
  the GitHub App + scanning logic does not yet).
- Release readiness intelligence dashboard: rolls up `TestRun`/`TestResult`
  across CI providers plus `RiskFlag`s per `Release`, against a release's
  acceptance criteria.
- Repo-wide reverse-engineering scans (`ReverseEngineerJob` with
  `REPO_SCAN` input type) rather than one file at a time.
- Custom-framework evaluator library: currently the agent free-reads
  unrecognized frameworks; a feedback loop to turn a repeated custom
  framework into a reusable parser is not yet built.
- Auth/RBAC, org multi-tenancy enforcement, audit log for compliance sign-off.

## Getting started

```bash
cp .env.example .env   # set DATABASE_URL and ANTHROPIC_API_KEY
pnpm install
pnpm db:generate
pnpm --filter @qi/db migrate
pnpm --filter @qi/db seed
pnpm dev
```

- API: http://localhost:4000 (health check at `/health`, tRPC at `/trpc`)
- Web: http://localhost:3000
- Mobile: `pnpm --filter @qi/mobile start` (Expo Go / simulator)

You'll need a Postgres instance reachable at `DATABASE_URL`, and an
`ANTHROPIC_API_KEY` for the reverse-engineering agent
(`packages/ai-agent`).
