import { jsonRef, requireThat as ok, same, verifyTree } from "../production-native-successor-v1/contracts.mjs";

export function apiRuntimeEvidence(audit, refs, read) {
  const browser = jsonRef(refs.browserObservation, read), prisma = jsonRef(refs.prismaObservation, read);
  for (const result of [browser, prisma])
    ok(result.actual === true && result.role === "api" && result.source === "94cde34624bcc910c5f8c1a19214302ffa04c2bf" && result.image === `051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api@${audit.imageDigest}`, "Exact actual API native observation required");
  ok(browser.domInteraction === true && /^[a-f0-9]{64}$/.test(browser.rasterSha256) && browser.customerPage === false && browser.browserSha256 === "4fa61f0ba0b4f89b7bec242c32ca16d3bccf69dbfef0651924a9ba8fede5f9d6", "Actual pinned API browser render required");
  ok(prisma.applicable === true && prisma.actualCreateAndRead === true && prisma.syntheticDatabase === true && Number.isInteger(prisma.schemaSteps) && prisma.schemaSteps > 0 && prisma.queryEngineSha256 === "35860a5c0fb2f79e7b38c40747c4d212318d97e1910ca528b133c802716de0b8" && prisma.schemaEngineSha256 === "cedeae04739cfa085493da2bafb5d1e4da0247fc74f2995a51ee24f20c9890be", "Actual API schema engine and query create/read required");
}

export function webApplicability(audit, refs, read, after) {
  const identity = audit.applicability;
  ok(identity?.schema === "web-native-applicability/v1" && identity.source === "94cde34624bcc910c5f8c1a19214302ffa04c2bf" && identity.role === "web" && identity.imageDigest === audit.imageDigest && identity.inventorySha256 === refs.nativeAfter.sha256,
    "Exact Web applicability identity required");
  for (const kind of ["browser", "prisma"]) {
    const row = audit[kind];
    ok(row?.applicable === false && row.actual === false && row.absenceObserved === true && row.reason === "ABSENT_FROM_COMPLETE_FINAL_NATIVE_INVENTORY" && row.observationSha256 === refs.applicabilityObservation.sha256,
      "Missing typed Web absence proof");
  }
  const review = jsonRef(refs.applicabilityReview, read), observation = jsonRef(refs.applicabilityObservation, read);
  ok(review.scope === "WEB_NATIVE_APPLICABILITY" && review.accepted === true && review.independentReview === true && review.source === identity.source && review.imageDigest === audit.imageDigest && review.inventorySha256 === refs.nativeAfter.sha256 && review.observationSha256 === refs.applicabilityObservation.sha256 && review.completeFilesystem === true && review.nativeEqualityUnchanged === true,
    "Independent complete Web absence review required");
  verifyTree(review.proofTree, read);
  ok(observation.source === identity.source && observation.image === `051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-web@${audit.imageDigest}` && observation.role === "web" && observation.actual === false && observation.applicable === false && observation.browserApplicable === false && observation.absenceObserved === true && observation.fullNativeInventorySha256 === refs.nativeAfter.sha256 && observation.reason === "NO_PRISMA_ENGINE_IN_COMPLETE_REVIEWED_NATIVE_INVENTORY", "Actual scoped absence observation required");
  const normalize = rows => rows.map(r => ({ path: "/" + r.path.replace(/^\//, ""), sha256: r.sha256, bytes: r.bytes, mode: r.mode, uid: r.uid, gid: r.gid, nativeKind: r.nativeKind })).sort((a,b) => a.path < b.path ? -1 : 1);
  ok(after.length > 600 && new Set(after.map(r => r.path)).size === after.length && same(normalize(observation.scanned), normalize(after)), "Absence fixture did not cover every final native row");
  ok(!after.some(r => /prisma|query[_-]engine|schema[_-]engine|chrom(e|ium)|playwright|firefox|webkit/i.test(r.path)), "Unexpected Web engine path");
  // This admits only native applicability. It does not substitute for render tests.
  ok(identity.apiBrowserCompanionRequired === true && identity.actualWeb23Required === true, "Companion runtime gates must remain required");
}

export function companionRuntime(b, source, apiDigest, webDigest, read) {
  const api = jsonRef(b.final.api.nativeRuntime.audit, read), review = jsonRef(b.final.api.nativeRuntime.acceptance, read);
  ok(review.accepted === true && review.independentReview === true && review.auditSha256 === b.final.api.nativeRuntime.audit.sha256 && api.role === "api" && api.imageDigest === apiDigest && api.browser.actual === true && api.browser.exitCode === 0 && api.prisma.actual === true && api.prisma.exitCode === 0,
    "Actual API browser and query/schema companion proof required");
  const web = jsonRef(b.runtime.results.web, read);
  ok(web.sourceCommit === source && web.imageDigest === webDigest && web.checks === 23 && web.passed === true && web.productionCredentialsUsed === false && web.customerWrites === false, "Actual same-source Web23 companion required");
}
