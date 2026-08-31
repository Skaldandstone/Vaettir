# Combined private-beta integration evidence

Status: HOLD. Local implementation verification is not external-beta acceptance.

Tested source: `e9607e3166473b782155dafc5b06891c2967ad6c` on `codex/private-beta-readiness`. All five workstreams and both integration-review corrections are included. Later documentation-only commits do not replace this tested identity. Source-to-integration commit mapping is in [parallel handoff](parallel-handoff.md); acceptance decisions remain in the [readiness register](readiness-register.md).

## Isolation and reproducibility

- Canonical checkout: `C:/Users/James/Documents/Vaettir`. Its untracked `NEEDS_ATTENTION.md` is preserved. The older GitHub checkout was not changed.
- Validation checkout: `C:/Users/James/Documents/vaettir-beta-worktrees/integration-validation`, detached at the exact tested source, clean before and after collection, without local `.env` files.
- New local database: `vaettir_permissions_candidate_test`, PostgreSQL 17 at `127.0.0.1:55439`, bounded connection pool of five. No production/customer database was used.
- Windows, Node 24.19.0, pnpm 11.23.0. Linux CI uses Node 22/PostgreSQL 16 and remains separately unverified.
- The collector removes inherited cloud, Clerk, AI-provider, telemetry, Expo/EAS and remote-cache credentials. Compile-only public keys and the exact source SHA are supplied to local web/mobile builds. No paid AI, cloud build, deployment, account mutation or external invitation was performed.
- After validation, the owned API and PostgreSQL processes were stopped. No other database clients were connected at shutdown. All disposable databases, build artifacts and logs remain on disk for review; nothing was deleted.

From the clean validation checkout, with the isolated database URL supplied through `DATABASE_URL`:

```powershell
node scripts/collect-release-evidence.mjs --web-build local-server
pnpm --filter @vaettir/api exec tsx scripts/verify-ci-mapping-migration.ts
```

Run the migration verifier alone, after migrations/reference seeding and without concurrent fixture writers. Its guard requires a loopback database named `vaettir_permissions*test`.

## Exact candidate results

Collector directory, relative to the validation checkout:

`.local/readiness/e9607e3166473b782155dafc5b06891c2967ad6c-2026-08-31T00-25-28-864Z/`

The manifest records 18 command logs and 40 migration hashes. All 18 log hashes were independently recomputed and matched. Collection completed with exit 1 and `LOCAL_CHECKS_PASSED_SECURITY_BLOCKED`, deliberately retaining the dependency gate.

| Check | Result |
|---|---|
| Frozen install, Prisma generation | Passed |
| Fresh migrations, reference seed, schema status | All 40 migrations applied; seed and status passed |
| Operations/health contract tests | 9 passed |
| Patched dependency consumer regressions | 10 passed, including bounded malformed-image checks |
| Core / API / mobile tests | 37 / 113 / 12 passed, with fresh Turbo execution |
| Web permission/environment tests | 30 passed |
| Disposable browser fixture contracts | 5 passed, including owner bootstrap and fixture cleanup; no browser or Clerk network calls |
| Workspace typecheck | Seven tasks passed |
| Workspace lint | Passed, 34 existing web warnings, zero errors; direct operations lint passed |
| Production web/API/shared builds | Five tasks passed, 65.239 seconds; Windows local-server variant, not Linux standalone/container packaging |
| Expo compatibility | Passed |
| Browser discovery | 87 tests in 17 files; discovery only, not authenticated execution |
| Production dependency audit | Two high, zero critical/moderate/low; remains blocked |

Total executed test cases: 216 across the seven test groups above. The API count includes the six XML regressions and five new credit-scheduler rejection/recovery cases; do not count them again.

The additional `mapping-preservation.log` records execution of the actual migration SQL against the reconstructed prior unique-index contract. An existing mapping row stayed unchanged, identical names were accepted in separate projects, and all test DDL/data rolled back. SHA-256: `167ccfc837986f2c347c8cd3892638909cd7f43b37d053cc721f2465f527a085`.

## Local runtime health

`.local/health-evidence/2026-08-31T00-28-07-445Z/manifest.json` records a real API process on port 43841 against the same candidate and synthetic database. Database connectivity, all three non-stale pollers and the exact release SHA passed. A second probe with an intentionally wrong SHA failed specifically with `RELEASE_COMMIT_MISMATCH`. The owned API process was then stopped. Sanitized `api.log` SHA-256: `e55738ffb7a7a1416501392087597f92eca73ffd645321c5614cc6f448a88bbf`.

This proves local startup/liveness, not authenticated requests, worker job completion, deployed topology or alert delivery. An earlier interim probe at 350d7a8 failed to reach its chosen port and remains recorded at `.local/health-evidence/2026-08-31T00-23-22-342Z/`; neither that failure nor its wrong-SHA request is accepted as health evidence.

## Mobile artifact boundary

The mobile lane's native APK hash was independently recomputed and matched the [mobile handoff](mobile-handoff.md). It was compiled from mobile source c62c925, uses an Android Debug certificate and a nonfunctional compile-only Clerk key, and is not the combined candidate or a distributable beta package. Its arm64 compile does not prove complete support for every packaged ABI. Do not distribute or relabel it as device-tested.

Final-candidate JavaScript export passed for both Android (1,059 modules) and iOS (1,058 modules). Evidence is recorded separately under `.local/mobile-evidence/e9607e3166473b782155dafc5b06891c2967ad6c/`, including the command log, exact source SHA and hashes for both Hermes bundles and metadata. Outputs are in `apps/mobile/.expo/integration-export`. JavaScript export never closes native signing, physical-device, restricted-distribution or iOS TestFlight acceptance.

## Remaining blockers

- Two visible image-size advisories. The [focused mitigation review](dependency-integration-review.md) is not a blanket security exception or release approval. Linux/native target and build-exposure verification remain required.
- GitHub account execution restriction, Linux/container packaging, and propagation of the required full release SHA through the existing S3/CodeBuild manual deployment path.
- Explicit AWS reauthentication approval, live configuration/revision checks, isolated GitHub installation/webhook and artifact upload/download proof.
- Dedicated verified Clerk development identity and matching test keys; actual browser invitation, role, recovery and visual acceptance. The Clerk-guided fixture structure uses isolated auth state and test credentials, but has not been exercised with a real session.
- Approved mobile production identity, signing/Expo/Apple access, a complete final-candidate Android build, restricted distribution, Android recordings and iOS friend testing.
- Production alert delivery, seven-day recoverability, populated isolated restore within four hours, and security-compatible rollback. The operations lane's 2.731-second synthetic restore contained no organizations/ledger rows and used the earlier 39-migration schema.
- Legacy global catalogs, invalid compound links and sole-owner service accounts need an approved live-data audit. Never delete mappings to force a global-uniqueness downgrade.

James retains cohort invitations, spending/account approvals and final go/no-go. No team should be invited based solely on this local evidence.
