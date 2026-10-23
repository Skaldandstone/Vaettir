import { createHash } from "node:crypto";
import { assertApprovedAnalysisReservation, isDefinitiveAnalysisSpendRefusal } from "../services/approvedAnalysisSpend.js";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { reviewTestDesign, TestDesignReviewSchema } from "@vaettir/ai-agent";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { AI_OPERATION_COSTS, chargeAiCredits, getAiCreditBalance, meterAiCall, InsufficientAiCreditsError } from "../services/aiCredits.js";

const inputSchema = z.object({ id: z.string(), evidence: z.object({ ref: z.string().trim().min(1).max(500), code: z.string().trim().min(1).max(12000) }).optional() });
const hash = (value: unknown) => {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 64000) throw new TRPCError({ code: "BAD_REQUEST", message: "This case exceeds the review size limit. Split it into focused cases before reviewing." });
  return createHash("sha256").update(serialized).digest("hex");
};
// Explicit selection keeps timestamps and unrelated edits out of cache identity.
const caseSelect = { id: true, projectId: true, title: true, background: true, given: true, when: true, then: true, testType: true, validationDomain: true,
  steps: { orderBy: { order: "asc" as const }, select: { action: true, expectedActionOrData: true, expectedResult: true, expectedResponse: true } },
  sharedStepGroup: { select: { steps: true } },
  source: { select: { filePath: true, framework: true, lastSyncedCommitSha: true } },
} satisfies Prisma.TestCaseSelect;

export const testDesignRouter = router({
  preview: protectedProcedure.input(inputSchema).query(async ({ ctx, input }) => {
    const tc = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.id }, select: caseSelect });
    const { project, membership } = await requireProjectAccess(ctx, tc.projectId);
    const saved = await ctx.prisma.testDesignReview.findMany({ where: { testCaseId: tc.id }, orderBy: { createdAt: "desc" }, take: 10 });
    return { balance: await getAiCreditBalance(ctx.prisma, project.organizationId), cost: AI_OPERATION_COSTS.reviewTestDesign,
      canSpend: membership.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(membership.role),
      inputHash: hash({ caseData: tc, evidence: input.evidence }),
      reviews: saved.map(row => ({ id: row.id, status: row.status, inputHash: row.inputHash, stale: row.caseHash !== hash(tc), evidenceRef: row.evidenceRef, createdAt: row.createdAt,
        content: row.content ? TestDesignReviewSchema.parse(row.content) : null })),
    };
  }),
  review: protectedProcedure.input(inputSchema.extend({ expectedHash: z.string(), approved: z.literal(true) })).mutation(async ({ ctx, input }) => {
    const tc = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.id }, select: caseSelect });
    const { project, membership } = await requireProjectAccess(ctx, tc.projectId, "EDITOR");
    if (membership.seatType !== "FULL") throw new TRPCError({ code: "FORBIDDEN", message: "A full editor seat is required. Ask your workspace administrator for access." });
    const inputHash = hash({ caseData: tc, evidence: input.evidence });
    if (input.expectedHash !== inputHash) throw new TRPCError({ code: "CONFLICT", message: "The case or evidence changed. Review the updated preview before continuing." });
    const existing = await ctx.prisma.testDesignReview.findUnique({ where: { testCaseId_inputHash: { testCaseId: tc.id, inputHash } } });
    if (existing?.content) return TestDesignReviewSchema.parse(existing.content);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "This review was already requested. No new credits were charged. Check its saved status; an interrupted review needs administrator reconciliation." });
    await assertApprovedAnalysisReservation(ctx.prisma,tc.id,inputHash);
    const row = await ctx.prisma.testDesignReview.create({ data: { testCaseId: tc.id, inputHash, caseHash: hash(tc), evidenceRef: input.evidence?.ref, createdById: ctx.user.id } }).catch((e: unknown) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new TRPCError({ code: "CONFLICT", message: "A review for these inputs already exists. Refresh to see it." });
      throw e;
    });
    try {
      const charge = await chargeAiCredits(ctx.prisma, project.organizationId, "reviewTestDesign", `Test design review ${row.id}`);
      const result = await meterAiCall(ctx.prisma, charge, () => reviewTestDesign({ caseData: tc, evidence: input.evidence }));
      await ctx.prisma.testDesignReview.update({ where: { id: row.id }, data: { status: "READY", content: result } });
      return result;
    } catch (error) {
      // Only a definitive balance refusal is safe to retry. A ledger write
      // timeout could have committed: retain its reservation for reconciliation.
      if (error instanceof InsufficientAiCreditsError || isDefinitiveAnalysisSpendRefusal(error)) await ctx.prisma.testDesignReview.delete({ where: { id: row.id } });
      else await ctx.prisma.testDesignReview.update({ where: { id: row.id }, data: { status: "NEEDS_RECONCILIATION" } });
      throw error;
    }
  }),
});
