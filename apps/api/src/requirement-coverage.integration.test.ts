import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@vaettir/db";
import { defectClusterId, emptyDefectDocument, defectDocumentSchema } from "@vaettir/core";
import { requirementCoverageRouter } from "./routers/requirementCoverage.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
// SOURCE-ONLY fixtures: authoring is not actual database or runtime acceptance.
// Morning execution must use generated client, all additive companion migrations,
// a unique disposable seeded loopback database, and no external services.
describe("explicit native requirement/case/execution matrix", () => {
  let orgId: string, foreignOrg: string, projectId: string, foreignProject: string, ownerId: string, reqId: string,
    caseId: string, unlinkedCaseId: string, runId: string, planId: string;
  let owner: ReturnType<typeof requirementCoverageRouter.createCaller>, viewer: typeof owner, outsider: typeof owner;
  const users: string[] = [];
  const asOf = "2026-09-30T23:59:59.999Z";
  const base = () => ({ projectId, asOf, interval: { start: "2026-09-01", end: "2026-09-30" }, originalOrganizationId: orgId });
  async function nativeCase(title: string, archived = false) {
    return prisma.testCase.create({ data: { projectId, title, archived, given: [], when: [], then: [], tags: [], testType: "FUNCTIONAL" } });
  }
  async function direct(requirementId: string, targetCase: string, removed = false) {
    return prisma.caseTraceabilityLink.create({ data: { id: randomUUID(), projectId, caseId: targetCase, provider: "requirement", providerOrigin: "vaettir",
      kind: "requirement", nativeId: requirementId, requirementId, title: "Synthetic explicit relationship", createdById: ownerId, updatedById: ownerId,
      removedAt: removed ? new Date() : null } });
  }
  async function run(startedAt: string, context: object = {}, manual = false, ids: string[] = []) {
    return prisma.testRun.create({ data: { projectId, startedAt: new Date(startedAt), ciProvider: manual ? "manual" : "synthetic-ci",
      commitSha: manual ? "manual" : "synthetic-build", branch: "synthetic", manualTestCaseIds: ids, executionContext: context } });
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host")) throw Error("Unique disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { name: "Synthetic matrix", slug: randomUUID(), planTierId: tier.id } }); orgId = org.id;
    foreignOrg = (await prisma.organization.create({ data: { name: "Synthetic foreign matrix", slug: randomUUID(), planTierId: tier.id } })).id;
    projectId = (await prisma.project.create({ data: { organizationId: orgId, name: "Synthetic matrix", slug: randomUUID(), caseKey: "SYN" } })).id;
    foreignProject = (await prisma.project.create({ data: { organizationId: foreignOrg, name: "Synthetic foreign", slug: randomUUID() } })).id;
    for (const role of ["OWNER", "VIEWER", "OUTSIDER"] as const) {
      const user = await prisma.user.create({ data: { clerkUserId: randomUUID(), email: `matrix-${randomUUID()}@example.com`, memberships: {
        create: { organizationId: role === "OUTSIDER" ? foreignOrg : orgId, role: role === "OUTSIDER" ? "EDITOR" : role, seatType: role === "VIEWER" ? "READ_ONLY" : "FULL" } } }, include: { memberships: true } });
      users.push(user.id); const caller = requirementCoverageRouter.createCaller({ prisma, user });
      if (role === "OWNER") { owner = caller; ownerId = user.id; } else if (role === "VIEWER") viewer = caller; else outsider = caller;
    }
    await prisma.caseTraceabilityState.create({ data: { projectId, organizationId: orgId } });
    reqId = (await prisma.requirement.create({ data: { projectId, title: "Synthetic native requirement", description: "No imported source", shareToken: "synthetic-private-share-token" } })).id;
    caseId = (await nativeCase("Synthetic directly linked case")).id;
    unlinkedCaseId = (await nativeCase("Synthetic unlinked plan-only case")).id;
    await direct(reqId, caseId);
    const type = await prisma.testPlanType.findFirstOrThrow();
    planId = (await prisma.testPlan.create({ data: { projectId, testPlanTypeId: type.id, name: "Synthetic recorded plan" } })).id;
    await prisma.acceptanceCriterion.create({ data: { testPlanId: planId, requirementId: reqId, description: "Synthetic plan-derived criterion", status: "MET" } });
    await prisma.testCase.update({ where: { id: unlinkedCaseId }, data: { testPlanId: planId } });
    runId = (await run("2026-09-20T00:00:00.000Z", { version: 1, plan: { testPlanId: planId }, configuration: { platform: "PC", environment: "Synthetic stage", build: "manual-b1" } }, true)).id;
    for (const status of ["PASS", "FAIL", "FLAKY", "SKIP", "BLOCKED"] as const) await prisma.testResult.create({ data: {
      testRunId: runId, testCaseId: caseId, status, note: "synthetic private note", errorMessage: "synthetic private trace", observations: { private: "synthetic raw measurement" } } });
    await prisma.testResult.create({ data: { testRunId: runId, testCaseId: null, externalTestId: "synthetic-unmatched", status: "PASS" } });
  });
  afterAll(async () => {
    if (orgId && ownerId) await hardDeleteOrganization(prisma, orgId, ownerId, "Owned synthetic coverage matrix erasure");
    if (foreignOrg && ownerId) await hardDeleteOrganization(prisma, foreignOrg, ownerId, "Owned synthetic coverage matrix erasure");
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  it("shows direct native links only, not plan-inferred criteria or current case plan assignment", async () => {
    const result = await viewer.cases({ ...base(), requirementId: reqId });
    expect(result.total).toBe(1); expect(result.items.map(row => row.id)).toEqual([caseId]);
    expect(result.items[0].outcomes).toMatchObject({ PASS: 1, FAIL: 1, FLAKY: 1, SKIP: 1, BLOCKED: 1, total: 5 });
    expect(result.limits.some(value => value.includes("not inferred as direct coverage"))).toBe(true);
    const evidence = await viewer.evidence({ ...base(), requirementId: reqId, caseId });
    expect(evidence.results).toHaveLength(5); expect(evidence.results.every(row => row.testRunId === runId)).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/synthetic private note|synthetic private trace|synthetic raw measurement|synthetic-private-share-token/);
    await expect(viewer.evidence({ ...base(), requirementId: reqId, caseId: unlinkedCaseId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("separates unmatched and foreign case references without leaking private native IDs", async () => {
    const foreignCase = await prisma.testCase.create({ data: { projectId: foreignProject, title: "Synthetic foreign case", given: [], when: [], then: [], tags: [], testType: "FUNCTIONAL" } });
    const foreignResult = await prisma.testResult.create({ data: { testRunId: runId, testCaseId: foreignCase.id, status: "FAIL" } });
    try {
      const result = await viewer.list(base()); expect(result.projectExecution).toMatchObject({ unmatched: 1, unavailableCaseReferences: 1, currentMatched: 5 });
      expect(JSON.stringify(result)).not.toContain(foreignCase.id); expect(JSON.stringify(result)).not.toContain(foreignResult.id);
    } finally { await prisma.testResult.delete({ where: { id: foreignResult.id } }); }
  });
  it("keeps no result, planned without result, only blocked/skip and archived cases distinct", async () => {
    const req = await prisma.requirement.create({ data: { projectId, title: "Synthetic states" } });
    const none = await nativeCase("Synthetic not run"), blocked = await nativeCase("Synthetic blocked", true);
    await direct(req.id, none.id); await direct(req.id, blocked.id);
    await run("2026-09-21T00:00:00.000Z", {}, true, [none.id]);
    await prisma.testResult.create({ data: { testRunId: runId, testCaseId: blocked.id, status: "BLOCKED" } });
    await prisma.testResult.create({ data: { testRunId: runId, testCaseId: blocked.id, status: "SKIP" } });
    const page = await viewer.cases({ ...base(), requirementId: req.id });
    expect(page.items.find(row => row.id === none.id)).toMatchObject({ plannedWithoutResult: 1, outcomes: { total: 0, PASS: 0, state: "NO_RECORDED_RESULT" } });
    expect(page.items.find(row => row.id === blocked.id)).toMatchObject({ archived: true, outcomes: { PASS: 0, BLOCKED: 1, SKIP: 1, state: "ONLY_SKIPPED_OR_BLOCKED" } });
  });
  it("uses exact recorded plan/platform/environment/build and inclusive run-start UTC bounds", async () => {
    const exact = { ...base(), scope: { planId, runId, platform: "PC", environment: "Synthetic stage", build: "manual-b1" } };
    expect((await viewer.evidence({ ...exact, requirementId: reqId, caseId })).resultTotal).toBe(5);
    expect((await viewer.evidence({ ...exact, scope: { ...exact.scope, platform: "Mobile" }, requirementId: reqId, caseId })).resultTotal).toBe(0);
    const original = (await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } })).testPlanId;
    await prisma.testCase.update({ where: { id: caseId }, data: { testPlanId: null } });
    expect((await viewer.evidence({ ...exact, requirementId: reqId, caseId })).resultTotal).toBe(5);
    await prisma.testCase.update({ where: { id: caseId }, data: { testPlanId: original } });
    const boundary = await run("2026-09-01T00:00:00.000Z"), upper = await run(asOf), before = await run("2026-08-31T23:59:59.999Z");
    for (const r of [boundary, upper, before]) await prisma.testResult.create({ data: { testRunId: r.id, testCaseId: caseId, status: "PASS" } });
    const evidence = await viewer.evidence({ ...base(), requirementId: reqId, caseId });
    expect(evidence.results.some(r => r.testRunId === boundary.id)).toBe(true); expect(evidence.results.some(r => r.testRunId === upper.id)).toBe(true);
    expect(evidence.results.some(r => r.testRunId === before.id)).toBe(false);
    const ciBuild = await viewer.evidence({ ...base(), scope: { build: "synthetic-build" }, requirementId: reqId, caseId });
    expect(ciBuild.resultTotal).toBe(2); expect(ciBuild.results.every(r => r.testRun.ciProvider !== "manual")).toBe(true);
    const missing = await run("2026-09-23T00:00:00.000Z", {});
    await prisma.testResult.create({ data: { testRunId: missing.id, testCaseId: caseId, status: "PASS" } });
    expect((await viewer.evidence({ ...base(), scope: { platform: "PC", planId }, requirementId: reqId, caseId })).resultTotal).toBe(5);
    expect((await viewer.evidence({ ...base(), scope: { runId: missing.id, platform: "PC" }, requirementId: reqId, caseId })).resultTotal).toBe(0);
    await expect(viewer.list({ ...base(), asOf: "2999-01-01T00:00:00.000Z" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(viewer.list({ ...base(), scope: { runId: "unavailable-native-run" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("retains defect chips as explicit current source snapshots, never resolved by PASS", async () => {
    const document = defectDocumentSchema.parse({ ...emptyDefectDocument(), sources: [{ provider: "sentry", scope: "synthetic", status: "unavailable", observedAt: "2026-09-20T00:00:00.000Z" }],
      signals: [{ provider: "sentry", scope: "synthetic", externalId: "issue-1", title: "Synthetic crash cluster", occurrences: 2,
        windowStart: "2026-09-01T00:00:00.000Z", windowEnd: "2026-09-20T00:00:00.000Z", lastSeen: "2026-09-20T00:00:00.000Z" }] });
    await prisma.defectMapState.create({ data: { projectId, organizationId: orgId, document } });
    const nativeId = defectClusterId(document.signals[0]);
    const link = await prisma.caseTraceabilityLink.create({ data: { id: randomUUID(), projectId, caseId, provider: "defect", providerOrigin: "vaettir", kind: "defect", nativeId,
      title: "Synthetic crash cluster", createdById: ownerId, updatedById: ownerId } });
    expect((await viewer.evidence({ ...base(), requirementId: reqId, caseId })).defects.items[0]).toMatchObject({ nativeId, available: true, sourceState: "SOURCE_UNAVAILABLE" });
    await prisma.defectMapState.update({ where: { projectId }, data: { document: emptyDefectDocument() } });
    const unavailable = await viewer.evidence({ ...base(), requirementId: reqId, caseId });
    expect(unavailable.defects.items[0]).toMatchObject({ nativeId: null, available: false, sourceState: "CLUSTER_UNAVAILABLE" });
    expect(JSON.stringify(unavailable)).not.toContain(nativeId);
    await prisma.caseTraceabilityLink.delete({ where: { id: link.id } }); await prisma.defectMapState.delete({ where: { projectId } });
  });
  it("deduplicates explicit edges and honors removals without rewriting native data", async () => {
    const duplicate = await direct(reqId, caseId), removed = await direct(reqId, unlinkedCaseId, true);
    try { expect((await viewer.cases({ ...base(), requirementId: reqId })).total).toBe(1); }
    finally { await prisma.caseTraceabilityLink.deleteMany({ where: { id: { in: [duplicate.id, removed.id] } } }); }
  });
  it("refuses an oversized direct case population rather than returning a partial coverage denominator", async () => {
    const req = await prisma.requirement.create({ data: { projectId, title: "Synthetic oversized direct population" } });
    const ids = Array.from({ length: 1001 }, () => randomUUID());
    try {
      await prisma.testCase.createMany({ data: ids.map(id => ({ id, projectId, title: "Synthetic population-bound fixture", given: [], when: [], then: [], tags: [], testType: "FUNCTIONAL" as const })) });
      await prisma.caseTraceabilityLink.createMany({ data: ids.map(id => ({ id: randomUUID(), projectId, caseId: id, provider: "requirement", providerOrigin: "vaettir",
        kind: "requirement", nativeId: req.id, requirementId: req.id, title: "Synthetic declared edge", createdById: ownerId, updatedById: ownerId })) });
      await expect(viewer.cases({ ...base(), requirementId: req.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(viewer.list({ ...base(), search: "Synthetic oversized direct population" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      await prisma.caseTraceabilityLink.deleteMany({ where: { projectId, requirementId: req.id } });
      await prisma.testCase.deleteMany({ where: { projectId, id: { in: ids } } });
    }
  });
  it("pages deterministic requirement/case/result populations without hidden partial counts", async () => {
    const req = await prisma.requirement.create({ data: { projectId, title: "Synthetic paging requirement" } });
    for (let n = 0; n < 23; n++) {
      const c = await nativeCase(`Synthetic paged case ${n}`); await direct(req.id, c.id);
      await prisma.requirement.create({ data: { projectId, title: `Synthetic paged requirement ${n}` } });
    }
    const first = await viewer.cases({ ...base(), requirementId: req.id }), last = await viewer.cases({ ...base(), requirementId: req.id, offset: 20 });
    expect(first.items).toHaveLength(20); expect(first.hasMore).toBe(true); expect(last.items).toHaveLength(3); expect(last.hasMore).toBe(false);
    expect(new Set([...first.items, ...last.items].map(c => c.id)).size).toBe(23);
    const list = await viewer.list({ ...base(), search: "Synthetic paged requirement" });
    expect(list.total).toBe(23); expect(list.items).toHaveLength(20); expect((await viewer.list({ ...base(), search: "Synthetic paged requirement", offset: 20 })).items).toHaveLength(3);
    const literal = await prisma.requirement.create({ data: { projectId, title: "Synthetic literal 100%_" } });
    const literalPage = await viewer.list({ ...base(), search: "100%_" }); expect(literalPage.total).toBe(1); expect(literalPage.items[0].id).toBe(literal.id);
    const target = first.items[0].id; for (let n = 0; n < 23; n++) await prisma.testResult.create({ data: { testRunId: runId, testCaseId: target, status: "PASS" } });
    const a = await viewer.evidence({ ...base(), requirementId: req.id, caseId: target }), b = await viewer.evidence({ ...base(), requirementId: req.id, caseId: target, resultOffset: 20 });
    expect(a.resultTotal).toBe(23); expect(a.results).toHaveLength(20); expect(b.results).toHaveLength(3);
    expect(new Set([...a.results, ...b.results].map(r => r.id)).size).toBe(23);
  });
  it("fails closed on original-org reparent, live membership suspension and malformed native relationships", async () => {
    await expect(outsider.list(base())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.list({ ...base(), originalOrganizationId: foreignOrg })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date() } });
    try { await expect(owner.list(base())).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: null } }); }
    await prisma.membership.deleteMany({ where: { organizationId: orgId, userId: users[1] } });
    try { await expect(viewer.list(base())).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.membership.create({ data: { organizationId: orgId, userId: users[1], role: "VIEWER", seatType: "READ_ONLY" } }); }
    const invalid = await direct(reqId, caseId); await prisma.caseTraceabilityLink.update({ where: { id: invalid.id }, data: { nativeId: "different-native-requirement" } });
    try { await expect(owner.cases({ ...base(), requirementId: reqId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); }
    finally { await prisma.caseTraceabilityLink.delete({ where: { id: invalid.id } }); }
    await prisma.membership.create({ data: { organizationId: foreignOrg, userId: ownerId, role: "OWNER", seatType: "FULL" } });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: foreignOrg } });
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, include: { memberships: true } });
    try { await expect(requirementCoverageRouter.createCaller({ prisma, user: currentUser }).list({ ...base(), originalOrganizationId: undefined })).rejects.toMatchObject({ code: "NOT_FOUND" }); }
    finally { await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgId } }); }
  });
});
