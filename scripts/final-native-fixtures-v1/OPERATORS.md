# Final native diagnostic fixture sources

This is a **source-only** successor. Main exclusively owns real build, image,
native, database, provider, device and hosted operations. The source tests use
synthetic file, process, ELF, browser and query-engine delegates. They do not
establish a successful native probe or final image. No final acceptance is emitted.

The fixed application source is `94cde34624bcc910c5f8c1a19214302ffa04c2bf`.
All prior packages, failures and receipts remain immutable. This directory adds
seven explicit source derivations from pinned d2/033f parents and leaves every
non-contract generated Python/JS operator byte unchanged. `derive.mjs` returns
source bytes only; `derive-operators.derived.py.render` renders source only.
Never import `operator-contracts.derived.py` or generated operator entrypoints
as a syntax check: their top-level behavior is operational.

## Review and custody order

1. Independently review this entire source package and its seven pinned parent
   sources. Bind `b.nativeFixtureSource = {manifest, approval}`, with approval
   scope `FINAL_NATIVE_FIXTURE_SOURCE`, accepted/independentReview true and the
   exact manifest SHA. The manifest has exact `packageRows` membership, bytes and
   SHA values; it is outside this source directory. Previous producer, dependency,
   minimal-delta and POSIX source bindings remain mandatory.
2. Preserve a new operator configuration with `nativeFixturePackage` pointing to
   this directory. Use its local release-context, native-probe-context,
   derive-operators and seal-runtime entrypoints. The generated contracts keep
   this binding immutable between source/materialize/native/runtime phases,
   rehash it before the gate call, and route through this successor. No frozen
   operator, source manifest or configuration is edited in place.
3. Review the exact actual final image and its **complete** native inventory.
   Fixture generation requires an independently reviewed exact match to the
   retained stage inventory minus only the stage's diagnostic regression tool at
   `tmp/vaettir-sqlite-overlay-v1/sqlite-runtime-regression`. Every remaining native
   path, content hash, size, mode, owner and kind must be identical. This is an
   additional fixture-admission check; it does not replace the original full OCI,
   native equality, extended metadata, application, package or consumer gates.
4. Prepare an input using `inputs.template.json`. With `final: null`, generation
   produces **inert, unaccepted review proposals**. Such fixtures refuse execution
   before creating an observation directory. For actual invocation supply
   `final.imageDigest`, `final.inventory` and `final.review` exact references.
   The latter must bind accepted/independentReview, inventory SHA, image digest,
   source, completeFilesystem true and stageInventorySha256. No placeholders pass.
5. After source approval, Main may use
   `node generate.mjs INPUT EVIDENCE_ROOT NEW_OUTPUT`. The generator reads retained
   pinned evidence and emits source only with exclusive output intent/files. It
   never executes a fixture or native process. Failed/ambiguous output is retained,
   never repaired or automatically retried. Review the resulting script bytes,
   image binding and exact two-element argv before admitting them into
   `b.runtime.nativeChecks[role]`. A proposal is never its own approval.
6. Use the successor native-probe-context only after all existing native-phase
   gates pass. The inherited runner, isolated network, readonly fixture mounts,
   actual NSS u4 tool/fixture, timeouts, bounded capture and evidence-only image
   stay unchanged. Main independently reviews actual observations and full final
   image content. A collector exit zero alone is not native success.

## Actual diagnostic behavior, when Main executes it

- `sqlite-installed` rehashes the actual library and metadata, reads its ELF
  dynamic exports/SONAME/search paths, checks exact accepted exports, then runs
  the retained accepted `d190...` C probe in a new diagnostic output directory.
  It checks actual version/source ID, dladdr library path, exact compile options,
  the functional suite and 400000-VALUES refusal. It also queries real dpkg status,
  version/source version, architecture, dependency, ownership and clean audit.
  The accepted tool bytes are embedded in the reviewed diagnostic source, written
  exclusively mode0555 in the disposable observation stage, never installed or
  copied into the final application image. Preserve its raw stdout/stderr and
  loader diagnostics. Full final-image content review must prove no shipped tool.
- `sqlite-consumers` rehashes every final native inventory row, including aliases.
  It parses every ELF dynamic symbol/NEEDED table and compares the complete direct
  SQLite consumer set with the pinned expected set. ELF32/64 and both endian
  forms are supported; malformed/unsupported structures fail closed. Non-ELF
  rows remain in the full scan and are not represented as Linux ELF consumers.
  Dynamic-loader imports and SQLite-name candidates are retained. Static parsing
  **does not prove dynamic lookup closure**: the observation explicitly leaves
  `completeDynamicLookupClosureAccepted:false`. Main's separate complete-filesystem,
  actual dynamic-lookup review and used-symbol closure remain required; no prefix
  filter, aliases, count waiver or automatic exclusion is admitted.
- API `browser` rehashes the exact retained Chromium executable, loads the
  application Playwright dependency, runs a synthetic inline DOM interaction and
  raster capture, blocks page requests and closes the browser. It makes no claim
  about hosted pages, customer data or all 23 Web runtime checks.
- API `prisma` rehashes all retained engine aliases, invokes the actual pinned
  schema engine JSON RPC `schemaPush` on a new synthetic SQLite store, loads the
  actual pinned native QueryEngine, then creates and reads a row. Both engine
  paths, successful schema steps and actual returned values are required. The
  existing immutable-image PostgreSQL/schema110-to111 migration and product tests
  remain separate mandatory checks. No existing database is opened.
- Web `prisma` rehashes **every** final native row and records absence of Prisma
  and browser engine paths in that exact independently reviewed inventory.
  Its result is `actual:false, applicable:false, absenceObserved:true`, never a
  successful native load/query. Missing inventory or a new engine fails closed.

Every native invocation binds the exact source/role/image to the inherited parent
plan before creating its exclusive fixture intent. Raw subprocess failures retain
status, signal, code, errno, syscall, stdout and stderr before refusal. An ambiguous
native action is terminal; no retry, cleanup, repair, dependency install or network
fallback occurs. Diagnostic artifacts remain in the evidence stage.

## Narrow Web applicability successor

The frozen generic gate required browser and Prisma success on Web even though
the retained Web image has no such engines. This successor retains the original
API check verbatim, adds actual raw schema/query/browser observation bindings,
and gives Web a separate strict applicability contract. It never maps absence to
`actual:true` and never accepts simply because `role == web`.

For API `nativeRuntime` add exact references `browserObservation` and
`prismaObservation` to each actual fixture `observation.json`. Existing audit
`evidenceSha256` binds these references. Their source, API role, final image, pinned
engine/browser hashes, DOM/raster, schema steps and create/read fields must match.
API browser/prisma exitCode0 and all original NSS/package/native gates remain.

For Web `nativeRuntime` add `applicabilityObservation` (the actual Web fixture
observation) and `applicabilityReview`. The latter has scope
`WEB_NATIVE_APPLICABILITY`, accepted/independentReview true, source/imageDigest,
inventorySha256, observationSha256, completeFilesystem/nativeEqualityUnchanged
true and a nonempty exact proofTree. The audit contains:

```json
{
  "applicability": {
    "schema": "web-native-applicability/v1",
    "source": "94cde34624bcc910c5f8c1a19214302ffa04c2bf",
    "role": "web",
    "imageDigest": null,
    "inventorySha256": null,
    "apiBrowserCompanionRequired": true,
    "actualWeb23Required": true
  },
  "browser": {
    "actual": false,
    "applicable": false,
    "absenceObserved": true,
    "reason": "ABSENT_FROM_COMPLETE_FINAL_NATIVE_INVENTORY",
    "observationSha256": null
  },
  "prisma": {
    "actual": false,
    "applicable": false,
    "absenceObserved": true,
    "reason": "ABSENT_FROM_COMPLETE_FINAL_NATIVE_INVENTORY",
    "observationSha256": null
  }
}
```

Nulls are illustrative and refuse admission. The actual observation must cover
each unique final native path and every content/metadata tuple. It must match
the source/image/inventory and independently reviewed evidence tree. The full
ordinary native equality and dynamic consumer discovery gates run before this
applicability check. Native applicability does not require Web23 prematurely:
that would make the pre-runtime gate circular. The successor seal explicitly
requires both the same release's actual API browser/Prisma proofs and actual
same-source Web23, in addition to all unchanged runtime/recovery gates. It still
emits release/hosted/production acceptance false.

## Source validation only

`node --test fixtures.test.mjs gates.test.mjs` exercises synthetic native files,
ELF structures, child failures, browser/Prisma delegates, scoped absence and gate
refusals. `python -B derivation_test.py` renders source and verifies all non-contract
generated bytes are identical to 033f. Generated native scripts receive `node
--check` only. None of these commands proves actual native success or deployment.

The official package payload, retained C regression bytes and interface sources
are evidence inputs, not commands to run in this source lane. Main must review
the complete transported source closure and pin the generated fixture variant.
Unsupported observations remain unresolved rather than being waived.
