# Dependency PR triage

Read-only GitHub inspection on 2026-08-30 returned ten open PRs, not the eleven in the earlier assessment. Each PR's non-lockfile diff was inspected individually. No PR was merged, updated or closed. This dependency lane is based on checkpoint a6b5554ddd53cb0e3326264557c0931a00336f6f; it is not the combined release candidate.

## Current integration safety checkpoint, August 31

**BLOCKED.** The historical lane results below do not establish current release acceptance. Latest full-suite source is `5a851f188f5693fbcfa7ea6d1cffff59232848ac` (267 tests, 41 fresh migrations and broader local checks in [full-suite evidence](stripe-integration-evidence.md)). Latest focused-tested source is `f80e0c4fefd1a5321ccd80ee90d75f174c27a3d1` (27 focused tests, build/typecheck/lint and loopback HTTP only). Do not reattribute the full suite or native exports to f80e0c4 or a subsequent docs-only commit.

The [updated integration review](dependency-integration-review.md) links the exact manifest, probe and audit logs. Actual Metro buffer/file consumers reject malformed ICNS/JXL/HEIF bytes even with `.png` filenames under the unchanged patch. **Next 15.5.23 also vendors image-size outside that patched dependency.** Its ICNS and JXL probes exhaust a bounded 32 MB worker heap; a HEIF probe rejects normally. The bundled parser remains in the final web server trace and trusted metadata build path. API's single-stage Dockerfile also installs the full web/mobile workspace into its runtime stage; no Linux container was executed to validate deployed exposure.

At f80e0c4, unused web optimizer/static-image imports are disabled, with an early empty/no-store 404 on the optimizer path. This closes those unused entry points locally, not the parser defect. First-attempt HTTP 500 evidence is retained alongside the successful follow-up. Both high advisories remain visible, with production audit exit 1, no suppression and no security exception. Independent vendored-parser/build-input review and a supported fix remain open.

Root Node floor is now >=22.13; setup-node v7 is pinned, while CI application runtime remains Node 22. **ci.yml still has push-to-master and pull_request triggers, not manual-only execution.** Release-validation/deploy remain manual with existing holds; no workflow was dispatched. Linux/standalone/container, Node 22 runtime, hosted-v7 execution and exact-candidate native/signing/device gates remain UNVERIFIED. Focused local validation used Windows Node 24.19.0. No dependency-version/patch/lockfile change or install accompanied that focused pass.

## Historical individual PR review

| PR | Change | Disposition and required proof |
|---|---|---|
| [12](https://github.com/Skaldandstone/Vaettir/pull/12) | @fastify/cors 10 -> 11 | Hold major upgrade; review Fastify compatibility and credentialed/browser preflight tests |
| [11](https://github.com/Skaldandstone/Vaettir/pull/11) | @clerk/nextjs 6 -> 7 | Hold for coordinated auth migration; sign-in/MFA/invite/session and middleware matrix |
| [10](https://github.com/Skaldandstone/Vaettir/pull/10) | Prisma CLI 5 -> 7 | Pair with client PR 7 at exactly matching versions; schema/config/adapter/migrate/restore testing |
| [9](https://github.com/Skaldandstone/Vaettir/pull/9) | @clerk/backend 1 -> 3 | Review together with auth stack and verification/error semantics; no isolated major merge |
| [8](https://github.com/Skaldandstone/Vaettir/pull/8) | expo-status-bar 2 -> 57 | Do not merge into Expo 52; upgrade Expo/RN/React/native modules as one stack with device acceptance |
| [7](https://github.com/Skaldandstone/Vaettir/pull/7) | Prisma client 5 -> 7 | Coupled to PR 10; current proposed versions differ and cannot be accepted independently |
| [6](https://github.com/Skaldandstone/Vaettir/pull/6) | minimatch 9 -> 10 | Test repo scanning, path policy, Windows separators, glob semantics and Node engine |
| [5](https://github.com/Skaldandstone/Vaettir/pull/5) | fast-xml-parser 4.5.7 -> 5.11.0 | Equivalent version implemented locally as exact 5.11.0, not the PR's caret range. Six XML regressions and full API tests pass. Parent may reconcile/close the PR only after integration; no PR action taken here |
| [2](https://github.com/Skaldandstone/Vaettir/pull/2) | actions/checkout 4 -> 7 | Runner/Node/action policy review; verify in a separate CI run after billing resolution |
| [1](https://github.com/Skaldandstone/Vaettir/pull/1) | Docker Node 22 -> 25 | Keep the current coordinated Node 22 CI/container baseline for beta; reconsider as a separate runtime upgrade |

The remaining nine major/runtime PRs stay deferred individually for the proof in the table. None fixes the two remaining image-size advisories merely by being merged. Prisma CLI/client remain 5.22.0, Expo remains 52.0.49, React Native remains 0.76.9 and React remains 18.3.1. Mobile's package manifest and the Docker/CI runtime versions were not changed by this lane.

## Historical dependency-lane audit and release blocker

Baseline: 26 advisories, one critical, 18 high and seven moderate. After the changes below, both `pnpm audit --prod --json` and `pnpm audit --json` report **two high, zero critical, zero moderate** and exit 1. Both remaining findings are image-size 1.2.1. No ignored-advisory list, severity filtering, false patched version or automated acceptance was added. **Dependency gate remains BLOCKED pending independent review and combined-candidate validation.**

| Package and baseline findings | Actual installed path / exposure | Change and validation |
|---|---|---|
| tar 6.2.1, 12 | mobile -> expo -> @expo/cli 0.22.28 -> tar, and CLI -> cacache 18.0.4 -> tar. Template/cache/archive extraction is a build-machine boundary, including Windows JS extraction | Parent-specific 7.5.21 overrides plus the mandatory Expo CLI compatibility patch below. Both real Expo archive and npm-template extraction functions pass, including streamed extraction and SHA-256 checksum |
| @xmldom/xmldom 0.7.13, 5 | mobile -> expo -> CLI/config-plugins -> @expo/plist 0.2.2 -> xmldom. Native plist/config XML processing | Override only plist 0.2.2's dependency to 0.8.15. Actual plist build/parse round trip preserves nested values, booleans, arrays and XML escaping. Separate unaffected xmldom 0.9.12 remains unchanged |
| postcss 8.4.31 / 8.4.49, 4 | web -> Next 15.5.23 -> PostCSS; mobile -> Expo -> @expo/metro-config 0.19.12 -> PostCSS. CSS processing/source-map loading occurs in builds | Override these two consumers to 8.5.26. Consumer resolution and CSS output assertions pass; web production-server build and both native JS exports pass |
| sharp 0.34.5, 1 | web -> Next 15.5.23 -> sharp. Next image optimization plus the local mobile-asset generator. Lack of current next/image imports does not prove the optimization endpoint is disabled | Next-specific override to 0.35.4. Native PNG decode/rotation/resize and PNG/JPEG/WebP/AVIF encode/decode pass on Windows x64. Linux image binary/container verification is still required |
| fast-xml-parser 4.5.7, 1 | API direct dependency. JUnit, Cobertura and JaCoCo use XMLParser, not the affected XMLBuilder path | Exact 5.11.0 direct dependency. Upstream v5 retained the parser API. Six regressions cover attributes, CDATA, statuses, coverage, JaCoCo DOCTYPE, external-entity rejection and explicit validation/entity limits |
| uuid 7.0.3 / 8.3.2, 1 | Expo CLI -> @expo/bunyan, @expo/rudder-sdk-node, jayson; Expo config-plugins -> xcode. Inspected consumers use v1 or v4, not affected supplied-buffer v3/v5/v6 calls | Four parent-specific overrides to CommonJS-capable 11.1.1. Actual consuming packages resolve it; v1/v4 validation and xcode project-ID generation pass. Existing uuid 14.0.2 is unchanged |
| image-size 1.2.1, 2 | mobile -> React Native 0.76.9 -> @react-native/community-cli-plugin -> Metro 0.81.5 -> image-size. Expo/Clerk peer paths converge on that Metro copy | No upstream fixed release. Pinned local bounds patch plus 53 bounded malformed vectors and supported-format dimension tests. Findings remain visible and unaccepted |

## Mandatory package patches

Both files are committed, selected under `patchedDependencies` in pnpm-workspace.yaml, and content-addressed in pnpm-lock.yaml. `.gitattributes` forces LF endings to preserve their bytes across Windows/Linux. `pnpm test:dependencies` recomputes each SHA-256 and verifies the lockfile entry, as well as exercising the actual installed consumers.

- [Expo CLI 0.22.28 patch](../../patches/@expo__cli@0.22.28.patch), SHA-256 `697615116a825c9b1dba6f6c4054b7660ee92b1554a213363ea4c104f0a6caf2`. Tar 7 has named CommonJS exports and no default export, while Expo's generated `_interopRequireDefault` wrapper assumes one. Two tar-loading wrappers in `utils/tar.js` and `utils/npm.js` are adapted. An initial consumer test failed without this patch. **Never integrate the tar override without this build/runtime compatibility patch.** No Expo runtime or native-module version changed. See the [tar 7 migration changes](https://github.com/isaacs/node-tar/blob/main/CHANGELOG.md).
- [image-size 1.2.1 patch](../../patches/image-size@1.2.1.patch), SHA-256 `f8e038ee5a4cecc5b4bbd34e610bfa7687291875927a37b4296b409ba2d3d871`. ICNS entry headers must be present and entry lengths must be at least eight. Shared JXL/HEIF box parsing rejects incomplete headers and sizes below eight before returning a matching box. This closes non-advancing caller loops, not just the helper's own loop. Size-zero/to-end and extended-size boxes are not newly supported; this is a focused fail-closed patch, not a codec rewrite. Review the exact diff before accepting it.

Remaining advisory IDs: [GHSA-w3rx-r6r6-pgpr / CVE-2025-71330](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and [GHSA-5p2g-fcmc-qvqq / CVE-2025-71329](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq). Both upstream records list affected versions through 2.0.2 with no patched release. Upgrading image-size to 2.0.2 would not resolve this gate.

Metro normally handles repository image assets, not Vaettir customer attachments. However, it detects image type from bytes after accepting a supported extension, so a renamed hostile image or untrusted dependency/repository asset remains relevant. Do not expose Metro to external teams, automatically build untrusted repositories with credentials, or treat the native application's lack of a Node parser as a build-machine exemption.

Regression coverage: all lengths 0-7 for each vulnerable family; truncated headers; declared JXL/HEIF sizes exceeding remaining bytes; repeated and partial JXL boxes; nested HEIF boxes. The 53 cases execute in a separate worker with a two-second deadline and bounded heap. Positive synthetic metadata fixtures preserve multi-entry ICNS, single and multipart JXL (24x16), HEIF ispe (37x19), and PNG dimensions. These are parser-path fixtures, not full codec/render acceptance. A separate assertion confirms every locked image-size consumer selects the pinned patch and checks the active Metro copy's guards.

Other source references: [sharp/libvips advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [sharp 0.35 changes](https://sharp.pixelplumbing.com/changelog/v0.35.0/), [fast-xml-parser changelog](https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/CHANGELOG.md). No advisory is claimed universally exploitable or safe solely from its dependency label.

## Historical dependency-lane validation evidence

Working directory: `C:/Users/James/Documents/vaettir-beta-worktrees/dependencies`. Local logs are under `.local/dependency-evidence/`; native exports are under `apps/mobile/.expo/dependency-export/`. Environment: Windows x64, Node 24.19.0, pnpm 11.23.0, PostgreSQL 17. CI's Node 22/Linux combination is not verified by these local results.

| Exact command / configuration | Result | Log |
|---|---|---|
| `pnpm install --frozen-lockfile` | Pass | install-frozen.log |
| `pnpm db:generate`; `pnpm --filter @vaettir/db exec prisma migrate deploy`; `pnpm --filter @vaettir/db run seed` | Prisma 5.22.0; 39 migrations and reference seed pass on isolated vaettir_dependencies_test | migrations.log, seed.log |
| `pnpm typecheck` | Seven tasks pass | typecheck.log |
| `pnpm lint` | Six tasks pass, 36 existing web warnings | lint.log |
| `pnpm exec eslint scripts/dependency-security.test.mjs apps/api/src/services/xmlDependency.test.ts` | Pass | Terminal result |
| `pnpm test:dependencies` | Ten tests pass, including patch integrity | consumer-tests.log |
| `pnpm --filter @vaettir/api exec vitest run src/services/xmlDependency.test.ts` | Six tests pass | Terminal result; included again in full API suite |
| `pnpm exec turbo run test --force` | Core 35 pass; unrestricted API run failed with connection/time limits | tests.log, postgres.log |
| `pnpm --filter @vaettir/api exec vitest run --maxWorkers 2` with local DATABASE_URL ending `&connection_limit=5` | All 70 API tests pass, no skipped tests | api-tests-bounded.log |
| `pnpm exec turbo run build --force` with `VAETTIR_LOCAL_BUILD=1`, compile-only Clerk key, localhost API | All five tasks pass; Windows production-server build, not Linux standalone image | build.log |
| In apps/mobile: `pnpm exec expo install --check`; `pnpm exec expo export --platform all --output-dir .expo/dependency-export --max-workers 2` | Compatibility check and Android/iOS Hermes exports pass | Export metadata and .hbc files; terminal result |
| `pnpm audit --prod --json`; `pnpm audit --json` | Both exit 1, two high image-size findings | audit-production.json, audit-all.json |
| `pnpm peers check` | Existing eslint 10-config/9-engine and optional ws/utf-8-validate peer mismatches remain visible | peers.log |

The isolated database was created only for this lane. No production migrations, model calls, credentials/sign-in changes, deploys, account changes or PR mutations occurred. The initial failed unrestricted test run is retained, not relabeled a pass.

## Integration, deployment and rollback requirements

The original lane integration sequence below is historical guidance, not authorization to reinstall or rerun checks during the docs-only update. The combined 5a851f1 checkpoint already includes the permissions/mobile/schema integration. New focused f80e0c4 evidence and residual Next exposure are recorded above; target/release gates remain open.

1. Integrate the manifest changes, pnpm-workspace.yaml, both patch files and `.gitattributes` together. Merge mobile manifest additions first, then run `pnpm install --no-frozen-lockfile` once on the combined candidate. Do not replace this lockfile with an older mobile lockfile or drop patch hashes. Re-run the frozen install and consumer suite afterward.
2. Docker build contexts must copy `patches/` and pnpm-workspace.yaml before frozen installation. Linux sharp binaries must be installed for the target image, never copied from Windows. Operations owns Dockerfile edits and Linux evidence. No Node major upgrade is required by these fixes.
3. Regenerate Prisma after integrating the separately owned tenant-source schema migration, then re-run migrations, full tests, typecheck and builds on that one candidate. This lane does not own or pre-validate that new schema.
4. Mobile must regenerate/build native projects with the combined patch set and verify signed Android/iOS deliverables. JavaScript exports and synthetic plist tests do not prove native compilation, signing, device behavior or iOS acceptance.
5. Treat version-scoped overrides as temporary, reviewed compatibility constraints. On a parent upgrade, deliberately re-evaluate each selector and both pinned patches; stale selectors must not silently restore vulnerable transitive versions. Run fresh audit and consumer tests.
6. There are no DB schema changes in this lane. Roll back code and its complete dependency/patch set as one immutable artifact. Rolling back to the pre-hardening dependency artifact restores the original findings, including critical tar exposure, and is not automatically a safe beta rollback target. Keep external admission closed pending review.
