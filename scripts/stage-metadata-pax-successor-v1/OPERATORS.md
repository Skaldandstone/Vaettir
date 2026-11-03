# Reviewed hardlink PAX and retained TAR reuse

Source-only successor to frozen ae06 stage_metadata.py (aec214...). No original
package or failed output is edited. Main independently reviews and executes.

Run from this preserved source package, without copying over the admitted stage
context:

    python -B stage_metadata.py api CONTEXT EVIDENCE SOURCE_REVIEW_REL REUSE_REVIEW_REL

CONTEXT is the absolute existing admitted API stage context. EVIDENCE is the
absolute existing evidence root. The last two paths are relative to EVIDENCE.
Only API is admitted because Web metadata already completed. Source import is
inert; the main operation is not executed by this lane or by synthetic tests.

SOURCE_REVIEW_REL must contain accepted=true, independentReview=true,
scope=STAGE_METADATA_PAX_SUCCESSOR_SOURCE, manifest (file ref to the exact
files[] source manifest) and proofTree (file ref to JSON files[]). Main retains
and binds all reviewed helper source bytes in that proof tree. Source bytes in
this directory must match the manifest exactly. Parent stage context remains
admitted through its original source manifest, independent review and complete
proof tree; the exact 0e605 stage_support and frozen ae06 metadata hashes are
checked before loading archive_contract. Existing model/source/parent-prefix
checks remain unchanged.

REUSE_REVIEW_REL must contain accepted=true, independentReview=true,
scope=STAGE_METADATA_RETAINED_TAR_REUSE, proofTree, and:

- successorManifestSha256, stageConfigSha256, stageSourceManifestSha256;
- source, stageDigest, configDigest and the exact nonempty daemonId;
- availability and verification file refs to the original completed API stage
  availability and local-export-verification.json in this context;
- priorFailure, an exact retained file ref recording the v1 parse failure;
- layers[], exactly ordered indices 0 through 28. Each row has index,
  compressedSha256 (without sha256:), compressedBytes, diffId (with sha256:),
  expandedBytes and tar (file ref to the corresponding original v1 layer TAR).

Every reuse row must match the admitted model's actual compressed hash/size and
DiffID/expanded size. The TAR path must be this context's original
stage-metadata-proposal-v1/layer-N.tar. Compressed files and retained TAR bytes
are rehashed; actual same-daemon complete-content verification and independent
reuse review are mandatory. No pull, load, build, install, native test, cleanup
or file extraction is performed. The existing verifier still decompresses and
verifies non-reused layers. Reused layers avoid repeated decompression; exact
compressed bytes and exact already materialized DiffID bytes are both checked.
Retained TARs are read in place and rehashed after inspection. No copying over,
repairing or retrying the failed v1 namespace occurs.

The output must be absent stage-metadata-proposal-v2 under CONTEXT. Existing
output or any ambiguous failure stops; no automatic retry. All ordinary before
and after discrepancies remain reported. Reused TAR provenance is explicit in
each layer record; the full proposals reference the original retained files.
Source/reuse approvals and input custody are retained in the new proof tree.

Hardlinks allow only PAX path/linkpath keys whose decoded bounded safe values
match the resolved member path/alias target. Unknown, sparse, xattr, ACL,
capability, time and ownership PAX keys remain refused on hardlinks. Original
PAX values, header offsets/bytes/hashes, target and inode alias events remain.
Missing/forward/nonregular targets and ambiguous mode/ownership remain refused.
The header reader stays open once for the member loop; semantics are unchanged.

All outputs remain unaccepted proposals. Final filesystem/extended metadata,
full native equality, consumer/dynamic closure, NSS, browser/Prisma, final app,
OCI/runtime/schema111/hosted/provider and production gates are separate.
No stage or metadata proposal is a final deployable application.

Validation: python -B metadata_test.py. Synthetic TAR/file tests compare exact
metadata output with the original parser, exercise refusal cases and retained
prefix corruption. No actual layer TAR or actual operator is run by tests.
