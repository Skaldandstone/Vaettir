# Private-beta operations runbook

Status: prepared, not executed against production. No deploy, AWS credential refresh, customer-data mutation, paid-resource creation or spending-limit change is authorized by this document alone.

## Identity and preflight

After James confirms the AWS sign-in flow, refresh the vaettir-toolkit profile in us-east-2. Verify sts get-caller-identity and the intended Vaettir account before any inspection or change. Do not reuse a Studio/other-product identity.

Read-only inspection must record:

- ECS cluster/service, running task ARN, task definition revision, image digest, desired/running count, health, deployment timestamp and source commit.
- Secret REFERENCES and presence only for Clerk, GitHub App/private key/webhook, telemetry and database credentials. Do not dump environment values or private keys into logs.
- Artifact bucket, public-access blocking, encryption, least-privilege role and lifecycle/retention settings.
- RDS engine/version, encryption, network/access configuration, pending changes, backup retention, latest restorable time and backup status.
- GitHub App installation owner and allowed repository list; prove an isolated signed webhook reaches the expected installation and project.
- Effective error-reporting DSNs, release tags, sensitive-data scrubbing and actual notification recipients.

## Release and migration record

Build one clean commit with frozen dependencies. Record Git SHA, image digests, CodeBuild IDs, task definitions, migration names/checksums and all test/device evidence. Never identify a release solely as latest or a mutable Docker tag.

The existing manual deploy script/workflow uses mutable source/image/deployment conventions and is NOT itself evidence of an immutable release. Before using it, capture the resulting immutable build/image/task identifiers and demonstrate the rollback below. Do not enable push-to-deploy during beta.

Apply the new additive migration and reference seed once through the approved database access path. Confirm private-beta is non-public with five/two seats and 500 credits. Confirm no external owner enrollments were created implicitly. Capture prisma migrate status without database credentials.

The beta migration is additive, but the old application lacks its admission enforcement. Rolling back to the old application can reopen external organization creation. Close external sign-up/access at the approved ingress/auth control before such a rollback, or roll forward to a known hardened revision. Never undo migrations by deleting ledger or enrollment records.

The permissions lane also removes global uniqueness of TestCaseSource.externalTestId and scopes matching to a project. Once identical CI IDs exist in different projects, recreating the old unique constraint may fail. More importantly, old globally matching code is unsafe even if it starts against the database. A rollback target must contain this tenant-isolation fix and beta admission enforcement. Otherwise use a forward security fix or an approved access shutdown, not an old-image rollback described as safe.

Both Dockerfiles now require a full VAETTIR_RELEASE_COMMIT build argument and label the resulting image with org.opencontainers.image.revision. The API exposes that configured commit in detailed health; web telemetry receives NEXT_PUBLIC_RELEASE_COMMIT at build time. Pass the exact checked-out SHA when building. Existing deployment scripts that omit the new argument will fail until their approved release invocation supplies it. These labels are operator-provided metadata, not a substitute for comparing the actual ECS image digest with the built image record.

## Executable local and CI evidence

Use an isolated clean worktree, with no .env files and a loopback database named vaettir_<lane>_test. The collector allows only the public schema and a bounded connection_limit option. It rejects tracked and untracked source changes, while preserving the unrelated untracked NEEDS_ATTENTION.md. It removes inherited AWS, Clerk, AI, Sentry and remote-cache configuration, disables EC2 credential discovery, uses compile-only auth, and forces fresh tests/builds. It never launches an authenticated browser or calls a paid model.

PowerShell, from the release worktree:

```powershell
./scripts/collect-release-evidence.ps1 -DatabaseUrl 'postgresql://vaettir_ops@127.0.0.1:55447/vaettir_operations_test?schema=public&connection_limit=5' -WebBuild local-server
```

The cross-platform equivalent is node scripts/collect-release-evidence.mjs with DATABASE_URL set and --web-build standalone on Linux. Local-server is explicitly not standalone/container evidence. The manifest records commit, lockfile and migration checksums, tool versions, per-check exit status/timing and sanitized-log hashes. Audit findings or unavailable audit data leave security BLOCKED and return a nonzero exit. Dependency consumer regressions run when the dependency lane's test:dependencies script is present; absence is recorded, never counted as a pass.

CI runs deterministic operations/health contract tests plus consumer regressions, bounded database tests and normal Linux standalone compilation. The manual release workflow adds the full candidate manifest and current dependency audit before authenticated browser checks. Optional native/container compilation remains release-only. The container job never pushes images or deploys; it checks the API body and commit, starts the compiled web guide, records local image IDs and removes only its exact job-named containers. GitHub account execution restrictions and required environment reviewers must still be resolved by James.

Detailed-health verification, for a locally running candidate or an approved read-only HTTPS target:

```powershell
node scripts/check-health.mjs --url http://127.0.0.1:4000/health/detailed --commit <FULL_GIT_SHA> --record
```

The checker rejects credential/query-bearing URLs and remote plaintext HTTP. It requires healthy=true, db.ok=true, exactly one status for each expected worker, non-stale valid heartbeats and the matching full SHA. Its output contains only status codes, known worker names and release identity, never the arbitrary response payload. This proves one observation; it does not configure or prove alert delivery.

The optional --record flag writes a timestamped local health manifest. API request logging is reduced to method and finite route categories so tRPC query inputs, cookies, authorization, host/IP and bodies are not copied into the request logs. Error logs use a generic message and error type; Sentry retains the separately scrubbed stack. This does not establish that every existing application/job log call is safe, so production log sampling and all alert delivery still require live verification.

## Health and alert acceptance

Use /api/health/detailed and assert healthy === true, db.ok === true and no stale worker heartbeat. HTTP 200 alone is insufficient. Current health response does not prove deployment identity; verify ECS image digest separately.

Worker heartbeat timestamps denote loop liveness/attempt, not successful business work or webhook delivery. The digest scheduler performs an actual initial check on startup, catches startup/interval failures and prevents overlapping checks in the same process. Its lastDigestSentAt read/send/write sequence is not an atomic distributed delivery claim. Multiple replicas, a crash after send but before recording delivery, or a concurrent manual send can still duplicate digests. Verify deployment topology before enabling digests for beta; reliable multi-process delivery requires a separately reviewed claim/outbox design. Do not treat green heartbeats as proof of successful Slack delivery.

Use existing approved monitoring where possible. Suggested beta alert conditions, to configure only with approved access:

- Two consecutive failed detailed-health checks one minute apart.
- Worker heartbeat stale for more than two expected polling intervals.
- New unhandled web/API/mobile error or elevated failure rate, routed to James/engineering.
- RDS backup failure or latest-restorable-time lag.
- Model token usage trend and exhausted team credit allowances.

Send synthetic, content-free test errors and record delivery time, recipient and resolution. Shared sanitizer drops user/request/context/breadcrumbs/message text and keeps minimal error type/stack/release context. No session replay or request-body capture. Model logs record operation/model/input-output token counts, not prompts. Verify provider billing separately; 500 credits is not a dollar budget.

## Attachment and GitHub evidence

Use one private synthetic repository and one isolated organization/project. Record test resource IDs and permission scope before writing. Perform upload/download, wrong-team lookup, read-only mutation, revoked key, revoked membership and suspended organization checks. Verify signed URL expiry. Previously issued presigned URLs are bearer capabilities until expiry, currently five minutes; membership revocation cannot retroactively invalidate an already-issued URL.

For GitHub, test installation authorization, valid signature, invalid signature, duplicate delivery, PR source change, case review, JUnit linking and release update. Record delivery and case/run IDs without source code/secrets. Destroy only the explicitly recorded disposable resources after review.

## Backup policy resolution

The required gate is seven days recoverable and a demonstrated restore within four hours. AWS RDS supports 0-35 day retention on DB instances; 0 disables automated backups. CLI/API creation defaults to one day, console creation to seven. These are service behavior, not evidence of this account's configured retention or free-tier entitlement. Changing between zero and nonzero retention causes an outage. [AWS RDS retention documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html).

Therefore the conflicting historical notes cannot be resolved by assuming either one or seven days is already enabled. Inspect actual retention, PITR window, instance/account restrictions and backup-storage billing. If the account cannot meet seven days within approved spend, keep the beta on HOLD and request the smallest explicit change. Do not silently reduce the recovery objective.

## Isolated restore drill

1. Record source instance, recoverable timestamp, snapshot/PITR method, expected cost and approved isolated target name/network. Start the four-hour timer.
2. Restore to a NEW isolated database/instance. Never overwrite the live instance and never connect background workers to the restore.
3. Verify migration state, representative row counts, tenant boundaries, attachments references, append-only credit balance, invitations and one read-only application workflow. Log results without customer payloads.
4. Record restore-complete time and elapsed duration. A local synthetic pg_dump restore only validates mechanics, not the production RDS recovery objective.
5. James/engineering approve evidence and exact cleanup targets; remove paid disposable resources using the scoped approved procedure and record final status.

For synthetic local restore mechanics only, stop local workers first and set DATABASE_URL plus RESTORE_DATABASE_URL to different loopback test databases on the same server. The target must end in _restore_test and must not already exist. Run node scripts/restore-local-evidence.mjs --postgres-bin 'C:/Program Files/PostgreSQL/17/bin'. This dumps the whole local source, restores to a newly created target, compares migration/plan/org/ledger counts and a synthetic probe value, and hashes the dump. It retains the exact source, target and dump for review rather than deleting them automatically. The manifest explicitly leaves productionRestoreVerified and sevenDayWindowVerified false regardless of elapsed time. The target is never connected to application workers.

## Rollback drill

Before deployment, retain the previous known-good image digest/task definition, configuration REFERENCES and database compatibility analysis. In an isolated/staging environment, deploy the candidate, verify health and workflow, restore the previous known-hardened task definition/digest, and verify health, auth, read-only access and case/release state again. Record start/end and failure recovery. No destructive down migration. Repeat the production preflight immediately before any real rollback.

## Incident and rollout

James owns notifications, spending approvals and final go/no-go. Engineering owns containment recommendations, evidence, diagnosis and the approved corrective release. Suspected cross-tenant exposure or data loss stops invitations immediately. Keep one team until seven consecutive days without unresolved critical/high defects; then James may approve the other two.
