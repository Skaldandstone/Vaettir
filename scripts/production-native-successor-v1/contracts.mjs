// Offline admission only. Receipts bind evidence; they do not create authority.
import { createHash } from "node:crypto";
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const requireThat = (ok, message) => {
  if (!ok) throw Error(message);
};
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
export const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function hex(value, n = 64) {
  return (
    typeof value === "string" && new RegExp(`^[a-f0-9]{${n}}$`).test(value)
  );
}
export function relative(path) {
  return (
    typeof path === "string" &&
    path.length < 1024 &&
    !path.includes("\\") &&
    !path.includes(":") &&
    !path.startsWith("/") &&
    path.split("/").every((x) => x && x !== "." && x !== "..")
  );
}
export function readRef(ref, read, maximum = 64 * 1024 * 1024) {
  requireThat(
    ref &&
      relative(ref.path) &&
      hex(ref.sha256) &&
      Number.isSafeInteger(ref.bytes) &&
      ref.bytes >= 0 &&
      ref.bytes <= maximum,
    "Missing or unbounded exact artifact pin",
  );
  const bytes = read(ref.path, ref.bytes);
  requireThat(
    Buffer.isBuffer(bytes) &&
      bytes.length === ref.bytes &&
      sha(bytes) === ref.sha256,
    `Artifact mismatch: ${ref.path}`,
  );
  return bytes;
}
export function jsonRef(ref, read, maximum) {
  return JSON.parse(readRef(ref, read, maximum).toString("utf8"));
}
// Complete filesystem inventories exceed ordinary receipt sizes. Other JSON
// retains readRef's 64 MiB default, including config and native inventories.
export const COMPLETE_INVENTORY_MAX_BYTES = 256 * 1024 ** 2;
export function completeInventoryRef(ref, read) {
  return jsonRef(ref, read, COMPLETE_INVENTORY_MAX_BYTES);
}
export function verifyRef(ref, read, maximum = 12 * 1024 ** 3) {
  requireThat(
    ref &&
      relative(ref.path) &&
      hex(ref.sha256) &&
      Number.isSafeInteger(ref.bytes) &&
      ref.bytes >= 0 &&
      ref.bytes <= maximum,
    "Missing or unbounded exact artifact pin",
  );
  if (read.verify)
    requireThat(
      read.verify(ref) === true,
      "Streaming artifact verification failed",
    );
  else readRef(ref, read, Math.min(maximum, 512 * 1024 ** 2));
}
export function index(rows, key = "path") {
  requireThat(
    Array.isArray(rows) && rows.length <= 400000,
    "Invalid inventory",
  );
  const result = new Map();
  for (const row of rows) {
    requireThat(
      row && typeof row[key] === "string" && !result.has(row[key]),
      "Duplicate inventory entry",
    );
    result.set(row[key], row);
  }
  return result;
}
export function verifyTree(ref, read) {
  const tree = jsonRef(ref, read),
    files = index(tree.files);
  requireThat(files.size > 0, "Empty evidence tree");
  let total = 0;
  for (const row of files.values()) {
    total += row.bytes;
    requireThat(
      Number.isSafeInteger(total) && total <= 32 * 1024 ** 3,
      "Evidence rehash budget exceeded",
    );
    verifyRef(row, read);
  }
  return files;
}
export function verifyMigrations(before, after, policy) {
  const old = index(before),
    next = index(after);
  requireThat(
    old.size === 110 && next.size === 111,
    "Schema110-to111 inventory required",
  );
  for (const row of policy.baselineMigrations)
    requireThat(
      same(old.get(row.path), row) && same(next.get(row.path), row),
      "An existing migration changed",
    );
  for (const row of policy.candidateMigrations)
    requireThat(same(next.get(row.path), row), "Unreviewed migration111 bytes");
  return {
    before: 110,
    after: 111,
    added: after.filter((r) => !old.has(r.path)),
  };
}
export function admitPreparation(
  bindings,
  policy,
  { read, source, operatorFiles },
) {
  requireThat(
    bindings.schemaVersion === 1 && bindings.purpose === policy.purpose,
    "Wrong successor contract",
  );
  const s = bindings.source,
    q = bindings.sqlite;
  requireThat(
    s &&
      hex(s.commit, 40) &&
      hex(s.tree, 40) &&
      q &&
      q.source === policy.sqliteAncestor &&
      /^sha256:[a-f0-9]{64}$/.test(q.imageDigest ?? ""),
    "Final source/SQLite artifact identities are not accepted yet",
  );
  requireThat(
    source.tree(s.commit) === s.tree &&
      source.contains(s.commit, policy.applicationAncestor) &&
      source.contains(s.commit, policy.sqliteAncestor),
    "Final source lacks exact reviewed ancestors",
  );
  const merged = jsonRef(s.mergeReceipt, read),
    privacy = jsonRef(s.privacyAcceptance, read),
    ci = jsonRef(s.mainCiReceipt, read);
  requireThat(
    hex(merged.commit, 40) &&
      source.contains(s.commit, merged.commit) &&
      source.tree(merged.commit) === merged.tree &&
      merged.normalMerge === true &&
      merged.parents?.length === 2 &&
      same(merged.parents, source.parents(merged.commit)),
    "Merged source mismatch",
  );
  requireThat(
    privacy.accepted === true &&
      privacy.commit === s.commit &&
      privacy.tree === s.tree &&
      privacy.ledgerSha256 === s.sourceLedger.sha256,
    "Source privacy review mismatch",
  );
  const ledger = jsonRef(s.sourceLedger, read),
    actual = source.changes(policy.baselineSource, s.commit);
  requireThat(
    same(ledger.files, actual),
    "Complete changed-source ledger mismatch",
  );
  requireThat(
    ci.commit === s.commit &&
      ci.tree === s.tree &&
      ci.actualCheckout === s.commit &&
      ci.conclusion === "SUCCESS" &&
      ci.complete === true &&
      ci.logSha256 === s.mainCiLog.sha256 &&
      typeof ci.runId === "string" &&
      /^[0-9]+$/.test(ci.runId),
    "Exact successful full main CI required",
  );
  readRef(s.mainCiLog, read);
  for (const gate of [
    "api",
    "web",
    "browser",
    "database",
    "privacy",
    "android",
  ])
    requireThat(ci.gates?.[gate] === "PASS", `Missing main CI gate: ${gate}`);
  verifyMigrations(
    source.migrations(policy.baselineSource),
    source.migrations(s.commit),
    policy,
  );
  const proof = jsonRef(q.proof, read),
    accept = jsonRef(q.acceptance, read),
    pins = policy.sqliteAccepted;
  requireThat(
    q.acceptance.sha256 === pins.acceptanceSha256 &&
      q.proof.sha256 === pins.proofSha256,
    "Wrong independently accepted standalone receipt",
  );
  for (const [key, field] of [
    ["package", "packageSha256"],
    ["library", "librarySha256"],
    ["probe", "probeSha256"],
  ]) {
    readRef(q[key], read, 512 * 1024 ** 2);
    requireThat(
      proof[field] === q[key].sha256 &&
        accept[field] === q[key].sha256 &&
        pins[field] === q[key].sha256,
      `SQLite ${key} custody mismatch`,
    );
  }
  requireThat(
    proof.sourceCommit === q.source &&
      accept.source === q.source &&
      accept.standaloneNativeProofAccepted === true &&
      accept.rootIndependentlyVerifiedAllContent === true &&
      accept.rootIndependentlyParsedElf === true &&
      accept.honestPackageInspection === true &&
      accept.buildId === q.buildId &&
      q.buildId === pins.buildId &&
      accept.artifactImage === pins.artifactImage &&
      accept.artifactImage.endsWith("@" + q.imageDigest) &&
      accept.proofSha256 === q.proof.sha256,
    "Independently accepted standalone proof required",
  );
  const evidence = index(q.evidence),
    logs = index(q.logs);
  requireThat(
    evidence.size === Object.keys(accept.evidenceSha256).length &&
      logs.size === proof.logs.length,
    "Missing or extra standalone evidence",
  );
  const prefix = q.acceptance.path.slice(
    0,
    q.acceptance.path.lastIndexOf("/") + 1,
  );
  for (const [path, digest] of Object.entries(accept.evidenceSha256)) {
    const ref = evidence.get(prefix + path);
    requireThat(
      ref?.sha256 === digest,
      "Original standalone evidence mismatch",
    );
    readRef(ref, read);
  }
  requireThat(
    proof.tests?.length === 16 &&
      proof.tests.every((t) => t.count > 0 && hex(t.sha256)) &&
      proof.logs?.length > 16,
    "Incomplete native regression evidence",
  );
  for (const row of [...proof.tests, ...proof.logs]) {
    requireThat(
      relative(row.file) && !row.file.includes("/"),
      "Invalid original log name",
    );
    const ref = logs.get(
      prefix + "artifact-v2/files/sqlite-native/logs/" + row.file,
    );
    requireThat(
      ref?.sha256 === row.sha256,
      "Missing original native proof file",
    );
    readRef(ref, read);
  }
  requireThat(
    same(
      Object.keys(q.scripts ?? {}).sort(),
      Object.keys(policy.sqliteScriptPins).sort(),
    ),
    "Unexpected executable/source payload",
  );
  for (const [name, digest] of Object.entries(policy.sqliteScriptPins)) {
    requireThat(
      q.scripts?.[name]?.sha256 === digest,
      "SQLite checker/source pin changed",
    );
    readRef(q.scripts[name], read);
  }
  requireThat(
    proof.manifestSha256 === pins.manifestSha256 &&
      q.scripts["sqlite-runtime-sources.json"].sha256 === pins.manifestSha256,
    "SQLite source manifest changed",
  );
  for (const [key, pin] of [
    ["root", policy.baselineRootSha256],
    ["runtime", policy.baselineRuntimeSha256],
    ["availability", policy.availabilitySha256],
  ]) {
    requireThat(
      bindings.baseline[key].sha256 === pin,
      "Historical baseline pin changed",
    );
    readRef(bindings.baseline[key], read);
  }
  const operator = jsonRef(bindings.review.operatorSourceAcceptance, read);
  requireThat(
    operator.accepted === true &&
      operator.kind === "source-only-successor" &&
      operator.commit === s.commit &&
      operator.packageManifestSha256 ===
        bindings.review.operatorManifest?.sha256,
    "Independent successor source acceptance required",
  );
  const packageManifest = jsonRef(bindings.review.operatorManifest, read);
  requireThat(
    same(packageManifest.files, operatorFiles),
    "Executing source differs from independently accepted complete package",
  );
  const recovery = jsonRef(bindings.review.migrationRecoveryPlan, read);
  requireThat(
    recovery.commit === s.commit &&
      recovery.fromSchema === 110 &&
      recovery.toSchema === 111 &&
      recovery.accepted === true &&
      recovery.destructiveDownMigration === false &&
      recovery.oldApi67Or68Or69 === false &&
      recovery.revokedMandatesRevived === false &&
      recovery.exactRecoveryApi &&
      recovery.exactRecoveryWeb,
    "Reviewed tenant-aware schema111 recovery required",
  );
  requireThat(
    /^sha256:[a-f0-9]{64}$/.test(recovery.exactRecoveryApi) &&
      /^sha256:[a-f0-9]{64}$/.test(recovery.exactRecoveryWeb) &&
      recovery.compatibilityProofSha256 ===
        bindings.review.migrationCompatibilityProof?.sha256,
    "Recovery needs immutable targets and actual compatibility evidence",
  );
  const compatibility = jsonRef(
    bindings.review.migrationCompatibilityProof,
    read,
  );
  requireThat(
    compatibility.schema === 111 &&
      compatibility.apiDigest === recovery.exactRecoveryApi &&
      compatibility.webDigest === recovery.exactRecoveryWeb &&
      compatibility.actualDatabase === true &&
      compatibility.tenantWritesPreserved === true &&
      compatibility.revokedAuthorityRefused === true,
    "Unproven schema111 recovery compatibility",
  );
  verifyTree(compatibility.proofTree, read);
  for (const role of ["api", "web"]) {
    const baseline = bindings.baseline[role],
      oci = jsonRef(baseline.ociAcceptance, read);
    requireThat(
      oci.imageDigest === policy.roles[role].digest &&
        oci.completeContent === true &&
        oci.independentReview === true &&
        oci.accepted === true &&
        oci.proofTree,
      "Full accepted baseline OCI content required",
    );
    verifyTree(oci.proofTree, read);
    for (const key of ["config", "inventory", "nativeInventory"]) {
      requireThat(
        baseline[key]?.sha256 === policy.roles[role][key + "Sha256"],
        "Baseline content/config pin changed",
      );
      if (key === "inventory") completeInventoryRef(baseline[key], read);
      else jsonRef(baseline[key], read);
    }
  }
  return {
    commit: s.commit,
    tree: s.tree,
    sqliteProof: q.proof.sha256,
    artifact: q.imageDigest,
    scope: "PREPARATION_ONLY",
    rolloutAccepted: false,
  };
}
