import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");

describe.skipIf(!isolated)("risk-derived priority decisions", () => {
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let outsider: ReturnType<typeof appRouter.createCaller>;
  let caseId: string;
  let adminId: string;

  beforeAll(async () => {
    const key = `priority-decision-${Date.now()}`;
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
    const admin = await prisma.user.create({ data: { email: `${key}@example.com`, clerkUserId: key,
      memberships: { create: { organizationId: org.id, role: "OWNER" } } }, include: { memberships: true } });
    adminId = admin.id;
    const read = await prisma.user.create({ data: { email: `${key}-viewer@example.com`, clerkUserId: `${key}-viewer`,
      memberships: { create: { organizationId: org.id, role: "VIEWER" } } }, include: { memberships: true } });
    const other = await prisma.user.create({ data: { email: `${key}-outside@example.com`, clerkUserId: `${key}-outside` }, include: { memberships: true } });
    owner = appRouter.createCaller({ prisma, user: admin });
    viewer = appRouter.createCaller({ prisma, user: read });
    outsider = appRouter.createCaller({ prisma, user: other });
    const projectId = (await owner.project.create({ organizationId: org.id, name: "Synthetic priority review" })).id;
    caseId = (await owner.testCases.quickCreate({ projectId, title: "Premium account opens billing history" })).id;
  });

  it("does not rewrite an authored priority before risk is assessed and enforces tenant roles", async () => {
    const preview = await owner.testCases.prioritySuggestion({ id: caseId });
    expect(preview).toMatchObject({ currentPriority: "MEDIUM", suggestedPriority: null });
    await expect(outsider.testCases.prioritySuggestion({ id: caseId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.testCases.decidePriority({ id: caseId, mode: "MATCH_RISK", expectedPriority: "MEDIUM",
      expectedRiskSeverity: null, expectedRiskScore: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(viewer.testCases.decidePriority({ id: caseId, mode: "BUSINESS_OVERRIDE", priority: "HIGH",
      rationale: "Premium support commitment", expectedPriority: "MEDIUM", expectedRiskSeverity: null,
      expectedRiskScore: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } })).priority).toBe("MEDIUM");
  });

  it("requires a business rationale and preserves a concurrent human priority edit", async () => {
    await prisma.testCase.update({ where: { id: caseId }, data: { riskSeverity: "LOW", riskScore: 18, riskAssessedAt: new Date() } });
    const preview = await owner.testCases.prioritySuggestion({ id: caseId });
    expect(preview).toMatchObject({ currentPriority: "MEDIUM", suggestedPriority: "LOW" });
    await expect(owner.testCases.decidePriority({ id: caseId, mode: "BUSINESS_OVERRIDE", priority: "HIGH",
      expectedPriority: preview.currentPriority, expectedRiskSeverity: preview.riskSeverity,
      expectedRiskScore: preview.riskScore })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await prisma.testCase.update({ where: { id: caseId }, data: { priority: "CRITICAL" } });
    await expect(owner.testCases.decidePriority({ id: caseId, mode: "MATCH_RISK", expectedPriority: preview.currentPriority,
      expectedRiskSeverity: preview.riskSeverity, expectedRiskScore: preview.riskScore })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } })).priority).toBe("CRITICAL");
  });

  it("records the explicit override and a later choice to match risk without duplicate winners", async () => {
    const preview = await owner.testCases.prioritySuggestion({ id: caseId });
    const reason = "Premium customers must complete billing before renewal.";
    const versionsBefore = await prisma.testCaseVersion.count({ where: { testCaseId: caseId } });
    expect(await owner.testCases.decidePriority({ id: caseId, mode: "BUSINESS_OVERRIDE", priority: "HIGH", rationale: reason,
      expectedPriority: preview.currentPriority, expectedRiskSeverity: preview.riskSeverity,
      expectedRiskScore: preview.riskScore })).toEqual({ priority: "HIGH" });
    const override = await owner.testCases.prioritySuggestion({ id: caseId });
    expect(override).toMatchObject({ currentPriority: "HIGH", suggestedPriority: "LOW",
      latestDecision: { mode: "BUSINESS_OVERRIDE", rationale: reason, to: "HIGH" } });
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: caseId } })).toBe(versionsBefore + 1);
    const attempts = await Promise.allSettled([
      owner.testCases.decidePriority({ id: caseId, mode: "MATCH_RISK", expectedPriority: "HIGH",
        expectedRiskSeverity: "LOW", expectedRiskScore: 18 }),
      owner.testCases.decidePriority({ id: caseId, mode: "BUSINESS_OVERRIDE", priority: "CRITICAL",
        rationale: "Executive release commitment requires immediate validation.", expectedPriority: "HIGH",
        expectedRiskSeverity: "LOW", expectedRiskScore: 18 }),
    ]);
    expect(attempts.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(item => item.status === "rejected")).toHaveLength(1);
    const final = await owner.testCases.prioritySuggestion({ id: caseId });
    expect(["LOW", "CRITICAL"]).toContain(final.currentPriority);
    expect(final.latestDecision?.to).toBe(final.currentPriority);
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: caseId } })).toBe(versionsBefore + 2);
  });

  it("rejects a stale full-form save rather than overwriting a newer priority decision", async () => {
    const opened = await owner.testCases.prioritySuggestion({ id: caseId });
    const next = opened.currentPriority === "HIGH" ? "CRITICAL" : "HIGH";
    await owner.testCases.decidePriority({ id: caseId, mode: "BUSINESS_OVERRIDE", priority: next,
      rationale: "Revenue-critical renewal verification must run first.",
      expectedPriority: opened.currentPriority, expectedRiskSeverity: opened.riskSeverity,
      expectedRiskScore: opened.riskScore });
    const staleForm = { id: caseId, expectedPriority: opened.currentPriority,
      expectedSuitePath: null, title: "Premium account opens updated billing history",
      given: ["a premium member has signed in"], when: ["they open billing history"],
      then: ["the renewal appears"], tags: [], testType: "FUNCTIONAL", priority: opened.currentPriority };
    await expect(owner.testCases.update(staleForm)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner.testCases.update({ ...staleForm, expectedPriority: undefined })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await owner.testCases.prioritySuggestion({ id: caseId })).currentPriority).toBe(next);
    await expect(owner.testCases.update({ ...staleForm, expectedPriority: next, priority: next })).resolves.toMatchObject({ priority: next });
  });

  it("does not recommend or accept an old paid risk review after the case changes", async () => {
    const current = await prisma.testCase.findUniqueOrThrow({ where: { id: caseId }, include: { source: { select: { filePath: true } } } });
    const hash = createHash("sha256").update(JSON.stringify({ title: current.title, given: current.given,
      when: current.when, then: current.then, testType: current.testType,
      sourceFilePath: current.source?.filePath ?? null })).digest("hex");
    await prisma.testCaseRiskReview.create({ data: { testCaseId: caseId, inputHash: hash, status: "READY",
      content: { severity: "LOW", riskScore: 18, rationale: "Synthetic reviewed case" }, createdById: adminId } });
    expect((await owner.testCases.prioritySuggestion({ id: caseId })).riskNeedsReview).toBe(false);
    await prisma.testCase.update({ where: { id: caseId }, data: { title: "Premium billing history has changed" } });
    const preview = await owner.testCases.prioritySuggestion({ id: caseId });
    expect(preview).toMatchObject({ riskNeedsReview: true, suggestedPriority: null });
    await expect(owner.testCases.decidePriority({ id: caseId, mode: "MATCH_RISK",
      expectedPriority: preview.currentPriority, expectedRiskSeverity: preview.riskSeverity,
      expectedRiskScore: preview.riskScore })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } })).priority).toBe(preview.currentPriority);
  });
});
