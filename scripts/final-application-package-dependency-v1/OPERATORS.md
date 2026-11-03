# Exact accepted SQLite dependency transition

Source only. Main owns all actual operations. Frozen ae06, b40d and 0e605
packages remain unchanged. This successor fixes the exact accepted Debian
package dependency transition and the missing frozen apply-application import.

Use this package's produce.mjs, release-context.derived.mjs,
native-probe-context.derived.mjs, seal-runtime.derived.mjs and
derive-operators.derived.py after independent source review. Generated operator
configuration adds packageDependencyPackage pointing to this package. Binding
b.packageDependency contains manifest and approval file refs; approval scope is
FINAL_APPLICATION_PACKAGE_DEPENDENCY_SOURCE. All inherited source reviews remain
mandatory; this binding is immutable across source/materialize/native/runtime.
Stage bootstrap routes to the separately reviewed 0e605 stage-label helper and
still needs b.stageLabels. No old entrypoint is modified.

Both final structural and final runtime native refs add packageTransition, a
file ref to an independently accepted FINAL_PACKAGE_TRANSITION review with:

- role and imageDigest matching the final native audit;
- packagesBeforeSha256/packagesAfterSha256 binding those exact normalized refs;
- package, control, controlReview, observation and transactionReview file refs;
- proofTree, a file ref to JSON containing files[] of retained proof refs.

The exact accepted e862 package, e792 control bytes, bf679 independent control
review and role-specific original observation/transaction-review hashes are
pinned in package-transition.mjs. Root independently verifies those original
bytes and the final image's package captures; this code never installs anything.
The accepted control review is not final native or release acceptance.

Normalized packages[] must correspond exactly, in captured order, to the eight
raw dpkg-query columns: name, status, version, architecture, dependencies,
preDepends, triggersAwaited, triggersPending. The only SQLite changes are
3.46.1-7+deb13u2 to 3.54.1-0+vaettir1 and libc6 (>= 2.38) to libc6 (>= 2.41).
Unchanged installed amd64 libc6 must be exactly 2.41-12+deb13u4+vaettir1.
No version range, alternate dependency or generic exception is admitted.
Additional/missing packages, other control changes, unresolved status/triggers,
changed libc, failed/forced/repeated install and changed raw loader maps refuse.
Final lock, audit, update, normalized loader, all native byte/consumer/metadata,
NSS, browser, Prisma, OCI, schema111 recovery and hosted gates remain required.

The evidence reader issues an immutable in-process token after hashing retained
proofs; callers cannot substitute an acceptance boolean. Final normalized
package rows are compared against the actual original captured rows, while
independent FINAL_PACKAGE_TRANSITION review binds final image observations.
Raw evidence is never edited or replaced with normalized fiction.

Validation: node --test package.test.mjs; python -B derivation_test.py.
Tests import every inert MJS module through its real transitive graph and run
the actual gated cache/probe source generators with synthetic review and source
delegates. No generated operator, native command or real database executes.
All generation outputs still require Main review and never imply deployment.
