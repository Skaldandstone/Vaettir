// Source/context preparation only. Never imports or executes an operator.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { here, checkFrozen } from "./admission.mjs";
import { accepted } from "../final-application-release-v1/admission.mjs";
import {
  requireThat as ok,
  jsonRef,
  readRef,
  verifyRef,
  same,
  sha,
} from "../production-native-successor-v1/contracts.mjs";
const inherited = resolve(
  here,
  "../final-application-release-v1/inherited/materialization-successor-v1",
);
const bytes = (p) => readFileSync(p);
const enc = (v) => Buffer.from(JSON.stringify(v, null, 2) + "\n");
function once(s, old, value) {
  ok(s.split(old).length === 2, "Stage derivation anchor changed");
  return s.replace(old, value);
}
export function deriveStageOperators() {
  checkFrozen();
  const original = bytes(join(inherited, "archive_contract.py"))
    .toString()
    .replaceAll("\r\n", "\n");
  const hashFunctions = original.slice(
    original.indexOf("def digest("),
    original.indexOf("def source_gate():"),
  );
  let body = original.slice(
    original.indexOf("    raw=(A/'original-manifest.json')"),
    original.indexOf("\ndef verify_cached_layers"),
  );
  body = once(
    body,
    "    assert raw==(O/(KIND+'-original-manifest.json')).read_bytes()\n",
    "",
  );
  const labelLine =
    "    if KIND=='api':\n        labels=config['config']['Labels'];assert labels['vaettir.application-source-commit']==SOURCE and labels['vaettir.application-source-sha256']==prepared_gate()['sourceArchiveSha256']\n";
  body = once(
    body,
    labelLine,
    "    # Parent application remains unchanged; independent stage build custody binds validation source.\n",
  );
  let contract = bytes(join(here, "stage-contract.py.txt")).toString();
  contract = once(contract, "# RETAINED_HASH_FUNCTIONS", hashFunctions);
  contract = once(contract, "    # RETAINED_MODEL_BODY", body.trimEnd());
  contract = once(
    contract,
    "# RETAINED_CACHE_AND_PATH_FUNCTIONS",
    original.slice(original.indexOf("def verify_cached_layers")),
  );
  let driver = bytes(join(inherited, "materialize-local.py"))
    .toString()
    .replaceAll("\r\n", "\n");
  driver = driver.replaceAll(
    "paired-materialization-source-acceptance.json",
    "paired-stage-materialization-source-acceptance.json",
  );
  driver = once(
    driver,
    "files += [Path(row['path']) for row in read(HERE/'pinned-inputs.json')['files']]",
    "files += [confined(SETTINGS['evidenceRoot'],row['path']) for row in SETTINGS['inputProofs']]",
  );
  const oldProofLine = driver
    .split("\n")
    .find((s) => s.startsWith("files += [O/'prepared.json'"));
  ok(oldProofLine, "Stage proof replacement anchor missing");
  driver = once(
    driver,
    oldProofLine,
    "files += [HERE/'stage-config.json',HERE/'original-manifest.json',HERE/'original-config.json',HERE/'complete-layers.json',HERE/'parent-manifest.json',HERE/'parent-config.json']",
  );
  driver = once(
    driver,
    "(O/('candidate-'+KIND+'-image-available.json')).open('xb').write(dump(available))",
    "available.update({'artifactPurpose':'sqlite-transaction-stage','runtimeEligible':False,'runtimeAccepted':False,'releaseAccepted':False,'extendedMetadataAccepted':False})\n(O/('stage-'+KIND+'-image-available.json')).open('xb').write(dump(available))",
  );
  contract = once(
    contract,
    "from stage_support import source_gate as reviewed_source_gate, validate_stage",
    "from stage_support import source_gate as reviewed_source_gate, validate_stage, confined",
  );
  const files = {
    "archive_contract.py": Buffer.from(contract),
    "prepare-archive.py": bytes(join(inherited, "prepare-archive.py")),
    "verify-archive.py": bytes(join(inherited, "verify-archive.py")),
    "materialize-local.py": Buffer.from(driver),
    "stage_support.py": bytes(join(here, "stage_support.py")),
    "stage_metadata.py": bytes(join(here, "stage_metadata.py")),
  };
  return files;
}
export function prepareStage(b, source, role, io) {
  const input = b.producerInputs?.stageBootstrap?.[role];
  ok(input && io.evidenceRoot, "Stage bootstrap inputs/evidence root required");
  const nativePolicy = JSON.parse(
      bytes(resolve(here, "../production-native-successor-v1/policy.json")),
    ),
    baseline = b.nativeBindings.baseline[role],
    pin = nativePolicy.roles[role];
  ok(
    input.parentManifest.sha256 === pin.digest.slice(7) &&
      baseline.config.sha256 === pin.configSha256,
    "Wrong immutable parent",
  );
  const manifestRaw = readRef(input.manifest, io.read),
    configRaw = readRef(input.config, io.read),
    parentRaw = readRef(input.parentManifest, io.read),
    parentConfigRaw = readRef(baseline.config, io.read),
    layerRaw = readRef(input.layers, io.read),
    m = JSON.parse(manifestRaw),
    layers = JSON.parse(layerRaw),
    parent = JSON.parse(parentRaw),
    pc = JSON.parse(parentConfigRaw),
    config = JSON.parse(configRaw);
  const count = role === "api" ? 98 : 56;
  ok(
    parent.layers.length === count &&
      m.layers.length > count &&
      m.layers.length <= 124 &&
      layers.length === m.layers.length,
    "Wrong stage layer count",
  );
  ok(
    same(m.layers.slice(0, count), parent.layers) &&
      same(config.rootfs.diff_ids.slice(0, count), pc.rootfs.diff_ids),
    "Parent layer/DiffID prefix changed",
  );
  const binding = {
    source: source.source,
    tree: source.tree,
    role,
    target: "sqlite_observation",
    artifactPurpose: "sqlite-transaction-stage",
    runtimeEligible: false,
    manifestDigest: "sha256:" + input.manifest.sha256,
    configDigest: "sha256:" + input.config.sha256,
    layersSha256: input.layers.sha256,
    layerCount: layers.length,
    parentDigest: pin.digest,
    parentConfigDigest: "sha256:" + baseline.config.sha256,
    buildRequest: input.buildRequest,
    buildLog: input.buildLog,
    buildContext: input.buildContext,
    buildResult: input.buildResult,
    observation: input.observation,
  };
  const review = accepted(
    input.metadataIntent,
    io.read,
    "TRANSACTION_STAGE_BYTE_VERIFICATION_INTENT",
  );
  ok(
    same(review.binding, binding),
    "Stage intent must bind actual target, build and exact ordered content",
  );
  for (const key of [
    "buildRequest",
    "buildLog",
    "buildContext",
    "buildResult",
    "observation",
  ])
    verifyRef(input[key], io.read);
  const proofs = new Map();
  function collect(v) {
    if (!v || typeof v !== "object") return;
    if (
      typeof v.path === "string" &&
      typeof v.sha256 === "string" &&
      Number.isSafeInteger(v.bytes)
    ) {
      verifyRef(v, io.read);
      const pin = { path: v.path, sha256: v.sha256, bytes: v.bytes };
      const old = proofs.get(v.path);
      ok(!old || same(old, pin), "Conflicting stage proof pin");
      proofs.set(v.path, pin);
    } else for (const value of Object.values(v)) collect(value);
  }
  collect(b.nativeBindings);
  collect(b.producers);
  collect(b.operatorManifest);
  collect(b.operatorApproval);
  collect(b.repairAcceptance);
  collect(input);
  collect(review.proofTree);
  collect(jsonRef(review.proofTree, io.read));
  // Approval proof trees are also rehashed when the generated contract is used.
  for (const r of [
    b.producers.approval,
    b.operatorApproval,
    b.repairAcceptance,
  ])
    if (r) {
      const approval = jsonRef(r, io.read);
      collect(approval);
      collect(jsonRef(approval.proofTree, io.read));
    }
  const files = deriveStageOperators();
  Object.assign(files, {
    "original-manifest.json": manifestRaw,
    "original-config.json": configRaw,
    "parent-manifest.json": parentRaw,
    "parent-config.json": parentConfigRaw,
    "complete-layers.json": layerRaw,
  });
  const c = {
    purpose: "transaction-stage-custody/v1",
    role,
    source: source.source,
    tree: source.tree,
    evidenceRoot: resolve(io.evidenceRoot),
    manifestDigest: binding.manifestDigest,
    configDigest: binding.configDigest,
    parentDigest: pin.digest,
    parentConfigDigest: binding.parentConfigDigest,
    parentLayerCount: count,
    layerCount: layers.length,
    compressedBytes: layers.reduce((n, r) => n + r.bytes, 0),
    expandedBytes: layers.reduce((n, r) => n + r.expanded, 0),
    metadataIntent: input.metadataIntent,
    intentBinding: binding,
    inputProofs: [...proofs.values()],
    operatorFiles: Object.keys(files),
  };
  files["stage-config.json"] = enc(c);
  files["source-manifest.json"] = enc({
    purpose: c.purpose,
    source: c.source,
    files: Object.entries(files).map(([name, v]) => ({
      name,
      sha256: sha(v),
      bytes: v.length,
    })),
  });
  files["stage-review-required.json"] = enc({
    scope: "TRANSACTION_STAGE_MATERIALIZATION_SOURCE",
    accepted: false,
    independentReview: false,
    source: c.source,
    role,
    stageDigest: c.manifestDigest,
    sourceManifestSha256: sha(files["source-manifest.json"]),
    proofTree: null,
    completeOciAcceptance: false,
    extendedMetadataAccepted: false,
    runtimeAccepted: false,
    releaseAccepted: false,
  });
  return files;
}
