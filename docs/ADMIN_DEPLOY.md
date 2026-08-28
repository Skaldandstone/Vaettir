# Deploying the staff plane

This covers rolling out the staff/support admin surface added on
`claude/staff-plane`: the staff-authenticated tRPC router
(`apps/api/src/routers/staff.ts`), its identity resolution in
`apps/api/src/trpc.ts`, and the `STAFF_ADMIN_TOKEN` it reads. It sits on top
of the existing infra in `docs/AWS_DEPLOYMENT.md` — read that first for the
account model (`094842496450`, `us-east-2`, new-AWS-experience, ECS/Fargate,
the `vaettir-toolkit` SSO profile, S3-sourced CodeBuild). Nothing here changes
the architecture; it adds one secret and rolls `vaettir-api` onto the new
image.

## What ships

- `apps/api/src/trpc.ts` — `resolveStaff()` reads `X-Staff-Token` and compares
  it (constant time) against `process.env.STAFF_ADMIN_TOKEN`, with the acting
  human forwarded in `X-Staff-Actor`. Staff identity is deliberately **separate
  from tenant `OrgRole`** — a staff caller is not a member of any org. Exposed
  as `staffProcedure`; no token set ⇒ every staff procedure rejects.
- `apps/api/src/routers/staff.ts` — `listOrgs`, `orgDetail`,
  `creditForensics`, `listPlanTiers`, `adjustCredits` (writes an `ADJUSTMENT`
  ledger entry, never a raw balance poke), `setPlanTier`, `revokeApiKey`.
- `apps/api/src/router.ts` — wires `staff: staffRouter`.

No Prisma migration is involved — `adjustCredits` appends to the existing
credit ledger; everything else is reads plus updates to existing columns.

## One new secret

`resolveStaff()` reads `STAFF_ADMIN_TOKEN` from the process environment. Store
it in Secrets Manager next to the other `vaettir/*` secrets and inject it into
the `vaettir-api` task definition — do **not** bake it into the image (build
args are recorded in image history).

```bash
# Generate and store.
TOKEN=$(openssl rand -hex 32)
aws secretsmanager create-secret \
  --name vaettir/staff-admin-token \
  --secret-string "$TOKEN" \
  --profile vaettir-toolkit --region us-east-2

# Put the SAME value into the portal Worker so its Vaettir proxy can authenticate:
#   grok-adminhelper secret  VAETTIR_STAFF_TOKEN = $TOKEN
# (see ginnungagap/infra/adminhelper/DEPLOY.md)
```

`vaettir-ecs-execution-role` already reads `vaettir/*`, so no IAM change is
needed. Add to the `vaettir-api` task definition's `secrets` block:

```json
{ "name": "STAFF_ADMIN_TOKEN",
  "valueFrom": "arn:aws:secretsmanager:us-east-2:094842496450:secret:vaettir/staff-admin-token" }
```

Register the new revision before deploying so the running task actually sees
the variable — `scripts/deploy-aws.sh` forces a new deployment but does not
edit the task definition.

## Roll it out

```bash
# Needs an active vaettir-toolkit session:
#   aws login --region us-east-2 --profile vaettir-toolkit
./scripts/deploy-aws.sh api
```

That packages the committed tree (`git archive` — commit first, uncommitted
changes are not deployed), uploads to `s3://vaettir-build-source-.../`,
runs `vaettir-api-build`, waits, and forces a new `vaettir-api` deployment.
Make sure the branch carrying `staff.ts` is what gets packaged (merge to the
deployed branch, or run the script from that checkout). The API container runs
`prisma migrate deploy` on start; no staff migration exists, so it's a no-op
here.

## Verify

```bash
BASE=https://d3lnl5r1k2mxoz.cloudfront.net   # public CloudFront URL
# Staff procedures are tRPC; the simplest check is that the unprefixed health
# path is up, then exercise a staff read through the portal.
curl -s "$BASE/api/health"
```

Then confirm the Vaettir tab at grok.skaldandstone.com/adminhelper — a
`listOrgs` read proves the Worker→`VAETTIR_STAFF_TOKEN`→API path, and any
`adjustCredits`/`setPlanTier`/`revokeApiKey` write is audited both to the D1
log (Worker side) and as an `ADJUSTMENT` ledger row (API side), with the
acting human in `X-Staff-Actor`.

## Notes

- **No push-triggered CI is possible in this account** — the SCP denies
  `codebuild:StartBuild` / `s3:PutObject` / `ecs:UpdateService` to every
  identity except an interactive SSO session (see `docs/AWS_DEPLOYMENT.md`).
  `scripts/deploy-aws.sh` run by a human is the ceiling.
- **Rotating the token**: new value into `vaettir/staff-admin-token`,
  `--force-new-deployment` on `vaettir-api`, then update
  `VAETTIR_STAFF_TOKEN` on the Worker (Worker second, so the portal never
  holds a token the API has already rotated away from).
