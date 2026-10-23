// Synthetic pure recipes/VM only. No actual native build or deployment proof.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import vm from "node:vm";
import {
  generateNativeFinalRuntimeRecipe,
  nativeFinalRuntimeArtifactProgram,
  NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS,
} from "./native-final-runtime-recipe.mjs";
import {
  runtimeCompletedFixture,
  runtimeApplicationFixture,
} from "./native-final-runtime-recipe-fixture.mjs";
const sha = (x) => createHash("sha256").update(x).digest("hex");
function fixture() {
  const f = runtimeCompletedFixture(),
    app = runtimeApplicationFixture();
  const names = [
    "packageSha256",
    "llvm-cpu-jit",
    "llvm-arm-policy",
    "abiReceiptSha256",
    "llvm-abi.json",
    "unitReceiptSha256",
    "llvm-release-configuration.json",
    "llvm-assertions-configuration.json",
  ];
  const files = Object.fromEntries(
    NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS.map((path, i) => [
      path,
      i < 8
        ? f.artifactBytes[names[i]]
        : Buffer.from(f.completed.receiptChain[i - 8].base64, "base64"),
    ]),
  );
  const artifacts = NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS.map((path, i) => ({
    path,
    sha256: sha(files[path]),
    bytes: files[path].length,
    mode: i === 1 || i === 2 ? 493 : i >= 8 ? 384 : 420,
  }));
  const review = {
    schemaVersion: 1,
    purpose: "root-reviewed-native-final-runtime-donor",
    final: { ...f.expected, completedSha256: sha(JSON.stringify(f.completed)) },
    artifacts,
  };
  const rootReviewBytes = Buffer.from(JSON.stringify(review) + "\n");
  return {
    input: {
      native: {
        completed: f.completed,
        expected: f.expected,
        plan: f.plan,
        planningInput: f.input,
        transport: f.transport,
        rootReviewBytes,
        expectedRootReviewSha256: sha(rootReviewBytes),
      },
      application: {
        freshPrepareInput: app,
        archiveDockerfileBytes: app.gitBlobs["Dockerfile.api"],
        expectedApplicationCommit: app.sourceCommit,
        expectedApplicationArchiveSha256: app.archiveSha256,
      },
    },
    review,
    files,
  };
}
function rebind(f) {
  f.input.native.rootReviewBytes = Buffer.from(JSON.stringify(f.review) + "\n");
  f.input.native.expectedRootReviewSha256 = sha(f.input.native.rootReviewBytes);
}
test("synthetic full-final evidence produces separate immutable donor; all default commands retained", () => {
  const f = fixture(),
    r = generateNativeFinalRuntimeRecipe(f.input),
    original = f.input.application.archiveDockerfileBytes.toString();
  assert.match(
    r.recipe,
    /FROM 051722405355\.dkr\.ecr\.us-east-2\.amazonaws\.com\/vaettir-api@sha256:[a-f0-9]{64} AS vaettir-accepted-native-final/,
  );
  assert.equal(
    r.recipe.split("COPY --from=vaettir-accepted-native-final ").length - 1,
    2,
  );
  assert.equal(r.recipe.includes('vaettir.runtime-eligible="true"'), false);
  for (const line of original
    .split("\n")
    .filter((x) => !x.startsWith("COPY --from=llvm-build")))
    assert.ok(r.recipe.split("\n").includes(line), line);
  for (const flag of [
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
  ])
    assert.equal(r.identity[flag], false);
  assert.equal(r.identity.recipeSha256, sha(r.recipe));
  assert.equal(r.requiresActualRuntimeBuildAndSecurityGates, true);
  assert.match(
    r.recipe,
    /RUN test "\$VAETTIR_RELEASE_COMMIT" = "[a-f0-9]{40}"/,
  );
});
test("missing/forged root envelope, partial failed checkpoint and unknown input refuse", () => {
  for (const change of [
    (f) => (f.input.native.rootReviewBytes = undefined),
    (f) => (f.input.native.expectedRootReviewSha256 = "f".repeat(64)),
    (f) => (f.input.native.completed.status = "FAILED"),
    (f) => f.input.native.completed.receiptChain.pop(),
    (f) => (f.input.native.completed.verified.image.review.armVectors = 32),
    (f) =>
      (f.input.native.completed.verified.pre.review.fixedCandidateJitResult = 10),
    (f) =>
      (f.input.native.completed.verified.image.review.completeInputsAndObjectsRecomputed = false),
    (f) => (f.input.extra = true),
    (f) => {
      f.review.final.completedSha256 = "f".repeat(64);
      rebind(f);
    },
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => generateNativeFinalRuntimeRecipe(f.input));
  }
});
test("complete raw dual-suite/CRC stream and both committed/precommit reviews remain mandatory", () => {
  for (const change of [
    (f) => f.input.native.transport.phaseLogChunks.pop(),
    (f) => (f.input.native.transport.phaseLogBytes[0] ^= 1),
    (f) => f.input.native.completed.verified.image.review.units[1].passed++,
    (f) => (f.input.native.completed.verified.digestPullEvidence = true),
    (f) =>
      (f.input.native.completed.registryConfigBase64 =
        Buffer.from("{}").toString("base64")),
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => generateNativeFinalRuntimeRecipe(f.input));
  }
});
test("artifact paths, modes, source receipt lengths, bounds and proof hashes refuse after envelope rebind", () => {
  for (const change of [
    (f) => f.review.artifacts.pop(),
    (f) => (f.review.artifacts[0].path = "/build/private"),
    (f) => (f.review.artifacts[0].sha256 = "f".repeat(64)),
    (f) => f.review.artifacts[8].bytes++,
    (f) => (f.review.artifacts[8].mode = 420),
    (f) => (f.review.artifacts[1].mode = 511),
    (f) => (f.review.artifacts[0].bytes = 3 * 1024 ** 3),
    (f) => f.review.artifacts.reverse(),
    (f) => (f.review.artifacts[0].extra = "body"),
  ]) {
    const f = fixture();
    change(f);
    rebind(f);
    assert.throws(() => generateNativeFinalRuntimeRecipe(f.input));
  }
});
test("current canonical source/archive/Dockerfile/native-byte compatibility independently enforced", () => {
  for (const change of [
    (f) => (f.input.application.expectedApplicationCommit = "f".repeat(40)),
    (f) =>
      (f.input.application.expectedApplicationArchiveSha256 = "f".repeat(64)),
    (f) => (f.input.application.freshPrepareInput.archive[0] ^= 1),
    (f) =>
      (f.input.application.archiveDockerfileBytes = Buffer.from(
        f.input.application.archiveDockerfileBytes
          .toString()
          .replace("--frozen-lockfile", "--no-frozen-lockfile"),
      )),
    (f) =>
      (f.input.application.freshPrepareInput.gitBlobs[
        "build-llvm-runtime.sh"
      ][0] ^= 1),
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => generateNativeFinalRuntimeRecipe(f.input));
  }
});
test("separate current app commit is labeled and guarded without rewriting native ancestor", () => {
  const f = fixture(),
    app = runtimeApplicationFixture("b".repeat(40));
  f.input.application = {
    freshPrepareInput: app,
    archiveDockerfileBytes: app.gitBlobs["Dockerfile.api"],
    expectedApplicationCommit: app.sourceCommit,
    expectedApplicationArchiveSha256: app.archiveSha256,
  };
  const r = generateNativeFinalRuntimeRecipe(f.input);
  assert.equal(r.identity.applicationCommit, "b".repeat(40));
  assert.equal(r.identity.nativeSourceCommit, "a".repeat(40));
  assert.match(r.recipe, /vaettir\.application-source-commit="b{40}"/);
  assert.match(r.recipe, /vaettir\.native-source-commit="a{40}"/);
});
test("duplicate/trailing/unknown root envelope fields refuse even externally rehashed", () => {
  for (const raw of [
    (f) =>
      f.input.native.rootReviewBytes
        .toString()
        .replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    (f) => f.input.native.rootReviewBytes.toString() + "{}",
    (f) => {
      const r = structuredClone(f.review);
      r.runtimeAcceptance = true;
      return JSON.stringify(r);
    },
  ]) {
    const f = fixture();
    f.input.native.rootReviewBytes = Buffer.from(raw(f));
    f.input.native.expectedRootReviewSha256 = sha(
      f.input.native.rootReviewBytes,
    );
    assert.throws(() => generateNativeFinalRuntimeRecipe(f.input));
  }
});
function runArtifactProgram(f, mutate = () => {}) {
  const descriptors = new Map(),
    cursor = new Map();
  let fd = 0,
    closed = 0;
  const stat = (p) =>
    p in f.files
      ? {
          dev: 1,
          ino: NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS.indexOf(p) + 2,
          size: f.files[p].length,
          mode: 0x8000 | f.review.artifacts.find((x) => x.path === p).mode,
          mtimeMs: 1,
          ctimeMs: 1,
          isFile: () => true,
          isSymbolicLink: () => false,
          isDirectory: () => false,
        }
      : { isDirectory: () => true };
  const fs = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 131072 },
    realpathSync: (p) => p,
    lstatSync: stat,
    openSync: (p, flags) => {
      assert.equal(flags, 131072);
      descriptors.set(++fd, p);
      cursor.set(fd, 0);
      return fd;
    },
    fstatSync: (id) => stat(descriptors.get(id)),
    readSync: (id, b, offset, length) => {
      const p = descriptors.get(id),
        c = cursor.get(id),
        n = Math.min(length, f.files[p].length - c);
      f.files[p].copy(b, offset, c, c + n);
      cursor.set(id, c + n);
      return n;
    },
    closeSync: () => closed++,
  };
  mutate(fs, f);
  new vm.Script(
    nativeFinalRuntimeArtifactProgram(f.review.artifacts),
  ).runInNewContext(
    {
      require: (n) =>
        n === "node:fs" ? fs : n === "node:crypto" ? { createHash } : assert,
      Buffer,
    },
    { timeout: 1000 },
  );
  assert.equal(closed, NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS.length);
}
test("actual generated Node artifact program executes all15 fixed hashes in memory", () =>
  runArtifactProgram(fixture()));
test("actual generated program refuses symlink/replaced/wrong mode/size/hash and closes owned descriptor", () => {
  for (const mutate of [
    (fs) => (fs.realpathSync = () => "/foreign"),
    (fs) => {
      const s = fs.lstatSync;
      fs.lstatSync = (p) => ({ ...s(p), isFile: () => false });
    },
    (fs) => {
      const s = fs.lstatSync;
      fs.lstatSync = (p) => ({ ...s(p), mode: 511 });
    },
    (fs, f) =>
      (f.files[NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS[0]] =
        Buffer.from("changed")),
    (fs) => {
      const s = fs.fstatSync;
      fs.fstatSync = (id) => ({ ...s(id), ino: 99 });
    },
  ])
    assert.throws(() => runArtifactProgram(fixture(), mutate));
});
