import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { TestCaseStepInputSchema } from "@vaettir/core";
import { router, protectedProcedure } from "../trpc.js";
import { requireCurrentPlanAccess } from "../services/testPlanExecution.js";
import {
  boundedSharedLibrary,
  createSharedLibrary,
  reviewSharedLibrary,
  writeSharedLibrary,
} from "../services/sharedStepHistory.js";
import {
  sharedLibraryContentSchema,
  sharedLibraryRefSchema,
  sharedLibraryWriteSchema,
} from "../services/sharedStepHistorySchema.js";

// Read compatibility is retained. Unreviewed legacy UPDATE/DELETE intentionally
// refuse after the additive guard migration rather than erase retained history.
export const sharedStepGroupsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        includeArchived: z.boolean().default(false),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.prisma.$transaction(
        async (tx) => {
          await requireCurrentPlanAccess(tx, ctx.user.id, input.projectId);
          const [size] = await tx.$queryRaw<
            Array<{ bytes: bigint; count: number }>
          >`SELECT coalesce(sum(octet_length(steps::text)),0)::bigint AS bytes,count(*)::int AS count FROM "SharedStepGroup" WHERE "projectId"=${input.projectId} AND (${input.includeArchived} OR "archivedAt" IS NULL)`;
          if (!size || size.bytes > 4n * 1024n * 1024n || size.count > 500)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "This library collection exceeds the bounded 500-library / 4 MiB view. No incomplete list was substituted.",
            });
          const groups = await tx.sharedStepGroup.findMany({
            where: {
              projectId: input.projectId,
              ...(!input.includeArchived ? { archivedAt: null } : {}),
            },
            include: { _count: { select: { testCases: true } } },
            orderBy: { name: "asc" },
          });
          return groups.map((g) => ({
            id: g.id,
            name: g.name,
            description: g.description,
            steps: boundedSharedLibrary({
              name: g.name,
              description: g.description,
              steps: g.steps,
              archived: g.archivedAt !== null,
            }).steps,
            usageCount: g._count.testCases,
            updatedAt: g.updatedAt,
            revision: g.revision,
            archivedAt: g.archivedAt,
          }));
        },
        { isolationLevel: "RepeatableRead", timeout: 20000 },
      ),
    ),
  review: protectedProcedure
    .input(
      sharedLibraryRefSchema.extend({
        before: z.number().int().min(1).max(101).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      reviewSharedLibrary(ctx.prisma, ctx.user.id, input),
    ),
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1).max(200),
        name: z.string().min(1).max(200),
        description: z.string().max(10000).nullable().optional(),
        steps: z.array(TestCaseStepInputSchema).min(1).max(500),
        requestId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      createSharedLibrary(ctx.prisma, ctx.user.id, {
        projectId: input.projectId,
        requestId: input.requestId ?? randomUUID(),
        content: sharedLibraryContentSchema.parse({
          name: input.name,
          description: input.description ?? null,
          steps: input.steps.map((s, order) => ({ ...s, order })),
        }),
      }),
    ),
  update: protectedProcedure
    .input(sharedLibraryWriteSchema)
    .mutation(({ ctx, input }) =>
      writeSharedLibrary(ctx.prisma, ctx.user.id, input),
    ),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(() => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Libraries retain procedure history. Refresh the library page and use reviewed Archive instead of deleting it.",
      });
    }),
});
