# Exact Web auxiliary-cache leaf successor

Source-only successor to frozen `ae06d66e`. Do not modify or replace that package.
All actual native/image/archive/database/provider/UI work remains Main-owned.
This lane read/hash-matched the 8,338,373-byte Web observation
`4a48afd17da7f449b8a6de0fcc70e37edc4e8ed8933f4d5de10a6e76364b9575`
and selected only the two `/var/cache/ldconfig/aux-cache` rows. It did not rerun
or independently accept the full transaction.

`aux-cache-review.mjs` adds only those exact Web rows: root ownership, mode0600,
regular file,3982bytes,one link and the exact before/after hashes. The full
`SQLITE_TRANSACTION_ONLY` independent review must bind this observation and
`auxCacheLeaf:{path,before,after}`. All original delta categories, byte equality,
library/loader/SONAME/consumer and remaining gates stay intact. Unknown
observations, cross-use of API/Web rows, adjacent paths, wrong metadata or
unreviewed extra changes fail. The exact prior API predicate is imported
unchanged; this is not a path-prefix or category waiver.

Main must independently review this package and bind:

```
"webLeaf": { "manifest": EXACT_SOURCE_MANIFEST_REF, "approval": EXACT_APPROVAL_REF }
```

Approval scope is `FINAL_APPLICATION_WEB_LEAF_SOURCE`, with accepted true,
independentReview true, manifestSha256 and a pinned proofTree file reference
containing actual `{files:[...]}` proofs. The producer binding still points at
the frozen ae06 package and its corrected manifest. `policy.json` pins every
one of the37 original files; its guard also rechecks the47 prior8a/8b inputs.
No stage/bootstrap, source archive, cache, probe, native policy, image digest,
parser or acceptance template is replaced by this leaf rule.

Use this package's `produce.mjs`, `release-context.derived.mjs`,
`native-probe-context.derived.mjs` and `seal-runtime.derived.mjs` with their
inherited CLI arguments when consuming Web transaction admission. The new
output producer and final-context path both use the new validator. The helper
continues reading probe/cache/stage sources from frozen ae06. No actual command
is run by source derivation or tests.

For newly generated operators retain `sourcePackage`=frozen8a and
`producerPackage`=frozenae06, and add `webLeafPackage`=this package. Generate with:

```
python scripts/final-application-web-leaf-v1/derive-operators.derived.py CONFIG.json NEW_OPERATOR_DIRECTORY
```

Main reviews exact generated sources before execution. `webLeaf` becomes an
immutable phase binding; generated contracts rehash its reviewed files before
calling this successor context. All other generated operator bytes are exact
parent bytes. Do not replay any native transaction or old failed operation.

`derive.mjs` deterministically derives ten files. Five need no byte change and
are retained as local import-chain modules; five change only source guards,
import routing and operator-package wiring. `derivations.json` pins every
original/candidate hash. Never format derived copies independently. Tests use
synthetic row/review/file delegates and source rendering only. Source admission
does not imply actual stage/runtime/hosted/production acceptance.
