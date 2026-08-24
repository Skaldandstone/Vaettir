import { z } from "zod";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

export const testPlansRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.testPlan.findMany({
        where: { projectId: input.projectId },
        include: { testPlanType: true, acceptanceCriteria: true },
        orderBy: { updatedAt: "desc" },
      });
    }),

  // Not project-scoped: built-in + org-defined plan types are shared
  // reference data, not something a single project owns.
  types: protectedProcedure.query(({ ctx }) => ctx.prisma.testPlanType.findMany()),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        testPlanTypeId: z.string(),
        name: z.string(),
        description: z.string().optional(),
        customFields: z.record(z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return ctx.prisma.testPlan.create({
        data: {
          projectId: input.projectId,
          testPlanTypeId: input.testPlanTypeId,
          name: input.name,
          description: input.description,
          customFields: input.customFields as never,
        },
      });
    }),
});
