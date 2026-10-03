// Builder-only continuation integrity. Registry transport/digest trust is an
// external release gate; these receipts never authorize a runtime deployment.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  readSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const LLVM_CHECKPOINT_PHASES = Object.freeze([
  "prepare",
  "release-core",
  "release-units",
  "assertion-compile-1",
  "assertion-compile-2",
  "assertion-compile-3",
  "final",
]);
const HASH = /^[a-f0-9]{64}$/;
const MAX_RECEIPT = 32768;
const MAX_PLAN = 4 * 1024 * 1024;
const MAX_FILES = 400000;
const MAX_BYTES = 64 * 1024 ** 3;
const MAX_FILE = 4 * 1024 ** 3;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encode = (value) => JSON.stringify(value);

export function checkpointPhase(phase) {
  assert.ok(
    LLVM_CHECKPOINT_PHASES.includes(phase),
    "Unknown LLVM checkpoint phase",
  );
  return LLVM_CHECKPOINT_PHASES.indexOf(phase);
}
export function parseCheckpointArguments(args) {
  assert.ok(
    args.length === 2 || args.length === 4,
    "Exact phase arguments required",
  );
  assert.equal(args[0], "--phase");
  const index = checkpointPhase(args[1]);
  if (index === 0)
    assert.equal(args.length, 2, "Prepare cannot accept a predecessor");
  else {
    assert.equal(
      args.length,
      4,
      "A pinned predecessor receipt hash is required",
    );
    assert.equal(args[2], "--predecessor-sha256");
    assert.match(args[3], HASH);
  }
  return { phase: args[1], predecessorSha256: index ? args[3] : null };
}
function boundedRead(path, limit) {
  const stat = lstatSync(path);
  assert.ok(
    stat.isFile() && stat.size <= limit,
    "Bounded regular file required: " + path,
  );
  return readFileSync(path);
}
function hashFile(path) {
  const stat = lstatSync(path);
  assert.ok(
    stat.isFile() && stat.size <= MAX_FILE,
    "Oversized/nonregular identity file",
  );
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = openSync(path, "r");
  try {
    let bytes;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)))
      digest.update(buffer.subarray(0, bytes));
  } finally {
    closeSync(fd);
  }
  const after = lstatSync(path);
  assert.equal(after.size, stat.size, "Identity file changed while hashing");
  assert.equal(
    after.mtimeMs,
    stat.mtimeMs,
    "Identity file changed while hashing",
  );
  return { sha256: digest.digest("hex"), bytes: stat.size };
}
export function inventoryTree(
  root,
  { exclude = [], maxFiles = MAX_FILES, maxBytes = MAX_BYTES } = {},
) {
  const base = resolve(root);
  assert.ok(
    lstatSync(base).isDirectory(),
    "Identity root must be a real directory",
  );
  const digest = createHash("sha256");
  let files = 0,
    bytes = 0;
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const nameFromRoot = relative(base, path).split(sep).join("/");
      if (
        exclude.some(
          (item) =>
            nameFromRoot === item || nameFromRoot.startsWith(item + "/"),
        )
      )
        continue;
      const stat = lstatSync(path);
      assert.ok(++files <= maxFiles, "Identity file-count bound exceeded");
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(path);
        const destination = resolve(directory, target);
        assert.ok(
          destination === base || destination.startsWith(base + sep),
          "Identity symlink escapes owned root",
        );
        digest.update(encode([nameFromRoot, "symlink", target]) + "\n");
      } else if (stat.isDirectory()) {
        digest.update(encode([nameFromRoot, "directory"]) + "\n");
        walk(path);
      } else {
        assert.ok(stat.isFile(), "Special files cannot enter a checkpoint");
        bytes += stat.size;
        assert.ok(bytes <= maxBytes, "Identity byte bound exceeded");
        const item = hashFile(path);
        digest.update(
          encode([
            nameFromRoot,
            "file",
            stat.mode & 0o777,
            item.bytes,
            item.sha256,
          ]) + "\n",
        );
      }
    }
  };
  walk(base);
  return { sha256: digest.digest("hex"), entries: files, bytes };
}

export function assertionCompilePlan(dryRun) {
  assert.ok(
    Buffer.byteLength(dryRun) <= 32 * 1024 * 1024,
    "Bounded generated unit graph required",
  );
  const targets = [];
  for (const line of dryRun.split(/\r?\n/)) {
    const match = /^\[\d+\/\d+\] Building (?:C|CXX|ASM) object (.+)$/.exec(
      line,
    );
    if (!match) continue;
    assert.ok(
      /^[A-Za-z0-9_./+-]+\.o$/.test(match[1]) &&
        !match[1].startsWith("/") &&
        !match[1].startsWith("-") &&
        !match[1].split("/").includes(".."),
      "Unsafe generated object target",
    );
    targets.push(match[1]);
  }
  assert.ok(
    targets.length >= 100 && targets.length <= 20000,
    "Full unit compilation graph required",
  );
  assert.equal(
    new Set(targets).size,
    targets.length,
    "Duplicate generated object target",
  );
  const width = Math.ceil(targets.length / 3);
  return {
    schemaVersion: 1,
    purpose: "llvm-assertion-compilation-only",
    graphSha256: hash(dryRun),
    targets: [
      targets.slice(0, width),
      targets.slice(width, width * 2),
      targets.slice(width * 2),
    ],
    unitAcceptance: false,
  };
}
function validPlan(plan) {
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.purpose, "llvm-assertion-compilation-only");
  assert.match(plan.graphSha256, HASH);
  assert.equal(plan.unitAcceptance, false);
  assert.ok(Array.isArray(plan.targets) && plan.targets.length === 3);
  const targets = plan.targets.flat();
  assert.ok(targets.length >= 100 && targets.length <= 20000);
  assert.equal(new Set(targets).size, targets.length);
  for (const group of plan.targets) {
    assert.ok(
      group.length > 0 && group.length <= Math.ceil(targets.length / 3),
    );
    for (const target of group)
      assert.ok(
        typeof target === "string" &&
          /^[A-Za-z0-9_./+-]+\.o$/.test(target) &&
          !target.startsWith("/") &&
          !target.startsWith("-") &&
          !target.split("/").includes(".."),
      );
  }
  return plan;
}

function toolchainIdentity() {
  const run = (command, args) =>
    execFileSync(command, args, {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
  const compiler = run("clang++-19", ["--version"]);
  assert.match(compiler, /^Debian clang version 19\.1\.7(?: |$)/);
  const version = run("dpkg-query", ["-W", "-f=${Version}", "clang-19"]).trim();
  assert.equal(version, "1:19.1.7-3+b1");
  return {
    compilerSha256: hashFile("/usr/lib/llvm-19/bin/clang").sha256,
    compiler,
    compilerPackage: version,
    installedPackagesSha256: hash(
      run("dpkg-query", ["-W", "-f=${Package}\t${Version}\t${Architecture}\n"]),
    ),
  };
}
export function checkpointStore(
  root = "/build",
  { compiler = toolchainIdentity } = {},
) {
  const directory = join(root, "llvm-phase-receipts");
  const activePath = join(root, "llvm-phase-active.json");
  const receiptPath = (phase) => join(directory, phase + ".json");
  const json = (path, limit = MAX_RECEIPT) =>
    JSON.parse(boundedRead(path, limit));
  const write = (path, value, bound = MAX_RECEIPT) => {
    const bytes = encode(value) + "\n";
    assert.ok(
      Buffer.byteLength(bytes) <= bound,
      "Checkpoint output bound exceeded",
    );
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  };
  const inputs = () => ({
    scripts: inventoryTree(join(root, "scripts")),
    signedSources: inventoryTree(join(root, "llvm-sources")),
    // These exact paths are generated package output, never compiler inputs.
    source: inventoryTree(join(root, "llvm-source"), {
      exclude: ["debian/libllvm19", "debian/libllvm19.substvars"],
    }),
    toolchain: compiler(),
    baselineSha256: hashFile(join(root, "llvm-baseline-library")).sha256,
    configuration: ["llvm-build", "llvm-assert-build"].map((name) => ({
      cache: hash(boundedRead(join(root, name, "CMakeCache.txt"), 1024 * 1024)),
      commands: hash(
        boundedRead(
          join(root, name, "compile_commands.json"),
          64 * 1024 * 1024,
        ),
      ),
    })),
    assertionPlanSha256: hash(
      boundedRead(join(root, "llvm-assertion-partitions.json"), MAX_PLAN),
    ),
  });
  const state = () => ({
    release: inventoryTree(join(root, "llvm-build")),
    assertions: inventoryTree(join(root, "llvm-assert-build")),
  });
  const readReceipt = (phase) => {
    const bytes = boundedRead(receiptPath(phase), MAX_RECEIPT);
    const receipt = JSON.parse(bytes);
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.purpose, "llvm-builder-checkpoint-not-runtime");
    assert.equal(receipt.phase, phase);
    assert.equal(receipt.unitAcceptance, phase === "final");
    assert.equal(receipt.packageAcceptance, phase === "final");
    for (const key of [
      "runtimeAcceptance",
      "authenticatedAcceptance",
      "deploymentAcceptance",
    ])
      assert.equal(receipt[key], false);
    assert.match(receipt.inputsSha256, HASH);
    assert.equal(receipt.inputsSha256, hash(encode(receipt.inputs)));
    assert.equal(receipt.predecessorSha256 === null, phase === "prepare");
    if (phase !== "prepare") assert.match(receipt.predecessorSha256, HASH);
    return { receipt, sha256: hash(bytes) };
  };
  const verifyParent = (phase, expected) => {
    const index = checkpointPhase(phase);
    assert.ok(index > 0);
    assert.match(expected, HASH, "Pinned predecessor hash required");
    const parent = readReceipt(LLVM_CHECKPOINT_PHASES[index - 1]);
    assert.equal(parent.sha256, expected, "Predecessor receipt was replaced");
    assert.deepEqual(
      parent.receipt.inputs,
      inputs(),
      "Source/toolchain/configuration changed after checkpoint",
    );
    assert.deepEqual(
      parent.receipt.state,
      state(),
      "Objects or generated build state changed after checkpoint",
    );
    // Check the complete hash chain, not only the immediate parent.
    let current = parent;
    for (let prior = index - 2; prior >= 0; prior--) {
      const earlier = readReceipt(LLVM_CHECKPOINT_PHASES[prior]);
      assert.equal(
        current.receipt.predecessorSha256,
        earlier.sha256,
        "Checkpoint ancestry changed",
      );
      assert.equal(
        earlier.receipt.inputsSha256,
        parent.receipt.inputsSha256,
        "Mixed checkpoint input identities",
      );
      current = earlier;
    }
    return parent;
  };
  return {
    receiptPath,
    begin(phase, expected = null) {
      checkpointPhase(phase);
      assert.ok(
        !existsSync(activePath),
        "A failed/in-flight phase cannot be silently resumed",
      );
      assert.ok(
        !existsSync(receiptPath(phase)),
        "Completed phases cannot be replayed",
      );
      if (phase === "prepare") {
        assert.equal(expected, null);
        if (existsSync(directory))
          assert.equal(
            readdirSync(directory).length,
            0,
            "Fresh prepare required",
          );
        mkdirSync(directory, { recursive: true, mode: 0o700 });
      } else verifyParent(phase, expected);
      write(activePath, {
        schemaVersion: 1,
        phase,
        predecessorSha256: expected,
      });
    },
    finish(phase) {
      checkpointPhase(phase);
      const active = json(activePath);
      assert.equal(active.schemaVersion, 1);
      assert.equal(active.phase, phase, "Another phase owns this builder");
      const identity = inputs();
      if (phase !== "prepare") {
        const parent = readReceipt(
          LLVM_CHECKPOINT_PHASES[checkpointPhase(phase) - 1],
        );
        assert.equal(parent.sha256, active.predecessorSha256);
        assert.deepEqual(
          parent.receipt.inputs,
          identity,
          "Immutable input changed during phase",
        );
      }
      const proof = {};
      if (phase === "release-core" || phase === "final") {
        const abi = json(
          join(
            root,
            phase === "final"
              ? "llvm-stripped-abi.json"
              : "llvm-early-abi.json",
          ),
        );
        assert.equal(abi.soname, "libLLVM.so.19.1");
        assert.equal(abi.runtimeAccepted, false);
        assert.match(abi.baselineSha256, HASH);
        assert.match(abi.candidateSha256, HASH);
        assert.equal(abi.baselineSha256, identity.baselineSha256);
        assert.ok(
          Number.isSafeInteger(abi.baselineExports) && abi.baselineExports > 0,
        );
        assert.ok(
          Number.isSafeInteger(abi.candidateExports) &&
            abi.candidateExports >= abi.baselineExports,
        );
        const candidate =
          phase === "final"
            ? join(
                root,
                "llvm-source/debian/libllvm19/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1",
              )
            : join(root, "llvm-build/lib/libLLVM.so.19.1");
        assert.equal(
          hashFile(candidate).sha256,
          abi.candidateSha256,
          "ABI receipt no longer describes candidate bytes",
        );
        proof.abiReceiptSha256 = hash(
          boundedRead(
            join(
              root,
              phase === "final"
                ? "llvm-stripped-abi.json"
                : "llvm-early-abi.json",
            ),
            MAX_RECEIPT,
          ),
        );
      }
      if (phase === "final") {
        const units = json(join(root, "llvm-final-unit-gates.json"));
        assert.deepEqual(units, {
          schemaVersion: 1,
          releaseTarget: "check-llvm-unit",
          assertionTarget: "check-llvm-unit",
          releasePassed: true,
          assertionPassed: true,
        });
        proof.packageSha256 = hashFile(
          join(root, "libllvm19_19.1.7-3+vaettir1_amd64.deb"),
        ).sha256;
        proof.unitReceiptSha256 = hash(
          boundedRead(join(root, "llvm-final-unit-gates.json"), MAX_RECEIPT),
        );
        assert.deepEqual(
          boundedRead(join(root, "llvm-arm-baseline.txt"), 65536),
          boundedRead(join(root, "llvm-arm-candidate.txt"), 65536),
        );
        for (const path of [
          "llvm-abi.json",
          "llvm-cpu-jit",
          "llvm-arm-policy",
          "llvm-release-configuration.json",
          "llvm-assertions-configuration.json",
        ])
          proof[path] = hashFile(join(root, path)).sha256;
      }
      const receipt = {
        schemaVersion: 1,
        purpose: "llvm-builder-checkpoint-not-runtime",
        phase,
        predecessorSha256: active.predecessorSha256,
        inputs: identity,
        inputsSha256: hash(encode(identity)),
        state: state(),
        proof,
        unitAcceptance: phase === "final",
        packageAcceptance: phase === "final",
        runtimeAcceptance: false,
        authenticatedAcceptance: false,
        deploymentAcceptance: false,
      };
      write(receiptPath(phase), receipt);
      unlinkSync(activePath);
      return {
        receipt,
        sha256: hash(boundedRead(receiptPath(phase), MAX_RECEIPT)),
      };
    },
    hash(phase) {
      checkpointPhase(phase);
      return readReceipt(phase).sha256;
    },
    compile(partition, jobs) {
      assert.ok([1, 2, 3].includes(partition));
      assert.ok(Number.isInteger(jobs) && jobs >= 1 && jobs <= 24);
      assert.equal(json(activePath).phase, "assertion-compile-" + partition);
      const plan = validPlan(
        json(join(root, "llvm-assertion-partitions.json"), MAX_PLAN),
      );
      execFileSync(
        "timeout",
        [
          "--signal=TERM",
          "--kill-after=20s",
          "2100s",
          "ninja",
          "-C",
          join(root, "llvm-assert-build"),
          "-j",
          String(jobs),
          ...plan.targets[partition - 1],
        ],
        { stdio: "inherit", timeout: 2130000 },
      );
    },
    plan() {
      assert.equal(json(activePath).phase, "prepare");
      const graph = execFileSync(
        "ninja",
        ["-C", join(root, "llvm-assert-build"), "-n", "UnitTests"],
        { encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
      );
      write(
        join(root, "llvm-assertion-partitions.json"),
        assertionCompilePlan(graph),
        MAX_PLAN,
      );
    },
    recordUnits() {
      assert.equal(json(activePath).phase, "final");
      write(join(root, "llvm-final-unit-gates.json"), {
        schemaVersion: 1,
        releaseTarget: "check-llvm-unit",
        assertionTarget: "check-llvm-unit",
        releasePassed: true,
        assertionPassed: true,
      });
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.equal(process.platform, "linux", "Builder-only Linux command");
  const [command, ...args] = process.argv.slice(2);
  const store = checkpointStore();
  if (command === "begin") {
    const parsed = parseCheckpointArguments(args);
    store.begin(parsed.phase, parsed.predecessorSha256);
  } else if (command === "finish" || command === "hash") {
    assert.equal(args.length, 1);
    const result =
      command === "finish"
        ? store.finish(args[0])
        : { sha256: store.hash(args[0]) };
    console.log(result.sha256);
  } else if (command === "plan" || command === "record-units") {
    assert.equal(args.length, 0);
    if (command === "plan") store.plan();
    else store.recordUnits();
  } else if (command === "compile") {
    assert.equal(args.length, 2);
    assert.match(args[0], /^[123]$/);
    assert.match(args[1], /^(?:[1-9]|1[0-9]|2[0-4])$/);
    store.compile(Number(args[0]), Number(args[1]));
  } else throw Error("Unknown native checkpoint command");
}
