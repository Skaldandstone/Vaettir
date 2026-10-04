import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, prisma } from "@vaettir/db";
import { qualityRisksRouter } from "./routers/qualityRisks.js";
import { hardDeleteOrganization, previewOrgHardDelete } from "./services/orgHardDelete.js";
import { withQualityRiskAccess, writeQualityRisk } from "./services/qualityRisks.js";

// SOURCE-ONLY authored fixtures. No device/provider/AI calls. Requires morning
// generated Prisma client + latest migration on a UNIQUE synthetic loopback DB.
describe("project quality risk register (disposable PostgreSQL)", () => {
  let projectId: string, foreignProject: string, orgId: string, foreignOrg: string, editorId: string, ownerId: string;
  let caseId: string, secondCaseId: string, requirementId: string, resultId: string, runId: string, foreignResult: string;
  let owner: ReturnType<typeof qualityRisksRouter.createCaller>, editor: typeof owner, viewer: typeof owner, outsider: typeof owner;
  const orgs: string[] = [], users: string[] = [];
  const definition = () => ({ title: "Synthetic flow failure", component: "Synthetic bench", failureMode: "No flow",
    cause: "Synthetic sensor drift", effect: "Incorrect delivery", likelihood: "UNKNOWN" as const, consequence: "SEVERE" as const,
    rationale: "Frequency not established", mitigation: "Independent flow measurement", caseIds: [caseId], requirementIds: [requirementId] });
  const create = () => ({ operation: "CREATE" as const, projectId, requestId: randomUUID(), definition: definition() });
  const review = (id: string, expectedVersion: number, results = [resultId]) => ({ operation: "REVIEW" as const,
    projectId, id, expectedVersion, requestId: randomUUID(), decision: { likelihood: "UNKNOWN" as const,
      consequence: "SIGNIFICANT" as const, rationale: "Recorded human interpretation, not device qualification",
      evidenceNotes: "Synthetic fixtures only", disposition: "REVIEW_RECORDED" as const, resultIds: results,
      acknowledgeNotQualifiedApproval: true as const } });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host"))
      throw Error("Unique disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (let n = 0; n < 2; n++) {
      const slug = `quality-risk-${randomUUID()}`;
      const org = await prisma.organization.create({ data: { name: slug, slug, planTierId: tier.id } });
      orgs.push(org.id); if (!n) orgId = org.id; else foreignOrg = org.id;
    }
    projectId = (await prisma.project.create({ data: { organizationId: orgId, name: "Synthetic risk", slug: randomUUID(), caseKey: "syn" } })).id;
    foreignProject = (await prisma.project.create({ data: { organizationId: foreignOrg, name: "Foreign synthetic", slug: randomUUID() } })).id;
    for (const role of ["OWNER", "EDITOR", "VIEWER", "OUTSIDER"] as const) {
      const user = await prisma.user.create({ data: { email: `risk-${randomUUID()}@example.com`, clerkUserId: randomUUID(),
        memberships: { create: { organizationId: role === "OUTSIDER" ? foreignOrg : orgId,
          role: role === "OUTSIDER" ? "EDITOR" : role, seatType: "FULL" } } }, include: { memberships: true } });
      users.push(user.id); const caller = qualityRisksRouter.createCaller({ prisma, user });
      if (role === "OWNER") { owner = caller; ownerId = user.id; }
      else if (role === "EDITOR") { editor = caller; editorId = user.id; }
      else if (role === "VIEWER") viewer = caller; else outsider = caller;
    }
    for (let n = 0; n < 3; n++) {
      const c = await prisma.testCase.create({ data: { projectId: n === 2 ? foreignProject : projectId,
        title: `Synthetic mitigation ${n}`, given: [], when: [], then: [], tags: [], testType: "FUNCTIONAL" } });
      if (!n) caseId = c.id; else if (n === 1) secondCaseId = c.id;
      else {
        const run = await prisma.testRun.create({ data: { projectId: foreignProject, ciProvider: "synthetic", commitSha: "synthetic", branch: "synthetic", startedAt: new Date() } });
        foreignResult = (await prisma.testResult.create({ data: { testRunId: run.id, testCaseId: c.id, status: "PASS" } })).id;
      }
    }
    requirementId = (await prisma.requirement.create({ data: { projectId, title: "Synthetic independent measurement requirement" } })).id;
    runId = (await prisma.testRun.create({ data: { projectId, ciProvider: "synthetic", commitSha: "synthetic", branch: "synthetic", startedAt: new Date("2026-10-04T02:00:00Z") } })).id;
    resultId = (await prisma.testResult.create({ data: { testRunId: runId, testCaseId: caseId, status: "BLOCKED" } })).id;
  });
  afterAll(async () => {
    for (const id of orgs) {
      const preview = await previewOrgHardDelete(prisma, id), deleted = await hardDeleteOrganization(prisma, id, ownerId, "Owned synthetic quality risk register fixtures");
      for (const key of ["ProjectQualityRiskState", "QualityRiskEntry", "QualityRiskDecision", "QualityRiskWrite"] as const)
        expect(deleted.rowCounts[key]).toBe(preview.rowCounts[key]);
      expect(await prisma.projectQualityRiskState.count({ where: { organizationId: id } })).toBe(0);
    }
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: { in: orgs }, deletedById: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  it("creates stable IDs, native links and unknown initial categories without changing case scores", async () => {
    const before = await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } });
    const first = await owner.write(create());
    expect(first.entry.displayId).toMatch(/^syn-R\d{4}$/); expect(first.entry.version).toBe(1);
    const loaded = await viewer.byId({ projectId, id: first.entry.id });
    expect(loaded.entry.definition).toEqual(definition()); expect(loaded.canWrite).toBe(false);
    expect(loaded.entry.links.cases[0].id).toBe(caseId); expect(loaded.entry.links.requirements[0].id).toBe(requirementId);
    expect(loaded.decisions).toEqual([]);
    expect(await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } })).toEqual(before);
  });
  it("recovers identical actor-bound receipts once and rejects UUID reuse or stale CAS", async () => {
    const input = create(), first = await owner.write(input);
    expect(await owner.write(input)).toEqual(first);
    await expect(owner.write({ ...input, definition: { ...input.definition, title: "Changed payload" } })).rejects.toMatchObject({ code: "CONFLICT" });
    const update = { operation: "UPDATE" as const, projectId, id: first.entry.id, expectedVersion: 1,
      requestId: randomUUID(), dropUnavailableLinks: false, definition: { ...definition(), title: "Revised failure" } };
    const changed = await editor.write(update);
    expect(changed.entry.displayId).toBe(first.entry.displayId); expect(changed.entry.version).toBe(2);
    expect(await editor.write(update)).toEqual(changed);
    await expect(editor.write({ ...update, requestId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    const otherActor = await editor.write(input); expect(otherActor.entry.id).not.toBe(first.entry.id);
  });
  it("serializes identical concurrent creates without duplicate entry, decision or receipt", async () => {
    const input = create(); const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => owner.write(input)));
    expect(attempts.some(a => a.status === "fulfilled")).toBe(true);
    const recovered = await owner.write(input);
    expect(await owner.write(input)).toEqual(recovered);
    expect(await prisma.qualityRiskWrite.count({ where: { projectId, actorId: ownerId, requestId: input.requestId } })).toBe(1);
    const request = review(recovered.entry.id, 1);
    await Promise.allSettled(Array.from({ length: 5 }, () => owner.write(request)));
    const recorded = await owner.write(request); expect(await owner.write(request)).toEqual(recorded);
    expect(await prisma.qualityRiskDecision.count({ where: { entryId: recovered.entry.id } })).toBe(1);
  });
  it("snapshots blocked evidence as observed, not current readiness; edits make decisions historical", async () => {
    await prisma.testResult.update({ where: { id: resultId }, data: { status: "BLOCKED", testCaseId: caseId, testRunId: runId } });
    const first = await owner.write(create()), request = review(first.entry.id, 1), receipt = await owner.write(request);
    expect(await owner.write(request)).toEqual(receipt);
    await prisma.testResult.update({ where: { id: resultId }, data: { status: "PASS" } });
    let detail = await viewer.byId({ projectId, id: first.entry.id });
    expect(detail.decisions[0].evidence[0].status).toBe("BLOCKED");
    expect(detail.decisions[0].evidence[0].observedAt).toMatch(/Z$/);
    expect(detail.decisions[0].currentBaseline).toBe(true);
    expect(detail.decisions[0].verification).toContain("not automatically reverified");
    await owner.write({ operation: "UPDATE", projectId, id: first.entry.id, expectedVersion: 2, requestId: randomUUID(),
      dropUnavailableLinks: false, definition: { ...definition(), mitigation: "Revised intended mitigation" } });
    detail = await viewer.byId({ projectId, id: first.entry.id });
    expect(detail.decisions[0].currentBaseline).toBe(false);
    expect(detail.decisions[0].assessedDefinition.mitigation).toBe("Independent flow measurement");
    const row = (await viewer.list({ projectId })).items.find(e => e.id === first.entry.id)!;
    expect(row.reviewState).toBe("REVIEW_BASELINE_CHANGED"); expect(row.residual?.currentEntryBaseline).toBe(false);
  });
  it("permits an explicit no-evidence human decision without manufacturing verification", async () => {
    const first = await owner.write(create()); await owner.write(review(first.entry.id, 1, []));
    const detail = await viewer.byId({ projectId, id: first.entry.id });
    expect(detail.decisions[0].evidence).toEqual([]); expect(detail.decisions[0].decision.likelihood).toBe("UNKNOWN");
    expect(detail.decisions[0].verification).toContain("Not current readiness or qualified approval");
  });
  it("rejects foreign/unmatched/wrong-case evidence and foreign mitigation links", async () => {
    const first = await owner.write(create());
    await expect(owner.write(review(first.entry.id, 1, [foreignResult]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const unmatched = await prisma.testResult.create({ data: { testRunId: runId, status: "PASS" } });
    await expect(owner.write(review(first.entry.id, 1, [unmatched.id]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const wrong = await prisma.testResult.create({ data: { testRunId: runId, testCaseId: secondCaseId, status: "PASS" } });
    await expect(owner.write(review(first.entry.id, 1, [wrong.id]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const foreign = await prisma.requirement.create({ data: { projectId: foreignProject, title: "Foreign synthetic" } });
    await expect(owner.write({ ...create(), definition: { ...definition(), requirementIds: [foreign.id] } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.qualityRiskDecision.count({ where: { entryId: first.entry.id } })).toBe(0);
  });
  it("checks evidence ownership separately for each immutable snapshot, not just result ID", async () => {
    await prisma.testResult.update({ where: { id: resultId }, data: { testCaseId: caseId, testRunId: runId } });
    const first = await owner.write({ ...create(), definition: { ...definition(), caseIds: [caseId, secondCaseId] } });
    await owner.write(review(first.entry.id, 1));
    await prisma.testResult.update({ where: { id: resultId }, data: { testCaseId: secondCaseId } });
    await owner.write(review(first.entry.id, 2));
    const detail = await viewer.byId({ projectId, id: first.entry.id });
    expect(detail.decisions[0].evidence[0].available).toBe(true);
    expect(detail.decisions[1].evidence[0]).toMatchObject({ available: false, caseId: null, runId: null, resultId: null });
    expect(detail.decisions[1].decision.resultIds).toEqual([]);
    await prisma.testResult.update({ where: { id: resultId }, data: { testCaseId: caseId } });
  });
  it("withholds foreign native IDs and requires explicit removal of unavailable links", async () => {
    const req = await prisma.requirement.create({ data: { projectId, title: "Moving synthetic requirement" } });
    const first = await owner.write({ ...create(), definition: { ...definition(), requirementIds: [req.id] } });
    await prisma.requirement.update({ where: { id: req.id }, data: { projectId: foreignProject } });
    const loaded = await viewer.byId({ projectId, id: first.entry.id });
    expect(loaded.entry.missingLinks).toBe(1); expect(loaded.entry.definition.requirementIds).toEqual([]);
    expect(JSON.stringify(loaded)).not.toContain(req.id);
    const update = { operation: "UPDATE" as const, projectId, id: first.entry.id, expectedVersion: 1, requestId: randomUUID(),
      definition: { ...definition(), requirementIds: [] }, dropUnavailableLinks: false };
    await expect(owner.write(update)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner.write(review(first.entry.id, 1, []))).rejects.toMatchObject({ code: "CONFLICT" });
    const repaired = await owner.write({ ...update, requestId: randomUUID(), dropUnavailableLinks: true }); expect(repaired.entry.version).toBe(2);
  });
  it("rejects stale cached viewer/editor seats and suspended organization access", async () => {
    await expect(viewer.write(create())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.list({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: editorId } }, data: { seatType: "READ_ONLY" } });
    await expect(editor.write(create())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await editor.list({ projectId })).canWrite).toBe(false);
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: editorId } }, data: { seatType: "FULL" } });
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date() } });
    await expect(owner.list({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: null } });
  });
  it("rolls back entry and stable counter if receipt persistence fails", async () => {
    const before = await prisma.projectQualityRiskState.findUniqueOrThrow({ where: { projectId } });
    const fault = prisma.$extends({ query: { qualityRiskWrite: { async create() { throw Error("Synthetic receipt refusal"); } } } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, include: { memberships: true } });
    const caller = qualityRisksRouter.createCaller({ prisma: fault as unknown as typeof prisma, user });
    const count = await prisma.qualityRiskEntry.count({ where: { projectId } });
    await expect(caller.write(create())).rejects.toThrow();
    expect(await prisma.projectQualityRiskState.findUniqueOrThrow({ where: { projectId } })).toEqual(before);
    expect(await prisma.qualityRiskEntry.count({ where: { projectId } })).toBe(count);
  });
  it("holds linked requirement ownership through decision and exact receipt commit", async () => {
    const req = await prisma.requirement.create({ data: { projectId, title: "Synthetic concurrency requirement" } });
    const input = { ...create(), definition: { ...definition(), requirementIds: [req.id] } };
    let notify!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { notify = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const write = withQualityRiskAccess(prisma, projectId, ownerId, orgId, async (tx, access) => {
      const receipt = await writeQualityRisk(tx, access, input); notify(); await gate; return receipt;
    });
    try {
      await Promise.race([reached, write.then(() => { throw Error("The held review unexpectedly completed before release"); })]);
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '150ms'`);
        await tx.$executeRaw`UPDATE "Requirement" SET "projectId"=${foreignProject} WHERE id=${req.id}`;
      })).rejects.toThrow(/lock timeout/i);
    } finally { release(); }
    const receipt = await write;
    expect((await viewer.byId({ projectId, id: receipt.entry.id })).entry.links.requirements[0].id).toBe(req.id);
  });
  it("enforces immutable decisions/receipts and stable entry identity in PostgreSQL", async () => {
    const first = await owner.write(create()), request = review(first.entry.id, 1, []), receipt = await owner.write(request);
    await expect(prisma.qualityRiskDecision.update({ where: { id: receipt.decisionId! }, data: { createdById: "forged" } })).rejects.toThrow();
    await expect(prisma.qualityRiskDecision.delete({ where: { id: receipt.decisionId! } })).rejects.toThrow();
    await expect(prisma.qualityRiskEntry.update({ where: { id: first.entry.id }, data: { displayId: "forged", version: 3 } })).rejects.toThrow();
    const ack = await prisma.qualityRiskWrite.findUniqueOrThrow({ where: { projectId_actorId_requestId: { projectId, actorId: ownerId, requestId: request.requestId } } });
    await expect(prisma.qualityRiskWrite.delete({ where: { id: ack.id } })).rejects.toThrow();
    await expect(prisma.projectQualityRiskState.update({ where: { projectId }, data: { organizationId: foreignOrg } })).rejects.toThrow();
  });
  it("pages stable register numbers and never returns procedure/source or current-score fields", async () => {
    for (let n = 0; n < 52; n++) await owner.write({ ...create(), definition: { ...definition(), title: `Page synthetic ${n}` } });
    const first = await viewer.list({ projectId, offset: 0 }), second = await viewer.list({ projectId, offset: 50 });
    expect(first.items).toHaveLength(50); expect(first.hasMore).toBe(true);
    expect(new Set([...first.items, ...second.items].map(e => e.id)).size).toBe(first.items.length + second.items.length);
    expect(first.items[0].component).toBe("Synthetic bench"); expect(first.items[0].likelihood).toBe("UNKNOWN");
    for (const row of first.items) { expect(row).not.toHaveProperty("definition"); expect(row).not.toHaveProperty("riskScore"); }
    await expect(viewer.list({ projectId, offset: 951 })).rejects.toThrow();
    expect((await viewer.lookup({ projectId, kind: "CASE", search: "%" })).items).toEqual([]);
    expect((await viewer.lookup({ projectId, kind: "RESULT", search: "" })).items.some(e => e.id === foreignResult)).toBe(false);
  });
  it("reparenting cannot expose original-tenant risk snapshots or receipts", async () => {
    const request = create(), first = await owner.write(request);
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: foreignOrg } });
    try {
      await expect(owner.byId({ projectId, id: first.entry.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(outsider.byId({ projectId, id: first.entry.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(outsider.list({ projectId })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(outsider.write(request)).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgId } });
    }
  });
});
