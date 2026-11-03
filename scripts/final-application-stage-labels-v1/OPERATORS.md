# Exact native transaction-stage CLI labels

Separate source-only successor preserving ae06 and b40d. The frozen ae06 stage
validator expected labels equal to the parent. Actual Main build driver adds
three labels on `docker build`, outside the Dockerfile. This lane read the
exact driver3955bytes/SHA066073d8b90b3c220d582fa5494a0d6dbf257553f5efce7df7a67516ae967ad6
and its stage build line; it did not execute it or accept actual image configs.

The derived validator requires exactly these three additions to the original
parent labels, with all other labels and non-label runtime config unchanged:

- `vaettir.artifact-purpose=sqlite-transaction-stage`
- `vaettir.runtime-eligible=false`
- `vaettir.validation-source=<exact admitted final source commit>`

It also requires those labels and the exact actual driver hash/size in the
independent byte-verification intent. Wrong, missing, extra or cross-source
labels and any unrelated config change refuse. This is actual reviewed CLI
provenance, never an assumption from a Dockerfile or an assertion waiver.

Main adds `stageLabels:{manifest:EXACT_REF,approval:EXACT_REF}` to bindings.
The new independent approval scope is `FINAL_APPLICATION_STAGE_LABELS_SOURCE`
with exact manifestSha256 and pinned proofTree reference. Existing source,
privacy, main-CI, ae06 producer and stage metadata intent gates remain required.
In `producerInputs.stageBootstrap[role]`, add `buildDriver:EXACT_REF`. Its hash
and size must match the pinned actual driver. Independent
`TRANSACTION_STAGE_BYTE_VERIFICATION_INTENT.binding` now additionally binds
`buildDriver` and `stageLabels` (the exact three-label dictionary above), along
with all prior actual request/result/context/log/observation/source/tree/role/
parent-prefix/manifest/config/ordered-layer custody. Main must independently
check actual config and raw command log against this intent.

Generate a new stage context only after source/intent reviews:

```
node scripts/final-application-stage-labels-v1/prepare.mjs BINDINGS EVIDENCE_ROOT SOURCE_REPO api NEW_STAGE_CONTEXT
```

This CLI preserves the full ae06 source-admission gates and adds the separately
reviewed stage-label source. It derives the same stage operator context, with
only `stage_support.py` changed. Original assembler, verifier, driver, metadata
helper and archive contract bytes remain identical. No existing accepted
context is edited; root independently reviews newly generated source before
any operation. Stage proof inputs rehash the successor manifest/approval and
driver, and the complete independent intent is compared again on use.

Use b40d's entrypoints for final Web transaction/application/runtime admission;
this separate package only corrects transaction-stage context preparation.
Do not rerun native transactions, cloud builds or failed operators. All actual
execution remains Main-owned. A corrected validator or context is not OCI,
extended metadata, native/runtime/hosted or production acceptance.

`derive.mjs` binds exactly two original/candidate source transformations.
`policy.json` pins all57 ae06+b40d files; parent guard also checks47 older pins.
Tests use synthetic configs/source rendering only. Source remains frozen after
delivery until concrete Main-coordinated handback.
