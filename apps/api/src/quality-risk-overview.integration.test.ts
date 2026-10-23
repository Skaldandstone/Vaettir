import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { qualityRisksRouter } from "./routers/qualityRisks.js";
import { qualityRiskOverviewRouter } from "./routers/qualityRiskOverview.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { qualityRiskDefinition, type QualityRiskDefinition } from "./services/qualityRiskSchema.js";
// Authored but NOT EXECUTED: all data is synthetic; no provider/source usage.
describe("human project risk overview population and current evidence availability", () => {
  let orgId: string, foreignOrg: string, projectId: string, foreignProject: string, ownerId: string, caseId: string, reqId: string, resultId: string, runId: string;
  let owner: ReturnType<typeof qualityRiskOverviewRouter.createCaller>, viewer: typeof owner, outsider: typeof owner,
    writer: ReturnType<typeof qualityRisksRouter.createCaller>;
  const users: string[] = [];
  const definition = (overrides: Partial<QualityRiskDefinition> = {}): QualityRiskDefinition => ({ title: "Synthetic manual failure mode", component: "Synthetic component",
    failureMode: "Synthetic failure description", cause: "Synthetic cause", effect: "Synthetic consequence", likelihood: "UNKNOWN", consequence: "UNKNOWN",
    rationale: "Synthetic private assessment rationale", mitigation: "Synthetic intended mitigation", caseIds: [], requirementIds: [], ...overrides });
  const input = () => ({ projectId, originalOrganizationId: orgId });
  const create = (body = definition()) => writer.write({ projectId, requestId: randomUUID(), operation: "CREATE", definition: body });
  const review = (id: string, expectedVersion: number, resultIds: string[] = [], disposition: "FURTHER_ACTION" | "REVIEW_RECORDED" | "HUMAN_ACCEPTANCE_RECORDED" = "REVIEW_RECORDED") => writer.write({
    projectId, requestId: randomUUID(), operation: "REVIEW", id, expectedVersion, decision: { likelihood: "RARE", consequence: "MINOR", disposition,
      rationale: "Synthetic private decision rationale", evidenceNotes: "Synthetic private narrative", resultIds, acknowledgeNotQualifiedApproval: true } });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host")) throw Error("Unique disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    orgId = (await prisma.organization.create({ data: { name: "Synthetic risk overview", slug: randomUUID(), planTierId: tier.id } })).id;
    foreignOrg = (await prisma.organization.create({ data: { name: "Synthetic foreign", slug: randomUUID(), planTierId: tier.id } })).id;
    projectId = (await prisma.project.create({ data: { organizationId: orgId, name: "Synthetic risks", slug: randomUUID(), caseKey: "syn" } })).id;
    foreignProject = (await prisma.project.create({ data: { organizationId: foreignOrg, name: "Synthetic foreign", slug: randomUUID() } })).id;
    for (const role of ["OWNER", "VIEWER", "OUTSIDER"] as const) {
      const user = await prisma.user.create({ data: { clerkUserId: randomUUID(), email: `risk-overview-${randomUUID()}@example.com`, memberships: {
        create: { organizationId: role === "OUTSIDER" ? foreignOrg : orgId, role: role === "OUTSIDER" ? "OWNER" : role, seatType: role === "VIEWER" ? "READ_ONLY" : "FULL" } } }, include: { memberships: true } });
      users.push(user.id); const caller = qualityRiskOverviewRouter.createCaller({ prisma, user });
      if (role === "OWNER") { owner = caller; ownerId = user.id; writer = qualityRisksRouter.createCaller({ prisma, user }); }
      else if (role === "VIEWER") viewer = caller; else outsider = caller;
    }
    caseId = (await prisma.testCase.create({ data: { projectId, title: "🎮".repeat(160), given: [], when: [], then: [], tags: [], testType: "FUNCTIONAL" } })).id;
    reqId = (await prisma.requirement.create({ data: { projectId, title: "🎮".repeat(160), description: "Synthetic private requirement body", shareToken: randomUUID() } })).id;
    runId = (await prisma.testRun.create({ data: { projectId, ciProvider: "manual", commitSha: "manual", branch: "manual", startedAt: new Date("2026-09-20T00:00:00.000Z") } })).id;
    resultId = (await prisma.testResult.create({ data: { testRunId: runId, testCaseId: caseId, status: "PASS", note: "Synthetic private result note", observations: { private: "Synthetic measurement" } } })).id;
  });
  afterAll(async () => { if (orgId && ownerId) await hardDeleteOrganization(prisma, orgId, ownerId, "Owned synthetic risk fixture erasure");
    if (foreignOrg && ownerId) await hardDeleteOrganization(prisma, foreignOrg, ownerId, "Owned synthetic risk fixture erasure");
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: { in: [orgId, foreignOrg].filter(Boolean) }, deletedById: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } }); });
  it("does not interpret an empty register as a no-risk or safety finding", async () => {
    const result = await viewer.summary(input()); expect(result.population.entries).toBe(0); expect(result.filtered.entries).toBe(0); expect(result.items).toEqual([]);
    expect(result.limits.some(row => row.includes("No calibrated score"))).toBe(true);
  });
  it("distinguishes explicitly unknown initial categories, no review and reviewed without evidence", async () => {
    const absent = await create(), noEvidence = await create(definition({ title: "Synthetic reviewed without evidence", likelihood: "POSSIBLE", consequence: "SIGNIFICANT" }));
    await review(noEvidence.entry.id, noEvidence.entry.version);
    const result = await viewer.summary(input()); expect(result.population.entries).toBe(2); expect(result.population.likelihood.UNKNOWN).toBe(1);
    expect(result.population.review.NO_REVIEW).toBe(1); expect(result.population.review.VERSION_MATCHING_REVIEW).toBe(1);
    expect(result.population.evidence.NO_REVIEW).toBe(1); expect(result.population.evidence.NONE_RECORDED).toBe(1);
    expect(result.items.find(row => row.id === absent.entry.id)?.disposition).toBe("NOT_RECORDED");
    const filtered = await viewer.summary({ ...input(), evidence: "NONE_RECORDED" }); expect(filtered.population.entries).toBe(2); expect(filtered.filtered.entries).toBe(1);
    expect(filtered.items[0].id).toBe(noEvidence.entry.id);
  });
  it("keeps human entry-version review matching distinct from captured status and later test changes", async () => {
    const risk = await create(definition({ title: "Synthetic evidence review", likelihood: "FREQUENT", consequence: "SEVERE", caseIds: [caseId], requirementIds: [reqId] }));
    const decision = await review(risk.entry.id, risk.entry.version, [resultId], "HUMAN_ACCEPTANCE_RECORDED");
    let detail = await viewer.byId({ ...input(), id: risk.entry.id }); expect(detail.entry.review).toBe("VERSION_MATCHING_REVIEW");
    expect(detail.evidence[0]).toMatchObject({ status: "PASS", available: true, resultId, caseId, runId });
    expect(detail.cases[0].title?.length).toBe(160); expect(detail.cases[0].titleIsExcerpt).toBe(true);
    expect(detail.requirements[0].label.length).toBe(160); expect(detail.requirements[0].titleIsExcerpt).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/Synthetic private assessment rationale|Synthetic private decision rationale|Synthetic private narrative|Synthetic private result note|Synthetic measurement|Synthetic private requirement body/);
    await prisma.testResult.update({ where: { id: resultId }, data: { status: "FAIL" } });
    detail = await viewer.byId({ ...input(), id: risk.entry.id }); expect(detail.evidence[0].status).toBe("PASS"); expect(detail.entry.review).toBe("VERSION_MATCHING_REVIEW");
    expect(detail.limits.some(row => row.includes("not automatically invalidated or reverified"))).toBe(true);
    await writer.write({ projectId, requestId: randomUUID(), operation: "UPDATE", id: risk.entry.id, expectedVersion: decision.entry.version,
      dropUnavailableLinks: false, definition: definition({ title: "Synthetic evidence review edited", caseIds: [caseId], requirementIds: [reqId] }) });
    expect((await viewer.byId({ ...input(), id: risk.entry.id })).entry.review).toBe("BASELINE_CHANGED");
  });
  it("checks exact captured tuples and retains unavailable historical observations with native IDs redacted", async () => {
    const risk = await create(definition({ title: "Synthetic tuple evidence", caseIds: [caseId] })); await review(risk.entry.id, risk.entry.version, [resultId]);
    const otherCase = await prisma.testCase.create({ data: { projectId: foreignProject, title: "Synthetic foreign tuple", given: [], when: [], then: [], tags: [], testType: "FUNCTIONAL" } });
    await prisma.testResult.update({ where: { id: resultId }, data: { testCaseId: otherCase.id } });
    try {
      const detail = await viewer.byId({ ...input(), id: risk.entry.id }); expect(detail.entry.evidence).toMatchObject({ total: 1, unavailable: 1, state: "ALL_REFERENCES_UNAVAILABLE" });
      expect(detail.evidence[0]).toMatchObject({ resultId: null, caseId: null, runId: null, available: false, status: "FAIL" });
      expect(JSON.stringify(detail)).not.toContain(resultId); expect(JSON.stringify(detail)).not.toContain(otherCase.id);
      expect((await viewer.summary({ ...input(), evidence: "ALL_REFERENCES_UNAVAILABLE" })).filtered.entries).toBeGreaterThanOrEqual(1);
    } finally { await prisma.testResult.update({ where: { id: resultId }, data: { testCaseId: caseId } }); }
  });
  it("preserves unavailable intended references in their denominator and checks original project/current membership", async () => {
    const req = await prisma.requirement.create({ data: { projectId, title: "Synthetic removable intent" } });
    const risk = await create(definition({ title: "Synthetic missing intended requirement", requirementIds: [req.id] }));
    await prisma.requirement.delete({ where: { id: req.id } });
    const detail = await viewer.byId({ ...input(), id: risk.entry.id }); expect(detail.entry.mitigation).toMatchObject({ total: 1, unavailable: 1, state: "ALL_REFERENCES_UNAVAILABLE" });
    expect(detail.requirements[0]).toMatchObject({ requirementId: null, available: false }); expect(JSON.stringify(detail)).not.toContain(req.id);
    await expect(outsider.summary(input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.summary({ ...input(), originalOrganizationId: foreignOrg })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date() } });
    try { await expect(owner.summary(input())).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: null } }); }
    await prisma.membership.deleteMany({ where: { userId: users[1], organizationId: orgId } });
    try { await expect(viewer.summary(input())).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.membership.create({ data: { userId: users[1], organizationId: orgId, role: "VIEWER", seatType: "READ_ONLY" } }); }
    await prisma.membership.create({ data: { userId: ownerId, organizationId: foreignOrg, role: "OWNER", seatType: "FULL" } });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: foreignOrg } });
    const freshUser = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, include: { memberships: true } });
    try { await expect(qualityRiskOverviewRouter.createCaller({ prisma, user: freshUser }).summary({ projectId })).rejects.toMatchObject({ code: "NOT_FOUND" }); }
    finally { await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgId } }); }
  });
  it("pages deterministic filtered entries and refuses unsupported category metadata rather than silently using UNKNOWN", async () => {
    const created = []; for (let n = 0; n < 23; n++) created.push(await create(definition({ title: `Synthetic paged overview ${n}`, component: "Synthetic paging component" })));
    const a = await viewer.summary({ ...input(), search: "Synthetic paged overview" }), b = await viewer.summary({ ...input(), search: "Synthetic paged overview", offset: 20 });
    expect(a.filtered.entries).toBe(23); expect(a.items).toHaveLength(20); expect(b.items).toHaveLength(3); expect(b.hasMore).toBe(false);
    expect(new Set([...a.items, ...b.items].map(row => row.id)).size).toBe(23);
    const target = created[0].entry.id, row = await prisma.qualityRiskEntry.findUniqueOrThrow({ where: { id: target } }), original = qualityRiskDefinition.parse(row.definition);
    await prisma.qualityRiskEntry.update({ where: { id: target }, data: { version: { increment: 1 }, definition: { ...definition({ title: row.title }), likelihood: "UNSUPPORTED_CATEGORY" } } });
    try { await expect(viewer.summary(input())).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); }
    finally { await prisma.qualityRiskEntry.update({ where: { id: target }, data: { version: { increment: 1 }, definition: original } }); }
  });
  it("refuses an overbound complete metadata population before returning partial overview counts", async () => {
    // A valid bounded population can exceed the aggregate8MiB metadata budget.
    // This fixture neither disables DB guards nor fabricates provider evidence.
    const largeProject = await prisma.project.create({ data: { organizationId: orgId, name: "Synthetic large retained metadata", slug: randomUUID() } });
    await prisma.projectQualityRiskState.create({ data: { projectId: largeProject.id, organizationId: orgId, nextNumber: 700 } });
    const caseIds = Array.from({ length: 20 }, (_, n) => `synthetic-case-${n}-`.padEnd(120, "c"));
    const resultIds = Array.from({ length: 20 }, (_, n) => `synthetic-result-${n}-`.padEnd(120, "r"));
    const evidence = caseIds.map((id, n) => ({ caseId: id, resultId: resultIds[n], runId: `synthetic-run-${n}-`.padEnd(120, "u"), caseDisplayId: `SYN-${n}-`.padEnd(160, "L"),
      status: "BLOCKED", observedAt: "2026-09-20T00:00:00.000Z", runStartedAt: "2026-09-20T00:00:00.000Z" }));
    const ids = Array.from({ length: 700 }, () => randomUUID()), body = definition({ caseIds });
    await prisma.qualityRiskEntry.createMany({ data: ids.map((id, n) => ({ id, projectId: largeProject.id, number: n + 1, displayId: `SYN-R${String(n + 1).padStart(4, "0")}`,
      title: body.title, definition: body, version: 2, createdById: ownerId, updatedById: ownerId })) });
    await prisma.qualityRiskDecision.createMany({ data: ids.map(entryId => ({ entryId, assessedVersion: 1, createdVersion: 2, createdById: ownerId, baseline: body, evidence,
      decision: { likelihood: "UNKNOWN", consequence: "UNKNOWN", rationale: "Synthetic ordinary decision", evidenceNotes: "", disposition: "FURTHER_ACTION", resultIds,
        acknowledgeNotQualifiedApproval: true } })) });
    await expect(viewer.summary({ projectId: largeProject.id, originalOrganizationId: orgId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
