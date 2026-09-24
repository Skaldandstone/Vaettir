# Private-beta readiness blockers - 2026-09-24

This checkpoint follows the bounded local hardening series ending at
`51a2bc5` on `codex/overnight-readiness-20260921`. The branch is pushed, but
production intentionally remains at `adf1146`.

No additional local-only guard was selected. The highest-value remaining
gates require external state, authority, or architecture that cannot be
truthfully replaced by another unit test.

## Deployment and operations

- Deploy a sealed candidate and verify its exact source commit and ECR digest
  in the running task, then prove public and detailed health. This requires an
  approved AWS deployment.
- Verify the production CORS allowlist and privileged-denial structured logs
  through the real CDN/API path. Local Fastify and middleware tests do not
  prove task environment values, CloudFront behavior, CloudWatch delivery,
  retention, access controls, or alert delivery.
- Create actionable Vaettir CloudWatch alarms and record operator receipt and
  response. The 2026-09-22 read-only AWS inspection found no Vaettir metric or
  composite alarms.
- Demonstrate rollback to a security-compatible release. A source-level
  rollback plan does not prove the task revision, migrations, health, or data
  compatibility in AWS.

## Recovery

- Run a timed RDS snapshot or point-in-time restore into an isolated target,
  verify network/security-group and Secrets Manager cutover, exercise the app,
  and remove the paid temporary instance. Local logical restore evidence does
  not prove seven-day production recoverability or the under-four-hour target.
- This requires James's approval because it creates paid AWS infrastructure
  and touches production-derived backup material.

## Providers and integrations

- Configure the real GitHub App id, private key, webhook secret, installation,
  delivery, artifact flow, and PR-scan acceptance. Provider configuration is
  absent from the verified production task.
- Exercise paid AI draft quality and credit/cost telemetry with an approved
  provider account. Deterministic tests do not prove provider availability,
  output quality, latency, or dollar spend.
- Exercise Google Play OAuth and Apple App Store credentials against real
  provider accounts, then implement and verify the still-unbuilt scheduled
  production-signal ingestion path.
- Verify Sentry and notification delivery for the new scheduler and privileged
  access signals. Local capture calls do not prove external receipt.

## Onboarding and owner acceptance

- Reserve and create the owner workspace, create/select a project, and verify
  the authenticated web flow visually. This is a deliberate production data
  mutation and owner action.
- Run a distinct client identity through public signup, demo exploration,
  invitation acceptance, role/seat enforcement, and project access without
  developer intervention. Record screenshots and recovery behavior.
- Complete the physical-device Android workflow and iOS friend test, including
  signing, install/upgrade, sign-in/out, project switching, session expiry,
  accessibility, push delivery, and visual acceptance. EAS/Apple access and
  real devices are required.

## Scale and rollout

- Current schedulers are hardened for one process only. Before running more
  than one API replica, design and verify database claiming, a queue, or an
  outbox for cross-process exclusion and delivery semantics.
- Complete internal dogfood, then one invited team and seven consecutive days
  without unresolved critical/high-severity defects before adding the other
  two teams. James owns cohort invitations and final go/no-go.

## Parked boundary

No deployment, AWS/provider/account mutation, credential use, production or
customer-data mutation, paid action, destructive operation, device action, or
public release was performed for this checkpoint. Resume from the first gate
for which the required authority and evidence environment are available.
