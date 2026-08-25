import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

const acceptanceCriterionOutput = z.object({
  id: z.string(),
  description: z.string(),
  status: z.string(),
  requirementId: z.string().nullable(),
});

export const testPlansRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          status: z.string(),
          releaseId: z.string().nullable(),
          testPlanType: z.object({ id: z.string(), name: z.string() }),
          acceptanceCriteria: z.array(z.object({ id: z.string() })),
        }),
      ),
    )
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
  types: protectedProcedure
    .output(z.array(z.object({ id: z.string(), key: z.string(), name: z.string(), category: z.string() })))
    .query(({ ctx }) => ctx.prisma.testPlanType.findMany()),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        status: z.string(),
        releaseId: z.string().nullable(),
        customFields: z.record(z.unknown()),
        testPlanType: z.object({
          id: z.string(),
          key: z.string(),
          name: z.string(),
          fieldSchema: z.unknown(),
        }),
        acceptanceCriteria: z.array(acceptanceCriterionOutput),
      }),
    )
    .query(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({
        where: { id: input.id },
        include: { testPlanType: true, acceptanceCriteria: { orderBy: { createdAt: "asc" } } },
      });
      await requireProjectAccess(ctx, plan.projectId);
      return {
        id: plan.id,
        projectId: plan.projectId,
        name: plan.name,
        description: plan.description,
        status: plan.status,
        releaseId: plan.releaseId,
        customFields: plan.customFields as Record<string, unknown>,
        testPlanType: {
          id: plan.testPlanType.id,
          key: plan.testPlanType.key,
          name: plan.testPlanType.name,
          fieldSchema: plan.testPlanType.fieldSchema,
        },
        acceptanceCriteria: plan.acceptanceCriteria,
      };
    }),

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

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED"]),
        customFields: z.record(z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.testPlan.findUniqueOrThrow({
        where: { id: input.id },
        select: { projectId: true },
      });
      await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      return ctx.prisma.testPlan.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description,
          status: input.status,
          customFields: input.customFields as never,
        },
      });
    }),

  setRelease: protectedProcedure
    .input(z.object({ testPlanId: z.string(), releaseId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({
        where: { id: input.testPlanId },
        select: { projectId: true },
      });
      await requireProjectAccess(ctx, plan.projectId, "EDITOR");
      if (input.releaseId) {
        const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
        if (release.projectId !== plan.projectId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That release does not belong to this project" });
        }
      }
      return ctx.prisma.testPlan.update({
        where: { id: input.testPlanId },
        data: { releaseId: input.releaseId },
        select: { id: true, releaseId: true },
      });
    }),

  addAcceptanceCriterion: protectedProcedure
    .input(
      z.object({
        testPlanId: z.string(),
        description: z.string().min(1),
        requirementId: z.string().optional(),
      }),
    )
    .output(acceptanceCriterionOutput)
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({
        where: { id: input.testPlanId },
        select: { projectId: true },
      });
      await requireProjectAccess(ctx, plan.projectId, "EDITOR");
      return ctx.prisma.acceptanceCriterion.create({
        data: {
          testPlanId: input.testPlanId,
          description: input.description,
          requirementId: input.requirementId,
        },
      });
    }),

  updateAcceptanceCriterion: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        description: z.string().min(1),
        status: z.enum(["PENDING", "MET", "NOT_MET", "AT_RISK"]),
        requirementId: z.string().nullable().optional(),
      }),
    )
    .output(acceptanceCriterionOutput)
    .mutation(async ({ ctx, input }) => {
      const criterion = await ctx.prisma.acceptanceCriterion.findUniqueOrThrow({
        where: { id: input.id },
        include: { testPlan: { select: { projectId: true } } },
      });
      await requireProjectAccess(ctx, criterion.testPlan.projectId, "EDITOR");
      return ctx.prisma.acceptanceCriterion.update({
        where: { id: input.id },
        data: { description: input.description, status: input.status, requirementId: input.requirementId },
      });
    }),

  deleteAcceptanceCriterion: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const criterion = await ctx.prisma.acceptanceCriterion.findUniqueOrThrow({
        where: { id: input.id },
        include: { testPlan: { select: { projectId: true } } },
      });
      await requireProjectAccess(ctx, criterion.testPlan.projectId, "EDITOR");
      await ctx.prisma.acceptanceCriterion.delete({ where: { id: input.id } });
    }),
});
