import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { populationDraftSchema } from "@vaettir/core";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

export const projectPopulationRouter = router({
  draft: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const saved = await ctx.prisma.projectPopulationDraft.findUnique({
        where: { projectId: input.projectId },
      });
      return saved
        ? {
            version: saved.version,
            document: populationDraftSchema.parse(saved.document),
            updatedAt: saved.updatedAt,
          }
        : null;
    }),

  saveDraft: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          expectedVersion: z.number().int().min(0).max(2147483646),
          requestId: z.string().uuid(),
          document: populationDraftSchema,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const { membership } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      if (membership.seatType === "READ_ONLY")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A full seat is required to edit setup.",
        });
      // Zod fixes field ordering before hashing. The receipt also binds the actor.
      const payloadHash = createHash("sha256")
        .update(
          JSON.stringify({
            expectedVersion: input.expectedVersion,
            document: input.document,
          }),
        )
        .digest("hex");
      return ctx.prisma.$transaction(async (tx) => {
        // Existing parent row serializes first-save races as well as updates.
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${input.projectId} FOR UPDATE`;
        const receipt = await tx.projectPopulationDraftWrite.findUnique({
          where: {
            projectId_requestId: {
              projectId: input.projectId,
              requestId: input.requestId,
            },
          },
        });
        if (receipt) {
          if (
            receipt.actorId !== ctx.user.id ||
            receipt.payloadHash !== payloadHash
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This save identifier belongs to a different request.",
            });
          }
          // This is the acknowledged version, not necessarily the current one.
          // UI clients must refetch the draft before permitting the next edit.
          return { version: receipt.appliedVersion, replayed: true };
        }
        const existing = await tx.projectPopulationDraft.findUnique({
          where: { projectId: input.projectId },
        });
        if ((existing?.version ?? 0) !== input.expectedVersion) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Project setup changed in another session. Reload and review before saving.",
          });
        }
        const version = input.expectedVersion + 1;
        await tx.projectPopulationDraft.upsert({
          where: { projectId: input.projectId },
          create: {
            projectId: input.projectId,
            version,
            document: input.document,
            updatedByUserId: ctx.user.id,
          },
          update: {
            version,
            document: input.document,
            updatedByUserId: ctx.user.id,
          },
        });
        await tx.projectPopulationDraftWrite.create({
          data: {
            projectId: input.projectId,
            requestId: input.requestId,
            payloadHash,
            actorId: ctx.user.id,
            appliedVersion: version,
          },
        });
        return { version, replayed: false };
      });
    }),
});
