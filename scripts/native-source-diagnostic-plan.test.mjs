// Synthetic envelope and VM-only tests. No retained cloud metadata, native
// filesystem, database, Docker, credentials or network is used by this suite.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script, createContext, runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { historicalNativeV1RecipeFixture } from "./native-v1-recipe-test-fixture.mjs";
import { historicalRuntimeDockerfileFixture } from "./historical-runtime-dockerfile-test-fixture.mjs";
import test from "node:test";
import { planNativeSourceDiagnostic } from "./native-source-diagnostic-plan.mjs";
import {
  planNativeFreshPrepare,
  FRESH_NATIVE_SCRIPT_LF_HASHES,
  unpackFreshPrepareOperation,
} from "./native-builder-fresh-prepare.mjs";
import { planNativeFreshCore } from "./native-builder-fresh-core.mjs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const falseFlags = {
  unitAcceptance: false,
  packageAcceptance: false,
  runtimeAcceptance: false,
  authenticatedAcceptance: false,
  deploymentAcceptance: false,
};
const moduleNames = [
  "native-source-inventory-observer.mjs",
  "native-source-diagnostic-transport.mjs",
];
const rootFixtureUrl = new URL(
  "./native-builder-fresh-next-phase.test.mjs",
  import.meta.url,
);
// Reuse the established SYNTHETIC original prepare/core envelope builder.
// Evaluate only its exact private zip/fixture declarations, not its tests.
const fixtureText = readFileSync(rootFixtureUrl, "utf8").replaceAll(
  "\r\n",
  "\n",
);
const start = fixtureText.indexOf("function zip(entries) {"),
  end = fixtureText.indexOf("\nconst requireNative =");
assert.ok(start >= 0 && end > start);
const fixtureDeclarations = fixtureText
  .slice(start, end)
  .replaceAll("import.meta.url", "fixtureUrl")
  .replace(
    'compilerSha256: "c".repeat(64)',
    'compilerSha256: hash("synthetic compiler")',
  )
  .replace(
    'installedPackagesSha256: "d".repeat(64)',
    'installedPackagesSha256: hash("synthetic packages")',
  )
  .replace(
    'baselineSha256: "e".repeat(64)',
    'baselineSha256: hash("synthetic baseline")',
  )
  .replace(
    'cache: "f".repeat(64), commands: "1".repeat(64)',
    'cache: hash("release-cache"), commands: hash("release-commands")',
  )
  .replace(
    'cache: "2".repeat(64), commands: "3".repeat(64)',
    'cache: hash("assertion-cache"), commands: hash("assertion-commands")',
  )
  .replace(
    'assertionPlanSha256: "4".repeat(64)',
    'assertionPlanSha256: hash("assertion-plan")',
  );
function fixture() {
  const f = runInNewContext(fixtureDeclarations + "\nfixture()", {
    hash,
    encode: (x) => Buffer.from(JSON.stringify(x) + "\n"),
    commit: "a".repeat(40),
    falseFlags,
    Buffer,
    URL,
    fixtureUrl: rootFixtureUrl,
    readFileSync,
    // Exact historical v1 synthetic recipe admission, not a production bypass.
    historicalNativeV1RecipeFixture,
    historicalRuntimeDockerfileFixture,
    planNativeFreshPrepare,
    planNativeFreshCore: (input) => planNativeFreshCore(clone(input)),
    FRESH_NATIVE_SCRIPT_LF_HASHES,
  });
  const modules = Object.fromEntries(
    moduleNames.map((name) => {
      const b = readFileSync(new URL("./" + name, import.meta.url));
      return [name, { base64: b.toString("base64"), sha256: hash(b) }];
    }),
  );
  const input = {
    core: clone({
      completed: f.completed,
      expected: f.expected,
      plan: f.plan,
      planningInput: f.input,
    }),
    modules,
    budget: {
      mode: "bounded-probe",
      containerSeconds: 2280,
      postContainerReserveSeconds: 90,
      totalSeconds: 2520,
    },
  };
  const plan = planNativeSourceDiagnostic(input);
  const files = {
    ...f.files,
    "/build/llvm-baseline-library": Buffer.from("synthetic baseline"),
    "/usr/lib/llvm-19/bin/clang": Buffer.from("synthetic compiler"),
    "/build/llvm-build/CMakeCache.txt": Buffer.from("release-cache"),
    "/build/llvm-build/compile_commands.json": Buffer.from("release-commands"),
    "/build/llvm-assert-build/CMakeCache.txt": Buffer.from("assertion-cache"),
    "/build/llvm-assert-build/compile_commands.json":
      Buffer.from("assertion-commands"),
    "/build/llvm-assertion-partitions.json": Buffer.from("assertion-plan"),
  };
  const dir = "/tmp/native-source-diag-" + plan.planSha256;
  for (const name of moduleNames)
    files[dir + "/" + name] = Buffer.from(modules[name].base64, "base64");
  return { input, plan, files, dir };
}
const requireReal = createRequire(import.meta.url);
function virtual(program, files = {}, extra = {}) {
  const storage = new Map(
      Object.entries(files).map(([name, b]) => [
        name,
        Buffer.isBuffer(b) ? b : Buffer.from(b),
      ]),
    ),
    printed = [],
    calls = [],
    directories = new Set();
  let realmParse;
  const fs = {
    existsSync: (p) => storage.has(p) || directories.has(p),
    realpathSync: (p) => p,
    lstatSync: (p) => {
      const directory =
        directories.has(p) ||
        [...storage.keys()].some((n) => n.startsWith(p + "/"));
      assert.ok(storage.has(p) || directory, "Synthetic path required: " + p);
      return {
        size: storage.get(p)?.length ?? 0,
        isFile: () => !directory,
        isDirectory: () => directory,
        isSymbolicLink: () => false,
      };
    },
    readFileSync: (p) => {
      assert.ok(storage.has(p));
      return storage.get(p);
    },
    readdirSync: (p) =>
      realmParse(
        JSON.stringify(
          [...storage.keys()]
            .filter(
              (n) =>
                n.startsWith(p + "/") && !n.slice(p.length + 1).includes("/"),
            )
            .map((n) => n.slice(p.length + 1)),
        ),
      ),
    writeFileSync: (p, b, o) => {
      assert.equal(o.flag, "wx");
      assert.ok(!storage.has(p));
      storage.set(p, Buffer.from(b));
    },
    mkdirSync: (p, o) => {
      assert.equal(o.recursive, false);
      assert.ok(!directories.has(p));
      directories.add(p);
    },
    statfsSync: () => ({ bavail: 80n * 1024n ** 3n, bsize: 1n }),
  };
  const process = {
    execPath: "node",
    env: { VAETTIR_RELEASE_COMMIT: "a".repeat(40) },
    hrtime: { bigint: () => 1000n * 1000000000n },
    stdout: { write: (x) => printed.push(x) },
  };
  const context = createContext({
    Buffer,
    TextDecoder,
    console: { log: (x) => printed.push(x), error: (x) => printed.push(x) },
    process,
    require: (name) => {
      if (name === "node:fs") return fs;
      if (name === "node:child_process")
        return {
          spawnSync: (...args) => {
            calls.push(args);
            return { status: 0, signal: null };
          },
          execFileSync: (cmd, args) => {
            calls.push([cmd, args]);
            if (cmd === "clang++-19")
              return "Debian clang version 19.1.7 (3+b1)\n";
            if (cmd === "dpkg-query")
              return args.includes("clang-19")
                ? "1:19.1.7-3+b1"
                : "synthetic packages";
            return "5\n";
          },
        };
      assert.ok(
        ["node:assert/strict", "node:crypto", "node:zlib"].includes(name),
      );
      return requireReal(name);
    },
    ...extra,
  });
  realmParse = new Script("JSON.parse").runInContext(context);
  return {
    storage,
    printed,
    calls,
    process,
    context,
    fs,
    realmParse,
    run: () => new Script(program).runInContext(context, { timeout: 2000 }),
  };
}

test("deterministic complete verified-core identity and diagnostic-only contract", () => {
  const { input, plan } = fixture();
  assert.deepEqual(plan, planNativeSourceDiagnostic(input));
  const core = JSON.parse(
    Buffer.from(input.core.completed.proof.receiptBase64, "base64"),
  );
  assert.deepEqual(plan.identity.expectedSource, core.inputs.source);
  assert.deepEqual(plan.scope.expectedSource, core.inputs.source);
  assert.equal(
    plan.scope.parentReceiptSha256,
    input.core.expected.receiptSha256,
  );
  assert.equal(
    plan.scope.parentImageConfigDigest,
    input.core.expected.imageConfigDigest,
  );
  for (const [key, value] of Object.entries(falseFlags))
    assert.equal(plan[key], value);
  assert.equal(plan.successorImageSupported, false);
  assert.equal(plan.afterGuaranteed, false);
  assert.equal(plan.dispatchRequiresRootPreflight, true);
  assert.equal(plan.request.autoRetryLimitOverride, 0);
  assert.equal(plan.request.timeoutInMinutesOverride, 45);
  assert.equal(plan.request.computeTypeOverride, "BUILD_GENERAL1_LARGE");
  assert.ok(Buffer.byteLength(plan.request.buildspecOverride) <= 25600);
  assert.equal(unpackFreshPrepareOperation(plan.transport), plan.operation);
  assert.equal(plan.requestSha256, hash(JSON.stringify(plan.request)));
  assert.equal(plan.buildspecSha256, hash(plan.request.buildspecOverride));
  console.info(
    "SYNTHETIC_DIAGNOSTIC_REQUEST_BYTES=" +
      Buffer.byteLength(plan.request.buildspecOverride),
  );
});

test("failed/core-only/forged manifest/config/ABI/mixed source and substituted recipe refuse", () => {
  const { input } = fixture();
  for (const mutate of [
    (x) => {
      x.core.completed.status = "FAILED";
    },
    (x) => {
      x.core.completed.registryConfigBase64 =
        Buffer.from("{}").toString("base64");
    },
    (x) => {
      x.core.completed.registryManifest.images[0].imageManifest = "{}";
    },
    (x) => {
      x.core.completed.sourceCommit = "f".repeat(40);
    },
    (x) => {
      x.core.completed.proof.candidateSha256 = "f".repeat(64);
    },
    (x) => {
      x.core.completed.receiptChain.reverse();
    },
    (x) => {
      x.core.plan.identity.expectedScripts["build-llvm-runtime.sh"] =
        "f".repeat(64);
    },
    (x) => {
      x.core.expected.imageDigest = "sha256:" + "f".repeat(64);
    },
    (x) => {
      x.core.completed.runtimeAcceptance = true;
    },
  ]) {
    const bad = clone(input);
    mutate(bad);
    assert.throws(() => planNativeSourceDiagnostic(bad));
  }
});

test("module bytes/canonical encoding, closure keys and immutable full budget refuse tamper", () => {
  const { input } = fixture();
  for (const mutate of [
    (x) => {
      x.modules[moduleNames[0]].sha256 = "f".repeat(64);
    },
    (x) => {
      x.modules[moduleNames[1]].base64 += "\n";
    },
    (x) => {
      x.modules["foreign.mjs"] = x.modules[moduleNames[0]];
    },
    (x) => {
      x.modules[moduleNames[1]].extra = true;
    },
    (x) => {
      x.modules[moduleNames[1]].base64 = "";
    },
    (x) => {
      x.budget.containerSeconds++;
    },
    (x) => {
      x.budget.postContainerReserveSeconds = 45;
    },
    (x) => {
      x.budget.totalSeconds = 2700;
    },
    (x) => {
      x.budget.mode = "measured";
    },
    (x) => {
      x.extra = "unapproved";
    },
  ]) {
    const bad = clone(input);
    mutate(bad);
    assert.throws(() => planNativeSourceDiagnostic(bad));
  }
});

test("all actual emitted programs parse; decoder executes exact bytes without a real process", () => {
  const { plan } = fixture();
  for (const program of Object.values(plan.generatedPrograms))
    new Script(program);
  const vm = virtual(plan.generatedPrograms.decoder);
  vm.run();
  assert.equal(vm.calls.length, 1);
  assert.equal(vm.calls[0][0], "/bin/bash");
  assert.equal(vm.calls[0][1][4], plan.operation);
  assert.equal(vm.calls[0][2].timeout, 2550000);
  assert.equal(vm.calls[0][2].stdio, "inherit");
});

test("actual compact decoder refuses tampered bytes/canonical encoding/deadlines before any process", () => {
  const { plan } = fixture();
  for (const mutate of [
    (t) => {
      t.compressedSha256 = "f".repeat(64);
    },
    (t) => {
      t.decodedSha256 = "f".repeat(64);
    },
    (t) => {
      t.base64 += "\n";
    },
    (t) => {
      t.decodedBytes++;
    },
    (t) => {
      t.compressedBytes++;
    },
    (t) => {
      t.encoding = "unknown";
    },
    (t) => {
      t.decodedBytes = 524289;
    },
    (t) => {
      t.extra = true;
    },
  ]) {
    const changed = clone(plan.transport);
    mutate(changed);
    const program = plan.generatedPrograms.decoder.replace(
      JSON.stringify(plan.transport),
      JSON.stringify(changed),
    );
    assert.notEqual(program, plan.generatedPrograms.decoder);
    const vm = virtual(program);
    assert.throws(() => vm.run());
    assert.equal(vm.calls.length, 0);
  }
});

test("generated shell LF/CRLF syntax, original command and owned cleanup are preserved", () => {
  const { plan } = fixture();
  const bash =
    process.platform === "win32"
      ? "C:/Program Files/Git/bin/bash.exe"
      : "/bin/bash";
  for (const shell of [
    plan.operation,
    plan.operation.replaceAll("\n", "\r\n"),
  ]) {
    const syntax = spawnSync(bash, ["-n"], {
      input: shell,
      encoding: "utf8",
      timeout: 5000,
    });
    assert.ifError(syntax.error);
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  assert.match(plan.operation, /timeout --signal=TERM --kill-after=75s 2445s/);
  assert.ok(
    plan.generatedPrograms.runner.includes(
      "'1980s','sh','/build/scripts/build-llvm-runtime.sh','--phase','release-units','--predecessor-sha256'",
    ),
  );
  assert.equal(plan.identity.resources.originalUnitGateSeconds, 1800);
  assert.equal(plan.identity.resources.cleanupGraceSeconds, 75);
  assert.equal(plan.identity.resources.containerSeconds, 2280);
  assert.ok(
    !/docker (commit|push|tag|build)|aws s3api|--phase final|checkpointStore/.test(
      plan.operation,
    ),
  );
  assert.ok(
    plan.operation.includes(
      "--network none --cap-drop ALL --security-opt no-new-privileges",
    ),
  );
  assert.ok(plan.operation.includes("--memory 14g --cpus 8"));
  assert.ok(
    plan.operation.includes("docker cp native-source-diagnostic-proof/modules"),
  );
  assert.ok(!/docker cp.*:\/build/.test(plan.operation));
});

test("generated module materialization checks exact hashes and creates only owned proof files", () => {
  const { input, plan } = fixture(),
    vm = virtual(plan.generatedPrograms.modules);
  vm.run();
  for (const name of moduleNames) {
    const b = vm.storage.get("native-source-diagnostic-proof/modules/" + name);
    assert.equal(hash(b), input.modules[name].sha256);
  }
  assert.throws(() => vm.run());
  assert.ok(
    [...vm.storage.keys()].every((name) =>
      name.startsWith("native-source-diagnostic-proof/modules/"),
    ),
  );
});

test("actual admission refuses late elapsed time instead of borrowing historical timing", () => {
  const { plan } = fixture();
  const admission = {
    planSha256: plan.planSha256,
    startedNs: (950n * 1000000000n).toString(),
  };
  virtual(plan.generatedPrograms.admit, {
    "native-source-diagnostic-proof/admission.json": JSON.stringify(admission),
  }).run();
  admission.startedNs = (924n * 1000000000n).toString();
  assert.throws(
    () =>
      virtual(plan.generatedPrograms.admit, {
        "native-source-diagnostic-proof/admission.json":
          JSON.stringify(admission),
      }).run(),
    /Remaining observed deadline/,
  );
  assert.equal(plan.identity.resources.postContainerReserveSeconds, 90);
});

test("generated manifest/digest pull/config labels/container boundary and cleanup ownership verify", () => {
  const { input, plan } = fixture(),
    prefix = "native-source-diagnostic-proof/",
    id = "1".repeat(64);
  const inspected = {
    Id: input.core.expected.imageConfigDigest,
    Os: "linux",
    Architecture: "amd64",
    RepoDigests: [plan.importedImage],
    Size: 20000,
    Config: {
      Labels: JSON.parse(
        Buffer.from(input.core.completed.registryConfigBase64, "base64"),
      ).config.Labels,
    },
  };
  virtual(plan.generatedPrograms.manifest, {
    [prefix + "parent-manifest.json"]: JSON.stringify(
      input.core.completed.registryManifest,
    ),
  }).run();
  virtual(plan.generatedPrograms.inspect, {
    [prefix + "parent-inspect.json"]: JSON.stringify([inspected]),
  }).run();
  for (const mutate of [
    (x) => {
      x.RepoDigests = [];
    },
    (x) => {
      x.Id = "sha256:" + "f".repeat(64);
    },
    (x) => {
      x.Config.Labels["vaettir.runtime-eligible"] = "true";
    },
  ]) {
    const bad = clone(inspected);
    mutate(bad);
    assert.throws(() =>
      virtual(plan.generatedPrograms.inspect, {
        [prefix + "parent-inspect.json"]: JSON.stringify([bad]),
      }).run(),
    );
  }
  const container = {
    Id: id,
    Image: input.core.expected.imageConfigDigest,
    Config: {
      Image: plan.importedImage,
      Labels: { "vaettir.source-diag-owner": plan.planSha256 },
    },
    Mounts: [],
    HostConfig: {
      NetworkMode: "none",
      Privileged: false,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      Memory: 15032385536,
      NanoCpus: 8000000000,
      PidsLimit: 2048,
    },
  };
  const files = {
    [prefix + "container-id"]: id,
    [prefix + "container-inspect.json"]: JSON.stringify([container]),
    [prefix + "cleanup-inspect.json"]: JSON.stringify([container]),
  };
  virtual(plan.generatedPrograms.containerInspect, files).run();
  virtual(plan.generatedPrograms.cleanup, files).run();
  for (const mutate of [
    (x) => {
      x.Mounts = [{ Source: "/host" }];
    },
    (x) => {
      x.HostConfig.NetworkMode = "host";
    },
    (x) => {
      x.Config.Labels["vaettir.source-diag-owner"] = "f".repeat(64);
    },
    (x) => {
      x.Id = "2".repeat(64);
    },
  ]) {
    const bad = clone(container);
    mutate(bad);
    assert.throws(() =>
      virtual(plan.generatedPrograms.containerInspect, {
        ...files,
        [prefix + "container-inspect.json"]: JSON.stringify([bad]),
      }).run(),
    );
  }
});

test("supplemental stable-body rechecks actual bounded files, receipt chain and candidate without writes", () => {
  const { plan, files } = fixture();
  const program =
    plan.generatedPrograms.stableBody +
    ";stable(syntheticInventory,syntheticCandidate);";
  const make = (ownedFiles) => {
    const vm = virtual(program, ownedFiles);
    vm.context.syntheticInventory = (path) =>
      vm.realmParse(
        JSON.stringify(
          path.endsWith("scripts")
            ? plan.identity.coreInputs.scripts
            : plan.identity.coreInputs.signedSources,
        ),
      );
    vm.context.syntheticCandidate = () => ({
      sha256: plan.identity.coreCandidateSha256,
    });
    return vm;
  };
  const good = make(files);
  good.run();
  assert.equal(good.storage.size, Object.keys(files).length);
  for (const name of [
    "/build/llvm-baseline-library",
    "/build/llvm-build/CMakeCache.txt",
    "/build/llvm-early-abi.json",
    "/build/llvm-phase-receipts/prepare.json",
    "/usr/lib/llvm-19/bin/clang",
  ]) {
    const bad = { ...files, [name]: Buffer.from("tampered") };
    assert.throws(() => make(bad).run());
  }
});

test("actual generated runner retains recipe1/124 separately and attempts AFTER without acceptance", async () => {
  for (const status of [0, 1, 124]) {
    const { plan, files, dir } = fixture(),
      order = [];
    const program = plan.generatedPrograms.runner.replaceAll(
      "await import(",
      "await syntheticImport(",
    );
    assert.equal(
      (plan.generatedPrograms.runner.match(/await import\(/g) ?? []).length,
      3,
    );
    const vm = virtual(program, files),
      requireBase = vm.context.require;
    vm.context.require = (name) =>
      name !== "node:child_process"
        ? requireBase(name)
        : {
            ...requireBase(name),
            spawnSync: (...args) => {
              order.push("recipe");
              vm.calls.push(args);
              return { status, signal: null };
            },
          };
    vm.context.syntheticImport = async (path) => {
      if (path === "/build/scripts/native-llvm-checkpoint.mjs")
        return {
          inventoryTree: (path) =>
            vm.realmParse(
              JSON.stringify(
                path === "/build/scripts"
                  ? plan.identity.coreInputs.scripts
                  : path === "/build/llvm-sources"
                    ? plan.identity.coreInputs.signedSources
                    : path === "/build/llvm-build"
                      ? plan.identity.coreState.release
                      : plan.identity.coreState.assertions,
              ),
            ),
          hashCandidateLibrary: () => ({
            sha256: plan.identity.coreCandidateSha256,
          }),
        };
      if (path === dir + "/" + moduleNames[0])
        return {
          captureNativeSourceInventory: (scope, stage) => {
            order.push(stage);
            assert.deepEqual(
              clone(scope.expectedSource),
              plan.identity.expectedSource,
            );
            return { stage, scope };
          },
          diffNativeSourceInventories: (before, after) => {
            order.push("diff");
            assert.equal(before.stage, "BEFORE");
            assert.equal(after.stage, "AFTER");
            return { complete: true };
          },
        };
      assert.equal(path, dir + "/" + moduleNames[1]);
      return {
        encodeNativeSourceDiagnosticTransport: (
          { before, after, difference },
          scope,
        ) => {
          order.push("transport");
          assert.equal(before.stage, "BEFORE");
          assert.equal(after.stage, "AFTER");
          assert.equal(difference.complete, true);
          assert.deepEqual(clone(scope), plan.scope);
          return ["PUBLIC_NATIVE_SOURCE_DIAGNOSTIC_CHUNK=SYNTHETIC_FLOW_ONLY"];
        },
      };
    };
    await vm.run();
    assert.equal(vm.process.exitCode, undefined);
    assert.deepEqual(order, ["BEFORE", "recipe", "AFTER", "diff", "transport"]);
    assert.equal(vm.calls.filter((call) => call[0] === "timeout").length, 1);
    const call = vm.calls.find((call) => call[0] === "timeout");
    assert.deepEqual(clone(call[1]), [
      "--signal=TERM",
      "--kill-after=20s",
      "1980s",
      "sh",
      "/build/scripts/build-llvm-runtime.sh",
      "--phase",
      "release-units",
      "--predecessor-sha256",
      plan.identity.parent.receiptSha256,
    ]);
    const marker = vm.printed.filter((line) =>
      line.startsWith("PUBLIC_NATIVE_SOURCE_DIAGNOSTIC_STATUS="),
    );
    assert.equal(marker.length, 1);
    const actual = JSON.parse(marker[0].split("=")[1]);
    assert.equal(actual.recipeExitCode, status);
    assert.equal(actual.afterAttempted, true);
    assert.equal(actual.complete, true);
    for (const [key, value] of Object.entries(falseFlags))
      assert.equal(actual[key], value);
    assert.ok(
      !vm.printed.some((line) =>
        line.startsWith("NATIVE_FRESH_NEXT_VERIFIED="),
      ),
    );
  }
});

test("runner's AFTER failure preserves original exit and refuses incomplete transport", async () => {
  const { plan, files, dir } = fixture(),
    order = [];
  const vm = virtual(
      plan.generatedPrograms.runner.replaceAll(
        "await import(",
        "await syntheticImport(",
      ),
      files,
    ),
    base = vm.context.require;
  vm.context.require = (name) =>
    name !== "node:child_process"
      ? base(name)
      : { ...base(name), spawnSync: () => ({ status: 1, signal: null }) };
  vm.context.syntheticImport = async (path) =>
    path.startsWith("/build/scripts/")
      ? {
          inventoryTree: (p) =>
            vm.realmParse(
              JSON.stringify(
                p === "/build/scripts"
                  ? plan.identity.coreInputs.scripts
                  : p === "/build/llvm-sources"
                    ? plan.identity.coreInputs.signedSources
                    : p === "/build/llvm-build"
                      ? plan.identity.coreState.release
                      : plan.identity.coreState.assertions,
              ),
            ),
          hashCandidateLibrary: () => ({
            sha256: plan.identity.coreCandidateSha256,
          }),
        }
      : path === dir + "/" + moduleNames[0]
        ? {
            captureNativeSourceInventory: (_, stage) => {
              order.push(stage);
              if (stage === "AFTER")
                throw Error("Synthetic incomplete inventory");
              return {};
            },
            diffNativeSourceInventories: () => {
              throw Error("Must not diff incomplete capture");
            },
          }
        : {
            encodeNativeSourceDiagnosticTransport: () => {
              throw Error("Must not encode incomplete capture");
            },
          };
  await vm.run();
  assert.equal(vm.process.exitCode, 1);
  assert.deepEqual(order, ["BEFORE", "AFTER"]);
  const status = JSON.parse(
    vm.printed
      .find((line) =>
        line.startsWith("PUBLIC_NATIVE_SOURCE_DIAGNOSTIC_STATUS="),
      )
      .split("=")[1],
  );
  assert.equal(status.recipeExitCode, 1);
  assert.equal(status.afterAttempted, true);
  assert.equal(status.complete, false);
  assert.ok(
    !vm.printed.some((line) =>
      line.startsWith("PUBLIC_NATIVE_SOURCE_DIAGNOSTIC_CHUNK="),
    ),
  );
});

test("callable-only pure module never executes a filesystem/cloud/native command at import", () => {
  const source = readFileSync(
    new URL("./native-source-diagnostic-plan.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(!/from ["']node:(fs|child_process)/.test(source));
  assert.ok(!/process\.argv|await planNative/.test(source));
  let calls = 0;
  const unavailable = () => {
    calls++;
    throw Error("Import-time operation refused");
  };
  runInNewContext(
    source.replace(/^import .+;\r?$/gm, "").replace(/^export /gm, ""),
    {
      assert,
      Buffer,
      TextDecoder,
      createHash: unavailable,
      gzipSync: unavailable,
      validateNativeFreshCoreCompleted: unavailable,
      validateNativeCheckpointReceipt: unavailable,
      unpackFreshPrepareOperation: unavailable,
      nativeValidationShell: unavailable,
    },
  );
  assert.equal(calls, 0);
});
