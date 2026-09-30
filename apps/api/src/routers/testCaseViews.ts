import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";

// Only recognized case-list fields can be persisted. In particular there is
// no arbitrary Prisma where clause or user-supplied query language here.
export const caseViewFiltersSchema = z.object({
  suitePath: z.string().max(240).nullable(),
  search: z.string().trim().max(160),
  type: z.string().max(50).refine(value => ["", "UNIT", "FUNCTIONAL", "CONTRACT", "INSTRUMENTATION", "SMOKE", "SANITY", "REGRESSION", "E2E", "PERFORMANCE", "SECURITY", "ACCESSIBILITY", "EXPLORATORY", "COMPLIANCE", "OTHER"].includes(value)),
  automation: z.string().max(50).refine(value => ["", "MANUAL", "AUTOMATED", "PARTIALLY_AUTOMATED", "NEEDS_AUTOMATION"].includes(value)),
  priority: z.string().max(50).refine(value => ["", "CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(value)),
  review: z.string().max(50).refine(value => ["", "APPROVED", "PENDING_REVIEW", "REJECTED"].includes(value)),
  origin: z.string().max(50).refine(value => ["", "AUTHORED", "AI_REVERSE_ENGINEERED", "IMPORTED"].includes(value)),
  sortBy: z.enum(["updated", "title", "type", "automation", "risk", "priority", "origin", "review", "suite"]),
  sortDescending: z.boolean(),
  showArchived: z.boolean(),
}).strict();

const nameSchema = z.string().trim().min(1).max(80);
const projectInput = z.object({ projectId: z.string().min(1) });
const viewInput = projectInput.extend({ id: z.string().min(1) });

function viewOutput(row: { id: string; name: string; filters: Prisma.JsonValue; version: number; createdAt: Date; updatedAt: Date }) {
  return { id: row.id, name: row.name, filters: caseViewFiltersSchema.parse(row.filters), version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function uniqueNameError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new TRPCError({ code: "CONFLICT", message: "You already have a view with that name in this project." });
  }
  throw error;
}

export const testCaseViewsRouter = router({
  list: protectedProcedure.input(projectInput).query(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);
    const rows = await ctx.prisma.testCaseView.findMany({
      where: { projectId: input.projectId, userId: ctx.user.id },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 50,
    });
    return rows.map(viewOutput);
  }),
  create: protectedProcedure.input(projectInput.extend({ name: nameSchema, filters: caseViewFiltersSchema })).mutation(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);
    const count = await ctx.prisma.testCaseView.count({ where: { projectId: input.projectId, userId: ctx.user.id } });
    if (count >= 50) throw new TRPCError({ code: "BAD_REQUEST", message: "You can save up to 50 views per project." });
    try {
      const row = await ctx.prisma.testCaseView.create({ data: { projectId: input.projectId, userId: ctx.user.id, name: input.name, filters: input.filters } });
      return viewOutput(row);
    } catch (error) { return uniqueNameError(error); }
  }),
  update: protectedProcedure.input(viewInput.extend({ name: nameSchema, filters: caseViewFiltersSchema, version: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);
    try {
      const changed = await ctx.prisma.testCaseView.updateMany({
        where: { id: input.id, projectId: input.projectId, userId: ctx.user.id, version: input.version },
        data: { name: input.name, filters: input.filters, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new TRPCError({ code: "CONFLICT", message: "This view changed or is no longer available. Refresh before saving." });
      return viewOutput(await ctx.prisma.testCaseView.findUniqueOrThrow({ where: { id: input.id } }));
    } catch (error) { return uniqueNameError(error); }
  }),
  remove: protectedProcedure.input(viewInput.extend({ version: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);
    const removed = await ctx.prisma.testCaseView.deleteMany({ where: { id: input.id, projectId: input.projectId, userId: ctx.user.id, version: input.version } });
    if (removed.count !== 1) throw new TRPCError({ code: "CONFLICT", message: "This view changed or is no longer available. Refresh before deleting." });
    return { deleted: true };
  }),
});
