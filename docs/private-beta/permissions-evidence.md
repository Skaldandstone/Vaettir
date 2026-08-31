# Permissions lane evidence

Date: 2026-08-30. Branch: codex/beta-permissions. Base checkpoint: a6b5554ddd53cb0e3326264557c0931a00336f6f. The commit containing this document is the lane handoff candidate, not permission to release or invite teams.

## Changes

- Staff ownership transfer, staff member removal, tenant member changes and key revocation now share organization-row serialization. Transfers count live members and reserved invitations. Last-owner removal is rejected. Staff ownership changes and their audit receipts commit together.
- Tenant and staff key revocation share an idempotent implementation. Authorized revocation immediately disables the credential, even if the service account is the sole owner. Only membership/seat cleanup is deferred in that legacy case. Both routes return the original revokedAt plus additive seatCleanupPending and actionRequired fields. Transfer ownership to a human, then repeat revoke to release the retained seat without changing revokedAt. Service accounts cannot be newly promoted, transferred or enrolled as owners.
- API keys are constrained to their issuing organization even if their backing user has another membership. Organization selection applies that effective scope.
- Enrollment operations consistently lock Tier, then Enrollment, then User where applicable. Deterministic database-lock barriers prove both claim-wins and revoke-wins outcomes, no deadlock, and correct cohort slot replacement.
- Monthly grants check both their UTC month idempotency key and bounded calendar interval. Explicit grant timestamps avoid transaction-start timestamps crossing a month boundary. Concurrent grants, charges and staff deductions cannot duplicate or overdraw the append-only ledger.
- Compliance evidence checks the case's project, the result's run project, and the exact case/result pair before writing. Case plan/shared-step references and acceptance-criterion requirements must belong to the authorized project. Historical invalid evidence, shared-step and run/case links are hidden or rejected on the affected reads.
- CI mapping is project-scoped, not merely organization-scoped. A shared project lock serializes ingestion and manual/worker mapping changes. Ambiguous source mappings fail before ingestion writes or worker AI calls. Worker job, result, generated case and source-file relationships are checked. Repeating the same mapping is safe; conflicting mappings fail without partial source/result assignment.

Quotas remain three external teams, five full seats including service accounts, two read-only seats, and 500 non-rolling monthly credits. No paid usage, cloud access, production data, credentials or package versions changed.

## Local validation

Environment: Windows, PostgreSQL 17 on 127.0.0.1:15443, Node 24.19.0, pnpm 11.23.0. Tests use vaettir_permissions_test, not production or another lane's database. Fresh-install verification uses vaettir_permissions_fresh_test on the same isolated cluster.

- Frozen dependency installation and Prisma client generation passed.
- All 40 migrations and reference seed passed on a fresh database; migrate status reported up to date.
- The migration verification script reconstructs the previous unique-index contract inside a disposable transaction, inserts an existing mapping, executes the actual new migration SQL, verifies the original row is unchanged, and accepts the same ID in a second project. All temporary DDL and fixture data roll back.
- API regression suite: 92 tests across 15 files. Core suite: 35 tests across seven files. Both pass, with live model calls stubbed in worker tests.
- API typecheck, production compilation and lint pass. No new package or lockfile changes.

Key regression files: staffCapacity.integration.test.ts, privateBeta.integration.test.ts, compoundTenantIsolation.integration.test.ts, externalTestMapping.integration.test.ts, and existing tenantIsolation.integration.test.ts. These exercise real PostgreSQL transactions and router callers. They do not prove live Clerk authentication, HTTP transport behavior, S3 transfers, browser/device acceptance or deployed database settings.

### Focused revocation correction

Independent review found that bd217aa incorrectly rejected revocation of a legacy sole-owner service key. This follow-up removes that credential-revocation blocker. The organization lock still serializes revocation, owner transfer and membership cleanup. Tests exercise both tenant and staff routes, concurrent repeated revocation, staff revocation during suspension, fresh revoked-token requests returning UNAUTHORIZED, retention of the last owner, and cleanup after human transfer with the original revocation timestamp preserved. The tenant route now returns an additive receipt instead of no payload; existing callers may continue ignoring it. The staff route preserves revokedAt and adds the same cleanup fields.

The focused follow-up passed the 10 staff-capacity tests, the complete 92-test API suite, 35 core tests, all seven workspace typecheck tasks including web/mobile consumers, API build and API lint. No schema, migration, dependency or lockfile changes are part of this correction.

Reproduce from the lane checkout with DATABASE_URL explicitly set to its isolated local database:

```powershell
pnpm db:generate
pnpm --filter @vaettir/db exec prisma migrate deploy
pnpm --filter @vaettir/db seed
pnpm exec turbo run build --filter=@vaettir/api^...
pnpm --filter @vaettir/api exec tsx scripts/verify-ci-mapping-migration.ts
pnpm --filter @vaettir/api test
pnpm --filter @vaettir/core test
pnpm --filter @vaettir/api typecheck
pnpm --filter @vaettir/api build
pnpm --filter @vaettir/api lint
```

Run the migration verification script alone, without other tests writing mappings. It is guarded to local vaettir_permissions*test databases. Do not point test migrations, seeds or cleanup at shared development or production data.

## Integration and rollback

The migration 20260831000000_project_scoped_ci_mapping replaces TestCaseSource_externalTestId_key with a nonunique lookup index. It does not delete or rewrite mappings. Existing migration files are unchanged. Regenerate Prisma clients and deploy the matching API/worker code with this migration. Do not run mixed old/new workers while admitting duplicate CI names across projects.

Restoring the old global unique index may fail once different projects contain identical CI names. Old code that queries those IDs globally is unsafe even if it starts successfully. Roll back only to a validated release with project-scoped lookup/writers, or keep admission and ingestion closed while engineering prepares a compatible recovery. Do not delete mapping rows merely to make a downgrade succeed.

Parent integration must independently rerun the combined candidate and resolve any migration/worker overlap. Operations owns startup health, workflows and the operational runbook. This lane does not change server.ts or readinessDigestScheduler.ts. Dependency and mobile changes remain separate.

Remaining gates: live legacy-reference and service-owner audit, full HTTP/credential/attachment matrix, production migration/revision verification, and the broader readiness register. Existing globally shared reference catalogs still require confidentiality review. None of these local checks constitutes final beta acceptance.
