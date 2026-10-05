// Pure fresh-lineage planning only. No AWS/Git/Docker/credentials at import or
// invocation. Root retains actual source/build/log/registry evidence and owns
// all dispatch/admission. Assertion objects are not unit or runtime acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync, inflateRawSync } from "node:zlib";
import { validateNativeFreshCoreCompleted } from "./native-packaging-v2-builder-fresh-core.mjs";
import { validateNativeCheckpointReceipt } from "./native-builder-continuation.mjs";
import { unpackFreshPrepareOperation } from "./native-packaging-v2-builder-fresh-prepare.mjs";
import { nativeValidationShell } from "./native-builder-recovery.mjs";

const phases = [
  "release-units",
  "assertion-compile-1",
  "assertion-compile-2",
  "assertion-compile-3",
];
const flags = [
  "unitAcceptance",
  "packageAcceptance",
  "runtimeAcceptance",
  "authenticatedAcceptance",
  "deploymentAcceptance",
];
const repository = "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api";
// Python 3.13 documents this fixed setting as equivalent to -B on imports:
// https://docs.python.org/3.13/using/cmdline.html#envvar-PYTHONDONTWRITEBYTECODE
// Prevent the observed lit __pycache__ writes, never exclude/rebaseline source.
const pythonBytecodePolicy = Object.freeze({ PYTHONDONTWRITEBYTECODE: "1" });
const hex = /^[a-f0-9]{64}$/,
  digest = /^sha256:[a-f0-9]{64}$/;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
function keys(x, names) {
  assert.ok(x && typeof x === "object" && !Array.isArray(x));
  assert.deepEqual(Object.keys(x).sort(), [...names].sort());
}
function bytes(s, max) {
  assert.ok(
    typeof s === "string" &&
      s.length <= Math.ceil(max / 3) * 4 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(s),
  );
  const b = Buffer.from(s, "base64");
  assert.ok(b.length > 0 && b.length <= max);
  assert.equal(b.toString("base64"), s);
  return b;
}
/** Transport framing is ASCII; its payload is the exact original public native
 * compiler stream. Never reconstruct that stream from CloudWatch line endings. */
export function encodeNativeFreshPhaseLog(raw, identity) {
  assert.ok(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 16777216);
  assert.deepEqual(
    Object.keys(identity).sort(),
    ["planSha256", "phase", "phaseLogSha256"].sort(),
  );
  assert.ok(
    [
      "release-units",
      "assertion-compile-1",
      "assertion-compile-2",
      "assertion-compile-3",
    ].includes(identity.phase),
  );
  for (const key of ["planSha256", "phaseLogSha256"])
    assert.match(identity[key], /^[a-f0-9]{64}$/);
  const hash = (b) => createHash("sha256").update(b).digest("hex");
  assert.equal(hash(raw), identity.phaseLogSha256);
  const compressed = gzipSync(raw, { level: 9 });
  // Fixed header: no filename/comment/mtime/extra fields or platform variability.
  compressed[9] = 255;
  assert.ok(compressed.length > 0 && compressed.length <= 2097152);
  assert.equal(
    compressed.subarray(0, 10).toString("hex"),
    "1f8b08000000000002ff",
  );
  const data = compressed.toString("base64"),
    width = 12288,
    count = Math.ceil(data.length / width),
    compressedHash = hash(compressed);
  assert.ok(count > 0 && count <= 228);
  return Array.from({ length: count }, (_, index) => {
    const record = {
      schemaVersion: 1,
      purpose: "public-native-compiler-stream",
      planSha256: identity.planSha256,
      phase: identity.phase,
      encoding: "gzip-base64-sha256-v1",
      index,
      count,
      decodedSha256: identity.phaseLogSha256,
      decodedBytes: raw.length,
      compressedSha256: compressedHash,
      compressedBytes: compressed.length,
      data: data.slice(index * width, (index + 1) * width),
    };
    const line = "NATIVE_FRESH_NEXT_LOG_CHUNK=" + JSON.stringify(record);
    assert.ok(Buffer.byteLength(line) <= 16384);
    return line;
  });
}
function phaseLogCrc32(raw) {
  let crc = 0xffffffff;
  for (const byte of raw) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** PURE collector gate. Pass only actual anchored chunk lines in observed order,
 * without trimming their JSON. Returned Buffer is the original stream, not an
 * inferred log, unit result, or acceptance flag. Exactly one gzip member only. */
export function reassembleNativeFreshPhaseLog(messages, expected) {
  keys(expected, ["planSha256", "phase", "phaseLogSha256"]);
  assert.ok(phases.includes(expected.phase));
  for (const key of ["planSha256", "phaseLogSha256"])
    assert.match(expected[key], hex);
  assert.ok(
    Array.isArray(messages) && messages.length > 0 && messages.length <= 228,
  );
  const prefix = "NATIVE_FRESH_NEXT_LOG_CHUNK=",
    parts = [];
  let first;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    assert.ok(
      typeof message === "string" &&
        Buffer.byteLength(message) <= 16384 &&
        message.startsWith(prefix),
    );
    const text = message.slice(prefix.length);
    let item;
    try {
      item = JSON.parse(text);
    } catch {
      throw new Error("Unsupported phase log chunk JSON");
    }
    const names = [
      "schemaVersion",
      "purpose",
      "planSha256",
      "phase",
      "encoding",
      "index",
      "count",
      "decodedSha256",
      "decodedBytes",
      "compressedSha256",
      "compressedBytes",
      "data",
    ];
    keys(item, names);
    assert.deepEqual(
      Object.keys(item),
      names,
      "Canonical chunk field order required",
    );
    assert.equal(
      JSON.stringify(item),
      text,
      "Canonical chunk JSON, no trailing or duplicate data",
    );
    assert.equal(item.schemaVersion, 1);
    assert.equal(item.purpose, "public-native-compiler-stream");
    assert.equal(item.encoding, "gzip-base64-sha256-v1");
    assert.equal(item.planSha256, expected.planSha256);
    assert.equal(item.phase, expected.phase);
    assert.equal(item.decodedSha256, expected.phaseLogSha256);
    assert.match(item.compressedSha256, hex);
    assert.equal(item.index, index, "No reordered or duplicate chunks");
    assert.equal(item.count, messages.length);
    assert.ok(
      Number.isSafeInteger(item.decodedBytes) &&
        item.decodedBytes > 0 &&
        item.decodedBytes <= 16777216,
    );
    assert.ok(
      Number.isSafeInteger(item.compressedBytes) &&
        item.compressedBytes >= 18 &&
        item.compressedBytes <= 2097152,
    );
    if (!first) first = item;
    for (const key of [
      "count",
      "decodedSha256",
      "decodedBytes",
      "compressedSha256",
      "compressedBytes",
    ])
      assert.equal(item[key], first[key]);
    assert.ok(
      typeof item.data === "string" &&
        item.data.length > 0 &&
        item.data.length <= 12288 &&
        item.data.length % 4 === 0 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(item.data),
    );
    if (index < messages.length - 1) {
      assert.equal(item.data.length, 12288);
      assert.ok(!item.data.includes("="));
    }
    parts.push(item.data);
  }
  const encoded = parts.join("");
  assert.ok(encoded.length <= 2796204);
  assert.equal(messages.length, Math.ceil(encoded.length / 12288));
  const compressed = bytes(encoded, 2097152);
  assert.equal(compressed.length, first.compressedBytes);
  assert.equal(sha(compressed), first.compressedSha256);
  assert.equal(
    compressed.subarray(0, 10).toString("hex"),
    "1f8b08000000000002ff",
    "Canonical single-member gzip header required",
  );
  const deflate = compressed.subarray(10, -8);
  let inflated;
  try {
    inflated = inflateRawSync(deflate, {
      maxOutputLength: 16777216,
      info: true,
    });
  } catch {
    throw new Error("Unsupported or oversized phase log compression");
  }
  assert.equal(
    inflated.engine.bytesWritten,
    deflate.length,
    "Trailing data or additional gzip member refused",
  );
  const raw = inflated.buffer;
  assert.ok(raw.length > 0 && raw.length <= 16777216);
  assert.equal(raw.length, first.decodedBytes);
  assert.equal(
    compressed.readUInt32LE(compressed.length - 8),
    phaseLogCrc32(raw),
    "Exact gzip CRC required",
  );
  assert.equal(
    compressed.readUInt32LE(compressed.length - 4),
    raw.length,
    "Exact gzip original size required",
  );
  assert.equal(sha(raw), expected.phaseLogSha256);
  return {
    bytes: raw,
    phaseLogSha256: sha(raw),
    planSha256: expected.planSha256,
    phase: expected.phase,
    chunks: messages.length,
    compressedSha256: first.compressedSha256,
    limits: {
      decodedBytes: 16777216,
      compressedBytes: 2097152,
      chunkLineBytes: 16384,
      chunks: 228,
    },
  };
}
function budgetOf(b) {
  keys(b, [
    "mode",
    "compileSeconds",
    "postCompileReserveSeconds",
    "totalSeconds",
  ]);
  assert.equal(
    b.mode,
    "bounded-probe",
    "Phase-specific timing is unmeasured, not a borrowed core forecast",
  );
  for (const key of [
    "compileSeconds",
    "postCompileReserveSeconds",
    "totalSeconds",
  ])
    assert.ok(Number.isSafeInteger(b[key]));
  assert.ok(b.compileSeconds >= 60 && b.compileSeconds <= 2100);
  assert.ok(
    b.postCompileReserveSeconds >= 120 && b.postCompileReserveSeconds <= 300,
  );
  assert.ok(
    b.totalSeconds <= 2520 &&
      b.totalSeconds >=
        b.compileSeconds + b.postCompileReserveSeconds + 60 + 75,
  );
  return {
    ...b,
    operationSeconds: b.totalSeconds - 75,
    cleanupGraceSeconds: 75,
    decoderWatchdogSeconds: b.totalSeconds + 30,
    cpus: 8,
    memoryBytes: 14 * 1024 ** 3,
    compilerJobs: 5,
    minimumDiskAvailableBytes: 72 * 1024 ** 3,
    forecastAcceptance: false,
  };
}
function bareBudget(r) {
  return Object.fromEntries(
    ["mode", "compileSeconds", "postCompileReserveSeconds", "totalSeconds"].map(
      (k) => [k, r[k]],
    ),
  );
}
function semanticHash() {
  return sha(
    [
      planNativeFreshNextPhase,
      validateNativeFreshNextPhaseCompleted,
      encodeNativeFreshPhaseLog,
      reassembleNativeFreshPhaseLog,
      phaseLogCrc32,
      validatedOrigin,
      phaseIdentity,
      assemble,
      validateCompleted,
      budgetOf,
      bareBudget,
      semanticHash,
      keys,
      bytes,
      registryEvidence,
      pack,
      sha,
      quote,
      validateNativeFreshCoreCompleted,
      validateNativeCheckpointReceipt,
      unpackFreshPrepareOperation,
      nativeValidationShell,
    ]
      .map((f) => f.toString())
      .join("\n") +
      JSON.stringify({ phases, flags, repository, pythonBytecodePolicy }),
  );
}
function validatedOrigin(core) {
  keys(core, ["completed", "expected", "plan", "planningInput"]);
  assert.ok(
    Buffer.byteLength(JSON.stringify(core)) <= 2 * 1024 * 1024,
    "Bounded flat original core evidence required",
  );
  const verified = validateNativeFreshCoreCompleted(
    core.completed,
    core.expected,
    core.plan,
    core.planningInput,
  );
  return {
    sourceCommit: verified.sourceCommit,
    sourceSha256: verified.sourceSha256,
    inputsSha256: verified.inputsSha256,
    preparePlanSha256: core.plan.identity.preparePlanSha256,
    sourceManifestSha256: core.plan.identity.sourceManifestSha256,
    expectedScripts: { ...core.plan.identity.expectedScripts },
    coreExpected: { ...core.expected },
    coreCandidateSha256: core.completed.proof.candidateSha256,
    coreAbiReceiptSha256: core.completed.proof.abiReceiptSha256,
  };
}
function phaseIdentity(origin, parent, chain, phase, budget) {
  const index = phases.indexOf(phase);
  assert.ok(
    index >= 0,
    "Only fresh release-units and assertion compilation partitions supported; final is unsupported",
  );
  assert.equal(
    chain.length,
    index + 2,
    "Exact ordered preceding receipts required",
  );
  return {
    schemaVersion: 1,
    purpose: "native-packaging-v2-fresh-next-phase-not-runtime",
    plannerSemanticsSha256: semanticHash(),
    ...origin,
    phase,
    successorPhase: phases[index + 1] ?? "final",
    expectedParent: { ...parent },
    receiptChain: chain.map((x) => ({ ...x })),
    phaseCommandKind:
      index === 0 ? "COMPLETE_RELEASE_UNITS" : "ASSERTION_OBJECT_PARTITION",
    releaseTarget: index === 0 ? "check-llvm-unit" : null,
    assertionPartition: index === 0 ? null : index,
    pythonBytecodePolicy: { ...pythonBytecodePolicy },
    resources: budgetOf(budget),
  };
}
/** Flat bounded lineage. Every preceding plan is reconstructed from validated
 * earlier records; no self-asserted completed parent or mutable source donor. */
function planNativeFreshNextPhase(input) {
  keys(input, ["phase", "core", "completedPhases", "budget"]);
  const index = phases.indexOf(input.phase);
  assert.ok(index >= 0, "Final transport and unknown phases are unsupported");
  assert.ok(
    Array.isArray(input.completedPhases) &&
      input.completedPhases.length === index &&
      index <= 3,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(input)) <= 4 * 1024 * 1024);
  const origin = validatedOrigin(input.core);
  let parent = input.core.expected,
    chain = input.core.completed.receiptChain;
  for (let i = 0; i < index; i++) {
    const record = input.completedPhases[i];
    keys(record, ["completed", "expected", "plan"]);
    assert.equal(record.plan.identity.phase, phases[i]);
    const derived = assemble(
      phaseIdentity(
        origin,
        parent,
        chain,
        phases[i],
        bareBudget(record.plan.identity.resources),
      ),
    );
    assert.deepEqual(
      record.plan,
      derived,
      "Exact reviewed preceding phase plan required",
    );
    const verified = validateCompleted(
      record.completed,
      record.expected,
      derived,
    );
    parent = record.expected;
    chain = verified.chain;
  }
  return assemble(
    phaseIdentity(origin, parent, chain, input.phase, input.budget),
  );
}
function pack(operation) {
  const b = Buffer.from(operation);
  assert.ok(b.length > 0 && b.length <= 512 * 1024);
  const compressed = gzipSync(b, { level: 9 });
  assert.ok(compressed.length <= 128 * 1024);
  const packed = {
    encoding: "gzip-base64-sha256-v1",
    decodedSha256: sha(b),
    decodedBytes: b.length,
    compressedSha256: sha(compressed),
    compressedBytes: compressed.length,
    base64: compressed.toString("base64"),
  };
  assert.equal(unpackFreshPrepareOperation(packed), operation);
  return packed;
}

function assemble(identity) {
  assert.deepEqual(identity.pythonBytecodePolicy, pythonBytecodePolicy);
  const planSha256 = sha(JSON.stringify(identity)),
    phase = identity.phase,
    tag = "native-fresh-" + phase + "-" + planSha256.slice(0, 32),
    candidate = repository + ":" + tag,
    parent = repository + "@" + identity.expectedParent.imageDigest,
    prefix = "native-fresh-next-proof/",
    r = identity.resources;
  const parentHash = identity.expectedParent.receiptSha256,
    parentConfig = identity.expectedParent.imageConfigDigest;
  const common = `const fs=require('node:fs'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');const sha=b=>createHash('sha256').update(b).digest('hex');const bounded=(p,n)=>{const s=fs.lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=n);const b=fs.readFileSync(p);assert.equal(b.length,s.size);return b};`;
  const parser = validateNativeCheckpointReceipt.toString();
  const disk = `const fs=require('node:fs'),assert=require('node:assert/strict');const s=fs.statfsSync('/var/lib/docker',{bigint:true});assert.ok(s.bavail*s.bsize>=${r.minimumDiskAvailableBytes}n);`;
  const start = `${common}assert.equal(process.env.PYTHONDONTWRITEBYTECODE,'1');assert.equal(process.env.VAETTIR_RELEASE_COMMIT,'${identity.sourceCommit}');fs.writeFileSync('${prefix}admission.json',JSON.stringify({planSha256:'${planSha256}',startedNs:process.hrtime.bigint().toString()})+String.fromCharCode(10),{flag:'wx'});`;
  const admit = `${common}assert.equal(process.env.PYTHONDONTWRITEBYTECODE,'1');const a=JSON.parse(bounded('${prefix}admission.json',512));assert.equal(a.planSha256,'${planSha256}');assert.match(a.startedNs,/^[0-9]{1,30}$/);const elapsed=process.hrtime.bigint()-BigInt(a.startedNs);assert.ok(elapsed>=0n);assert.ok(${r.operationSeconds}-Number(elapsed/1000000000n)>=${r.compileSeconds + r.postCompileReserveSeconds},'Remaining observed deadline cannot admit complete phase and post-work');`;
  const absent = `${common}const x=JSON.parse(bounded('${prefix}tag-preflight.json',2097152));assert.deepEqual(x.images??[],[]);assert.equal(x.failures?.length,1);assert.equal(x.failures[0].failureCode,'ImageNotFound');assert.equal(x.failures[0].imageId.imageTag,'${tag}');`;
  const manifest = `${common}const x=JSON.parse(bounded('${prefix}parent-manifest.json',2097152));assert.deepEqual(x.failures??[],[]);assert.equal(x.images.length,1);const i=x.images[0];assert.equal(i.imageId.imageDigest,'${identity.expectedParent.imageDigest}');assert.equal('sha256:'+sha(i.imageManifest),'${identity.expectedParent.imageDigest}');const m=JSON.parse(i.imageManifest);assert.equal(m.schemaVersion,2);assert.equal(m.mediaType,'application/vnd.docker.distribution.manifest.v2+json');assert.equal(m.config.digest,'${parentConfig}');assert.ok(m.layers.length>0&&m.layers.length<=100&&m.layers.every(l=>/^sha256:[a-f0-9]{64}$/.test(l.digest)&&Number.isSafeInteger(l.size)&&l.size>0));assert.ok(m.layers.reduce((n,l)=>n+l.size,0)<16*1024**3);`;
  const labels = {
    "vaettir.source-commit": identity.sourceCommit,
    "vaettir.source-sha256": identity.sourceSha256,
    "vaettir.prepare-plan": identity.preparePlanSha256,
    "vaettir.continuation-plan": identity.expectedParent.planSha256,
    "vaettir.runtime-eligible": "false",
    "vaettir.artifact-purpose": "llvm-builder-checkpoint",
  };
  if (phase !== "release-units")
    labels["vaettir.continuation-phase"] = phases[phases.indexOf(phase) - 1];
  const inspect = `${common}const a=JSON.parse(bounded('${prefix}parent-inspect.json',2097152));assert.equal(a.length,1);const[i]=a;assert.equal(i.Id,'${parentConfig}');assert.equal(i.Os,'linux');assert.equal(i.Architecture,'amd64');assert.ok(i.RepoDigests.includes('${parent}'));assert.ok(Number.isSafeInteger(i.Size)&&i.Size>0&&i.Size<64*1024**3);for(const[k,v]of Object.entries(${JSON.stringify(labels)}))assert.equal(i.Config.Labels[k],v);`;
  const readId = `${common}const p='${prefix}container-id';if(fs.existsSync(p)){const id=bounded(p,64).toString('utf8');assert.match(id,/^[a-f0-9]{64}$/);process.stdout.write(id)}else process.stdout.write('');`;
  const readCommitId = `${common}const id=bounded('${prefix}commit-id.txt',80).toString('utf8').trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);process.stdout.write(id);`;
  const cleanup = `${common}const a=JSON.parse(bounded('${prefix}cleanup-inspect.json',2097152));assert.equal(a.length,1);const[i]=a;assert.equal(i.Id,bounded('${prefix}container-id',64).toString());assert.equal(i.Image,bounded('${prefix}cleanup-image-id',80).toString());assert.equal(i.Config.Labels['vaettir.next-owner'],'${planSha256}');assert.deepEqual(i.Mounts,[]);`;
  const setParent = `${common}fs.writeFileSync('${prefix}cleanup-image-id','${parentConfig}',{flag:'wx'});`;
  const setCandidate = `${common}const id=bounded('${prefix}commit-id.txt',80).toString().trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);fs.writeFileSync('${prefix}cleanup-image-id',id,{flag:'wx'});`;
  function container(verifier) {
    const name = verifier ? "verifier" : "compiler";
    const image = verifier
      ? `const image=bounded('${prefix}commit-id.txt',80).toString().trim();assert.match(image,/^sha256:[a-f0-9]{64}$/);assert.equal(i.Image,image);assert.equal(i.Config.Image,image);`
      : `assert.equal(i.Image,'${parentConfig}');assert.equal(i.Config.Image,'${parent}');`;
    return `${common}const a=JSON.parse(bounded('${prefix}${name}-inspect.json',2097152));assert.equal(a.length,1);const[i]=a;assert.equal(i.Id,bounded('${prefix}container-id',64).toString());${image}assert.equal(i.Config.Labels['vaettir.next-owner'],'${planSha256}');assert.ok(Array.isArray(i.Config.Env)&&i.Config.Env.length<=256&&i.Config.Env.every(v=>typeof v==='string'&&v.length<=4096));assert.deepEqual(i.Config.Env.filter(v=>v.startsWith('PYTHONDONTWRITEBYTECODE=')),['PYTHONDONTWRITEBYTECODE=1']);assert.equal(i.HostConfig.NetworkMode,'none');assert.equal(i.HostConfig.Privileged,false);assert.deepEqual(i.HostConfig.CapDrop,['ALL']);assert.ok(i.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(i.HostConfig.Memory,${verifier ? 2 : 14}*1024**3);assert.equal(i.HostConfig.NanoCpus,${verifier ? 2 : 8}e9);assert.equal(i.HostConfig.PidsLimit,${verifier ? 128 : 2048});assert.deepEqual(i.Mounts,[]);`;
  }
  const compilerInspect = container(false),
    verifierInspect = container(true);
  const chain = identity.receiptChain.map(({ phase, sha256 }) => ({
    phase,
    sha256,
  }));
  const checkParent = `const chain=${JSON.stringify(chain)};assert.deepEqual(fs.readdirSync('/build/llvm-phase-receipts').sort(),chain.map(c=>c.phase+'.json').sort());let prior=null;for(const c of chain){const b=bounded('/build/llvm-phase-receipts/'+c.phase+'.json',32768);validateNativeCheckpointReceipt(b,{phase:c.phase,sha256:c.sha256,predecessorSha256:prior,inputsSha256:'${identity.inputsSha256}'});prior=c.sha256;}`;
  const checkSources = `const pins=${JSON.stringify(identity.expectedScripts)};assert.deepEqual(fs.readdirSync('/build/scripts').sort(),Object.keys(pins).sort());for(const[n,h]of Object.entries(pins))assert.equal(sha(bounded('/build/scripts/'+n,1048576)),h);assert.equal(sha(bounded('/build/llvm-sources/source-manifest.json',65536)),'${identity.sourceManifestSha256}');`;
  const pre = `${common}${parser};assert.equal(process.env.PYTHONDONTWRITEBYTECODE,'1');assert.ok(!fs.existsSync('/build/llvm-phase-active.json'));${checkSources}${checkParent}const jobs=require('node:child_process').execFileSync(process.execPath,['/build/scripts/native-build-concurrency.mjs'],{encoding:'utf8',timeout:30000,maxBuffer:4096}).trim();assert.equal(jobs,'5');`;
  const evidenceBody = `${common}${parser};async function verifyFreshNextEvidence(hashCandidateLibrary){assert.ok(!fs.existsSync('/build/llvm-phase-active.json'));${checkSources}const chain=${JSON.stringify(chain)};chain.push({phase:'${phase}',sha256:sha(bounded('/build/llvm-phase-receipts/${phase}.json',32768))});assert.deepEqual(fs.readdirSync('/build/llvm-phase-receipts').sort(),chain.map(c=>c.phase+'.json').sort());let prior=null;for(const c of chain){validateNativeCheckpointReceipt(bounded('/build/llvm-phase-receipts/'+c.phase+'.json',32768),{phase:c.phase,sha256:c.sha256,predecessorSha256:prior,inputsSha256:'${identity.inputsSha256}'});prior=c.sha256;}const b=bounded('/build/llvm-phase-receipts/${phase}.json',32768),receipt=validateNativeCheckpointReceipt(b,{phase:'${phase}',sha256:sha(b),predecessorSha256:'${parentHash}',inputsSha256:'${identity.inputsSha256}'});assert.deepEqual(receipt.proof,{});const abiBytes=bounded('/build/llvm-early-abi.json',32768),abi=JSON.parse(abiBytes);assert.equal(sha(abiBytes),'${identity.coreAbiReceiptSha256}');assert.equal(abi.candidateSha256,'${identity.coreCandidateSha256}');assert.equal(abi.baselineSha256,receipt.inputs.baselineSha256);assert.equal(abi.soname,'libLLVM.so.19.1');assert.equal(abi.runtimeAccepted,false);assert.equal(hashCandidateLibrary('/build','release-core').sha256,'${identity.coreCandidateSha256}');return {schemaVersion:1,purpose:'fresh-native-next-phase-evidence',phase:'${phase}',planSha256:'${planSha256}',sourceCommit:'${identity.sourceCommit}',sourceSha256:'${identity.sourceSha256}',predecessorImageDigest:'${identity.expectedParent.imageDigest}',predecessorReceiptSha256:'${parentHash}',receiptSha256:sha(b),receiptBase64:b.toString('base64'),inputsSha256:'${identity.inputsSha256}',coreReceiptSha256:'${identity.coreExpected.receiptSha256}',coreCandidateSha256:'${identity.coreCandidateSha256}',coreAbiReceiptSha256:'${identity.coreAbiReceiptSha256}',phaseCommandKind:'${identity.phaseCommandKind}',releaseTarget:${JSON.stringify(identity.releaseTarget)},assertionPartition:${JSON.stringify(identity.assertionPartition)},recipeExitCode:0,unitAcceptance:false,packageAcceptance:false,runtimeAcceptance:false,authenticatedAcceptance:false,deploymentAcceptance:false};}`;
  const post = `${evidenceBody};(async()=>{const{hashCandidateLibrary}=await import('/build/scripts/native-llvm-checkpoint.mjs');console.log('NATIVE_FRESH_NEXT_PHASE='+JSON.stringify(await verifyFreshNextEvidence(hashCandidateLibrary)))})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1});`;
  const successorBody = `${evidenceBody};async function verifyFreshNextSuccessor(checkpointStore,hashCandidateLibrary){const p=await verifyFreshNextEvidence(hashCandidateLibrary);checkpointStore().begin('${identity.successorPhase}',p.receiptSha256);console.log('NATIVE_FRESH_NEXT_STATE='+JSON.stringify({phase:'${phase}',planSha256:'${planSha256}',receiptSha256:p.receiptSha256,coreCandidateSha256:p.coreCandidateSha256,coreAbiReceiptSha256:p.coreAbiReceiptSha256,actualStateVerified:true,runtimeAcceptance:false}));return p;}`;
  const successor = `${successorBody};(async()=>{const{checkpointStore,hashCandidateLibrary}=await import('/build/scripts/native-llvm-checkpoint.mjs');await verifyFreshNextSuccessor(checkpointStore,hashCandidateLibrary)})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1});`;
  const compile = `set -eu;test "$PYTHONDONTWRITEBYTECODE" = 1;export PYTHONDONTWRITEBYTECODE;node -e ${quote(pre)};sh /build/scripts/build-llvm-runtime.sh --phase ${phase} --predecessor-sha256 ${parentHash};node -e ${quote(post)}`;
  const collect = String.raw`${common}${parser};const log=bounded('${prefix}compile.log',16777216),lines=log.toString('utf8').split(/\r?\n/).filter(l=>l.startsWith('NATIVE_FRESH_NEXT_PHASE='));assert.equal(lines.length,1);const p=JSON.parse(lines[0].slice('NATIVE_FRESH_NEXT_PHASE='.length));assert.equal(p.phase,'${phase}');assert.equal(p.planSha256,'${planSha256}');const b=bounded('${prefix}phase-receipt.json',32768);assert.equal(p.receiptBase64,b.toString('base64'));assert.equal(p.receiptSha256,sha(b));const r=validateNativeCheckpointReceipt(b,{phase:'${phase}',sha256:p.receiptSha256,predecessorSha256:'${parentHash}',inputsSha256:'${identity.inputsSha256}'});assert.deepEqual(r.proof,{});assert.equal(p.phaseCommandKind,'${identity.phaseCommandKind}');assert.equal(p.releaseTarget,${JSON.stringify(identity.releaseTarget)});assert.equal(p.assertionPartition,${JSON.stringify(identity.assertionPartition)});assert.equal(p.recipeExitCode,0);assert.equal(p.coreReceiptSha256,'${identity.coreExpected.receiptSha256}');assert.equal(p.coreCandidateSha256,'${identity.coreCandidateSha256}');assert.equal(p.coreAbiReceiptSha256,'${identity.coreAbiReceiptSha256}');for(const k of ${JSON.stringify(flags)})assert.equal(p[k],false);fs.writeFileSync('${prefix}phase-proof.json',JSON.stringify({...p,phaseLogSha256:sha(log)})+'\n',{flag:'wx'});`;
  const logTransport = `${common};const{gzipSync}=require('node:zlib');${encodeNativeFreshPhaseLog.toString()};const raw=bounded('${prefix}compile.log',16777216),proof=JSON.parse(bounded('${prefix}phase-proof.json',65536));assert.equal(proof.planSha256,'${planSha256}');assert.equal(proof.phase,'${phase}');assert.equal(proof.phaseLogSha256,sha(raw));for(const line of encodeNativeFreshPhaseLog(raw,{planSha256:'${planSha256}',phase:'${phase}',phaseLogSha256:proof.phaseLogSha256}))console.log(line);`;
  const candidateLabels = {
    ...labels,
    "vaettir.continuation-plan": planSha256,
    "vaettir.continuation-phase": phase,
  };
  const candidateInspect = `${common}const a=JSON.parse(bounded('${prefix}candidate-inspect.json',2097152));assert.equal(a.length,1);const[i]=a,id=bounded('${prefix}commit-id.txt',80).toString().trim();assert.equal(i.Id,id);assert.equal(i.Os,'linux');assert.equal(i.Architecture,'amd64');assert.ok(Number.isSafeInteger(i.Size)&&i.Size>0&&i.Size<64*1024**3);for(const[k,v]of Object.entries(${JSON.stringify(candidateLabels)}))assert.equal(i.Config.Labels[k],v);`;
  const readback = String.raw`${common}${parser};const x=JSON.parse(bounded('${prefix}candidate-manifest.json',2097152));assert.deepEqual(x.failures??[],[]);assert.equal(x.images.length,1);const i=x.images[0],d='sha256:'+sha(i.imageManifest);assert.equal(i.imageId.imageDigest,d);assert.equal(i.imageId.imageTag,'${tag}');assert.notEqual(d,'${identity.expectedParent.imageDigest}');const m=JSON.parse(i.imageManifest),[local]=JSON.parse(bounded('${prefix}candidate-inspect.json',2097152));assert.equal(m.schemaVersion,2);assert.equal(m.mediaType,'application/vnd.docker.distribution.manifest.v2+json');assert.equal(m.config.digest,local.Id);assert.equal(local.Id,bounded('${prefix}commit-id.txt',80).toString().trim());assert.ok(m.layers.length>0&&m.layers.length<=100&&m.layers.every(l=>/^sha256:[a-f0-9]{64}$/.test(l.digest)&&Number.isSafeInteger(l.size)&&l.size>0));assert.ok(m.layers.reduce((n,l)=>n+l.size,0)<16*1024**3);const pushes=bounded('${prefix}push.log',1048576).toString('utf8').split(/\r?\n/).map(l=>/digest: (sha256:[a-f0-9]{64})(?:\s|$)/.exec(l)).filter(Boolean);assert.equal(pushes.length,1);assert.equal(pushes[0][1],d);const states=bounded('${prefix}state.log',131072).toString('utf8').split(/\r?\n/).filter(l=>l.startsWith('NATIVE_FRESH_NEXT_STATE='));assert.equal(states.length,1);const s=JSON.parse(states[0].slice('NATIVE_FRESH_NEXT_STATE='.length)),p=JSON.parse(bounded('${prefix}phase-proof.json',65536)),b=bounded('${prefix}phase-receipt.json',32768);assert.equal(s.phase,'${phase}');assert.equal(p.phase,'${phase}');assert.equal(s.planSha256,'${planSha256}');assert.equal(p.planSha256,'${planSha256}');assert.equal(s.receiptSha256,p.receiptSha256);assert.equal(p.receiptSha256,sha(b));assert.equal(p.receiptBase64,b.toString('base64'));const r=validateNativeCheckpointReceipt(b,{phase:'${phase}',sha256:p.receiptSha256,predecessorSha256:'${parentHash}',inputsSha256:'${identity.inputsSha256}'});assert.deepEqual(r.proof,{});assert.equal(p.phaseLogSha256,sha(bounded('${prefix}compile.log',16777216)));assert.equal(s.coreCandidateSha256,p.coreCandidateSha256);assert.equal(s.coreAbiReceiptSha256,p.coreAbiReceiptSha256);assert.equal(p.coreCandidateSha256,'${identity.coreCandidateSha256}');assert.equal(p.coreAbiReceiptSha256,'${identity.coreAbiReceiptSha256}');assert.equal(s.actualStateVerified,true);assert.equal(s.runtimeAcceptance,false);for(const k of ${JSON.stringify(flags)})assert.equal(p[k],false);console.log('NATIVE_FRESH_NEXT_VERIFIED='+JSON.stringify({...p,imageDigest:d,imageConfigDigest:local.Id,imageSizeBytes:local.Size,actualStateVerified:true,prePushInspection:true,digestPullEvidence:false}));`;
  const commands = [
    "trap 'exit 124' TERM",
    'test "$CODEBUILD_BUILD_SUCCEEDING" = 1',
    `mkdir ${prefix.slice(0, -1)}`,
    `timeout 20s node -e ${quote(start)}`,
    `cleanup_native_validation() { case "$native_validation_container" in '') return 0 ;; *[!0-9a-f]*) return 70 ;; esac; test "\${#native_validation_container}" = 64 || return 70; timeout 20s docker inspect "$native_validation_container" >${prefix}cleanup-inspect.json || return 70; timeout 20s node -e ${quote(cleanup)} || return 70; timeout 20s docker rm -f "$native_validation_container" >/dev/null; }`,
    "timeout 20s docker info >/dev/null",
    `timeout 20s node -e ${quote(disk)}`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageDigest=${identity.expectedParent.imageDigest} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json >${prefix}parent-manifest.json`,
    `timeout 20s node -e ${quote(manifest)}`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageTag=${tag} --region us-east-2 --output json >${prefix}tag-preflight.json`,
    `timeout 20s node -e ${quote(absent)}`,
    "timeout 60s aws ecr get-login-password --region us-east-2 | timeout 60s docker login --username AWS --password-stdin 051722405355.dkr.ecr.us-east-2.amazonaws.com",
    `timeout --signal=TERM --kill-after=20s 300s docker pull ${parent}`,
    `timeout 20s docker image inspect ${parent} >${prefix}parent-inspect.json`,
    `timeout 20s node -e ${quote(inspect)}`,
    `timeout 20s node -e ${quote(setParent)}`,
    "native_create_status=0",
    `timeout 30s docker create --cidfile ${prefix}container-id --label vaettir.next-owner=${planSha256} --env PYTHONDONTWRITEBYTECODE=1 --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 2048 --memory 14g --cpus 8 --entrypoint sh ${parent} -eu -c ${quote(compile)} >${prefix}create-output.txt || native_create_status=$?`,
    `native_validation_container=$(timeout 20s node -e ${quote(readId)})`,
    'test "$native_create_status" = 0',
    'test -n "$native_validation_container"',
    `timeout 20s docker inspect "$native_validation_container" >${prefix}compiler-inspect.json`,
    `timeout 20s node -e ${quote(compilerInspect)}`,
    `timeout 20s node -e ${quote(admit)}`,
    `timeout --signal=TERM --kill-after=20s ${r.compileSeconds}s docker start -a "$native_validation_container" 2>&1 | tee ${prefix}compile.log`,
    'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_validation_container")" = 0',
    `timeout 30s docker cp "$native_validation_container:/build/llvm-phase-receipts/${phase}.json" ${prefix}phase-receipt.json`,
    `timeout 20s node -e ${quote(collect)}`,
    `timeout 20s node -e ${quote(logTransport)}`,
    `timeout 180s docker commit --change ${quote("LABEL vaettir.continuation-plan=" + planSha256)} --change ${quote("LABEL vaettir.continuation-phase=" + phase)} "$native_validation_container" ${candidate} >${prefix}commit-id.txt`,
    "cleanup_native_validation",
    "native_validation_container=''",
    `rm -- ${prefix}container-id ${prefix}cleanup-image-id`,
    `native_candidate_image=$(timeout 20s node -e ${quote(readCommitId)})`,
    `timeout 20s node -e ${quote(setCandidate)}`,
    "native_create_status=0",
    `timeout 30s docker create --cidfile ${prefix}container-id --label vaettir.next-owner=${planSha256} --env PYTHONDONTWRITEBYTECODE=1 --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 2g --cpus 2 --entrypoint node "$native_candidate_image" -e ${quote(successor)} >${prefix}verify-create-output.txt || native_create_status=$?`,
    `native_validation_container=$(timeout 20s node -e ${quote(readId)})`,
    'test "$native_create_status" = 0',
    'test -n "$native_validation_container"',
    `timeout 20s docker inspect "$native_validation_container" >${prefix}verifier-inspect.json`,
    `timeout 20s node -e ${quote(verifierInspect)}`,
    `timeout --signal=TERM --kill-after=20s 240s docker start -a "$native_validation_container" | tee ${prefix}state.log`,
    'test "$(timeout 20s docker inspect --format \'{{.State.ExitCode}}\' "$native_validation_container")" = 0',
    "cleanup_native_validation",
    "native_validation_container=''",
    `timeout 20s docker image inspect ${candidate} >${prefix}candidate-inspect.json`,
    `timeout 20s node -e ${quote(candidateInspect)}`,
    `timeout --signal=TERM --kill-after=20s 180s docker push ${candidate} | tee ${prefix}push.log`,
    `timeout 60s aws ecr batch-get-image --repository-name vaettir-api --image-ids imageTag=${tag} --accepted-media-types application/vnd.docker.distribution.manifest.v2+json --region us-east-2 --output json >${prefix}candidate-manifest.json`,
    `timeout 20s node -e ${quote(readback)}`,
  ];
  const operation = `timeout --signal=TERM --kill-after=75s ${r.operationSeconds}s ${nativeValidationShell(commands)}`;
  assert.doesNotMatch(
    operation,
    /describe-images|put-object|put-role-policy|update-project|--profile|ecs |rds |migrate|:latest|docker build|aws s3api|unzip|--phase final /,
  );
  const transport = pack(operation),
    decoder = `const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{gunzipSync}=require('node:zlib'),{spawnSync}=require('node:child_process');${unpackFreshPrepareOperation.toString()};const operation=unpackFreshPrepareOperation(${JSON.stringify(transport)});const x=spawnSync('/bin/bash',['-eu','-o','pipefail','-c',operation],{stdio:'inherit',timeout:${r.decoderWatchdogSeconds * 1000},killSignal:'SIGTERM'});if(x.error)throw x.error;assert.equal(x.signal,null);assert.equal(x.status,0);`;
  const spec = {
    version: "0.2",
    phases: {
      build: { commands: [`node -e ${quote(decoder)}`] },
      post_build: {
        commands: [
          'test "$CODEBUILD_BUILD_SUCCEEDING" = 1',
          'echo "INCOMPLETE NATIVE BUILDER: complete dual suites/final package/runtime/security/deployment remain unaccepted."',
        ],
      },
    },
  };
  const request = {
    projectName: "vaettir-api-build",
    sourceTypeOverride: "S3",
    sourceLocationOverride: `vaettir-build-source-051722405355/releases/${identity.sourceCommit}/source.zip`,
    buildspecOverride: JSON.stringify(spec),
    timeoutInMinutesOverride: 45,
    computeTypeOverride: "BUILD_GENERAL1_LARGE",
    environmentVariablesOverride: [
      {
        name: "VAETTIR_RELEASE_COMMIT",
        value: identity.sourceCommit,
        type: "PLAINTEXT",
      },
      { name: "PYTHONDONTWRITEBYTECODE", value: "1", type: "PLAINTEXT" },
    ],
    idempotencyToken: "native-fresh-" + phase + "-" + planSha256.slice(0, 32),
    autoRetryLimitOverride: 0,
  };
  assert.ok(Buffer.byteLength(request.buildspecOverride) <= 25600);
  return {
    identity,
    planSha256,
    request,
    requestSha256: sha(JSON.stringify(request)),
    buildspecSha256: sha(request.buildspecOverride),
    importedImage: parent,
    candidateImage: candidate,
    candidateTag: tag,
    operation,
    transport,
    generatedPrograms: {
      disk,
      start,
      admit,
      absent,
      manifest,
      inspect,
      readId,
      readCommitId,
      cleanup,
      setParent,
      setCandidate,
      compilerInspect,
      verifierInspect,
      pre,
      evidenceBody,
      post,
      successorBody,
      successor,
      collect,
      logTransport,
      candidateInspect,
      readback,
      decoder,
    },
    unitAcceptance: false,
    packageAcceptance: false,
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
    deploymentAcceptance: false,
    defaultRuntimeGraphChanged: false,
    forecastAcceptance: false,
    dispatchRequiresRootPreflight: true,
    globalDeadlineMayRefuse: true,
    finalSupported: false,
  };
}

function registryEvidence(completed, expected, plan) {
  const registry = completed.registryManifest;
  assert.deepEqual(registry.failures ?? [], []);
  assert.equal(registry.images.length, 1);
  const image = registry.images[0];
  assert.equal(image.imageId.imageDigest, expected.imageDigest);
  assert.equal(image.imageId.imageTag, plan.candidateTag);
  assert.ok(
    typeof image.imageManifest === "string" &&
      Buffer.byteLength(image.imageManifest) <= 2097152,
  );
  assert.equal("sha256:" + sha(image.imageManifest), expected.imageDigest);
  const m = JSON.parse(image.imageManifest);
  assert.equal(m.schemaVersion, 2);
  assert.equal(
    m.mediaType,
    "application/vnd.docker.distribution.manifest.v2+json",
  );
  assert.equal(m.config.digest, expected.imageConfigDigest);
  assert.ok(
    Array.isArray(m.layers) &&
      m.layers.length > 0 &&
      m.layers.length <= 100 &&
      m.layers.every(
        (l) =>
          digest.test(l.digest) && Number.isSafeInteger(l.size) && l.size > 0,
      ),
  );
  assert.ok(m.layers.reduce((n, l) => n + l.size, 0) < 16 * 1024 ** 3);
  const raw = bytes(completed.registryConfigBase64, 256 * 1024);
  assert.equal("sha256:" + sha(raw), expected.imageConfigDigest);
  let config;
  try {
    config = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
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
      config.rootfs.diff_ids.length === m.layers.length &&
      config.rootfs.diff_ids.every(
        (v) => typeof v === "string" && digest.test(v),
      ),
    "Registry rootfs mismatch",
  );
  for (const [k, v] of Object.entries({
    "vaettir.source-commit": plan.identity.sourceCommit,
    "vaettir.source-sha256": plan.identity.sourceSha256,
    "vaettir.prepare-plan": plan.identity.preparePlanSha256,
    "vaettir.continuation-plan": plan.planSha256,
    "vaettir.continuation-phase": plan.identity.phase,
    "vaettir.runtime-eligible": "false",
    "vaettir.artifact-purpose": "llvm-builder-checkpoint",
  }))
    assert.ok(config?.config?.Labels?.[k] === v, "Registry label mismatch");
}
function validateCompleted(completed, expected, plan) {
  keys(expected, [
    "buildId",
    "planSha256",
    "requestSha256",
    "buildspecSha256",
    "imageDigest",
    "imageConfigDigest",
    "receiptSha256",
    "phaseLogSha256",
  ]);
  assert.match(
    expected.buildId,
    /^vaettir-api-build:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  );
  for (const k of [
    "planSha256",
    "requestSha256",
    "buildspecSha256",
    "receiptSha256",
    "phaseLogSha256",
  ])
    assert.match(expected[k], hex);
  for (const k of ["imageDigest", "imageConfigDigest"])
    assert.match(expected[k], digest);
  for (const k of ["planSha256", "requestSha256", "buildspecSha256"])
    assert.equal(expected[k], plan[k]);
  assert.notEqual(
    expected.imageDigest,
    plan.identity.expectedParent.imageDigest,
  );
  assert.notEqual(
    expected.receiptSha256,
    plan.identity.expectedParent.receiptSha256,
  );
  assert.notEqual(expected.buildId, plan.identity.expectedParent.buildId);
  assert.ok(Buffer.byteLength(JSON.stringify(completed)) <= 1024 * 1024);
  keys(completed, [
    "schemaVersion",
    "purpose",
    "phase",
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
    "phaseLogSha256",
    "proof",
    "receiptChain",
    "registryManifest",
    "registryConfigBase64",
    ...flags,
  ]);
  assert.equal(completed.schemaVersion, 1);
  assert.equal(completed.purpose, "completed-fresh-native-next-phase");
  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(completed.phase, plan.identity.phase);
  for (const [k, v] of Object.entries(expected)) assert.equal(completed[k], v);
  for (const k of ["sourceCommit", "sourceSha256"])
    assert.equal(completed[k], plan.identity[k]);
  for (const k of flags) assert.equal(completed[k], false);
  const p = completed.proof;
  keys(p, [
    "schemaVersion",
    "purpose",
    "phase",
    "planSha256",
    "sourceCommit",
    "sourceSha256",
    "predecessorImageDigest",
    "predecessorReceiptSha256",
    "receiptSha256",
    "receiptBase64",
    "inputsSha256",
    "coreReceiptSha256",
    "coreCandidateSha256",
    "coreAbiReceiptSha256",
    "phaseCommandKind",
    "releaseTarget",
    "assertionPartition",
    "recipeExitCode",
    "phaseLogSha256",
    "imageDigest",
    "imageConfigDigest",
    "imageSizeBytes",
    "actualStateVerified",
    "prePushInspection",
    "digestPullEvidence",
    ...flags,
  ]);
  assert.equal(p.schemaVersion, 1);
  assert.equal(p.purpose, "fresh-native-next-phase-evidence");
  for (const k of [
    "phase",
    "planSha256",
    "sourceCommit",
    "sourceSha256",
    "receiptSha256",
    "imageDigest",
    "imageConfigDigest",
  ])
    assert.equal(p[k], completed[k]);
  assert.equal(
    p.predecessorImageDigest,
    plan.identity.expectedParent.imageDigest,
  );
  assert.equal(
    p.predecessorReceiptSha256,
    plan.identity.expectedParent.receiptSha256,
  );
  assert.equal(p.inputsSha256, plan.identity.inputsSha256);
  assert.equal(p.coreReceiptSha256, plan.identity.coreExpected.receiptSha256);
  for (const k of [
    "coreCandidateSha256",
    "coreAbiReceiptSha256",
    "phaseCommandKind",
    "releaseTarget",
    "assertionPartition",
  ])
    assert.equal(p[k], plan.identity[k]);
  assert.equal(p.recipeExitCode, 0);
  assert.match(p.phaseLogSha256, hex);
  assert.equal(
    p.phaseLogSha256,
    expected.phaseLogSha256,
    "Independently retained observed phase log hash required",
  );
  assert.equal(p.actualStateVerified, true);
  assert.equal(p.prePushInspection, true);
  assert.equal(p.digestPullEvidence, false);
  assert.ok(
    Number.isSafeInteger(p.imageSizeBytes) &&
      p.imageSizeBytes > 0 &&
      p.imageSizeBytes < 64 * 1024 ** 3,
  );
  for (const k of flags) assert.equal(p[k], false);
  const current = bytes(p.receiptBase64, 32768),
    receipt = validateNativeCheckpointReceipt(current, {
      phase: plan.identity.phase,
      sha256: expected.receiptSha256,
      predecessorSha256: plan.identity.expectedParent.receiptSha256,
      inputsSha256: plan.identity.inputsSha256,
    });
  assert.deepEqual(receipt.proof, {});
  const chain = [
    ...plan.identity.receiptChain.map((x) => ({ ...x })),
    {
      phase: plan.identity.phase,
      sha256: expected.receiptSha256,
      base64: p.receiptBase64,
    },
  ];
  assert.deepEqual(completed.receiptChain, chain);
  let previous = null;
  for (const entry of chain) {
    keys(entry, ["phase", "sha256", "base64"]);
    validateNativeCheckpointReceipt(bytes(entry.base64, 32768), {
      phase: entry.phase,
      sha256: entry.sha256,
      predecessorSha256: previous,
      inputsSha256: plan.identity.inputsSha256,
    });
    previous = entry.sha256;
  }
  registryEvidence(completed, expected, plan);
  return {
    receipt,
    chain,
    phase: plan.identity.phase,
    imageDigest: expected.imageDigest,
    imageConfigDigest: expected.imageConfigDigest,
    sourceCommit: plan.identity.sourceCommit,
    inputsSha256: plan.identity.inputsSha256,
    actualStateVerified: true,
    unitAcceptance: false,
    packageAcceptance: false,
    runtimeAcceptance: false,
    finalSupported: false,
  };
}
/** Byte validation is not a live build/log observation. Root must retain actual
 * successful request execution and bind expected fingerprints independently. */
function validateNativeFreshNextPhaseCompleted(
  completed,
  expected,
  plan,
  originalInput,
) {
  assert.ok(Buffer.byteLength(JSON.stringify(plan)) <= 2 * 1024 * 1024);
  assert.deepEqual(plan, planNativeFreshNextPhase(originalInput));
  return validateCompleted(completed, expected, plan);
}

// Keep the original semantic-hashed renderer above byte-identical: accepted
// release-unit ancestry describes that exact native operation. This explicit
// transport revision changes ONLY an oversized API token and its request hash.
// Do not rewrite a predecessor's actual plan/completed/expected evidence.
function boundedPhaseTransport(identity) {
  const plan = assemble(identity);
  const prefix = "native-fresh-" + identity.phase + "-";
  assert.ok(phases.includes(identity.phase));
  assert.match(plan.planSha256, hex);
  assert.equal(
    plan.request.idempotencyToken,
    prefix + plan.planSha256.slice(0, 32),
  );
  if (plan.request.idempotencyToken.length <= 64) return plan;
  const hashCharacters = 64 - prefix.length;
  assert.ok(hashCharacters >= 31 && hashCharacters < 32);
  const request = {
    ...plan.request,
    idempotencyToken: prefix + plan.planSha256.slice(0, hashCharacters),
  };
  assert.equal(request.idempotencyToken.length, 64);
  return { ...plan, request, requestSha256: sha(JSON.stringify(request)) };
}

function planNativeFreshNextPhaseBounded(input) {
  keys(input, ["phase", "core", "completedPhases", "budget"]);
  const index = phases.indexOf(input.phase);
  assert.ok(index >= 0, "Final transport and unknown phases are unsupported");
  assert.ok(
    Array.isArray(input.completedPhases) &&
      input.completedPhases.length === index &&
      index <= 3,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(input)) <= 4 * 1024 * 1024);
  const origin = validatedOrigin(input.core);
  let parent = input.core.expected,
    chain = input.core.completed.receiptChain;
  for (let i = 0; i < index; i++) {
    const record = input.completedPhases[i];
    keys(record, ["completed", "expected", "plan"]);
    assert.equal(record.plan.identity.phase, phases[i]);
    const derived = boundedPhaseTransport(
      phaseIdentity(
        origin,
        parent,
        chain,
        phases[i],
        bareBudget(record.plan.identity.resources),
      ),
    );
    assert.deepEqual(
      record.plan,
      derived,
      "Exact reviewed bounded preceding phase request required",
    );
    const verified = validateCompleted(
      record.completed,
      record.expected,
      derived,
    );
    parent = record.expected;
    chain = verified.chain;
  }
  return boundedPhaseTransport(
    phaseIdentity(origin, parent, chain, input.phase, input.budget),
  );
}

function validateNativeFreshNextPhaseBoundedCompleted(
  completed,
  expected,
  plan,
  originalInput,
) {
  assert.ok(Buffer.byteLength(JSON.stringify(plan)) <= 2 * 1024 * 1024);
  assert.deepEqual(plan, planNativeFreshNextPhaseBounded(originalInput));
  return validateCompleted(completed, expected, plan);
}

export {
  planNativeFreshNextPhaseBounded as planNativeFreshNextPhase,
  validateNativeFreshNextPhaseBoundedCompleted as validateNativeFreshNextPhaseCompleted,
};
