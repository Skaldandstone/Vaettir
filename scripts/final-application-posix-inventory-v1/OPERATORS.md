# POSIX inventory names for Linux package metadata

Source-only successor to frozen e68. Main owns all actual operators, compilation,
container, native, database, cloud and hosted acceptance. No actual operation
is authorized by this package or its synthetic tests.

Use this package's produce, release-context, native-probe-context, seal-runtime
and derive-operators entrypoints after independent source review. New binding
b.posixInventory requires manifest and independent approval refs with scope
FINAL_APPLICATION_POSIX_INVENTORY_SOURCE. Operator config additionally requires
posixInventoryPackage. Keep all preceding package bindings, including minimalDelta
and minimalDeltaPackage. The new binding is immutable across every phase.

producerInputs.application[role].normalizerSource must bind this package's
normalize.derived.mjs. The local CLI resolves and hashes those exact bytes.
Local output-producer imports that same normalizer. Source admission compares
the complete current package to its reviewed manifest and pins all e68 files.

Only normalizeInventory's data path and hardlink target checks change. The new
posixInventoryName predicate accepts ordinary colon components such as
var/lib/dpkg/info/gcc-14-base:amd64.list and libacl1:amd64.md5sums. Names must
remain relative canonical POSIX components, with the existing length < 1024
bound. Empty names/components, NUL, backslashes, absolute/UNC paths, dot/dotdot,
and drive-like components beginning a single ASCII letter followed by colon
are refused. Names are never decoded, normalized, dropped or renamed.

Artifact, evidence, source and Git reference relative() is unchanged, as are
all host filesystem confinement, cohort, application-delta, symlink, native,
hardlink, before-row preservation, payload and ledger checks. Inventory data
admission does not authorize using a colon name as an artifact reference or
writing a changed application inode. All final image/native/extended metadata,
recovery/runtime/hosted gates remain. Proposals remain unaccepted.

Validation: node --test minimal.test.mjs normalizer-regression.test.mjs
posix.test.mjs; python -B derivation_test.py. Retain the original 50 JavaScript
tests with only successor routing/count adaptation, plus multiarch names,
hardlink/inode graphs, invalid paths, boundedness, strict-ref and binding tests.
Python checks render generated source only; no generated operator is executed.
