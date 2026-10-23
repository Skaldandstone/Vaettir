// PURE planning only. Caller supplies independently hash-pinned root evidence.
// No filesystem, Docker, cloud, credentials, build or import-time operations.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { planNativeFreshPrepare } from "./native-packaging-v2-builder-fresh-prepare.mjs";
import {
  validateFreshNativeFinalCompleted,
  validateFreshNativeCompactFinalCompleted,
} from "./native-packaging-v2-final-runtime-recipe-validation.mjs";
import {
  parseFinalJson,
  FINAL_LIMITS,
} from "./native-builder-fresh-final-verifier.mjs";

const sha = (x) => createHash("sha256").update(x).digest("hex");
const hex = /^[a-f0-9]{64}$/;
const decoder = new TextDecoder("utf-8", { fatal: true });
const phases = [
  "prepare",
  "release-core",
  "release-units",
  "assertion-compile-1",
  "assertion-compile-2",
  "assertion-compile-3",
  "final",
];
const paths = [
  "/build/libllvm19_19.1.7-3+vaettir1_amd64.deb",
  "/build/llvm-cpu-jit",
  "/build/llvm-arm-policy",
  "/build/llvm-stripped-abi.json",
  "/build/llvm-abi.json",
  "/build/llvm-final-unit-gates.json",
  "/build/llvm-release-configuration.json",
  "/build/llvm-assertions-configuration.json",
  ...phases.map((p) => `/build/llvm-phase-receipts/${p}.json`),
];
export const NATIVE_FINAL_RUNTIME_ARTIFACT_PATHS = Object.freeze(paths);
function exact(x, names) {
  assert.ok(x && typeof x === "object" && !Array.isArray(x));
  assert.deepEqual(Object.keys(x).sort(), [...names].sort());
}
function bytes(x, max) {
  assert.ok(Buffer.isBuffer(x) && x.length > 0 && x.length <= max);
  return x;
}
function shell(x) {
  return "'" + x.replaceAll("'", "'\\''") + "'";
}

/** Exact regular-file verifier embedded in the separate donor stage. It only
 * reads fixed public native artifact paths. Independent full-state/native
 * reviews happen BEFORE generation; this is not a substitute for those gates.
 */
export function nativeFinalRuntimeArtifactProgram(artifacts) {
  validateArtifacts(artifacts);
  return `const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');const entries=${JSON.stringify(artifacts)};const block=Buffer.alloc(1048576);for(const e of entries){for(const dir of ['/build',...(e.path.includes('/llvm-phase-receipts/')?['/build/llvm-phase-receipts']:[])]){assert.ok(fs.lstatSync(dir).isDirectory());assert.equal(fs.realpathSync(dir),dir);}assert.equal(fs.realpathSync(e.path),e.path);const before=fs.lstatSync(e.path);assert.ok(before.isFile()&&!before.isSymbolicLink());assert.equal(before.size,e.bytes);assert.equal(before.mode&4095,e.mode);const fd=fs.openSync(e.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=fs.fstatSync(fd);assert.equal(opened.dev,before.dev);assert.equal(opened.ino,before.ino);const hash=crypto.createHash('sha256');let total=0,n;while((n=fs.readSync(fd,block,0,block.length,null))>0){total+=n;assert.ok(total<=e.bytes);hash.update(block.subarray(0,n));}assert.equal(total,e.bytes);assert.equal(hash.digest('hex'),e.sha256);const after=fs.fstatSync(fd),pathAfter=fs.lstatSync(e.path);for(const key of ['dev','ino','size','mode','mtimeMs','ctimeMs']){assert.equal(after[key],before[key]);assert.equal(pathAfter[key],before[key]);}}finally{fs.closeSync(fd);}}`;
}
function validateArtifacts(artifacts) {
  assert.ok(Array.isArray(artifacts) && artifacts.length === paths.length);
  assert.ok(Buffer.byteLength(JSON.stringify(artifacts)) <= 16384);
  let total = 0;
  artifacts.forEach((e, i) => {
    exact(e, ["path", "sha256", "bytes", "mode"]);
    assert.equal(e.path, paths[i]);
    assert.match(e.sha256, hex);
    const cap =
      i === 0
        ? FINAL_LIMITS.package
        : i <= 2
          ? 128 * 1024 ** 2
          : FINAL_LIMITS.receipt;
    assert.ok(Number.isSafeInteger(e.bytes) && e.bytes > 0 && e.bytes <= cap);
    if (i === 1 || i === 2) assert.equal(e.mode, 493);
    else if (i >= 8) assert.equal(e.mode, 384);
    else assert.ok(e.mode === 384 || e.mode === 420);
    total += e.bytes;
  });
  assert.ok(total <= 3 * 1024 ** 3);
}

/** Root review envelope is an externally pinned transport boundary, NOT an
 * approval inferred from client booleans. Root must independently collect the
 * actual build/registry/dual-state/cleanup evidence and fixed artifact stat
 * inventory. Missing such an envelope refuses, even for consistent fixtures.
 */
export function generateNativeFinalRuntimeRecipe(input) {
  return generateRuntimeRecipe(input, false);
}

/** Separate compact transport, never an implicit fallback for a failed full
 * builder publication. Full native reviews and compact registry/byte evidence
 * must be independently admitted by the distinct validator before generation.
 */
export function generateNativeCompactFinalRuntimeRecipe(input) {
  return generateRuntimeRecipe(input, true);
}

function generateRuntimeRecipe(input, compact) {
  exact(input, ["native", "application"]);
  const n = input.native,
    app = input.application;
  exact(n, [
    "completed",
    "expected",
    "plan",
    "planningInput",
    "transport",
    "rootReviewBytes",
    "expectedRootReviewSha256",
  ]);
  exact(app, [
    "freshPrepareInput",
    "archiveDockerfileBytes",
    "expectedApplicationCommit",
    "expectedApplicationArchiveSha256",
  ]);
  const validated = (compact
    ? validateFreshNativeCompactFinalCompleted
    : validateFreshNativeFinalCompleted)(
    n.completed,
    n.expected,
    n.plan,
    n.planningInput,
    n.transport,
  );
  assert.match(n.expectedRootReviewSha256, hex);
  const raw = bytes(n.rootReviewBytes, 32768);
  assert.equal(sha(raw), n.expectedRootReviewSha256);
  const review = parseFinalJson(raw);
  exact(review, ["schemaVersion", "purpose", "final", "artifacts"]);
  assert.equal(review.schemaVersion, 1);
  assert.equal(review.purpose, compact
    ? "root-reviewed-native-compact-final-runtime-donor"
    : "root-reviewed-native-final-runtime-donor");
  exact(review.final, [...Object.keys(n.expected), "completedSha256"]);
  assert.deepEqual(review.final, {
    ...n.expected,
    completedSha256: sha(JSON.stringify(n.completed)),
  });
  validateArtifacts(review.artifacts);
  if (compact) {
    assert.equal(sha(JSON.stringify(review.artifacts)), validated.artifactInventorySha256);
    assert.deepEqual(review.artifacts, validated.artifacts);
  }
  const receipt = JSON.parse(
    Buffer.from(n.completed.receiptChain.at(-1).base64, "base64"),
  );
  const artifactHashes = [
    receipt.proof.packageSha256,
    receipt.proof["llvm-cpu-jit"],
    receipt.proof["llvm-arm-policy"],
    receipt.proof.abiReceiptSha256,
    receipt.proof["llvm-abi.json"],
    receipt.proof.unitReceiptSha256,
    receipt.proof["llvm-release-configuration.json"],
    receipt.proof["llvm-assertions-configuration.json"],
    ...n.completed.receiptChain.map((r) => r.sha256),
  ];
  review.artifacts.forEach((a, i) => assert.equal(a.sha256, artifactHashes[i]));
  review.artifacts
    .slice(8)
    .forEach((a, i) =>
      assert.equal(
        a.bytes,
        Buffer.from(n.completed.receiptChain[i].base64, "base64").length,
      ),
    );
  const prepare = planNativeFreshPrepare(app.freshPrepareInput);
  assert.match(app.expectedApplicationCommit, /^[a-f0-9]{40}$/);
  assert.match(app.expectedApplicationArchiveSha256, hex);
  assert.equal(prepare.identity.sourceCommit, app.expectedApplicationCommit);
  assert.equal(
    prepare.identity.sourceSha256,
    app.expectedApplicationArchiveSha256,
  );
  assert.deepEqual(
    { ...prepare.identity.expectedScripts },
    { ...n.plan.identity.scriptPins },
    "Exact exported native script bytes must remain compatible",
  );
  const originalPrepare = n.planningInput.core.planningInput.preparePlan;
  assert.deepEqual(
    prepare.identity.dockerfileBinding,
    originalPrepare.identity.dockerfileBinding,
    "Original default Dockerfile content/export binding required",
  );
  const source = bytes(app.archiveDockerfileBytes, 65536);
  assert.equal(sha(source), prepare.identity.dockerfileBinding.archiveSha256);
  const original = decoder.decode(source);
  assert.ok(!original.includes("vaettir-accepted-native-final"));
  const copies = [
    "COPY --from=llvm-build /build/libllvm19_19.1.7-3+vaettir1_amd64.deb /tmp/vaettir-vendor/",
    "COPY --from=llvm-build /build/llvm-cpu-jit /usr/share/vaettir/llvm-cpu-jit",
  ];
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(eol);
  for (const line of copies)
    assert.equal(lines.filter((v) => v === line).length, 1);
  assert.equal(lines.filter((v) => v.includes("--from=llvm-build")).length, 2);
  const runtimeIndex = lines.findIndex((v) => /^FROM .* AS runtime$/.test(v));
  assert.ok(runtimeIndex > 0);
  assert.equal(lines.filter((v) => /^FROM .* AS runtime$/.test(v)).length, 1);
  const imageRepository = n.plan.candidateImage.slice(
    0,
    n.plan.candidateImage.lastIndexOf(":"),
  );
  assert.equal(
    imageRepository,
    "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api",
  );
  const donor = imageRepository + "@" + validated.imageDigest;
  const program = nativeFinalRuntimeArtifactProgram(review.artifacts);
  const added = [
    compact
      ? "# Separate reviewed compact donor. Full native proof is retained independently."
      : "# Separate reviewed full-final donor. Default Dockerfile.api remains unchanged.",
    ...(compact ? [
      `FROM ${donor} AS vaettir-accepted-native-compact`,
      // Scratch contains no Node executable. Reuse the exact already-bound
      // runtime base, not a new tag/base or the unpublished builder image.
      lines[runtimeIndex].replace(/ AS runtime$/, " AS vaettir-accepted-native-final"),
      ...review.artifacts.map(({ path }) =>
        `COPY --from=vaettir-accepted-native-compact ${path} ${path}`),
    ] : [`FROM ${donor} AS vaettir-accepted-native-final`]),
    `RUN --network=none node -e ${shell(program)}`,
    "",
  ];
  lines.splice(runtimeIndex, 0, ...added);
  const arg = "ARG VAETTIR_RELEASE_COMMIT";
  assert.equal(lines.filter((v) => v === arg).length, 1);
  const applicationAdded = [
    `RUN test "$VAETTIR_RELEASE_COMMIT" = "${app.expectedApplicationCommit}"`,
    `LABEL vaettir.application-source-commit="${app.expectedApplicationCommit}" vaettir.application-source-sha256="${app.expectedApplicationArchiveSha256}" vaettir.native-source-commit="${n.plan.identity.sourceCommit}" vaettir.native-final-image="${validated.imageDigest}" vaettir.native-final-config="${validated.imageConfigDigest}" vaettir.native-final-review="${sha(raw)}"`,
    ...(compact ? [
      `LABEL vaettir.native-transport-kind="compact-fixed15-v1" vaettir.native-full-local-config="${validated.fullLocalImageConfigDigest}" vaettir.native-compact-inventory="${validated.artifactInventorySha256}"`,
    ] : []),
  ];
  lines.splice(lines.indexOf(arg) + 1, 0, ...applicationAdded);
  const recipe = lines
    .map((v) =>
      copies.includes(v)
        ? v.replace("--from=llvm-build", "--from=vaettir-accepted-native-final")
        : v,
    )
    .join(eol);
  // Prove the transformation is only the fixed stage and two donor names.
  const restored = recipe
    .split(eol)
    .filter(
      (v, i) =>
        (i < runtimeIndex || i >= runtimeIndex + added.length) &&
        !applicationAdded.includes(v),
    )
    .map((v) =>
      v.replace("--from=vaettir-accepted-native-final", "--from=llvm-build"),
    )
    .join(eol);
  assert.equal(restored, original);
  const identity = {
    schemaVersion: 1,
    purpose: compact
      ? "native-compact-final-runtime-recipe-not-runtime-acceptance"
      : "native-final-runtime-recipe-not-runtime-acceptance",
    applicationCommit: app.expectedApplicationCommit,
    applicationArchiveSha256: app.expectedApplicationArchiveSha256,
    originalDockerfileSha256: sha(source),
    nativeSourceCommit: n.plan.identity.sourceCommit,
    nativeSourceArchiveSha256: n.plan.identity.sourceSha256,
    nativeImageDigest: validated.imageDigest,
    nativeImageConfigDigest: validated.imageConfigDigest,
    nativeFinalReceiptSha256: validated.finalReceiptSha256,
    rootReviewSha256: sha(raw),
    artifactInventorySha256: sha(JSON.stringify(review.artifacts)),
    ...(compact ? {
      nativeTransportKind: "compact-fixed15-v1",
      fullLocalImageConfigDigest: validated.fullLocalImageConfigDigest,
    } : {}),
    recipeSha256: sha(recipe),
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
    deploymentAcceptance: false,
  };
  return {
    recipe,
    identity,
    artifactVerificationProgram: program,
    requiresActualRuntimeBuildAndSecurityGates: true,
  };
}
