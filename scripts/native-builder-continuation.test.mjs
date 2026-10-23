// Pure generated-program fixtures only; never AWS/Docker/native compilation.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { RECOVERED_PREPARE as pin, PREPARE_SCRIPT_HASHES, validateNativeCheckpointReceipt, validateRecoveredNativePrepare, nativeContinuationBudget, planNativeCoreContinuation, packNativeContinuationOperation, unpackNativeContinuationOperation } from "./native-builder-continuation.mjs";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value) + "\n");
// Public generated builder metadata, not a native binary/credential/customer.
const prepare = () => ({
  schemaVersion: 1, purpose: "llvm-builder-checkpoint-not-runtime", phase: "prepare", predecessorSha256: null,
  inputs: {
    scripts: { sha256: "d937ec5b75f8caff4ccf7f27e890e009ce33feb08de04ff8edf8f66b7967a827", entries: 9, bytes: 66707 },
    signedSources: { sha256: "1e9cd4fa75f796092c25ff3a77f733076db49b5c008c3b0879f6a2730f8b78f7", entries: 4, bytes: 164571853 },
    source: { sha256: "c378b24c5e77b76c056b9f057da9f5a3cb0c5c6bf0117046bf39b4d3eeb462e9", entries: 161504, bytes: 1654462757 },
    toolchain: { compilerSha256: "0a3c55936ac43954fbe4914e6e73b577ca9e35e75d89ef13d3e28c187f41ca1a", compiler: "Debian clang version 19.1.7 (3+b1)\nTarget: x86_64-pc-linux-gnu\nThread model: posix\nInstalledDir: /usr/lib/llvm-19/bin\n", compilerPackage: "1:19.1.7-3+b1", installedPackagesSha256: "e00f6a30355c506104f8e561b413d5371fb384df889c8ca73dccab45a9888d37" },
    baselineSha256: "3523f50f635d2a1ea47518a392451f2854b92823ceaf1345fb806099dd1a3b8a",
    configuration: [{ cache: "0b60570a7462e1dcec99d3742ee5062cf61dc4d6e9a24f872f55bac54474aebe", commands: "e1750005f56e4a6319ee2b8c938825c0d93c380f3969e9db413962d7fb94478b" }, { cache: "73324181ac55a75a01cff98561e0e1093e5d3f8482ffffac25c61e27e6152322", commands: "dc37ccfe55b3c241ab24d5f6927d2f23cc8e1abaafaf17d6615501c8ed902981" }],
    assertionPlanSha256: "9d925e87ba874e0ce83c6b7a76634bc8814d491773479c7ee3a2653dcd856dd3",
  },
  inputsSha256: pin.inputsSha256,
  state: { release: { sha256: "421e929d187ce0e1f50dfe3fe9977d7ff62ee82b79314ea58fba4dd6f572aab2", entries: 2111, bytes: 39538498 }, assertions: { sha256: "d03b51b688d0cca1407e73c8e35355e5a35841144178cd56b6c824e56c18fe30", entries: 2104, bytes: 40500991 } },
  proof: {}, unitAcceptance: false, packageAcceptance: false, runtimeAcceptance: false, authenticatedAcceptance: false, deploymentAcceptance: false,
});
const recovery = () => {
  const receipt = prepare();
  return { buildId: pin.recoveryBuildId, status: "SUCCEEDED", sourceCommit: pin.commit, sourceSha256: pin.sourceSha256, imageDigest: pin.imageDigest, imageConfigDigest: pin.imageConfigDigest, prepareReceiptSha256: pin.receiptSha256, buildspecSha256: pin.buildspecSha256, prepareReceipt: receipt, compiledAcceptance: false, unitAcceptance: false, packageAcceptance: false, runtimeAcceptance: false, authenticatedAcceptance: false, deploymentAcceptance: false,
    proof: { schemaVersion: 4, purpose: "recover-verified-builder-only-artifact", commit: pin.commit, sourceSha256: pin.sourceSha256, imageDigest: pin.imageDigest, imageConfigDigest: pin.imageConfigDigest, prepareReceiptSha256: pin.receiptSha256, expectedManifest: pin.manifestSha256, expectedScripts: { ...PREPARE_SCRIPT_HASHES }, originalBuildId: "vaettir-api-build:ec963576-90c3-4c11-8ae6-899a71d28357", priorRecoveryBuildId: "vaettir-api-build:f390c136-7a1a-48c1-8792-c06200af4b81", originalBuildStatus: "FAILED", hardenedHelperSha256: "c6cfa748761c4516978f842f0189669b835827727f18a3edd37b423a5ef3b660", independentCoreContext: { transferableAcceptance: false }, validation: "actual-pinned-inputs-and-state-recomputed", validatedInsideDisposableNetworkNoneContainer: true, receiptBase64: encode(receipt).toString("base64"), compiledAcceptance: false, unitAcceptance: false, packageAcceptance: false, runtimeAcceptance: false, authenticatedAcceptance: false, deploymentAcceptance: false } };
};
const budget = () => ({ mode: "bounded-probe", compilerJobs: 5, measuredCoreSeconds: 0, measuredTransportSeconds: 30, measuredInventorySeconds: 120, compileSeconds: 2100, totalSeconds: 2520 });
const options = () => ({ completedRecovery: recovery(), budget: budget() });

test("fixed public prepare metadata hashes exact externally retained receipt and inputs", () => {
  assert.equal(hash(encode(prepare())), pin.receiptSha256);
  assert.equal(hash(JSON.stringify(prepare().inputs)), pin.inputsSha256);
  assert.deepEqual(validateRecoveredNativePrepare(recovery()), prepare());
});
test("recovery build/source/manifest/config/archive/script/status claims refuse tamper and diagnostic donor", () => {
  for (const key of ["buildId", "sourceCommit", "sourceSha256", "imageDigest", "imageConfigDigest", "prepareReceiptSha256", "buildspecSha256", "status"]) {
    const value = recovery(); value[key] = "untrusted"; assert.throws(() => validateRecoveredNativePrepare(value));
  }
  for (const key of ["commit", "sourceSha256", "imageDigest", "imageConfigDigest", "prepareReceiptSha256", "expectedManifest", "validation", "originalBuildStatus"]) { const value = recovery(); value.proof[key] = "untrusted"; assert.throws(() => validateRecoveredNativePrepare(value)); }
  const bad = recovery(); bad.proof.expectedScripts["build-llvm-runtime.sh"] = "a".repeat(64); assert.throws(() => validateRecoveredNativePrepare(bad));
});
test("receipt encoding/content/size and unsupported runtime acceptance fail closed", () => {
  const wrong = recovery(); wrong.proof.receiptBase64 += "="; assert.throws(() => validateRecoveredNativePrepare(wrong));
  for (const scope of ["proof", "top"]) for (const key of ["compiledAcceptance", "unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"]) { const value = recovery(); (scope === "proof" ? value.proof : value)[key] = true; assert.throws(() => validateRecoveredNativePrepare(value)); }
  assert.throws(() => validateNativeCheckpointReceipt(Buffer.alloc(32769), { sha256: "a".repeat(64) }));
  const bad = prepare(); bad.unknown = true; const bytes = encode(bad); assert.throws(() => validateNativeCheckpointReceipt(bytes, { phase: "prepare", sha256: hash(bytes), predecessorSha256: null }));
});
test("supported receipt identity cannot substitute a different source/toolchain or predecessor", () => {
  const core = prepare(); core.phase = "release-core"; core.predecessorSha256 = pin.receiptSha256; core.proof = { abiReceiptSha256: "b".repeat(64) };
  const bytes = encode(core), expected = { phase: "release-core", sha256: hash(bytes), predecessorSha256: pin.receiptSha256, inputsSha256: pin.inputsSha256 };
  assert.equal(validateNativeCheckpointReceipt(bytes, expected).unitAcceptance, false);
  assert.throws(() => validateNativeCheckpointReceipt(bytes, { ...expected, predecessorSha256: "b".repeat(64) }));
  assert.throws(() => validateNativeCheckpointReceipt(bytes, { ...expected, inputsSha256: "b".repeat(64) }));
  for (const key of ["entries", "bytes"]) { const invalid = structuredClone(core); invalid.state.release[key] = Number.MAX_SAFE_INTEGER; const raw = encode(invalid); assert.throws(() => validateNativeCheckpointReceipt(raw, { ...expected, sha256: hash(raw) })); }
});
test("14GiB compiler cap preserves five jobs and refuses forecasts borrowed from six/four jobs", () => {
  const value = nativeContinuationBudget(budget()); assert.equal(value.cpus, 8); assert.equal(value.memoryBytes, 14 * 1024 ** 3);
  for (const compilerJobs of [4, 6, 24]) assert.throws(() => nativeContinuationBudget({ ...budget(), compilerJobs }));
  assert.throws(() => nativeContinuationBudget({ ...budget(), measuredCoreSeconds: 1959 }));
  assert.throws(() => nativeContinuationBudget({ ...budget(), totalSeconds: 2101 }));
  assert.throws(() => nativeContinuationBudget({ ...budget(), measuredTransportSeconds: 0 }));
  assert.throws(() => nativeContinuationBudget({ ...budget(), mode: "measured" }));
  assert.equal(nativeContinuationBudget({ ...budget(), mode: "measured", measuredCoreSeconds: 1959 }).mode, "measured");
});
test("planner produces deterministic existing-project builder-only request without a runtime donor", () => {
  const one = planNativeCoreContinuation(options()), two = planNativeCoreContinuation(options());
  assert.deepEqual(one, two); assert.equal(one.request.computeTypeOverride, "BUILD_GENERAL1_LARGE"); assert.equal(one.request.timeoutInMinutesOverride, 45);
  assert.equal(one.importedImage.endsWith(pin.imageDigest), true); assert.equal(one.defaultRuntimeGraphChanged, false); assert.equal(one.forecastAcceptance, false);
  for (const key of ["compiledAcceptance", "unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"]) assert.equal(one[key], false);
  for (const phase of ["prepare", "release-units", "assertion-compile-1", "final", "llvm-release-core-only"]) assert.throws(() => planNativeCoreContinuation({ ...options(), phase }));
  assert.notEqual(planNativeCoreContinuation({ ...options(), budget: { ...budget(), totalSeconds: 2500 } }).candidateTag, one.candidateTag);
});
test("one-shell transport uses exact owned IDs, source pin, no-network core recipe and actual successor inventory", () => {
  const plan = planNativeCoreContinuation(options()), spec = JSON.parse(plan.request.buildspecOverride), shell = unpackNativeContinuationOperation(plan.transport);
  assert.equal(spec.phases.build.commands.length, 1); assert.match(shell, /2520s bash -eu -o pipefail/);
  assert.match(spec.phases.build.commands[0], /^node -e '/);
  assert.equal(shell, plan.operation);
  assert.ok(Buffer.byteLength(plan.request.buildspecOverride) <= 25600);
  for (const literal of ["--memory 14g --cpus 8", "--memory 2g --cpus 2", "--network none", "--cap-drop ALL", "--security-opt no-new-privileges", "--phase release-core --predecessor-sha256", pin.receiptSha256, "cleanup_native_validation", "vaettir.continuation-owner", "predecessorImageDigest", "compiler-inspect.json", "verifier-inspect.json", "candidate-manifest.json", "ImageNotFound", "release-units", "begin("]) assert.ok(shell.includes(literal), literal);
  assert.doesNotMatch(shell, /describe-images|put-role-policy|update-project|ecs |migrate|:latest|check-llvm-unit/);
  assert.ok(shell.indexOf("state.log") < shell.indexOf("docker push"));
  assert.match(shell, /docker commit/); assert.match(shell, /batch-get-image/);
});

const nativeRequire = createRequire(import.meta.url);
const directory = "native-continuation-proof/";
function virtualProgram(program, files = {}, overrides = {}) {
  const storage = new Map(Object.entries(files).map(([name, value]) => [name, Buffer.isBuffer(value) ? value : Buffer.from(value)]));
  const printed = [], writes = [], calls = [];
  const fs = {
    lstatSync(name) {
      if (!storage.has(name)) throw new Error("ENOENT " + name);
      return { size: storage.get(name).length, isFile: () => true, isSymbolicLink: () => false };
    },
    readFileSync(name) { if (!storage.has(name)) throw new Error("ENOENT " + name); return storage.get(name); },
    writeFileSync(name, value, options) {
      assert.equal(options.flag, "wx"); assert.equal(storage.has(name), false, "No evidence overwrite");
      storage.set(name, Buffer.from(value)); writes.push(name);
    },
  };
  const context = {
    Buffer, TextDecoder,
    console: { log: value => printed.push(value), error: value => printed.push(value) },
    process: { execPath: process.execPath, stdout: { write: value => printed.push(value) } },
    require(name) {
      if (name === "node:fs") return fs;
      if (overrides[name]) return overrides[name];
      if (name === "node:child_process") return { spawnSync: (...args) => { calls.push(args); return { status: 0, signal: null }; }, execFileSync: () => { throw new Error("No real child process allowed in virtual fixture"); } };
      assert.ok(["node:assert/strict", "node:crypto", "node:zlib"].includes(name), "Bounded fixture module");
      return nativeRequire(name);
    },
  };
  return { run: () => new Script(program).runInNewContext(context, { timeout: 1000 }), storage, printed, writes, calls };
}
function coreFixture(plan) {
  const receipt = prepare(); receipt.phase = "release-core"; receipt.predecessorSha256 = pin.receiptSha256;
  receipt.proof = { abiReceiptSha256: "b".repeat(64) };
  const bytes = encode(receipt);
  return { bytes, marker: { planSha256: plan.planSha256, receiptSha256: hash(bytes), receiptBase64: bytes.toString("base64"), unitAcceptance: false, packageAcceptance: false, runtimeAcceptance: false } };
}
function collectFiles(plan, ending = "\n", change = value => value) {
  const core = coreFixture(plan), marker = change(structuredClone(core.marker));
  return { [directory + "release-core.json"]: core.bytes, [directory + "compile.log"]: "ordinary compiler output" + ending + "NATIVE_CONTINUATION_CORE=" + JSON.stringify(marker) + ending + "ordinary footer" + ending };
}
function readbackFiles(plan, ending = "\n") {
  const core = coreFixture(plan), id = "sha256:" + "c".repeat(64);
  const manifest = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.docker.distribution.manifest.v2+json", config: { digest: id }, layers: [{ digest: "sha256:" + "d".repeat(64), size: 123456 }] });
  const digest = "sha256:" + hash(manifest);
  const labels = { "vaettir.continuation-plan": plan.planSha256, "vaettir.source-commit": pin.commit, "vaettir.runtime-eligible": "false", "vaettir.artifact-purpose": "llvm-builder-checkpoint" };
  return {
    [directory + "release-core.json"]: core.bytes,
    [directory + "core-proof.json"]: encode(core.marker),
    [directory + "candidate-manifest.json"]: encode({ failures: [], images: [{ imageId: { imageDigest: digest, imageTag: plan.candidateTag }, imageManifest: manifest }] }),
    [directory + "candidate-inspect.json"]: encode([{ Id: id, Size: 345678, Config: { Labels: labels } }]),
    [directory + "commit-id.txt"]: id + "\n",
    [directory + "push.log"]: "pushing layers" + ending + "digest: " + digest + " size: 42" + ending,
    [directory + "state.log"]: "recomputed inventory" + ending + "NATIVE_CONTINUATION_STATE=" + JSON.stringify({ planSha256: plan.planSha256, receiptSha256: core.marker.receiptSha256, actualStateVerified: true, runtimeAcceptance: false }) + ending,
  };
}

test("all fourteen exact generated inline JavaScript programs parse, not just template strings", () => {
  const plan = planNativeCoreContinuation(options());
  assert.equal(Object.keys(plan.generatedPrograms).length, 14);
  for (const [name, program] of Object.entries(plan.generatedPrograms)) assert.doesNotThrow(() => new Script(program, { filename: name + ".generated.cjs" }), name);
});
test("generated core collector parses real LF and CRLF records and writes real newline JSON", () => {
  const plan = planNativeCoreContinuation(options());
  for (const ending of ["\n", "\r\n"]) {
    const fixture = virtualProgram(plan.generatedPrograms.collect, collectFiles(plan, ending)); fixture.run();
    assert.deepEqual(fixture.writes, [directory + "core-proof.json"]);
    const actual = fixture.storage.get(directory + "core-proof.json");
    assert.equal(actual.at(-1), 10); assert.notEqual(actual.subarray(-2).toString(), "\\n");
    assert.deepEqual(JSON.parse(actual), coreFixture(plan).marker);
  }
});
test("generated collector refuses duplicate/missing markers, mismatched exact bytes, plan and acceptance", () => {
  const plan = planNativeCoreContinuation(options());
  for (const change of [value => ({ ...value, planSha256: "e".repeat(64) }), value => ({ ...value, receiptSha256: "e".repeat(64) }), value => ({ ...value, receiptBase64: encode(prepare()).toString("base64") }), value => ({ ...value, unitAcceptance: true })]) {
    const fixture = virtualProgram(plan.generatedPrograms.collect, collectFiles(plan, "\n", change)); assert.throws(fixture.run); assert.equal(fixture.writes.length, 0);
  }
  for (const extra of ["", "\nNATIVE_CONTINUATION_CORE=" + JSON.stringify(coreFixture(plan).marker)]) {
    const files = collectFiles(plan); files[directory + "compile.log"] = extra ? files[directory + "compile.log"] + extra : "marker absent\n";
    const fixture = virtualProgram(plan.generatedPrograms.collect, files); assert.throws(fixture.run); assert.equal(fixture.writes.length, 0);
  }
});
test("generated registry readback binds actual candidate config, core bytes, plan and successor state", () => {
  const plan = planNativeCoreContinuation(options());
  for (const ending of ["\n", "\r\n"]) {
    const fixture = virtualProgram(plan.generatedPrograms.readback, readbackFiles(plan, ending)); fixture.run();
    assert.equal(fixture.printed.length, 1);
    const value = JSON.parse(fixture.printed[0].slice("NATIVE_CONTINUATION_VERIFIED=".length));
    assert.equal(value.planSha256, plan.planSha256); assert.equal(value.receiptSha256, hash(coreFixture(plan).bytes));
    assert.equal(value.predecessorImageDigest, pin.imageDigest); assert.equal(value.predecessorReceiptSha256, pin.receiptSha256);
    assert.equal(value.sourceCommit, pin.commit); assert.equal(value.sourceSha256, pin.sourceSha256);
    assert.equal(value.imageConfigDigest, "sha256:" + "c".repeat(64)); assert.equal(value.actualStateVerified, true);
    for (const key of ["unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"]) assert.equal(value[key], false);
  }
});
test("generated readback refuses coordinated stale-plan proofs, rewritten receipt, wrong candidate and duplicate state", () => {
  const plan = planNativeCoreContinuation(options());
  const mutations = [
    files => { const core = JSON.parse(files[directory + "core-proof.json"]); core.planSha256 = "e".repeat(64); files[directory + "core-proof.json"] = encode(core); files[directory + "state.log"] = "NATIVE_CONTINUATION_STATE=" + JSON.stringify({ planSha256: core.planSha256, receiptSha256: core.receiptSha256, actualStateVerified: true, runtimeAcceptance: false }) + "\n"; },
    files => { const core = JSON.parse(files[directory + "core-proof.json"]); core.unitAcceptance = true; files[directory + "core-proof.json"] = encode(core); },
    files => { files[directory + "release-core.json"] = encode(prepare()); },
    files => { files[directory + "commit-id.txt"] = "sha256:" + "e".repeat(64) + "\n"; },
    files => { const candidate = JSON.parse(files[directory + "candidate-manifest.json"]); candidate.images[0].imageId.imageTag = "another-tag"; files[directory + "candidate-manifest.json"] = encode(candidate); },
    files => { files[directory + "state.log"] += files[directory + "state.log"]; },
    files => { delete files[directory + "core-proof.json"]; },
  ];
  for (const mutate of mutations) { const files = readbackFiles(plan); mutate(files); const fixture = virtualProgram(plan.generatedPrograms.readback, files); assert.throws(fixture.run); assert.equal(fixture.printed.length, 0); }
});
test("exact gzip transport and generated decoder preserve reviewed single operation within real request limit", () => {
  const plan = planNativeCoreContinuation(options());
  assert.equal(unpackNativeContinuationOperation(plan.transport), plan.operation);
  assert.equal(plan.transport.decodedSha256, hash(plan.operation));
  assert.equal(plan.transport.decodedBytes, Buffer.byteLength(plan.operation));
  assert.ok(plan.transport.compressedBytes < plan.transport.decodedBytes);
  assert.ok(Buffer.byteLength(plan.request.buildspecOverride) <= 25600);
  const fixture = virtualProgram(plan.generatedPrograms.decoder); fixture.run();
  assert.equal(fixture.calls.length, 1);
  const [binary, args, settings] = fixture.calls[0];
  assert.equal(binary, "/bin/bash"); assert.deepEqual(Array.from(args), ["-eu", "-o", "pipefail", "-c", plan.operation]);
  assert.equal(settings.stdio, "inherit"); assert.equal(settings.timeout, 2580000); assert.equal(settings.killSignal, "SIGTERM");
  for (const response of [{ status: 124, signal: null }, { status: null, signal: "SIGTERM" }, { error: new Error("timeout") }]) assert.throws(() => virtualProgram(plan.generatedPrograms.decoder, {}, { "node:child_process": { spawnSync: () => response } }).run());
});
test("gzip operation decoder refuses hash/size/extra-key tamper, noncanonical encoding and expansion bombs", () => {
  const plan = planNativeCoreContinuation(options());
  for (const key of ["decodedSha256", "compressedSha256"]) assert.throws(() => unpackNativeContinuationOperation({ ...plan.transport, [key]: "e".repeat(64) }));
  for (const key of ["decodedBytes", "compressedBytes"]) assert.throws(() => unpackNativeContinuationOperation({ ...plan.transport, [key]: plan.transport[key] - 1 }));
  assert.throws(() => unpackNativeContinuationOperation({ ...plan.transport, extra: true }));
  assert.throws(() => unpackNativeContinuationOperation({ ...plan.transport, base64: plan.transport.base64 + "=" }));
  assert.throws(() => packNativeContinuationOperation("echo an ambient command"));
  const bomb = gzipSync(Buffer.alloc(512 * 1024 + 1, 65));
  assert.throws(() => unpackNativeContinuationOperation({ encoding: "gzip-base64-sha256-v1", decodedSha256: "e".repeat(64), decodedBytes: 512 * 1024, compressedSha256: hash(bomb), compressedBytes: bomb.length, base64: bomb.toString("base64") }), /larger than|too large|Cannot create/i);
});
test("generated owned operation and compressed decoder Bash grammar parse without running commands", () => {
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  const plan = planNativeCoreContinuation(options());
  const prefix = "timeout --signal=TERM --kill-after=30s 2520s bash -eu -o pipefail -c '";
  assert.ok(plan.operation.startsWith(prefix) && plan.operation.endsWith("'"));
  const inner = plan.operation.slice(prefix.length, -1).replaceAll("'\\''", "'");
  assert.ok(inner.startsWith("set -eu -o pipefail\n"));
  // stdin avoids Windows's command-line length ceiling and -n never evaluates.
  for (const source of [plan.operation, inner, JSON.parse(plan.request.buildspecOverride).phases.build.commands[0]]) {
    const result = spawnSync(bash, ["-n"], { input: source, encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
  }
});
test("generated post/ID/metadata/owned-container gates execute the exact programs against bounded fixtures", () => {
  const plan = planNativeCoreContinuation(options()), core = coreFixture(plan);
  const labels = { "vaettir.continuation-owner": plan.planSha256, "vaettir.continuation-plan": plan.planSha256, "vaettir.source-commit": pin.commit, "vaettir.runtime-eligible": "false", "vaettir.artifact-purpose": "llvm-builder-checkpoint" };
  const cid = "f".repeat(64), committed = "sha256:" + "c".repeat(64);
  const compiler = { Image: pin.imageConfigDigest, Config: { Labels: labels }, HostConfig: { NetworkMode: "none", Privileged: false, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], Memory: 14 * 1024 ** 3, NanoCpus: 8e9, PidsLimit: 2048 }, Mounts: [] };
  const verifier = structuredClone(compiler); verifier.Image = committed; verifier.Config.Image = committed; verifier.HostConfig.Memory = 2 * 1024 ** 3; verifier.HostConfig.NanoCpus = 2e9; verifier.HostConfig.PidsLimit = 128;
  const cases = [
    ["post", { "/build/llvm-phase-receipts/release-core.json": core.bytes }, "NATIVE_CONTINUATION_CORE=" + JSON.stringify(core.marker)],
    ["readId", { [directory + "container-id"]: cid + "\n" }, cid],
    ["readCommitId", { [directory + "commit-id.txt"]: committed + "\n" }, committed],
    ["inspect", { [directory + "parent-inspect.json"]: encode([{ Id: pin.imageConfigDigest, RepoDigests: [plan.importedImage], Size: 98765, Config: { Labels: labels } }]) }, undefined],
    ["container", { [directory + "compiler-inspect.json"]: encode([compiler]) }, undefined],
    ["verifierInspect", { [directory + "commit-id.txt"]: committed + "\n", [directory + "verifier-inspect.json"]: encode([verifier]) }, undefined],
    ["candidateCheck", readbackFiles(plan), undefined],
    ["absent", { [directory + "tag-preflight.json"]: encode({ images: [], failures: [{ failureCode: "ImageNotFound", imageId: { imageTag: plan.candidateTag } }] }) }, undefined],
  ];
  for (const [name, files, output] of cases) {
    const fixture = virtualProgram(plan.generatedPrograms[name], files); fixture.run();
    assert.deepEqual(fixture.printed, output === undefined ? [] : [output], name);
    assert.equal(fixture.writes.length, 0); assert.equal(fixture.calls.length, 0);
  }
  for (const name of ["pre", "manifest", "successor"]) {
    // No successful source/inventory claim: actual immutable files/checkpoint
    // import remain a network-none builder gate. Empty fixture must refuse
    // before compiler lookup, dynamic checkpoint import or any external call.
    const fixture = virtualProgram(plan.generatedPrograms[name]); assert.throws(fixture.run, /ENOENT/);
    assert.equal(fixture.printed.length, 0); assert.equal(fixture.calls.length, 0);
  }
});
test("generated owned-container and candidate gates refuse wrong IDs, mounts, network and privilege", () => {
  const plan = planNativeCoreContinuation(options());
  const badId = virtualProgram(plan.generatedPrograms.readId, { [directory + "container-id"]: "arbitrary container name\n" }); assert.throws(badId.run);
  const labels = { "vaettir.continuation-owner": plan.planSha256 };
  const base = { Image: pin.imageConfigDigest, Config: { Labels: labels }, HostConfig: { NetworkMode: "none", Privileged: false, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], Memory: 14 * 1024 ** 3, NanoCpus: 8e9, PidsLimit: 2048 }, Mounts: [] };
  for (const mutate of [value => { value.Image = "sha256:" + "e".repeat(64); }, value => { value.HostConfig.NetworkMode = "bridge"; }, value => { value.HostConfig.Privileged = true; }, value => { value.HostConfig.Memory = 0; }, value => { value.Mounts = [{ Source: "/" }]; }, value => { value.Config.Labels["vaettir.continuation-owner"] = "e".repeat(64); }]) {
    const value = structuredClone(base); mutate(value);
    const fixture = virtualProgram(plan.generatedPrograms.container, { [directory + "compiler-inspect.json"]: encode([value]) }); assert.throws(fixture.run);
    assert.equal(fixture.printed.length, 0);
  }
  const files = readbackFiles(plan), candidate = JSON.parse(files[directory + "candidate-inspect.json"]);
  candidate[0].Config.Labels["vaettir.runtime-eligible"] = "true"; files[directory + "candidate-inspect.json"] = encode(candidate);
  assert.throws(() => virtualProgram(plan.generatedPrograms.candidateCheck, files).run());
});
test("root must retain intent and live preflight; planner cannot dispatch or silently extend runtime graph", () => {
  const source = readFileSync(new URL("./native-builder-continuation.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /execFileSync\("aws"|spawnSync\("aws"|start-build|create-project|update-service/);
  assert.equal(planNativeCoreContinuation(options()).dispatchRequiresRootPreflight, true);
  assert.match(source, /Later phase transport and final verifier are not implemented here/);
});
