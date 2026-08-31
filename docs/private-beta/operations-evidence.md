# Operations lane evidence

Status: local implementation validated, security and external acceptance gates remain BLOCKED. Integration owns the readiness register. No AWS sign-in, cloud/account changes, production mutations, paid infrastructure, paid builds or AI calls have been performed.

## Scope implemented

- Cross-platform candidate collector with a PowerShell entry point, isolated database/environment guards, clean-source checks, forced checks, immutable source/lock/migration/log hashes, and explicit audit failure states.
- Detailed-health checker requiring database health, every expected worker, and the exact release SHA.
- CI contract tests, deterministic dependency consumer test integration, bounded database-test workers, standalone artifact identity, and optional release-only Linux container runtime checks.
- Docker build revision arguments/labels, API health release identity, web/API telemetry release tags, safer Docker context exclusions, bounded telemetry sanitizer and a real SDK transport scrubbing test.
- Local synthetic dump/restore evidence script that refuses to overwrite a target and never claims production retention or recovery acceptance.
- An actual first digest-scheduler check, process-local overlap protection and failure/retry tests. Heartbeats still mean attempted-loop liveness, not successful delivery; cross-process duplicate delivery is not solved.
- Payload-free Fastify request/error logging with an actual in-process request/log test; HTTP error response semantics are unchanged.
- Runbook updates, including unsafe rollback boundaries for beta admission and project-scoped CI IDs.

## Verification record

Tested implementation commit: cb1776a4733cfb75510343f7ee6f20c2f7d80e7e, based on a6b5554. Source commits in order: 763b6f081923888ea0e802c0287970dd633000eb, 3798c7839326fa2caf112a693bdf00dab012c2ba, cb1776a4733cfb75510343f7ee6f20c2f7d80e7e. A subsequent documentation-only commit records these results; it is not a separately tested combined release.

Worktree: C:/Users/James/Documents/vaettir-beta-worktrees/operations. Platform: Windows x64, Node 24.19.0, pnpm 11.23.0, PostgreSQL 17. Database: vaettir_operations_test on loopback port 55447. Parent must rerun on the integrated dependency/permissions/mobile/browser candidate and on Linux/Node 22.

| Check | Actual result |
|---|---|
| Frozen install, generated Prisma client, migrations and seed | Pass; 39 migrations, five tiers, reference data |
| Typecheck | Seven tasks pass, forced fresh |
| Lint | Pass with 36 existing web warnings; operations scripts also pass direct lint |
| Core/API tests | 37 core + 74 API tests pass, no skipped tests, maxWorkers=2 |
| Operations/health contract tests | Nine pass |
| Web/API build | Five tasks pass in 80.396 seconds; VAETTIR_LOCAL_BUILD=1, not standalone/Linux |
| Expo dependency compatibility | Pass; no native compilation performed by this lane |
| Browser discovery | 71 scenarios listed; no authenticated execution or visual acceptance |
| Dependency audit | Exit 1; baseline 1 critical, 18 high, seven moderate. Separate dependency fixes are not merged into this lane |
| Dependency consumer suite | Not present in the lane baseline; explicitly recorded as requiring dependency-lane integration, not passed |
| Real local detailed health | Pass with exact cb1776a commit, healthy database and all three non-stale workers |
| Wrong release identity | Correctly rejected, even though HTTP and worker health were otherwise healthy |
| Synthetic restore | Pass in 2.731 seconds at source 763b6f0: 39 migration records, five plans, probe data match. Source had zero organizations/ledger rows, so this did not exercise populated ledger/account restore |
| Existing restore target | Correctly rejected without overwrite; all 39 target migration records retained |
| Workflow syntax / Docker copy contract | YAML parsed; source COPY . . precedes frozen install and includes patches/workspace config while excluding Windows node_modules. No Linux execution claim |

The final collector deliberately exited nonzero and recorded LOCAL_CHECKS_PASSED_SECURITY_BLOCKED. Do not change that to a pass based on another branch's audit.

Local evidence paths, relative to the worktree:

- `.local/readiness/cb1776a4733cfb75510343f7ee6f20c2f7d80e7e-2026-08-31T00-04-38-129Z/manifest.json`, with hashed command logs alongside it.
- `.local/readiness/763b6f081923888ea0e802c0287970dd633000eb-2026-08-30T23-56-17-575Z/manifest.json`, the earlier completed run retained for comparison.
- `.local/health-evidence/2026-08-31T00-07-37-714Z/manifest.json`, successful actual API observation.
- `.local/health-evidence/2026-08-31T00-07-37-837Z/manifest.json`, intentional wrong-SHA rejection.
- `.local/health-evidence/2026-08-31T00-07-15-635Z/manifest.json`, truthful startup rejection before the five-second reverse-engineer worker's first tick. Digest startup had already checked successfully.
- `.local/restore-evidence/2026-08-30T23-57-58-859Z/manifest.json`, successful synthetic restore and dump SHA-256.
- `.local/restore-evidence/2026-08-31T00-05-58-312Z/manifest.json`, intentional existing-target refusal.

All timestamps above are UTC; the work occurred August 30 in James's local time. The local API process and isolated PostgreSQL cluster were stopped after verification. The exact synthetic databases, dump and logs are retained under .local for review. No unrelated process, database or worktree was stopped or deleted.

## Integration notes

Keep the dependency lane's manifests, workspace config, both pinned patches and LF attributes together. Both Dockerfiles already copy the full filtered context before install and install native packages for the Linux target. They now require the full VAETTIR_RELEASE_COMMIT build argument; old deployment invocations without it will fail rather than emit unidentified images. Test image IDs/digests independently of operator-supplied labels.

The collector runs pnpm test:dependencies when integrated, while audit output remains a separate blocking gate. It does not suppress the two remaining image-size advisories on the dependency branch. Integrate the project-scoped CI-mapping migration and repeat all migration and candidate checks. Do not restore old globally matching code or recreate its unique index by deleting mapping data.

## Unverified external gates

- Docker is not available and WSL is not installed on this host. Linux standalone/container jobs are prepared but cannot be claimed as executed here.
- GitHub account billing/spending restrictions still block remote workflow verification. No spending limit was changed.
- AWS session refresh has not been approved. Deployed task/image identity, actual secret references, artifact access, GitHub webhook delivery, backup retention/PITR and alert routing remain unverified.
- Synthetic local restore mechanics do not prove seven days of production recoverability or a production restore within four hours.
- Actual Sentry notification delivery, authenticated browser/device evidence, signing and paid AI acceptance remain outside local checks.
- Dependency fixes are isolated in their own lane. This lane's baseline audit must not be represented as the eventual integrated audit, nor do passing consumer regressions clear advisory review.
