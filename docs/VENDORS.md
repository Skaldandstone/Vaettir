# Sub-processor and vendor register

P10-01 (SOC 2 groundwork): the "vendor management" control is a maintained
list of every third party that stores, processes, or can reach customer
data, with what each one sees and why. This is that list, derived from
what the codebase and the AWS account actually use as of 2026-09-10 - not
an aspirational list. Anything marked **[James]** is a fact only the
account owner can confirm (contract terms, DPA signed, plan tier).

Review cadence: re-check this file whenever a new external service is
wired in (grep for a new `fetch(` host, SDK, or Secrets Manager entry) and
at least quarterly. Record the review in the table at the bottom.

## Sub-processors (touch customer data)

| Vendor | What it does for Vaettir | Customer data it sees | Region | Auth / access path | DPA / terms |
|---|---|---|---|---|---|
| **Amazon Web Services** (account 051722405355) | Hosts everything: ECS (api + web), RDS Postgres (`vaettir-postgres`), S3 (test-result artifacts, build source), Secrets Manager, CloudFront, CodeBuild, CloudWatch Logs | All of it - the primary database, uploaded test artifacts (screenshots/videos/logs from failed test runs), application logs | us-east-2 (Ohio); CloudFront edge global | IAM roles per task; no long-lived access keys in the app (see `docs/SECRETS_AUDIT.md`) | AWS Customer Agreement + AWS DPA (GDPR) apply by default. **[James]** confirm account is under the studio's legal entity |
| **Anthropic** (Claude API) | Every AI feature: reverse-engineering test files, risk assessment, strategy drafts, requirement extraction, failure classification, release summaries, quality review | Test source code pasted or scanned from customer repos, test case text, requirement documents, diff content, failure messages. Token usage per call is recorded on `AiCreditTransaction` (P12-12) | US | `ANTHROPIC_API_KEY` in Secrets Manager; server-side only | Commercial API terms: inputs are not used for training by default. **[James]** confirm the account's data-retention setting and whether a zero-data-retention agreement is wanted for enterprise customers |
| **Clerk** | Authentication and session management for web and mobile; user identities | Names, email addresses, auth events, session tokens. Vaettir stores only `clerkUserId` + email in its own `User` table | US | Clerk SDKs; `CLERK_SECRET_KEY` in Secrets Manager | **[James]** Clerk DPA available on their dashboard - confirm signed |
| **Sentry** (org `skald-and-stone`) | Error tracking + performance tracing for api and web | Stack traces, request paths, error messages (which can contain ids and occasionally user-supplied text), user geo/IP on events. Since 2026-09-10 only production reports (`P10-05`) | US (default region) | DSNs in the ECS task definitions | **[James]** confirm Sentry DPA; consider PII scrubbing rules (`beforeSend`) before enterprise customers |
| **Expo** (push service, `exp.host`) | Delivers mobile push notifications (sign-off requests, readiness changes) | Push tokens, notification title/body (contain project and release names, control titles) | US | Unauthenticated Expo push API from the API service (`services/pushNotify.ts`) | Expo terms of service. **[James]** an EAS project still has to be created before real devices can register |

## Customer-configured destinations (customer chooses to send data there)

These are not Vaettir sub-processors - the customer's own admin opts in
per organization - but they are listed because the platform does send
customer data to them on the customer's instruction.

| Destination | Configured where | What is sent |
|---|---|---|
| **Slack** (incoming webhooks) | Org settings → readiness digest URL + event subscriptions (`P7-09`, `P9-03`) | Daily readiness digest; risk flag / sign-off / review-queue / readiness-change events with project, release, control and signer names |
| **Customer webhook endpoints** | Org settings → Webhooks (`P9-06`) | The same events as JSON, HMAC-signed with the endpoint's secret |
| **GitHub** (App + PR comments) | Project repo URL + the GitHub App (`P6-01`; App secrets not yet deployed to production, see `NEEDS_ATTENTION.md`) | PR-scan results as PR comments; read access to repo contents for diffs |
| **GitLab** (MR notes) | `GITLAB_ACCESS_TOKEN` (not provisioned in any environment yet, `P6-07`) | MR-scan results as MR notes |

## Infrastructure / tooling vendors (no customer data)

| Vendor | Role | Notes |
|---|---|---|
| **GitHub** (`Skaldandstone/Vaettir`) | Source control, CI (`.github/workflows/ci.yml`), Dependabot | Source code only; no customer data in the repo (transcripts and `.env` are git-ignored) |
| **Cloudflare** | DNS for `skaldandstone.com` (the `vaettir.` subdomain is not yet pointed at CloudFront - see `docs/AWS_DEPLOYMENT.md` known gaps) | DNS only today |
| **Docker Hub** | Base image pulls (`node:22-slim`) during CodeBuild | Build-time only |
| **npm registry** | Dependencies via pnpm | Build-time only |

## Data-flow notes an auditor will ask about

- **Customer source code leaves the platform in exactly one direction**: to
  Anthropic, when a customer invokes an AI feature. Repo scans clone into
  the API task's ephemeral filesystem and are discarded after the job.
- **Secrets** are in AWS Secrets Manager, read by ECS at task start; the
  one known gap and the rotation problem are in `docs/SECRETS_AUDIT.md`
  and `docs/AWS_DEPLOYMENT.md`.
- **Backups**: RDS automated backups, 7-day retention
  (`docs/DATABASE_BACKUP_RESTORE.md`).
- **Retention**: per-org `dataRetentionYears` (default 5) is enforced as a
  dry-run report only today - no automatic purge exists yet (`P12-08`).
- **Access review**: quarterly in-product access review of every org
  member is built (`P10-01`, org settings → Access Review).

## Review log

| Date | Reviewer | Change |
|---|---|---|
| 2026-09-10 | Claude (from code + AWS account inspection) | Initial register. Every **[James]** item is unconfirmed. |
