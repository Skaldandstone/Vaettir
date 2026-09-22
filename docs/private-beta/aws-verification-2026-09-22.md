# AWS production verification — 2026-09-22

This is read-only evidence captured from AWS account `051722405355` in `us-east-2` after an interactive
`aws login --profile vaettir-toolkit`. No deployment, scaling change, restore, secret read, or customer-data
mutation was performed.

## Verified live

- ECS services `vaettir-api` and `vaettir-web` were `ACTIVE`, steady, and `1/1` running with completed
  rollouts on task definitions `vaettir-api:3` and `vaettir-web:2`.
- Both ALB target groups reported one healthy target. The running API task reported healthy service-connect
  health, and both application containers were running.
- The custom domain and direct CloudFront root returned HTTP 200 after the scheduled wake. The custom-domain
  detailed health route returned HTTP 200 with `healthy: true`, `db.ok: true`, and all four pollers non-stale.
- CloudFront distribution `E1QNL3G1SCY7X` was deployed and enabled, with alias
  `vaettir.skaldandstone.com` and the Vaettir ALB as its origin.
- RDS `vaettir-postgres` was available, encrypted, on PostgreSQL 16.15, with a seven-day backup retention
  setting and a current latest-restorable time. Recent encrypted automated snapshots were available.
- The artifact bucket `vaettir-test-artifacts-051722405355` was reachable in `us-east-2`, blocked all public
  access, defaulted to SSE-AES256, and had an enabled 90-day expiration rule.
- The production web bundle exposes a live Clerk publishable-key class. Secret values were not fetched.
- A bounded 24-hour log filter found no events matching `ERROR` in `/ecs/vaettir-api` or `/ecs/vaettir-web`.

## Open production gates

- **Release identity:** both task definitions use mutable `latest` image tags and omit
  `VAETTIR_RELEASE_COMMIT`. The exact ECR digests are observable, but no source commit is recorded in the
  deployed configuration. The API digest was pushed 2026-09-21; the web digest was pushed 2026-09-11.
- **GitHub App:** no `GITHUB_APP_ID`, private-key, or webhook-secret configuration was present in the API task,
  and no matching Vaettir GitHub App secrets were present in Secrets Manager metadata. Installation, webhook,
  and PR-scan proof remain blocked on real provider configuration.
- **Alerts:** no Vaettir CloudWatch metric or composite alarms were present. A clean manual log query is not
  actionable alerting evidence.
- **Log retention:** both ECS log groups had no retention period configured, meaning indefinite retention.
- **Backup restore:** the seven-day setting and restore point are real, but no isolated restore was performed.
  The under-four-hour restore requirement remains unproved and requires an approved temporary restore target.
- **Artifact recovery:** bucket versioning was not enabled. The 90-day expiration rule protects cost, not
  recovery from overwrite or deletion.
- **Schedule/UI mismatch:** live EventBridge Scheduler configuration starts RDS, API, and web at 09:00 Pacific
  and stops them at 00:00 Pacific. The branded sleep page says the site is awake 08:00–01:00 Pacific. The
  public promise and actual schedule differ by two hours and must be reconciled deliberately.
- **Infrastructure provenance:** no active Vaettir CloudFormation stack was listed. The currently deployed
  resources and manual deployment path therefore still need immutable release and rollback evidence.

## Exact live identifiers

- API task definition: `arn:aws:ecs:us-east-2:051722405355:task-definition/vaettir-api:3`
- API image digest: `sha256:5139ced6806c5d1ab2cdcb4b3131d56417424bd68b540d542f5573bdec56475d`
- Web task definition: `arn:aws:ecs:us-east-2:051722405355:task-definition/vaettir-web:2`
- Web image digest: `sha256:cc983e9b2479090a38fae77b370d6fbb2cb07a40ae62a71c504d304880dd05e1`
- Database: `vaettir-postgres`
- Artifact bucket: `vaettir-test-artifacts-051722405355`

This evidence proves current runtime health and configuration only. It does not prove authenticated onboarding,
GitHub delivery, alert delivery, restore time, rollback safety, physical-device acceptance, or release approval.
