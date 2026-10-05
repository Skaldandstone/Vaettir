# Corrected native packaging lineage

This is a source/planning contract, not a successful native build or deployment.

The current native recipe passes its calculated dependency substitutions to
`dpkg-gencontrol` with `-Tdebian/libllvm19.substvars`. Its generated files list is
written with `-f/build/libllvm19.files`, outside the immutable source inventory
and outside the package's restricted `DEBIAN` metadata directory. No source
exclusion, baseline, test target, timeout, concurrency, package assertion or
default Dockerfile command is relaxed.

The exact corrected LF recipe is
`0a35a384df5974dab2163484566a7abe2f65b62cce8061340089a7837e98aa87`.
The historical LF recipe remains
`c5c97e29d3722314faf2d09cda17a495972df30ab003ac55e80b6d18f308a0b9`.
Changing a native input requires an honestly new source/archive/receipt lineage.
An accepted historical core or unit checkpoint cannot become a corrected final
package simply by relabeling its receipt.

## Separate versioned producers

`scripts/native-packaging-v2-derivation.mjs` accepts the exact frozen original LF
recipe and ten original whole-module buffers. It makes only fixed recipe-pin,
purpose, old-source-refusal and static-import edits. Every edit reverses to the
complete original module bytes. Six derived producers have distinct
`native-packaging-v2-` filenames. Four shared verifier/adapter/recovery helpers
remain byte-identical. The public versioned producers are checked against the
compiler's exact outputs, not merely compared to a mocked interface.

The original v1 producers and their source pins remain unchanged. The corrected
prepare producer explicitly rejects the original production-native source
commit and requires a new null-parent prepare. Both complete original unit
suites, object/source identity, ABI, ARM defaults, JIT, package verification and
independent committed-image checks remain required through the new lineage.

This compiler does not write files, export an archive, import generated modules,
call AWS or grant any runtime acceptance. Callers must independently verify the
actual canonical source commit, exact Git ZIP/native entries, producer closure,
generated commands, budgets and resource admission before an operation.

## Historical synthetic fixture compatibility

The test-only `native-v1-recipe-test-fixture.mjs` admits only the two exact known
LF recipe hashes/sizes above. It reverses only the complete corrected packaging
line and verifies the complete original hash. Its returned provenance explicitly
identifies historical synthetic input; unknown bytes, EOL drift, partial edits,
caller-supplied policy and mutated buffers are refused.

Only historical v1 fixture constructors use that adapter. Current recipe checks
read the actual corrected source. V2 synthetic constructors use corrected bytes
before creating their ZIP, with a new fixture source pin. No archive entries are
replaced after creation. Test-only module EOL normalization ends at exact pinned
LF bytes; the production derivation admission remains strict.

Run `pnpm test:native-packaging-v2`, `pnpm test:operations` and the existing
native-planner/verifier/transport suites. Linux CI must execute the real symlink
scenarios unavailable on Windows. These checks establish source/synthetic
coherence only. Actual native receipts, packaged runtime/image security,
compatible migration/recovery evidence, stable services and authenticated
critical-flow verification remain mandatory before release.
