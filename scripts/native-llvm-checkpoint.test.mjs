import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  assertionCompilePlan,
  checkpointStore,
  hashCandidateLibrary,
  inventoryTree,
  parseCheckpointArguments,
  LLVM_CHECKPOINT_PHASES,
} from "./native-llvm-checkpoint.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fileLink(t, target, path) {
  try {
    symlinkSync(target, path, "file");
    return true;
  } catch (error) {
    if (
      process.platform === "win32" &&
      ["EPERM", "EACCES"].includes(error?.code)
    ) {
      t.skip(
        "Windows denies real file-symlink creation; this scenario must execute on the Linux builder/CI runner",
      );
      return false;
    }
    throw error;
  }
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vaettir-native-phase-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  for (const name of [
    "scripts",
    "llvm-sources",
    "llvm-source",
    "llvm-build",
    "llvm-assert-build",
  ])
    mkdirSync(join(root, name));
  // The authenticated Debian source already contains this directory in prepare.
  mkdirSync(join(root, "llvm-source", "debian"));
  write("scripts/build-llvm-runtime.sh", "synthetic signed recipe");
  write("llvm-sources/source-manifest.json", {
    purpose: "synthetic fixture only",
  });
  write(
    "llvm-source/llvm/lib/source.cpp",
    "authored synthetic compiler source",
  );
  write("llvm-baseline-library", "synthetic baseline");
  for (const name of ["llvm-build", "llvm-assert-build"]) {
    write(name + "/CMakeCache.txt", name + " synthetic maintained flags");
    write(name + "/compile_commands.json", "[]");
  }
  write(
    "llvm-assertion-partitions.json",
    assertionCompilePlan(
      Array.from(
        { length: 120 },
        (_, index) =>
          `[${index + 1}/120] Building CXX object lib/test${index}.cpp.o`,
      ).join("\n"),
    ),
  );
  let compiler = "synthetic-clang-19";
  const store = checkpointStore(root, { compiler: () => ({ compiler }) });
  const abi = {
    soname: "libLLVM.so.19.1",
    baselineSha256: hash("synthetic baseline"),
    candidateSha256: hash("synthetic candidate"),
    baselineExports: 100,
    candidateExports: 100,
    runtimeAccepted: false,
  };
  const advance = (phase) => {
    const index = LLVM_CHECKPOINT_PHASES.indexOf(phase);
    store.begin(
      phase,
      index ? store.hash(LLVM_CHECKPOINT_PHASES[index - 1]) : null,
    );
    if (phase === "release-core") {
      write("llvm-build/lib/libLLVM.so.19.1", "synthetic candidate");
      write("llvm-early-abi.json", abi);
    }
    if (phase === "final") {
      store.recordUnits();
      write("llvm-stripped-abi.json", abi);
      write(
        "llvm-source/debian/libllvm19/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1",
        "synthetic candidate",
      );
      write("llvm-arm-baseline.txt", "same synthetic ARM policy");
      write("llvm-arm-candidate.txt", "same synthetic ARM policy");
      for (const path of [
        "libllvm19_19.1.7-3+vaettir1_amd64.deb",
        "llvm-abi.json",
        "llvm-cpu-jit",
        "llvm-arm-policy",
        "llvm-release-configuration.json",
        "llvm-assertions-configuration.json",
      ])
        write(path, "synthetic proof only");
    }
    return store.finish(phase);
  };
  return {
    root,
    write,
    store,
    advance,
    abi,
    setCompiler: (value) => {
      compiler = value;
    },
  };
}
test("exact phase arguments reject unknown, missing, extra and diagnostic ancestry", () => {
  assert.deepEqual(parseCheckpointArguments(["--phase", "prepare"]), {
    phase: "prepare",
    predecessorSha256: null,
  });
  assert.equal(
    parseCheckpointArguments([
      "--phase",
      "final",
      "--predecessor-sha256",
      "a".repeat(64),
    ]).phase,
    "final",
  );
  for (const args of [
    [],
    ["--phase", "runtime"],
    ["--phase", "release-core"],
    ["--phase", "prepare", "--predecessor-sha256", "a".repeat(64)],
    ["--phase", "final", "--predecessor-sha256", "latest"],
    ["--phase", "final", "--predecessor-sha256", "a".repeat(64), "extra"],
    ["--release-core-only", "prepare"],
  ])
    assert.throws(() => parseCheckpointArguments(args));
});
test("generated complete object graph partitions deterministically with no omissions or duplicate targets", () => {
  const graph = Array.from(
    { length: 101 },
    (_, index) =>
      `[${index + 1}/101] Building CXX object lib/target${index}.cpp.o`,
  ).join("\n");
  const plan = assertionCompilePlan(graph);
  assert.deepEqual(
    plan.targets.map((group) => group.length),
    [34, 34, 33],
  );
  assert.equal(plan.targets.flat().length, 101);
  assert.equal(plan.unitAcceptance, false);
  assert.deepEqual(assertionCompilePlan(graph), plan);
  for (const invalid of [
    "",
    graph + "\n[102/102] Building CXX object ../escape.o",
    graph + "\n[102/102] Building CXX object lib/target0.cpp.o",
    graph + "\n[102/102] Building CXX object /absolute.o",
    graph + "\n[102/102] Building CXX object -option.o",
    "x".repeat(32 * 1024 * 1024 + 1),
  ])
    assert.throws(() => assertionCompilePlan(invalid));
});
test("sequential source-bound chain remains non-runtime and final package requires all proof files", (t) => {
  const f = fixture(t);
  for (const phase of LLVM_CHECKPOINT_PHASES) {
    const { receipt } = f.advance(phase);
    assert.equal(receipt.unitAcceptance, phase === "final");
    assert.equal(receipt.packageAcceptance, phase === "final");
    assert.equal(receipt.runtimeAcceptance, false);
    assert.equal(receipt.authenticatedAcceptance, false);
    assert.equal(receipt.deploymentAcceptance, false);
  }
  assert.throws(
    () => f.store.begin("final", f.store.hash("assertion-compile-3")),
    /replayed/,
  );
});
test("source, config, object, plan and compiler mutations refuse continuation", (t) => {
  for (const mutation of [
    (f) => f.write("llvm-source/llvm/lib/source.cpp", "tampered source"),
    (f) => f.write("llvm-build/CMakeCache.txt", "weakened options"),
    (f) => f.write("llvm-build/lib/file.o", "foreign object"),
    (f) => f.write("llvm-assertion-partitions.json", "{}"),
    (f) => f.setCompiler("different compiler"),
    (f) => f.write("scripts/build-llvm-runtime.sh", "different recipe"),
  ]) {
    const f = fixture(t);
    f.advance("prepare");
    const expected = f.store.hash("prepare");
    mutation(f);
    assert.throws(
      () => f.store.begin("release-core", expected),
      /changed after checkpoint/,
    );
  }
});
test("pinned predecessor, missing, replaced, oversized and mixed ancestry are rejected", (t) => {
  const f = fixture(t);
  f.advance("prepare");
  assert.throws(
    () => f.store.begin("release-core", "a".repeat(64)),
    /replaced/,
  );
  assert.throws(() => f.store.begin("release-units", "a".repeat(64)), /ENOENT/);
  f.advance("release-core");
  const parent = f.store.hash("release-core");
  const first = JSON.parse(readFileSync(f.store.receiptPath("prepare")));
  f.write("llvm-phase-receipts/prepare.json", {
    ...first,
    runtimeAcceptance: true,
  });
  assert.throws(() => f.store.begin("release-units", parent));
  f.write("llvm-phase-receipts/prepare.json", "x".repeat(32769));
  assert.throws(() => f.store.hash("prepare"), /Bounded regular file/);
});
test("same-phase replay, overlapping phases and changed inputs during compilation fail closed", (t) => {
  const f = fixture(t);
  f.store.begin("prepare");
  assert.throws(() => f.store.begin("prepare"), /in-flight/);
  assert.throws(() => f.store.finish("release-core"), /Another phase/);
  f.store.finish("prepare");
  assert.throws(() => f.store.begin("prepare"), /replayed/);
  f.store.begin("release-core", f.store.hash("prepare"));
  f.write("llvm-source/llvm/lib/source.cpp", "changed during phase");
  assert.throws(
    () => f.store.finish("release-core"),
    /Immutable input changed/,
  );
});
test("final cannot claim acceptance before actual unit marker/package/ABI/ARM proofs exist", (t) => {
  const f = fixture(t);
  for (const phase of LLVM_CHECKPOINT_PHASES.slice(0, -1)) f.advance(phase);
  f.store.begin("final", f.store.hash("assertion-compile-3"));
  assert.throws(() => f.store.finish("final"), /ENOENT/);
  f.write("llvm-stripped-abi.json", f.abi);
  f.write(
    "llvm-source/debian/libllvm19/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1",
    "synthetic candidate",
  );
  assert.throws(() => f.store.finish("final"), /ENOENT/);
  f.write("llvm-final-unit-gates.json", {
    releasePassed: true,
    assertionPassed: false,
  });
  assert.throws(() => f.store.finish("final"));
});
test("a core ABI receipt cannot certify changed candidate bytes", (t) => {
  const f = fixture(t);
  f.advance("prepare");
  f.store.begin("release-core", f.store.hash("prepare"));
  f.write("llvm-early-abi.json", f.abi);
  f.write("llvm-build/lib/libLLVM.so.19.1", "not the ABI checked candidate");
  assert.throws(
    () => f.store.finish("release-core"),
    /no longer describes candidate/,
  );
});

test("candidate regular bytes keep their hash and cannot enlarge the existing byte limit or select another phase", (t) => {
  const f = fixture(t);
  f.write("llvm-build/lib/libLLVM.so.19.1", "synthetic candidate");
  assert.deepEqual(hashCandidateLibrary(f.root, "release-core"), {
    sha256: hash("synthetic candidate"),
    bytes: 19,
  });
  assert.throws(
    () => hashCandidateLibrary(f.root, "release-core", { maxBytes: 8 }),
    /Bounded regular candidate/,
  );
  assert.throws(
    () =>
      hashCandidateLibrary(f.root, "release-core", {
        maxBytes: 4 * 1024 ** 3 + 1,
      }),
    /cannot be enlarged/,
  );
  assert.throws(
    () => hashCandidateLibrary(f.root, "prepare"),
    /Exact candidate-library phase/,
  );
});

test("actual same-length overwrite with restored mtime during streaming is refused by descriptor change time", (t) => {
  const f = fixture(t);
  const candidate = join(f.root, "llvm-build/lib/libLLVM.so.19.1");
  f.write("llvm-build/lib/libLLVM.so.19.1", "synthetic candidate");
  // Exact integral timestamp avoids Date/float sub-millisecond rounding being
  // mistaken for the intended ctime guard. No stat/digest results are forged.
  const fixedTime = new Date("2020-01-01T00:00:00Z");
  utimesSync(candidate, fixedTime, fixedTime);
  const before = lstatSync(candidate),
    originalRead = fs.readSync;
  let changed = false;
  t.mock.method(fs, "readSync", (...args) => {
    const count = Reflect.apply(originalRead, fs, args);
    if (!changed && count > 0) {
      // A controlled native I/O boundary delegates the real read, then really
      // changes the file. This is not a substituted hash/stat success fixture.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      writeFileSync(candidate, "x".repeat(before.size));
      utimesSync(candidate, fixedTime, fixedTime);
      changed = true;
    }
    return count;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => hashCandidateLibrary(f.root, "release-core"),
      /changed while hashing/,
    );
    assert.equal(changed, true);
    const after = lstatSync(candidate);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.notEqual(after.ctimeMs, before.ctimeMs);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("real generated CMake relative symlink permits a core checkpoint but no runtime acceptance", (t) => {
  const f = fixture(t);
  f.advance("prepare");
  f.store.begin("release-core", f.store.hash("prepare"));
  f.write("llvm-build/lib/libLLVM.so.1", "synthetic candidate");
  if (
    !fileLink(t, "libLLVM.so.1", join(f.root, "llvm-build/lib/libLLVM.so.19.1"))
  )
    return;
  f.write("llvm-early-abi.json", f.abi);
  const result = f.store.finish("release-core");
  assert.equal(result.receipt.runtimeAcceptance, false);
  assert.equal(result.receipt.unitAcceptance, false);
  assert.equal(result.receipt.packageAcceptance, false);
  assert.equal(result.receipt.deploymentAcceptance, false);
  assert.deepEqual(hashCandidateLibrary(f.root, "release-core"), {
    sha256: f.abi.candidateSha256,
    bytes: 19,
  });
  f.store.begin("release-units", result.sha256);
  f.store.finish("release-units");
});

test("candidate link hashing supports bounded same-directory chains and the exact packaged location", (t) => {
  const f = fixture(t);
  for (const [phase, directory] of [
    ["release-core", "llvm-build/lib"],
    ["final", "llvm-source/debian/libllvm19/usr/lib/x86_64-linux-gnu"],
  ]) {
    f.write(`${directory}/libLLVM.so.1`, "synthetic candidate");
    if (
      !fileLink(t, "libLLVM.so.1", join(f.root, directory, "libLLVM.so.19")) ||
      !fileLink(t, "libLLVM.so.19", join(f.root, directory, "libLLVM.so.19.1"))
    )
      return;
    assert.deepEqual(hashCandidateLibrary(f.root, phase), {
      sha256: f.abi.candidateSha256,
      bytes: 19,
    });
  }
});

test("absolute candidate link is accepted only inside the exact real library directory", (t) => {
  const f = fixture(t);
  f.write("llvm-build/lib/libLLVM.so.1", "synthetic candidate");
  if (
    !fileLink(
      t,
      join(f.root, "llvm-build/lib/libLLVM.so.1"),
      join(f.root, "llvm-build/lib/libLLVM.so.19.1"),
    )
  )
    return;
  assert.equal(
    hashCandidateLibrary(f.root, "release-core").sha256,
    f.abi.candidateSha256,
  );
});

test("a candidate symlink cannot certify bytes different from the retained ABI receipt", (t) => {
  const f = fixture(t);
  f.advance("prepare");
  f.store.begin("release-core", f.store.hash("prepare"));
  f.write("llvm-build/lib/libLLVM.so.1", "different actual candidate bytes");
  if (
    !fileLink(t, "libLLVM.so.1", join(f.root, "llvm-build/lib/libLLVM.so.19.1"))
  )
    return;
  f.write("llvm-early-abi.json", f.abi);
  assert.throws(
    () => f.store.finish("release-core"),
    /no longer describes candidate bytes/,
  );
  assert.throws(() => f.store.hash("release-core"), /ENOENT/);
  assert.throws(
    () => f.store.begin("release-core", f.store.hash("prepare")),
    /failed\/in-flight/,
  );
});

test("relative and absolute escapes never hash a foreign sibling even within the broader build root", (t) => {
  for (const absolute of [false, true]) {
    const f = fixture(t);
    f.write("scripts/libLLVM.so.1", "foreign synthetic bytes");
    mkdirSync(join(f.root, "llvm-build/lib"));
    const target = absolute
      ? join(f.root, "scripts/libLLVM.so.1")
      : "../../scripts/libLLVM.so.1";
    if (!fileLink(t, target, join(f.root, "llvm-build/lib/libLLVM.so.19.1")))
      return;
    assert.throws(
      () => hashCandidateLibrary(f.root, "release-core"),
      /escapes its exact library directory/,
    );
  }
});

test("every candidate chain hop rejects an escape and lexical outside-and-back targets", (t) => {
  for (const target of ["../../scripts/libLLVM.so.1", "../lib/libLLVM.so.1"]) {
    const f = fixture(t);
    f.write("llvm-build/lib/libLLVM.so.2", "synthetic candidate");
    f.write("scripts/libLLVM.so.1", "foreign synthetic candidate");
    if (
      !fileLink(t, target, join(f.root, "llvm-build/lib/libLLVM.so.1")) ||
      !fileLink(
        t,
        "libLLVM.so.1",
        join(f.root, "llvm-build/lib/libLLVM.so.19.1"),
      )
    )
      return;
    assert.throws(
      () => hashCandidateLibrary(f.root, "release-core"),
      /escapes its exact library directory/,
    );
  }
});

test("candidate link cycles and overlong chains fail within the sixteen-link bound", (t) => {
  const cycle = fixture(t);
  mkdirSync(join(cycle.root, "llvm-build/lib"));
  if (
    !fileLink(
      t,
      "libLLVM.so.1",
      join(cycle.root, "llvm-build/lib/libLLVM.so.19.1"),
    ) ||
    !fileLink(
      t,
      "libLLVM.so.19.1",
      join(cycle.root, "llvm-build/lib/libLLVM.so.1"),
    )
  )
    return;
  assert.throws(
    () => hashCandidateLibrary(cycle.root, "release-core"),
    /symlink cycle/,
  );
  const depth = fixture(t);
  depth.write("llvm-build/lib/libLLVM.so.117", "synthetic candidate");
  if (
    !fileLink(
      t,
      "libLLVM.so.100",
      join(depth.root, "llvm-build/lib/libLLVM.so.19.1"),
    )
  )
    return;
  for (let number = 100; number < 117; number++) {
    if (
      !fileLink(
        t,
        `libLLVM.so.${number + 1}`,
        join(depth.root, `llvm-build/lib/libLLVM.so.${number}`),
      )
    )
      return;
  }
  assert.throws(
    () => hashCandidateLibrary(depth.root, "release-core"),
    /symlink depth exceeded/,
  );
});

test("dangling and arbitrary non-library link targets cannot enter a candidate receipt", (t) => {
  for (const target of ["libLLVM.so.404", "candidate.txt"]) {
    const f = fixture(t);
    f.write("llvm-build/lib/candidate.txt", "synthetic candidate");
    if (!fileLink(t, target, join(f.root, "llvm-build/lib/libLLVM.so.19.1")))
      return;
    assert.throws(
      () => hashCandidateLibrary(f.root, "release-core"),
      target.endsWith("404") ? /ENOENT/ : /escapes its exact library directory/,
    );
  }
});

test("a directory or an aliased library directory is never a regular candidate", (t) => {
  const special = fixture(t);
  mkdirSync(join(special.root, "llvm-build/lib/libLLVM.so.19.1"), {
    recursive: true,
  });
  assert.throws(
    () => hashCandidateLibrary(special.root, "release-core"),
    /Bounded regular candidate/,
  );
  const alias = fixture(t);
  alias.write("elsewhere/libLLVM.so.19.1", "synthetic candidate");
  symlinkSync(
    join(alias.root, "elsewhere"),
    join(alias.root, "llvm-build/lib"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(
    () => hashCandidateLibrary(alias.root, "release-core"),
    /directory cannot be aliased/,
  );
});

test("the candidate exception never relaxes ordinary baseline identity-file hashing", (t) => {
  const f = fixture(t);
  f.write("llvm-source/regular-baseline", "synthetic baseline");
  unlinkSync(join(f.root, "llvm-baseline-library"));
  if (
    !fileLink(
      t,
      "llvm-source/regular-baseline",
      join(f.root, "llvm-baseline-library"),
    )
  )
    return;
  f.store.begin("prepare");
  assert.throws(
    () => f.store.finish("prepare"),
    /Oversized\/nonregular identity file/,
  );
});
test("inventory is bounded, deterministic, file-content sensitive and rejects escaping links", (t) => {
  const f = fixture(t);
  const base = join(f.root, "llvm-source");
  const before = inventoryTree(base);
  assert.deepEqual(before, inventoryTree(base));
  assert.throws(() => inventoryTree(base, { maxFiles: 1 }), /file-count/);
  assert.throws(() => inventoryTree(base, { maxBytes: 1 }), /byte bound/);
  f.write("llvm-source/llvm/lib/source.cpp", "different synthetic content");
  assert.notEqual(inventoryTree(base).sha256, before.sha256);
  symlinkSync(
    join(f.root, "scripts"),
    join(base, "escaped"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => inventoryTree(base), /escapes owned root/);
});
test("default runtime retains complete recipe; checkpoint and diagnostic targets cannot donate packages", () => {
  const docker = readFileSync(
    new URL("../Dockerfile.api", import.meta.url),
    "utf8",
  );
  const script = readFileSync(
    new URL("./build-llvm-runtime.sh", import.meta.url),
    "utf8",
  );
  assert.match(
    docker,
    /FROM llvm-build-inputs AS llvm-build\r?\nRUN sh \/build\/scripts\/build-llvm-runtime.sh\r?\n/,
  );
  assert.match(docker, /COPY --from=llvm-build \/build\/libllvm19_/);
  assert.doesNotMatch(
    docker,
    /COPY --from=llvm-(?:checkpoint|release-core-only|configure-only)/,
  );
  assert.match(script, /--predecessor-sha256 "\$checkpoint_predecessor"/);
  const final = script.slice(
    script.indexOf(
      'test "$build_mode" = complete || test "$checkpoint_phase" = final',
    ),
  );
  assert.match(
    final,
    /timeout 1800 cmake --build \/build\/llvm-build[^\n]+check-llvm-unit/,
  );
  assert.match(
    final,
    /timeout 7200 cmake --build \/build\/llvm-assert-build[^\n]+check-llvm-unit/,
  );
  assert.ok(final.indexOf("record-units") > final.indexOf("check-llvm-unit"));
  assert.ok(
    final.indexOf("finish final") >
      final.indexOf("dpkg-deb --root-owner-group --build"),
  );
  assert.equal(
    (script.match(/node \/build\/scripts\/check-llvm-package\.mjs/g) ?? [])
      .length,
    3,
  );
  assert.match(
    script,
    /if test "\$build_mode" = checkpoint && test "\$checkpoint_phase" = prepare; then\r?\n\s+node "\$checkpoint" begin --phase prepare/,
  );
  assert.match(
    script,
    /if test "\$build_mode" = checkpoint; then\r?\n\s+cp \/usr\/lib\/x86_64-linux-gnu\/libLLVM.so.19.1/,
  );
  assert.match(
    script,
    /if test "\$build_mode" = checkpoint && test "\$checkpoint_phase" = "\$phase"; then\r?\n\s+node "\$checkpoint" compile/,
  );
  assert.match(
    final,
    /if test "\$build_mode" = checkpoint; then\r?\n\s+timeout 1800 cmake --build/,
  );
  assert.match(
    final,
    /if test "\$build_mode" = checkpoint; then node "\$checkpoint" record-units; fi/,
  );
  assert.doesNotMatch(
    script,
    /if test "\$build_mode" = complete; then.*(?:begin|finish|compile|plan)/,
  );
});
test("actual default shell sequence runs each full suite once; optional final reruns both and errors stop certification", () => {
  const script = readFileSync(
    new URL("./build-llvm-runtime.sh", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const start = script.indexOf(
    'if test "$build_mode" != checkpoint || test "$checkpoint_phase" = release-core; then',
  );
  const end = script.indexOf("timeout 10 /lib64/ld-linux-x86-64.so.2", start);
  assert.ok(start > 0 && end > start);
  const sequence = script.slice(start, end);
  const fixture = `set -eu
native_jobs=2
checkpoint=/build/scripts/native-llvm-checkpoint.mjs
cd() { return 0; }
timeout() {
  printf '%s\\n' "timeout:$*"
  case "$*" in
    *'--target LLVM llvm-config') if test "$FAILURE" = core; then return 71; fi ;;
    *'/build/llvm-build '*'--target check-llvm-unit') if test "$FAILURE" = release; then return 73; fi ;;
    *'/build/llvm-assert-build '*'--target check-llvm-unit') if test "$FAILURE" = assertions; then return 74; fi ;;
    *) return 79 ;;
  esac
}
node() {
  printf '%s\\n' "node:$*"
  if test "$FAILURE" = abi; then return 72; fi
}
${sequence}`;
  const shell =
    process.platform === "win32"
      ? "C:/Program Files/Git/bin/bash.exe"
      : "/bin/sh";
  const run = (mode, failure = "none") =>
    spawnSync(shell, ["-s"], {
      input: fixture,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 8192,
      windowsHide: true,
      env: {
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
        build_mode: mode,
        checkpoint_phase: mode === "checkpoint" ? "final" : "",
        FAILURE: failure,
      },
    });
  const complete = run("complete");
  assert.ifError(complete.error);
  assert.equal(complete.status, 0, complete.stderr);
  assert.equal(
    (complete.stdout.match(/--target LLVM llvm-config/g) ?? []).length,
    1,
  );
  assert.equal(
    (
      complete.stdout.match(
        /\/build\/llvm-build --parallel 2 --target check-llvm-unit/g,
      ) ?? []
    ).length,
    1,
  );
  assert.equal(
    (
      complete.stdout.match(
        /\/build\/llvm-assert-build --parallel 2 --target check-llvm-unit/g,
      ) ?? []
    ).length,
    1,
  );
  assert.doesNotMatch(complete.stdout, /native-llvm-checkpoint|record-units/);
  const final = run("checkpoint");
  assert.ifError(final.error);
  assert.equal(final.status, 0, final.stderr);
  assert.equal((final.stdout.match(/check-llvm-unit/g) ?? []).length, 2);
  assert.doesNotMatch(final.stdout, /LLVM llvm-config/);
  assert.ok(
    final.stdout
      .trimEnd()
      .endsWith("node:/build/scripts/native-llvm-checkpoint.mjs record-units"),
  );
  for (const [failure, status] of [
    ["core", 71],
    ["abi", 72],
    ["release", 73],
    ["assertions", 74],
  ]) {
    const result = run("complete", failure);
    assert.equal(result.status, status, result.stderr);
    assert.doesNotMatch(result.stdout, /record-units|finish final|dpkg-deb/);
  }
  for (const [failure, status] of [
    ["release", 73],
    ["assertions", 74],
  ]) {
    const result = run("checkpoint", failure);
    assert.equal(result.status, status, result.stderr);
    assert.doesNotMatch(result.stdout, /record-units|finish final|dpkg-deb/);
  }
});
