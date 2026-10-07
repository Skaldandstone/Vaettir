// Pure synthetic consistency/recipe tests. No Docker, cloud, source export,
// credentials, native execution, database or deployment acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  generateNativeFinalRuntimeRecipe,
  generateNativeCompactFinalRuntimeRecipe,
  NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS,
} from "./native-packaging-v2-final-runtime-recipe.mjs";
import {
  compactCompletedFixture, runtimeCompletedFixture as fullCompletedFixture, runtimeApplicationFixture,
} from "./native-final-compact-fixture.mjs";

const sha = raw => createHash("sha256").update(raw).digest("hex");
function fixture(compact = true) {
  const f = compact ? compactCompletedFixture() : fullCompletedFixture();
  const app = runtimeApplicationFixture();
  const names = ["packageSha256", "llvm-cpu-jit", "llvm-arm-policy", "abiReceiptSha256",
    "llvm-abi.json", "unitReceiptSha256", "llvm-release-configuration.json", "llvm-assertions-configuration.json"];
  const files = Object.fromEntries(NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS.map((path, i) => [path,
    i < 8 ? f.artifactBytes[names[i]] : Buffer.from(f.completed.receiptChain[i - 8].base64, "base64")]));
  const artifacts = NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS.map((path, i) => ({
    path, sha256: sha(files[path]), bytes: files[path].length,
    mode: i === 1 || i === 2 ? 493 : i >= 8 ? 384 : 420,
  }));
  const review = {
    schemaVersion: 1,
    purpose: compact ? "root-reviewed-native-compact-final-runtime-donor" : "root-reviewed-native-final-runtime-donor",
    final: { ...f.expected, completedSha256: sha(JSON.stringify(f.completed)) }, artifacts,
  };
  const input = {
    native: { completed: f.completed, expected: f.expected, plan: f.plan, planningInput: f.input,
      transport: f.transport, rootReviewBytes: Buffer.alloc(0), expectedRootReviewSha256: "" },
    application: { freshPrepareInput: app, archiveDockerfileBytes: app.gitBlobs["Dockerfile.api"],
      expectedApplicationCommit: app.sourceCommit, expectedApplicationArchiveSha256: app.archiveSha256 },
  };
  function pinReview() {
    input.native.rootReviewBytes = Buffer.from(JSON.stringify(review) + "\n");
    input.native.expectedRootReviewSha256 = sha(input.native.rootReviewBytes);
  }
  pinReview();
  return { f, app, input, review, files, pinReview };
}

test("legacy v2 recipe retains the full-donor path and refuses compact selection", () => {
  const { input } = fixture(false);
  const result = generateNativeFinalRuntimeRecipe(input);
  assert.equal(result.identity.purpose, "native-final-runtime-recipe-not-runtime-acceptance");
  assert.equal(result.identity.nativeTransportKind, undefined);
  assert.equal(result.recipe.includes("vaettir-accepted-native-compact"), false);
  assert.equal(result.recipe.split(/\r?\n/).filter(line => line.startsWith("COPY --from=vaettir-accepted-native-final ")).length, 2);
  assert.throws(() => generateNativeCompactFinalRuntimeRecipe(input));
});

test("compact runtime verifies scratch artifacts on the existing pinned Node base", () => {
  const { input, review } = fixture();
  const result = generateNativeCompactFinalRuntimeRecipe(input);
  assert.equal(result.identity.purpose, "native-compact-final-runtime-recipe-not-runtime-acceptance");
  assert.equal(result.identity.nativeTransportKind, "compact-fixed15-v1");
  assert.equal(result.identity.artifactInventorySha256, sha(JSON.stringify(review.artifacts)));
  assert.equal(result.requiresActualRuntimeBuildAndSecurityGates, true);
  for (const name of ["runtimeAcceptance", "authenticatedAcceptance", "deploymentAcceptance"])
    assert.equal(result.identity[name], false);
  const lines = result.recipe.split(/\r?\n/);
  const scratch = lines.findIndex(line => / AS vaettir-accepted-native-compact$/.test(line));
  const verify = lines.findIndex(line => / AS vaettir-accepted-native-final$/.test(line));
  assert.ok(scratch > 0);
  assert.equal(verify, scratch + 1);
  const runtimeBase = input.application.archiveDockerfileBytes.toString().split(/\r?\n/)
    .find(line => / AS runtime$/.test(line));
  assert.equal(lines[verify], runtimeBase.replace(/ AS runtime$/, " AS vaettir-accepted-native-final"));
  const copies = lines.filter(line => line.startsWith("COPY --from=vaettir-accepted-native-compact "));
  assert.deepEqual(copies, NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS.map(path =>
    `COPY --from=vaettir-accepted-native-compact ${path} ${path}`));
  assert.ok(lines[verify + 16].startsWith("RUN --network=none node -e "));
  assert.equal(lines.filter(line => line.startsWith("COPY --from=vaettir-accepted-native-final ")).length, 2);
  assert.ok(result.recipe.includes('LABEL vaettir.native-transport-kind="compact-fixed15-v1"'));
  assert.ok(result.recipe.includes(`vaettir.native-full-local-config="${result.identity.fullLocalImageConfigDigest}"`));
  assert.throws(() => generateNativeFinalRuntimeRecipe(input));
});

test("compact generation requires its exact independently pinned root review", () => {
  for (const mutate of [
    x => { x.review.purpose = "root-reviewed-native-final-runtime-donor"; },
    x => { x.review.final.completedSha256 = "0".repeat(64); },
    x => { x.review.artifacts[0].bytes++; },
    x => { x.review.artifacts[0].sha256 = "0".repeat(64); },
    x => { x.review.artifacts[1].mode = 420; },
    x => { x.review.artifacts[0].path = "/build/unreviewed.deb"; },
    x => { x.review.artifacts.reverse(); },
    x => { x.review.artifacts.pop(); },
    x => { x.review.artifacts.push({ ...x.review.artifacts[0] }); },
  ]) {
    const x = fixture(); mutate(x); x.pinReview();
    assert.throws(() => generateNativeCompactFinalRuntimeRecipe(x.input));
  }
  const x = fixture(); x.input.native.expectedRootReviewSha256 = "0".repeat(64);
  assert.throws(() => generateNativeCompactFinalRuntimeRecipe(x.input));
});

test("compact publication cannot convert failed native evidence into a runtime recipe", () => {
  for (const mutate of [
    x => { x.input.native.completed.status = "FAILED"; },
    x => { x.input.native.completed.runtimeAcceptance = true; },
    x => { x.input.native.completed.authenticatedAcceptance = true; },
    x => { x.input.native.completed.deploymentAcceptance = true; },
    x => { x.input.native.completed.verified.pre.review.completeInputsAndObjectsRecomputed = false; },
    x => { x.input.native.completed.verified.image.review.units[0].passed--; },
    x => { x.input.native.completed.receiptChain.pop(); },
  ]) {
    const x = fixture(); mutate(x);
    x.review.final.completedSha256 = sha(JSON.stringify(x.input.native.completed)); x.pinReview();
    assert.throws(() => generateNativeCompactFinalRuntimeRecipe(x.input));
  }
});

test("compact generation retains application source and default Dockerfile bindings", () => {
  for (const mutate of [
    x => { x.input.application.expectedApplicationCommit = "0".repeat(40); },
    x => { x.input.application.expectedApplicationArchiveSha256 = "0".repeat(64); },
    x => { x.input.application.archiveDockerfileBytes = Buffer.concat([x.input.application.archiveDockerfileBytes, Buffer.from("\n# changed\n")]); },
  ]) {
    const x = fixture(); mutate(x);
    assert.throws(() => generateNativeCompactFinalRuntimeRecipe(x.input));
  }
});
