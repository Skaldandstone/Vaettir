# Staging environment (P10-09)

**Status as of 2026-09-12: infra prepared as code, not provisioned.**
There are no production customers yet, so the recurring AWS cost of a
second live stack isn't worth incurring until it's actually needed - this
document and `scripts/setup-staging-aws.sh` exist so standing one up is a
reviewed, ready-to-run action later, not a from-scratch design exercise
under time pressure when it's finally needed.

## Why a second, fully separate stack

Production today (see `docs/AWS_DEPLOYMENT.md`) is the only AWS stack that
exists, and every deploy ships straight to it - there is no environment to
validate a risky migration or a real Stripe-webhook change against first.
A staging environment mirrors production's exact architecture with its own
RDS instance, ECS cluster, ALB, and CloudFront distribution - nothing
shared with production, so a staging mistake (a bad migration, a
misconfigured webhook, test data) can never touch real data or traffic.

## What staging needs (mirrors `docs/AWS_DEPLOYMENT.md`'s "What exists" table)

| Resource | Production | Staging (planned) |
|---|---|---|
| ECS cluster | `vaettir-cluster` | `vaettir-cluster-staging` |
| ECS services | `vaettir-api`, `vaettir-web` | `vaettir-api-staging`, `vaettir-web-staging` |
| ECR repos | `vaettir-api`, `vaettir-web` | `vaettir-api-staging`, `vaettir-web-staging` |
| RDS instance | `vaettir-postgres` (db.t4g.micro, single-AZ) | `vaettir-postgres-staging` (same tier - no reason to size staging differently) |
| ALB | `vaettir-alb` | `vaettir-alb-staging` |
| CloudFront | `d35bt2repnvk6t.cloudfront.net` | a new distribution, staging's own CloudFront URL |
| Secrets Manager | `vaettir/anthropic-api-key`, `vaettir/clerk-secret-key`, `vaettir/database-url`, GitHub App secrets, Stripe test-mode keys | same set, `vaettir-staging/*` prefix - **its own Stripe test-mode keys and Clerk instance**, not production's, so staging traffic never touches the same Clerk users or Stripe customers as production |
| S3 buckets | `vaettir-build-source-051722405355`, `vaettir-test-artifacts-051722405355` | `-staging` suffixed |
| IAM roles | `vaettir-ecs-execution-role`, `vaettir-api-task-role`, `vaettir-codebuild-role` | `-staging` suffixed, scoped to staging's own resources only (never grant a staging role access to a production secret/bucket) |
| CodeBuild projects | `vaettir-api-build`, `vaettir-web-build` | `-staging` suffixed |

**Deliberately shared with production** (to avoid unnecessary cost/complexity
for a same-account, same-region staging environment): the VPC and its
subnets, and the AWS account itself (`051722405355`) - staging is a
separate stack, not a separate account. Security groups are NOT shared
(see the script) - a staging security-group rule can never accidentally
widen production's exposure even on a shared VPC.

## Cost estimate

Roughly the same monthly cost as production's own footprint (see
`docs/AWS_DEPLOYMENT.md`'s architecture notes) - the bulk of it is the RDS
instance (a few dollars/month at `db.t4g.micro`) plus ECS Fargate task time
for two always-on tasks, an ALB, and a CloudFront distribution. Not free,
which is exactly why this stays unprovisioned until there's a real need
(an actual pre-launch validation pass, a risky migration to test, or real
customers whose traffic staging needs to be isolated from).

## Provisioning, when it's time

1. Read `scripts/setup-staging-aws.sh` in full before running it - it asks
   for explicit confirmation before creating anything, and stops partway
   through deliberately (see its own comments) rather than fully
   automating the ECS/ALB/CloudFront/IAM wiring, which has enough
   interdependent ordering (security group -> RDS -> task role -> task
   definition -> service -> ALB target group -> listener rule -> CloudFront
   origin) to be worth doing once, carefully, with a human watching each
   step - the same lesson `docs/AWS_DEPLOYMENT.md`'s own account-rebuild
   history already demonstrates.
2. Needs an active `aws login --region us-east-2 --profile vaettir-toolkit`
   session - this account's SCP requires interactive browser-SSO for the
   mutating calls involved (`codebuild:StartBuild`, `s3:PutObject`,
   `ecs:UpdateService`), so this genuinely cannot be run unattended by an
   agent or a stored service credential, only by a human (or an agent
   working alongside a human's active session).
3. Once the resources exist, `scripts/deploy-aws.sh` (parameterized, see
   its own updated usage comment) targets staging via
   `VAETTIR_DEPLOY_ENV=staging ./scripts/deploy-aws.sh`.

## Open questions for when this is actually stood up

- Staging's own Clerk instance and Stripe test-mode keys need to be created
  separately from production's (or from the sandbox keys P12-05 already
  uses in local dev) - worth deciding whether staging shares the same
  Stripe test-mode account as local dev, or gets its own, before wiring
  secrets.
- Domain: staging could live at a raw CloudFront URL indefinitely (matching
  how production itself operated before `vaettir.skaldandstone.com` was
  wired up), or get its own subdomain (`staging.vaettir.skaldandstone.com`)
  - not needed for staging to be useful, worth deciding once there's an
  actual reason to share a staging link with someone outside the team.
