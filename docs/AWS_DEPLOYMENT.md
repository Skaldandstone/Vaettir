# AWS deployment

Vaettir's API and web app run on AWS (account `094842496450`, region `us-east-2`).

## Account context

This is the same **"new AWS experience"** account type as Kall's (see Kall's own `docs/AWS_DEPLOYMENT.md` for the fuller writeup of what that means): AWS manages IAM/SCPs on your behalf, and the account is **locked to a single assigned region** (`us-east-2`).

**AWS CodeConnections (GitHub source for CodeBuild) is not usable in this account** - `codeconnections:UseConnection` is explicitly denied by the account's Service Control Policy, and unlike EC2/RDS/ECS/Secrets Manager, this one is *not* bypassed by the `AccountFullAccessRole` session either (confirmed via `iam simulate-principal-policy` - explicit deny, `AllowedByOrganizations: false`). Chased this down what looked like a GitHub App installation problem for a while before finding the real cause; don't repeat that - if `codebuild create-project` fails with `OAuthProviderException: User is not authorized to access connection`, it's this SCP block, not a GitHub-side auth issue. **CodeBuild sources from S3 instead** (see "Redeploying" below) - a zip of `git archive` output, uploaded to `s3://vaettir-build-source-094842496450/vaettir-source.zip` before each build.

Two identities exist for this account, same pattern as Kall:
- `VaettirBot` IAM user (access key, `aws configure --profile vaettir`) - blocked from EC2/RDS/ECS/CodeConnections/etc. by the SCP despite having `AdministratorAccess` attached.
- `vaettir-toolkit` profile (`aws login`, assumes `AccountFullAccessRole` via SSO, credentials last 12h/renewable 90 days) - not subject to most of that block (except CodeConnections, above). Use this profile for AWS work on this project. Re-run `aws login --region us-east-2 --profile vaettir-toolkit` when it expires.

## Why this architecture, specifically

Same reasoning as Kall's - no NAT Gateway (cost), ECS Fargate tasks in public subnets with security-group isolation instead of private subnets, CloudFront in front of the ALB for free HTTPS without a domain. Two differences from Kall worth calling out:

- **The web app calls the API directly from the browser**, not through a server-side proxy route like Kall's `/api/kall/[...path]`. `NEXT_PUBLIC_API_URL` is baked into the web image at *build time* (`https://d3lnl5r1k2mxoz.cloudfront.net/api`) as a Docker build arg, not an ECS runtime env var - Next.js inlines `NEXT_PUBLIC_*` vars into the client bundle during `next build`, so setting them only on the running container does nothing.
- **`apps/api/src/server.ts` mounts every route twice**: once unprefixed (`/health`, `/trpc/*`) for ECS target-group health checks hitting the task's IP directly, and once under `/api` (`/api/health`, `/api/trpc/*`) for real traffic through the ALB's path-based rule, since the ALB only routes `/api/*` to the API service (the same domain also serves the web app on every other path).
- **Prisma migrations run as the container's own startup command** (`prisma migrate deploy && node apps/api/dist/server.js` in `Dockerfile.api`'s `CMD`), not as a separate CI step - RDS isn't reachable from outside the VPC, so the running ECS task is the only thing with network access to migrate against. Same reasoning as Kall's `alembic upgrade head && uvicorn ...`.
- **`packages/db`, `packages/core`, and `packages/ai-agent` now have a real build step** (`"build": "tsc -p tsconfig.json"`, `main`/`types` pointing at `dist/`) - they used to point straight at TS source (`"main": "src/index.ts"`), which meant a plain-node runtime couldn't resolve their relative `.js`-suffixed imports (only the `.ts` files existed), so `Dockerfile.api` originally had to run the API via `tsx` instead of compiled JS. `Dockerfile.api` now runs `pnpm turbo run build --filter=@vaettir/api...` (turbo's dependency graph builds core → db → ai-agent → api in order) and starts `node apps/api/dist/server.js` directly.
- **`node:22-slim` needs `openssl` installed explicitly** for Prisma's engine binaries to work - without it, `prisma migrate deploy` fails with an opaque `Schema engine error: undefined` rather than a clear missing-library error. Cost the first real deploy attempt a crash loop before this was found.

## What exists

| Resource | Identifier |
|---|---|
| ECS cluster | `vaettir-cluster` |
| ECS services | `vaettir-api` (Service Connect *and* public ALB path at `/api/*`), `vaettir-web` (behind the ALB) |
| Task definitions | `vaettir-api`, `vaettir-web` (Fargate, 256 CPU / 512 MB each) |
| ECR repos | `094842496450.dkr.ecr.us-east-2.amazonaws.com/vaettir-api`, `.../vaettir-web` (KMS-encrypted, scan-on-push) |
| RDS instance | `vaettir-postgres` - `db.t4g.micro`, Postgres 16.15, single-AZ, 20GB gp3, storage-encrypted, not publicly accessible, `rds.force_ssl=1` via parameter group `vaettir-postgres16-forcessl`, 1-day backup retention, master password managed by RDS (`--manage-master-user-password`) |
| Service Connect namespace | `vaettir.local` (Cloud Map HTTP namespace) - API reachable internally at `vaettir-api.vaettir.local:8000` (not currently used by anything; web calls the public endpoint instead) |
| ALB | `vaettir-alb`, HTTP listener on 80. Default action → `vaettir-web-tg` (port 3000). Rule (priority 1, path `/api/*`) → `vaettir-api-tg` (port 8000, target type `ip`, health check `/health`) |
| CloudFront | `E25R9JLXVNL8L` → `https://d3lnl5r1k2mxoz.cloudfront.net` (the public URL) |
| Secrets Manager | `vaettir/anthropic-api-key`, `vaettir/clerk-secret-key`, `vaettir/database-url` (composed once from the RDS-managed secret - see note below), plus the RDS-managed `rds!db-...` secret itself |
| S3 source bucket | `vaettir-build-source-094842496450` - private, holds the `git archive` zip CodeBuild builds from (see "Redeploying") |
| S3 test-artifacts bucket | `vaettir-test-artifacts-094842496450` (P5-15) - private (all public access blocked), SSE-AES256 by default, 90-day object expiration lifecycle rule. Holds failure screenshots/videos uploaded via presigned URLs (`testRuns.requestArtifactUpload`/`getArtifactViewUrl` in `apps/api/src/routers/testRuns.ts`) - the API server itself never sees the bytes, only signs URLs. |
| IAM roles | `vaettir-ecs-execution-role` (ECR pull, CloudWatch Logs, reads `vaettir/*` and `rds!db-*` secrets), `vaettir-api-task-role` (has an inline `TestArtifactBucketAccess` policy: `s3:PutObject`/`s3:GetObject` scoped to `vaettir-test-artifacts-094842496450/*` - added for P5-15, the first real AWS SDK call from within the API container), `vaettir-codebuild-role` (ECR push, CloudWatch Logs, reads the S3 source bucket) |
| CodeBuild projects | `vaettir-api-build` (`Dockerfile.api`, repo root context), `vaettir-web-build` (`Dockerfile.web`, repo root context, passes `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`/`NEXT_PUBLIC_API_URL` as build args) - both source from S3, not GitHub (see CodeConnections note above) |
| Security groups | `vaettir-alb-sg` (80 from internet) → `vaettir-web-tasks-sg` (3000 from ALB) and `vaettir-api-tasks-sg` (8000 from web tasks *and* from `vaettir-alb-sg` directly) → `vaettir-rds-sg` (5432 from API tasks) |

`vaettir/database-url` is a **static** composed connection string (`postgresql://vaettir_admin:<password>@...`), built once from the RDS-managed secret's password at setup time - Prisma wants one URL, unlike Kall's Python backend which composes `DB_HOST`/`DB_USER`/`DB_PASSWORD` parts at runtime. This will go stale if the RDS-managed password is ever rotated (no rotation schedule is currently configured, so it won't rotate on its own) - if you ever add rotation, this secret needs to be regenerated to match, or switched to the DB_HOST/parts pattern instead.

Local Docker isn't installed on the machine this was built from, same as Kall - CodeBuild builds images from an uploaded source zip instead of a local `docker build && docker push`.

## Redeploying after a code change

There's no push-triggered CI (see below for why that's not fixable in this account) - deploys are one command:

```bash
./scripts/deploy-aws.sh          # rebuild + redeploy both api and web
./scripts/deploy-aws.sh api      # only api
./scripts/deploy-aws.sh web      # only web
```

Needs `vaettir-toolkit` active (`aws login --region us-east-2 --profile vaettir-toolkit` if expired). It packages the committed tree with `git archive` (no `.git`, no `node_modules`, respects `.gitignore` - uncommitted local changes are not deployed), uploads to S3, starts the CodeBuild project(s), waits for them, then forces a new ECS deployment.

**Real push-triggered CI/CD is architecturally impossible in this account, not just unbuilt.** Confirmed via `aws iam simulate-principal-policy`: the SCP explicitly denies `codebuild:StartBuild`, `s3:PutObject`, and `ecs:UpdateService` to *every* identity except an interactive-browser-SSO session assuming `AccountFullAccessRole` - that includes the plain `VaettirBot` IAM user (even with stored credentials in GitHub Actions) and the CodeBuild service role itself (so builds can't even trigger their own redeploy on completion). There's no service-role or stored-credential path around this; only a human `aws login` produces a session that can call these. `scripts/deploy-aws.sh` is the practical ceiling here, not an intermediate step toward full automation.

## Known gaps / next steps

- **No custom domain / ACM cert on the ALB.** Same tradeoff as Kall: CloudFront → ALB is plain HTTP internally (`OriginProtocolPolicy: http-only`), the one unencrypted hop in the path. Fix if a domain is ever added: attach an ACM cert to the ALB, flip the origin policy to `https-only`. Not a priority right now.
- **`vaettir-api-task-role` now has S3 permissions (P5-15)** - the bucket and IAM policy exist, but the `vaettir-api` **task definition itself has not been updated** with the `TEST_ARTIFACTS_BUCKET=vaettir-test-artifacts-094842496450` / `AWS_REGION=us-east-2` environment variables yet (deliberately not touched outside an actual deploy of this feature - see `apps/api/src/services/artifactStorage.ts`). Add those two env vars to the container definition and register a new task definition revision before this feature will work in production; it throws `TEST_ARTIFACTS_BUCKET is not set` until then. Locally, these are picked up from the shell environment (see any of this session's verification scripts) rather than `.env`, since they're deployment config, not secrets.
- **Backup retention is capped at 1 day** - this is an **enforced free-tier limit**, not a config choice: `aws rds modify-db-instance --backup-retention-period 7` fails outright with `FreeTierRestrictionError`. Only lifts if the account plan is upgraded.
- **Single-AZ** - this one *is* a cost choice (multi-AZ roughly doubles RDS instance-hour cost) and is left as-is deliberately. (Note: this was briefly toggled on and back off again while investigating the above - confirmed reverted to single-AZ, `MultiAZ: false`, no lasting change.)
- **Secrets are static, not auto-rotated** - see the `vaettir/database-url` note above.
