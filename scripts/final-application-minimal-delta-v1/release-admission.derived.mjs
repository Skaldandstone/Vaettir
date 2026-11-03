import {admitMinimalDeltaSource} from "./admission.mjs";
import {readPackageEvidence} from "../final-application-package-dependency-v1/package-transition.mjs";
import {admitDependencySource} from "../final-application-package-dependency-v1/admission.mjs";
import {admitWebLeafSource} from "../final-application-web-leaf-v1/admission.mjs";
import {admitProducerSource} from "../final-application-producers-v1/admission.mjs";
// Offline composition gates. Successful admission never means release acceptance.
import {
  jsonRef,
  completeInventoryRef,
  verifyRef,
  verifyTree,
  requireThat as ok,
  same,
  hex,
  relative,
  sha,
  admitPreparation,
} from "../production-native-successor-v1/contracts.mjs";
import {
  finalNativeEvidence,
  verifyOciByteLinks,
  remainingGates,
} from "../final-application-package-dependency-v1/native-release-gates.derived.mjs";
import {
  exactDelta,
  verifyOverlay,
  verifyConsumers,
  verifyPackageState,
} from "../final-application-package-dependency-v1/transaction-inventory.derived.mjs";

export const image = (value, role) =>
  typeof value === "string" &&
  new RegExp(
    `^051722405355\\.dkr\\.ecr\\.us-east-2\\.amazonaws\\.com/vaettir-${role}@sha256:[a-f0-9]{64}$`,
  ).test(value);
export const appPath = (p) =>
  typeof p === "string" &&
  p.startsWith("/app/") &&
  relative(p.slice(1)) &&
  !p
    .split("/")
    .some((x) => [".local", ".git", "assistant-history"].includes(x));
export function accepted(ref, read, scope) {
  const v = jsonRef(ref, read);
  ok(
    v.accepted === true && v.independentReview === true && v.scope === scope,
    `Missing independent ${scope} review`,
  );
  verifyTree(v.proofTree, read);
  return v;
}
export function sourceAdmission(b, policy, io) {
  admitProducerSource(b.producers, io.read);
  admitWebLeafSource(b.webLeaf, io.read);
  admitDependencySource(b.packageDependency, io.read);
  admitMinimalDeltaSource(b.minimalDelta, io.read);
  ok(
    b?.purpose === policy.purpose && b.nativeBindings,
    "Final release bindings required",
  );
  const n = b.nativeBindings;
  admitPreparation(n, io.nativePolicy, io.native);
  const repair = accepted(b.repairAcceptance, io.read, "NORMAL_MERGED_REPAIR");
  ok(
    repair.pr === policy.requiredRepairPr &&
      hex(repair.head, 40) &&
      hex(repair.merge, 40) &&
      io.source.contains(n.source.commit, repair.merge) &&
      io.source.contains(repair.merge, repair.head),
    "Final source must include normally merged PR111",
  );
  const parents = io.source.parents(repair.merge);
  ok(
    parents.length === 2 &&
      parents[1] === repair.head &&
      same(parents, repair.parents) &&
      io.source.tree(repair.merge) === repair.tree,
    "Repair merge graph/tree mismatch",
  );
  const review = accepted(
    b.operatorApproval,
    io.read,
    "FINAL_APPLICATION_OPERATOR_SOURCE",
  );
  ok(
    review.manifestSha256 === b.operatorManifest.sha256,
    "Operator manifest not reviewed",
  );
  ok(
    same(jsonRef(b.operatorManifest, io.read).files, io.operatorFiles),
    "Operator bytes changed",
  );
  for (const row of policy.nativeFiles)
    ok(
      same(
        io.nativeFiles.find((x) => x.path === row.path),
        row,
      ),
      "Frozen native source changed",
    );
  ok(
    policy.nativeFiles.length === io.nativeFiles.length,
    "Native package membership changed",
  );
  for (const row of policy.inherited) {
    const bytes = io.inherited(row.path);
    ok(
      bytes.length === row.bytes && sha(bytes) === row.sha256,
      "Frozen inherited operator changed",
    );
  }
  return {
    source: n.source.commit,
    tree: n.source.tree,
    releaseAccepted: false,
  };
}

// This supplements, never substitutes for, the inherited full archive verifier.
export function completeImage(ref, role, read) {
  const v = accepted(ref, read, "COMPLETE_IMMUTABLE_IMAGE");
  ok(
    image(v.image, role) && v.image.endsWith("@sha256:" + v.manifest.sha256),
    "Exact image identity required",
  );
  verifyOciByteLinks(v, read);
  verifyRef(v.archive, read);
  const verification = jsonRef(v.verification, read);
  ok(
    verification.archiveSha256 === v.archive.sha256 &&
      verification.manifestDigest === "sha256:" + v.manifest.sha256 &&
      verification.configDigest === "sha256:" + v.config.sha256 &&
      verification.allReferencedBlobsPresent === true &&
      verification.allDescriptorHashesAndSizesExact === true &&
      verification.allOrderedDiffIdsExact === true &&
      verification.exactOriginalManifestAndConfigBytes === true,
    "Full original OCI content verification required",
  );
  // Complete merged filesystem and extended metadata come from the reviewed
  // layer/whiteout parser, not the linkage helper's completion boolean.
  const parser = accepted(
    v.filesystemReview,
    read,
    "COMPLETE_FILESYSTEM_AND_EXTENDED_METADATA",
  );
  ok(
    parser.imageDigest === "sha256:" + v.manifest.sha256 &&
      parser.inventorySha256 === v.inventory.sha256 &&
      parser.layerOrderSha256 === v.layerOrder.sha256,
    "Filesystem review identity mismatch",
  );
  const order = jsonRef(v.layerOrder, read);
  ok(
    same(
      order,
      v.layers.map((r, i) => ({
        index: i,
        digest: "sha256:" + r.compressed.sha256,
        diffId: "sha256:" + r.uncompressed.sha256,
      })),
    ),
    "Filesystem parser layer order mismatch",
  );
  completeInventoryRef(v.inventory, read);
  return v;
}

export function transactionAdmission(t, role, io) {
  // Two full snapshots in a transaction need a separate bounded allowance.
  // Frozen 8b bytes remain untouched; all original transaction checks follow.
  const observation = jsonRef(t.observation, io.read, 512 * 1024 ** 2);
  const review = jsonRef(t.review, io.read, 256 * 1024 ** 2);
  ok(
    review.observedTransactionSha256 === t.observation.sha256 &&
      observation.observationComplete === true &&
      observation.nativeCommandsPassed === true &&
      observation.error === null &&
      observation.installAttempted === true,
    "Actual successful SQLite transaction required",
  );
  ok(
    observation.admission?.sqliteProof ===
      io.nativePolicy.sqliteAccepted.proofSha256 &&
      observation.admission.artifact ===
        io.nativePolicy.sqliteAccepted.artifactImage.split("@")[1],
    "Wrong transaction native inputs",
  );
  ok(
    observation.commands.filter(
      (c) =>
        c.exe === "/usr/bin/dpkg" &&
        same(c.args, [
          "--install",
          "/tmp/vaettir-sqlite-overlay-v1/sqlite.deb",
        ]),
    ).length === 1 &&
      observation.commands.every(
        (c) => c.status === 0 && c.signal === null && c.error === null,
      ),
    "Missing/replayed/failed package transaction",
  );
  verifyOverlay(observation.before, observation.after, review, io.nativePolicy);
  const stage = completeImage(t.imageAcceptance, role, io.read);
  const link = accepted(t.imageLink, io.read, "TRANSACTION_STAGE_CUSTODY");
  ok(
    link.observationSha256 === t.observation.sha256 &&
      link.reviewSha256 === t.review.sha256 &&
      link.imageDigest === "sha256:" + stage.manifest.sha256 &&
      link.inventorySha256 === stage.inventory.sha256,
    "Transaction is not linked to actual preserved stage",
  );
  // The extended-metadata inventory is reviewed separately. Its normalized rows
  // must correspond exactly to the raw Node transaction snapshot.
  const snapshot = completeInventoryRef(t.normalizedSnapshot, io.read);
  ok(
    link.normalizedSnapshotSha256 === t.normalizedSnapshot.sha256 &&
      same(snapshot, observation.after),
    "Transaction snapshot changed",
  );
  return stage;
}

export function validateApplicationLedger(
  before,
  after,
  review,
  nativePaths,
  probeSha256,
) {
  ok(
    review.scope === "FINAL_APPLICATION_OVERLAY" &&
      review.accepted === true &&
      review.independentReview === true,
    "Application delta requires independent review",
  );
  const delta = exactDelta(before, after);
  ok(same(delta, review.changes), "Unreviewed application filesystem delta");
  const native = new Set(nativePaths);
  const categories = Object.keys(review.categories).sort();
  ok(
    same(categories, delta.map((r) => r.path).sort()),
    "Unused/missing application delta categories",
  );
  for (const row of delta) {
    const category = review.categories[row.path];
    const exactProbeRemoval =
      category === "observer-removal" &&
      row.after === null &&
      row.path === "/tmp/vaettir-sqlite-overlay-v1/sqlite-runtime-regression" &&
      hex(probeSha256) &&
      row.before?.sha256 === probeSha256;
    ok(
      !native.has(row.path) || exactProbeRemoval,
      "Application overlay cannot change native bytes or metadata",
    );
    if (category === "application")
      ok(appPath(row.path), "Application path escapes /app");
    else if (category === "observer-removal")
      ok(
        !row.after &&
          (row.path === "/tmp/vaettir-sqlite-overlay-v1" ||
            row.path.startsWith("/tmp/vaettir-sqlite-overlay-v1/") ||
            row.path === "/vaettir-sqlite-observation-v1" ||
            row.path.startsWith("/vaettir-sqlite-observation-v1/")),
        "Only exact successful-observer removals allowed",
      );
    else throw Error("Unknown application delta category");
    // Existing native inode groups must never be modified through another link.
    ok(
      !native.has(row.before?.hardlinkGroup),
      "Application change aliases native inode",
    );
  }
  return delta;
}

export function payloadAdmission(b, role, stage, source, io) {
  const a = b.application[role],
    r = accepted(a.acceptance, io.read, "FINAL_APPLICATION_BUILD_OUTPUT");
  const ledger = jsonRef(a.ledger, io.read),
    before = completeInventoryRef(a.before, io.read),
    after = completeInventoryRef(a.after, io.read);
  ok(
    r.source === source.source &&
      r.tree === source.tree &&
      r.ledgerSha256 === a.ledger.sha256 &&
      r.beforeSha256 === a.before.sha256 &&
      r.afterSha256 === a.after.sha256 &&
      r.parentDigest === "sha256:" + stage.manifest.sha256 &&
      r.sourceArchiveSha256 === a.sourceArchive.sha256,
    "Application output not bound to final source/native stage",
  );
  verifyRef(a.sourceArchive, io.read);
  ok(r.buildLogSha256 === a.buildLog.sha256, "Original build log required");
  verifyRef(a.buildLog, io.read);
  const native = jsonRef(a.nativeInventory, io.read);
  ok(
    r.nativeInventorySha256 === a.nativeInventory.sha256 &&
      r.payloadManifestSha256 === a.payloadManifest.sha256,
    "Unbound payload/native inventory",
  );
  const delta = validateApplicationLedger(
    before,
    after,
    ledger,
    native.map((r) => "/" + r.path.replace(/^\//, "")),
    io.nativePolicy.sqliteAccepted.probeSha256,
  );
  const payload = jsonRef(a.payloadManifest, io.read);
  ok(
    Array.isArray(payload.files) &&
      payload.files.length <= 200000 &&
      same(
        payload.files.map((x) => x.path).sort(),
        delta
          .filter((x) => x.after?.type === "file")
          .map((x) => x.path)
          .sort(),
      ),
    "Payload must contain exactly changed regular files",
  );
  let total = 0;
  for (const row of payload.files) {
    const expected = delta.find((d) => d.path === row.path)?.after;
    ok(
      expected &&
        row.ref.sha256 === expected.sha256 &&
        row.ref.bytes === expected.bytes,
      "Payload hash/size mismatch",
    );
    total += row.ref.bytes;
    ok(total <= 4 * 1024 ** 3, "Application payload exceeds bound");
    verifyRef(row.ref, io.read);
  }
  // Require proof of complete inventory normalization, rather than treating a
  // caller-supplied before[] as the actual stage filesystem.
  ok(
    r.stageInventorySha256 === stage.inventory.sha256 &&
      r.normalizerSource &&
      r.proofTree,
    "Stage normalization proof missing",
  );
  verifyRef(r.normalizerSource, io.read);
  if (role === "web")
    staticAdmission(a.staticRetention, source.source, after, io.read);
  return { delta, payload, before, after, review: r };
}

export function staticAdmission(ref, source, after, read) {
  const r = accepted(ref, read, "THREE_COHORT_STATIC_RETENTION");
  ok(
    Array.isArray(r.cohorts) &&
      r.cohorts.length === 3 &&
      r.cohorts[0].id === source &&
      new Set(r.cohorts.map((x) => x.id)).size === 3 &&
      r.cohorts.every((x) => hex(x.id, 40)),
    "Exactly three ordered static cohorts required",
  );
  const retained = jsonRef(r.parentCohorts, read);
  ok(
    same(
      r.cohorts.slice(1).map((x) => x.id),
      retained.cohorts.slice(0, 2).map((x) => x.id),
    ),
    "Wrong parent static cohorts",
  );
  const paths = new Map(after.map((x) => [x.path, x]));
  const seen = new Map();
  for (const c of r.cohorts)
    for (const f of c.files) {
      ok(
        relative(f.path) && f.path.startsWith("_next/static/") && hex(f.sha256),
        "Unsafe static member",
      );
      const p =
        "/app/apps/web/.next/static/" + f.path.slice("_next/static/".length);
      ok(
        paths.get(p)?.sha256 === f.sha256 && paths.get(p)?.bytes === f.bytes,
        "Required static asset missing or changed",
      );
      ok(
        !seen.has(p) || seen.get(p) === f.sha256,
        "Cross-cohort asset collision",
      );
      seen.set(p, f.sha256);
    }
  ok(
    same(
      [...seen.keys()].sort(),
      after
        .filter(
          (x) =>
            x.type === "file" &&
            x.path.startsWith("/app/apps/web/.next/static/"),
        )
        .map((x) => x.path)
        .sort(),
    ),
    "Extra or missing static cohort files",
  );
  return r;
}

export function structuralNativeEvidence(refs, role, io) {
  const audit = jsonRef(refs.audit, io.read),
    review = accepted(refs.acceptance, io.read, "FINAL_NATIVE_STRUCTURE");
  ok(
    review.auditSha256 === refs.audit.sha256 &&
      audit.role === role &&
      audit.parentDigest === io.nativePolicy.roles[role].digest &&
      /^sha256:[a-f0-9]{64}$/.test(audit.imageDigest),
    "Native audit identity mismatch",
  );
  verifyTree(audit.proofTree, io.read);
  for (const [key, ref] of Object.entries(refs))
    if (!["audit", "acceptance"].includes(key))
      ok(
        audit.evidenceSha256?.[key] === ref.sha256,
        "Native structural evidence not bound",
      );
  ok(
    refs.nativeBefore.sha256 ===
      io.nativePolicy.roles[role].nativeInventorySha256,
    "Wrong native baseline",
  );
  const before = jsonRef(refs.nativeBefore, io.read),
    after = jsonRef(refs.nativeAfter, io.read);
  const expected = before.map((r) =>
    r.path === "usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6"
      ? { ...r, ...audit.sqliteNativeRow }
      : r,
  );
  ok(
    audit.sqliteNativeRow.path ===
      "usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6" &&
      audit.sqliteNativeRow.sha256 ===
        io.nativePolicy.sqliteAccepted.librarySha256,
    "Wrong SQLite replacement",
  );
  if (audit.acceptedProbeRow) {
    ok(
      audit.acceptedProbeRow.path ===
        "usr/share/vaettir/sqlite-security/sqlite-runtime-regression" &&
        audit.acceptedProbeRow.sha256 ===
          io.nativePolicy.sqliteAccepted.probeSha256 &&
        !before.some((x) => x.path === audit.acceptedProbeRow.path),
      "Unexpected native addition",
    );
    expected.push(audit.acceptedProbeRow);
    expected.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
  ok(same(expected, after), "Unrelated native bytes or metadata changed");
  verifyPackageState(
    jsonRef(refs.packagesBefore, io.read),
    jsonRef(refs.packagesAfter, io.read),
    io.nativePolicy.sqliteAccepted.librarySha256,
    readPackageEvidence(refs.packageTransition, role, audit.imageDigest, refs, io.read),
  );
  ok(
    audit.discovery.completeFilesystem === true &&
      audit.discovery.dynamicLookupsReviewed === true &&
      audit.discovery.noPrefixOnlyFilter === true &&
      audit.discovery.inventorySha256 === refs.consumerInventory.sha256 &&
      review.expectedConsumersSha256 === refs.expectedConsumers.sha256,
    "Incomplete native consumer discovery",
  );
  const consumers = jsonRef(refs.expectedConsumers, io.read);
  verifyConsumers(jsonRef(refs.consumerInventory, io.read), consumers);
  const pinned = io.nativePolicy.sqliteConsumers.filter((x) =>
    x.images.includes(role),
  );
  ok(
    consumers.length === pinned.length &&
      pinned.every((p) =>
        consumers.some(
          (c) =>
            c.path === p.path &&
            c.sha256 === p.sha256 &&
            same(
              [...c.undefinedSQLiteSymbols].sort(),
              [...p.undefinedSQLiteSymbols].sort(),
            ),
        ),
      ),
    "Pinned consumer was waived",
  );
  ok(
    consumers.every((c) =>
      c.dynamicSQLiteSymbols.every((s) =>
        io.nativePolicy.sqliteCandidateExports.includes(s),
      ),
    ),
    "Dynamic consumer symbol absent",
  );
  return audit;
}

export function finalComponent(b, role, source, io, requireRuntime = false) {
  const f = b.final[role],
    a = accepted(f.acceptance, io.read, "FINAL_COMPONENT_CONTENT");
  const native = structuralNativeEvidence(f.nativeStructure, role, io);
  if (requireRuntime) {
    const runtime = finalNativeEvidence(
      f.nativeRuntime,
      io.nativePolicy,
      role,
      io.read,
    );
    ok(
      runtime.imageDigest === native.imageDigest,
      "Native runtime checked a different image",
    );
  }
  ok(
    a.source === source.source &&
      a.tree === source.tree &&
      a.imageDigest === native.imageDigest &&
      a.nativeAuditSha256 === f.nativeStructure.audit.sha256,
    "Final component identity mismatch",
  );
  const before = completeInventoryRef(b.application[role].before, io.read),
    after = completeInventoryRef(f.inventory, io.read);
  const ledger = jsonRef(b.application[role].ledger, io.read);
  ok(
    same(after, completeInventoryRef(b.application[role].after, io.read)),
    "Actual final filesystem differs from reviewed overlay",
  );
  ok(
    !after.some(
      (x) =>
        x.path === "/tmp/vaettir-sqlite-overlay-v1" ||
        x.path.startsWith("/tmp/vaettir-sqlite-overlay-v1/") ||
        x.path === "/vaettir-sqlite-observation-v1" ||
        x.path.startsWith("/vaettir-sqlite-observation-v1/"),
    ),
    "Observer contents must not ship in final image",
  );
  validateApplicationLedger(
    before,
    after,
    ledger,
    jsonRef(b.application[role].nativeInventory, io.read).map(
      (x) => "/" + x.path.replace(/^\//, ""),
    ),
    io.nativePolicy.sqliteAccepted.probeSha256,
  );
  const scan = accepted(f.scanReview, io.read, "UNSUPPRESSED_FINAL_IMAGE_SCAN");
  ok(
    scan.imageDigest === a.imageDigest &&
      scan.rawFindingsSha256 === f.rawFindings.sha256 &&
      scan.newPolicyOrWaiver === false,
    "Unbound scan or new waiver",
  );
  const findings = jsonRef(f.rawFindings, io.read);
  ok(
    same(scan.findings, findings) &&
      Array.isArray(scan.dispositions) &&
      scan.dispositions.length === findings.length,
    "Every unsuppressed finding needs an exact disposition",
  );
  for (let i = 0; i < findings.length; i++) {
    const d = scan.dispositions[i];
    ok(
      d.findingSha256 === sha(Buffer.from(JSON.stringify(findings[i]))) &&
        d.accepted === true &&
        d.inheritedScope,
      "Unhandled scan finding",
    );
    const prior = accepted(
      d.inheritedScope,
      io.read,
      "EXISTING_SCOPED_FINDING",
    );
    ok(
      prior.findingSha256 === d.findingSha256 &&
        prior.newPolicyOrWaiver === false,
      "Finding cannot inherit unrelated disposition",
    );
  }
  ok(
    a.inventorySha256 === f.inventory.sha256 &&
      a.scanReviewSha256 === f.scanReview.sha256,
    "Actual filesystem/scan not linked",
  );
  return { ...a, releaseAccepted: false, remainingGates };
}
