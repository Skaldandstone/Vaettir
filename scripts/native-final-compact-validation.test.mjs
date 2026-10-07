// Pure synthetic metadata/source consistency only. No compiler, Docker,
// cloud, credentials, provider or native release acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  validateFreshNativeFinalCompleted,
  validateFreshNativeCompactFinalCompleted,
  NATIVE_COMPACT_ARTIFACT_PATHS,
} from "./native-packaging-v2-final-runtime-recipe-validation.mjs";
import {
  compactCompletedFixture,fullCompletedFixture,
} from "./native-final-compact-fixture.mjs";
import {runtimeCompletedFixture as originalCompletedFixture}
  from "./native-final-runtime-recipe-fixture.mjs";
import {encodeNativeFreshFinalLog}
  from "./native-packaging-v2-builder-fresh-final-plan.mjs";

const sha = raw => createHash("sha256").update(raw).digest("hex");
const flags = ["unitAcceptance","packageAcceptance","runtimeAcceptance",
  "authenticatedAcceptance","deploymentAcceptance"];
let pristine;
function clone(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,clone(item)]));
  return value;
}
function fixture() { return clone(pristine ?? (pristine = compactCompletedFixture())); }
const validate = f => validateFreshNativeCompactFinalCompleted(
  f.completed,f.expected,f.plan,f.input,f.transport,
);
function rebindRegistry(f, change = () => {}) {
  const config = JSON.parse(Buffer.from(f.completed.registryConfigBase64,"base64"));
  config.config.Labels["vaettir.artifact-inventory-sha256"] =
    f.completed.compactArtifacts.inventorySha256;
  config.config.Labels["vaettir.final-receipt-sha256"] = f.expected.receiptSha256;
  change(config);
  const raw = Buffer.from(JSON.stringify(config));
  const configDigest = "sha256:" + sha(raw);
  f.completed.registryConfigBase64 = raw.toString("base64");
  f.expected.imageConfigDigest = f.completed.imageConfigDigest =
    f.completed.verified.imageConfigDigest = configDigest;
  f.completed.verified.registryRawConfigSha256 = sha(raw);
  const record = f.completed.registryManifest.images[0];
  const manifest = JSON.parse(record.imageManifest);
  manifest.config.digest = configDigest; manifest.config.size = raw.length;
  record.imageManifest = JSON.stringify(manifest);
  const digest = "sha256:" + sha(record.imageManifest);
  record.imageId.imageDigest = digest;
  f.expected.imageDigest = f.completed.imageDigest = f.completed.verified.imageDigest = digest;
}
function rebindArtifacts(f) {
  f.completed.compactArtifacts.inventorySha256 =
    sha(JSON.stringify(f.completed.compactArtifacts.inventory));
  f.completed.verified.compactArtifacts = clone(f.completed.compactArtifacts);
  rebindRegistry(f);
}
function rebindManifest(f, change) {
  const record = f.completed.registryManifest.images[0];
  const manifest = JSON.parse(record.imageManifest); change(manifest);
  record.imageManifest = JSON.stringify(manifest);
  const digest = "sha256:" + sha(record.imageManifest);
  record.imageId.imageDigest = digest;
  f.expected.imageDigest = f.completed.imageDigest = f.completed.verified.imageDigest = digest;
}
function rebindFinalReceipt(f, change) {
  const value = JSON.parse(Buffer.from(f.completed.receiptChain[6].base64,"base64"));
  change(value);
  const raw = Buffer.from(JSON.stringify(value) + "\n"),hash = sha(raw);
  f.expected.receiptSha256 = f.completed.receiptSha256 = hash;
  f.completed.receiptChain[6] = {phase:"final",sha256:hash,base64:raw.toString("base64")};
  for (const stage of [f.completed.verified.pre,f.completed.verified.image]) {
    stage.finalReceiptBase64 = raw.toString("base64");
    stage.review.finalReceiptSha256 = hash;
    stage.review.receiptChain[6] = {phase:"final",sha256:hash};
  }
  Object.assign(f.completed.compactArtifacts.inventory[14],{sha256:hash,bytes:raw.length});
  rebindArtifacts(f);
}

test("distinct compact evidence preserves real V2 ancestry and exact full reviews/15 artifacts without caller mutation", () => {
  const f = fixture(),before = clone(f),result = validate(f);
  assert.equal(result.transportKind,"compact-fixed15-v1");
  assert.equal(f.input.core.plan.identity.purpose,"native-packaging-v2-fresh-core-not-runtime");
  assert.equal(result.artifacts.length,15);
  assert.deepEqual(result.artifacts.map(item=>item.path),NATIVE_COMPACT_ARTIFACT_PATHS);
  assert.deepEqual(result.artifacts,f.artifacts);
  assert.equal(result.artifactInventorySha256,sha(JSON.stringify(f.artifacts)));
  assert.equal(result.fullLocalImageConfigDigest,f.expected.fullLocalImageConfigDigest);
  assert.notEqual(result.fullLocalImageConfigDigest,result.imageConfigDigest);
  assert.equal(result.actualCloudEvidenceStillRequired,true);
  for (const flag of flags) assert.equal(result[flag],false);
  assert.deepEqual(f,before);
  assert.doesNotThrow(() => validate(fixture()),"Cloning preserves actual Buffer inputs");
});

test("legacy full V2 remains strict and refuses compact schema, while compact rejects old V1/full V2 metadata", () => {
  const full = fullCompletedFixture();
  assert.equal(validateFreshNativeFinalCompleted(full.completed,full.expected,
    full.plan,full.input,full.transport).phase,"final");
  const f = fixture();
  assert.throws(() => validateFreshNativeFinalCompleted(
    f.completed,f.expected,f.plan,f.input,f.transport));
  for (const value of [full,originalCompletedFixture()])
    assert.throws(() => validateFreshNativeCompactFinalCompleted(
      value.completed,value.expected,value.plan,value.input,value.transport));
});

const metadataChanges = [
  ["failed cd2-shaped build",f=>{f.completed.status="FAILED";delete f.completed.registryManifest;}],
  ["partial-upload metadata is not a completion",f=>{f.completed.uploadPartBytes=4596629504;}],
  ["schema",f=>f.completed.schemaVersion=1],
  ["purpose",f=>f.completed.purpose="completed-fresh-native-final"],
  ["kind",f=>f.completed.transportKind="arbitrary-compact"],
  ["expected kind",f=>f.expected.transportKind="arbitrary-compact"],
  ["extra authority",f=>f.completed.rootApproved=true],
  ["missing pre",f=>delete f.completed.verified.pre],
  ["missing image",f=>delete f.completed.verified.image],
  ["missing compact verification",f=>f.completed.verified.committedCompactFilesVerified=false],
  ["missing full verification",f=>f.completed.verified.actualPrecommitAndCommittedImageVerified=false],
  ["unproved digest pull",f=>f.completed.verified.digestPullEvidence=true],
  ["builder/donor config mixup",f=>{f.expected.fullLocalImageConfigDigest=f.expected.imageConfigDigest;f.completed.fullLocalImageConfigDigest=f.expected.imageConfigDigest;f.completed.verified.fullLocalImageConfigDigest=f.expected.imageConfigDigest;}],
  ["foreign local builder",f=>f.completed.verified.fullLocalImageConfigDigest="sha256:"+"e".repeat(64)],
  ["capsule",f=>f.completed.capsuleSha256="e".repeat(64)],
  ["source",f=>f.completed.sourceCommit="e".repeat(40)],
  ["archive",f=>f.completed.sourceSha256="e".repeat(64)],
  ["request",f=>f.completed.requestSha256="e".repeat(64)],
  ["buildspec",f=>f.completed.buildspecSha256="e".repeat(64)],
  ["missing cleanup",f=>delete f.transport.cleanupMarker],
  ["foreign cleanup",f=>f.transport.cleanupMarker="NATIVE_FRESH_COMPACT_FINAL_CLEANED="+"e".repeat(64)],
  ["legacy cleanup",f=>f.transport.cleanupMarker="NATIVE_FRESH_FINAL_CLEANED="+f.plan.planSha256],
  ["extra transport",f=>f.transport.rootApproved=true],
  ["failed original parent",f=>f.input.completedPhases[3].completed.status="FAILED"],
  ["changed plan",f=>f.plan.identity.resources.memoryBytes=16*1024**3],
];
for (const [label,change] of metadataChanges)
  test("compact refuses " + label, () => {const f=fixture();change(f);assert.throws(()=>validate(f));});

for (const flag of flags)
  test("compact outer authority flag remains false: " + flag, () => {
    for (const target of ["completed","verified"]) {
      const f=fixture();(target==="completed"?f.completed:f.completed.verified)[flag]=true;
      assert.throws(()=>validate(f));
    }
  });

test("original full native counts, JIT, ARM, inventories and exact stage provenance cannot be replaced by compact claims", () => {
  const changes = [
    stage=>stage.review.armVectors=32,
    stage=>stage.review.fixedCandidateJitResult=10,
    stage=>stage.review.completeInputsAndObjectsRecomputed=false,
    stage=>stage.review.operationsRequireVerifiedTransport=false,
    stage=>stage.review.units[0].passed--,
    stage=>stage.review.state.assertions.bytes++,
    stage=>stage.review.inputsSha256="e".repeat(64),
    stage=>stage.provenance.memoryLimitBytes=16*1024**3,
    stage=>stage.provenance.exclusiveWriterRequired=false,
    stage=>stage.provenance.outerWatchdogRequired=false,
    stage=>stage.provenance.verificationId="e".repeat(64),
    stage=>stage.provenance.zstandardSupported=true,
  ];
  for (const name of ["pre","image"]) for (const change of changes) {
    const f=fixture();change(f.completed.verified[name]);assert.throws(()=>validate(f));
  }
  for (const key of ["unitAcceptance","packageAcceptance"]) {
    const f=fixture();rebindFinalReceipt(f,value=>value[key]=false);assert.throws(()=>validate(f));
  }
  for (const key of ["runtimeAcceptance","authenticatedAcceptance","deploymentAcceptance"]) {
    const f=fixture();rebindFinalReceipt(f,value=>value[key]=true);assert.throws(()=>validate(f));
  }
});

test("seven exact receipt bytes and whole phase log transport remain required", () => {
  const changes = [
    f=>f.completed.receiptChain.pop(),
    f=>f.completed.receiptChain.reverse(),
    f=>f.completed.receiptChain[0].base64="eA==",
    f=>f.completed.receiptChain[6].phase="assertion-compile-3",
    f=>f.completed.verified.image.finalReceiptBase64="eA==",
    f=>f.transport.phaseLogBytes=Buffer.from("missing native unit stream"),
    f=>f.transport.phaseLogChunks.pop(),
    f=>f.transport.phaseLogChunks.push(f.transport.phaseLogChunks[0]),
  ];
  for (const change of changes) {const f=fixture();change(f);assert.throws(()=>validate(f));}
  const f=fixture(),raw=Buffer.from("SYNTHETIC no complete unit outputs\n");
  f.expected.phaseLogSha256=f.completed.phaseLogSha256=sha(raw);
  for(const stage of [f.completed.verified.pre,f.completed.verified.image]) {
    stage.review.finalLogSha256=sha(raw);stage.provenance.finalLogSha256=sha(raw);
  }
  f.transport.phaseLogBytes=raw;
  f.transport.phaseLogChunks=encodeNativeFreshFinalLog(raw,{phase:"final",
    planSha256:f.plan.planSha256,phaseLogSha256:sha(raw)});
  assert.throws(()=>validate(f),"Even rebound opaque transport must contain both actual-unit stream shapes");
});

test("fixed15 inventory refuses extra/missing/reordered/duplicate paths and forged file shape even after hash rebinding", () => {
  const changes = [
    items=>items.push({...items[0],path:"/build/unreviewed-file"}),
    items=>items.pop(),
    items=>items.reverse(),
    items=>items[1].path=items[0].path,
    items=>items[0].path="/build/../private-file",
    items=>items[0].sha256="e".repeat(64),
    items=>items[0].bytes=512*1024**2+1,
    items=>items[1].bytes=128*1024**2+1,
    items=>items[3].bytes=32769,
    items=>items[8].bytes++,
    items=>items[0].bytes=0,
    items=>items[0].bytes=0.5,
    items=>items[1].mode=420,
    items=>items[8].mode=420,
    items=>items[3].mode=511,
    items=>items[0].symlink=true,
  ];
  for (const change of changes) {const f=fixture();change(f.completed.compactArtifacts.inventory);
    rebindArtifacts(f);assert.throws(()=>validate(f));}
  const f=fixture();f.completed.verified.compactArtifacts.inventory[0].mode=384;
  assert.throws(()=>validate(f),"Export and independent committed-image inventories must agree");
});

test("compact registry requires exact one-layer digest/config, scratch policy and distinct donor labels", () => {
  const configChanges = [
    c=>c.os="windows",c=>c.architecture="arm64",
    c=>c.rootfs.diff_ids.push("sha256:"+"e".repeat(64)),
    c=>c.rootfs.type="foreign",
    c=>c.config.Labels["vaettir.artifact-purpose"]="llvm-builder-checkpoint",
    c=>c.config.Labels["vaettir.continuation-phase"]="final",
    c=>c.config.Labels["vaettir.transport-kind"]="arbitrary",
    c=>c.config.Labels["vaettir.full-local-image-config"]="sha256:"+"e".repeat(64),
    c=>c.config.Labels["vaettir.artifact-inventory-sha256"]="e".repeat(64),
    c=>c.config.Labels["vaettir.final-receipt-sha256"]="e".repeat(64),
    c=>c.config.Labels["vaettir.runtime-eligible"]="true",
    c=>c.config.Labels.extra="unreviewed",
    c=>c.config.Env=["SECRET=synthetic"],
    c=>c.config.Cmd=["sh"],c=>c.config.Entrypoint=["sh"],
    c=>c.config.OnBuild=["RUN false"],c=>c.config.Shell=["sh","-c"],
    c=>c.config.Healthcheck={Test:["CMD","sh"]},c=>c.config.StopSignal="SIGKILL",
    c=>c.config.Volumes={"/private":{}},c=>c.config.ExposedPorts={"80/tcp":{}},
    c=>c.config.User="root",c=>c.config.WorkingDir="/build",
  ];
  for (const change of configChanges) {const f=fixture();rebindRegistry(f,change);assert.throws(()=>validate(f));}
  const manifestChanges = [
    m=>m.schemaVersion=1,m=>m.mediaType="foreign",
    m=>m.config.size++,m=>m.config.digest="sha256:"+"e".repeat(64),
    m=>m.layers.push({...m.layers[0]}),m=>m.layers[0].size=0,
    m=>m.layers[0].size=3*1024**3+1,m=>m.layers[0].digest="not-a-digest",
    m=>m.layers[0].mediaType="foreign",m=>m.extra="unknown",
  ];
  for (const change of manifestChanges) {const f=fixture();rebindManifest(f,change);assert.throws(()=>validate(f));}
  const f=fixture();f.completed.registryManifest.images[0].imageId.imageTag="final-unreviewed";
  assert.throws(()=>validate(f));
});

test("new V2 fixture mechanical adaptation preserves the entire original recipe/lineage construction body", () => {
  const original=readFileSync(new URL("./native-final-runtime-recipe-fixture.mjs",import.meta.url),"utf8").replaceAll("\r\n","\n");
  assert.equal(sha(original),"d21a00d62295a71566e96963d36f0659bc0e1c9453c1236a99af5f0062659eac");
  const current=readFileSync(new URL("./native-final-compact-fixture.mjs",import.meta.url),"utf8").replaceAll("\r\n","\n");
  let base=current.slice(0,current.indexOf("\n// Reuses genuine current V2"));
  assert.ok(base.length>0);
  for(const name of ["native-builder-fresh-final-plan.mjs","native-builder-fresh-prepare.mjs",
    "native-builder-fresh-core.mjs","native-builder-fresh-next-phase.mjs"])
    base=base.replace("native-packaging-v2-"+name.slice("native-".length),name);
  base=base.replace("  planNativeFreshCompactFinal,\n","");
  base=base.replace("// SYNTHETIC current-V2 lineage and compact metadata ONLY. No native/cloud proof.\n// Mechanical fixture adaptation selects corrected recipe BEFORE ZIP creation.\n// Reads public source only when explicitly called, never at module import.",
    "// Synthetic original-origin/flat-lineage fixtures only, never actual LLVM/CI proof.");
  base=base.replace('import { createHash } from "node:crypto";\n',
    'import { createHash } from "node:crypto";\nimport { historicalNativeV1RecipeFixture } from "./native-v1-recipe-test-fixture.mjs";\n');
  base=base.replace("// Current corrected V2 SYNTHETIC bytes, never a canonical Git export.",
    "// Historical v1 SYNTHETIC bytes, never a current canonical Git export.");
  base=base.replace('name === "build-llvm-runtime.sh"\n      ? raw\n',
    'name === "build-llvm-runtime.sh"\n      ? historicalNativeV1RecipeFixture(raw).bytes\n');
  assert.equal(base,original);
});

test("legacy validator function remains byte-identical to its original V1 function", () => {
  const v1=readFileSync(new URL("./native-final-runtime-recipe-validation.mjs",import.meta.url),"utf8").replaceAll("\r\n","\n");
  const v2=readFileSync(new URL("./native-packaging-v2-final-runtime-recipe-validation.mjs",import.meta.url),"utf8").replaceAll("\r\n","\n");
  const marker="export function validateFreshNativeFinalCompleted(";
  const expected=v1.slice(v1.indexOf(marker));
  const actual=v2.slice(v2.indexOf(marker),v2.indexOf("\n// Distinct transport only:"));
  assert.equal(Buffer.byteLength(expected),8216);
  assert.equal(sha(expected),"bb1847d1f5420964737fa8d01048da4a58779e3ba6e0204f7b3c388d8f2a5e1b");
  assert.equal(actual,expected+"\n","Only the explicit export-separating newline may follow the original function bytes");
});
