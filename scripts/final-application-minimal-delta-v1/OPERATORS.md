# Preserve unchanged runtime inodes during application composition

Source-only successor. Main owns actual compilation, image inspection, final
filesystem/metadata review, runtime and deployment. ae06, b40d, 0e605, d2f8 and
dbc9 packages remain frozen. No real package/store or application image is
mutated by this lane.

Use these produce, release-context, native-probe-context and seal-runtime
entrypoints after independent review. Binding b.minimalDelta contains manifest
and approval file refs, with scope FINAL_APPLICATION_MINIMAL_DELTA_SOURCE.
Generated operator config adds minimalDeltaPackage. All earlier source bindings
and checks remain; the new binding is immutable across every phase.

normalize.derived.mjs preserves the entire original before row when the
compiled runtime target has identical type, content hash/size, mode, uid/gid
and symlink target as applicable. This comparison follows the existing reviewed
application-owner projection. It does not infer new ownership. Artifact-only
alias counts are not applied to an unchanged runtime inode. No write or payload
source is emitted for that node; its original links, hardlink group and all
other before-row fields survive, including aliases outside /app in the cache.
The immutable before snapshot is used even when Web mirror roots overlap.

Changed/deleted existing hardlinks and changed/new artifact hardlinks remain
refused by the original delta loop. Content or metadata mismatch cannot become
an unchanged-node exception. New/modified unaliased generated JS and Prisma
files retain the normal write path. Native path and ELF/PE/Mach-O payload gates,
symlink safety, parent directory checks, observer cleanup scope, exact ledger,
payload hash/size and all final filesystem/extended metadata gates are unchanged.
This is not store mutation or permission to break aliases.

producerInputs.application[role].normalizerSource must refer to exact admitted
normalize.derived.mjs bytes. The CLI now hashes that file, rather than frozen
ae06 normalize.mjs. Main independently reviews actual normalized output and
the final image; proposals remain accepted=false and releaseAccepted=false.

Validation: node --test minimal.test.mjs normalizer-regression.test.mjs;
python -B derivation_test.py. All original producer/normalizer tests are retained
with only module routing changed. Synthetic tests cover cross-root aliases,
content/metadata/deletion refusals, artifact aliases, native payload rejection,
unaliased generated writes, exact derivations and actual inert module imports.
No actual build, container, database, provider, device or hosted operation runs.
