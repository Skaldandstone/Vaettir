# Dependency integration review

Status: integrated locally, not accepted for external beta.

Source lane commit: 5bca48355cb8215534b4c71fd5386329f356390d.
Integration code commit: 35472eb, on codex/private-beta-readiness.
Review date: 2026-08-30. Reviewer: integration task, independent of the dependency implementation task.

The complete ten-file commit was cherry-picked together: manifests, workspace overrides, lockfile, both patches, LF policy, tests and handoff. The pre-existing untracked NEEDS_ATTENTION.md remains untouched. Nothing was pushed or deployed.

## Technical review

The [original vulnerability report](https://joshua.hu/image-size-infinite-loop-dos-vulnerabilities) describes parser loops that can fail to advance when a recognized entry has a zero length. I inspected the pinned image-size 1.2.1 patch and the affected installed implementations. The ICNS guard requires a complete header and a minimum eight-byte entry. The shared JXL/HEIF box guard requires a complete header and a minimum eight-byte box before returning it to callers. These guards address the reported non-advancing paths, including callers outside the shared search loop.

This is a focused mitigation review, not a general parser security certification or full image-decoder validation. Synthetic positive fixtures exercise supported metadata paths; they do not prove every valid codec/container variant. Existing unsupported zero-to-end and extended-size boxes are not newly supported. Audit entries remain visible: [ICNS advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and [JXL/HEIF advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), both listing no upstream patched release when reviewed.

The Expo CLI compatibility patch adapts both tar consumers and must accompany the tar 7 overrides. Consumer tests exercise real archive extraction functions, including npm-template extraction, rather than only importing tar. The test suite verifies patch SHA-256 values against the lockfile and resolves the actual consuming packages. The LF rule is limited to patches/*.patch.

## Fresh integration evidence

Working directory: C:/Users/James/Documents/Vaettir.
Logs: .local/readiness/dependencies-35472eb/.

| Check | Result | Log |
|---|---|---|
| pnpm install --frozen-lockfile | Passed | install.log |
| pnpm test:dependencies | Ten passed, including integrity, supported metadata and 53 bounded malformed vectors | consumer-tests.log |
| API vitest xmlDependency.test.ts, maxWorkers 2 | Six passed | xml-tests.log |
| pnpm typecheck | Seven tasks passed, zero cache hits | typecheck.log |
| pnpm audit --prod --json | Exit 1: two high, zero critical/moderate/low | audit-production.json |

These are targeted checks on the integration code commit, not a complete release-candidate manifest. The dependency lane's broader local builds/test logs are separately documented in [dependency triage](dependency-triage.md); they are not silently promoted to combined-candidate evidence.

## Remaining gates and integration requirements

- Reconcile the permissions schema migration and mobile changes, then regenerate Prisma and repeat full candidate validation.
- COPY patches/ into Docker build contexts before frozen installation. Install Linux sharp binaries in the target environment, not from Windows artifacts. Linux standalone/container packaging remains unverified.
- Re-run native compilation/signing/device checks with the full dependency set. JavaScript exports are not device acceptance.
- Keep Metro private and do not automatically build untrusted repositories or dependency assets with credentials. Deployment/build exposure controls still need verification.
- Keep both high advisories visible with these mitigation notes. This review does not grant external-beta go/no-go or approve a blanket advisory exception.
- Roll back only to a reviewed security-compatible artifact. Restoring the prior dependency artifact restores the original critical exposure.
