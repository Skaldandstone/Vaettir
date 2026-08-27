import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { recordAudit } from "../services/auditLog.js";

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
    .output(
      z.array(
        z.object({
          id: z.string(),
          key: z.string(),
          name: z.string(),
          category: z.string(),
          description: z.string().nullable(),
          fieldSchema: z.unknown(),
          isBuiltIn: z.boolean(),
        }),
      ),
    )
    .query(({ ctx }) => ctx.prisma.testPlanType.findMany({ orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }] })),

  // P3-09: the "add your own compliance form" flow -- an org admin builds a
  // new plan shape (a field list, not a JSON Schema doc they hand-write) and
  // it's immediately available to author TestPlans against, with zero code
  // change or migration. `fields` is a small builder-friendly shape that
  // gets compiled into the JSON Schema `TestPlanType.fieldSchema` already
  // expected by the existing generic CustomFieldsForm renderer -- proving
  // the render side and the authoring side both really are schema-driven,
  // not just the render side. Not project-scoped for the same reason
  // `types` isn't: this is shared reference data like ComplianceFramework,
  // not something a single project owns.
  createType: protectedProcedure
    .input(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        category: z.enum(["FUNCTIONAL", "QUALITY_STRATEGY", "COMPLIANCE", "RELEASE_READINESS", "CUSTOM"]),
        description: z.string().optional(),
        fields: z
          .array(
            z.object({
              key: z.string().min(1),
              type: z.enum(["string", "number", "array"]),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.testPlanType.findUnique({ where: { key: input.key } });
      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `A plan type with key "${input.key}" already exists` });
      }
      const properties: Record<string, { type: string; items?: { type: string } }> = {};
      for (const f of input.fields) {
        properties[f.key] = f.type === "array" ? { type: "array", items: { type: "string" } } : { type: f.type };
      }
      return ctx.prisma.testPlanType.create({
        data: {
          key: input.key,
          name: input.name,
          category: input.category,
          description: input.description,
          fieldSchema: { type: "object", properties } as never,
          isBuiltIn: false,
        },
      });
    }),

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
          category: z.string(),
          fieldSchema: z.unknown(),
        }),
        strategyId: z.string().nullable(),
        strategyName: z.string().nullable(),
        linkedPlans: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
        acceptanceCriteria: z.array(acceptanceCriterionOutput),
      }),
    )
    .query(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          testPlanType: true,
          acceptanceCriteria: { orderBy: { createdAt: "asc" } },
          strategy: { select: { name: true } },
          linkedPlans: { select: { id: true, name: true, status: true }, orderBy: { updatedAt: "desc" } },
        },
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
          category: plan.testPlanType.category,
          fieldSchema: plan.testPlanType.fieldSchema,
        },
        strategyId: plan.strategyId,
        strategyName: plan.strategy?.name ?? null,
        linkedPlans: plan.linkedPlans,
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
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const created = await ctx.prisma.testPlan.create({
        data: {
          projectId: input.projectId,
          testPlanTypeId: input.testPlanTypeId,
          name: input.name,
          description: input.description,
          customFields: input.customFields as never,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType: "TestPlan",
        entityId: created.id,
        action: "CREATE",
        summary: `Created test plan "${created.name}"`,
      });
      return created;
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
      const { project } = await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      const updated = await ctx.prisma.testPlan.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description,
          status: input.status,
          customFields: input.customFields as never,
          updatedById: ctx.user.id,
        },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: existing.projectId,
        actorId: ctx.user.id,
        entityType: "TestPlan",
        entityId: input.id,
        action: "UPDATE",
        summary: `Updated test plan "${updated.name}" (status: ${updated.status})`,
      });
      return updated;
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
        data: { releaseId: input.releaseId, updatedById: ctx.user.id },
        select: { id: true, releaseId: true },
      });
    }),

  // P4-04: the strategy picker's data source -- every QUALITY_STRATEGY-type
  // plan in the project a plan could link up to. Excludes the plan being
  // edited itself (a strategy can't support itself) when `excludeId` is given.
  strategiesInProject: protectedProcedure
    .input(z.object({ projectId: z.string(), excludeId: z.string().optional() }))
    .output(z.array(z.object({ id: z.string(), name: z.string() })))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.testPlan.findMany({
        where: {
          projectId: input.projectId,
          testPlanType: { category: "QUALITY_STRATEGY" },
          id: input.excludeId ? { not: input.excludeId } : undefined,
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
    }),

  // P4-04: lets a concrete plan (e.g. "regression plan for payments") point
  // back at the strategy it exists to support, turning a strategy plan into
  // a real coordination hub rather than just a document. Only a
  // QUALITY_STRATEGY-category plan can be the target -- linking a plan to
  // some other functional plan wouldn't mean anything here.
  setStrategyLink: protectedProcedure
    .input(z.object({ testPlanId: z.string(), strategyId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({
        where: { id: input.testPlanId },
        select: { projectId: true },
      });
      await requireProjectAccess(ctx, plan.projectId, "EDITOR");
      if (input.strategyId) {
        if (input.strategyId === input.testPlanId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A plan can't support itself as a strategy" });
        }
        const strategy = await ctx.prisma.testPlan.findUnique({
          where: { id: input.strategyId },
          include: { testPlanType: { select: { category: true } } },
        });
        if (!strategy || strategy.projectId !== plan.projectId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That strategy does not belong to this project" });
        }
        if (strategy.testPlanType.category !== "QUALITY_STRATEGY") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only a QA strategy plan can be linked as a strategy" });
        }
      }
      return ctx.prisma.testPlan.update({
        where: { id: input.testPlanId },
        data: { strategyId: input.strategyId, updatedById: ctx.user.id },
        select: { id: true, strategyId: true },
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
