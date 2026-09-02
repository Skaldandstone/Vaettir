# Dependency integration review

Status: BLOCKED. Integrated locally, not accepted for external beta. Neither a parser fix nor an advisory exception is recorded.

Source lane commit: 5bca48355cb8215534b4c71fd5386329f356390d.
Integration code commit: 35472eb, on codex/private-beta-readiness.
Original review date: 2026-08-30. Safety update: 2026-08-31. Reviewer: integration task, independent of the dependency implementation task.

The complete ten-file commit was cherry-picked together: manifests, workspace overrides, lockfile, both patches, LF policy, tests and handoff. The pre-existing untracked NEEDS_ATTENTION.md remains untouched. Nothing was pushed or deployed.

## Current safety finding and exact evidence attribution

Latest full-suite source: `5a851f188f5693fbcfa7ea6d1cffff59232848ac`. Its [full-suite evidence](stripe-integration-evidence.md) records 267 tests, 41 fresh migrations, broader typecheck/lint/build checks, local API health, native JavaScript exports and populated synthetic recovery. Latest focused-tested source: `f80e0c4fefd1a5321ccd80ee90d75f174c27a3d1`, following `a1eafcdbd09235871a9f9f9ae89d05cd428ae95d`. The full suite and native exports were not repeated at f80e0c4. A later docs-only commit is not a newly tested release.

### Next vendored parser is outside the Metro patch

Actual consumer resolution found `next/dist/compiled/image-size/index.js` inside installed Next 15.5.23. Its SHA-256 is `f824c02fbd558131c8d433c04c245fa3a50f6120024d78485c9b69005e2e654e`. It is not the separately locked/patched Metro image-size 1.2.1 copy. A test asserting every locked consumer is patched does not cover this vendored module.

The [bounded probe log](C:/Users/James/Documents/vaettir-beta-worktrees/integration-validation/.local/compatibility-evidence/f80e0c4fefd1a5321ccd80ee90d75f174c27a3d1/next-vendored-probe.log) records successful module loading, then ICNS and JXL metadata inputs exhausting a 32 MB worker heap. A HEIF input rejected normally and valid ICNS metadata returned dimensions. This is a confirmed local parser failure, not proof of remote production exploitation. Probe-command exit 0 means evidence collection completed; it does not mean the parser passed security validation.

Residual exposure is explicit:

- Final `apps/web/.next/next-server.js.nft.json` still includes the bundled parser and its package metadata. The [focused manifest](C:/Users/James/Documents/vaettir-beta-worktrees/integration-validation/.local/compatibility-evidence/f80e0c4fefd1a5321ccd80ee90d75f174c27a3d1/manifest.json) records those paths. This is Windows local-server trace evidence, not Linux standalone/container or deployed inspection.
- Next's metadata-image loader still calls image sizing on trusted repository metadata assets. Disabling static-image imports does not remove that separate build path. Do not process untrusted image assets on build machines or automatically build untrusted repositories with credentials.
- API's single-stage Dockerfile installs the full workspace, including web/mobile tooling, into its runtime stage. Source inspection found no direct application image-size import, but that is not proof the parser is absent from the image. Target pruning, container reachability and deployed exposure remain unverified.
- Keep Metro private. Actual Metro buffer and file asset APIs dispatch based on bytes despite a `.png` filename. New consumer tests prove the pinned patch rejects the malformed ICNS/JXL/HEIF fixtures on both paths and retains supported dimensions. Both patch hashes and the lockfile are unchanged.

### Local entry-point mitigation, not a parser fix

The current web source does not use next/image or static raster imports. `images.unoptimized=true` and `disableStaticImages=true` disable those unused entry points. The initial a1eafcd HTTP check returned 500 when Next's 404 rendered a Clerk-dependent layout without middleware context; its [failed manifest](C:/Users/James/Documents/vaettir-beta-worktrees/integration-validation/.local/compatibility-evidence/a1eafcdbd09235871a9f9f9ae89d05cd428ae95d/manifest.json) and [server log](C:/Users/James/Documents/vaettir-beta-worktrees/integration-validation/.local/compatibility-evidence/a1eafcdbd09235871a9f9f9ae89d05cd428ae95d/web-server.log) are retained. The f80e0c4 narrow early response returns an empty, no-store 404 for `/_next/image`, without reading the supplied image URL. Other Clerk public/protected handling remains unchanged.

Exact f80e0c4 validation: 27 focused tests passed (11 dependency, 7 compatibility/middleware, 9 operations/health), focused script/middleware lint and web/e2e typecheck passed, and five forced production-server build tasks passed in 61.597 seconds (66.215 seconds command wall time). Environment was Windows Node 24.19.0; no install or database startup occurred. Three actual loopback optimizer requests returned empty 404/no-store; `/icon.svg` returned 200 with SVG content. Apple-icon 180x180 and Open Graph 1200x630 prerendered PNG signatures/dimensions were checked, not visual or public-navigation acceptance. [Artifact verification](C:/Users/James/Documents/vaettir-beta-worktrees/integration-validation/.local/compatibility-evidence/f80e0c4fefd1a5321ccd80ee90d75f174c27a3d1/artifact-verification.json) records matching command/server/config hashes and generated metadata checks. The owned local server was stopped.

The [f80e0c4 production audit](C:/Users/James/Documents/vaettir-beta-worktrees/integration-validation/.local/compatibility-evidence/f80e0c4fefd1a5321ccd80ee90d75f174c27a3d1/audit-production.log) exits 1 with two high findings and zero critical/moderate/low findings. No findings were suppressed, no version bump was claimed to fix the parser, and no exception or release approval was granted. An independent review of the vendored copy, hostile build inputs and eventual supported fix is still required.

### Runtime and CI holds

Local declarations now use Node >=22.13 and six pinned setup-node v7 references (`820762786026740c76f36085b0efc47a31fe5020`), with CI app Node range >=22.13 <23 and pnpm installed before explicit cache restoration. **ci.yml was and remains push-to-master/pull_request triggered. It was not manual-only; no manual-execution guard was added.** Release-validation and deploy remain workflow_dispatch-only, retaining their existing optional-cost and production holds. No push, PR mutation, dispatch or deployment occurred.

Linux Node 22 >=22.13, hosted setup-node v7 on a compatible runner, standalone/container builds, exact-candidate native compilation/signing and physical-device acceptance remain UNVERIFIED. Docker is absent and WSL was reported not installed at the local checkpoint. These gaps were not replaced by Windows Node 24 checks. All security and release holds remain in force.

## Historical technical review of the pinned Metro patch

The [original vulnerability report](https://joshua.hu/image-size-infinite-loop-dos-vulnerabilities) describes parser loops that can fail to advance when a recognized entry has a zero length. I inspected the pinned image-size 1.2.1 patch and the affected installed implementations. The ICNS guard requires a complete header and a minimum eight-byte entry. The shared JXL/HEIF box guard requires a complete header and a minimum eight-byte box before returning it to callers. These guards address the reported non-advancing paths, including callers outside the shared search loop.

This is a focused mitigation review, not a general parser security certification or full image-decoder validation. Synthetic positive fixtures exercise supported metadata paths; they do not prove every valid codec/container variant. Existing unsupported zero-to-end and extended-size boxes are not newly supported. Audit entries remain visible: [ICNS advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and [JXL/HEIF advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), both listing no upstream patched release when reviewed.

The Expo CLI compatibility patch adapts both tar consumers and must accompany the tar 7 overrides. Consumer tests exercise real archive extraction functions, including npm-template extraction, rather than only importing tar. The test suite verifies patch SHA-256 values against the lockfile and resolves the actual consuming packages. The LF rule is limited to patches/*.patch.

## Historical targeted integration evidence at 35472eb

Working directory: C:/Users/James/Documents/Vaettir.
Logs: .local/readiness/dependencies-35472eb/.

| Check                                          | Result                                                                               | Log                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------- |
| pnpm install --frozen-lockfile                 | Passed                                                                               | install.log           |
| pnpm test:dependencies                         | Ten passed, including integrity, supported metadata and 53 bounded malformed vectors | consumer-tests.log    |
| API vitest xmlDependency.test.ts, maxWorkers 2 | Six passed                                                                           | xml-tests.log         |
| pnpm typecheck                                 | Seven tasks passed, zero cache hits                                                  | typecheck.log         |
| pnpm audit --prod --json                       | Exit 1: two high, zero critical/moderate/low                                         | audit-production.json |

These are targeted checks on the integration code commit, not a complete release-candidate manifest. The dependency lane's broader local builds/test logs are separately documented in [dependency triage](dependency-triage.md); they are not silently promoted to combined-candidate evidence.

## Remaining gates and integration requirements

### Current working-tree security recheck

The hosted-sandbox continuation did not change dependency manifests, the lockfile, installed modules or either pinned patch. `pnpm test:dependencies` passed all 18 current consumer/configuration tests, including patch hashes, actual Metro buffer/file entry points, Next optimizer disablement and CI-trigger holds. `pnpm audit --prod --json` still exits 1 with exactly GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq at high severity, with zero critical/moderate/low findings. The isolated scratch parser candidate was not installed or adopted, and these results do not waive either advisory. The Next vendored parser, build trace, Linux/container and native gates below remain open.

- The permissions schema/mobile reconciliation and full candidate validation are recorded at 5a851f1. Later f80e0c4 has only the focused evidence above; repeat the appropriate exact-candidate checks before release, not by reassigning historical results.
- Resolve the separate Next vendored-parser finding and residual metadata/server-image exposure through independent security review and a supported fix. Keep both advisories visible; entry-point mitigation is not parser acceptance.
- COPY patches/ into Docker build contexts before frozen installation. Install Linux sharp binaries in the target environment, not from Windows artifacts. Linux standalone/container packaging remains unverified.
- Re-run native compilation/signing/device checks with the full dependency set. JavaScript exports are not device acceptance.
- Keep Metro private and do not automatically build untrusted repositories or dependency assets with credentials. Deployment/build exposure controls still need verification.
- Keep both high advisories visible with these mitigation notes. This review does not grant external-beta go/no-go or approve a blanket advisory exception.
- Roll back only to a reviewed security-compatible artifact. Restoring the prior dependency artifact restores the original critical exposure.
