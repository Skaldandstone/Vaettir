# Private-beta service window and immutable release rollout

## Canonical service window

`config/private-beta-service-window.json` is the source of truth for both the customer-facing promise and the six AWS Scheduler entries. The beta window is 08:00 through 01:00 in `America/Los_Angeles`; Scheduler must therefore use `cron(0 8 * * ? *)` for the three start entries and `cron(0 1 * * ? *)` for the three stop entries.

Run `pnpm test:operations` to reject drift between the times, expressions, public copy, and expected schedule inventory. Run `node scripts/private-beta-service-window.mjs` to render the exact desired public copy and schedule contract for review.

For a read-only live comparison, save the six `aws scheduler get-schedule` responses as a JSON array and run `node scripts/private-beta-service-window.mjs --actual <path>`. The command exits nonzero and names every missing or mismatched field.

The September 22 production inspection found the live schedules at 09:00 through 00:00 while the Studio sleep page already advertises 08:00 through 01:00. No AWS schedule or Studio deployment was changed in this local implementation. The Studio canonical checkout also contained unrelated active edits, so it was deliberately not modified. The reviewed rollout must:

1. update all six schedules in the `cost-audit-restop` group from the rendered contract;
2. confirm each schedule retained its existing target, role, payload, flexible-window setting, and enabled state;
3. update the Studio sleep-page implementation to consume or mechanically verify the same canonical values rather than retaining an independent literal;
4. probe the branded sleep page before 08:00, during the awake window, and after 01:00 Pacific.

Until those steps are completed, the source contract is ready but the live service-window gate remains blocked.

## Immutable release identity

Both image builds require a lowercase 40-character `VAETTIR_RELEASE_COMMIT`. The API image now retains that value in its runtime environment, matching the existing web build-time release value. Deployment tooling resolves the just-built ECR `latest` tag to a digest, renders a new task-definition revision pinned to `repository@sha256:...`, and adds `VAETTIR_RELEASE_COMMIT` plus `VAETTIR_IMAGE_DIGEST` to the container environment before updating ECS.

The API detailed health response reports both values and marks the release `verifiable` only when both formats are valid. Existing production remains unverifiable until a reviewed deployment uses the new path. The deployment must record the commit, digest, task-definition ARN, migration result, detailed health body, and rollback target. Roll back only to a security-compatible task definition; the project-scoped CI mapping migration makes older globally scoped code unsafe even when the database schema can technically be read.
