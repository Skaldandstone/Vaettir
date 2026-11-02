import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  existsSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  sha,
  admitPreparation,
  readRef,
  verifyMigrations,
} from "./contracts.mjs";
import { prepareContext, recipe } from "./overlay-context.mjs";
import {
  exactDelta,
  verifyOverlay,
  verifyConsumers,
  verifyPackageState,
} from "./inventory.mjs";
import {
  observeTransaction,
  checkBaseline,
  STAGE,
  OUTPUT,
} from "./transaction.mjs";
import { fileReader, writeExclusiveContext } from "./offline-io.mjs";
import {
  verifyOciByteLinks,
  remainingGates,
  finalNativeEvidence,
} from "./release-gates.mjs";

test("final main head may follow the verified two-parent merge", () => {
  const f = fixture(),
    merge = "6".repeat(40),
    tree = "7".repeat(40),
    finalTree = f.bindings.source.tree;
  f.bindings.source.mergeReceipt = f.put("later-merge", {
    commit: merge,
    tree,
    normalMerge: true,
    parents: ["1".repeat(40), "3".repeat(40)],
  });
  f.io.source.tree = (r) => (r === merge ? tree : finalTree);
  assert.equal(
    admitPreparation(f.bindings, f.policy, f.io).rolloutAccepted,
    false,
  );
});

test("native gate refuses absent actual NSS evidence even after complete native inventory", () => {
  const f = fixture(),
    hash = f.policy.sqliteAccepted.librarySha256,
    path = "usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6";
  const before = [{ path, sha256: "b".repeat(64) }],
    after = [{ path, sha256: hash }];
  const consumer = {
    path: "/lib/consumer",
    sha256: "c".repeat(64),
    undefinedSQLiteSymbols: ["sqlite3_open"],
    dynamicSQLiteSymbols: [],
  };
  f.policy.sqliteConsumers = [{ ...consumer, images: ["api"] }];
  f.policy.sqliteCandidateExports = ["sqlite3_open"];
  const pkg = {
    name: "libsqlite3-0:amd64",
    status: "install ok installed",
    version: "3.54.1-0+vaettir1",
    dependencies: ["libc6"],
  };
  const packages = {
    packages: [pkg],
    loader: [
      {
        key: "sqlite",
        soname: "libsqlite3.so.0",
        path: "/lib/libsqlite3.so.0",
        sha256: hash,
      },
    ],
    audit: "",
    pendingTriggers: [],
    updates: [],
    transactionLockHeld: false,
  };
  const refs = {
    nativeBefore: f.put("nb", before),
    nativeAfter: f.put("na", after),
    consumerInventory: f.put("consumers", [consumer]),
    expectedConsumers: f.put("expected", [consumer]),
    packagesBefore: f.put("pb", packages),
    packagesAfter: f.put("pa", packages),
  };
  f.policy.roles.api.nativeInventorySha256 = refs.nativeBefore.sha256;
  f.policy.roles.api.nssVersion = "synthetic-u4";
  const audit = {
    role: "api",
    parentDigest: f.policy.roles.api.digest,
    imageDigest: f.policy.roles.api.digest,
    proofTree: f.put("native-proof-tree", {
      files: [f.put("native-log", Buffer.from("synthetic"))],
    }),
    discovery: {
      completeFilesystem: true,
      dynamicLookupsReviewed: true,
      noPrefixOnlyFilter: true,
      inventorySha256: refs.consumerInventory.sha256,
    },
    sqliteNativeRow: after[0],
    evidenceSha256: Object.fromEntries(
      Object.entries(refs).map(([k, r]) => [k, r.sha256]),
    ),
  };
  refs.audit = f.put("native-audit", audit);
  refs.acceptance = f.put("native-accept", {
    independentReview: true,
    accepted: true,
    auditSha256: refs.audit.sha256,
    expectedConsumersSha256: refs.expectedConsumers.sha256,
  });
  assert.throws(
    () => finalNativeEvidence(refs, f.policy, "api", f.io.read),
    /artifact pin/,
  );
  // Even a separately reviewed empty set cannot waive the original consumer.
  refs.expectedConsumers = f.put("empty", []);
  assert.throws(() => finalNativeEvidence(refs, f.policy, "api", f.io.read));
});

// Every fixture in this file is synthetic. No production receipt is fabricated,
// no native tool is invoked, and no real app/database/OCI behavior is inferred.
function fixture() {
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

test("complete synthetic inputs produce a separately gated evidence-only context", () => {
  const f = fixture(),
    result = admitPreparation(f.bindings, f.policy, f.io);
  assert.equal(result.rolloutAccepted, false);
  const api = prepareContext(f.bindings, f.policy, "api", f.io),
    web = prepareContext(f.bindings, f.policy, "web", f.io);
  assert.doesNotMatch(api.Dockerfile.toString(), /USER/);
  assert.match(web.Dockerfile.toString(), /USER root[\s\S]*USER nextjs/);
  assert.match(api.Dockerfile.toString(), /RUN --network=none/);
  assert.match(api.Dockerfile.toString(), /FROM scratch AS evidence_only/);
  assert.equal(
    JSON.parse(api["transaction-input.json"]).acceptedLibrarySha256,
    f.bindings.sqlite.library.sha256,
  );
});
for (const [name, change] of [
  ["null final commit", (f) => (f.bindings.source.commit = null)],
  ["wrong final tree", (f) => (f.bindings.source.tree = "a".repeat(40))],
  ["missing reviewed ancestor", (f) => (f.io.source.contains = () => false)],
  [
    "source ledger differs",
    (f) => (f.io.source.changes = () => [{ path: "unknown" }]),
  ],
  [
    "changed accepted package bytes",
    (f) => f.bytes.set("package", Buffer.from("changed")),
  ],
  [
    "acceptance hash drift",
    (f) => (f.policy.sqliteAccepted.acceptanceSha256 = "a".repeat(64)),
  ],
  ["missing original native log", (f) => f.bindings.sqlite.logs.pop()],
  [
    "missing independent artifact evidence",
    (f) => (f.bindings.sqlite.evidence = []),
  ],
  [
    "SQLite checker changed",
    (f) => f.bytes.set("check-sqlite-runtime.mjs", Buffer.from("changed")),
  ],
  [
    "executing operator code changed",
    (f) => (f.io.operatorFiles[0].sha256 = "a".repeat(64)),
  ],
  [
    "baseline inventory drift",
    (f) => f.bytes.set("api-inventory", Buffer.from("[1]")),
  ],
  [
    "missing migration compatibility",
    (f) => (f.bindings.review.migrationCompatibilityProof = null),
  ],
  [
    "main CI pending",
    (f) =>
      (f.bindings.source.mainCiReceipt = f.put("pending", {
        conclusion: "PENDING",
      })),
  ],
  [
    "privacy acceptance missing",
    (f) => (f.bindings.source.privacyAcceptance = null),
  ],
  [
    "extra unreviewed staged executable",
    (f) =>
      (f.bindings.sqlite.scripts["transaction.mjs"] = f.put(
        "evil",
        Buffer.from("unreviewed"),
      )),
  ],
  [
    "unreviewed migration",
    (f) => (f.policy.candidateMigrations[110].sha256 = "b".repeat(64)),
  ],
])
  test("admission refuses " + name, () => {
    const f = fixture();
    if (name === "unreviewed migration") f.io.source.migrations = () => [];
    change(f);
    assert.throws(() => prepareContext(f.bindings, f.policy, "api", f.io));
  });
test("empty original native logs remain hash-bound", () => {
  const f = fixture();
  assert.equal(readRef(f.bindings.sqlite.logs[16], f.io.read).length, 0);
});
test("artifact references reject traversal and unbounded sizes", () => {
  for (const path of ["../x", "/x", "a\\b", "C:x", "a//b"])
    assert.throws(() =>
      readRef({ path, sha256: "a".repeat(64), bytes: 1 }, () =>
        Buffer.from("x"),
      ),
    );
  assert.throws(() =>
    readRef({ path: "x", sha256: "a".repeat(64), bytes: Infinity }, () =>
      Buffer.alloc(0),
    ),
  );
});
test("existing migration modification is terminal", () => {
  const f = fixture(),
    before = structuredClone(f.policy.baselineMigrations),
    after = structuredClone(f.policy.candidateMigrations);
  after[0].sha256 = "0".repeat(64);
  assert.throws(() => verifyMigrations(before, after, f.policy));
});
test("unsafe USER and tag-only parent refused", () => {
  assert.throws(() => recipe("web", "image:latest", "nextjs"));
  assert.throws(() =>
    recipe("web", fixture().policy.roles.web.image, "nextjs\nRUN x"),
  );
});
test("NSS tool stays in scratch tool stage and internal read-only BuildKit mount", () => {
  const text = recipe("api", fixture().policy.roles.api.image, undefined, true);
  assert.match(text, /FROM scratch AS nss_test_tool/);
  assert.match(
    text,
    /from=nss_test_tool,source=\/,target=\/run\/vaettir-nss,ro/,
  );
  const runtimeCopy = text
    .split("\n")
    .find((line) => line.startsWith('COPY ["transaction.mjs"'));
  assert.ok(runtimeCopy);
  assert.doesNotMatch(runtimeCopy, /certutil|nss-fixture/);
  assert.doesNotMatch(text, /COPY \.|apt|host\.docker/);
});
test("runtime NSS role refuses a missing separately reviewed fixture", () => {
  const f = fixture();
  f.policy.roles.api.nssVersion = "2:3.110-1+deb13u4";
  assert.throws(() => prepareContext(f.bindings, f.policy, "api", f.io));
});
test("both runtime recipes transport only the pinned probe with executable mode", () => {
  for (const role of ["api", "web"]) {
    const text = recipe(
      role,
      fixture().policy.roles[role].image,
      role === "web" ? "nextjs" : undefined,
    );
    const lines = text.split("\n"),
      copies = lines.filter((line) => line.startsWith("COPY --chmod="));
    assert.deepEqual(copies, [
      `COPY --chmod=0555 ["sqlite-runtime-regression", "${STAGE}/sqlite-runtime-regression"]`,
    ]);
    assert.ok(
      lines.indexOf(copies[0]) <
        lines.findIndex((line) => line.startsWith("RUN ")),
    );
    const generic = JSON.parse(
      lines.find((line) => line.startsWith('COPY ["transaction.mjs"')).slice(5),
    );
    assert.ok(!generic.includes("sqlite-runtime-regression"));
    assert.ok(
      generic.includes("sqlite.deb") &&
        generic.includes("sqlite-runtime-proof.json"),
    );
  }
});
test("reviewed NSS input is bound without copying its tool into the runtime stage", () => {
  const f = fixture(),
    binary = f.put("certutil", Buffer.from("synthetic NSS tool")),
    probe = f.put("nss-probe", Buffer.from("synthetic fixture"));
  f.policy.roles.api.nssVersion = "synthetic-u4";
  const pins = f.put("tool-pins", {
    certutilSha256: binary.sha256,
    certutilSize: binary.bytes,
    packageVersion: "synthetic-u4",
  });
  f.policy.nssTool = { pinsSha256: pins.sha256, certutilSha256: binary.sha256 };
  f.bindings.nssTool = {
    pins,
    binary,
    fixture: probe,
    acceptance: f.put("tool-review", {
      accepted: true,
      sourceReviewed: true,
      protocol: "empty-store-loader-proof/v1",
      toolPinsSha256: pins.sha256,
      fixtureSha256: probe.sha256,
      externalReadOnly: true,
      installedOrShipped: false,
    }),
  };
  const files = prepareContext(f.bindings, f.policy, "api", f.io),
    input = JSON.parse(files["transaction-input.json"]);
  assert.equal(input.nss.toolSha256, binary.sha256);
  assert.ok(files.certutil);
  assert.ok(!input.files.some((r) => r.path === "certutil"));
  const copy = files.Dockerfile.toString()
    .split("\n")
    .find((r) => r.startsWith('COPY ["transaction.mjs"'));
  const paths = JSON.parse(copy.slice(5));
  paths.pop();
  const probeCopy = files.Dockerfile.toString()
    .split("\n")
    .find((r) =>
      r.startsWith('COPY --chmod=0555 ["sqlite-runtime-regression"'),
    );
  paths.push(
    ...JSON.parse(probeCopy.slice("COPY --chmod=0555 ".length)).slice(0, -1),
  );
  assert.deepEqual(
    paths.sort(),
    [...input.files.map((r) => r.path), "transaction-input.json"].sort(),
  );
});

const file = (path, content = "old") => ({
  path,
  type: "file",
  mode: 0o644,
  uid: 0,
  gid: 0,
  bytes: content.length,
  sha256: sha(Buffer.from(content)),
});
function observationFixture(failInstall = false) {
  const lib = "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6",
    before = [file(lib)],
    after = [file(lib, "new")],
    calls = [];
  const input = {
    schemaVersion: 1,
    role: "api",
    stageRoot: STAGE,
    observationRoot: OUTPUT,
    base: { tools: [] },
    admission: { scope: "SYNTHETIC" },
    acceptedLibrarySha256: after[0].sha256,
  };
  let snapshots = 0;
  const io = {
    baseline: [
      {
        path: lib.slice(1),
        type: "0",
        mode: 0o644,
        size: 3,
        sha256: before[0].sha256,
      },
    ],
    snapshot: () => (snapshots++ === 0 ? before : after),
    list: () => [],
    run: (exe, args) => {
      calls.push([exe, args]);
      const install = exe === "/usr/bin/dpkg" && args[0] === "--install";
      let stdout = "";
      if (exe === "/usr/bin/dpkg-query" && args[0] === "-W")
        stdout =
          "libsqlite3-0:amd64\tinstall ok installed\told\tamd64\tlibc6\t\t\t\n";
      return {
        status: install && failInstall ? null : 0,
        signal: install && failInstall ? "SIGTERM" : null,
        error: install && failInstall ? "timed out" : null,
        stdout,
        stderr: "",
      };
    },
  };
  return { input, io, calls, before, after };
}
test("collector executes one install and both actual checker modes through delegated runner", () => {
  const f = observationFixture(),
    r = observeTransaction(f.input, f.io);
  assert.equal(r.nativeCommandsPassed, true);
  assert.equal(r.releaseAccepted, false);
  assert.equal(r.consumerDiscoveryComplete, false);
  assert.equal(
    f.calls.filter(([e, a]) => e === "/usr/bin/dpkg" && a[0] === "--install")
      .length,
    1,
  );
  assert.ok(f.calls.some(([, a]) => a[1] === "--installed"));
  assert.ok(f.calls.some(([, a]) => a[1] === "--consumers"));
  assert.equal(r.changes.length, 1);
});
test("ambiguous install preserves after-evidence, no retry/checker/repair/cleanup", () => {
  const f = observationFixture(true),
    r = observeTransaction(f.input, f.io);
  assert.equal(r.nativeCommandsPassed, false);
  assert.equal(r.observationComplete, true);
  assert.equal(r.installAttempted, true);
  assert.equal(
    f.calls.filter(([e, a]) => e === "/usr/bin/dpkg" && a[0] === "--install")
      .length,
    1,
  );
  assert.ok(!f.calls.some(([e]) => e === "/usr/local/bin/node"));
});
test("unrelated baseline change stops all native commands", () => {
  const f = observationFixture();
  f.io.baseline[0].sha256 = "a".repeat(64);
  const r = observeTransaction(f.input, f.io);
  assert.equal(r.installAttempted, false);
  assert.equal(f.calls.length, 0);
  assert.ok(r.error);
});
test("new pre-install file or altered symlink refused", () => {
  const f = observationFixture();
  assert.throws(() =>
    checkBaseline([...f.before, file("/unexpected")], f.io.baseline),
  );
  assert.throws(() =>
    checkBaseline(
      [
        {
          path: "/bin",
          type: "symlink",
          mode: 511,
          uid: 0,
          gid: 0,
          target: "evil",
        },
      ],
      [{ path: "bin", type: "2", mode: 511, link: "usr/bin" }],
    ),
  );
});
test("review must match complete observed delta, without unrelated exceptions", () => {
  const f = observationFixture(),
    policy = {
      sqlitePayloadPaths: [f.before[0].path],
      sqliteProofPaths: [],
      sqliteAccepted: { librarySha256: f.after[0].sha256 },
    },
    changes = exactDelta(f.before, f.after);
  const review = {
    accepted: true,
    independentReview: true,
    scope: "SQLITE_TRANSACTION_ONLY",
    observedTransactionSha256: "a".repeat(64),
    changes,
    categories: { [f.before[0].path]: "sqlite-payload" },
  };
  assert.equal(verifyOverlay(f.before, f.after, review, policy).length, 1);
  assert.throws(() =>
    verifyOverlay(
      f.before,
      [...f.after, file("/usr/bin/sh", "bad")],
      review,
      policy,
    ),
  );
  review.categories["/var/lib/dpkg/*"] = "dpkg-transaction";
  assert.throws(() => verifyOverlay(f.before, f.after, review, policy));
});
test("a reviewed ledger cannot accept a different library", () => {
  const f = observationFixture(),
    policy = {
      sqlitePayloadPaths: [f.before[0].path],
      sqliteAccepted: { librarySha256: "a".repeat(64) },
    };
  assert.throws(() =>
    verifyOverlay(
      f.before,
      f.after,
      {
        accepted: true,
        independentReview: true,
        scope: "SQLITE_TRANSACTION_ONLY",
        observedTransactionSha256: "a".repeat(64),
        changes: exactDelta(f.before, f.after),
        categories: { [f.before[0].path]: "sqlite-payload" },
      },
      policy,
    ),
  );
});
test("complete consumer set and explicit dynamic lookup closure required", () => {
  const rows = [
    {
      path: "/lib/consumer",
      sha256: "a".repeat(64),
      undefinedSQLiteSymbols: ["sqlite3_open"],
      dynamicSQLiteSymbols: [],
    },
  ];
  assert.equal(verifyConsumers(rows, rows), true);
  assert.throws(() =>
    verifyConsumers([...rows, { ...rows[0], path: "/lib/new" }], rows),
  );
  assert.throws(() =>
    verifyConsumers(
      [{ ...rows[0], dynamicSQLiteSymbols: undefined }],
      [{ ...rows[0], dynamicSQLiteSymbols: undefined }],
    ),
  );
});
test("unrelated package/dependency/loader drift and dirty transactions refused", () => {
  const row = {
    name: "libsqlite3-0:amd64",
    status: "install ok installed",
    version: "old",
    dependencies: ["libc6"],
  };
  const before = {
    packages: [row, { name: "libnss3", version: "u4" }],
    loader: [
      {
        key: "sqlite-amd64",
        soname: "libsqlite3.so.0",
        path: "/lib/libsqlite3.so.0",
        sha256: "b".repeat(64),
      },
    ],
  };
  const after = {
    packages: [{ ...row, version: "3.54.1-0+vaettir1" }, before.packages[1]],
    loader: [{ ...before.loader[0], sha256: "a".repeat(64) }],
    audit: "",
    pendingTriggers: [],
    updates: [],
    transactionLockHeld: false,
  };
  assert.equal(verifyPackageState(before, after, "a".repeat(64)), true);
  for (const mutate of [
    (r) => (r.packages[1].version = "u5"),
    (r) => (r.packages[0].dependencies = []),
    (r) => (r.loader[0].path = "/wrong"),
    (r) => (r.pendingTriggers = ["ldconfig"]),
  ]) {
    const bad = structuredClone(after);
    mutate(bad);
    assert.throws(() => verifyPackageState(before, bad, "a".repeat(64)));
  }
});
test("ordered OCI bytes and same-daemon linkage do not claim full OCI acceptance", () => {
  const f = fixture(),
    compressed = f.put("compressed", Buffer.from("synthetic compressed")),
    uncompressed = f.put("tar", Buffer.from("synthetic tar"));
  const config = f.put("config", {
      rootfs: { diff_ids: ["sha256:" + uncompressed.sha256] },
    }),
    manifest = f.put("manifest", {
      config: { digest: "sha256:" + config.sha256, size: config.bytes },
      layers: [
        { digest: "sha256:" + compressed.sha256, size: compressed.bytes },
      ],
    });
  const observations = ["pull", "load", "export", "inspect"].map(
    (operation) => ({
      operation,
      daemonId: "synthetic-daemon",
      exitCode: 0,
      imageDigest: "sha256:" + manifest.sha256,
      retainedStdin: "",
      stdinSha256: sha(Buffer.alloc(0)),
      timeoutMs: 1000,
    }),
  );
  const input = {
    manifest,
    config,
    layers: [{ compressed, uncompressed }],
    observations,
  };
  assert.equal(
    verifyOciByteLinks(input, f.io.read).completeOciAcceptance,
    false,
  );
  observations[2].daemonId = "different";
  assert.throws(() => verifyOciByteLinks(input, f.io.read));
});
test("all downstream runtime, NSS, hosted, provider and migration gates remain explicit", () => {
  for (const token of [
    "nss",
    "oci",
    "schema111",
    "hosted",
    "provider",
    "security",
  ])
    assert.ok(remainingGates.some((g) => g.includes(token)));
});

test("real CLI with null final bindings creates no output and invokes no native tools", () => {
  const directory = dirname(fileURLToPath(import.meta.url)),
    temp = mkdtempSync(join(tmpdir(), "vaettir-successor-test-"));
  try {
    const output = join(temp, "must-not-exist");
    const result = spawnSync(
      process.execPath,
      [
        join(directory, "overlay-context.mjs"),
        join(directory, "bindings.template.json"),
        temp,
        temp,
        "api",
        output,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not accepted yet/);
    assert.equal(existsSync(output), false);
    const r = fileReader(temp);
    writeFileSync(join(temp, "x"), "abc");
    assert.equal(r("x", 3).toString(), "abc");
    assert.throws(() => r("x", 2));
    assert.equal(
      r.verify({ path: "x", bytes: 3, sha256: sha(Buffer.from("abc")) }),
      true,
    );
    assert.throws(() =>
      r.verify({ path: "x", bytes: 3, sha256: "a".repeat(64) }),
    );
    const context = join(temp, "exclusive");
    writeExclusiveContext(context, { Dockerfile: Buffer.from("synthetic") });
    assert.throws(() =>
      writeExclusiveContext(context, { Dockerfile: Buffer.from("overwrite") }),
    );
    assert.equal(
      readFileSync(join(context, "Dockerfile"), "utf8"),
      "synthetic",
    );
  } finally {
    assert.ok(resolve(temp).startsWith(resolve(tmpdir())));
    rmSync(temp, { recursive: true });
  }
});
