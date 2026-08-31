# Parallel implementation handoff

This is an implementation checkpoint, not a beta-ready release. The integration task owns the readiness register and final combined validation. Forked tasks must use their assigned isolated worktree, not the empty saved project folder or the canonical integration checkout.

Checkpoint for all five worktrees: a6b5554ddd53cb0e3326264557c0931a00336f6f. Worktree root: C:/Users/James/Documents/vaettir-beta-worktrees. These are local branches; nothing has been pushed or deployed.

| Task title | Task ID | Worktree / branch |
|---|---|---|
| Beta: integration and readiness | 01a0548c-0995-7c21-9634-fff5931643ac | C:/Users/James/Documents/Vaettir / codex/private-beta-readiness |
| Beta: permissions and limits | 01a054fa-c9b9-78f3-80e2-9241673a60ae | permissions / codex/beta-permissions |
| Beta: mobile delivery | 01a054fb-164c-73c3-972e-44ae1c1cee06 | mobile / codex/beta-mobile |
| Beta: dependency security | 01a05504-36ed-7a83-8493-9c9d7f754fd5 | dependencies / codex/beta-dependencies |
| Beta: browser and onboarding QA | 01a05509-a997-78f1-aaec-d2d43fa1666d | browser / codex/beta-browser |
| Beta: operations and release evidence | 01a0550b-a91f-77c0-b21b-b49b7dd72518 | operations / codex/beta-operations |

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

Operations additionally owns server.ts changes limited to sanitized logging and release identity in health responses, web instrumentation, Dockerfiles/.dockerignore and turbo release-tag environment declarations. API authentication/authorization semantics remain with permissions; dependency versions and package manifests/lockfile remain with dependency security. Local restore-mechanics evidence does not close the production retention or recovery-time gates. Docker/WSL are unavailable locally and AWS reauthentication remains unapproved.

## Integrated handoffs

All five source lanes are now integrated locally. The original checkpoint findings above are historical, not current validation results. Exact combined validation belongs to the readiness register and candidate manifests, not the individual lane reports.

| Lane | Source commits | Integration commits |
|---|---|---|
| Dependency security | 5bca483 | 35472eb |
| Operations | 763b6f0, 3798c78, cb1776a, b1ba6b5; credit-scheduler correction 28c8d7f | af488b2, 458d0a8, 3114d3c, 9907fcb; aa59f6c |
| Permissions | bd217aa, 26c8959 | fc516a8, 350d7a8 |
| Mobile | 25046d8, c62c925, 799e05c | 9173809, 9774876, 348ed20 |
| Browser/onboarding | c4bcf1e | 40b947d |

The mobile lane's dependency cherry-pick 74757f6 was intentionally not replayed because the same source patch was already integrated. Follow-up integration e9607e3 supplies mobile release identity and includes the credential-free web permission/fixture contracts in automated checks. No lane should edit the canonical checkout or readiness register. Source branches and local evidence remain available for review.

The combined dependency/operations/permissions snapshot 350d7a8 independently passed 108 API and 37 core tests, fresh 40 migrations, actual mapping-preservation SQL, typecheck, lint and production-server build. The newer full candidate e9607e3 then independently passed 216 tests across all seven test groups, 40 fresh migrations and preservation SQL, typecheck, lint, production-server builds, local API health and both mobile JavaScript exports. Both audits remained blocked on two visible high image-size advisories. See [combined evidence](integration-evidence.md) for exact manifests and remaining gates; lane artifacts are not silently promoted to final-candidate evidence.

Read the readiness register and the lane-specific handoff documents before implementing. The approved cohort remains three teams, five full and two read-only seats per team, 500 non-rolling monthly credits, no automatic overage. Service-account memberships currently consume full seats. Global reference catalogs are staff-managed and require a legacy-content confidentiality audit before admission.
