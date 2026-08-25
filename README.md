# Vaettir

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
  framework — known frameworks get heuristic detection via `@vaettir/core`'s
  `detectFramework`, unknown ones fall back to AI-assisted structural
  reading) and get back readable Given/When/Then test cases, linked back to
  the source file/function via `TestCaseSource`.
- Compliance scaffolding: `ComplianceFramework` / `ComplianceControl` models
  with SOC 2, HIPAA, PCI DSS, GDPR, and ISO 27001 seeded — ready to map test
  cases to specific controls.
- Auth, RBAC, and org scoping: [Clerk](https://clerk.com) handles identity
  (email/password, with SSO available whenever it's turned on in the Clerk
  dashboard — no code change needed here); this app owns everything Clerk
  doesn't know about — `Organization`/`Membership`/`OrgRole`
  (Owner/Admin/Editor/Viewer/ComplianceAuditor) and seat type
  (`FULL`/`READ_ONLY`). Every tRPC router runs through `protectedProcedure` +
  `requireProjectAccess`, so a project's data is only reachable by members of
  the organization that owns it.
- Seat-based plans: `PlanTier` (Free/Team/Business/Corp) as seeded data, with
  pure seat-limit enforcement in `@vaettir/core`'s `plan.ts` — pricing is
  intentionally left unset until the cost structure is finalized.

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
- Seat management UI, invites, plan upgrade/downgrade, and payment provider
  integration (Phase 12 — the plan/seat *model* exists, the billing product
  around it doesn't yet).
- Audit log for compliance sign-off; data-retention enforcement job (the
  `Organization.dataRetentionYears` field exists, nothing purges on it yet).

## Getting started

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
- An `ANTHROPIC_API_KEY` for the reverse-engineering agent (`packages/ai-agent`)
- A [Clerk](https://clerk.com) application, with `CLERK_SECRET_KEY` (api),
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (web), and
  `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (mobile) set — the same publishable key
  for web and mobile, pointed at the same Clerk app, since both authenticate
  against the same API

- API: http://localhost:4000 (health check at `/health`, tRPC at `/trpc`)
- Web: http://localhost:3000 (sign up, then you'll land on `/onboarding` to
  create your organization)
- Mobile: `pnpm --filter @vaettir/mobile start` (Expo Go / simulator)
