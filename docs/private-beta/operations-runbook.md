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

## Health and alert acceptance

Use /api/health/detailed and assert healthy === true, db.ok === true and no stale worker heartbeat. HTTP 200 alone is insufficient. Current health response does not prove deployment identity; verify ECS image digest separately.

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

## Rollback drill

Before deployment, retain the previous known-good image digest/task definition, configuration REFERENCES and database compatibility analysis. In an isolated/staging environment, deploy the candidate, verify health and workflow, restore the previous known-hardened task definition/digest, and verify health, auth, read-only access and case/release state again. Record start/end and failure recovery. No destructive down migration. Repeat the production preflight immediately before any real rollback.

## Incident and rollout

James owns notifications, spending approvals and final go/no-go. Engineering owns containment recommendations, evidence, diagnosis and the approved corrective release. Suspected cross-tenant exposure or data loss stops invitations immediately. Keep one team until seven consecutive days without unresolved critical/high defects; then James may approve the other two.
