import { beforeAll, describe, expect, it, vi } from "vitest";
import { assessTestCaseRisk } from "@vaettir/ai-agent";
vi.mock("@vaettir/ai-agent", async importOriginal => ({ ...await importOriginal<typeof import("@vaettir/ai-agent")>(), assessTestCaseRisk: vi.fn() }));
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");

describe.skipIf(!isolated)("bulk case analysis authorization and risk reservations", () => {
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let outsider: ReturnType<typeof appRouter.createCaller>;
  let organizationId: string;
  let projectId: string;
  let caseId: string;
  let ownerUserId: string;
  const result = { severity: "HIGH" as const, riskScore: 77, rationale: "A failed checkout calculation would charge the wrong amount." };

  beforeAll(async () => {
    const key = `bulk-analysis-${Date.now()}`;
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { email: `${key}@example.com`, clerkUserId: key, memberships: { create: { organizationId, role: "OWNER" } } }, include: { memberships: true } });
    ownerUserId = user.id;
    const read = await prisma.user.create({ data: { email: `${key}-read@example.com`, clerkUserId: `${key}-read`, memberships: { create: { organizationId, role: "VIEWER" } } }, include: { memberships: true } });
    const other = await prisma.user.create({ data: { email: `${key}-other@example.com`, clerkUserId: `${key}-other` }, include: { memberships: true } });
    owner = appRouter.createCaller({ prisma, user }); viewer = appRouter.createCaller({ prisma, user: read }); outsider = appRouter.createCaller({ prisma, user: other });
    projectId = (await owner.project.create({ organizationId, name: "Synthetic checkout" })).id;
    caseId = (await owner.testCases.quickCreate({ projectId, title: "Calculates discounted checkout total" })).id;
    await prisma.aiCreditTransaction.create({ data: { organizationId, type: "GRANT", amount: 100, description: "Synthetic bulk analysis fixture" } });
    vi.mocked(assessTestCaseRisk).mockResolvedValue(result);
  });

  it("keeps previews and requests within the organization and deduplicates pending requests", async () => {
    await expect(outsider.testCases.riskPreview({ id: caseId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.creditUseRequests.create({ projectId, action: "RISK", ids: [caseId] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.creditUseRequests.create({ projectId, action: "RISK", ids: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const request = await viewer.creditUseRequests.create({ projectId, action: "RISK", ids: [caseId], reason: "Need a checkout review" });
    expect(request.estimatedCredits).toBe(2);
    expect((await viewer.creditUseRequests.create({ projectId, action: "RISK", ids: [caseId] })).id).toBe(request.id);
    expect(await prisma.auditLog.count({ where: { entityType: "AiCreditUseRequest", entityId: request.id, action: "CREATE" } })).toBe(1);
    await expect(viewer.creditUseRequests.adminList({ organizationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await owner.creditUseRequests.adminList({ organizationId }))[0]?.id).toBe(request.id);
    await owner.creditUseRequests.resolve({ organizationId, id: request.id, decision: "ACKNOWLEDGED" });
    expect((await viewer.creditUseRequests.mine({ projectId }))[0]?.status).toBe("ACKNOWLEDGED");
    expect(await prisma.auditLog.count({ where: { entityType: "AiCreditUseRequest", entityId: request.id, action: "UPDATE" } })).toBe(1);
    expect((await viewer.testCases.riskPreview({ id: caseId })).canSpend).toBe(false);
    await expect(viewer.testCases.assessRisk({ id: caseId, expectedHash: "0".repeat(64), approved: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rechecks live full-seat administrator access before resolving a credit request", async () => {
    const request = await viewer.creditUseRequests.create({ projectId, action: "TYPE_DESIGN", ids: [caseId] });
    const key = `readonly-credit-${Date.now()}`;
    const readOnlyUser = await prisma.user.create({ data: { email: `${key}@example.com`, clerkUserId: key,
      memberships: { create: { organizationId, role: "ADMIN", seatType: "READ_ONLY" } } }, include: { memberships: true } });
    const readOnlyAdmin = appRouter.createCaller({ prisma, user: readOnlyUser });
    expect((await readOnlyAdmin.creditUseRequests.adminList({ organizationId })).some(row => row.id === request.id)).toBe(true);
    await expect(readOnlyAdmin.creditUseRequests.resolve({ organizationId, id: request.id, decision: "ACKNOWLEDGED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: ownerUserId } }, data: { role: "VIEWER" } });
    try {
      await expect(owner.creditUseRequests.adminList({ organizationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.creditUseRequests.resolve({ organizationId, id: request.id, decision: "ACKNOWLEDGED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: ownerUserId } }, data: { role: "OWNER" } });
    }
    expect((await prisma.aiCreditUseRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
  });

  it("requires explicit approval and rejects stale previews before any charge", async () => {
    const p = await owner.testCases.riskPreview({ id: caseId });
    expect(p).toMatchObject({ cost: 2, balance: 100, canSpend: true, savedStatus: null });
    await expect(owner.testCases.assessRisk({ id: caseId, expectedHash: p.inputHash, approved: false as true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.testCases.assessRisk({ id: caseId, expectedHash: "0".repeat(64), approved: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await owner.testCases.riskPreview({ id: caseId })).balance).toBe(100);
    expect(assessTestCaseRisk).not.toHaveBeenCalled();
  });

  it("charges once, saves the result, and reuses an identical retry", async () => {
    const p = await owner.testCases.riskPreview({ id: caseId });
    const input = { id: caseId, expectedHash: p.inputHash, approved: true as const };
    const concurrent = await Promise.allSettled([owner.testCases.assessRisk(input), owner.testCases.assessRisk(input)]);
    expect(concurrent.some(item => item.status === "fulfilled")).toBe(true);
    expect(await owner.testCases.assessRisk(input)).toEqual({ riskSeverity: "HIGH", riskScore: 77, riskRationale: result.rationale });
    expect(assessTestCaseRisk).toHaveBeenCalledTimes(1);
    expect((await owner.testCases.riskPreview({ id: caseId })).balance).toBe(98);
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } })).riskScore).toBe(77);
    expect((await owner.testCases.riskReviews({ id: caseId }))[0]).toMatchObject({ severity: "HIGH", riskScore: 77, rationale: result.rationale });
    await expect(outsider.testCases.riskReviews({ id: caseId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.creditUseRequests.create({ projectId, action: "RISK", ids: [caseId] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps an ambiguous charge reservation and never retries the provider blindly", async () => {
    await prisma.testCase.update({ where: { id: caseId }, data: { title: "Calculate checkout after credits" } });
    const p = await owner.testCases.riskPreview({ id: caseId });
    // Query extensions also intercept the interactive transaction delegate;
    // spying on the outer client would not exercise the real debit boundary.
    const ledgerFailure = vi.fn(() => { throw new Error("ledger timeout"); });
    const faultDb = prisma.$extends({ query: { aiCreditTransaction: {
      async create({ args, query }) {
        if (args.data.type === "CONSUMPTION") ledgerFailure();
        return query(args);
      },
    } } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerUserId }, include: { memberships: true } });
    const faultOwner = appRouter.createCaller({ prisma: faultDb as unknown as typeof prisma, user });
    await expect(faultOwner.testCases.assessRisk({ id: caseId, expectedHash: p.inputHash, approved: true })).rejects.toThrow("ledger timeout");
    expect(ledgerFailure).toHaveBeenCalledTimes(1);
    expect((await owner.testCases.riskPreview({ id: caseId })).savedStatus).toBe("NEEDS_RECONCILIATION");
    await expect(owner.testCases.assessRisk({ id: caseId, expectedHash: p.inputHash, approved: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(assessTestCaseRisk).not.toHaveBeenCalled();
  });

  it("retains a paid result without overwriting a human edit made during the provider call", async () => {
    await prisma.testCase.update({ where: { id: caseId }, data: { title: "Compute current checkout amount" } });
    const p = await owner.testCases.riskPreview({ id: caseId });
    vi.mocked(assessTestCaseRisk).mockImplementationOnce(async () => {
      await prisma.testCase.update({ where: { id: caseId }, data: { title: "Human-edited checkout policy" } });
      return result;
    });
    const before = await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } });
    await owner.testCases.assessRisk({ id: caseId, expectedHash: p.inputHash, approved: true });
    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(after.title).toBe("Human-edited checkout policy");
    expect(after.riskAssessedAt).toEqual(before.riskAssessedAt);
    expect((await prisma.testCaseRiskReview.findUniqueOrThrow({ where: { testCaseId_inputHash: { testCaseId: caseId, inputHash: p.inputHash } } })).status).toBe("READY");
  });

  it("preserves a risk-only human override even when the review input is unchanged", async () => {
    await prisma.testCase.update({ where: { id: caseId }, data: { title: "Compute checkout with current tax" } });
    const p = await owner.testCases.riskPreview({ id: caseId });
    vi.mocked(assessTestCaseRisk).mockImplementationOnce(async () => {
      await prisma.testCase.update({ where: { id: caseId }, data: {
        riskSeverity: "LOW", riskScore: 8, riskRationale: "Human business override",
      } });
      return result;
    });
    await owner.testCases.assessRisk({ id: caseId, expectedHash: p.inputHash, approved: true });
    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(after).toMatchObject({ riskSeverity: "LOW", riskScore: 8, riskRationale: "Human business override" });
    expect((await prisma.testCaseRiskReview.findUniqueOrThrow({ where: { testCaseId_inputHash: { testCaseId: caseId, inputHash: p.inputHash } } })).status).toBe("READY");
  });

  it("releases only a definite insufficient-balance reservation", async () => {
    await prisma.testCase.update({ where: { id: caseId }, data: { title: "Calculate checkout balance after refunds" } });
    const p = await owner.testCases.riskPreview({ id: caseId });
    await prisma.aiCreditTransaction.create({ data: { organizationId, type: "ADJUSTMENT", amount: -p.balance, description: "Synthetic zero-balance scenario" } });
    await expect(owner.testCases.assessRisk({ id: caseId, expectedHash: p.inputHash, approved: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.testCaseRiskReview.findUnique({ where: { testCaseId_inputHash: { testCaseId: caseId, inputHash: p.inputHash } } })).toBeNull();
    expect((await owner.testCases.riskPreview({ id: caseId })).balance).toBe(0);
    expect(assessTestCaseRisk).not.toHaveBeenCalled();
  });
});
