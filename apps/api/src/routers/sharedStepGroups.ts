import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { TestCaseStepInputSchema } from "@vaettir/core";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

const stepOutputSchema = z.object({
  order: z.number(),
  action: z.string(),
  expectedActionOrData: z.string().nullable(),
  expectedResult: z.string().nullable(),
  expectedResponse: z.string().nullable(),
});

// 2026-08-27 competitor parity audit: shared/reusable step libraries.
// A SharedStepGroup is edited in one place and referenced by any number
// of TestCases (see the schema comment on TestCase.sharedStepGroupId) -
// editing it here changes what every linked case shows, without touching
// the cases themselves.
export const sharedStepGroupsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          steps: z.array(stepOutputSchema),
          usageCount: z.number(),
          updatedAt: z.date(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const groups = await ctx.prisma.sharedStepGroup.findMany({
        where: { projectId: input.projectId },
        include: { _count: { select: { testCases: true } } },
        orderBy: { name: "asc" },
      });
      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        steps: g.steps as never,
        usageCount: g._count.testCases,
        updatedAt: g.updatedAt,
      }));
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1),
        description: z.string().optional(),
        steps: z.array(TestCaseStepInputSchema).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return ctx.prisma.sharedStepGroup.create({
        data: {
          projectId: input.projectId,
          name: input.name,
          description: input.description,
          steps: input.steps.map((s, i) => ({
            order: i,
            action: s.action,
            expectedActionOrData: s.expectedActionOrData ?? null,
            expectedResult: s.expectedResult ?? null,
            expectedResponse: s.expectedResponse ?? null,
          })) as never,
          createdById: ctx.user.id,
        },
        select: { id: true },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        description: z.string().optional(),
        steps: z.array(TestCaseStepInputSchema).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.prisma.sharedStepGroup.findUniqueOrThrow({ where: { id: input.id } });
      await requireProjectAccess(ctx, group.projectId, "EDITOR");
      return ctx.prisma.sharedStepGroup.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description,
          steps: input.steps.map((s, i) => ({
            order: i,
            action: s.action,
            expectedActionOrData: s.expectedActionOrData ?? null,
            expectedResult: s.expectedResult ?? null,
            expectedResponse: s.expectedResponse ?? null,
          })) as never,
        },
        select: { id: true },
      });
    }),

  // A group in use by any TestCase can't be deleted out from under them -
  // unlink every case first (client surfaces the usageCount to explain
  // why the delete is refused).
  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const group = await ctx.prisma.sharedStepGroup.findUniqueOrThrow({
      where: { id: input.id },
      include: { _count: { select: { testCases: true } } },
    });
    await requireProjectAccess(ctx, group.projectId, "EDITOR");
    if (group._count.testCases > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `This step library is used by ${group._count.testCases} test case(s) - unlink them first`,
      });
    }
    await ctx.prisma.sharedStepGroup.delete({ where: { id: input.id } });
    return { deleted: true };
  }),
});
