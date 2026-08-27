# Contributing to Vaettir

## Local setup

```bash
# 1. Start Postgres (or point DATABASE_URL at an existing instance you already have)
docker compose up -d postgres

# 2. Configure environment
cp .env.example .env
# fill in ANTHROPIC_API_KEY and the Clerk keys - see README.md's "Getting started" for what each is for

# 3. Install, generate, migrate, seed
pnpm install
pnpm db:generate
pnpm --filter @vaettir/db migrate
pnpm --filter @vaettir/db seed

# 4. Run everything
pnpm dev
```

`docker-compose.yml` only runs Postgres - there's no Redis/queue service
yet because there's no queue (see `ROADMAP.md`'s notes on the in-process
job pollers in `apps/api/src/jobs/`); add one here if that ever changes.

## Before opening a PR

```bash
pnpm typecheck   # every package, via Turborepo
pnpm lint
pnpm test        # unit tests (packages/core, apps/api) - fast, no live services needed
```

`.github/workflows/ci.yml` runs the same three against a real Postgres
service container - matching that locally first saves a round-trip.

Two test suites are **not** part of `pnpm test` and need to be run
manually, deliberately - both cost real money/time per run:

- `pnpm --filter @vaettir/ai-agent test:prompts` - the prompt regression
  suite, real Anthropic API calls. Run this after touching any AI system
  prompt in `packages/ai-agent`.
- `pnpm --filter @vaettir/web test:e2e` - the Playwright suite covering
  the platform itself (dogfooded into Vaettir's own "TCM" project - see
  `apps/web/e2e/README.md`). Needs `CLERK_TEST_EMAIL`/`CLERK_TEST_PASSWORD`
  for a real seeded user and a running dev server.

## Conventions worth knowing before you dig in

- **Test plan types and compliance frameworks are data, not enums.** See
  `packages/db/prisma/schema.prisma`'s `TestPlanType`/`ComplianceFramework`
  models and the seeded rows in `packages/db/prisma/seed.ts` - a new plan
  shape is a new row + a JSON field schema, not a migration.
- **Every protected procedure calls `requireProjectAccess`/`requireOrgRole`**
  (`apps/api/src/trpc.ts`) - there's no router that trusts a client-supplied
  `projectId`/`organizationId` without checking the caller actually belongs
  to it.
- **AI credits are metered at the call site, not the router boundary** -
  see `apps/api/src/services/aiCredits.ts`'s `chargeAiCredits` and how it's
  called right before each real `@vaettir/ai-agent` invocation. A new
  AI-powered feature needs a new entry in `AI_OPERATION_COSTS` and a
  `chargeAiCredits` call before the model gets invoked, not after.
- **Audit-relevant models are append-only by design** - `AuditLog`,
  `ComplianceEvidence`, `ComplianceSignOff`, `AiCreditTransaction` have no
  update/delete mutation anywhere in the API on purpose. A wrong record
  gets superseded by a new one, never edited in place.
- **`ROADMAP.md` is the source of truth for what's actually built**,
  ticket by ticket, including honest notes on what's partial or
  deliberately deferred and why - check there before assuming something
  described in a competitive-analysis or planning doc is or isn't real yet.
