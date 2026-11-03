import {
  requireThat as ok,
  readRef,
  jsonRef,
  verifyRef,
  sha,
  relative,
} from "../production-native-successor-v1/contracts.mjs";
import {
  accepted,
  completeImage,
  transactionAdmission,
} from "./release-admission.derived.mjs";
import {
  normalizeInventory,
  applicationPlan,
  staticProposal,
} from "../final-application-producers-v1/normalize.mjs";
const bytes = (v) => Buffer.from(JSON.stringify(v, null, 2) + "\n");
export const nativeMagic = (b) =>
  b.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) ||
  b.subarray(0, 2).toString() === "MZ" ||
  [
    "feedface",
    "feedfacf",
    "cefaedfe",
    "cffaedfe",
    "cafebabe",
    "bebafeca",
  ].includes(b.subarray(0, 4).toString("hex"));
export function payloadForPlan(plan, output, filesPrefix, read, markerRef) {
  ok(relative(filesPrefix), "Confined extracted output required");
  const outputBy = new Map(output.map((r) => [r.path, r])),
    payload = [];
  let total = 0;
  for (const d of plan.ledger.changes.filter((d) => d.after?.type === "file")) {
    let ref;
    if (d.path === "/app/.vaettir-final-application.json") {
      ref = markerRef;
      ok(
        ref.sha256 === d.after.sha256 && ref.bytes === d.after.bytes,
        "Marker mismatch",
      );
    } else {
      const p = plan.payloadSources.get(d.path),
        original = outputBy.get(p);
      ok(
        original?.type === "file" &&
          original.sha256 === d.after.sha256 &&
          original.bytes === d.after.bytes,
        "Payload is not actual output",
      );
      ref = {
        path: filesPrefix + p,
        bytes: original.bytes,
        sha256: original.sha256,
      };
      total += ref.bytes;
      ok(
        total <= 4 * 1024 ** 3 && ref.bytes <= 512 * 1024 ** 2,
        "Payload bound",
      );
      const content = readRef(ref, read, 512 * 1024 ** 2);
      ok(
        !nativeMagic(content),
        "New/changed native executable requires a separately reviewed native build, not application admission",
      );
    }
    payload.push({ path: d.path, ref });
  }
  return payload;
}
export function produceOutput(b, source, role, io, prefix) {
  ok(relative(prefix), "Confined new output prefix required");
  const input = b.producerInputs.application[role],
    compiled = input.compiled;
  const stage = transactionAdmission(b.transactions[role], role, io);
  const image = completeImage(compiled.imageAcceptance, role, io.read);
  const review = accepted(
    compiled.buildReview,
    io.read,
    "COMPILED_FINAL_APPLICATION",
  );
  ok(
    review.source === source.source &&
      review.tree === source.tree &&
      review.imageDigest === "sha256:" + image.manifest.sha256 &&
      review.inventorySha256 === image.inventory.sha256 &&
      review.sourceArchiveSha256 === compiled.sourceArchive.sha256 &&
      review.buildLogSha256 === compiled.buildLog.sha256 &&
      review.buildContextManifestSha256 ===
        compiled.buildContextManifest.sha256,
    "Actual final-source compiled output custody required",
  );
  for (const ref of [
    compiled.sourceArchive,
    compiled.buildLog,
    compiled.buildContextManifest,
  ])
    verifyRef(ref, io.read);
  ok(relative(compiled.filesPrefix), "Confined extracted output required");
  const before = normalizeInventory(
    jsonRef(stage.inventory, io.read, 256 * 1024 ** 2),
  );
  const output = normalizeInventory(
    jsonRef(image.inventory, io.read, 256 * 1024 ** 2),
  );
  const native = jsonRef(input.nativeInventory, io.read),
    nativeReview = accepted(
      input.nativeReview,
      io.read,
      "COMPLETE_STAGE_NATIVE_INVENTORY",
    );
  ok(
    nativeReview.imageDigest === "sha256:" + stage.manifest.sha256 &&
      nativeReview.inventorySha256 === input.nativeInventory.sha256 &&
      nativeReview.stageInventorySha256 === stage.inventory.sha256,
    "Actual complete native inventory required",
  );
  const nativePaths = native.map((r) => "/" + r.path.replace(/^\//, ""));
  const plan = applicationPlan({
    role,
    source: source.source,
    tree: source.tree,
    before,
    output,
    ownership: input.ownership,
    nativePaths,
    probeSha256: io.nativePolicy.sqliteAccepted.probeSha256,
  });
  const files = {},
    refs = {};
  function add(name, value, raw = false) {
    const content = raw ? value : bytes(value);
    files[name] = content;
    return (refs[name] = {
      path: prefix + "/" + name,
      bytes: content.length,
      sha256: sha(content),
    });
  }
  const markerRef = add("application-marker.json", plan.marker, true);
  const outputBy = new Map(output.map((r) => [r.path, r]));
  const payload = payloadForPlan(
    plan,
    output,
    compiled.filesPrefix,
    io.read,
    markerRef,
  );
  add("before.json", plan.before);
  add("after.json", plan.after);
  add("ledger.proposed.json", plan.ledger);
  add("payload-manifest.json", { files: payload });
  const proofTree = [
    b.transactions[role].imageAcceptance,
    stage.inventory,
    compiled.imageAcceptance,
    image.inventory,
    compiled.buildReview,
    compiled.buildLog,
    compiled.sourceArchive,
    compiled.buildContextManifest,
    input.nativeInventory,
    input.nativeReview,
  ];
  if (role === "web") {
    const currentPath = "/application/apps/web/.next/static-cohorts.json",
      row = outputBy.get(currentPath);
    ok(row?.type === "file", "Missing actual static manifest");
    const currentRef = {
      path: compiled.filesPrefix + currentPath,
      sha256: row.sha256,
      bytes: row.bytes,
    };
    const parent = jsonRef(
      b.nativeBindings.baseline.web.inventory,
      io.read,
      256 * 1024 ** 2,
    );
    const p = parent.find(
      (r) => r.path === "app/apps/web/.next/static-cohorts.json",
    );
    ok(
      p?.type === "0" &&
        p.sha256 === input.parentStaticManifest.sha256 &&
        p.size === input.parentStaticManifest.bytes,
      "Parent cohort manifest unbound to baseline image",
    );
    const result = staticProposal(
      jsonRef(currentRef, io.read),
      jsonRef(input.parentStaticManifest, io.read),
      source.source,
      plan.after,
    );
    const parentRef = add("parent-static-normalized.json", result.parent);
    add("static-retention.proposed.json", {
      ...result.proposal,
      parentCohorts: parentRef,
      originalParentManifest: input.parentStaticManifest,
      originalCurrentManifest: currentRef,
      proofTree: [
        ...proofTree,
        currentRef,
        input.parentStaticManifest,
        parentRef,
      ],
    });
  }
  add("application-acceptance.proposed.json", {
    scope: "FINAL_APPLICATION_BUILD_OUTPUT",
    accepted: false,
    independentReview: false,
    source: source.source,
    tree: source.tree,
    ledgerSha256: refs["ledger.proposed.json"].sha256,
    beforeSha256: refs["before.json"].sha256,
    afterSha256: refs["after.json"].sha256,
    parentDigest: "sha256:" + stage.manifest.sha256,
    stageInventorySha256: stage.inventory.sha256,
    sourceArchiveSha256: compiled.sourceArchive.sha256,
    buildLogSha256: compiled.buildLog.sha256,
    nativeInventorySha256: input.nativeInventory.sha256,
    payloadManifestSha256: refs["payload-manifest.json"].sha256,
    normalizerSource: input.normalizerSource,
    proofTree,
    requiresIndependentLedgerAndAcceptanceRebinding: true,
    extendedMetadataAcceptance: false,
    releaseAccepted: false,
  });
  // The source reference must be an actual admitted producer file, not an arbitrary label.
  const normalizer = readRef(input.normalizerSource, io.read);
  ok(
    sha(normalizer) === io.normalizerSha256,
    "Normalizer source bytes changed",
  );
  add("output-manifest.json", {
    source,
    role,
    files: Object.values(refs),
    stageInventorySha256: stage.inventory.sha256,
    compiledInventorySha256: image.inventory.sha256,
    completeOciAcceptance: false,
    releaseAccepted: false,
  });
  return files;
}
