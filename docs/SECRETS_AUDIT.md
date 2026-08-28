# Secrets management audit (P10-02)

What actually holds each real secret this codebase uses, checked directly
against the live AWS account (`aws ecs describe-task-definition`,
`aws secretsmanager get-secret-value`) on 2026-08-27 - not inferred from
code alone.

## Production (ECS / Secrets Manager)

| Secret | Used by | Where it lives in production |
|---|---|---|
| `DATABASE_URL` | `vaettir-api` | AWS Secrets Manager (`vaettir/database-url`) ✅ |
| `ANTHROPIC_API_KEY` | `vaettir-api` | AWS Secrets Manager (`vaettir/anthropic-api-key`) ✅ |
| `CLERK_SECRET_KEY` | `vaettir-api`, `vaettir-web` | AWS Secrets Manager (`vaettir/clerk-secret-key`) ✅ |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `vaettir-web` (build time) | Plaintext in the `vaettir-web-build` CodeBuild project - **correct as-is**, this is a publishable key, meant to ship in the client bundle |
| `NEXT_PUBLIC_API_URL` | `vaettir-web` (build time) | Plaintext in CodeBuild - not sensitive (just `https://vaettir.skaldandstone.com/api`) |
| `GITHUB_APP_ID` | `vaettir-api` | **Not deployed anywhere in production.** Real value exists in local `.env` only. Not secret-sensitive itself (a public numeric App ID), but the App won't function without it set alongside the two below. |
| `GITHUB_APP_PRIVATE_KEY` | `vaettir-api` | **Not deployed anywhere in production.** Real PEM key exists in local `.env` only - genuinely sensitive, must go through Secrets Manager like the three above, never a plain task-def env var. |
| `GITHUB_WEBHOOK_SECRET` | `vaettir-api` | **Not deployed anywhere in production.** Real value exists in local `.env` only. |
| `SENTRY_DSN` | `vaettir-api`, `vaettir-web` | **Not deployed anywhere in production - no value exists anywhere yet.** `P10-05`'s Sentry wiring is real and verified, but there's no Sentry project/DSN to point it at. Not secret-sensitive (Sentry DSNs are meant to be public, e.g. shipped in the `NEXT_PUBLIC_SENTRY_DSN` browser bundle), but see `NEEDS_ATTENTION.md` for what's needed to activate it. |

**Net finding**: every secret this codebase actually references is either
correctly in Secrets Manager, or correctly plaintext because it's meant to
be public - **except** the three GitHub App values, which are real,
working, and sitting only in a local `.env` file. This is the same gap
flagged in `NEEDS_ATTENTION.md`: Phase 6 (PR scanning) is fully built and
would work today in production the moment those three values are pushed to
Secrets Manager and added to the `vaettir-api` task definition. Not done in
this pass - handling a real private key through AWS mutations needs your
sign-off, not something to push through under a general "keep building"
authorization.

## Local development

`.env` (repo root, gitignored, confirmed via `.gitignore`) holds every
secret above in plaintext for local dev - this is normal and expected for
local development, not a gap. `.env.example` documents every variable name
with an empty placeholder value, kept in sync (fixed a stale pre-rename
`DATABASE_URL` example during `P10-12`).

## What's NOT a secret-management gap (checked, ruled out)

- **S3 artifact storage** (`P5-15`'s `vaettir-test-artifacts` bucket): no
  access-key secret anywhere - the API talks to S3 via `vaettir-api-task-role`'s
  IAM role (the ECS task's own identity), which is the *more* secure
  pattern than a stored key, not a gap.
- **AWS credentials themselves**: this deploy pipeline runs from a human's
  own `aws login`-backed SSO session (`vaettir-toolkit`), not a stored
  static access key anywhere in the repo or CI - confirmed via
  `scripts/deploy-aws.sh`'s own header comment, which documents that the
  account's SCP explicitly denies `codebuild:StartBuild`/`s3:PutObject`/
  `ecs:UpdateService` to every identity except an interactive human SSO
  session, by design.
- **API keys for CI integrations** (`P1-05`'s `ApiKey` model): stored
  hashed in the database (`hashedKey`), never in plaintext anywhere after
  creation - the real key is shown to the creator exactly once, same
  pattern this session's own `P13-03`/`P9-06` work reused for invite
  tokens and webhook secrets.

## Remaining action (needs you, not more code)

Push `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY`/`GITHUB_WEBHOOK_SECRET` to AWS
Secrets Manager and wire them into the `vaettir-api` task definition (same
pattern as the three secrets already there), then redeploy. See
`NEEDS_ATTENTION.md` for the exact commands and reasoning.
