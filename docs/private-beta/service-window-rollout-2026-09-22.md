# Production service-window rollout evidence

## Outcome

On September 22, 2026 between 23:10 and 23:11 Pacific, the six production EventBridge Scheduler entries in group `cost-audit-restop` were changed from the observed 09:00 through 00:00 window to the reviewed 08:00 through 01:00 window in `America/Los_Angeles`.

The authenticated operation targeted AWS account `051722405355` through the `vaettir-toolkit` profile. No login or MFA action was required during the rollout.

## Verified schedule state

| Schedule | Expression | Timezone | State |
|---|---|---|---|
| `rds-start-vaettir-postgres` | `cron(0 8 * * ? *)` | `America/Los_Angeles` | `ENABLED` |
| `ecs-start-vaettir-api` | `cron(0 8 * * ? *)` | `America/Los_Angeles` | `ENABLED` |
| `ecs-start-vaettir-web` | `cron(0 8 * * ? *)` | `America/Los_Angeles` | `ENABLED` |
| `rds-stop-vaettir-postgres` | `cron(0 1 * * ? *)` | `America/Los_Angeles` | `ENABLED` |
| `ecs-stop-vaettir-api` | `cron(0 1 * * ? *)` | `America/Los_Angeles` | `ENABLED` |
| `ecs-stop-vaettir-web` | `cron(0 1 * * ? *)` | `America/Los_Angeles` | `ENABLED` |

For each schedule, the rollout captured the existing configuration before the update and compared it with a fresh provider read afterward. The following fields were byte-equivalent after JSON normalization:

- target ARN;
- execution role ARN;
- target input payload;
- retry policy;
- flexible time window;
- state;
- schedule timezone; and
- action after completion.

Only `ScheduleExpression` and the provider-managed modification timestamp changed.

## Executable evidence

- `pnpm test:operations`: 5 tests passed.
- A fresh read of all six production schedules piped to `node scripts/private-beta-service-window.mjs --actual -` returned `service-window schedules match the canonical contract`.
- Every schedule was read back as `ENABLED`, with the expected expression and `America/Los_Angeles` timezone.

## Remaining acceptance boundary

This proves the AWS Scheduler configuration. It does not prove the Studio sleep-page implementation or behavior at the service-window boundaries. The remaining cross-repository work is to make that page consume or mechanically verify the same contract, then observe it before 08:00, during the awake window, and after 01:00 Pacific.
