import assert from "node:assert/strict";
import { sha } from "../production-native-successor-v1/contracts.mjs";
// Reused synthetic source-only admission fixture; never production evidence.
export function fixture() {
  const bytes = new Map();
  const put = (path, value) => {
    const b = Buffer.isBuffer(value)
      ? value
      : Buffer.from(JSON.stringify(value));
    bytes.set(path, b);
    return { path, sha256: sha(b), bytes: b.length };
  };
  const read = (path) => {
    assert.ok(bytes.has(path));
    return bytes.get(path);
  };
  const commit = "1".repeat(40),
    tree = "2".repeat(40),
    sqlite = "3".repeat(40),
    image = "sha256:" + "4".repeat(64);
  const migrations = Array.from({ length: 110 }, (_, i) => ({
    path: `m/${i.toString().padStart(3, "0")}/migration.sql`,
    sha256: sha(Buffer.from(String(i))),
  }));
  const next = [
    ...migrations,
    { path: "m/110/migration.sql", sha256: "a".repeat(64) },
  ];
  const files = {};
  for (const name of ["transaction.mjs", "contracts.mjs", "inventory.mjs"])
    files[name] = Buffer.from("// synthetic " + name);
  const operatorFiles = Object.entries(files).map(([path, b]) => ({
    path,
    sha256: sha(b),
    bytes: b.length,
  }));
  const policy = {
    purpose: "production-native-successor/v1",
    applicationAncestor: commit,
    sqliteAncestor: sqlite,
    baselineSource: "5".repeat(40),
    baselineMigrations: migrations,
    candidateMigrations: next,
    roles: {},
  };
  const s = {
    commit,
    tree,
    sourceLedger: put("source-ledger", { files: [] }),
    mainCiLog: put("ci-log", Buffer.from("synthetic CI")),
  };
  s.mergeReceipt = put("merge", {
    commit,
    tree,
    normalMerge: true,
    parents: [commit, sqlite],
  });
  s.privacyAcceptance = put("privacy", {
    accepted: true,
    commit,
    tree,
    ledgerSha256: s.sourceLedger.sha256,
  });
  s.mainCiReceipt = put("ci", {
    commit,
    tree,
    actualCheckout: commit,
    conclusion: "SUCCESS",
    complete: true,
    logSha256: s.mainCiLog.sha256,
    runId: "123",
    gates: Object.fromEntries(
      ["api", "web", "browser", "database", "privacy", "android"].map((g) => [
        g,
        "PASS",
      ]),
    ),
  });
  const q = {
    source: sqlite,
    buildId: "synthetic-build",
    imageDigest: image,
    logs: [],
    scripts: {},
  };
  for (const key of ["package", "library", "probe"])
    q[key] = put(key, Buffer.from("synthetic " + key));
  for (const name of [
    "check-sqlite-runtime.mjs",
    "fetch-sqlite-runtime-sources.mjs",
    "sqlite-runtime-sources.json",
  ])
    q.scripts[name] = put(name, Buffer.from("synthetic " + name));
  policy.sqliteScriptPins = Object.fromEntries(
    Object.entries(q.scripts).map(([n, r]) => [n, r.sha256]),
  );
  const logs = Array.from({ length: 17 }, (_, i) => {
    const file = `log${i}`;
    const ref = put(
      "artifact-v2/files/sqlite-native/logs/" + file,
      Buffer.from(i === 16 ? "" : "synthetic log " + i),
    );
    q.logs.push(ref);
    return { file, sha256: ref.sha256 };
  });
  const proof = {
    sourceCommit: sqlite,
    packageSha256: q.package.sha256,
    librarySha256: q.library.sha256,
    probeSha256: q.probe.sha256,
    manifestSha256: q.scripts["sqlite-runtime-sources.json"].sha256,
    logs,
    tests: logs.slice(0, 16).map((r) => ({ ...r, count: 1 })),
  };
  q.proof = put("proof", proof);
  q.evidence = [put("original-log", Buffer.from("synthetic original"))];
  const acceptance = {
    source: sqlite,
    buildId: q.buildId,
    artifactImage: "synthetic@" + image,
    standaloneNativeProofAccepted: true,
    rootIndependentlyVerifiedAllContent: true,
    rootIndependentlyParsedElf: true,
    honestPackageInspection: true,
    proofSha256: q.proof.sha256,
    packageSha256: q.package.sha256,
    librarySha256: q.library.sha256,
    probeSha256: q.probe.sha256,
    evidenceSha256: { "original-log": q.evidence[0].sha256 },
  };
  q.acceptance = put("acceptance", acceptance);
  policy.sqliteAccepted = {
    ...acceptance,
    acceptanceSha256: q.acceptance.sha256,
    manifestSha256: proof.manifestSha256,
  };
  const baseline = {};
  for (const key of ["root", "runtime", "availability"])
    baseline[key] = put("baseline-" + key, { synthetic: key });
  policy.baselineRootSha256 = baseline.root.sha256;
  policy.baselineRuntimeSha256 = baseline.runtime.sha256;
  policy.availabilitySha256 = baseline.availability.sha256;
  const proofTree = put("tree", {
    files: [put("synthetic-evidence", Buffer.from("evidence"))],
  });
  for (const role of ["api", "web"]) {
    const r = {
      config: put(role + "-config", {
        os: "linux",
        architecture: "amd64",
        config: role === "web" ? { User: "nextjs" } : {},
      }),
      inventory: put(role + "-inventory", []),
      nativeInventory: put(role + "-native", []),
      ociAcceptance: put(role + "-oci", {
        imageDigest: image,
        completeContent: true,
        independentReview: true,
        accepted: true,
        proofTree,
      }),
    };
    baseline[role] = r;
    policy.roles[role] = {
      digest: image,
      image: `051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-${role}@${image}`,
      configSha256: r.config.sha256,
      inventorySha256: r.inventory.sha256,
      nativeInventorySha256: r.nativeInventory.sha256,
      tools: [],
    };
  }
  const review = {
    operatorManifest: put("operator-manifest", { files: operatorFiles }),
  };
  review.operatorSourceAcceptance = put("operator-accept", {
    accepted: true,
    kind: "source-only-successor",
    commit,
    packageManifestSha256: review.operatorManifest.sha256,
  });
  review.migrationCompatibilityProof = put("compatibility", {
    schema: 111,
    apiDigest: image,
    webDigest: image,
    actualDatabase: true,
    tenantWritesPreserved: true,
    revokedAuthorityRefused: true,
    proofTree,
  });
  review.migrationRecoveryPlan = put("recovery", {
    commit,
    fromSchema: 110,
    toSchema: 111,
    accepted: true,
    destructiveDownMigration: false,
    oldApi67Or68Or69: false,
    revokedMandatesRevived: false,
    exactRecoveryApi: image,
    exactRecoveryWeb: image,
    compatibilityProofSha256: review.migrationCompatibilityProof.sha256,
  });
  const bindings = {
    schemaVersion: 1,
    purpose: policy.purpose,
    source: s,
    sqlite: q,
    baseline,
    review,
  };
  const io = {
    read,
    source: {
      tree: () => tree,
      contains: () => true,
      parents: () => [commit, sqlite],
      changes: () => [],
      migrations: (r) => (r === policy.baselineSource ? migrations : next),
    },
    operatorFiles,
    operatorRead: (name) => files[name],
  };
  return { bindings, policy, io, put, bytes };
}
