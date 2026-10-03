import { beforeAll, describe, expect, it, vi } from "vitest";
import { reviewTestDesign } from "@vaettir/ai-agent";
vi.mock("@vaettir/ai-agent", async importOriginal => ({ ...await importOriginal<typeof import("@vaettir/ai-agent")>(), reviewTestDesign: vi.fn() }));
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");
describe.skipIf(!isolated)("saved test design reviews", () => {
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let outsider: ReturnType<typeof appRouter.createCaller>;
  let id: string;
  let organizationId: string;
  const result = { summary: "Separate calculation from UI wiring", recommendedLevel: "UNIT" as const, framework: "JEST_VITEST" as const,
    rationale: "The supplied helper calculates the price", improvements: [{ problem: "Broad UI-only check", suggestion: "Table-test rounding boundaries" }],
    proposedSteps: [{action: "Calculate a price with a fractional discount", expectedResult: "Rounded total matches policy"}], retainCoverage: ["Keep a checkout UI integration check"], missingEvidence: [], evidenceRefs: ["test-case"] };
  beforeAll(async () => {
    const key = `design-${Date.now()}`;
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({data:{name:key,slug:key,planTierId:tier.id}}); organizationId = org.id;
    const user = await prisma.user.create({ data:{email:`${key}@example.com`,clerkUserId:key,memberships:{create:{organizationId,role:"OWNER"}}},include:{memberships:true} });
    const read = await prisma.user.create({ data:{email:`${key}-read@example.com`,clerkUserId:`${key}-read`,memberships:{create:{organizationId,role:"VIEWER"}}},include:{memberships:true} });
    const other = await prisma.user.create({ data:{email:`${key}-other@example.com`,clerkUserId:`${key}-other`},include:{memberships:true} });
    owner = appRouter.createCaller({prisma,user}); viewer = appRouter.createCaller({prisma,user:read}); outsider = appRouter.createCaller({prisma,user:other});
    const project = await owner.project.create({organizationId,name:"Synthetic calculation"});
    id = (await owner.testCases.quickCreate({projectId:project.id,title:"Calculate discounted total"})).id;
    await prisma.aiCreditTransaction.create({data:{organizationId,type:"GRANT",amount:100,description:"Synthetic design-review fixture"}});
    vi.mocked(reviewTestDesign).mockResolvedValue(result);
  });
  it("requires tenant access, spending permission and approval", async () => {
    await expect(outsider.testDesign.preview({id})).rejects.toMatchObject({code:"FORBIDDEN"});
    const preview = await owner.testDesign.preview({id});
    await expect(viewer.testDesign.review({id,expectedHash:preview.inputHash,approved:true})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(owner.testDesign.review({id,expectedHash:preview.inputHash,approved:false as true})).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(reviewTestDesign).not.toHaveBeenCalled();
  });
  it("rejects stale previews before charging", async () => {
    await expect(owner.testDesign.review({id,expectedHash:"stale",approved:true})).rejects.toMatchObject({code:"CONFLICT"});
    expect((await owner.testDesign.preview({id})).balance).toBe(100);
  });
  it("saves and reuses paid recommendations without changing the case", async () => {
    const before = await prisma.testCase.findUniqueOrThrow({where:{id}});
    const preview = await owner.testDesign.preview({id});
    const input = {id,expectedHash:preview.inputHash,approved:true as const};
    const outcomes = await Promise.allSettled([owner.testDesign.review(input),owner.testDesign.review(input)]);
    expect(outcomes.some(x=>x.status === "fulfilled")).toBe(true);
    expect(await owner.testDesign.review(input)).toEqual(result);
    expect(reviewTestDesign).toHaveBeenCalledTimes(1);
    const after = await owner.testDesign.preview({id});
    expect(after.balance).toBe(88);
    expect(after.reviews[0]?.content).toEqual(result);
    expect(await prisma.testCase.findUniqueOrThrow({where:{id}})).toEqual(before);
  });
  it("marks prior output stale after a manual edit and preserves it", async () => {
    await prisma.testCase.update({where:{id},data:{title:"Calculate tax as well"}});
    expect((await owner.testDesign.preview({id})).reviews[0]?.stale).toBe(true);
  });
  it("blocks a charged failed request from being charged again", async () => {
    vi.mocked(reviewTestDesign).mockRejectedValueOnce(new Error("provider timeout"));
    const preview = await owner.testDesign.preview({id});
    const input = {id,expectedHash:preview.inputHash,approved:true as const};
    await expect(owner.testDesign.review(input)).rejects.toThrow("provider timeout");
    await expect(owner.testDesign.review(input)).rejects.toMatchObject({code:"CONFLICT"});
    expect((await owner.testDesign.preview({id})).balance).toBe(76);
  });
  it("restricts invitation delivery to workspace admins and reports disabled mail truthfully", async () => {
    vi.stubEnv("SES_TRANSACTIONAL_EMAIL_ENABLED", "false");
    try {
      const member = await prisma.membership.findFirstOrThrow({where:{organizationId,role:"OWNER"}});
      const invitation = await prisma.invitation.create({data:{organizationId,email:"synthetic-invite@example.com",role:"VIEWER",seatType:"READ_ONLY",invitedById:member.userId,expiresAt:new Date(Date.now()+60000)}});
      await expect(viewer.organization.sendPendingInvitation({invitationId:invitation.id})).rejects.toMatchObject({code:"FORBIDDEN"});
      await expect(outsider.organization.sendPendingInvitation({invitationId:invitation.id})).rejects.toMatchObject({code:"FORBIDDEN"});
      expect(await owner.organization.sendPendingInvitation({invitationId:invitation.id})).toEqual({delivery:"NOT_CONFIGURED"});
      const pending = await owner.organization.listInvitations({organizationId});
      expect(pending.find(x=>x.id===invitation.id)?.emailStatus).toBe("RECEIVED");
    } finally { vi.unstubAllEnvs(); }
  });
  it("retains a reservation when the credit ledger outcome is ambiguous", async () => {
    await prisma.testCase.update({where:{id},data:{title:"Check fractional tax"}});
    const preview = await owner.testDesign.preview({id});
    const input = {id,expectedHash:preview.inputHash,approved:true as const};
    // Exercise the actual ledger insertion inside the interactive transaction.
    const ledgerFailure = vi.fn(() => { throw new Error("ledger acknowledgement timeout"); });
    const faultDb = prisma.$extends({ query: { aiCreditTransaction: {
      async create({ args, query }) {
        if (args.data.type === "CONSUMPTION") ledgerFailure();
        return query(args);
      },
    } } });
    const user = await prisma.user.findFirstOrThrow({ where: { memberships: { some: { organizationId, role: "OWNER" } } }, include: { memberships: true } });
    const faultOwner = appRouter.createCaller({ prisma: faultDb as unknown as typeof prisma, user });
    await expect(faultOwner.testDesign.review(input)).rejects.toThrow("ledger acknowledgement timeout");
    expect(ledgerFailure).toHaveBeenCalledTimes(1);
    await expect(owner.testDesign.review(input)).rejects.toMatchObject({code:"CONFLICT"});
    expect((await owner.testDesign.preview({id})).reviews[0]?.status).toBe("NEEDS_RECONCILIATION");
  });
  it("rejects oversized case input before charging or calling AI", async () => {
    const calls = vi.mocked(reviewTestDesign).mock.calls.length;
    await prisma.testCase.update({where:{id},data:{background:"x".repeat(65000)}});
    await expect(owner.testDesign.preview({id})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(owner.testDesign.review({id,expectedHash:"unused",approved:true})).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(vi.mocked(reviewTestDesign).mock.calls.length).toBe(calls);
  });
});
