// Synthetic public builder metadata only. Never AWS/Docker/native compilation.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { RECOVERED_PREPARE as pin, unpackNativeContinuationOperation } from "./native-builder-continuation.mjs";
import { validateNativeNextPhaseParent, planNativeNextPhase } from "./native-builder-next-phase.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value) + "\n");
const phases = ["prepare", "release-core", "release-units", "assertion-compile-1", "assertion-compile-2", "assertion-compile-3"];
// Exact independently retained public prepare receipt. No binary or credential.
function prepare() {
  return {
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
  };
}
function fixture(next = "release-units") {
  const count = phases.indexOf(next);
  assert.ok(count >= 2);
  let previous = null;
  const chain = phases.slice(0, count).map(phase => {
    const receipt = prepare(); receipt.phase = phase; receipt.predecessorSha256 = previous;
    if (phase === "release-core") receipt.proof = { abiReceiptSha256: "b".repeat(64) };
    const bytes = encode(receipt), sha256 = hash(bytes); previous = sha256;
    return { phase, sha256, base64: bytes.toString("base64") };
  });
  const config = "sha256:" + "c".repeat(64), plan = "d".repeat(64);
  const manifest = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.docker.distribution.manifest.v2+json", config: { digest: config }, layers: [{ digest: "sha256:" + "e".repeat(64), size: 123456 }] });
  const imageDigest = "sha256:" + hash(manifest), last = JSON.parse(Buffer.from(chain.at(-1).base64, "base64"));
  const expected = { buildId: "vaettir-api-build:11111111-2222-3333-4444-555555555555", planSha256: plan, requestSha256: "a".repeat(64), buildspecSha256: "f".repeat(64), imageDigest, imageConfigDigest: config, receiptSha256: chain.at(-1).sha256 };
  const proof = { planSha256: plan, receiptSha256: expected.receiptSha256, receiptBase64: chain.at(-1).base64, sourceCommit: pin.commit, sourceSha256: pin.sourceSha256, predecessorImageDigest: count === 2 ? pin.imageDigest : "sha256:" + "a".repeat(64), predecessorReceiptSha256: last.predecessorSha256, imageDigest, imageConfigDigest: config, actualStateVerified: true, unitAcceptance: false, packageAcceptance: false, runtimeAcceptance: false, authenticatedAcceptance: false, deploymentAcceptance: false };
  if (count > 2) proof.phase = phases[count - 1];
  const completed = { schemaVersion: 1, purpose: "completed-native-builder-phase", status: "SUCCEEDED", ...expected, sourceCommit: pin.commit, sourceSha256: pin.sourceSha256, receiptChain: chain, proof,
    registryManifest: { failures: [], images: [{ imageId: { imageDigest }, imageManifest: manifest }] },
    imageInspectionMode: "DIGEST_PULLED",
    imageInspection: { Id: config, RepoDigests: ["051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api@" + imageDigest], Size: 234567, Config: { Labels: { "vaettir.source-commit": pin.commit, "vaettir.continuation-plan": plan, "vaettir.artifact-purpose": "llvm-builder-checkpoint", "vaettir.runtime-eligible": "false" } } },
    unitAcceptance: false, packageAcceptance: false, runtimeAcceptance: false, authenticatedAcceptance: false, deploymentAcceptance: false };
  return { completedParent: completed, expectedParent: expected, phase: next, budget: { mode: "bounded-probe", compilerJobs: 5, measuredCoreSeconds: 0, measuredTransportSeconds: 46, measuredInventorySeconds: 10, compileSeconds: 2100, totalSeconds: 2520 } };
}

test("supported next phases require exact whole ancestry and preserve incomplete acceptance", () => {
  assert.equal(hash(encode(prepare())), pin.receiptSha256);
  for (const phase of ["release-units", "assertion-compile-1", "assertion-compile-2", "assertion-compile-3"]) {
    const input = fixture(phase), parent = validateNativeNextPhaseParent(input.completedParent, input.expectedParent, phase), plan = planNativeNextPhase(input);
    assert.equal(parent.parentPhase, phases[phases.indexOf(phase) - 1]);
    assert.equal(plan.successorPhase, phase === "assertion-compile-3" ? "final" : phases[phases.indexOf(phase) + 1]);
    for (const key of ["unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance", "defaultRuntimeGraphChanged", "finalSupported", "forecastAcceptance"]) assert.equal(plan[key], false);
    assert.equal(plan.request.timeoutInMinutesOverride, 45); assert.equal(plan.request.computeTypeOverride, "BUILD_GENERAL1_LARGE");
    assert.deepEqual(plan, planNativeNextPhase(input));
  }
});
test("final, skipped and arbitrary phases cannot fabricate a post-final inventory verifier", () => {
  for (const phase of [undefined, "prepare", "release-core", "final", "assertion-compile-4", "llvm-release-core-only"]) assert.throws(() => planNativeNextPhase({ ...fixture(), phase }));
  for (const alter of [value => { value.receiptChain.pop(); }, value => { value.receiptChain.reverse(); }, value => { value.receiptChain[1].phase = "final"; }, value => { value.receiptChain.push(value.receiptChain[1]); }]) {
    const input = fixture(); alter(input.completedParent); assert.throws(() => planNativeNextPhase(input));
  }
});
test("active/failed/diagnostic donors and changed independently pinned identities refuse", () => {
  for (const key of ["buildId", "sourceCommit", "sourceSha256", "planSha256", "requestSha256", "buildspecSha256", "imageDigest", "imageConfigDigest", "receiptSha256", "status", "purpose"]) {
    const input = fixture(); input.completedParent[key] = "untrusted"; assert.throws(() => planNativeNextPhase(input));
  }
  for (const status of ["IN_PROGRESS", "FAILED", "TIMED_OUT", "STOPPED"]) { const input = fixture(); input.completedParent.status = status; assert.throws(() => planNativeNextPhase(input)); }
  for (const key of ["unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"]) for (const where of ["top", "proof"]) { const input = fixture(); (where === "top" ? input.completedParent : input.completedParent.proof)[key] = true; assert.throws(() => planNativeNextPhase(input)); }
  const donor = fixture(); donor.expectedParent.imageDigest = pin.imageDigest; assert.throws(() => planNativeNextPhase(donor));
  const noPin = fixture(); delete noPin.expectedParent.requestSha256; assert.throws(() => planNativeNextPhase(noPin));
});
test("canonical receipt ancestry refuses replaced bytes, mixed inputs, huge state and nonfinal package proof", () => {
  for (const mutate of [value => { value.base64 += "="; }, value => { value.sha256 = "a".repeat(64); }, value => { const r = JSON.parse(Buffer.from(value.base64, "base64")); r.inputs.toolchain.compilerPackage = "another"; const bytes = encode(r); value.base64 = bytes.toString("base64"); value.sha256 = hash(bytes); }]) {
    const input = fixture(); mutate(input.completedParent.receiptChain[0]); assert.throws(() => planNativeNextPhase(input));
  }
  for (const mutate of [r => { r.state.release.bytes = Number.MAX_SAFE_INTEGER; }, r => { r.proof = { unitReceiptSha256: "a".repeat(64) }; }, r => { r.predecessorSha256 = "a".repeat(64); }]) {
    const input = fixture("assertion-compile-1"), record = input.completedParent.receiptChain.at(-1), r = JSON.parse(Buffer.from(record.base64, "base64")); mutate(r); const bytes = encode(r); record.base64 = bytes.toString("base64"); record.sha256 = hash(bytes); input.expectedParent.receiptSha256 = record.sha256; input.completedParent.receiptSha256 = record.sha256; input.completedParent.proof.receiptSha256 = record.sha256; input.completedParent.proof.receiptBase64 = record.base64;
    assert.throws(() => planNativeNextPhase(input));
  }
});
test("registry manifest/config/source/plan proof and bounded input cannot self-substitute", () => {
  for (const mutate of [value => { value.registryManifest.images[0].imageManifest += " "; }, value => { value.imageInspection.Id = "sha256:" + "a".repeat(64); }, value => { value.imageInspection.Config.Labels["vaettir.source-commit"] = "a".repeat(40); }, value => { value.imageInspection.Config.Labels["vaettir.runtime-eligible"] = "true"; }, value => { value.imageInspection.RepoDigests = []; }, value => { value.proof.actualStateVerified = false; }, value => { value.proof.receiptBase64 = value.receiptChain[0].base64; }, value => { value.imageInspection.Size = Number.MAX_SAFE_INTEGER; }, value => { value.extra = "a".repeat(600000); }]) {
    const input = fixture(); mutate(input.completedParent); assert.throws(() => planNativeNextPhase(input));
  }
});

const requireNative = createRequire(import.meta.url), dir = "native-next-proof/";
function vmFixture(program, files = {}, processModule) {
  const stored = new Map(Object.entries(files).map(([name, value]) => [name, Buffer.isBuffer(value) ? value : Buffer.from(value)]));
  const printed = [], writes = [], calls = [];
  const fs = { lstatSync(name) { if (!stored.has(name)) throw Error("ENOENT " + name); return { size: stored.get(name).length, isFile: () => true, isSymbolicLink: () => false }; }, readFileSync(name) { if (!stored.has(name)) throw Error("ENOENT " + name); return stored.get(name); }, writeFileSync(name, bytes, options) { assert.equal(options.flag, "wx"); assert.equal(stored.has(name), false); stored.set(name, Buffer.from(bytes)); writes.push(name); } };
  const context = { Buffer, TextDecoder, process: { execPath: process.execPath, stdout: { write: value => printed.push(value) } }, console: { log: value => printed.push(value), error: value => printed.push(value) }, require(name) { if (name === "node:fs") return fs; if (name === "node:child_process") return processModule ?? { spawnSync: (...args) => { calls.push(args); return { status: 0, signal: null }; }, execFileSync: () => { throw Error("No actual compiler command"); } }; assert.ok(["node:assert/strict", "node:crypto", "node:zlib"].includes(name)); return requireNative(name); } };
  return { run: () => new Script(program).runInNewContext(context, { timeout: 1000 }), printed, writes, calls, stored };
}
function receiptFor(plan) {
  const r = prepare(); r.phase = plan.phase; r.predecessorSha256 = plan.expectedParent.receiptSha256;
  const bytes = encode(r);
  return { bytes, marker: { phase: plan.phase, planSha256: plan.planSha256, receiptSha256: hash(bytes), receiptBase64: bytes.toString("base64"), unitAcceptance: false, packageAcceptance: false, runtimeAcceptance: false } };
}
function outputFiles(plan, ending = "\n") {
  const { bytes, marker } = receiptFor(plan), id = "sha256:" + "2".repeat(64);
  const manifest = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.docker.distribution.manifest.v2+json", config: { digest: id }, layers: [{ digest: "sha256:" + "3".repeat(64), size: 456789 }] });
  const digest = "sha256:" + hash(manifest);
  return {
    [dir + "phase-receipt.json"]: bytes, [dir + "phase-proof.json"]: encode(marker),
    [dir + "compile.log"]: "native output" + ending + "NATIVE_NEXT_PHASE_CORE=" + JSON.stringify(marker) + ending,
    // Docker commit runs in Linux; its exact bounded ID is LF. Log records
    // independently exercise LF/CRLF without inventing a 73-byte Docker ID.
    [dir + "commit-id.txt"]: id + "\n",
    [dir + "candidate-manifest.json"]: encode({ failures: [], images: [{ imageId: { imageDigest: digest, imageTag: plan.candidateTag }, imageManifest: manifest }] }),
    [dir + "candidate-inspect.json"]: encode([{ Id: id, Size: 567890, Config: { Labels: { "vaettir.continuation-plan": plan.planSha256, "vaettir.continuation-phase": plan.phase, "vaettir.source-commit": pin.commit, "vaettir.runtime-eligible": "false", "vaettir.artifact-purpose": "llvm-builder-checkpoint" } } }]),
    [dir + "push.log"]: "digest: " + digest + " size: 42" + ending,
    [dir + "state.log"]: "inventory output" + ending + "NATIVE_NEXT_PHASE_STATE=" + JSON.stringify({ phase: plan.phase, planSha256: plan.planSha256, receiptSha256: marker.receiptSha256, actualStateVerified: true, runtimeAcceptance: false }) + ending,
  };
}
test("all phase-generated programs parse; exact collector and readback run with LF/CRLF", () => {
  for (const phase of ["release-units", "assertion-compile-1", "assertion-compile-2", "assertion-compile-3"]) {
    const plan = planNativeNextPhase(fixture(phase)); assert.equal(Object.keys(plan.generatedPrograms).length, 14);
    for (const [name, source] of Object.entries(plan.generatedPrograms)) assert.doesNotThrow(() => new Script(source, { filename: name }), name);
    for (const ending of ["\n", "\r\n"]) {
      const files = outputFiles(plan, ending); delete files[dir + "phase-proof.json"];
      const collect = vmFixture(plan.generatedPrograms.collect, files); collect.run(); assert.equal(collect.stored.get(dir + "phase-proof.json").at(-1), 10);
      const readback = vmFixture(plan.generatedPrograms.readback, outputFiles(plan, ending)); readback.run(); assert.equal(readback.printed.length, 1);
      const value = JSON.parse(readback.printed[0].slice("NATIVE_NEXT_PHASE_VERIFIED=".length)); assert.equal(value.phase, phase); assert.equal(value.planSha256, plan.planSha256); assert.equal(value.predecessorReceiptSha256, plan.expectedParent.receiptSha256); assert.equal(value.predecessorImageDigest, plan.expectedParent.imageDigest); assert.equal(value.actualStateVerified, true);
      for (const key of ["unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"]) assert.equal(value[key], false);
    }
  }
});
test("generated collectors/readback reject duplicates, wrong phase, receipt and plan before acceptance", () => {
  const plan = planNativeNextPhase(fixture());
  for (const mutate of [files => { files[dir + "state.log"] += files[dir + "state.log"]; }, files => { const p = JSON.parse(files[dir + "phase-proof.json"]); p.phase = "final"; files[dir + "phase-proof.json"] = encode(p); }, files => { const p = JSON.parse(files[dir + "phase-proof.json"]); p.planSha256 = "a".repeat(64); files[dir + "phase-proof.json"] = encode(p); }, files => { files[dir + "phase-receipt.json"] = encode(prepare()); }, files => { files[dir + "commit-id.txt"] = "sha256:" + "4".repeat(64); }]) {
    const files = outputFiles(plan); mutate(files); const vm = vmFixture(plan.generatedPrograms.readback, files); assert.throws(vm.run); assert.equal(vm.printed.length, 0);
  }
  const files = outputFiles(plan); delete files[dir + "phase-proof.json"]; files[dir + "compile.log"] += files[dir + "compile.log"]; const vm = vmFixture(plan.generatedPrograms.collect, files); assert.throws(vm.run); assert.equal(vm.writes.length, 0);
});
test("gzip single-operation decoder and real request ceiling retain exact owned cleanup/resource gates", t => {
  for (const phase of ["release-units", "assertion-compile-1", "assertion-compile-2", "assertion-compile-3"]) {
    const plan = planNativeNextPhase(fixture(phase)), spec = JSON.parse(plan.request.buildspecOverride);
    t.diagnostic(`${phase}: synthetic-parent buildspec ${Buffer.byteLength(plan.request.buildspecOverride)}B; operation ${plan.transport.decodedBytes}B; gzip ${plan.transport.compressedBytes}B`);
    assert.equal(spec.phases.build.commands.length, 1); assert.ok(Buffer.byteLength(plan.request.buildspecOverride) <= 25600); assert.equal(unpackNativeContinuationOperation(plan.transport), plan.operation);
    const vm = vmFixture(plan.generatedPrograms.decoder); vm.run(); assert.equal(vm.calls.length, 1); assert.equal(vm.calls[0][0], "/bin/bash"); assert.equal(vm.calls[0][1].at(-1), plan.operation);
    for (const text of ["--memory 14g --cpus 8", "--memory 2g --cpus 2", "--network none", "--cap-drop ALL", "--security-opt no-new-privileges", "cleanup_native_validation", "begin(", "--phase " + phase + " --predecessor-sha256 " + plan.expectedParent.receiptSha256]) assert.ok(plan.operation.includes(text), text);
    assert.doesNotMatch(plan.operation, /describe-images|put-role-policy|update-project|ecs |migrate|:latest|--phase final /);
    assert.ok(plan.operation.indexOf("state.log") < plan.operation.indexOf("docker push"));
    for (const response of [{ status: 124, signal: null }, { status: null, signal: "SIGTERM" }, { error: Error("timeout") }]) assert.throws(() => vmFixture(plan.generatedPrograms.decoder, {}, { spawnSync: () => response }).run());
  }
});
test("outer/inner compressed shell syntax is valid without evaluating any operation", () => {
  const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
  for (const phase of ["release-units", "assertion-compile-3"]) {
    const plan = planNativeNextPhase(fixture(phase)), prefix = "timeout --signal=TERM --kill-after=30s 2520s bash -eu -o pipefail -c '";
    assert.ok(plan.operation.startsWith(prefix) && plan.operation.endsWith("'"));
    const inner = plan.operation.slice(prefix.length, -1).replaceAll("'\\''", "'");
    for (const source of [plan.operation, inner, JSON.parse(plan.request.buildspecOverride).phases.build.commands[0]]) { const result = spawnSync(bash, ["-n"], { input: source, encoding: "utf8", timeout: 10000, windowsHide: true }); assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null); }
  }
});
test("source never starts a build or claims completed-final runtime eligibility", () => {
  const source = readFileSync(new URL("./native-builder-next-phase.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /execFileSync\("aws"|spawnSync\("aws"|start-build|create-project|update-service/);
  assert.match(source, /Final transport lacks an independent final-image verifier and is unsupported/);
  assert.match(source, /dispatchRequiresRootPreflight: true/);
});
test("core measurement is not a next-phase completion forecast or compiler budget", () => {
  const input = fixture();
  assert.throws(() => planNativeNextPhase({ ...input, budget: { ...input.budget, mode: "measured", measuredCoreSeconds: 1959 } }), /phase-specific performance/);
  for (const compilerJobs of [4, 6, 24]) assert.throws(() => planNativeNextPhase({ ...input, budget: { ...input.budget, compilerJobs } }));
});
test("explicit pre-push configuration pin is not falsely presented as digest-pull evidence", () => {
  const input = fixture(); input.completedParent.imageInspectionMode = "PRE_PUSH_CONFIG_PINNED"; input.completedParent.imageInspection.RepoDigests = [];
  const plan = planNativeNextPhase(input); assert.equal(plan.parentInspectionMode, "PRE_PUSH_CONFIG_PINNED");
  assert.ok(plan.operation.includes("docker pull " + plan.importedImage)); assert.ok(plan.generatedPrograms.parentInspect.includes("RepoDigests.includes"));
  const falsePull = structuredClone(input); falsePull.completedParent.imageInspectionMode = "DIGEST_PULLED"; assert.throws(() => planNativeNextPhase(falsePull), /claimed digest pull/);
  const omitted = structuredClone(input); delete omitted.completedParent.imageInspectionMode; assert.throws(() => planNativeNextPhase(omitted));
  for (const mutate of [v => { v.imageInspection.Id = "sha256:" + "9".repeat(64); }, v => { v.imageInspection.RepoDigests = ["another/repository@sha256:" + "9".repeat(64)]; }, v => { const m = JSON.parse(v.registryManifest.images[0].imageManifest); m.config.digest = "sha256:" + "9".repeat(64); v.registryManifest.images[0].imageManifest = JSON.stringify(m); }]) {
    const bad = structuredClone(input); mutate(bad.completedParent); assert.throws(() => planNativeNextPhase(bad));
  }
  const expectedMismatch = structuredClone(input); expectedMismatch.expectedParent.imageConfigDigest = "sha256:" + "9".repeat(64); assert.throws(() => planNativeNextPhase(expectedMismatch));
});
test("generated manifest, parent, owned container, post and ID gates execute without external calls", () => {
  const input = fixture(), plan = planNativeNextPhase(input), current = receiptFor(plan), id = "sha256:" + "2".repeat(64), cid = "8".repeat(64);
  const owner = { "vaettir.continuation-owner": plan.planSha256 };
  const compiler = { Image: plan.expectedParent.imageConfigDigest, Config: { Image: plan.importedImage, Labels: owner }, HostConfig: { NetworkMode: "none", Privileged: false, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], Memory: 14 * 1024 ** 3, NanoCpus: 8e9, PidsLimit: 2048 }, Mounts: [] };
  const verifier = structuredClone(compiler); verifier.Image = id; verifier.Config.Image = id; verifier.HostConfig.Memory = 2 * 1024 ** 3; verifier.HostConfig.NanoCpus = 2e9; verifier.HostConfig.PidsLimit = 128;
  const cases = [
    ["parentManifest", { [dir + "parent-manifest.json"]: encode(input.completedParent.registryManifest) }, undefined],
    ["parentInspect", { [dir + "parent-inspect.json"]: encode([input.completedParent.imageInspection]) }, undefined],
    ["compilerInspect", { [dir + "compiler-inspect.json"]: encode([compiler]) }, undefined],
    ["verifierInspect", { [dir + "verifier-inspect.json"]: encode([verifier]), [dir + "commit-id.txt"]: id + "\n" }, undefined],
    ["post", { ["/build/llvm-phase-receipts/" + plan.phase + ".json"]: current.bytes }, "NATIVE_NEXT_PHASE_CORE=" + JSON.stringify(current.marker)],
    ["readId", { [dir + "container-id"]: cid + "\n" }, cid],
    ["readCommitId", { [dir + "commit-id.txt"]: id + "\n" }, id],
    ["candidateInspect", outputFiles(plan), undefined],
    ["absent", { [dir + "tag-preflight.json"]: encode({ images: [], failures: [{ failureCode: "ImageNotFound", imageId: { imageTag: plan.candidateTag } }] }) }, undefined],
  ];
  for (const [name, files, output] of cases) { const vm = vmFixture(plan.generatedPrograms[name], files); vm.run(); assert.deepEqual(vm.printed, output === undefined ? [] : [output], name); assert.equal(vm.calls.length, 0); assert.equal(vm.writes.length, 0); }
  for (const name of ["pre", "successor"]) { const vm = vmFixture(plan.generatedPrograms[name]); assert.throws(vm.run, /ENOENT/); assert.equal(vm.calls.length, 0); assert.equal(vm.printed.length, 0); }
  for (const mutate of [v => { v.Config.Image = "a mutable tag"; }, v => { v.Mounts = [{ Source: "/" }]; }, v => { v.HostConfig.NetworkMode = "bridge"; }, v => { v.HostConfig.Privileged = true; }, v => { v.Config.Labels["vaettir.continuation-owner"] = "0".repeat(64); }]) {
    const invalid = structuredClone(compiler); mutate(invalid); assert.throws(() => vmFixture(plan.generatedPrograms.compilerInspect, { [dir + "compiler-inspect.json"]: encode([invalid]) }).run());
  }
});

function bindRegistryConfig(input, bytes) {
  const configDigest = "sha256:" + hash(bytes);
  const manifest = JSON.parse(input.completedParent.registryManifest.images[0].imageManifest);
  manifest.config.digest = configDigest;
  const imageManifest = JSON.stringify(manifest), imageDigest = "sha256:" + hash(imageManifest);
  for (const value of [input.expectedParent, input.completedParent, input.completedParent.proof]) { value.imageConfigDigest = configDigest; value.imageDigest = imageDigest; }
  input.completedParent.registryManifest.images[0] = { imageId: { imageDigest }, imageManifest };
  input.completedParent.imageInspectionMode = "REGISTRY_CONFIG_PINNED";
  input.completedParent.imageInspection = null;
  input.completedParent.registryConfigBase64 = bytes.toString("base64");
  return input;
}
function registryFixture() {
  const input = fixture();
  const config = { architecture: "amd64", os: "linux", config: { Env: ["SYNTHETIC_PRIVATE_CONFIG_VALUE=do-not-project"], Labels: input.completedParent.imageInspection.Config.Labels }, rootfs: { type: "layers", diff_ids: ["sha256:" + "9".repeat(64)] } };
  return bindRegistryConfig(input, encode(config));
}
test("registry raw config evidence is explicitly distinct from Docker inspection and still mandates later local pull proof", () => {
  const input = registryFixture(), plan = planNativeNextPhase(input);
  assert.equal(plan.parentInspectionMode, "REGISTRY_CONFIG_PINNED"); assert.equal(input.completedParent.imageInspection, null);
  assert.equal("sha256:" + hash(Buffer.from(input.completedParent.registryConfigBase64, "base64")), plan.expectedParent.imageConfigDigest);
  assert.ok(plan.operation.includes("docker pull " + plan.importedImage));
  assert.ok(plan.generatedPrograms.parentInspect.includes("RepoDigests.includes")); assert.ok(plan.generatedPrograms.parentInspect.includes("i.Size"));
  assert.ok(plan.operation.indexOf("parent-inspect.json") < plan.operation.indexOf("docker create"));
  assert.doesNotMatch(JSON.stringify(plan), /SYNTHETIC_PRIVATE_CONFIG_VALUE|do-not-project|registryConfigBase64/);
  for (const key of ["unitAcceptance", "packageAcceptance", "runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"]) assert.equal(plan[key], false);
  for (const [name, program] of Object.entries(plan.generatedPrograms)) assert.doesNotThrow(() => new Script(program, { filename: name }));
  const vm = vmFixture(plan.generatedPrograms.decoder); vm.run(); assert.equal(vm.calls.length, 1); assert.equal(vm.calls[0][1].at(-1), plan.operation);
});
test("raw config byte/config-manifest/expected pins, canonical encoding and evidence mode cannot substitute", () => {
  for (const alter of [input => { input.completedParent.registryConfigBase64 += "="; }, input => { input.completedParent.registryConfigBase64 = Buffer.concat([Buffer.from(input.completedParent.registryConfigBase64, "base64"), Buffer.from(" ")]).toString("base64"); }, input => { input.expectedParent.imageConfigDigest = "sha256:" + "8".repeat(64); }, input => { const m = JSON.parse(input.completedParent.registryManifest.images[0].imageManifest); m.config.digest = "sha256:" + "8".repeat(64); input.completedParent.registryManifest.images[0].imageManifest = JSON.stringify(m); }, input => { input.completedParent.imageInspection = { Id: input.expectedParent.imageConfigDigest, Size: 1, RepoDigests: [] }; }, input => { delete input.completedParent.registryConfigBase64; }, input => { input.completedParent.imageInspectionMode = "DIGEST_PULLED"; }, input => { input.completedParent.imageInspectionMode = "PRE_PUSH_CONFIG_PINNED"; }]) {
    const input = registryFixture(); alter(input); assert.throws(() => planNativeNextPhase(input));
  }
  const old = fixture(); old.completedParent.registryConfigBase64 = registryFixture().completedParent.registryConfigBase64; assert.throws(() => planNativeNextPhase(old));
});
test("even freshly pinned registry config refuses unsupported platform/rootfs and wrong/missing source labels", () => {
  for (const alter of [c => { c.os = "windows"; }, c => { c.architecture = "arm64"; }, c => { c.rootfs.type = "other"; }, c => { c.rootfs.diff_ids = []; }, c => { c.rootfs.diff_ids = ["not-a-digest"]; }, c => { c.config.Labels["vaettir.source-commit"] = "8".repeat(40); }, c => { c.config.Labels["vaettir.continuation-plan"] = "8".repeat(64); }, c => { c.config.Labels["vaettir.runtime-eligible"] = "true"; }, c => { delete c.config.Labels["vaettir.artifact-purpose"]; }, c => { c.config.Labels = []; }]) {
    const input = registryFixture(), c = JSON.parse(Buffer.from(input.completedParent.registryConfigBase64, "base64")); alter(c); bindRegistryConfig(input, encode(c)); assert.throws(() => planNativeNextPhase(input));
  }
});
test("malformed, non-UTF8, scalar and overbound registry configs refuse without normalization or projection", () => {
  for (const bytes of [Buffer.from("{"), Buffer.from([0xff, 0xfe]), Buffer.from("null"), Buffer.from("[]"), Buffer.from("42"), Buffer.alloc(256 * 1024 + 1, 32)]) {
    const input = registryFixture(); bindRegistryConfig(input, bytes); assert.throws(() => planNativeNextPhase(input));
  }
  const privateSyntax = registryFixture(); bindRegistryConfig(privateSyntax, Buffer.from('{"private":"SYNTHETIC_PRIVATE_CONFIG_VALUE=do-not-project"'));
  assert.throws(() => planNativeNextPhase(privateSyntax), error => !error.message.includes("SYNTHETIC_PRIVATE_CONFIG_VALUE") && error.message === "Unsupported raw registry configuration encoding/JSON");
  const privateLabel = registryFixture(), config = JSON.parse(Buffer.from(privateLabel.completedParent.registryConfigBase64, "base64"));
  config.config.Labels["vaettir.source-commit"] = "SYNTHETIC_PRIVATE_CONFIG_VALUE=do-not-project"; bindRegistryConfig(privateLabel, encode(config));
  assert.throws(() => planNativeNextPhase(privateLabel), error => !error.message.includes("SYNTHETIC_PRIVATE_CONFIG_VALUE") && error.message.includes("configuration label mismatch"));
});
