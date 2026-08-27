import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { generateTestCasesFromRequirement } from "@vaettir/ai-agent";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { chargeAiCredits, InsufficientAiCreditsError } from "../services/aiCredits.js";

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

  // 2026-08-27 competitor parity audit: draft-only, same review-before-save
  // shape as every other AI feature (P2-06, P4-02, P5-12) - nothing here
  // creates a real TestCase; the caller reviews/edits the draft, then a
  // separate testCases.create call (already built) commits whichever ones
  // survive review.
  generateTestCases: protectedProcedure
    .input(z.object({ requirementId: z.string() }))
    .output(
      z.array(
        z.object({
          title: z.string(),
          given: z.array(z.string()),
          when: z.array(z.string()),
          then: z.array(z.string()),
          priority: z.string(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const requirement = await ctx.prisma.requirement.findUniqueOrThrow({
        where: { id: input.requirementId },
        include: { project: { select: { id: true, name: true, organizationId: true } } },
      });
      await requireProjectAccess(ctx, requirement.projectId, "EDITOR");

      try {
        await chargeAiCredits(ctx.prisma, requirement.project.organizationId, "generateTestCasesFromRequirement");
      } catch (e) {
        if (e instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      }

      return generateTestCasesFromRequirement({
        requirementTitle: requirement.title,
        requirementDescription: requirement.description,
        projectName: requirement.project.name,
      });
    }),
});
