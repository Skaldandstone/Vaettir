// Pure byte/VM/shell-syntax fixtures only. No AWS, Git, Docker or native build.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Script, createContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import {
  planNativeFreshPrepare,
  validateNativeFreshPrepareCompleted,
  FRESH_NATIVE_SCRIPT_LF_HASHES,
  unpackFreshPrepareOperation,
} from "./native-builder-fresh-prepare.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (value) => Buffer.from(JSON.stringify(value) + "\n");
const commit = "ed84409ab6b4c6f4f85b59dccc1d3357d81c22ad";
const names = [...Object.keys(FRESH_NATIVE_SCRIPT_LF_HASHES), "Dockerfile.api"];
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
function zip(entries, sourceCommit = commit, modes = {}) {
  const local = [],
    central = [];
  let position = 0;
  const records = Array.isArray(entries) ? entries : Object.entries(entries);
  for (const [name, bytes] of records) {
    const nameBytes = Buffer.from(name),
      header = Buffer.alloc(30),
      dir = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(bytes), 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    dir.writeUInt32LE(0x02014b50);
    dir.writeUInt16LE(0x0314, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc32(bytes), 16);
    dir.writeUInt32LE(bytes.length, 20);
    dir.writeUInt32LE(bytes.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE((parseInt(modes[name] ?? "100644", 8) * 65536) >>> 0, 38);
    dir.writeUInt32LE(position, 42);
    local.push(header, nameBytes, bytes);
    central.push(dir, nameBytes);
    position += header.length + nameBytes.length + bytes.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22),
    comment = Buffer.from(sourceCommit);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(position, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...local, directory, end, comment]);
}
function options({ eol = false, sourceCommit = commit } = {}) {
  const gitBlobs = {},
    gitExports = {},
    gitModes = {},
    entries = {};
  for (const name of names) {
    const path = name === "Dockerfile.api" ? name : "scripts/" + name;
    const bytes = Buffer.from(
      readFileSync(new URL("../" + path, import.meta.url))
        .toString("utf8")
        .replaceAll("\r\n", "\n"),
    );
    gitBlobs[name] = bytes;
    gitModes[name] = "100644";
    const exported =
      eol && name.endsWith(".mjs")
        ? Buffer.from(bytes.toString().replace(/(?<!\r)\n/g, "\r\n"))
        : bytes;
    entries[path] = exported;
    gitExports[name] =
      name === "Dockerfile.api"
        ? exported
        : zip({ [path]: exported }, sourceCommit);
  }
  const archive = zip(entries, sourceCommit);
  return {
    sourceCommit,
    archive,
    archiveSha256: hash(archive),
    gitBlobs,
    gitExports,
    gitModes,
    budget: {
      mode: "bounded-probe",
      prepareSeconds: 1785,
      verificationSeconds: 240,
      pushSeconds: 180,
      totalSeconds: 2520,
    },
  };
}
function receipt() {
  const inventory = { sha256: "a".repeat(64), entries: 10, bytes: 10000 };
  const inputs = {
    scripts: { ...inventory, entries: 9 },
    signedSources: { ...inventory },
    source: { ...inventory },
    toolchain: {
      compilerSha256: "b".repeat(64),
      compiler: "Debian clang version 19.1.7 (3+b1)\n",
      compilerPackage: "1:19.1.7-3+b1",
      installedPackagesSha256: "c".repeat(64),
    },
    baselineSha256: "d".repeat(64),
    configuration: [
      { cache: "e".repeat(64), commands: "f".repeat(64) },
      { cache: "1".repeat(64), commands: "2".repeat(64) },
    ],
    assertionPlanSha256: "3".repeat(64),
  };
  return {
    schemaVersion: 1,
    purpose: "llvm-builder-checkpoint-not-runtime",
    phase: "prepare",
    predecessorSha256: null,
    inputs,
    inputsSha256: hash(JSON.stringify(inputs)),
    state: { release: { ...inventory }, assertions: { ...inventory } },
    proof: {},
    unitAcceptance: false,
    packageAcceptance: false,
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
    deploymentAcceptance: false,
  };
}
function proof(plan, r = receipt()) {
  const bytes = encode(r);
  return {
    schemaVersion: 1,
    purpose: "fresh-native-prepare-actual-state",
    planSha256: plan.planSha256,
    sourceCommit: plan.identity.sourceCommit,
    sourceSha256: plan.identity.sourceSha256,
    receiptSha256: hash(bytes),
    receiptBase64: bytes.toString("base64"),
    inputsSha256: r.inputsSha256,
    sourceManifestSha256: hash("source manifest"),
    actualStateVerified: true,
    compiledAcceptance: false,
    unitAcceptance: false,
    packageAcceptance: false,
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
    deploymentAcceptance: false,
  };
}
function completedFixture(plan = planNativeFreshPrepare(options())) {
  const labels = {
    "vaettir.source-commit": plan.identity.sourceCommit,
    "vaettir.source-sha256": plan.identity.sourceSha256,
    "vaettir.prepare-plan": plan.planSha256,
    "vaettir.runtime-eligible": "false",
    "vaettir.artifact-purpose": "llvm-builder-checkpoint",
  };
  const config = encode({
    os: "linux",
    architecture: "amd64",
    config: { Labels: labels },
    rootfs: { type: "layers", diff_ids: ["sha256:" + "4".repeat(64)] },
  });
  const imageConfigDigest = "sha256:" + hash(config);
  const manifest = JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    config: { digest: imageConfigDigest },
    layers: [{ digest: "sha256:" + "5".repeat(64), size: 1000 }],
  });
  const imageDigest = "sha256:" + hash(manifest),
    p = {
      ...proof(plan),
      imageDigest,
      imageConfigDigest,
      imageSizeBytes: 123456,
      prePushInspection: true,
      digestPullEvidence: false,
    };
  const expected = {
    buildId: "vaettir-api-build:11111111-2222-3333-4444-555555555555",
    planSha256: plan.planSha256,
    requestSha256: plan.requestSha256,
    buildspecSha256: plan.buildspecSha256,
    imageDigest,
    imageConfigDigest,
    receiptSha256: p.receiptSha256,
  };
  const completed = {
    schemaVersion: 1,
    purpose: "completed-fresh-native-prepare",
    status: "SUCCEEDED",
    ...expected,
    sourceCommit: plan.identity.sourceCommit,
    sourceSha256: plan.identity.sourceSha256,
    proof: p,
    registryManifest: {
      failures: [],
      images: [
        {
          imageId: { imageDigest, imageTag: plan.candidateTag },
          imageManifest: manifest,
        },
      ],
    },
    registryConfigBase64: config.toString("base64"),
    compiledAcceptance: false,
    unitAcceptance: false,
    packageAcceptance: false,
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
    deploymentAcceptance: false,
  };
  return { plan, completed, expected, labels };
}

test("fresh exact native source produces deterministic existing-project request without dispatch", () => {
  const one = planNativeFreshPrepare(options()),
    two = planNativeFreshPrepare(options());
  assert.deepEqual(one, two);
  assert.equal(one.identity.sourceCommit, commit);
  assert.equal(one.identity.predecessorSha256, null);
  assert.equal(one.request.projectName, "vaettir-api-build");
  assert.equal(one.request.computeTypeOverride, "BUILD_GENERAL1_LARGE");
  assert.equal(one.request.timeoutInMinutesOverride, 45);
  assert.equal(one.request.autoRetryLimitOverride, 0);
  assert.equal(one.requestSha256, hash(JSON.stringify(one.request)));
  assert.equal(one.buildspecSha256, hash(one.request.buildspecOverride));
  assert.equal(one.receiptExpectation.hashKnownBeforeBuild, false);
  assert.equal(one.dispatchRequiresRootPreflight, true);
  for (const key of [
    "compiledAcceptance",
    "unitAcceptance",
    "packageAcceptance",
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
    "defaultRuntimeGraphChanged",
    "forecastAcceptance",
  ])
    assert.equal(one[key], false);
});
test("later exact product commit is accepted only with identical reviewed native content", () => {
  const next = planNativeFreshPrepare(
    options({ sourceCommit: "a".repeat(40) }),
  );
  assert.equal(next.identity.sourceCommit, "a".repeat(40));
  assert.notEqual(
    next.planSha256,
    planNativeFreshPrepare(options()).planSha256,
  );
  assert.throws(
    () =>
      planNativeFreshPrepare(
        options({ sourceCommit: "d3a952c5c3c407cba306f4da3de4a0cac2e0908e" }),
      ),
    /Old prepared/,
  );
});
test("canonical exported CRLF bytes remain pinned; normalization is not an artifact identity", () => {
  const plan = planNativeFreshPrepare(options({ eol: true }));
  assert.equal(
    plan.identity.sourceBindings["native-llvm-checkpoint.mjs"].transform,
    "git-export-lf-to-crlf",
  );
  assert.notEqual(
    plan.identity.expectedScripts["native-llvm-checkpoint.mjs"],
    FRESH_NATIVE_SCRIPT_LF_HASHES["native-llvm-checkpoint.mjs"],
  );
  const bad = options({ eol: true });
  bad.gitExports["native-llvm-checkpoint.mjs"] = zip({
    "scripts/native-llvm-checkpoint.mjs":
      bad.gitBlobs["native-llvm-checkpoint.mjs"],
  });
  assert.throws(() => planNativeFreshPrepare(bad), /deterministic Git export/);
});
test("wrong ZIP hash/comment, unknown fields and command callbacks are refused", () => {
  for (const alter of [
    (x) => {
      x.archiveSha256 = "0".repeat(64);
    },
    (x) => {
      x.sourceCommit = "b".repeat(40);
    },
    (x) => {
      x.phase = "release-core";
    },
    (x) => {
      x.gitBlobs = () => {};
    },
    (x) => {
      x.gitExports["check-llvm-jit.c"] = () => {};
    },
    (x) => {
      x.gitExports["check-llvm-jit.c"] = Buffer.alloc(2 * 1024 * 1024 + 1);
    },
    (x) => {
      x.gitModes["native-llvm-checkpoint.mjs"] = "120000";
    },
  ]) {
    const x = options();
    alter(x);
    assert.throws(() => planNativeFreshPrepare(x));
  }
});
test("modified script, unreviewed Dockerfile and archived Dockerfile substitution are refused", () => {
  const modified = options();
  modified.gitBlobs["native-llvm-checkpoint.mjs"] =
    Buffer.from("fake checkpoint");
  assert.throws(() => planNativeFreshPrepare(modified));
  const changed = options();
  changed.gitBlobs["Dockerfile.api"] = Buffer.from("FROM scratch\n");
  assert.throws(() => planNativeFreshPrepare(changed));
  const bad = options(),
    entries = Object.fromEntries(
      names.map((n) => [
        n === "Dockerfile.api" ? n : "scripts/" + n,
        bad.gitBlobs[n],
      ]),
    );
  entries["Dockerfile.api"] = Buffer.from("FROM scratch\n");
  bad.archive = zip(entries);
  bad.archiveSha256 = hash(bad.archive);
  assert.throws(() => planNativeFreshPrepare(bad), /Dockerfile/);
});
test("ZIP traversal, duplicate paths, missing Dockerfile and symlink modes fail closed", () => {
  for (const kind of ["traversal", "missing", "symlink"]) {
    const x = options(),
      entries = Object.fromEntries(
        names.map((n) => [
          n === "Dockerfile.api" ? n : "scripts/" + n,
          x.gitBlobs[n],
        ]),
      );
    if (kind === "traversal") entries["../evil"] = Buffer.from("x");
    if (kind === "missing") delete entries["Dockerfile.api"];
    x.archive = zip(
      entries,
      commit,
      kind === "symlink" ? { "Dockerfile.api": "120777" } : {},
    );
    x.archiveSha256 = hash(x.archive);
    assert.throws(() => planNativeFreshPrepare(x));
  }
  const x = options(),
    entries = names.map((n) => [
      n === "Dockerfile.api" ? n : "scripts/" + n,
      x.gitBlobs[n],
    ]);
  entries.push(["Dockerfile.api", x.gitBlobs["Dockerfile.api"]]);
  x.archive = zip(entries);
  x.archiveSha256 = hash(x.archive);
  assert.throws(() => planNativeFreshPrepare(x), /Duplicate ZIP path/);
});
test("bounded unmeasured preparation keeps verification/transfer/cleanup headroom", () => {
  for (const alter of [
    (x) => {
      x.mode = "measured";
    },
    (x) => {
      x.prepareSeconds = 2100;
    },
    (x) => {
      x.verificationSeconds = 0;
    },
    (x) => {
      x.totalSeconds = 2220;
    },
    (x) => {
      x.totalSeconds = 2700;
    },
    (x) => {
      x.pushSeconds = 999;
    },
    (x) => {
      x.forecast = true;
    },
  ]) {
    const x = options();
    alter(x.budget);
    assert.throws(() => planNativeFreshPrepare(x));
  }
});
test("one bounded owned-shell operation never invokes denied IAM/DescribeImages or an old donor", () => {
  const p = planNativeFreshPrepare(options()),
    spec = JSON.parse(p.request.buildspecOverride);
  assert.equal(spec.phases.build.commands.length, 1);
  assert.equal(unpackFreshPrepareOperation(p.transport), p.operation);
  assert.ok(Buffer.byteLength(p.request.buildspecOverride) <= 25600);
  for (const text of [
    "--target llvm-checkpoint-prepare",
    "--network none",
    "--memory 2g --cpus 2",
    "--cap-drop ALL",
    "--security-opt no-new-privileges",
    "cleanup_native_validation",
    "batch-get-image",
    "begin(",
    "native_validation_container=",
    "2445s bash -eu -o pipefail",
  ])
    assert.ok(p.operation.includes(text), text);
  assert.ok(
    p.generatedPrograms.verify.includes("begin('release-core',receiptSha256)"),
  );
  assert.doesNotMatch(
    p.operation,
    /describe-images|--profile|put-object|put-role-policy|update-project|docker pull|docker commit|--phase final|:latest|ecs |rds /,
  );
  assert.ok(
    p.operation.indexOf("state-proof.json") <
      p.operation.indexOf("docker push"),
  );
});
test("all thirteen exact generated programs are syntactically valid JavaScript", () => {
  const p = planNativeFreshPrepare(options());
  assert.equal(Object.keys(p.generatedPrograms).length, 13);
  for (const [name, program] of Object.entries(p.generatedPrograms))
    assert.doesNotThrow(() => new Script(program), name);
});
const requireNative = createRequire(import.meta.url);
function virtual(program, files = {}, extra = {}) {
  const storage = new Map(
    Object.entries(files).map(([k, v]) => [
      k,
      Buffer.isBuffer(v) ? v : Buffer.from(v),
    ]),
  );
  const printed = [],
    calls = [];
  let realmParse;
  const fs = {
    lstatSync: (p) => {
      assert.ok(storage.has(p), "fixture file exists: " + p);
      return {
        size: storage.get(p).length,
        isFile: () => true,
        isSymbolicLink: () => false,
      };
    },
    readFileSync: (p) => storage.get(p),
    existsSync: (p) => storage.has(p),
    readdirSync: (p) => {
      const prefix = p + "/";
      return realmParse(
        JSON.stringify(
          [...storage.keys()]
            .filter(
              (k) =>
                k.startsWith(prefix) && !k.slice(prefix.length).includes("/"),
            )
            .map((k) => k.slice(prefix.length)),
        ),
      );
    },
    writeFileSync: (p, b, o) => {
      assert.equal(o.flag, "wx");
      assert.equal(storage.has(p), false);
      storage.set(p, Buffer.from(b));
    },
    statfsSync: () => ({ bavail: 30n * 1024n ** 3n, bsize: 1n }),
  };
  const context = {
    Buffer,
    TextDecoder,
    console: { log: (x) => printed.push(x), error: (x) => printed.push(x) },
    process: {
      execPath: "node",
      env: { VAETTIR_RELEASE_COMMIT: commit },
      stdout: { write: (x) => printed.push(x) },
    },
    ...extra,
    require: (name) => {
      if (name === "node:fs") return fs;
      if (name === "node:child_process")
        return {
          spawnSync: (...args) => {
            calls.push(args);
            return { status: 0, signal: null };
          },
        };
      assert.ok(
        ["node:assert/strict", "node:crypto", "node:zlib"].includes(name),
      );
      return requireNative(name);
    },
  };
  const vmContext = createContext(context);
  realmParse = new Script("JSON.parse").runInContext(vmContext);
  return {
    storage,
    printed,
    calls,
    run: () => new Script(program).runInContext(vmContext, { timeout: 2000 }),
  };
}
test("exact gzip decoder executes only verified operation and rejects tampered compressed bytes", () => {
  const p = planNativeFreshPrepare(options()),
    v = virtual(p.generatedPrograms.decoder);
  v.run();
  assert.equal(v.calls.length, 1);
  assert.equal(v.calls[0][0], "/bin/bash");
  assert.equal(v.calls[0][1][4], p.operation);
  const bad = p.generatedPrograms.decoder.replace(
    p.transport.compressedSha256,
    "0".repeat(64),
  );
  const denied = virtual(bad);
  assert.throws(() => denied.run());
  assert.equal(denied.calls.length, 0);
});
test("owned cleanup has75-second grace inside hard42minutes and decoder waits coherently", () => {
  const p = planNativeFreshPrepare(options()),
    r = p.identity.resources;
  assert.equal(r.cleanupGraceSeconds, 75);
  assert.ok(r.cleanupGraceSeconds >= 65);
  assert.equal(r.operationSeconds + r.cleanupGraceSeconds, r.totalSeconds);
  assert.ok(r.totalSeconds <= 2520);
  assert.equal(r.decoderWatchdogSeconds, r.totalSeconds + 30);
  assert.ok(r.decoderWatchdogSeconds < 45 * 60);
  assert.match(
    p.operation,
    /^timeout --signal=TERM --kill-after=75s 2445s bash/,
  );
  const v = virtual(p.generatedPrograms.decoder);
  v.run();
  assert.equal(v.calls[0][2].timeout, 2550000);
  const tooLittle = options();
  tooLittle.budget.prepareSeconds = 1800;
  assert.throws(() => planNativeFreshPrepare(tooLittle), /cleanup headroom/);
  for (const replacement of [
    "--kill-after=30s 2445s",
    "--kill-after=64s 2445s",
    "--kill-after=75s 2520s",
  ]) {
    const operation = p.operation.replace(
        "--kill-after=75s 2445s",
        replacement,
      ),
      bytes = Buffer.from(operation),
      compressed = gzipSync(bytes, { level: 9 });
    const packed = {
      ...p.transport,
      decodedBytes: bytes.length,
      decodedSha256: hash(bytes),
      compressedBytes: compressed.length,
      compressedSha256: hash(compressed),
      base64: compressed.toString("base64"),
    };
    assert.throws(
      () => unpackFreshPrepareOperation(packed),
      /cleanup grace|42-minute/,
    );
  }
});
test("generated source hash and tag absence programs operate on actual synthetic file bytes", () => {
  const input = options(),
    p = planNativeFreshPrepare(input),
    files = Object.fromEntries(
      names.map((n) => [
        "native-fresh-prepare-context/" +
          (n === "Dockerfile.api" ? n : "scripts/" + n),
        input.gitBlobs[n],
      ]),
    );
  virtual(p.generatedPrograms.source, files).run();
  files["native-fresh-prepare-context/scripts/native-llvm-checkpoint.mjs"] =
    Buffer.from("different");
  assert.throws(() => virtual(p.generatedPrograms.source, files).run());
  const absent = {
    images: [],
    failures: [
      { failureCode: "ImageNotFound", imageId: { imageTag: p.candidateTag } },
    ],
  };
  virtual(p.generatedPrograms.absent, {
    "native-fresh-prepare-proof/tag-preflight.json": encode(absent),
  }).run();
  absent.images.push({});
  assert.throws(() =>
    virtual(p.generatedPrograms.absent, {
      "native-fresh-prepare-proof/tag-preflight.json": encode(absent),
    }).run(),
  );
});
test("exact whole ZIP bytes are checked before fresh extraction and no automatic context is built", () => {
  const input = options(),
    p = planNativeFreshPrepare(input),
    path = "native-fresh-prepare-proof/source.zip";
  virtual(p.generatedPrograms.archive, { [path]: input.archive }).run();
  const changed = Buffer.from(input.archive);
  changed[20] ^= 1;
  assert.throws(
    () => virtual(p.generatedPrograms.archive, { [path]: changed }).run(),
    /whole canonical source ZIP/,
  );
  assert.throws(() =>
    virtual(p.generatedPrograms.archive, {
      [path]: Buffer.alloc(30 * 1024 * 1024 + 1),
    }).run(),
  );
  const operation = p.operation;
  assert.ok(
    operation.includes(
      "mkdir native-fresh-prepare-proof native-fresh-prepare-context",
    ),
  );
  assert.ok(operation.includes("--expected-bucket-owner 051722405355"));
  const fetch = operation.indexOf("aws s3api get-object"),
    hashCheck = operation.indexOf("Exact whole canonical source ZIP"),
    extract = operation.indexOf("unzip -q"),
    checkNative = operation.indexOf("Exact archived native script"),
    build = operation.indexOf("docker build");
  assert.ok(
    fetch < hashCheck &&
      hashCheck < extract &&
      extract < checkNative &&
      checkNative < build,
  );
  assert.ok(
    operation.includes(
      "-f native-fresh-prepare-context/Dockerfile.api native-fresh-prepare-context",
    ),
  );
  assert.doesNotMatch(operation, /-f Dockerfile\.api \./);
  assert.doesNotMatch(operation, /(?:^|\n)cd /);
  assert.ok(
    p.generatedPrograms.source.includes(
      "bounded('native-fresh-prepare-context/scripts/",
    ),
  );
  const auto = Object.fromEntries(
    names.map((n) => [
      n === "Dockerfile.api" ? n : "scripts/" + n,
      input.gitBlobs[n],
    ]),
  );
  assert.throws(() => virtual(p.generatedPrograms.source, auto).run());
  const forged = completedFixture(p);
  forged.plan.request.autoRetryLimitOverride = 1;
  assert.throws(() =>
    validateNativeFreshPrepareCompleted(
      forged.completed,
      forged.expected,
      forged.plan,
    ),
  );
});
test("actual generated verification body invokes successor begin and emits new null-parent evidence", async () => {
  const input = options(),
    p = planNativeFreshPrepare(input),
    r = receipt(),
    files = Object.fromEntries(
      Object.keys(FRESH_NATIVE_SCRIPT_LF_HASHES).map((n) => [
        "/build/scripts/" + n,
        input.gitBlobs[n],
      ]),
    );
  files["/build/llvm-phase-receipts/prepare.json"] = encode(r);
  files["/build/llvm-sources/source-manifest.json"] =
    Buffer.from("source manifest");
  files["/build/llvm-configure-only-measurement.json"] = encode({
    schemaVersion: 1,
    purpose: "llvm-configure-only-measurement",
    mode: "checkpoint",
    boundedCompilerJobs: 5,
    recipeSha256: p.identity.expectedScripts["build-llvm-runtime.sh"],
    releaseCacheSha256: r.inputs.configuration[0].cache,
    assertionsCacheSha256: r.inputs.configuration[1].cache,
    sourceManifestSha256: hash("source manifest"),
    compileAcceptance: false,
    unitAcceptance: false,
    candidateAbiAcceptance: false,
    packageCreated: false,
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
  });
  const calls = [];
  const v = virtual(
    p.generatedPrograms.verifyBody + ";verifyFreshPrepare(fixtureStore)",
    files,
    { fixtureStore: () => ({ begin: (...args) => calls.push(args) }) },
  );
  await v.run();
  assert.deepEqual(calls, [["release-core", hash(encode(r))]]);
  assert.equal(v.printed.length, 1);
  assert.equal(
    JSON.parse(v.printed[0].split("=").slice(1).join("=")).inputsSha256,
    r.inputsSha256,
  );
  for (const mutate of [
    (f) => {
      f["/build/llvm-phase-active.json"] = Buffer.from("active");
    },
    (f) => {
      f["/build/llvm-phase-receipts/release-core.json"] = Buffer.from("old");
    },
    (f) => {
      const m = JSON.parse(f["/build/llvm-configure-only-measurement.json"]);
      m.boundedCompilerJobs = 6;
      f["/build/llvm-configure-only-measurement.json"] = encode(m);
    },
  ]) {
    const altered = { ...files };
    mutate(altered);
    await assert.rejects(
      virtual(
        p.generatedPrograms.verifyBody + ";verifyFreshPrepare(fixtureStore)",
        altered,
        {
          fixtureStore: () => ({ begin: () => assert.fail("must not begin") }),
        },
      ).run(),
    );
  }
});
test("generated LF/CRLF collector emits valid JSON lines and refuses repeated/foreign markers", () => {
  const p = planNativeFreshPrepare(options());
  for (const ending of ["\n", "\r\n"]) {
    const value = proof(p),
      line = "NATIVE_FRESH_PREPARE_STATE=" + JSON.stringify(value) + ending;
    const v = virtual(p.generatedPrograms.collect, {
      "native-fresh-prepare-proof/state.log": "ordinary log" + ending + line,
    });
    v.run();
    const b = v.storage.get("native-fresh-prepare-proof/state-proof.json");
    assert.equal(b.at(-1), 10);
    assert.equal(JSON.parse(b).receiptSha256, value.receiptSha256);
    assert.throws(() =>
      virtual(p.generatedPrograms.collect, {
        "native-fresh-prepare-proof/state.log": line + line,
      }).run(),
    );
  }
});
test("post-push readback binds actual manifest/config to local inspection without pretending digest pull", () => {
  const p = planNativeFreshPrepare(options()),
    { completed: c, labels } = completedFixture(p),
    prefix = "native-fresh-prepare-proof/";
  const files = {
    [prefix + "registry-manifest.json"]: encode(c.registryManifest),
    [prefix + "candidate-inspect.json"]: encode([
      {
        Id: c.imageConfigDigest,
        Size: c.proof.imageSizeBytes,
        Os: "linux",
        Architecture: "amd64",
        Config: { Labels: labels },
      },
    ]),
    [prefix + "push.log"]: "digest: " + c.imageDigest + " size: 42\r\n",
    [prefix + "state-proof.json"]: encode(proof(p)),
  };
  virtual(p.generatedPrograms.inspect, files).run();
  const v = virtual(p.generatedPrograms.readback, files);
  v.run();
  const emitted = JSON.parse(v.printed[0].split("=").slice(1).join("="));
  assert.equal(emitted.digestPullEvidence, false);
  assert.equal(emitted.prePushInspection, true);
  assert.equal(emitted.imageConfigDigest, c.imageConfigDigest);
  files[prefix + "candidate-inspect.json"] = encode([
    { Id: "sha256:" + "0".repeat(64), Size: 123 },
  ]);
  assert.throws(() => virtual(p.generatedPrograms.readback, files).run());
});
test("fresh completed validator accepts only independently pinned successful new lineage", () => {
  const { plan, completed, expected } = completedFixture();
  const result = validateNativeFreshPrepareCompleted(completed, expected, plan);
  assert.equal(result.receipt.predecessorSha256, null);
  assert.equal(result.continuationSupported, false);
  assert.equal(result.runtimeAcceptance, false);
});
test("completed failed/old-source/old-receipt/runtime/false-pull evidence is refused", () => {
  for (const alter of [
    (x) => {
      x.status = "FAILED";
    },
    (x) => {
      x.sourceCommit = "d3a952c5c3c407cba306f4da3de4a0cac2e0908e";
    },
    (x) => {
      x.proof.digestPullEvidence = true;
    },
    (x) => {
      x.proof.actualStateVerified = false;
    },
    (x) => {
      x.proof.packageAcceptance = true;
    },
    (x) => {
      x.unitAcceptance = true;
    },
    (x) => {
      x.proof.receiptBase64 += "=";
    },
    (x) => {
      x.proof.inputsSha256 = "0".repeat(64);
    },
    (x) => {
      x.secret = "do not project";
    },
  ]) {
    const { plan, completed, expected } = completedFixture();
    alter(completed);
    assert.throws(() =>
      validateNativeFreshPrepareCompleted(completed, expected, plan),
    );
  }
  const x = completedFixture();
  x.expected.receiptSha256 =
    "54e96393c398f6a97f49f570de04fa758f18121aa2ebe90595f40ba29e38b09b";
  assert.throws(() =>
    validateNativeFreshPrepareCompleted(x.completed, x.expected, x.plan),
  );
});
test("tampered plan/request/buildspec/registry config and mismatched labels never become acceptance", () => {
  for (const alter of [
    (x) => {
      x.plan.request.projectName = "another-project";
    },
    (x) => {
      x.plan.operation += "\necho injected";
    },
    (x) => {
      x.expected.requestSha256 = "0".repeat(64);
    },
    (x) => {
      x.completed.registryConfigBase64 = encode({
        os: "linux",
        architecture: "amd64",
      }).toString("base64");
    },
    (x) => {
      x.completed.registryManifest.images[0].imageManifest += " ";
    },
    (x) => {
      x.completed.proof.imageConfigDigest = "sha256:" + "0".repeat(64);
    },
  ]) {
    const x = completedFixture();
    alter(x);
    assert.throws(() =>
      validateNativeFreshPrepareCompleted(x.completed, x.expected, x.plan),
    );
  }
});
test("owned CID cleanup and bounded disk/container programs execute and refuse foreign ownership", () => {
  const p = planNativeFreshPrepare(options()),
    { completed: c, labels } = completedFixture(p),
    prefix = "native-fresh-prepare-proof/",
    id = "8".repeat(64);
  const container = {
    Id: id,
    Image: c.imageConfigDigest,
    Config: {
      Image: c.imageConfigDigest,
      Labels: { ...labels, "vaettir.prepare-owner": p.planSha256 },
    },
    HostConfig: {
      NetworkMode: "none",
      Privileged: false,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      Memory: 2147483648,
      NanoCpus: 2000000000,
      PidsLimit: 128,
    },
    Mounts: [],
  };
  const files = {
    [prefix + "candidate-inspect.json"]: encode([
      { Id: c.imageConfigDigest, Size: c.proof.imageSizeBytes },
    ]),
    [prefix + "container-id"]: id,
    [prefix + "container-inspect.json"]: encode([container]),
    [prefix + "cleanup-inspect.json"]: encode([container]),
  };
  virtual(p.generatedPrograms.disk).run();
  const reader = virtual(p.generatedPrograms.readId, files);
  reader.run();
  assert.equal(reader.printed[0], id);
  virtual(p.generatedPrograms.container, files).run();
  virtual(p.generatedPrograms.cleanupOwner, files).run();
  for (const change of [
    (x) => {
      x.Id = "9".repeat(64);
    },
    (x) => {
      x.Config.Labels["vaettir.prepare-owner"] = "0".repeat(64);
    },
    (x) => {
      x.Image = "sha256:" + "0".repeat(64);
    },
    (x) => {
      x.Mounts = [{ Source: "/private" }];
    },
  ]) {
    const bad = structuredClone(container);
    change(bad);
    const f = { ...files, [prefix + "cleanup-inspect.json"]: encode([bad]) };
    assert.throws(() => virtual(p.generatedPrograms.cleanupOwner, f).run());
  }
  const invalid = { ...files, [prefix + "container-id"]: id + "\n" };
  assert.throws(() => virtual(p.generatedPrograms.readId, invalid).run());
  assert.ok(
    p.operation.indexOf("cleanup_native_validation() { case") <
      p.operation.indexOf("docker create"),
  );
  assert.ok(
    p.operation.indexOf("native_create_status") <
      p.operation.indexOf("container-inspect.json"),
  );
});
test("malformed known fields and reconstructed foreign plan identities are refused", () => {
  for (const alter of [
    (x) => {
      x.plan.identity.expectedScripts["native-llvm-checkpoint.mjs"] =
        "0".repeat(64);
    },
    (x) => {
      x.plan.identity.predecessorSha256 = "a".repeat(64);
    },
    (x) => {
      x.plan.identity.sourceBindings["check-llvm-jit.c"].gitMode = "120000";
    },
    (x) => {
      x.plan.identity.plannerSemanticsSha256 = "0".repeat(64);
    },
    (x) => {
      x.completed.proof.receiptBase64 = "!";
    },
    (x) => {
      x.completed.proof.receiptSha256 = 42;
    },
    (x) => {
      x.completed.proof.imageSizeBytes = 64 * 1024 ** 3;
    },
    (x) => {
      x.completed.registryManifest.images = [];
    },
    (x) => {
      x.completed.registryConfigBase64 = "a".repeat(400000);
    },
  ]) {
    const x = completedFixture();
    alter(x);
    assert.throws(() =>
      validateNativeFreshPrepareCompleted(x.completed, x.expected, x.plan),
    );
  }
});
test("raw registry configuration must bind labels, platform, rootfs and all independent hashes", () => {
  for (const alter of [
    (c) => {
      c.os = "windows";
    },
    (c) => {
      c.architecture = "arm64";
    },
    (c) => {
      c.config.Labels["vaettir.source-commit"] = "a".repeat(40);
    },
    (c) => {
      c.config.Labels["vaettir.prepare-plan"] = "a".repeat(64);
    },
    (c) => {
      c.config.Labels["vaettir.runtime-eligible"] = "true";
    },
    (c) => {
      c.rootfs.diff_ids = [];
    },
  ]) {
    const x = completedFixture(),
      config = JSON.parse(
        Buffer.from(x.completed.registryConfigBase64, "base64"),
      );
    alter(config);
    const raw = encode(config),
      configDigest = "sha256:" + hash(raw),
      manifest = JSON.parse(
        x.completed.registryManifest.images[0].imageManifest,
      );
    manifest.config.digest = configDigest;
    const text = JSON.stringify(manifest),
      imageDigest = "sha256:" + hash(text);
    x.completed.registryConfigBase64 = raw.toString("base64");
    x.completed.registryManifest.images[0].imageManifest = text;
    x.completed.registryManifest.images[0].imageId.imageDigest = imageDigest;
    for (const value of [x.completed, x.completed.proof, x.expected]) {
      value.imageConfigDigest = configDigest;
      value.imageDigest = imageDigest;
    }
    assert.throws(() =>
      validateNativeFreshPrepareCompleted(x.completed, x.expected, x.plan),
    );
  }
});
test("raw registry configuration parser refuses without disclosing unrelated private bytes", () => {
  const x = completedFixture(),
    sentinel = "SYNTHETIC_PRIVATE_CONFIG_MUST_NOT_APPEAR";
  const raw = Buffer.from('{"Env": ["' + sentinel + '"],');
  const configDigest = "sha256:" + hash(raw),
    manifest = JSON.parse(x.completed.registryManifest.images[0].imageManifest);
  manifest.config.digest = configDigest;
  const text = JSON.stringify(manifest),
    imageDigest = "sha256:" + hash(text);
  x.completed.registryConfigBase64 = raw.toString("base64");
  x.completed.registryManifest.images[0].imageManifest = text;
  x.completed.registryManifest.images[0].imageId.imageDigest = imageDigest;
  for (const value of [x.completed, x.completed.proof, x.expected]) {
    value.imageConfigDigest = configDigest;
    value.imageDigest = imageDigest;
  }
  assert.throws(
    () => validateNativeFreshPrepareCompleted(x.completed, x.expected, x.plan),
    (error) => {
      assert.doesNotMatch(error.message, new RegExp(sentinel));
      assert.match(error.message, /Unsupported registry configuration/);
      return true;
    },
  );
});
test("synthetic receipt cannot promote non-prepare or nonempty-proof evidence", () => {
  for (const alter of [
    (r) => {
      r.phase = "release-core";
      r.predecessorSha256 = "a".repeat(64);
    },
    (r) => {
      r.proof = { abiReceiptSha256: "b".repeat(64) };
    },
    (r) => {
      r.state.release.bytes = 64 * 1024 ** 3 + 1;
    },
    (r) => {
      r.inputs.toolchain.compilerPackage = "other";
    },
  ]) {
    const x = completedFixture(),
      r = receipt();
    alter(r);
    const b = encode(r);
    x.completed.proof.receiptBase64 = b.toString("base64");
    x.completed.proof.receiptSha256 = hash(b);
    x.completed.receiptSha256 = hash(b);
    x.expected.receiptSha256 = hash(b);
    assert.throws(() =>
      validateNativeFreshPrepareCompleted(x.completed, x.expected, x.plan),
    );
  }
});
test("exact generated outer and inner Bash grammar validates without execution", () => {
  const p = planNativeFreshPrepare(options()),
    binary =
      process.platform === "win32"
        ? "C:/Program Files/Git/bin/bash.exe"
        : "/bin/bash";
  const outer = spawnSync(binary, ["-n"], {
    input: p.operation,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(outer.status, 0, outer.stderr);
  // Extract only via the known POSIX single-quote encoding, never eval/execute.
  const marker = "bash -eu -o pipefail -c ",
    encoded = p.operation.slice(p.operation.indexOf(marker) + marker.length);
  assert.ok(encoded.startsWith("'") && encoded.endsWith("'"));
  const inner = encoded.slice(1, -1).replaceAll("'\\''", "'");
  const parsed = spawnSync(binary, ["-n"], {
    input: inner,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(parsed.status, 0, parsed.stderr);
});
