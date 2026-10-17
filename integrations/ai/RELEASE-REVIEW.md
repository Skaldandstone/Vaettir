# Synthetic connection release review

Scope: customer disclosure controls and a local Codex plugin for a dedicated
synthetic tenant. This does not authorize customer data access, public listing,
other AI hosts, writes, or general availability.

The implementation and historical fixture at `364ea84` passed
[full CI 38977592201](https://github.com/Skaldandstone/Vaettir/actions/runs/38977592201):
4,362 API assertions passed / 52 skipped; web 884 Node and 2,430 Vitest assertions
passed; typecheck, lint, migration/operations and production artifacts passed.
Historical upgrade and both restores used the genuine old client and retained
every original schema/migration pin. Native jobs skipped by workflow conditions
confer no new native-host acceptance. Later release-preparation changes require
their own checks; this CI run does not cover later source.

## Security findings and boundaries

| Boundary | Reviewed behavior |
| --- | --- |
| Authorization | Current verified human admin/full seat; tenant/project locks; explicit synthetic attestation and scope approval |
| Credentials | Separate random 256-bit bearer; stored SHA-256 only; one-time reply; expiry/rotate/revoke; no generic key fallback |
| Withdrawal | Permanent database-trigger revocation for membership/seat/identity/org withdrawal; restored authority never revives credentials |
| Disclosure | Three scoped SQL counts; no content loads or arbitrary filters; proprietary/regulated/unclassified denied; small cohorts suppressed |
| History | Audit commits before response; audit failure denies; immutable receipt cannot recover a secret |
| Client | HTTPS origin only, no redirects, bounded strict projection and timeout; denied reads prohibit alternate paths |
| Secrets | No-store replies bypass mutation cache; masked UI clears on identity/permission changes; no credentials in package |

Release preparation fixes missing explicit forwarding of the two connection
environment variables and supplies immutable allowlisted packaging and public
preflight. A bearer cannot attest which executable holds it. Classification is
an admin attestation, not a content scan. Delivered values cannot be recalled;
a read authorized before revocation may finish delivery afterward.

## Deployment and rollback conditions

Deploy API and web through the existing immutable release process, including
additive migration `20261016222000_ai_disclosure_grants`, current recovery proof,
image/native/security gates and a compatible rollback target. Production
dependencies, lockfiles and existing migration SQL are unchanged. Never reuse
another operator's source pin or replay a release intent.

Apply the schema before exposing the new UI/API. Existing projects remain
unclassified and unapproved. Keep the gateway flag off until the reviewed API
is stable, then enable it through the normal deployment process. Run the
packaged preflight against the exact deployed release before issuing a grant.

Rollback disables the gateway and revokes test grants first, then uses a
reviewed compatible application image; retain additive tables/history. Do not
drop tables, disable triggers or delete receipts to roll back. Historical
older-schema restores do not prove recovery of new grant/audit tables.

Immutable history restricts existing hard-delete paths after classification or
approval. Use a dedicated synthetic tenant and test administrator with an
accepted retention plan. General customer rollout remains on hold until a
separate retention/deletion workflow is reviewed. Do not advertise erasure as
complete while history prevents it.

Package install/initialization proves packaging and transport only. Actual
authenticated admin approval, installed-host read, revoke/deny, matching audit
and credential clearing are distinct steps in [CONNECTION-TEST.md](./CONNECTION-TEST.md).
