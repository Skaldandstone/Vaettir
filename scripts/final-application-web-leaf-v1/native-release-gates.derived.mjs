// Evidence-linkage gates, NOT an OCI exporter/materializer, deployer or authority
// to run them. Main's complete-content verifier and actual probes remain mandatory.
import {
  readRef,
  jsonRef,
  requireThat,
  same,
  hex,
  verifyTree,
  verifyRef,
  sha,
} from "../production-native-successor-v1/contracts.mjs";
import {
  verifyOverlay,
  verifyConsumers,
  verifyPackageState,
} from "./transaction-inventory.derived.mjs";

export const remainingGates = Object.freeze([
  "independent-transaction-review",
  "complete-native-consumer-discovery-and-dynamic-lookup-closure",
  "actual-runtime-nss-u4-with-pinned-external-tool-and-loader-proof",
  "actual-browser-and-prisma",
  "final-source-application-layer-review-and-three-cohort-static-retention",
  "full-native-equality-and-extended-metadata-ledger",
  "fresh-unsuppressed-native-security-scan",
  "same-daemon-complete-oci-export-content-and-layer-diffids",
  "actual-api42-web23-plugin-android-postgres",
  "schema111-migration-and-tenant-aware-recovery",
  "seven-fresh-workers-and-catalog-invariance",
  "full-final-main-ci",
  "web-first-stability-before-api",
  "retired-api-traffic-absent",
  "current-backups-disabled-schedules-and-alarms",
  "hosted-mapping-mobile-both-themes-atwist-reload",
  "requested-feature-provider-device-and-owner-acceptance",
]);
export function reviewedTransaction(ref, reviewRef, policy, read) {
  const observation = jsonRef(ref, read, 512 * 1024 ** 2),
    review = jsonRef(reviewRef, read);
  requireThat(
    review.observedTransactionSha256 === ref.sha256 &&
      observation.observationComplete === true &&
      observation.nativeCommandsPassed === true &&
      observation.error === null &&
      observation.installAttempted === true,
    "Actual complete successful transaction required",
  );
  requireThat(
    observation.admission?.sqliteProof === policy.sqliteAccepted.proofSha256 &&
      observation.admission.artifact ===
        policy.sqliteAccepted.artifactImage.split("@")[1],
    "Transaction used different native inputs",
  );
  requireThat(
    observation.commands.filter(
      (c) =>
        c.exe === "/usr/bin/dpkg" &&
        same(c.args, [
          "--install",
          "/tmp/vaettir-sqlite-overlay-v1/sqlite.deb",
        ]),
    ).length === 1,
    "Install was missing or replayed",
  );
  requireThat(
    observation.commands.every(
      (c) => c.status === 0 && c.signal === null && c.error === null,
    ),
    "Failed native operation",
  );
  return verifyOverlay(observation.before, observation.after, review, policy);
}
export function finalNativeEvidence(refs, policy, role, read) {
  requireThat(["api", "web"].includes(role), "Invalid native role");
  const audit = jsonRef(refs.audit, read),
    review = jsonRef(refs.acceptance, read);
  requireThat(
    review.independentReview === true &&
      review.auditSha256 === refs.audit.sha256 &&
      review.accepted === true &&
      audit.role === role &&
      audit.parentDigest === policy.roles[role].digest &&
      /^sha256:[a-f0-9]{64}$/.test(audit.imageDigest),
    "Exact final native review required",
  );
  for (const [key, ref] of Object.entries(refs))
    if (!["audit", "acceptance"].includes(key))
      requireThat(
        audit.evidenceSha256?.[key] === ref.sha256,
        "Native receipt evidence binding changed",
      );
  requireThat(
    refs.nativeBefore.sha256 === policy.roles[role].nativeInventorySha256,
    "Wrong baseline native inventory",
  );
  verifyTree(audit.proofTree, read);
  requireThat(
    audit.discovery.completeFilesystem === true &&
      audit.discovery.dynamicLookupsReviewed === true &&
      audit.discovery.noPrefixOnlyFilter === true &&
      audit.discovery.inventorySha256 === refs.consumerInventory.sha256,
    "Incomplete consumer discovery",
  );
  verifyConsumers(
    jsonRef(refs.consumerInventory, read),
    jsonRef(refs.expectedConsumers, read),
  );
  const consumers = jsonRef(refs.expectedConsumers, read),
    pinned = policy.sqliteConsumers.filter((r) => r.images.includes(role));
  requireThat(
    consumers.length === pinned.length &&
      pinned.every((row) => {
        const found = consumers.find((r) => r.path === row.path);
        return (
          found &&
          found.sha256 === row.sha256 &&
          same(
            [...found.undefinedSQLiteSymbols].sort(),
            [...row.undefinedSQLiteSymbols].sort(),
          )
        );
      }),
    "Reviewed expectations cannot waive a pinned runtime consumer",
  );
  requireThat(
    consumers.every((row) =>
      row.dynamicSQLiteSymbols.every((symbol) =>
        policy.sqliteCandidateExports.includes(symbol),
      ),
    ),
    "Used dynamic SQLite symbol missing from accepted library",
  );
  requireThat(
    review.expectedConsumersSha256 === refs.expectedConsumers.sha256,
    "Unreviewed consumer expectation",
  );
  verifyPackageState(
    jsonRef(refs.packagesBefore, read),
    jsonRef(refs.packagesAfter, read),
    policy.sqliteAccepted.librarySha256,
  );
  // The auditor must retain every native file and its hash. Only this exact
  // accepted library hash may differ; application overlays cannot exempt natives.
  const before = jsonRef(refs.nativeBefore, read),
    after = jsonRef(refs.nativeAfter, read);
  const expected = before.map((r) =>
    r.path === "usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6"
      ? { ...r, ...audit.sqliteNativeRow }
      : r,
  );
  if (audit.acceptedProbeRow) {
    requireThat(
      audit.acceptedProbeRow.path ===
        "usr/share/vaettir/sqlite-security/sqlite-runtime-regression" &&
        audit.acceptedProbeRow.sha256 === policy.sqliteAccepted.probeSha256 &&
        !before.some((r) => r.path === audit.acceptedProbeRow.path),
      "Unreviewed native proof binary",
    );
    expected.push(audit.acceptedProbeRow);
    expected.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
  requireThat(
    audit.sqliteNativeRow.path ===
      "usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6" &&
      audit.sqliteNativeRow.sha256 === policy.sqliteAccepted.librarySha256 &&
      same(expected, after),
    "Unrelated native inventory changed",
  );
  if (policy.roles[role].nssVersion) {
    const nss = jsonRef(refs.nss, read);
    requireThat(
      nss.imageDigest === audit.imageDigest &&
        nss.runtimePackage === policy.roles[role].nssVersion &&
        nss.actualNewEmptyStore === true &&
        nss.toolInstalled === false &&
        nss.toolShipped === false &&
        nss.readOnlyExternalTool === true &&
        nss.exitCode === 0,
      "Actual runtime NSS u4 proof required",
    );
    for (const key of ["tool", "fixture", "loaderLog", "storeLog"]) {
      requireThat(
        nss[key]?.sha256 === refs[key]?.sha256,
        "NSS custody mismatch",
      );
      readRef(refs[key], read);
    }
    const softokn = policy.roles[role].nssLibraries.find((r) =>
      r.path.endsWith("/libsoftokn3.so"),
    );
    requireThat(
      nss.loadedSQLiteSha256 === policy.sqliteAccepted.librarySha256 &&
        hex(nss.loadedSoftoknSha256) &&
        nss.loadedSoftoknSha256 === softokn.sha256,
      "NSS loaded a different runtime library",
    );
  } else
    requireThat(
      policy.roles[role].nssLibraries.length === 0 &&
        !after.some(
          (r) =>
            r.path.endsWith("/libsoftokn3.so") ||
            r.path.endsWith("/libnss3.so"),
        ),
      "Unexpected NSS addition to role without NSS",
    );
  requireThat(
    audit.browser.actual === true &&
      audit.browser.exitCode === 0 &&
      audit.prisma.actual === true &&
      audit.prisma.exitCode === 0,
    "Actual browser and Prisma proof required",
  );
  return {
    nativeEvidenceLinked: true,
    imageDigest: audit.imageDigest,
    releaseAccepted: false,
    remainingGates,
  };
}
export function verifyOciByteLinks(
  { manifest, config, layers, observations },
  read,
) {
  // Original compressed bytes and uncompressed TAR bytes are both supplied by
  // Main's full verifier. This checks identity/order; it DOES NOT replace that
  // verifier's decompression, TAR admission, whiteout or merged-filesystem checks.
  const m = JSON.parse(readRef(manifest, read).toString()),
    c = JSON.parse(readRef(config, read).toString());
  requireThat(
    m.config.digest === "sha256:" + config.sha256 &&
      m.config.size === config.bytes &&
      m.layers.length === layers.length &&
      layers.length > 0 &&
      layers.length <= 128 &&
      c.rootfs.diff_ids.length === layers.length,
    "OCI descriptor/config mismatch",
  );
  let aggregate = 0;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    requireThat(
      m.layers[i].digest === "sha256:" + layer.compressed.sha256 &&
        m.layers[i].size === layer.compressed.bytes &&
        c.rootfs.diff_ids[i] === "sha256:" + layer.uncompressed.sha256,
      "OCI ordered layer mismatch",
    );
    aggregate += layer.uncompressed.bytes;
    requireThat(aggregate <= 12 * 1024 ** 3, "Expanded OCI budget exceeded");
    verifyRef(layer.compressed, read);
    verifyRef(layer.uncompressed, read);
  }
  const operations = ["pull", "load", "export", "inspect"];
  requireThat(
    observations.length === operations.length &&
      observations.every(
        (r, i) =>
          r.operation === operations[i] &&
          r.exitCode === 0 &&
          r.daemonId === observations[0].daemonId &&
          typeof r.daemonId === "string" &&
          r.daemonId.length > 0 &&
          r.imageDigest === "sha256:" + manifest.sha256 &&
          r.stdinSha256 === sha(Buffer.from(r.retainedStdin)) &&
          r.timeoutMs > 0,
      ),
    "Same-daemon operation identity/capture missing",
  );
  return { byteLinksVerified: true, completeOciAcceptance: false };
}
