# SQLite runtime source repair, 2026-11-02

The PR108 image audits found ten SQLite findings in both runtime images. The
API also retains its separately reviewed medium finding. Removing SQLite would
break the API's NSS dependency: `libsoftokn3.so` needs `libsqlite3.so.0`. Both
images also contain the `lslogins -> liblastlog2 -> libsqlite3` dependency.
This change prepares a genuine SQLite 3.54.1 package while retaining those
consumers and the shared-library ABI. It does not clear the release hold.

The baseline library is Debian `3.46.1-7+deb13u2`, SHA256
`317d80bf5d592f98a71e14d2330591d6a339f631f37c5977835af748a1f26715`.
The candidate is the [official canonical SQLite source](https://sqlite.org/download.html),
version [3.54.1](https://sqlite.org/changes.html), source ID
`2026-10-16 14:45:20 555e07ef33f69a0957d24d8e555b702464a131d6f1607f4c3c1e4551e8e6ca76`.
The archive's published SHA3-256 and its independently computed SHA256, byte
length, member bounds, test-file hashes and upstream fix commits are pinned in
`scripts/sqlite-runtime-sources.json`. This is HTTPS and digest provenance,
not a claim of a separately verified upstream signature.

The ten [Debian tracker findings](https://security-tracker.debian.org/tracker/source-package/sqlite3)
are CVE-2026-119371 through CVE-2026-119379 and CVE-2026-119591. The manifest
maps each to its upstream commit. Eight have exact upstream regression files:
CTE depth, FTS3 snippets, FTS5 prefix/secure-delete corruption, COLLATE depth,
FULL JOIN authorization, Rtree corruption and session changesets. The remaining
two have dedicated C regressions for the WAL frame tail and count-of-view
parser cleanup. The image build requires all eight files in both ordinary and
ASan/UBSan configurations, with nonzero counts and the specific new case markers.
Feature-disabled early returns, sanitizer errors and missing markers fail.

The canonical source is used to regenerate the parser with UPDATE/DELETE LIMIT
enabled. The runtime keeps Debian's feature macros, including FTS3/4/5, Rtree,
session/preupdate, column metadata and extension loading. The generated
amalgamation's actual hash is recorded; it is not falsely identified as the
generic upstream amalgamation. The checker preserves matching-baseline-header public exports and actual
consumer-required symbols, plus feature options and resource limits, verifies the SONAME, and executes a real
shared-library probe. The package owns the actual compiled library and reports
`3.54.1-0+vaettir1` in dpkg. The filename `libsqlite3.so.0.8.6` is the retained
ABI filename, not a forged upstream version.

The WAL regression calls the actual internal `sqlite3WalReadFrame` against a
512-byte synthetic file frame and a poisoned 4096-byte output buffer. Candidate
builds must zero the 3584-byte tail. A pinned official 3.53.4 source is compiled
only as an isolated negative control: it must return exactly 42 with the exact
unchanged poisoned tail. A crash, timeout, arbitrary failure or already-fixed
control is not accepted as reproduction. The count-of-view regression uses the
published 400000-row VALUES pattern and requires normal expression-depth
rejection. These controls and the source archives never enter runtime images.

The build also initializes and lists an empty, synthetic NSS certificate store
with the installed candidate, checks NSS's dependency and loader resolution,
and preserves its logs. It does not access a customer certificate store,
database, browser session or provider. The API repeats its existing Chromium,
graphics, Prisma and other native runtime checks after SQLite installation.
The web image repeats its SQLite identity check as `nextjs` and retains the
existing startup and native checks. The package is installed after all apt and
browser dependency changes, so a later apt step cannot silently replace it.

## Main-owned acceptance

This source lane runs only synthetic JavaScript checks and static parsers. It
has not compiled or executed SQLite, Docker, NSS, sanitizers, a native image or
a database. Those checks are encoded as fail-closed build gates, not reported
as passing. Main must independently review and accept this source before any
execution. First build the dedicated `Dockerfile.sqlite-security` proof target
with the exact reviewed source commit. Retain the complete exported
`sqlite-native`, `sqlite-inputs` and `scripts` trees, including all logs,
package, generated sources, positive and negative controls. Review actual
failures as failures; do not bypass a failed baseline, option, ABI, fixture or
sanitizer gate. Corrections require new reviewed source.

Then Main owns the complete API/Web build and scan. Verify each actual final
library hash, loaded source ID, honest package metadata and native consumer
behavior, including all existing browser/Prisma checks. A source pin or clean
package scanner alone is insufficient. The inherited full native/security
inventory, finite cohort retention, transport, same-daemon OCI contents,
ordered layer hashes/DiffIDs, API42/Web23 runtime probes, main CI, Web-first
rollout, retirement and tenant-aware rollback gates remain mandatory.
Frozen PR107/PR108 release inputs are unchanged; a new release must admit the
new source and image identities explicitly. Hosted UI, provider, customer,
PITR and full production acceptance remain separate and open.

## Overlay plan for the sealed API71/Web79 baselines

The production operator uses the already accepted, prepruned runtime images,
not a replay of the repository Dockerfiles' long native build. The Dockerfile
changes here define a fresh-image contract; they are not permission to replay
old operators or to assume apt/dpkg is present in a prepruned runtime. Main
must prepare a new, separately reviewed overlay operator after the standalone
SQLite proof is accepted. No overlay operator is implemented by this change.

1. Admit the full original OCI contents of API71 (`156b02e9…`) and Web79
   (`3f615b8e…`) using their existing complete accepted receipts, descriptors,
   ordered compressed hashes and DiffIDs. Record each original full native,
   file, symlink, package and image-config inventory. Admit the exact new
   SQLite package, native library, probe and complete proof tree by their
   independently verified hashes. Never resolve a moving image tag or a
   boolean-only availability receipt.
2. Inspect the actual baselines for dpkg, its state database, the loader and
   required maintainer-script interpreter. Do not assume a package manager
   survived pruning. Use a real, offline package transaction in a disposable
   derived image if its existing dpkg supports it. If the executable was
   removed but genuine package state remains, Main may propose a pinned
   external packaging stage operating on a completely materialized private
   root with `dpkg --root`; its interpreter, trigger and chroot behavior must
   be separately reviewed and proven. Do not copy a fabricated status stanza,
   invent package ownership, disable dependency checks or install apt into the
   final runtime. Missing package state is a hold requiring a new reviewed
   packaging method, not permission to manufacture it.
3. Before admitting the result, compare the full inventories. The only SQLite
   payload paths allowed to change are
   `/usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6`, its `.so.0` symlink and
   `/usr/share/doc/libsqlite3-0/copyright`. Existing package-owned documentation
   may be removed only when the real package transaction identifies it in a
   reviewed exact removal ledger. The new verification files are exactly
   `/usr/share/vaettir/sqlite-security/sqlite-runtime-proof.json`,
   `/usr/share/vaettir/sqlite-security/sqlite-runtime-regression`, and the three
   `/app/scripts/{sqlite-runtime-sources.json,fetch-sqlite-runtime-sources.mjs,check-sqlite-runtime.mjs}`
   files. Each must equal the accepted artifact bytes and intended modes.
   The symlink target must be `libsqlite3.so.0.8.6`; no other native library,
   executable or symlink may change in this SQLite overlay.
4. Package-manager effects are a separate exact ledger, not a wildcard path
   exception. Admit only the actual `libsqlite3-0:amd64` info records produced
   by dpkg, that package's status paragraph and the recorded prior-status
   backup, plus any exact loader-cache/ldconfig-trigger effects proven by the
   transaction. Require unrelated package records and dependencies to remain
   unchanged, no pending trigger or package audit failure, and no residual
   transaction update/lock file. Compare decoded loader mappings so only
   SQLite can resolve to new bytes. Root must inspect and pin this observed
   ledger before release; an unexpected path or paragraph is a rejection,
   not an automatically expanded allowlist. Retain before/after evidence.
5. Require the candidate's exact ELF machine/type, SONAME, baseline public/consumer
   export compatibility, compile capabilities and limits, loaded source ID and library
   hash. Run actual NSS initialization/listing and existing Chromium,
   graphics, Prisma and web startup checks in the derived environments.
   Preserve runtime configuration and all unrelated native bytes. Do not
   reuse the old equality verdict for the deliberately replaced SQLite
   library; use the narrowly reviewed delta plus unchanged-byte checks for
   everything else. The later coherent application-source overlay is a
   distinct reviewed delta, including its new source and schema identities.
6. Perform a fresh unsuppressed scan of both final immutable images, admit the
   complete same-daemon materialized OCI archives, and rerun the required
   application/runtime probes. No suppressions, old clean-scan reuse, fake
   package versions, or API-only/Web-only dependency assumptions. Only Main
   can accept the new release root and conduct the existing rollout and
   retirement sequence. Hosted and full-production gates remain open.

## Observed proof corrections

The first isolated proof stopped before compilation because two pinned fuzz
fixtures exceed the original individual member bound. Their measured maximum
is 17021952 bytes; the separate 150000000-byte total, count, digest and path
limits remain unchanged. The next proof compiled and reached the final
compatibility checker, which rejected a real configuration difference:
Debian's maximum default page size is 32768, while upstream defaults to 8192.
The manifest now explicitly preserves 32768. The resource-limit comparison
remains mandatory and its regression rejects 8192 against that baseline.
Failed attempts are retained and do not authorize a runtime image. Failed
builds also emit bounded tails of synthetic native logs for diagnosis while
preserving their nonzero exit status.

### Reviewed ABI boundary after the actual native proof

Proof v3 reached the export checker and was rejected: Debian exports 1427
symbols, including 1091 implementation symbols that the upstream amalgamation
makes private. This is retained as a failed attempt. The successor contract
pins the exact Debian 3.46.1-7+deb13u2 core, session and Rtree public headers,
then intersects their declarations with the actual baseline dynamic exports.
All 336 resulting public exports remain required. A name prefix alone is not
the public API definition. The full 1427-symbol baseline, all declared names
and every explicitly classified private symbol are pinned in the manifest.

The actual API71/Web79 SQLite consumers are also pinned by full file hash:
liblastlog2 (14 SQLite imports) and API NSS libsoftokn3 (19). Any consumer-used
private symbol remains required. Every removed export must be explicitly
classified as private and unused by those consumers; unknown symbols fail.
The proof retains full candidate/baseline inventories and exact added/removed
deltas. Installed verification repeats the contract and delta checks against
the exact tested library. No aliases or fake implementations are supplied.
Final image inventory must confirm these exact consumers remain unchanged;
a new or changed consumer requires a newly reviewed closure. Real NSS,
browser, Prisma, options, limits, SONAME and fresh security gates still apply.

Final runtime admission additionally runs `check-sqlite-runtime.mjs --consumers
api` (or `web`) to rehash the exact role-pinned consumer files. The complete
native-image auditor must pass every direct SQLite consumer and its actual
undefined-symbol inventory to `checkConsumerInventory`; new, missing or changed
consumers fail. This complete inventory gate remains separate from the narrow
installed path rehash. The isolated compiler image's newer NSS package is a
synthetic functional check and is not proof of the final API71 consumer bytes.
