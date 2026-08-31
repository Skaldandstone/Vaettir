# Operations lane evidence

Status: implementation under local validation, not beta acceptance. Integration owns the readiness register. No AWS sign-in, cloud/account changes, production mutations, paid infrastructure, paid builds or AI calls have been performed.

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

The executable candidate manifest is under .local/readiness/<commit>-<timestamp>/manifest.json. Restore manifests are under .local/restore-evidence/<timestamp>/manifest.json. Final command outcomes and exact paths will be recorded after validation.

## Unverified external gates

- Docker is not available and WSL is not installed on this host. Linux standalone/container jobs are prepared but cannot be claimed as executed here.
- GitHub account billing/spending restrictions still block remote workflow verification. No spending limit was changed.
- AWS session refresh has not been approved. Deployed task/image identity, actual secret references, artifact access, GitHub webhook delivery, backup retention/PITR and alert routing remain unverified.
- Synthetic local restore mechanics do not prove seven days of production recoverability or a production restore within four hours.
- Actual Sentry notification delivery, authenticated browser/device evidence, signing and paid AI acceptance remain outside local checks.
- Dependency fixes are isolated in their own lane. This lane's baseline audit must not be represented as the eventual integrated audit, nor do passing consumer regressions clear advisory review.
