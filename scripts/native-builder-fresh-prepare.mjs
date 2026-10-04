// Local-only planning. This module never calls Git, AWS, Docker or credentials.
// Root supplies independently verified canonical Git export bytes and owns live
// admission, immutable upload, intent, one dispatch and completed-build readback.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inflateRawSync, gzipSync, gunzipSync } from "node:zlib";
import {
  prepareArchiveScriptIdentity,
  readGitArchiveScripts,
  nativeValidationShell,
} from "./native-builder-recovery.mjs";
import { validateNativeCheckpointReceipt } from "./native-builder-continuation.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (text) => "'" + text.replaceAll("'", "'\\''") + "'";
const hex = /^[a-f0-9]{64}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const decode = new TextDecoder("utf-8", { fatal: true });
const repository = "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api";
const oldCommit = "d3a952c5c3c407cba306f4da3de4a0cac2e0908e";
const oldReceipt =
  "54e96393c398f6a97f49f570de04fa758f18121aa2ebe90595f40ba29e38b09b";
const oldImage =
  "sha256:286d1f0af2b4c81b1c20592b2aac621b6b7ead6bcbf124065c2332326adb9c12";
export const FRESH_NATIVE_SCRIPT_LF_HASHES = Object.freeze({
  "build-llvm-runtime.sh":
    "c5c97e29d3722314faf2d09cda17a495972df30ab003ac55e80b6d18f308a0b9",
  "native-build-concurrency.mjs":
    "74ffed252e74bca52674f196e69d7cc3f24c1082f8ff976c1cbc04d369a9ffd0",
  "native-llvm-checkpoint.mjs":
    "74f6d17957efff26b27a959fd3592797cb3ddad65a4ca42cbf63e4c6b6b8d7a6",
  "fetch-runtime-vendor-sources.mjs":
    "a46abe15b0e838b48c633507028b358af1ee739df7af6fcf0854517ecba38e17",
  "runtime-vendor-sources.json":
    "9191a23df7d019f8c4a940ce3b52a336eee06fba487b210af528a5d827a0f481",
  "check-llvm-package.mjs":
    "c7a6e6e9b8bc40a51c4a794961d7832d6f01041d1a9641937f695fbaafea87ca",
  "check-llvm-jit.c":
    "02ba940dd4b3f054de6b49138b78494df36974c03d8369ef10da519c80e47c50",
  "check-llvm-arm-defaults.cpp":
    "fc0e9e4e1c24bd2e0b27b7268e52cc9c984a86771ccf67664824a8574ad0721b",
  "reconcile-llvm-arm-unit-fixture.mjs":
    "6d048860e12beb591cfdd94f8465caacf92b4bb06605df96e642d53da7f7adf9",
});
export const FRESH_NATIVE_DOCKERFILE_LF_SHA256 =
  "06624ebd0b0fcc95a2c91c7501d7037eb11b830d4d273cb98c9f76dd0d2a9f34";
const scriptCrlfHashes = Object.freeze({
  "build-llvm-runtime.sh":
    "01ec2b844b6c5a09417dd25bd47074a73119ffd6059cd11b3dd437eedaf541bc",
  "native-build-concurrency.mjs":
    "14c6924355a16797927f376f7841e5554fd52a9210efba4c96a4d5e935b7795a",
  "native-llvm-checkpoint.mjs":
    "1a49d9e12f65f13e7b9505542cd4a30497b4ea9bb151dbc20113d388c877061e",
  "fetch-runtime-vendor-sources.mjs":
    "2e17302ed4711f9fdf238749226c3d8ac9dd91cd7e9ba84e5dcaaa0001d0fa43",
  "runtime-vendor-sources.json":
    "9fe3a81df0157a5145e00648aa2ae0529706ed6e6970e0f1337734047acfec83",
  "check-llvm-package.mjs":
    "97223d718c40045c7a121827f0ef214195967953f2bd30b0bbdef70af16cd688",
  "check-llvm-jit.c":
    "4183a1d7b22f1a8e1fd6acdb94691a01e1a95dcea1274f3a192af02b955a1481",
  "check-llvm-arm-defaults.cpp":
    "3d4c2652b94993186b61975cef6f3c6944befcb23d26390b741713aa11231ad2",
  "reconcile-llvm-arm-unit-fixture.mjs":
    "af5e3bcbc1ba3775f92a13502bdf9b4735edbcccd4f24875277f64555a397102",
});
const dockerfileCrlfSha256 =
  "672e85d1a0617ffb5314d5c1d9a05c6f3e156d07a1e92238bf37d5395ec23b8c";
const scripts = Object.keys(FRESH_NATIVE_SCRIPT_LF_HASHES);
const keys = (value, names) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(
    Object.keys(value).sort(),
    [...names].sort(),
    "Exact supported fields required",
  );
};
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// Run the shared whole-ZIP structural/path/overlap validator first. This narrow
// reader additionally checks the one non-script regular-file entry and CRC.
function archiveDockerfile(archive, commit, modes) {
  readGitArchiveScripts(
    archive,
    commit,
    scripts,
    new Map(scripts.map((name) => [name, modes[name]])),
  );
  let end = -1;
  for (
    let i = archive.length - 22;
    i >= Math.max(0, archive.length - 65557);
    i--
  ) {
    if (
      archive.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + archive.readUInt16LE(i + 20) === archive.length
    ) {
      end = i;
      break;
    }
  }
  assert.ok(end >= 0);
  let offset = archive.readUInt32LE(end + 16);
  let found;
  for (let index = 0; index < archive.readUInt16LE(end + 10); index++) {
    const nameLength = archive.readUInt16LE(offset + 28),
      extra = archive.readUInt16LE(offset + 30),
      comment = archive.readUInt16LE(offset + 32);
    const name = decode.decode(
      archive.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (name === "Dockerfile.api") {
      assert.equal(found, undefined);
      const attributes = archive.readUInt32LE(offset + 38),
        mode = attributes >>> 16;
      assert.equal(modes["Dockerfile.api"], "100644");
      if (mode === 0 && attributes === 0)
        assert.equal(archive.readUInt16LE(offset + 4), 0);
      else
        assert.equal(
          mode.toString(8),
          "100644",
          "Dockerfile must be a regular Git file",
        );
      const local = archive.readUInt32LE(offset + 42);
      const start =
        local +
        30 +
        archive.readUInt16LE(local + 26) +
        archive.readUInt16LE(local + 28);
      const packed = archive.subarray(
        start,
        start + archive.readUInt32LE(offset + 20),
      );
      const size = archive.readUInt32LE(offset + 24);
      assert.ok(size > 0 && size <= 65536, "Bounded Dockerfile required");
      found =
        archive.readUInt16LE(offset + 10) === 0
          ? Buffer.from(packed)
          : inflateRawSync(packed, { maxOutputLength: 65536 });
      assert.equal(found.length, size);
      assert.equal(crc32(found), archive.readUInt32LE(offset + 16));
    }
    offset += 46 + nameLength + extra + comment;
  }
  assert.ok(found, "Exact archived Dockerfile required");
  return found;
}
function bindDockerfile(archiveBytes, blob, exported, mode) {
  assert.ok(Buffer.isBuffer(blob) && blob.length <= 65536 && mode === "100644");
  const text = decode.decode(blob);
  assert.equal(
    hash(text.replaceAll("\r\n", "\n")),
    FRESH_NATIVE_DOCKERFILE_LF_SHA256,
    "Reviewed Dockerfile content required",
  );
  let transform = "identical";
  if (!archiveBytes.equals(blob)) {
    assert.ok(
      Buffer.isBuffer(exported) && archiveBytes.equals(exported),
      "Exact deterministic Dockerfile export required",
    );
    const crlf = Buffer.from(text.replace(/(?<!\r)\n/g, "\r\n"));
    const lf = Buffer.from(text.replaceAll("\r\n", "\n"));
    assert.ok(
      archiveBytes.equals(crlf) || archiveBytes.equals(lf),
      "Only deterministic EOL export transforms allowed",
    );
    transform = archiveBytes.equals(crlf)
      ? "git-export-lf-to-crlf"
      : "git-export-crlf-to-lf";
  }
  return {
    archiveSha256: hash(archiveBytes),
    archiveBytes: archiveBytes.length,
    gitBlobSha256: hash(blob),
    gitBlobBytes: blob.length,
    transform,
    gitMode: mode,
  };
}
function packFreshPrepareOperation(operation) {
  assert.equal(typeof operation, "string");
  const bytes = Buffer.from(operation, "utf8");
  assert.ok(bytes.length > 0 && bytes.length <= 512 * 1024);
  const matched =
    /^timeout --signal=TERM --kill-after=75s ([1-9][0-9]{1,3})s bash -eu -o pipefail -c '/.exec(
      operation,
    );
  assert.ok(
    matched && Number(matched[1]) <= 2445,
    "Fixed fresh prepare cleanup grace required",
  );
  const compressed = gzipSync(bytes, { level: 9 });
  assert.ok(compressed.length <= 128 * 1024);
  return {
    encoding: "gzip-base64-sha256-v1",
    decodedSha256: hash(bytes),
    decodedBytes: bytes.length,
    compressedSha256: hash(compressed),
    compressedBytes: compressed.length,
    base64: compressed.toString("base64"),
  };
}
/** Fixed fresh-prepare transport only; decoding grants no dispatch authority. */
export function unpackFreshPrepareOperation(packed) {
  assert.deepEqual(
    Object.keys(packed).sort(),
    [
      "encoding",
      "decodedSha256",
      "decodedBytes",
      "compressedSha256",
      "compressedBytes",
      "base64",
    ].sort(),
  );
  assert.equal(packed.encoding, "gzip-base64-sha256-v1");
  for (const key of ["decodedSha256", "compressedSha256"])
    assert.match(packed[key], /^[a-f0-9]{64}$/);
  assert.ok(
    Number.isSafeInteger(packed.decodedBytes) &&
      packed.decodedBytes > 0 &&
      packed.decodedBytes <= 512 * 1024,
  );
  assert.ok(
    Number.isSafeInteger(packed.compressedBytes) &&
      packed.compressedBytes > 0 &&
      packed.compressedBytes <= 128 * 1024,
  );
  assert.ok(
    typeof packed.base64 === "string" &&
      packed.base64.length <= 176000 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(packed.base64),
  );
  const compressed = Buffer.from(packed.base64, "base64"),
    sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(compressed.toString("base64"), packed.base64);
  assert.equal(compressed.length, packed.compressedBytes);
  assert.equal(sha(compressed), packed.compressedSha256);
  const bytes = gunzipSync(compressed, { maxOutputLength: 512 * 1024 });
  assert.equal(bytes.length, packed.decodedBytes);
  assert.equal(sha(bytes), packed.decodedSha256);
  const operation = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const matched =
    /^timeout --signal=TERM --kill-after=75s ([1-9][0-9]{1,3})s bash -eu -o pipefail -c '/.exec(
      operation,
    );
  assert.ok(
    matched && Number(matched[1]) <= 2445,
    "Fixed cleanup grace and hard42-minute bound required",
  );
  return operation;
}

function freshBudget(budget) {
  keys(budget, [
    "mode",
    "prepareSeconds",
    "verificationSeconds",
    "pushSeconds",
    "totalSeconds",
  ]);
  assert.equal(
    budget.mode,
    "bounded-probe",
    "Fresh preparation has no borrowed duration forecast",
  );
  for (const key of [
    "prepareSeconds",
    "verificationSeconds",
    "pushSeconds",
    "totalSeconds",
  ])
    assert.ok(Number.isSafeInteger(budget[key]));
  assert.ok(budget.prepareSeconds >= 60 && budget.prepareSeconds <= 1800);
  assert.ok(
    budget.verificationSeconds >= 60 && budget.verificationSeconds <= 240,
  );
  assert.ok(budget.pushSeconds >= 60 && budget.pushSeconds <= 180);
  assert.ok(
    budget.totalSeconds <= 2520 &&
      budget.totalSeconds >=
        budget.prepareSeconds +
          budget.verificationSeconds +
          budget.pushSeconds +
          240 +
          75,
    "Admission/readback plus separate owned cleanup headroom required",
  );
  return {
    ...budget,
    expectedCompilerJobs: 5,
    verifierCpus: 2,
    verifierMemoryBytes: 2 * 1024 ** 3,
    minimumDiskAvailableBytes: 20 * 1024 ** 3,
    cleanupGraceSeconds: 75,
    operationSeconds: budget.totalSeconds - 75,
    decoderWatchdogSeconds: budget.totalSeconds + 30,
  };
}

function semanticsHash() {
  return hash(
    [
      semanticsHash,
      planNativeFreshPrepare,
      assemblePlan,
      freshBudget,
      bindDockerfile,
      archiveDockerfile,
      validateIdentity,
      validateNativeFreshPrepareCompleted,
      validateNativeCheckpointReceipt,
      nativeValidationShell,
      packFreshPrepareOperation,
      unpackFreshPrepareOperation,
      prepareArchiveScriptIdentity,
      readGitArchiveScripts,
      quote,
      hash,
      keys,
      crc32,
    ]
      .map((fn) => fn.toString())
      .join("\n") +
      JSON.stringify({
        FRESH_NATIVE_SCRIPT_LF_HASHES,
        scriptCrlfHashes,
        FRESH_NATIVE_DOCKERFILE_LF_SHA256,
        dockerfileCrlfSha256,
        oldCommit,
        oldReceipt,
        oldImage,
        repository,
      }),
  );
}
function validateIdentity(identity) {
  keys(identity, [
    "schemaVersion",
    "purpose",
    "plannerSemanticsSha256",
    "sourceCommit",
    "sourceSha256",
    "expectedScripts",
    "sourceBindings",
    "dockerfileBinding",
    "resources",
    "predecessorSha256",
  ]);
  assert.equal(identity.schemaVersion, 1);
  assert.equal(identity.purpose, "fresh-native-prepare-not-runtime");
  assert.equal(identity.predecessorSha256, null);
  assert.match(identity.sourceCommit, /^[a-f0-9]{40}$/);
  assert.notEqual(identity.sourceCommit, oldCommit);
  assert.match(identity.sourceSha256, hex);
  assert.equal(identity.plannerSemanticsSha256, semanticsHash());
  keys(identity.expectedScripts, scripts);
  keys(identity.sourceBindings, scripts);
  const binding = (value, allowed) => {
    keys(value, [
      "archiveSha256",
      "archiveBytes",
      "gitBlobSha256",
      "gitBlobBytes",
      "transform",
      "gitMode",
    ]);
    assert.ok(
      allowed.includes(value.archiveSha256) &&
        allowed.includes(value.gitBlobSha256),
    );
    assert.equal(value.gitMode, "100644");
    for (const key of ["archiveBytes", "gitBlobBytes"])
      assert.ok(
        Number.isSafeInteger(value[key]) &&
          value[key] > 0 &&
          value[key] <= 1024 * 1024,
      );
    assert.ok(
      ["identical", "git-export-lf-to-crlf", "git-export-crlf-to-lf"].includes(
        value.transform,
      ),
    );
    if (value.transform === "identical") {
      assert.equal(value.archiveSha256, value.gitBlobSha256);
      assert.equal(value.archiveBytes, value.gitBlobBytes);
    } else assert.notEqual(value.archiveSha256, value.gitBlobSha256);
  };
  for (const name of scripts) {
    binding(identity.sourceBindings[name], [
      FRESH_NATIVE_SCRIPT_LF_HASHES[name],
      scriptCrlfHashes[name],
    ]);
    assert.equal(
      identity.expectedScripts[name],
      identity.sourceBindings[name].archiveSha256,
    );
  }
  binding(identity.dockerfileBinding, [
    FRESH_NATIVE_DOCKERFILE_LF_SHA256,
    dockerfileCrlfSha256,
  ]);
  assert.ok(
    identity.dockerfileBinding.archiveBytes <= 65536 &&
      identity.dockerfileBinding.gitBlobBytes <= 65536,
  );
  keys(identity.resources, [
    "mode",
    "prepareSeconds",
    "verificationSeconds",
    "pushSeconds",
    "totalSeconds",
    "expectedCompilerJobs",
    "verifierCpus",
    "verifierMemoryBytes",
    "minimumDiskAvailableBytes",
    "cleanupGraceSeconds",
    "operationSeconds",
    "decoderWatchdogSeconds",
  ]);
  const {
    mode,
    prepareSeconds,
    verificationSeconds,
    pushSeconds,
    totalSeconds,
  } = identity.resources;
  assert.deepEqual(
    identity.resources,
    freshBudget({
      mode,
      prepareSeconds,
      verificationSeconds,
      pushSeconds,
      totalSeconds,
    }),
  );
}

/** Explicit byte maps, never callbacks that could invoke Git/cloud commands.
 * gitExports contains exact one-script Git ZIPs (used only for EOL differences)
 * and Dockerfile.api's exported file bytes. Entire canonical ZIP provenance is
 * still an independent root gate; a ZIP comment alone is not Git authenticity. */
export function planNativeFreshPrepare(input) {
  keys(input, [
    "sourceCommit",
    "archive",
    "archiveSha256",
    "gitBlobs",
    "gitExports",
    "gitModes",
    "budget",
  ]);
  assert.match(input.sourceCommit, /^[a-f0-9]{40}$/);
  assert.notEqual(
    input.sourceCommit,
    oldCommit,
    "Old prepared lineage is immutable",
  );
  assert.match(input.archiveSha256, hex);
  assert.ok(
    Buffer.isBuffer(input.archive) && input.archive.length <= 30 * 1024 * 1024,
  );
  assert.equal(hash(input.archive), input.archiveSha256);
  for (const map of [input.gitBlobs, input.gitExports, input.gitModes])
    keys(map, [...scripts, "Dockerfile.api"]);
  let blobBytes = 0,
    exportBytes = 0;
  for (const name of [...scripts, "Dockerfile.api"]) {
    assert.ok(
      Buffer.isBuffer(input.gitBlobs[name]) &&
        input.gitBlobs[name].length > 0 &&
        input.gitBlobs[name].length <= 1024 * 1024,
    );
    assert.ok(
      Buffer.isBuffer(input.gitExports[name]) &&
        input.gitExports[name].length > 0 &&
        input.gitExports[name].length <= 2 * 1024 * 1024,
      "Explicit bounded export bytes required",
    );
    blobBytes += input.gitBlobs[name].length;
    exportBytes += input.gitExports[name].length;
  }
  assert.ok(
    blobBytes <= 8 * 1024 * 1024 && exportBytes <= 16 * 1024 * 1024,
    "Bounded selected source maps required",
  );
  for (const name of scripts) {
    const bytes = input.gitBlobs[name];
    assert.ok(
      Buffer.isBuffer(bytes) &&
        bytes.length <= 1024 * 1024 &&
        input.gitModes[name] === "100644",
    );
    assert.equal(
      hash(decode.decode(bytes).replaceAll("\r\n", "\n")),
      FRESH_NATIVE_SCRIPT_LF_HASHES[name],
      "Reviewed native script content required",
    );
  }
  const bound = prepareArchiveScriptIdentity({
    archive: input.archive,
    archiveSha256: input.archiveSha256,
    commit: input.sourceCommit,
    scripts,
    gitBlob: (name) => input.gitBlobs[name],
    gitExport: (name) => input.gitExports[name],
    gitMode: (name) => input.gitModes[name],
  });
  const dockerfile = archiveDockerfile(
    input.archive,
    input.sourceCommit,
    input.gitModes,
  );
  const dockerfileBinding = bindDockerfile(
    dockerfile,
    input.gitBlobs["Dockerfile.api"],
    input.gitExports["Dockerfile.api"],
    input.gitModes["Dockerfile.api"],
  );
  const identity = {
    schemaVersion: 1,
    purpose: "fresh-native-prepare-not-runtime",
    plannerSemanticsSha256: semanticsHash(),
    sourceCommit: input.sourceCommit,
    sourceSha256: input.archiveSha256,
    expectedScripts: bound.expectedScripts,
    sourceBindings: bound.sourceBindings,
    dockerfileBinding,
    resources: freshBudget(input.budget),
    predecessorSha256: null,
  };
  validateIdentity(identity);
  return assemblePlan(identity);
}

function assemblePlan(identity) {
  const planSha256 = hash(JSON.stringify(identity));
  const tag = "native-fresh-prepare-" + planSha256.slice(0, 40),
    image = repository + ":" + tag;
  const prefix = "native-fresh-prepare-proof/";
  const context = "native-fresh-prepare-context";
  const common = `const assert=require('node:assert/strict'),fs=require('node:fs'),{createHash}=require('node:crypto');const sha=b=>createHash('sha256').update(b).digest('hex');const bounded=(p,n)=>{const s=fs.lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=n);const b=fs.readFileSync(p);assert.equal(b.length,s.size);return b};`;
  const absent = `${common}const x=JSON.parse(bounded('${prefix}tag-preflight.json',2097152));assert.deepEqual(x.images??[],[]);assert.equal(x.failures?.length,1);assert.equal(x.failures[0].failureCode,'ImageNotFound');assert.equal(x.failures[0].imageId.imageTag,${JSON.stringify(tag)});`;
  const archive = `${common}const bytes=bounded('${prefix}source.zip',31457280);assert.equal(sha(bytes),'${identity.sourceSha256}','Exact whole canonical source ZIP required before extraction');`;
  const source = `${common}assert.equal(process.env.VAETTIR_RELEASE_COMMIT,${JSON.stringify(identity.sourceCommit)},'Exact source request commit required');const pins=${JSON.stringify(identity.expectedScripts)};for(const[name,h]of Object.entries(pins))assert.equal(sha(bounded('${context}/scripts/'+name,1048576)),h,'Exact archived native script required');assert.equal(sha(bounded('${context}/Dockerfile.api',65536)),${JSON.stringify(identity.dockerfileBinding.archiveSha256)},'Exact archived Dockerfile required');`;
  const disk = `const assert=require('node:assert/strict'),fs=require('node:fs');const s=fs.statfsSync('/var/lib/docker',{bigint:true});assert.ok(s.bavail*s.bsize>=${identity.resources.minimumDiskAvailableBytes}n,'Fresh prepare storage admission failed');`;
  const inspect = `${common}const x=JSON.parse(bounded('${prefix}candidate-inspect.json',2097152));assert.equal(x.length,1);const[i]=x;assert.match(i.Id,/^sha256:[a-f0-9]{64}$/);assert.equal(i.Os,'linux');assert.equal(i.Architecture,'amd64');assert.ok(Number.isSafeInteger(i.Size)&&i.Size>0&&i.Size<64*1024**3);const labels=i.Config.Labels;assert.equal(labels['vaettir.source-commit'],${JSON.stringify(identity.sourceCommit)});assert.equal(labels['vaettir.source-sha256'],${JSON.stringify(identity.sourceSha256)});assert.equal(labels['vaettir.prepare-plan'],${JSON.stringify(planSha256)});assert.equal(labels['vaettir.runtime-eligible'],'false');assert.equal(labels['vaettir.artifact-purpose'],'llvm-builder-checkpoint');`;
  const readId = `${common}const p='${prefix}container-id';if(!fs.existsSync(p)){process.stdout.write('');}else{const id=bounded(p,64).toString('utf8');assert.match(id,/^[a-f0-9]{64}$/);process.stdout.write(id);}`;
  const container = `${common}const x=JSON.parse(bounded('${prefix}container-inspect.json',2097152)),[i]=x;assert.equal(x.length,1);assert.equal(i.Id,bounded('${prefix}container-id',64).toString('utf8'));const[c]=JSON.parse(bounded('${prefix}candidate-inspect.json',2097152));assert.equal(i.Image,c.Id);assert.equal(i.Config.Image,c.Id);assert.equal(i.Config.Labels['vaettir.prepare-owner'],${JSON.stringify(planSha256)});assert.equal(i.HostConfig.NetworkMode,'none');assert.equal(i.HostConfig.Privileged,false);assert.deepEqual(i.HostConfig.CapDrop,['ALL']);assert.ok(i.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(i.HostConfig.Memory,2147483648);assert.equal(i.HostConfig.NanoCpus,2000000000);assert.equal(i.HostConfig.PidsLimit,128);assert.deepEqual(i.Mounts,[]);`;
  const cleanupOwner = `${common}const x=JSON.parse(bounded('${prefix}cleanup-inspect.json',2097152));assert.equal(x.length,1);const[i]=x;assert.equal(i.Id,bounded('${prefix}container-id',64).toString('utf8'));const[c]=JSON.parse(bounded('${prefix}candidate-inspect.json',2097152));assert.equal(i.Image,c.Id);assert.equal(i.Config.Labels['vaettir.prepare-owner'],'${planSha256}');assert.deepEqual(i.Mounts,[]);`;
  const verifyBody = `${common}${validateNativeCheckpointReceipt.toString()};async function verifyFreshPrepare(checkpointStore){const pins=${JSON.stringify(identity.expectedScripts)};assert.deepEqual(fs.readdirSync('/build/scripts').sort(),Object.keys(pins).sort());for(const[name,h]of Object.entries(pins))assert.equal(sha(bounded('/build/scripts/'+name,1048576)),h);assert.ok(!fs.existsSync('/build/llvm-phase-active.json'));assert.deepEqual(fs.readdirSync('/build/llvm-phase-receipts'),['prepare.json']);const b=bounded('/build/llvm-phase-receipts/prepare.json',32768),receiptSha256=sha(b);assert.notEqual(receiptSha256,'${oldReceipt}');const r=validateNativeCheckpointReceipt(b,{phase:'prepare',sha256:receiptSha256,predecessorSha256:null});assert.equal(r.inputs.scripts.entries,9);const m=JSON.parse(bounded('/build/llvm-configure-only-measurement.json',8192));assert.equal(m.schemaVersion,1);assert.equal(m.purpose,'llvm-configure-only-measurement');assert.equal(m.mode,'checkpoint');assert.equal(m.boundedCompilerJobs,5);assert.equal(m.recipeSha256,pins['build-llvm-runtime.sh']);assert.equal(m.releaseCacheSha256,r.inputs.configuration[0].cache);assert.equal(m.assertionsCacheSha256,r.inputs.configuration[1].cache);const sourceManifestSha256=sha(bounded('/build/llvm-sources/source-manifest.json',65536));assert.equal(m.sourceManifestSha256,sourceManifestSha256);for(const k of ['compileAcceptance','unitAcceptance','candidateAbiAcceptance','packageCreated','runtimeAcceptance','authenticatedAcceptance'])assert.equal(m[k],false);checkpointStore().begin('release-core',receiptSha256);const p={schemaVersion:1,purpose:'fresh-native-prepare-actual-state',planSha256:'${planSha256}',sourceCommit:'${identity.sourceCommit}',sourceSha256:'${identity.sourceSha256}',receiptSha256,receiptBase64:b.toString('base64'),inputsSha256:r.inputsSha256,sourceManifestSha256,actualStateVerified:true,compiledAcceptance:false,unitAcceptance:false,packageAcceptance:false,runtimeAcceptance:false,authenticatedAcceptance:false,deploymentAcceptance:false};const serialized=JSON.stringify(p);assert.ok(Buffer.byteLength(serialized)<=65536);console.log('NATIVE_FRESH_PREPARE_STATE='+serialized);return p;}`;
  const verify = `${verifyBody};(async()=>{const{checkpointStore}=await import('/build/scripts/native-llvm-checkpoint.mjs');await verifyFreshPrepare(checkpointStore)})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1});`;
  const collect = String.raw`${common}const lines=bounded('${prefix}state.log',131072).toString('utf8').split(/\r?\n/).filter(l=>l.startsWith('NATIVE_FRESH_PREPARE_STATE='));assert.equal(lines.length,1);const p=JSON.parse(lines[0].slice('NATIVE_FRESH_PREPARE_STATE='.length));assert.equal(p.planSha256,'${planSha256}');assert.equal(p.sourceCommit,'${identity.sourceCommit}');assert.equal(p.sourceSha256,'${identity.sourceSha256}');assert.equal(p.actualStateVerified,true);for(const k of ['compiledAcceptance','unitAcceptance','packageAcceptance','runtimeAcceptance','authenticatedAcceptance','deploymentAcceptance'])assert.equal(p[k],false);fs.writeFileSync('${prefix}state-proof.json',JSON.stringify(p)+'\n',{flag:'wx'});`;
  const readback = String.raw`${common}const x=JSON.parse(bounded('${prefix}registry-manifest.json',2097152));assert.deepEqual(x.failures??[],[]);assert.equal(x.images.length,1);const i=x.images[0],d='sha256:'+sha(i.imageManifest);assert.equal(i.imageId.imageDigest,d);assert.equal(i.imageId.imageTag,'${tag}');assert.notEqual(d,'${oldImage}');const m=JSON.parse(i.imageManifest);assert.equal(m.schemaVersion,2);assert.equal(m.mediaType,'application/vnd.docker.distribution.manifest.v2+json');const[c]=JSON.parse(bounded('${prefix}candidate-inspect.json',2097152));assert.equal(m.config.digest,c.Id);assert.ok(m.layers.length>0&&m.layers.length<=100&&m.layers.every(l=>/^sha256:[a-f0-9]{64}$/.test(l.digest)&&Number.isSafeInteger(l.size)&&l.size>0));assert.ok(m.layers.reduce((n,l)=>n+l.size,0)<16*1024**3);const pushed=bounded('${prefix}push.log',1048576).toString('utf8').split(/\r?\n/).map(l=>/digest: (sha256:[a-f0-9]{64})(?:\s|$)/.exec(l)).filter(Boolean);assert.equal(pushed.length,1);assert.equal(pushed[0][1],d);const p=JSON.parse(bounded('${prefix}state-proof.json',65536));console.log('NATIVE_FRESH_PREPARE_VERIFIED='+JSON.stringify({...p,imageDigest:d,imageConfigDigest:c.Id,imageSizeBytes:c.Size,prePushInspection:true,digestPullEvidence:false}));`;
  const commands = [
    "trap 'exit 124' TERM",
    'test "$CODEBUILD_BUILD_SUCCEEDING" = 1',
    "timeout 20s docker info >/dev/null",
    `mkdir ${prefix.slice(0, -1)} ${context}`,
    // Override only the shared cleanup body; its single-shell EXIT trap remains.
    // Even a failed create's retained CID must pass ownership before removal.
    `cleanup_native_validation() { case "$native_validation_container" in '') return 0 ;; *[!0-9a-f]*) return 70 ;; esac; test "\${#native_validation_container}" = 64 || return 70; timeout 20s docker inspect "$native_validation_container" >${prefix}cleanup-inspect.json || return 70; timeout 20s node -e ${quote(cleanupOwner)} || return 70; timeout 20s docker rm -f "$native_validation_container" >/dev/null; }`,
    `timeout 20s node -e ${quote(disk)}`,
    // The bucket is unversioned. CodeBuild's automatic extraction is not a
    // source pin: fetch/hash exact whole bytes before extracting a fresh context.
    `timeout 60s aws s3api get-object --bucket vaettir-build-source-051722405355 --key releases/${identity.sourceCommit}/source.zip --expected-bucket-owner 051722405355 --region us-east-2 --output json ${prefix}source.zip >${prefix}source-download.json`,
    `timeout 20s node -e ${quote(archive)}`,
    `timeout 60s unzip -q ${prefix}source.zip -d ${context}`,
    `timeout 20s node -e ${quote(source)}`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageTag=${tag} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json >${prefix}tag-preflight.json`,
    `timeout 20s node -e ${quote(absent)}`,
    `timeout 60s aws ecr get-login-password --region us-east-2 | timeout 60s docker login --username AWS --password-stdin 051722405355.dkr.ecr.us-east-2.amazonaws.com`,
    `timeout --signal=TERM --kill-after=20s ${identity.resources.prepareSeconds}s docker build --progress=plain --target llvm-checkpoint-prepare --label vaettir.source-commit=${identity.sourceCommit} --label vaettir.source-sha256=${identity.sourceSha256} --label vaettir.prepare-plan=${planSha256} -t ${image} -f ${context}/Dockerfile.api ${context}`,
    `timeout 20s docker image inspect ${image} >${prefix}candidate-inspect.json`,
    `timeout 20s node -e ${quote(inspect)}`,
    "native_create_status=0",
    `native_candidate_image=$(timeout 20s docker image inspect --format '{{.Id}}' ${image})`,
    "printf '%s' \"$native_candidate_image\" | grep -Eq '^sha256:[a-f0-9]{64}$'",
    `timeout 30s docker create --cidfile ${prefix}container-id --label vaettir.prepare-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 2g --cpus 2 --entrypoint node "$native_candidate_image" -e ${quote(verify)} >${prefix}create-output.txt || native_create_status=$?`,
    `native_validation_container=$(timeout 20s node -e ${quote(readId)})`,
    'test "$native_create_status" = 0',
    'test -n "$native_validation_container"',
    `timeout 20s docker inspect "$native_validation_container" >${prefix}container-inspect.json`,
    `timeout 20s node -e ${quote(container)}`,
    `timeout --signal=TERM --kill-after=20s ${identity.resources.verificationSeconds}s docker start -a "$native_validation_container" | tee ${prefix}state.log`,
    'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_validation_container")" = 0',
    `timeout 20s node -e ${quote(collect)}`,
    "cleanup_native_validation",
    "native_validation_container=''",
    `timeout --signal=TERM --kill-after=20s ${identity.resources.pushSeconds}s docker push ${image} | tee ${prefix}push.log`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageTag=${tag} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json >${prefix}registry-manifest.json`,
    `timeout 20s node -e ${quote(readback)}`,
  ];
  const operation = `timeout --signal=TERM --kill-after=75s ${identity.resources.operationSeconds}s ${nativeValidationShell(commands)}`;
  assert.doesNotMatch(
    operation,
    /describe-images|put-role-policy|update-project|put-object|ecs |rds |migrate|:latest|--profile|--phase final|docker commit|docker pull/,
  );
  const transport = packFreshPrepareOperation(operation);
  const decoder = `const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{gunzipSync}=require('node:zlib'),{spawnSync}=require('node:child_process');${unpackFreshPrepareOperation.toString()};const operation=unpackFreshPrepareOperation(${JSON.stringify(transport)});const r=spawnSync('/bin/bash',['-eu','-o','pipefail','-c',operation],{stdio:'inherit',timeout:${identity.resources.decoderWatchdogSeconds * 1000},killSignal:'SIGTERM'});if(r.error)throw r.error;assert.equal(r.signal,null);assert.equal(r.status,0,'Reviewed fresh preparation failed');`;
  const buildspec = {
    version: "0.2",
    phases: {
      build: { commands: [`node -e ${quote(decoder)}`] },
      post_build: {
        commands: [
          'test "$CODEBUILD_BUILD_SUCCEEDING" = 1',
          'echo "FRESH BUILDER PREPARE ONLY: no core, complete units, package, runtime, security or deployment acceptance."',
        ],
      },
    },
  };
  const request = {
    projectName: "vaettir-api-build",
    sourceTypeOverride: "S3",
    sourceLocationOverride: `vaettir-build-source-051722405355/releases/${identity.sourceCommit}/source.zip`,
    buildspecOverride: JSON.stringify(buildspec),
    timeoutInMinutesOverride: 45,
    computeTypeOverride: "BUILD_GENERAL1_LARGE",
    environmentVariablesOverride: [
      {
        name: "VAETTIR_RELEASE_COMMIT",
        value: identity.sourceCommit,
        type: "PLAINTEXT",
      },
    ],
    idempotencyToken: "native-prepare-" + planSha256.slice(0, 40),
    autoRetryLimitOverride: 0,
  };
  assert.ok(
    Buffer.byteLength(request.buildspecOverride) <= 25600 &&
      request.buildspecOverride.length <= 25600,
    "CodeBuild 25600-byte buildspec bound required",
  );
  return {
    identity,
    planSha256,
    request,
    requestSha256: hash(JSON.stringify(request)),
    buildspecSha256: hash(request.buildspecOverride),
    candidateTag: tag,
    candidateImage: image,
    transport,
    operation,
    generatedPrograms: {
      archive,
      source,
      absent,
      disk,
      inspect,
      readId,
      container,
      cleanupOwner,
      verifyBody,
      verify,
      collect,
      readback,
      decoder,
    },
    receiptExpectation: {
      phase: "prepare",
      predecessorSha256: null,
      proof: {},
      hashKnownBeforeBuild: false,
    },
    compiledAcceptance: false,
    unitAcceptance: false,
    packageAcceptance: false,
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
    deploymentAcceptance: false,
    defaultRuntimeGraphChanged: false,
    dispatchRequiresRootPreflight: true,
    forecastAcceptance: false,
  };
}

/** Independently retained successful-build and registry evidence required.
 * This parser cannot itself prove that a build ran: root must retain actual
 * status/logs and bind expected fingerprints before supplying this envelope. */
export function validateNativeFreshPrepareCompleted(completed, expected, plan) {
  assert.ok(Buffer.byteLength(JSON.stringify(plan)) <= 1024 * 1024);
  validateIdentity(plan.identity);
  assert.deepEqual(
    plan,
    assemblePlan(plan.identity),
    "Original reviewed plan bytes required",
  );
  keys(expected, [
    "buildId",
    "planSha256",
    "requestSha256",
    "buildspecSha256",
    "imageDigest",
    "imageConfigDigest",
    "receiptSha256",
  ]);
  assert.match(
    expected.buildId,
    /^vaettir-api-build:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  );
  for (const key of [
    "planSha256",
    "requestSha256",
    "buildspecSha256",
    "receiptSha256",
  ])
    assert.match(expected[key], hex);
  for (const key of ["imageDigest", "imageConfigDigest"])
    assert.match(expected[key], digest);
  assert.notEqual(expected.imageDigest, oldImage);
  assert.notEqual(expected.receiptSha256, oldReceipt);
  for (const key of ["planSha256", "requestSha256", "buildspecSha256"])
    assert.equal(expected[key], plan[key]);
  assert.ok(Buffer.byteLength(JSON.stringify(completed)) <= 512 * 1024);
  keys(completed, [
    "schemaVersion",
    "purpose",
    "status",
    "buildId",
    "planSha256",
    "requestSha256",
    "buildspecSha256",
    "sourceCommit",
    "sourceSha256",
    "imageDigest",
    "imageConfigDigest",
    "receiptSha256",
    "proof",
    "registryManifest",
    "registryConfigBase64",
    "compiledAcceptance",
    "unitAcceptance",
    "packageAcceptance",
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
  ]);
  assert.equal(completed.schemaVersion, 1);
  assert.equal(completed.purpose, "completed-fresh-native-prepare");
  assert.equal(completed.status, "SUCCEEDED");
  for (const key of Object.keys(expected))
    assert.equal(completed[key], expected[key]);
  assert.equal(completed.sourceCommit, plan.identity.sourceCommit);
  assert.equal(completed.sourceSha256, plan.identity.sourceSha256);
  const proof = completed.proof;
  keys(proof, [
    "schemaVersion",
    "purpose",
    "planSha256",
    "sourceCommit",
    "sourceSha256",
    "receiptSha256",
    "receiptBase64",
    "inputsSha256",
    "sourceManifestSha256",
    "actualStateVerified",
    "imageDigest",
    "imageConfigDigest",
    "imageSizeBytes",
    "prePushInspection",
    "digestPullEvidence",
    "compiledAcceptance",
    "unitAcceptance",
    "packageAcceptance",
    "runtimeAcceptance",
    "authenticatedAcceptance",
    "deploymentAcceptance",
  ]);
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.purpose, "fresh-native-prepare-actual-state");
  for (const key of [
    "planSha256",
    "sourceCommit",
    "sourceSha256",
    "imageDigest",
    "imageConfigDigest",
    "receiptSha256",
  ])
    assert.equal(proof[key], completed[key]);
  assert.equal(proof.actualStateVerified, true);
  assert.equal(proof.prePushInspection, true);
  assert.equal(proof.digestPullEvidence, false);
  assert.ok(
    Number.isSafeInteger(proof.imageSizeBytes) &&
      proof.imageSizeBytes > 0 &&
      proof.imageSizeBytes < 64 * 1024 ** 3,
  );
  for (const value of [completed, proof])
    for (const key of [
      "compiledAcceptance",
      "unitAcceptance",
      "packageAcceptance",
      "runtimeAcceptance",
      "authenticatedAcceptance",
      "deploymentAcceptance",
    ])
      assert.equal(value[key], false);
  const base64 = (value, bound) => {
    assert.ok(
      typeof value === "string" &&
        value.length <= Math.ceil(bound / 3) * 4 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    );
    const b = Buffer.from(value, "base64");
    assert.ok(b.length > 0 && b.length <= bound);
    assert.equal(b.toString("base64"), value);
    return b;
  };
  const receipt = validateNativeCheckpointReceipt(
    base64(proof.receiptBase64, 32768),
    {
      phase: "prepare",
      sha256: expected.receiptSha256,
      predecessorSha256: null,
      inputsSha256: proof.inputsSha256,
    },
  );
  assert.equal(receipt.inputs.scripts.entries, 9);
  assert.match(proof.sourceManifestSha256, hex);
  const readback = completed.registryManifest;
  assert.deepEqual(readback.failures ?? [], []);
  assert.equal(readback.images.length, 1);
  const image = readback.images[0];
  assert.equal(image.imageId.imageDigest, expected.imageDigest);
  assert.equal(image.imageId.imageTag, plan.candidateTag);
  assert.ok(
    typeof image.imageManifest === "string" &&
      Buffer.byteLength(image.imageManifest) <= 2 * 1024 * 1024,
  );
  assert.equal("sha256:" + hash(image.imageManifest), expected.imageDigest);
  const manifest = JSON.parse(image.imageManifest);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(
    manifest.mediaType,
    "application/vnd.docker.distribution.manifest.v2+json",
  );
  assert.equal(manifest.config.digest, expected.imageConfigDigest);
  assert.ok(
    Array.isArray(manifest.layers) &&
      manifest.layers.length > 0 &&
      manifest.layers.length <= 100 &&
      manifest.layers.every(
        (l) =>
          digest.test(l.digest) && Number.isSafeInteger(l.size) && l.size > 0,
      ),
  );
  assert.ok(manifest.layers.reduce((n, l) => n + l.size, 0) < 16 * 1024 ** 3);
  const configBytes = base64(completed.registryConfigBase64, 256 * 1024);
  assert.equal("sha256:" + hash(configBytes), expected.imageConfigDigest);
  // A raw config can contain unrelated environment/history. Never echo its
  // bytes or parser excerpts on refusal, and only inspect allowed metadata.
  let config;
  try {
    config = JSON.parse(decode.decode(configBytes));
  } catch {
    throw new Error("Unsupported registry configuration encoding or JSON");
  }
  assert.ok(
    config?.os === "linux" && config?.architecture === "amd64",
    "Registry platform mismatch",
  );
  assert.ok(
    config?.rootfs?.type === "layers" &&
      Array.isArray(config.rootfs.diff_ids) &&
      config.rootfs.diff_ids.length === manifest.layers.length &&
      config.rootfs.diff_ids.every(
        (item) => typeof item === "string" && digest.test(item),
      ),
    "Registry rootfs mismatch",
  );
  const labels = config?.config?.Labels;
  for (const [name, value] of Object.entries({
    "vaettir.source-commit": plan.identity.sourceCommit,
    "vaettir.source-sha256": plan.identity.sourceSha256,
    "vaettir.prepare-plan": plan.planSha256,
    "vaettir.artifact-purpose": "llvm-builder-checkpoint",
    "vaettir.runtime-eligible": "false",
  }))
    assert.ok(labels?.[name] === value, "Registry identity label mismatch");
  return {
    receipt,
    receiptSha256: expected.receiptSha256,
    inputsSha256: receipt.inputsSha256,
    imageDigest: expected.imageDigest,
    imageConfigDigest: expected.imageConfigDigest,
    sourceCommit: plan.identity.sourceCommit,
    sourceSha256: plan.identity.sourceSha256,
    actualStateVerified: true,
    runtimeAcceptance: false,
    continuationSupported: false,
  };
}
