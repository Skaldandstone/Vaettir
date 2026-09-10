# AWS deployment

Vaettir's API and web app run on AWS (account `051722405355`, region `us-east-2`).

## Account context

**Rebuilt here 2026-09-02.** The original account (`094842496450`) was removed
from the AWS organization as part of a broader account restructuring (James:
"we made a new account for things... the old account no longer exists, we
deleted that old data, it was not needed"). Everything below was recreated
from scratch in the new account - James's direction was "use the management
account to build what you need, but it should not be associated to Kall,"
so this lives directly in `051722405355` (the org's management account),
deliberately kept separate from Kall's own resources (which live in a
member account, `734702670689`).

Unlike the old account, this one is **not** a region-locked "new AWS
experience" account with hostile SCPs - no CodeConnections/CodeBuild/S3/ECS
denials were hit while rebuilding. `vaettir-toolkit` (`aws login`, assumes
`AccountFullAccessRole`) is still the profile used for all AWS work here;
no separate `VaettirBot` IAM user was recreated, since nothing so far has
needed a non-interactive credential path. Re-run
`aws login --region us-east-2 --profile vaettir-toolkit` when the session
expires - the browser-based flow authenticates as whatever AWS account is
currently active in your browser, not by account ID, so double-check which
account it lands you in in before confirming an overwrite.

CodeBuild still sources from S3 rather than GitHub (a zip of `git archive`
output, uploaded to `s3://vaettir-build-source-051722405355/vaettir-source.zip`
before each build) - this matches the old architecture and was never
re-tested against CodeConnections here, since S3-source works regardless
and there was no reason to introduce a new source type mid-rebuild.

## Why this architecture, specifically

Same reasoning as before and as Kall's - no NAT Gateway (cost), ECS Fargate
tasks in public subnets with security-group isolation instead of private
subnets, CloudFront in front of the ALB for HTTPS without needing an ACM
cert on the ALB itself. Worth calling out:

- **The web app calls the API directly from the browser**, not through a server-side proxy route like Kall's `/api/kall/[...path]`. `NEXT_PUBLIC_API_URL` is baked into the web image at *build time* (`https://d35bt2repnvk6t.cloudfront.net/api`) as a Docker build arg, not an ECS runtime env var - Next.js inlines `NEXT_PUBLIC_*` vars into the client bundle during `next build`, so setting them only on the running container does nothing.
- **Both `Dockerfile.api` and `Dockerfile.web` require a real 40-hex-char `VAETTIR_RELEASE_COMMIT` build arg** (`RUN node -e "if(!/^[a-f0-9]{40}$/.test(process.argv[1]))process.exit(1)" "$VAETTIR_RELEASE_COMMIT"`) - a real gap found during this rebuild: `scripts/deploy-aws.sh` packaged `git archive` output (which strips `.git`, so nothing inside the build can derive a commit SHA on its own) but never passed one to CodeBuild, so the very first api build failed this check immediately. Fixed by having `deploy-aws.sh` capture `git rev-parse HEAD` before packaging and pass it via `--environment-variables-override` on every `codebuild start-build` call; both CodeBuild projects also carry a dummy all-zeros default value so `create-project`/`update-project` has something valid to register even before an override is supplied.
- **`apps/api/src/server.ts` mounts every route twice**: once unprefixed (`/health`, `/trpc/*`) for ECS target-group health checks hitting the task's IP directly, and once under `/api` (`/api/health`, `/api/trpc/*`) for real traffic through the ALB's path-based rule, since the ALB only routes `/api/*` to the API service (the same domain also serves the web app on every other path).
- **Prisma migrations run as the container's own startup command** (`prisma migrate deploy && node apps/api/dist/server.js` in `Dockerfile.api`'s `CMD`), not as a separate CI step - RDS isn't reachable from outside the VPC, so the running ECS task is the only thing with network access to migrate against. Confirmed working again against the fresh, empty `vaettir-postgres` instance: the api task came up `HEALTHY` on first try, meaning migrations applied clean.
- **`packages/db`, `packages/core`, and `packages/ai-agent` have a real build step** (`"build": "tsc -p tsconfig.json"`, `main`/`types` pointing at `dist/`) so a plain-node runtime can resolve their `.js`-suffixed imports. `Dockerfile.api`/`Dockerfile.web` run `pnpm turbo run build --filter=...` (turbo's dependency graph builds core → db → ai-agent → api/web in order).
- **`node:22-slim` needs `openssl` installed explicitly** for Prisma's engine binaries to work.
- **The web container also needs `CLERK_SECRET_KEY` at runtime**, not just build-time - a real gap the first rebuild deploy hit: `clerkMiddleware()` runs server-side on every request, so without the secret key present as a runtime env var the web app 500s on every route with "Clerk: auth() was called but Clerk can't detect usage of clerkMiddleware()". Fixed by adding it to the `vaettir-web` task definition's `secrets` block (`arn:...:secret:vaettir/clerk-secret-key-rw7ng8`), same as the api task already had.

## What exists

| Resource | Identifier |
|---|---|
| ECS cluster | `vaettir-cluster` |
| ECS services | `vaettir-api` (Service Connect *and* public ALB path at `/api/*`), `vaettir-web` (behind the ALB) |
| Task definitions | `vaettir-api:1`, `vaettir-web:2` (Fargate, 256 CPU / 512 MB each - `vaettir-web` is on revision 2 because revision 1 was missing `CLERK_SECRET_KEY`, see above) |
| ECR repos | `051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api`, `.../vaettir-web` (KMS-encrypted, scan-on-push) |
| RDS instance | `vaettir-postgres` - `db.t4g.micro`, Postgres 16.15, single-AZ, 20GB gp3, storage-encrypted, not publicly accessible, `rds.force_ssl=1` via parameter group `vaettir-postgres16-forcessl`, 1-day backup retention, master password managed by RDS (`--manage-master-user-password`), endpoint `vaettir-postgres.cx6smo0e03mv.us-east-2.rds.amazonaws.com:5432` |
| Service Connect namespace | `vaettir.local` (Cloud Map HTTP namespace) - API reachable internally at `vaettir-api.vaettir.local:8000` (not currently used by anything; web calls the public endpoint instead) |
| ALB | `vaettir-alb`, HTTP listener on 80. Default action → `vaettir-web-tg` (port 3000). Rule (priority 1, path `/api/*`) → `vaettir-api-tg` (port 8000, target type `ip`, health check `/health`) |
| CloudFront | `E1QNL3G1SCY7X` → `https://d35bt2repnvk6t.cloudfront.net` (the current public URL - `vaettir.skaldandstone.com` is not wired up yet, see "Known gaps" below) |
| Secrets Manager | `vaettir/anthropic-api-key`, `vaettir/clerk-secret-key`, `vaettir/database-url` (composed once from the RDS-managed secret - see note below), plus the RDS-managed `rds!db-...` secret itself. The GitHub App secrets (`GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY`/`GITHUB_WEBHOOK_SECRET`) were **not** re-pushed - the local `.env` value for `GITHUB_APP_PRIVATE_KEY` looks stale/placeholder (55 characters total, nowhere near a real PEM key length), so Phase 6 PR scanning stays non-functional in production until real values are sourced. |
| S3 source bucket | `vaettir-build-source-051722405355` - private, holds the `git archive` zip CodeBuild builds from (see "Redeploying") |
| S3 test-artifacts bucket | `vaettir-test-artifacts-051722405355` (P5-15) - private (all public access blocked), SSE-AES256 by default, 90-day object expiration lifecycle rule. `TEST_ARTIFACTS_BUCKET`/`AWS_REGION` are wired into the `vaettir-api` task definition's plaintext env this time round, so this actually works in production now (it never did in the old account - see the old known-gaps note this replaces). |
| IAM roles | `vaettir-ecs-execution-role` (ECR pull, CloudWatch Logs, inline `VaettirSecretsAccess` policy reading `vaettir/*` and `rds!db-*` secrets), `vaettir-api-task-role` (inline `TestArtifactBucketAccess` policy: `s3:PutObject`/`s3:GetObject` scoped to `vaettir-test-artifacts-051722405355/*`), `vaettir-codebuild-role` (inline `VaettirCodeBuildAccess`: ECR push, CloudWatch Logs, S3 read on the source bucket) |
| CodeBuild projects | `vaettir-api-build` (`Dockerfile.api`, `BUILD_GENERAL1_SMALL`), `vaettir-web-build` (`Dockerfile.web`, env vars `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`/`NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_SENTRY_DSN` baked in on the project, `VAETTIR_RELEASE_COMMIT` overridden per-build by `deploy-aws.sh`, `BUILD_GENERAL1_MEDIUM`) - both source from S3 with an inline buildspec (`docker build` + `docker push`, `privilegedMode: true`), `aws/codebuild/standard:7.0`. **`vaettir-web-build` needs the MEDIUM tier, not SMALL** - a real deploy after this rebuild failed with `next build` getting SIGKILL'd (OOM) on `BUILD_GENERAL1_SMALL`'s 3GB; bumped to `BUILD_GENERAL1_MEDIUM` (7GB) and it passed clean. Worth knowing if `codebuild update-project --environment` is ever used to change one setting: it replaces the whole `environment` object, so a naive update that omits `environmentVariables` silently wipes them - confirmed happening once here, caught immediately and re-applied alongside the compute-tier change in the same call. |
| Security groups | `vaettir-alb-sg` (80 from internet) → `vaettir-web-tasks-sg` (3000 from ALB) and `vaettir-api-tasks-sg` (8000 from web tasks *and* from `vaettir-alb-sg` directly) → `vaettir-rds-sg` (5432 from API tasks) |

`vaettir/database-url` is a **static** composed connection string
(`postgresql://vaettir_admin:<password>@...postgres?sslmode=require`),
built once from the RDS-managed secret's password at setup time - Prisma
wants one URL. Connects to the default `postgres` database (no dedicated
database name was created).

**It goes stale every 7 days.** The earlier note here ("no rotation
schedule is currently configured") was wrong: `vaettir-postgres` uses an
RDS-*managed* master password, and RDS rotates managed passwords
automatically every 7 days whether or not a Secrets Manager rotation
schedule is configured. First bitten 2026-09-09 08:07 UTC - production DB
auth failed for ~28 hours until noticed (health reported `db.ok: false`,
every API request 500'd) because the composed URL still carried the
previous password. Recovery, and the thing to run whenever `db.ok` goes
false again (next expected drift is ~2026-09-16):

```bash
node scripts/sync-db-secret.mjs            # dry run - reports passwordDiffered
node scripts/sync-db-secret.mjs --apply    # rewrites vaettir/database-url
aws ecs update-service --cluster vaettir-cluster --service vaettir-api --force-new-deployment --region us-east-2 --profile vaettir-toolkit
```

The script never prints a secret value. The proper fix is one of: (a)
`aws rds modify-db-instance --db-instance-identifier vaettir-postgres
--rotate-master-user-password false`-equivalent - i.e. stop using an
RDS-managed password and set a static master password stored only in
`vaettir/database-url`; or (b) have the API compose `DATABASE_URL` at
startup from the managed secret's `username`/`password` fields instead of
reading a pre-composed URL. Both change production auth configuration, so
neither has been done without an explicit go-ahead.

Local Docker isn't installed on the machine this was built from - CodeBuild
builds images from an uploaded source zip instead of a local
`docker build && docker push`. One transient issue hit during the rebuild:
CodeBuild's shared IP pool got Docker Hub-rate-limited pulling
`node:22-slim` (`429 Too Many Requests` on the anonymous pull) on the first
api build attempt - resolved by simply retrying; not a real problem with
the build itself, but worth knowing if a build fails immediately on the
`FROM` line with no other explanation.

## Redeploying after a code change

There's no push-triggered CI (this account's SCP situation wasn't
re-verified either way, and S3-source deploys work regardless) - deploys
are one command:

```bash
./scripts/deploy-aws.sh          # rebuild + redeploy both api and web
./scripts/deploy-aws.sh api      # only api
./scripts/deploy-aws.sh web      # only web
```

Needs `vaettir-toolkit` active (`aws login --region us-east-2 --profile vaettir-toolkit` if expired). It packages the committed tree with `git archive` (no `.git`, no `node_modules`, respects `.gitignore` - uncommitted local changes are not deployed), uploads to S3, starts the CodeBuild project(s) with the current `git rev-parse HEAD` passed through as `VAETTIR_RELEASE_COMMIT`, waits for them, then forces a new ECS deployment.

## Known gaps / next steps

- **`vaettir.skaldandstone.com` is not wired up yet.** An ACM cert (`arn:aws:acm:us-east-1:051722405355:certificate/073eacad-6d20-4d69-ac48-cdd6c156816f`) has been requested for the domain and is pending DNS validation. James can't migrate the `skaldandstone.com` zone into the Cloudflare account connected to this session until **September 6** - until then, the app is only reachable at the raw CloudFront URL above. Once the zone is migrated: add the ACM validation CNAME, wait for the cert to issue, attach it to the CloudFront distribution as an alternate domain name (`vaettir.skaldandstone.com`), then add a CNAME record pointing `vaettir` at `d35bt2repnvk6t.cloudfront.net`.
- **GitHub App secrets not deployed** - see the Secrets Manager row above. Needs real values (the local `.env` one looks stale) before Phase 6 PR scanning works in production.
- **Sentry DSNs are set** (`vaettir-api`/`vaettir-web` projects under the `skald-and-stone` Sentry org) but source-map upload isn't configured - see `NEEDS_ATTENTION.md` P10-05 for the optional `SENTRY_AUTH_TOKEN` step.
- **Backup retention is capped at 1 day** - was an enforced free-tier limit on the old account; not re-verified whether the same restriction applies here.
- **Single-AZ** - a deliberate cost choice, not re-evaluated.
- **The RDS master password auto-rotates every 7 days and the composed `vaettir/database-url` does not follow it** - see the note above for the recovery script and the two candidate permanent fixes. Until one is chosen, expect a DB-auth outage roughly weekly unless `scripts/sync-db-secret.mjs --apply` + an API redeploy is run after each rotation.
- **`STAFF_ADMIN_TOKEN` (staff-plane bearer token, from the P13-01/staff-plane work) was not recreated** - it didn't exist in the local `.env` at rebuild time, so the Adminhelper Cloudflare Worker integration is not functional against this rebuilt account until a new token is generated and pushed to Secrets Manager + the `vaettir-api` task definition.
