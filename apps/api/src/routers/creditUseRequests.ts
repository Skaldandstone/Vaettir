import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { router, protectedProcedure, requireOrgRole, requireProjectAccess, requireNotSuspended } from "../trpc.js";
import { AI_OPERATION_COSTS } from "../services/aiCredits.js";

const actionSchema = z.enum(["RISK", "TYPE_DESIGN"]);
const idsSchema = z.array(z.string().min(1)).min(1).max(20).refine(ids => new Set(ids).size === ids.length, "Duplicate case IDs are not allowed");
const perCaseCost = (action: z.infer<typeof actionSchema>) => action === "RISK" ? AI_OPERATION_COSTS.assessTestCaseRisk : AI_OPERATION_COSTS.reviewTestDesign;

async function liveCreditAdmin(tx: Prisma.TransactionClient, organizationId: string, userId: string, fullSeat = true) {
  // Membership/seat mutations use the same organization row lock. Hold it
  // through the approval write so a stale request context cannot approve.
  const org = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM "Organization" WHERE "id"=${organizationId} FOR UPDATE`;
  const member = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  if (!org[0] || org[0].suspendedAt || !member || (fullSeat && member.seatType !== "FULL") || !["OWNER", "ADMIN"].includes(member.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Current workspace administrator access is required." });
  }
}

export const creditUseRequestsRouter = router({
  create: protectedProcedure.input(z.object({ projectId: z.string(), action: actionSchema, ids: idsSchema, reason: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId);
      const cases = await ctx.prisma.testCase.findMany({ where: { projectId: input.projectId, id: { in: input.ids }, archived: false },
        select: { id: true, riskAssessedAt: true } });
      if (cases.length !== input.ids.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Selection changed. Refresh the case list and try again." });
      if (input.action === "RISK" && cases.some(testCase => testCase.riskAssessedAt !== null)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "One or more cases already have a risk assessment. Refresh the preview and request only new work." });
      }
      const caseIds = [...input.ids].sort();
      const dedupeKey = createHash("sha256").update(JSON.stringify([project.organizationId, input.projectId, ctx.user.id, input.action, caseIds])).digest("hex");
      const existing = await ctx.prisma.aiCreditUseRequest.findUnique({ where: { dedupeKey } });
      if (existing) return { id: existing.id, status: existing.status, estimatedCredits: existing.estimatedCredits };
      const row = await ctx.prisma.$transaction(async tx => {
        const created = await tx.aiCreditUseRequest.create({ data: {
          organizationId: project.organizationId, projectId: input.projectId, requestedById: ctx.user.id,
          action: input.action, caseIds, caseCount: caseIds.length,
          // An upper bound for administrator planning, not a charge reservation.
          // A paid/saved review or changed input can make the eventual charge lower.
          estimatedCredits: caseIds.length * perCaseCost(input.action), reason: input.reason || null, dedupeKey,
        } });
        await tx.auditLog.create({ data: { organizationId: project.organizationId, projectId: input.projectId,
          actorId: ctx.user.id, entityType: "AiCreditUseRequest", entityId: created.id, action: "CREATE",
          summary: `Requested administrator review for ${input.action.toLowerCase().replace("_", "/")} analysis of ${caseIds.length} cases`,
          metadata: { caseCount: caseIds.length, estimatedCredits: created.estimatedCredits },
        } });
        return created;
      }).catch(async error => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return ctx.prisma.aiCreditUseRequest.findUniqueOrThrow({ where: { dedupeKey } });
        }
        throw error;
      });
      return { id: row.id, status: row.status, estimatedCredits: row.estimatedCredits };
    }),

  mine: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);
    return ctx.prisma.aiCreditUseRequest.findMany({ where: { projectId: input.projectId, requestedById: ctx.user.id },
      select: { id: true, action: true, caseCount: true, estimatedCredits: true, status: true, createdAt: true, resolutionNote: true },
      orderBy: { createdAt: "desc" }, take: 20 });
  }),

  adminList: protectedProcedure.input(z.object({ organizationId: z.string() })).query(async ({ ctx, input }) => {
    requireOrgRole(ctx, input.organizationId, "ADMIN");
    await requireNotSuspended(ctx.prisma, input.organizationId);
    return ctx.prisma.$transaction(async tx => {
      await liveCreditAdmin(tx, input.organizationId, ctx.user.id, false);
      const rows = await tx.aiCreditUseRequest.findMany({ where: { organizationId: input.organizationId }, orderBy: { createdAt: "desc" }, take: 100 });
      const userIds = [...new Set(rows.map(row => row.requestedById))];
      const projectIds = [...new Set(rows.map(row => row.projectId))];
      const [users, projects] = await Promise.all([
        tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }),
        tx.project.findMany({ where: { id: { in: projectIds }, organizationId: input.organizationId }, select: { id: true, name: true } }),
      ]);
      const emails = new Map(users.map(user => [user.id, user.email]));
      const names = new Map(projects.map(project => [project.id, project.name]));
      return rows.map(row => ({ id: row.id, projectId: row.projectId, projectName: names.get(row.projectId) ?? "Unavailable project",
        requestedByEmail: emails.get(row.requestedById) ?? "Former member", action: row.action, caseCount: row.caseCount,
        estimatedCredits: row.estimatedCredits, reason: row.reason, status: row.status, resolutionNote: row.resolutionNote, createdAt: row.createdAt }));
    });
  }),

  resolve: protectedProcedure.input(z.object({ organizationId: z.string(), id: z.string(), decision: z.enum(["ACKNOWLEDGED", "DECLINED"]), note: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      await requireNotSuspended(ctx.prisma, input.organizationId);
      return ctx.prisma.$transaction(async tx => {
        await liveCreditAdmin(tx, input.organizationId, ctx.user.id);
        const row = await tx.aiCreditUseRequest.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        const changed = await tx.aiCreditUseRequest.updateMany({ where: { id: row.id, organizationId: input.organizationId, status: "PENDING" },
          data: { status: input.decision, dedupeKey: null, resolvedById: ctx.user.id, resolutionNote: input.note || null, resolvedAt: new Date() } });
        if (!changed.count) throw new TRPCError({ code: "CONFLICT", message: "Request was already reviewed. Refresh the inbox." });
        await tx.auditLog.create({ data: { organizationId: input.organizationId, projectId: row.projectId,
          actorId: ctx.user.id, entityType: "AiCreditUseRequest", entityId: row.id, action: "UPDATE",
          summary: `Marked AI credit request ${input.decision.toLowerCase()}` },
        });
        return { id: row.id, status: input.decision };
      });
    }),
});
