# Production native successor v1: source handback

This package is source for Main's independent review. It is not a release or an
authorization to execute an operator. The source lane has run synthetic contracts
and static checks only. No Docker, native executable, database, build, scan,
deployment, hosted UI or customer operation has been run by this lane.

Main owns each execution and its receipts. Preserve every original failure and
all frozen October 30 and November 2 bbd packages. Do not edit accepted package
bytes in place or run a frozen bbd entrypoint with substituted pins. The old
110-migration/no-SQL/native-unchanged/723-member assumptions do not describe this
successor. A correction after acceptance requires a newly named successor.

## Exact inputs and deliberate holds

Complete baseline filesystem inventory JSON has an explicit 256 MiB ceiling in
both admission and context preparation. The pinned API71 inventory is
112,986,232 bytes. Configs, native inventories and other JSON retain the 64 MiB
default. Every read still requires its exact byte count and SHA-256; the larger
inventory ceiling does not waive either check. Synthetic reader tests cover the
API-sized input, both preparation reads, the ceiling and size/hash refusals.

`policy.json` pins the application ancestor 1d7e1018, SQLite ancestor 2b721d3d,
the accepted API71/Web79 parent images, parent configs and complete filesystem/
native inventories, all 110 old migrations and the 111 candidate migrations.
Its 77 source-change rows describe both ancestor cohorts with exact original
blob-content hashes. These are comparison inputs, not a resolution of overlapping
files: Main's final source ledger must enumerate the complete 62c-to-final diff.
The final source must contain both ancestors through a reviewed normal merge.

The standalone SQLite receipt is pinned to
`8dac2cb6c66f28d3822554378c6c9406b86089ac124a742b6d575c0b9f546147`.
Its original build is `vaettir-api-build:e01d0c21-314b-4864-bb45-dc75bd91b29d`.
The exact image, library, package, probe, manifest, three checker/source files,
seven original supporting receipts/logs and every original native proof log are
bound in the template/policy. Empty native log files are legitimate hash-bound
members. This source gate rehashes those retained files; it does not claim to have
repeated Main's original full OCI extraction or 7,304 native checks.

The template intentionally has null final commit/tree, main CI, privacy/merge,
operator source acceptance, baseline full-content proof-tree admission, schema111
recovery, and transaction-review references. A known source commit or a green PR
run does not replace final main CI. Pending or failed candidate CI is not admissible.

The NSS acquisition pins describe official Debian HTTPS index/package hash
matching. **InRelease signature verification is not claimed.** API71 has package
`2:3.110-1+deb13u4` and the pinned libnss3/softokn bytes; Web79's retained package
and native inventories contain neither. The standalone builder's u5 NSS test is
not an API71 runtime test. The acquired matching certutil is external test input,
not a package to install or ship. Its new fixture and separate source acceptance
remain null. The earlier baseline script is not silently promoted to the new
loader-evidence contract. No Windows host bind or sharing-policy change is used.

## Gate A: offline context preparation

Main stages the referenced evidence as regular files under one explicit evidence
root (the populated template paths are relative to INT). Symlinked evidence,
traversal, missing pins, size/hash mismatches and changed source are refused.
No cloud, credential lookup, Docker or application process is used by this gate.

Before invoking it, Main independently reviews every package member, creates a
manifest `{files:[{path,sha256,bytes}]}` using **all immediate package files in
sorted order**, and stores that manifest outside this directory. An acceptance
receipt must bind its hash, the final application commit, `accepted:true` and
`kind:"source-only-successor"`. The manifest must include this document, policy,
template, every executable module and the tests; it must not include itself.
Do not copy an acceptance bit from another source package.

Populate the remaining references according to `contracts.mjs`:

- Normal merge receipt: the actual merge node's `commit`, `tree`, two actual
  `parents` and `normalMerge`. It must be an ancestor of the final CI head; later
  reviewed CI/test fixes may be single-parent commits. The final head/tree are
  bound independently, and must contain both exact application/SQLite ancestors.
- Complete source ledger: `files` is `gitSource(...).changes(62c, final)`;
  each row has `path`, `before` and `after`, with null for absence and otherwise
  `mode`, Git `blob`, content `sha256`, and `bytes`. Privacy acceptance binds the
  exact ledger hash, commit and tree. Review raw history separately; never include
  transcripts, private exports, credentials or task-history files in Git.
- Main CI receipt binds the exact checkout/tree/run and raw complete log. API,
  Web, browser, database, privacy and Android gates must each be PASS.
- Each parent full OCI acceptance binds the exact parent digest and a complete
  retained proof tree of `{files:[{path,sha256,bytes}]}`. All referenced bytes are
  rehashed. Admission is not a substitute for the independently accepted actual
  compressed layers, config, DiffIDs, TAR/whiteout processing and merged contents.
- Migration recovery plan binds immutable API/Web recovery digests and an actual
  schema111 database compatibility proof tree, tenant writes and revoked-authority
  refusal. No destructive down migration or API67/68/69 fallback is allowed.

From a reviewed checkout, Main may run:

```text
node scripts/production-native-successor-v1/overlay-context.mjs BINDINGS.json EVIDENCE_ROOT SOURCE_REPO api NEW_CONTEXT
node scripts/production-native-successor-v1/overlay-context.mjs BINDINGS.json EVIDENCE_ROOT SOURCE_REPO web DIFFERENT_NEW_CONTEXT
```

`prepareContext` verifies all admissions and prepares all bytes before creating
anything. The writer creates a new directory exclusively, records an intent,
writes members exclusively, then writes the final context manifest. Existing or
partially written output is never overwritten, removed or automatically retried.
Main must hash-check this context and the exact transaction-input bytes again
before a build. Null/unaccepted inputs produce no context.

API71 has no explicit USER: its recipe emits no USER instruction. Web79 elevates
to root for the genuine package transaction and restores `nextjs` exactly.
Parent environment, entrypoint, command and working directory remain inherited.
The exported final target is **scratch evidence_only**, never a runtime image.

## Gate B: disposable actual transaction, Main only

The generated recipe uses the exact immutable parent FROM. It copies only the
enumerated collector, package, checker/manifest/probe and input files into the
previously absent `/tmp/vaettir-sqlite-overlay-v1`. It does not copy the standalone
builder filesystem, NSS libraries, package database or package-manager binaries.
The probe has its own exact `COPY --chmod=0555`; it is excluded from the generic
COPY. Thus host context files may remain 0600 without making the probe unusable.
The collector verifies mode 0555 before observation and does not repair it with
chmod. No other runtime payload receives executable permission through this rule.

Main executes the reviewed context on its approved isolated Linux daemon/build
system. Network is disabled for every RUN. Record the context digest, exact
command/stdin/timeout, builder/daemon/image identities, resource limits and all
logs. Do not increase API compute by adding an override to inherited SMALL.
No daemon/image/build operation is performed by this source lane.

The collector verifies staged bytes, snapshots the parent, and compares every
retained parent path/content/type/mode/link. It checks the exact retained dpkg,
dpkg-query, dpkg-deb, ldconfig and Node bytes before invoking any native tool.
It checks package audit, updates and pending triggers, records genuine package
info/contents, then runs exactly one `dpkg --install sqlite.deb`. The accepted
checker runs both `--installed` and `--consumers api|web`. There is no apt, helper
login, dependency removal, package metadata fabrication, repair or retry.

Before/after filesystem observations include every regular file, directory,
symlink, hardlink group, hash, size, mode, uid and gid. They are bounded to
400,000 entries, 12 GiB read per snapshot and ten minutes per snapshot. The only
mount exclusions are `/proc`, `/sys`, `/dev`, the exact injected hosts/hostname/
resolv.conf files, and this observer's own output directory. Staging bytes are
included. Extended attributes and full OCI metadata are a later mandatory audit,
not claimed by this Node snapshot. Raw dpkg/query/loader output and all command
statuses are retained along with the complete delta.

A failed/uncertain install stops subsequent native checks. The collector only
gathers read-only after-evidence; it never cleans metadata, removes a lock, repairs
or retries. The observation build exits zero **to retain failure evidence** in
the scratch output. Therefore a successful build is not successful native proof.
Require `observationComplete`, `nativeCommandsPassed`, all original command
results and `error:null`; `releaseAccepted` always remains false.

For API only, the recipe creates a separate scratch NSS tool stage. certutil and
the independently reviewed fixture are copied into that stage, never into the
SQLite stage. A second network-disabled RUN binds it internally at
`/run/vaettir-nss` read-only. The fixture contract is
`empty-store-loader-proof/v1`: it receives the observation output directory,
creates a new empty synthetic SQL NSS store, actually initializes and lists it,
checks real cert9/key4 SQLite headers, and writes `nss-observation.json` plus raw
loader/store logs there. It must prove the actual loaded u4 softokn and accepted
SQLite bytes, not merely hash files that could have remained unused. The wrapper
pins the tool and fixture, records raw bounded child output/status, and refuses
repeat execution. Failed SQLite installation prevents this NSS action. Main
supplies and reviews the fixture; a missing observation or loader proof fails
the later gate even if its child exited zero. No NSS test acceptance exists yet.

## Gate C: independent changed-file ledger, not self-approval

`observation.json` is raw evidence. It contains no accepted exception list. Main
reviews the actual install and supplies an independent ledger binding its SHA256,
the exact ordered `changes`, one category per changed path and no unused entries.
`reviewedTransaction` and `verifyOverlay` refuse any unmatched change.

The initial reviewable classes are deliberately narrow:

| Class                        | Exact scope                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| SQLite payload               | libsqlite3.so.0.8.6, its exact SONAME symlink, package copyright                                                               |
| dpkg transaction             | explicit status/status-old, ld.so.cache, dpkg.log, ldconfig trigger and libsqlite3-0:amd64 info leaves listed in inventory.mjs |
| Removed old package document | exact old package-owned file under its doc folder, proven by original ownership output                                         |
| Verification files           | the five exact source/proof/probe paths in policy.json                                                                         |

No `/var/lib/dpkg/**`, native-prefix, count-only, symbol-prefix or directory-wide
exception is accepted. An unexpected legitimate transaction path still requires
review and a new source successor; the collector does not expand its own rules.
No used private SQLite ABI symbol may be waived or replaced with a spoof alias.

The final package-state review must parse retained real status/query/cache
evidence, preserve every unrelated package and dependency, verify SQLite package
ownership/version, complete trigger processing, no updates or held transaction
lock, and the exact loader mapping/content. The normalized objects consumed by
`verifyPackageState` are not emitted as assertions by this collector: Main must
retain their parser/source, raw evidence and review. Complete discovery of all
direct consumers and dynamic-lookup closure remains separate from rehashing the
old pinned consumer list. An empty dynamic-lookup list requires actual review.

## Gate D: final application image and release succession

The disposable install image still has the **62c application**. It is not the
final application image and must never be deployed as this release. Main must
preserve the exact observed install stage by immutable digest, review its native
transaction, and derive a new application overlay using final merged source/CI.
Do not rerun the dpkg transaction and reuse a ledger from a different instance.

Main's application-layer plan must enumerate every compiled/runtime/static source
change against the actual accepted parent contents, including source blob hashes
and before/after paths. Retain the finite three-cohort static asset policy and all
transport/security checks. No unrestricted dependency/native-directory COPY or
reuse of repo files as presumed deployed parent bytes is acceptable. Final
staging/observation cleanup and the optional five proof/source files need their
own explicit leaf ledger, separate from the raw dpkg transaction. The external
NSS tool/fixture must not appear in the final image or any of its runtime layers.

The final complete native inventory must equal the parent except for the exact
accepted SQLite library and, if intentionally retained, its exact accepted probe
at the sole policy path. Consumer bytes/import sets/discovery and dynamic lookup
review, actual NSS u4, browser, Prisma, real dpkg/loader state, extended metadata,
and fresh unsuppressed security scans are mandatory. The existing scoped API
finding is not authority to waive a new finding. Final scans must bind the actual
immutable application images.

`release-gates.mjs` checks evidence linkage and retains a nonempty list of release
gates. Its OCI byte-link function checks retained compressed/TAR hashes and ordered
descriptors/DiffIDs/daemon observations; **it does not decompress or interpret TAR**
and deliberately returns `completeOciAcceptance:false`. Main must use a separately
reviewed full-content materializer/verifier with original archives, compressed
bytes, exact config/descriptors/sizes, ordered layers, DiffIDs, bounded extraction,
whiteouts and complete merged inventories. A metadata bool, pull, inspect ID or
these linkage checks alone cannot admit an image. New image layer counts must be
measured and pinned, not assumed to equal old API98/Web56 counts.

All 110 prior migration bytes remain unchanged. Migration111 creates immutable
AiDisclosureCaseSnapshot and expands the grant scope by dropping/replacing its
check constraint. This is real SQL, not a no-SQL release. Retain actor/workspace/
tenant/action authority, history triggers and revoked-mandate refusal across
migration and recovery. Actual private DB probes must validate both old and new
data, the additive snapshot behavior, safe re-entry and tenant-aware recovery.

Main's separately reviewed operator sequence must then bind full final main CI,
actual API42/Web23 probes, the plugin and Android Postgres suites, all privacy and
disabled/invalid-mode refusals, schema111/seven fresh workers/catalog invariance,
same-daemon complete contents and full native/security acceptance. Web rolls
first and must stabilize before API; retain old API traffic retirement evidence,
current backups, six disabled schedules and actual alarm coverage. No expired AWS
hold is inferred; no always-on or PITR acceptance is inferred from a source file.

Full launch remains on HOLD until requested feature/provider/device/hosted
acceptance is recorded, including Mapping Details, mobile picker, both themes and
aTwist reload. Case19 stays pending and no eight-case import, Apply or decision is
replayed. The URL-confidence boundary prohibits alternate controller/CDP/cookie/
identity/API workarounds. This package does not activate aTwist or grant projects.
Owner clarification: aTwist's QA repository and app-specific debug setup are
end-user setup, not launch blockers. Do not request that source or credentials.
Validate the product's available integration/functionality with applicable
device, approval, visual and security gates. Directory activation remains pending
review; this clarification does not activate it or waive those product gates.

## Source-only verification

```text
node --test scripts/production-native-successor-v1/successor.test.mjs
pnpm exec eslint scripts/production-native-successor-v1/*.mjs --max-warnings 0
```

Tests use synthetic files, receipts and delegated runners. The CLI refusal test
uses null bindings and proves no context is created. It does not invoke Git,
Docker, a native tool, an app, database or provider. These tests are not native,
container, deployment, physical-device, provider or hosted acceptance.
