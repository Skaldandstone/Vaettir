import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, prisma } from "@vaettir/db";
import { requirementBaselinesRouter } from "./routers/requirementBaselines.js";
import { hardDeleteOrganization, previewOrgHardDelete } from "./services/orgHardDelete.js";
import { withRequirementBaselineAccess, captureRequirementBaseline } from "./services/requirementBaselines.js";
// SOURCE-ONLY authored fixtures. Requires generated client + new migration on
// a unique synthetic seeded loopback database in the authorized morning run.
describe("reviewed requirement baselines and native change impact", () => {
  let orgId: string, foreignOrg: string, projectId: string, foreignProject: string, ownerId: string, editorId: string, caseId: string;
  let owner: ReturnType<typeof requirementBaselinesRouter.createCaller>, editor: typeof owner, viewer: typeof owner, outsider: typeof owner;
  const orgs: string[] = [], users: string[] = [];
  const requirement = async (title = "Synthetic requirement") => prisma.requirement.create({ data: { projectId, title, description: "Original native intent" } });
  const preview = (requirementId: string) => owner.byId({ projectId, requirementId });
  async function capture(requirementId: string) {
    const current = await preview(requirementId);
    return { projectId, requirementId, requestId: randomUUID(), expectedLatestVersion: current.latestVersion,
      currentFingerprint: current.currentFingerprint!, rationale: "Reviewed synthetic native wording and direct scope",
      acknowledgeNotVerifiedCoverage: true as const };
  }
  async function link(requirementId: string, targetCase = caseId, removed = false) {
    return prisma.caseTraceabilityLink.create({ data: { id: randomUUID(), projectId, caseId: targetCase,
      provider: "requirement", providerOrigin: "vaettir", nativeId: requirementId, kind: "requirement", title: "Synthetic direct coverage declaration",
      requirementId, createdById: ownerId, updatedById: ownerId, removedAt: removed ? new Date() : null } });
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host"))
      throw Error("Unique disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (let n = 0; n < 2; n++) {
      const slug = `requirement-baseline-${randomUUID()}`;
      const org = await prisma.organization.create({ data: { name: slug, slug, planTierId: tier.id } });
      orgs.push(org.id); if (!n) orgId = org.id; else foreignOrg = org.id;
    }
    projectId = (await prisma.project.create({ data: { organizationId: orgId, name: "Synthetic baselines", slug: randomUUID(), caseKey: "syn" } })).id;
    foreignProject = (await prisma.project.create({ data: { organizationId: foreignOrg, name: "Foreign synthetic", slug: randomUUID() } })).id;
    for (const role of ["OWNER", "EDITOR", "VIEWER", "OUTSIDER"] as const) {
      const user = await prisma.user.create({ data: { email: `baseline-${randomUUID()}@example.com`, clerkUserId: randomUUID(),
        memberships: { create: { organizationId: role === "OUTSIDER" ? foreignOrg : orgId,
          role: role === "OUTSIDER" ? "EDITOR" : role, seatType: "FULL" } } }, include: { memberships: true } });
      users.push(user.id); const caller = requirementBaselinesRouter.createCaller({ prisma, user });
      if (role === "OWNER") { owner = caller; ownerId = user.id; } else if (role === "EDITOR") { editor = caller; editorId = user.id; }
      else if (role === "VIEWER") viewer = caller; else outsider = caller;
    }
    caseId = (await prisma.testCase.create({ data: { projectId, title: "Synthetic mitigation " + "long label ".repeat(20),
      given: [], when: [], then: [], tags: [], testType: "FUNCTIONAL" } })).id;
    await prisma.caseTraceabilityState.create({ data: { projectId, organizationId: orgId } });
  });
  afterAll(async () => {
    for (const id of orgs) {
      const before = await previewOrgHardDelete(prisma, id), erased = await hardDeleteOrganization(prisma, id, ownerId, "Owned synthetic requirement baseline fixtures");
      for (const model of ["ProjectRequirementBaselineState", "RequirementBaseline", "RequirementBaselineWrite"])
        expect(erased.rowCounts[model]).toBe(before.rowCounts[model]);
      expect(await prisma.projectRequirementBaselineState.count({ where: { organizationId: id } })).toBe(0);
    }
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: { in: orgs }, deletedById: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  it("captures direct native links only, preserving native text and case records", async () => {
    const req = await requirement(); await link(req.id);
    const before = await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } });
    const input = await capture(req.id), receipt = await owner.capture(input);
    expect(receipt.displayId).toMatch(/^syn-B\d{5}$/);
    const loaded = await viewer.byId({ projectId, requirementId: req.id });
    expect(loaded.comparison.status).toBe("UNCHANGED_RECORDED_SCOPE"); expect(loaded.currentDirectCases).toBe(1);
    expect(loaded.affected.items[0]).toMatchObject({ caseId, wasLinked: true, isLinked: true, titleIsExcerpt: true });
    expect(loaded.current?.description).toBe("Original native intent");
    expect(loaded.limits.some(limit => limit.includes("not inferred as direct test coverage"))).toBe(true);
    expect(await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } })).toEqual(before);
    expect(await prisma.requirement.findUniqueOrThrow({ where: { id: req.id } })).toEqual(req);
  });
  it("never mistakes every case in an acceptance-criterion plan for direct verified coverage", async () => {
    const req = await requirement("Synthetic plan-only requirement");
    const type = await prisma.testPlanType.findFirstOrThrow();
    const plan = await prisma.testPlan.create({ data: { projectId, testPlanTypeId: type.id, name: "Synthetic plan-only scope" } });
    await prisma.acceptanceCriterion.create({ data: { testPlanId: plan.id, requirementId: req.id, description: "Synthetic human criterion", status: "MET" } });
    await prisma.testCase.create({ data: { projectId, testPlanId: plan.id, title: "Not explicitly linked to requirement",
      given: [], when: [], then: [], tags: [], testType: "FUNCTIONAL" } });
    const current = await preview(req.id);
    expect(current.currentDirectCases).toBe(0); expect(current.affected.items).toEqual([]);
    await owner.capture(await capture(req.id));
    expect((await preview(req.id)).capturedDirectCases).toBe(0);
  });
  it("detects wording changes, retains earlier baseline and refuses stale preview fingerprint", async () => {
    const req = await requirement(); await link(req.id);
    const first = await owner.capture(await capture(req.id));
    const stale = await capture(req.id);
    await prisma.requirement.update({ where: { id: req.id }, data: { description: "Changed human intent" } });
    await expect(owner.capture(stale)).rejects.toMatchObject({ code: "CONFLICT" });
    const changed = await preview(req.id); expect(changed.comparison.changedFields).toContain("description");
    expect(changed.comparison.status).toBe("CHANGED_REVIEW_REQUIRED"); expect(changed.affected.items[0].caseId).toBe(caseId);
    const second = await owner.capture(await capture(req.id)); expect(second.version).toBe(2);
    const historical = await viewer.byId({ projectId, baselineId: first.baselineId });
    expect(historical.selectedIsLatest).toBe(false); expect(historical.baseline?.requirement?.description).toBe("Original native intent");
    expect(historical.current?.description).toBe("Changed human intent");
  });
  it("shows added/removed explicit case identities instead of reducing scope to counts", async () => {
    const req = await requirement(); const oldLink = await link(req.id); await owner.capture(await capture(req.id));
    const second = await prisma.testCase.create({ data: { projectId, title: "New synthetic direct case", given: [], when: [], then: [], tags: [], testType: "UNIT" } });
    await prisma.caseTraceabilityLink.update({ where: { id: oldLink.id }, data: { removedAt: new Date() } }); await link(req.id, second.id);
    const changed = await viewer.byId({ projectId, requirementId: req.id });
    expect(changed.comparison.coverageChanged).toBe(true);
    expect(changed.affected.items.find(c => c.caseId === caseId)).toMatchObject({ wasLinked: true, isLinked: false });
    expect(changed.affected.items.find(c => c.caseId === second.id)).toMatchObject({ wasLinked: false, isLinked: true });
  });
  it("recovers exact response-loss requests once, preserving actor scope and CAS", async () => {
    const req = await requirement(), input = await capture(req.id), first = await owner.capture(input);
    expect(await owner.capture(input)).toEqual(first);
    await expect(owner.capture({ ...input, rationale: "Different payload" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(editor.capture(input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.requirementBaselineWrite.count({ where: { projectId, actorId: ownerId, requestId: input.requestId } })).toBe(1);
    expect(await prisma.requirementBaseline.count({ where: { projectId, requirementId: req.id } })).toBe(1);
  });
  it("concurrent identical requests retain one immutable baseline and durable receipt", async () => {
    const req = await requirement(), input = await capture(req.id);
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => owner.capture(input)));
    expect(attempts.some(a => a.status === "fulfilled")).toBe(true);
    const final = await owner.capture(input); expect(await owner.capture(input)).toEqual(final);
    expect(await prisma.requirementBaseline.count({ where: { projectId, requirementId: req.id } })).toBe(1);
  });
  it("retains deleted requirement history but redacts its unavailable native ID/link", async () => {
    const req = await requirement("Deleted synthetic native requirement"), input = await capture(req.id), first = await owner.capture(input);
    await prisma.requirement.delete({ where: { id: req.id } });
    const loaded = await viewer.byId({ projectId, baselineId: first.baselineId });
    expect(loaded.requirementId).toBeNull(); expect(loaded.current).toBeNull(); expect(loaded.canWrite).toBe(false);
    expect(loaded.comparison.status).toBe("REQUIREMENT_UNAVAILABLE");
    expect(JSON.stringify(loaded)).not.toContain(req.id);
    const row = (await viewer.list({ projectId, search: "Deleted synthetic" })).items[0];
    expect(row.requirementId).toBeNull(); expect(row.baselineId).toBe(first.baselineId);
    expect(await owner.capture(input)).toEqual(first);
  });
  it("withholds credential/query metadata and excludes share tokens while detecting hidden changes", async () => {
    const req = await prisma.requirement.create({ data: { projectId, title: "Synthetic unsafe reference", description: "Native intent",
      externalRef: "https://user:synthetic-secret@example.com/doc?token=synthetic-token", shareToken: randomUUID() } });
    const before = await preview(req.id); expect(before.current?.externalRef).toBeNull(); expect(before.current?.externalRefWithheld).toBe(true);
    expect(JSON.stringify(before)).not.toMatch(/synthetic-secret|synthetic-token|shareToken/);
    const first = await owner.capture(await capture(req.id));
    const stored = await prisma.requirementBaseline.findUniqueOrThrow({ where: { id: first.baselineId } });
    expect(JSON.stringify(stored.snapshot)).not.toMatch(/synthetic-secret|synthetic-token|shareToken/);
    await prisma.requirement.update({ where: { id: req.id }, data: { externalRef: "https://example.com/doc?token=other-synthetic-token" } });
    const changed = await preview(req.id); expect(changed.comparison.withheldMetadataChanged).toBe(true);
    expect(JSON.stringify(changed)).not.toContain("other-synthetic-token");
  });
  it("refuses oversized text/direct populations visibly rather than silently truncating or capturing", async () => {
    const req = await prisma.requirement.create({ data: { projectId, title: "Oversized synthetic", description: "x".repeat(10001) } });
    await expect(preview(req.id)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await prisma.requirementBaseline.count({ where: { projectId, requirementId: req.id } })).toBe(0);
    await prisma.requirement.update({ where: { id: req.id }, data: { description: "Within scope" } });
    for (let n = 0; n < 41; n++) await link(req.id);
    await expect(preview(req.id)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await prisma.caseTraceabilityLink.updateMany({ where: { projectId, requirementId: req.id }, data: { removedAt: new Date() } });
  });
  it("checks current full seats, suspension and original tenant despite cached user context", async () => {
    const req = await requirement(), input = await capture(req.id);
    await expect(viewer.capture(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.list({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: editorId } }, data: { seatType: "READ_ONLY" } });
    expect((await editor.access({ projectId })).canWrite).toBe(false);
    await expect(editor.capture(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: editorId } }, data: { seatType: "FULL" } });
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date() } });
    await expect(owner.byId({ projectId, requirementId: req.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: null } });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: foreignOrg } });
    await expect(outsider.list({ projectId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgId } });
  });
  it("does not reveal a foreign baseline through an otherwise authorized project handle", async () => {
    const req = await prisma.requirement.create({ data: { projectId: foreignProject, title: "Foreign synthetic baseline" } });
    const current = await outsider.byId({ projectId: foreignProject, requirementId: req.id });
    const receipt = await outsider.capture({ projectId: foreignProject, requirementId: req.id, requestId: randomUUID(),
      currentFingerprint: current.currentFingerprint!, expectedLatestVersion: 0, rationale: "Foreign synthetic review", acknowledgeNotVerifiedCoverage: true });
    await expect(owner.byId({ projectId, baselineId: receipt.baselineId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(owner.byId({ projectId, requirementId: req.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.requirement.delete({ where: { id: req.id } });
  });
  it("rolls back immutable capture and number on receipt failure and denies direct baseline mutation", async () => {
    const req = await requirement(), input = await capture(req.id);
    const before = await prisma.projectRequirementBaselineState.findUniqueOrThrow({ where: { projectId } });
    const fault = prisma.$extends({ query: { requirementBaselineWrite: { async create() { throw Error("Synthetic receipt failure"); } } } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, include: { memberships: true } });
    const caller = requirementBaselinesRouter.createCaller({ prisma: fault as unknown as typeof prisma, user });
    await expect(caller.capture(input)).rejects.toThrow();
    expect(await prisma.projectRequirementBaselineState.findUniqueOrThrow({ where: { projectId } })).toEqual(before);
    expect(await prisma.requirementBaseline.count({ where: { projectId, requirementId: req.id } })).toBe(0);
    const saved = await owner.capture(input);
    await expect(prisma.requirementBaseline.update({ where: { id: saved.baselineId }, data: { rationale: "Forged" } })).rejects.toThrow();
    await expect(prisma.requirementBaseline.delete({ where: { id: saved.baselineId } })).rejects.toThrow();
  });
  it("holds native wording ownership through immutable capture and receipt commit", async () => {
    const req = await requirement(), input = await capture(req.id);
    let notify!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { notify = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writing = withRequirementBaselineAccess(prisma, projectId, ownerId, orgId, async (tx, access) => {
      const receipt = await captureRequirementBaseline(tx, access, input); notify(); await gate; return receipt;
    });
    try {
      await Promise.race([reached, writing.then(() => { throw Error("Held capture unexpectedly completed before release"); })]);
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`SET LOCAL lock_timeout = '150ms'`);
        await tx.$executeRaw`UPDATE "Requirement" SET "projectId"=${foreignProject} WHERE id=${req.id}`;
      })).rejects.toThrow(/lock timeout/i);
    } finally { release(); }
    const receipt = await writing;
    expect((await viewer.byId({ projectId, baselineId: receipt.baselineId })).current?.title).toBe(req.title);
  });
  it("pages affected public identities exactly and current/retained requirement rows without raw bodies", async () => {
    const req = await requirement("Paged synthetic coverage");
    for (let n = 0; n < 23; n++) {
      const c = await prisma.testCase.create({ data: { projectId, title: `Synthetic case ${n}`, given: [], when: [], then: [], tags: [], testType: "UNIT" } });
      await link(req.id, c.id);
    }
    await owner.capture(await capture(req.id));
    const first = await viewer.byId({ projectId, requirementId: req.id, affectedOffset: 0 });
    const second = await viewer.byId({ projectId, requirementId: req.id, affectedOffset: 20 });
    expect(first.affected.items).toHaveLength(20); expect(second.affected.items).toHaveLength(3);
    expect(new Set([...first.affected.items, ...second.affected.items].map(c => c.caseId)).size).toBe(23);
    for (let n = 0; n < 23; n++) await requirement(`Page register fixture ${n}`);
    const page1 = await viewer.list({ projectId, search: "Page register fixture", offset: 0 });
    const page2 = await viewer.list({ projectId, search: "Page register fixture", offset: 20 });
    expect(page1.items).toHaveLength(20); expect(page2.items).toHaveLength(3);
    expect(page1.items.every(row => !("snapshot" in row) && !("description" in row))).toBe(true);
    await expect(viewer.list({ projectId, offset: 981 })).rejects.toThrow();
    expect((await viewer.list({ projectId, search: "%" })).items).toEqual([]);
    expect(await prisma.requirement.count({ where: { projectId: foreignProject } })).toBe(0);
  });
});
