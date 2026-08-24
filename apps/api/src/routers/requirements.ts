import { z } from "zod";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

export const requirementsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          externalRef: z.string().nullable(),
          acceptanceCriteriaCount: z.number(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const requirements = await ctx.prisma.requirement.findMany({
        where: { projectId: input.projectId },
        include: { _count: { select: { acceptanceCriteria: true } } },
        orderBy: { createdAt: "desc" },
      });
      return requirements.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        externalRef: r.externalRef,
        acceptanceCriteriaCount: r._count.acceptanceCriteria,
      }));
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
        externalRef: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return ctx.prisma.requirement.create({
        data: {
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          externalRef: input.externalRef,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
        externalRef: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.requirement.findUniqueOrThrow({
        where: { id: input.id },
        select: { projectId: true },
      });
      await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      return ctx.prisma.requirement.update({
        where: { id: input.id },
        data: { title: input.title, description: input.description, externalRef: input.externalRef },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.requirement.findUniqueOrThrow({
        where: { id: input.id },
        select: { projectId: true },
      });
      await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      await ctx.prisma.requirement.delete({ where: { id: input.id } });
    }),
});
