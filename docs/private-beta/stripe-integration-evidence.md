# August 31 billing continuation: combined evidence

Status: HOLD for external beta and all paid activation.

Tested implementation: `5a851f188f5693fbcfa7ea6d1cffff59232848ac`, branch `codex/private-beta-readiness`. This includes the prior five-lane candidate, the emergency service-owner key revocation correction, isolated test-only Stripe billing and adapted ownership/rights notices. Later documentation-only commits are not separately tested releases.

Canonical checkout: `C:/Users/James/Documents/Vaettir`. Validation checkout: `C:/Users/James/Documents/vaettir-beta-worktrees/integration-validation`, clean and detached at the exact implementation SHA, with no `.env` files. Existing canonical `NEEDS_ATTENTION.md` and every older GitHub-checkout edit remain untouched. No push, PR mutation, deployment, external invitation, Stripe account/payment mutation, AWS refresh or spending occurred.

## Exact candidate checks

Relative to the validation checkout, the collector manifest is:

`.local/readiness/5a851f188f5693fbcfa7ea6d1cffff59232848ac-2026-08-31T08-46-07-858Z/manifest.json`

All 18 command-log hashes were independently recomputed and matched. All 41 migration hashes are recorded. The collector deliberately exits 1 with `LOCAL_CHECKS_PASSED_SECURITY_BLOCKED` because audit findings remain visible.

| Check | Actual result |
|---|---|
| Frozen install, Prisma generation | Passed; Stripe 22.6.0 is the only new locked package, existing dependency patches unchanged |
| Fresh schema and reference data | All 41 migrations, seed and migration status passed on `vaettir_permissions_stripe_candidate_test`, loopback PostgreSQL 17, pool five |
| Typecheck | Seven tasks passed |
| Lint | Six tasks passed, 34 existing warnings, zero errors; direct operations lint passed |
| Core / API / mobile tests | 37 / 164 / 12 passed |
| Web permission / isolated fixture contracts | 30 / 5 passed; no authenticated browser session |
| Operations / dependency-consumer tests | 9 / 10 passed |
| Total tests | 267, including 51 new billing configuration/PostgreSQL/signature tests; no double counting |
| Production web/API/shared build | Five tasks passed; Turbo 122.825 seconds, collector wall time approximately 138 seconds; Windows local-server compilation only |
| Expo compatibility / browser discovery | Passed; 87 browser tests discovered, not executed |
| Production dependency audit | Two high image-size findings, zero critical/moderate/low; release gate remains blocked |

Actual API-method calls in billing tests are stubbed; the real Stripe SDK verifies webhook signatures against synthetic signed bytes. Tests are not evidence of a real Stripe Checkout, portal or account configuration. [Billing contract and owner decisions](billing-integration.md) record the precise limitations, default-disabled runtime, tax status and secret configuration.

## Runtime, migration preservation and native JavaScript

Additional manifest:

`.local/stripe-candidate-evidence/5a851f188f5693fbcfa7ea6d1cffff59232848ac/manifest.json`

- Actual CI-mapping migration SQL preservation verifier passed independently, after fixture writers finished.
- Actual production-mode local API started against the exact candidate and isolated database. Detailed health passed database, all three non-stale pollers and full SHA checks. An intentionally wrong SHA failed specifically with `RELEASE_COMMIT_MISMATCH`.
- Both actual Stripe webhook paths returned HTTP 503 with `Billing is disabled` in the default runtime. No secret or provider connection was necessary.
- Android and iOS Hermes exports passed with compile-only Clerk configuration and exact release identity. Both `.hbc` files and metadata are recorded. These are not signed packages or device evidence.
- All six additional log/artifact hashes were independently recomputed and matched. The owned API process was stopped.

The web exact ownership/rights footer and mobile Companion/signed-out About entries were also independently inspected read-only by the Studio legal coordination task. Existing older-layout code was not copied wholesale. Source, typecheck, build and bundle verification do not establish actual navigation, visual/device or legal acceptance.

## Populated synthetic recovery

Restore manifest: `.local/restore-evidence/2026-08-31T08-49-27-771Z/manifest.json`.
Full account-content comparison: `.local/billing-recovery/comparison.json`.
Reproduction fixture: `.local/billing-recovery-fixture.mjs` (local evidence helper, not product code).

An isolated `vaettir_billing_recovery_test` source with 41 migrations, five plans, one organization, one user, one membership, two credit-ledger rows, one billing account and one billing event was dumped and restored into the new `vaettir_billing_recovery_restore_test` database in **3.391 seconds**. Ledger balance was 493. Full selected table contents, including IDs, timestamps, ledger idempotency keys, billing scope and receipt, hashed identically before/after:

`d94f7c25bdb528227024e214496c72bfac9e008dd078f7721dc49e8fee3a00f6`

The dump hash was independently checked against its manifest. A deliberate retry against the existing target was refused before mutation, recorded at `.local/restore-evidence/2026-08-31T08-53-40-151Z/manifest.json`. This expected failure is retained, not relabeled as successful restoration.

This is synthetic local recovery mechanics, not RDS/PITR, production load, a seven-day recoverability window or the production four-hour restore objective. All source/target databases and dumps remain on disk. The owned PostgreSQL cluster on port 55439 was stopped after a query confirmed no other client connections. No data was deleted.

## Remaining software and owner gates

Two high image-size advisories remain visible with a reviewed local mitigation and passing consumer regressions. Linux Node 22/PostgreSQL 16, standalone/container/native targets and build-machine exposure still need verification. Do not upgrade to image-size 2.0.2 as a presumed fix; prior triage found both advisories still apply there.

A read-only GitHub comparison during this continuation found remote `master` at `96410579dc3bca2166724b0c83af652214d70dab`, five commits beyond the original base. Changes concern Node 22 / package-engine minimum 22.13, fresh hard-delete fixture data and actions/setup-node v7. This candidate already has Node 22 CI and its own fresh fixture repair, but keeps its prior engine/action declarations. Engineering must reconcile the small remote differences before publication, without overwriting this branch or claiming an unrun action-major upgrade is verified. No fetch, merge, push or workflow dispatch was performed. [Remote comparison](https://github.com/Skaldandstone/Vaettir/compare/9950b5ab9a029eb9c24585d0d47d36cf8d875c42...96410579dc3bca2166724b0c83af652214d70dab).

Ten dependency PRs remain individual compatibility work, as in [dependency triage](dependency-triage.md). Their August 27/28 failed build checks predate this repaired baseline and establish neither current failure nor upgrade success.

James still owns Stripe reauthentication, sandbox/catalog/commercial-policy decisions, approved test identities, GitHub execution/account approval, AWS reauthentication, Expo/Apple signing access, cohort invitations and go/no-go. Real hosted billing, authenticated browser screenshots, Android distribution/device acceptance, iOS TestFlight/device acceptance, deployed artifact/webhook/alert checks, seven-day backups and production restore/rollback remain unverified. Live billing and automatic tax remain disabled.
