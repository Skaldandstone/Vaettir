import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@vaettir/db";
const model = vi.hoisted(() => vi.fn());
const legacy = vi.hoisted(() => vi.fn());
vi.mock("@vaettir/ai-agent", async () => ({ ...await vi.importActual<typeof import("@vaettir/ai-agent")>("@vaettir/ai-agent"), suggestCaseOrganization: model, recommendImportTypes: legacy }));
import { appRouter } from "../router.js";
import { applySmartRecommendations, smartRecommendations, smartSuggestionConfiguration, smartSuggestionsEnabled } from "./smartCaseSuggestions.js";
const run = `smart-review-${randomUUID()}`;
let orgId: string | undefined, userId: string | undefined, projectId: string | undefined;
const caseIds: string[] = [];
const clerk = `${run}-actor`;
const scope = () => ({ projectId: projectId!, originalOrganizationId: orgId!, expectedClerkActorId: clerk, expectedPolicyVersion: 1 });
const selection = (id: string) => ({ id, suitePath: true, priority: true, testType: false });
async function review(ids = [caseIds[0]!]) {
  return smartRecommendations(prisma, userId!, clerk, { ...scope(), requestId: randomUUID(), approved: true, caseIds: ids });
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "http://missing");
  if (!["localhost", "127.0.0.1", "postgres"].includes(url.hostname) || !/test/i.test(url.pathname)) throw new Error("A disposable local test database is required.");
  process.env.VAETTIR_SMART_SUGGESTIONS_PROJECTS = "*";
  const tier = await prisma.planTier.findFirstOrThrow();
  orgId = (await prisma.organization.create({ data: { name: run, slug: run, planTierId: tier.id } })).id;
  userId = (await prisma.user.create({ data: { clerkUserId: clerk, email: `${run}@example.invalid` } })).id;
  await prisma.membership.create({ data: { organizationId: orgId, userId, role: "OWNER", seatType: "FULL" } });
  projectId = (await prisma.project.create({ data: { organizationId: orgId, name: "Synthetic suggestion review", slug: run } })).id;
  for (const title of ["Restore purchase", "Avoid duplicate charge"]) caseIds.push((await prisma.testCase.create({ data: { projectId, title, given: ["Purchased access"], when: ["Restore"], then: ["Access retained"], tags: [], testType: "OTHER", priority: "MEDIUM", suitePath: "Misplaced", steps: { create: { order: 0, action: "Restore purchase", expectedResult: "Access retained" } } } })).id);
  await prisma.aiDisclosurePolicy.create({ data: { projectId: projectId!, organizationId: orgId!, classification: "SYNTHETIC", version: 1, updatedByUserId: userId! } });
  model.mockImplementation(async cases => cases.map((c: { id: string }) => ({ id: c.id, suitePath: "Billing/Restore", priority: "HIGH", testType: "FUNCTIONAL", confidence: "HIGH", reason: "Restore purchased access without charging twice.", evidence: ["Access retained"] })));
});
afterAll(async () => {
  // Never pass an unset scope into a cleanup query after setup failure.
  if (projectId) {
    await prisma.auditLog.deleteMany({ where: { projectId } });
    await prisma.testCaseVersion.deleteMany({ where: { testCase: { projectId } } });
    await prisma.testCaseStep.deleteMany({ where: { testCase: { projectId } } });
    await prisma.testCaseSource.deleteMany({ where: { testCase: { projectId } } });
    await prisma.testCase.deleteMany({ where: { projectId } });
    await prisma.caseFolderState.deleteMany({ where: { projectId } });
    await prisma.aiDisclosurePolicy.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } });
  }
  if (orgId) { await prisma.membership.deleteMany({ where: { organizationId: orgId } }); await prisma.organization.delete({ where: { id: orgId } }); }
  if (userId) await prisma.user.delete({ where: { id: userId } });
  delete process.env.VAETTIR_SMART_SUGGESTIONS_PROJECTS;
});
describe("reviewed organization suggestions on real PostgreSQL", () => {
  it("keeps rollout disabled by default and permits only the selected sandbox until global rollout", () => {
    delete process.env.VAETTIR_SMART_SUGGESTIONS_PROJECTS;
    expect(smartSuggestionsEnabled("a")).toBe(false);
    process.env.VAETTIR_SMART_SUGGESTIONS_PROJECTS = "*";
    expect(smartSuggestionsEnabled("a", "[]")).toBe(false);
    expect(smartSuggestionsEnabled("a", '["b"]')).toBe(false);
    expect(smartSuggestionsEnabled("a", '["a"]')).toBe(true);
    expect(smartSuggestionsEnabled("a", "broken")).toBe(false);
  });
  it("refuses the old automatic upload-analysis endpoint without invoking the provider", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } });
    const caller = appRouter.createCaller({ prisma, user, authenticatedClerkSubject: clerk });
    await expect(caller.importJobs.startTypeAnalysis({ projectId: projectId!, requestId: randomUUID(), cases: [{ id: "row-2", title: "Restore purchase", given: [], when: ["Restore"], then: ["Access retained"], tags: [] }] })).rejects.toThrow("replaced by reviewed smart suggestions");
    expect(legacy).not.toHaveBeenCalled();
  });
  it("blocks regulated/unclassified projects, stale classification approval and non-admin processing", async () => {
    const calls = model.mock.calls.length;
    for (const classification of ["REGULATED", "UNCLASSIFIED"]) {
      await prisma.aiDisclosurePolicy.update({ where: { projectId }, data: { classification } });
      await expect(review()).rejects.toThrow("cannot use this analysis");
    }
    await prisma.aiDisclosurePolicy.update({ where: { projectId }, data: { classification: "SYNTHETIC", version: 2 } });
    await expect(review()).rejects.toThrow("classification changed");
    await prisma.aiDisclosurePolicy.update({ where: { projectId }, data: { version: 1 } });
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId!, userId: userId! } }, data: { role: "EDITOR" } });
    await expect(review()).rejects.toThrow("Owner or Admin");
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId!, userId: userId! } }, data: { role: "OWNER" } });
    expect(model.mock.calls.length).toBe(calls);
  });
  it("previews complete selected procedures and existing hierarchy without case or audit writes", async () => {
    const before = await prisma.testCase.findUniqueOrThrow({ where: { id: caseIds[0] } });
    const result = await review();
    expect(result.before[0]).toMatchObject({ id: caseIds[0], suitePath: "Misplaced", priority: "MEDIUM" });
    expect(model.mock.calls.at(-1)![0][0].when).toContain("Restore purchase");
    expect(model.mock.calls.at(-1)![1]).toContain("Misplaced");
    expect(await prisma.testCase.findUniqueOrThrow({ where: { id: caseIds[0] } })).toEqual(before);
    expect(await prisma.auditLog.count({ where: { projectId } })).toBe(0);
  });
  it("saves selected fields, nested suites, history and a durable exact-retry receipt atomically", async () => {
    const r = await review(), input = { ...scope(), requestId: randomUUID(), reviewIds: [r.reviewId], approved: true as const, selections: [selection(caseIds[0]!)] };
    const results = await Promise.all([applySmartRecommendations(prisma, userId!, clerk, input), applySmartRecommendations(prisma, userId!, clerk, input)]);
    expect(results.every(r => r.changed === 1)).toBe(true);
    expect(results.filter(r => r.replayed)).toHaveLength(1);
    const saved = await prisma.testCase.findUniqueOrThrow({ where: { id: caseIds[0] }, include: { steps: true } });
    expect(saved).toMatchObject({ suitePath: "Billing/Restore", priority: "HIGH", testType: "OTHER", then: ["Access retained"] });
    expect(saved.steps[0]!.action).toBe("Restore purchase");
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: saved.id } })).toBe(1);
    const folders = await prisma.caseFolderState.findUniqueOrThrow({ where: { projectId } });
    expect(folders.folders).toEqual(expect.arrayContaining([expect.objectContaining({ path: "Billing" }), expect.objectContaining({ path: "Billing/Restore" })]));
    await expect(applySmartRecommendations(prisma, userId!, clerk, { ...input, selections: [{ ...input.selections[0]!, testType: true }] })).rejects.toThrow("different reviewed changes");
  });
  it("refuses a stale case rather than replacing a newer manual decision", async () => {
    const r = await review([caseIds[1]!]);
    await prisma.testCase.update({ where: { id: caseIds[1] }, data: { priority: "CRITICAL" } });
    await expect(applySmartRecommendations(prisma, userId!, clerk, { ...scope(), requestId: randomUUID(), reviewIds: [r.reviewId], approved: true, selections: [selection(caseIds[1]!)] })).rejects.toThrow("changed after analysis");
    expect(await prisma.testCase.findUniqueOrThrow({ where: { id: caseIds[1] } })).toMatchObject({ suitePath: "Misplaced", priority: "CRITICAL" });
  });
  it("uses effective source-derived placement and rejects a source-only move after review", async () => {
    const item = await prisma.testCase.create({ data: { projectId: projectId!, title: "Legacy source case", given: [], when: ["Restore"], then: ["Access retained"], tags: [], testType: "OTHER", priority: "MEDIUM", source: { create: { filePath: "Billing", framework: "synthetic" } } } });
    await prisma.testCase.create({ data: { projectId: projectId!, title: "Keep other suite present", given: [], when: [], then: [], tags: [], testType: "OTHER", suitePath: "Accounts" } });
    const r = await review([item.id]);
    expect(r.before[0]!.suitePath).toBe("Billing");
    await prisma.testCaseSource.update({ where: { testCaseId: item.id }, data: { filePath: "Accounts" } });
    await expect(applySmartRecommendations(prisma, userId!, clerk, { ...scope(), requestId: randomUUID(), reviewIds: [r.reviewId], approved: true, selections: [selection(item.id)] })).rejects.toThrow("changed after analysis");
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: item.id } })).suitePath).toBeNull();
  });
  it("reviews legacy imported labels without normalizing provenance or relaxing writable folders", async () => {
    const legacyPath = "Legacy Sheet / Unsorted";
    const item = await prisma.testCase.create({ data: { projectId: projectId!, title: "Legacy restore case", given: [], when: ["Restore"], then: ["Access retained"], tags: [], testType: "OTHER", priority: "MEDIUM", source: { create: { filePath: legacyPath, framework: "synthetic" } } } });
    const r = await review([item.id]);
    expect(r.before[0]!.suitePath).toBe(legacyPath);
    expect(r.legacySuitePaths).toContain(legacyPath);
    expect(r.knownSuites).not.toContain(legacyPath);
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: item.id } })).suitePath).toBeNull();
    await applySmartRecommendations(prisma, userId!, clerk, { ...scope(), requestId: randomUUID(), reviewIds: [r.reviewId], approved: true, selections: [selection(item.id)] });
    expect(await prisma.testCase.findUniqueOrThrow({ where: { id: item.id }, include: { source: true } })).toMatchObject({ suitePath: "Billing/Restore", source: { filePath: legacyPath } });
    const folders = await prisma.caseFolderState.findUniqueOrThrow({ where: { projectId } });
    expect(JSON.stringify(folders.folders)).not.toContain(legacyPath);
    // Invalid explicit folder state still refuses analysis; it is not treated as
    // an old imported label and never replaced with an empty/default tree.
    await prisma.caseFolderState.update({ where: { projectId }, data: { folders: [{ id: "invalid", path: legacyPath }] } });
    try { await expect(review([item.id])).rejects.toThrow("Stored folder definitions need repair"); }
    finally { await prisma.caseFolderState.update({ where: { projectId }, data: { folders: folders.folders! } }); }
  });
  it("keeps one receipt for concurrent unchanged selections", async () => {
    await prisma.testCase.update({ where: { id: caseIds[0] }, data: { suitePath: "Billing/Restore", priority: "HIGH" } });
    const r = await review([caseIds[0]!]);
    const versions = await prisma.testCaseVersion.count({ where: { testCaseId: caseIds[0] } });
    const input = { ...scope(), requestId: randomUUID(), reviewIds: [r.reviewId], approved: true as const, selections: [{ id: caseIds[0]!, suitePath: true, priority: false, testType: false }] };
    let entered = 0;
    let release!: () => void;
    const bothSnapshots = new Promise<void>(resolve => { release = resolve; });
    const pinned = prisma.$extends({ query: { project: { async findUnique({ args, query }) {
      const result = await query(args);
      if (args.where.id === projectId && args.select?.organizationId && entered < 2) {
        entered++; if (entered === 2) release(); await bothSnapshots;
      }
      return result;
    } } } }) as unknown as typeof prisma;
    const results = await Promise.all([applySmartRecommendations(pinned, userId!, clerk, input), applySmartRecommendations(pinned, userId!, clerk, input)]);
    expect(entered).toBe(2);
    expect(results.every(result => result.changed === 0)).toBe(true);
    expect(results.filter(result => result.replayed).length).toBe(1);
    expect(await prisma.auditLog.count({ where: { projectId, entityType: "SmartCaseSuggestionReceipt", entityId: input.requestId } })).toBe(1);
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: caseIds[0] } })).toBe(versions);
  });
  it("admits only one payload when an unchanged and a changed selection share a concurrent UUID", async () => {
    await prisma.testCase.update({ where: { id: caseIds[0] }, data: { suitePath: "Billing/Restore", priority: "HIGH", testType: "OTHER" } });
    const r = await review([caseIds[0]!]), versions = await prisma.testCaseVersion.count({ where: { testCaseId: caseIds[0] } });
    const unchanged = { ...scope(), requestId: randomUUID(), reviewIds: [r.reviewId], approved: true as const, selections: [{ id: caseIds[0]!, suitePath: true, priority: false, testType: false }] };
    const changed = { ...unchanged, selections: [{ ...unchanged.selections[0]!, testType: true }] };
    let entered = 0;
    let release!: () => void;
    const bothSnapshots = new Promise<void>(resolve => { release = resolve; });
    const pinned = prisma.$extends({ query: { project: { async findUnique({ args, query }) {
      const result = await query(args);
      if (args.where.id === projectId && args.select?.organizationId && entered < 2) {
        entered++; if (entered === 2) release(); await bothSnapshots;
      }
      return result;
    } } } }) as unknown as typeof prisma;
    const results = await Promise.allSettled([applySmartRecommendations(pinned, userId!, clerk, unchanged), applySmartRecommendations(pinned, userId!, clerk, changed)]);
    expect(entered).toBe(2);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ code: "CONFLICT" });
    expect(await prisma.auditLog.count({ where: { projectId, entityType: "SmartCaseSuggestionReceipt", entityId: unchanged.requestId } })).toBe(1);
    const winner = results.find(result => result.status === "fulfilled");
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: caseIds[0] } })).toBe(versions + (winner?.status === "fulfilled" ? winner.value.changed : 0));
  });
  it("rolls back earlier case, version, folder and audit writes when a later write fails", async () => {
    for (const id of caseIds) await prisma.testCase.update({ where: { id }, data: { suitePath: "Before review", priority: "MEDIUM" } });
    const r = await review(caseIds), before = await prisma.testCaseVersion.count({ where: { testCase: { projectId } } }), audits = await prisma.auditLog.count({ where: { projectId } });
    const name = "smart_fault_" + randomUUID().replaceAll("-", "");
    expect(caseIds[1]).toMatch(/^[a-z0-9]+$/);
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${caseIds[1]}' THEN RAISE EXCEPTION 'synthetic late write failure'; END IF; RETURN NEW; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE UPDATE ON "TestCase" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
      await expect(applySmartRecommendations(prisma, userId!, clerk, { ...scope(), requestId: randomUUID(), reviewIds: [r.reviewId], approved: true, selections: caseIds.map(selection) })).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "TestCase"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    }
    expect((await prisma.testCase.findMany({ where: { id: { in: caseIds } } })).every(c => c.suitePath === "Before review" && c.priority === "MEDIUM")).toBe(true);
    expect(await prisma.testCaseVersion.count({ where: { testCase: { projectId } } })).toBe(before);
    expect(await prisma.auditLog.count({ where: { projectId } })).toBe(audits);
  });
  it("checks the whole batch before changes, rejects duplicate/foreign review scope and current revocation", async () => {
    const r = await review(caseIds), input = { ...scope(), requestId: randomUUID(), reviewIds: [r.reviewId], approved: true as const, selections: caseIds.map(selection) };
    const first = await prisma.testCase.findUniqueOrThrow({ where: { id: caseIds[0] } });
    await prisma.testCase.update({ where: { id: caseIds[1] }, data: { title: "Manual updated procedure" } });
    await expect(applySmartRecommendations(prisma, userId!, clerk, input)).rejects.toThrow("changed after analysis");
    expect(await prisma.testCase.findUniqueOrThrow({ where: { id: caseIds[0] } })).toEqual(first);
    const calls = model.mock.calls.length;
    await expect(smartRecommendations(prisma, userId!, "different-session-subject", { ...scope(), requestId: randomUUID(), approved: true, caseIds: [caseIds[0]!] })).rejects.toThrow("original signed-in account");
    await expect(smartRecommendations(prisma, userId!, clerk, { ...scope(), originalOrganizationId: "other-org", requestId: randomUUID(), approved: true, caseIds: [caseIds[0]!] })).rejects.toThrow("workspace changed");
    await expect(review(["foreign-case"])).rejects.toThrow("original project");
    expect(model.mock.calls.length).toBe(calls);
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId!, userId: userId! } }, data: { role: "VIEWER" } });
    await expect(applySmartRecommendations(prisma, userId!, clerk, input)).rejects.toThrow("full editor seat");
    await expect(smartSuggestionConfiguration(prisma, userId!, clerk, scope())).rejects.toThrow("full editor seat");
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId!, userId: userId! } }, data: { role: "OWNER" } });
  });
});
