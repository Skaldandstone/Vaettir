# AWS deployment

Vaettir's API and web app run on AWS (account `094842496450`, region `us-east-2`).

## Account context

This is the same **"new AWS experience"** account type as Kall's (see Kall's own `docs/AWS_DEPLOYMENT.md` for the fuller writeup of what that means): AWS manages IAM/SCPs on your behalf, and the account is **locked to a single assigned region** (`us-east-2`).

**AWS CodeConnections (GitHub source for CodeBuild) is not usable in this account** — `codeconnections:UseConnection` is explicitly denied by the account's Service Control Policy, and unlike EC2/RDS/ECS/Secrets Manager, this one is *not* bypassed by the `AccountFullAccessRole` session either (confirmed via `iam simulate-principal-policy` — explicit deny, `AllowedByOrganizations: false`). Chased this down what looked like a GitHub App installation problem for a while before finding the real cause; don't repeat that — if `codebuild create-project` fails with `OAuthProviderException: User is not authorized to access connection`, it's this SCP block, not a GitHub-side auth issue. **CodeBuild sources from S3 instead** (see "Redeploying" below) — a zip of `git archive` output, uploaded to `s3://vaettir-build-source-094842496450/vaettir-source.zip` before each build.

Two identities exist for this account, same pattern as Kall:
- `VaettirBot` IAM user (access key, `aws configure --profile vaettir`) — blocked from EC2/RDS/ECS/CodeConnections/etc. by the SCP despite having `AdministratorAccess` attached.
- `vaettir-toolkit` profile (`aws login`, assumes `AccountFullAccessRole` via SSO, credentials last 12h/renewable 90 days) — not subject to most of that block (except CodeConnections, above). Use this profile for AWS work on this project. Re-run `aws login --region us-east-2 --profile vaettir-toolkit` when it expires.

## Why this architecture, specifically

Same reasoning as Kall's — no NAT Gateway (cost), ECS Fargate tasks in public subnets with security-group isolation instead of private subnets, CloudFront in front of the ALB for free HTTPS without a domain. Two differences from Kall worth calling out:

- **The web app calls the API directly from the browser**, not through a server-side proxy route like Kall's `/api/kall/[...path]`. `NEXT_PUBLIC_API_URL` is baked into the web image at *build time* (`https://d3lnl5r1k2mxoz.cloudfront.net/api`) as a Docker build arg, not an ECS runtime env var — Next.js inlines `NEXT_PUBLIC_*` vars into the client bundle during `next build`, so setting them only on the running container does nothing.
- **`apps/api/src/server.ts` mounts every route twice**: once unprefixed (`/health`, `/trpc/*`) for ECS target-group health checks hitting the task's IP directly, and once under `/api` (`/api/health`, `/api/trpc/*`) for real traffic through the ALB's path-based rule, since the ALB only routes `/api/*` to the API service (the same domain also serves the web app on every other path).
- **Prisma migrations run as the container's own startup command** (`prisma migrate deploy && node apps/api/dist/server.js` in `Dockerfile.api`'s `CMD`), not as a separate CI step — RDS isn't reachable from outside the VPC, so the running ECS task is the only thing with network access to migrate against. Same reasoning as Kall's `alembic upgrade head && uvicorn ...`.
- **`packages/db`, `packages/core`, and `packages/ai-agent` now have a real build step** (`"build": "tsc -p tsconfig.json"`, `main`/`types` pointing at `dist/`) — they used to point straight at TS source (`"main": "src/index.ts"`), which meant a plain-node runtime couldn't resolve their relative `.js`-suffixed imports (only the `.ts` files existed), so `Dockerfile.api` originally had to run the API via `tsx` instead of compiled JS. `Dockerfile.api` now runs `pnpm turbo run build --filter=@vaettir/api...` (turbo's dependency graph builds core → db → ai-agent → api in order) and starts `node apps/api/dist/server.js` directly.
- **`node:22-slim` needs `openssl` installed explicitly** for Prisma's engine binaries to work — without it, `prisma migrate deploy` fails with an opaque `Schema engine error: undefined` rather than a clear missing-library error. Cost the first real deploy attempt a crash loop before this was found.

## What exists

| Resource | Identifier |
|---|---|
| ECS cluster | `vaettir-cluster` |
| ECS services | `vaettir-api` (Service Connect *and* public ALB path at `/api/*`), `vaettir-web` (behind the ALB) |
| Task definitions | `vaettir-api`, `vaettir-web` (Fargate, 256 CPU / 512 MB each) |
| ECR repos | `094842496450.dkr.ecr.us-east-2.amazonaws.com/vaettir-api`, `.../vaettir-web` (KMS-encrypted, scan-on-push) |
| RDS instance | `vaettir-postgres` — `db.t4g.micro`, Postgres 16.15, single-AZ, 20GB gp3, storage-encrypted, not publicly accessible, `rds.force_ssl=1` via parameter group `vaettir-postgres16-forcessl`, 1-day backup retention, master password managed by RDS (`--manage-master-user-password`) |
| Service Connect namespace | `vaettir.local` (Cloud Map HTTP namespace) — API reachable internally at `vaettir-api.vaettir.local:8000` (not currently used by anything; web calls the public endpoint instead) |
| ALB | `vaettir-alb`, HTTP listener on 80. Default action → `vaettir-web-tg` (port 3000). Rule (priority 1, path `/api/*`) → `vaettir-api-tg` (port 8000, target type `ip`, health check `/health`) |
| CloudFront | `E25R9JLXVNL8L` → `https://d3lnl5r1k2mxoz.cloudfront.net` (the public URL) |
| Secrets Manager | `vaettir/anthropic-api-key`, `vaettir/clerk-secret-key`, `vaettir/database-url` (composed once from the RDS-managed secret — see note below), plus the RDS-managed `rds!db-...` secret itself |
| S3 source bucket | `vaettir-build-source-094842496450` — private, holds the `git archive` zip CodeBuild builds from (see "Redeploying") |
| IAM roles | `vaettir-ecs-execution-role` (ECR pull, CloudWatch Logs, reads `vaettir/*` and `rds!db-*` secrets), `vaettir-api-task-role` (empty for now — no AWS SDK calls from within the API container yet), `vaettir-codebuild-role` (ECR push, CloudWatch Logs, reads the S3 source bucket) |
| CodeBuild projects | `vaettir-api-build` (`Dockerfile.api`, repo root context), `vaettir-web-build` (`Dockerfile.web`, repo root context, passes `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`/`NEXT_PUBLIC_API_URL` as build args) — both source from S3, not GitHub (see CodeConnections note above) |
| Security groups | `vaettir-alb-sg` (80 from internet) → `vaettir-web-tasks-sg` (3000 from ALB) and `vaettir-api-tasks-sg` (8000 from web tasks *and* from `vaettir-alb-sg` directly) → `vaettir-rds-sg` (5432 from API tasks) |

`vaettir/database-url` is a **static** composed connection string (`postgresql://vaettir_admin:<password>@...`), built once from the RDS-managed secret's password at setup time — Prisma wants one URL, unlike Kall's Python backend which composes `DB_HOST`/`DB_USER`/`DB_PASSWORD` parts at runtime. This will go stale if the RDS-managed password is ever rotated (no rotation schedule is currently configured, so it won't rotate on its own) — if you ever add rotation, this secret needs to be regenerated to match, or switched to the DB_HOST/parts pattern instead.

Local Docker isn't installed on the machine this was built from, same as Kall — CodeBuild builds images from an uploaded source zip instead of a local `docker build && docker push`.

## Redeploying after a code change

There's no CI trigger — deploys are manual, and because CodeBuild sources from S3 (not GitHub directly), a redeploy needs a fresh zip upload first:

```bash
# From the repo root, with vaettir-toolkit active (aws login if expired):
git archive --format=zip -o /tmp/vaettir-source.zip HEAD
aws s3 cp /tmp/vaettir-source.zip s3://vaettir-build-source-094842496450/vaettir-source.zip --profile vaettir-toolkit --region us-east-2

# Rebuild whichever image changed
aws codebuild start-build --project-name vaettir-api-build --profile vaettir-toolkit --region us-east-2
aws codebuild start-build --project-name vaettir-web-build --profile vaettir-toolkit --region us-east-2

# Force ECS to pull the new :latest image
aws ecs update-service --cluster vaettir-cluster --service vaettir-api --force-new-deployment --profile vaettir-toolkit --region us-east-2
aws ecs update-service --cluster vaettir-cluster --service vaettir-web --force-new-deployment --profile vaettir-toolkit --region us-east-2
```

`git archive` only includes committed, tracked files (no `.git`, no `node_modules`, respects `.gitignore`) — uncommitted local changes will not be deployed.

## Known gaps / next steps

- **No custom domain / ACM cert on the ALB.** Same tradeoff as Kall: CloudFront → ALB is plain HTTP internally (`OriginProtocolPolicy: http-only`), the one unencrypted hop in the path. Fix if a domain is ever added: attach an ACM cert to the ALB, flip the origin policy to `https-only`.
- **No CI/CD trigger** — CodeBuild has to be started manually per the commands above, and (unlike a GitHub-sourced project) the source zip has to be re-uploaded every time too.
- **`vaettir-api-task-role` is empty** — fine while the API makes no AWS SDK calls of its own; will need real permissions the moment a feature needs one (e.g. S3 storage, matching Kall's `kall-api-task-role` pattern, if Vaettir ever needs file storage).
- **Backup retention is 1 day and single-AZ** — reasonable for a bootstrap/free-tier phase, not for a real production SLA.
- **Secrets are static, not auto-rotated** — see the `vaettir/database-url` note above.
