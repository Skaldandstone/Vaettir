# Parallel implementation handoff

This is an implementation checkpoint, not a beta-ready release. The integration task owns the readiness register and final combined validation. Forked tasks must use their assigned isolated worktree, not the empty saved project folder or the canonical integration checkout.

## Shared rules

- Preserve the canonical checkout's untracked NEEDS_ATTENTION.md and the older GitHub/Vaettir checkout's edits.
- Implement only the assigned lane. Commit locally and report commit IDs, exact checks, blockers and integration dependencies. Do not push, deploy, merge other lanes, fork additional tasks, or make account/customer changes.
- No spending-limit increases, paid infrastructure, paid build capacity or paid AI calls without approval. AWS reauthentication approval is pending. Do not initiate sign-in until James explicitly approves it.
- Use a separate local database per lane, named vaettir_<lane>_test, and disposable test identities/data. Never run tests or migrations against production or another lane's database.
- The integration owner merges lockfile and shared-file changes after reviewing each lane. Coordinate package changes with the dependency-security lane.
- All gates remain HOLD until demonstrated. Builds do not prove authenticated, visual, physical-device, restore or rollback acceptance.

## Checkpoint evidence and known gaps

Before the checkpoint, typecheck passed across seven tasks, 99 core/API tests passed, and lint passed with 36 existing warnings. Later small fixture/plugin changes need a fresh run. Frozen install, 39 migrations and seeding passed on isolated PostgreSQL 17. Android and iOS Hermes JavaScript exports passed. Web/API production-server compilation passed with VAETTIR_LOCAL_BUILD=1; Windows standalone symlink packaging failed with EPERM. Linux production packaging remains unverified.

Native Android compilation has not passed. Expo 52 export:embed resolves ./index.js from the workspace root despite the Gradle root plugin. Investigate Expo Metro server-root/entry resolution. Custom mobile index.js and direct expo-asset, expo-system-ui and @babel/runtime dependencies fixed earlier bundle failures. No usable signed APK exists. Windows cannot build iOS; signing and physical-device gates remain open.

Dependency audit found 26 production advisories: one critical, 18 high, seven moderate. Review dependency paths and exploitability before selecting coordinated fixes. Do not dismiss build-tool advisories or blanket-merge major upgrades.

Browser discovery lists 71 scenarios excluding paid @ai checks. Authenticated execution is blocked by missing dedicated Clerk development-instance user ID/email/password. Several older scenarios still have weak conditional assertions. The in-app browser could not open the local guide, returning ERR_BLOCKED_BY_CLIENT, so no visual acceptance occurred.

## Ownership

| Lane | Primary ownership | Immediate work |
|---|---|---|
| Beta permissions and limits | API routers/services and their regression tests | Audit all seat writers, ownership transfer, staff revocation, atomic credits, tenant and revoked-credential isolation |
| Mobile delivery | apps/mobile, native assets/scripts, mobile-handoff.md | Fix native compilation; session/offline/role UX; signed Android and iOS handoff prerequisites |
| Dependency security | Package manifests/lockfile and dependency-triage.md | Trace all advisories, apply bounded compatible patches, validate coupled stacks and document remaining blockers |
| Browser and onboarding QA | Web UI, E2E fixtures/specs/config, onboarding.md | Strict isolated tests, failure recovery, onboarding consistency and actual browser evidence when identities are available |
| Operations and release evidence | CI workflows, evidence collector, operations-runbook.md, sanitized telemetry | Reproducible candidate checks, Linux packaging, operational proof preparation and approval-bound live checks |
| Integration | readiness-register.md, final merge and whole-release validation | Reconcile lane commits, shared lockfile changes, candidate manifest and James's go/no-go |

Potential API gaps identified for review: admin ownership transfer may convert a read-only seat without a serialized capacity check; staff API-key revocation may not release the service-account membership consistently; staff last-owner changes need concurrency review. These are audit leads, not confirmed fixed behavior.

Read the readiness register and the lane-specific handoff documents before implementing. The approved cohort remains three teams, five full and two read-only seats per team, 500 non-rolling monthly credits, no automatic overage. Service-account memberships currently consume full seats. Global reference catalogs are staff-managed and require a legacy-content confidentiality audit before admission.
