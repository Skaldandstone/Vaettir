import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";

const identity = z
  .object({ projectId: z.string().min(1), requestId: z.string().uuid() })
  .strict();
const documentInput = identity
  .extend({
    sourceKey: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9._/-]+$/),
    title: z.string().trim().min(1).max(200),
    content: z
      .string()
      .min(1)
      .max(50000)
      .refine((value) => !value.includes("\0"), "Plain text only"),
    processingPermission: z.literal(true),
  })
  .strict();
const conflict = (message: string) =>
  new TRPCError({ code: "CONFLICT", message });

export const populationDocumentsRouter = router({
  pending: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.projectPopulationDocumentRun.findMany({
        where: {
          projectId: input.projectId,
          actorId: ctx.user.id,
          approvedAt: null,
          cancelledAt: null,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
    }),
  cancel: protectedProcedure
    .input(identity)
    .mutation(async ({ ctx, input }) => {
      const { membership } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      if (membership.seatType === "READ_ONLY")
        throw new TRPCError({ code: "FORBIDDEN" });
      return ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${input.projectId} FOR UPDATE`;
        const result = await tx.projectPopulationDocumentRun.updateMany({
          where: { ...input, actorId: ctx.user.id, approvedAt: null },
          data: { cancelledAt: new Date() },
        });
        return { cancelled: result.count === 1 };
      });
    }),
  list: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.projectPopulationDocument.findMany({
        where: { projectId: input.projectId },
        select: {
          sourceKey: true,
          title: true,
          version: true,
          contentHash: true,
          approvedAt: true,
        },
        orderBy: { sourceKey: "asc" },
        take: 200,
      });
    }),
  preview: protectedProcedure
    .input(documentInput)
    .mutation(async ({ ctx, input }) => {
      const { membership } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      if (membership.seatType === "READ_ONLY")
        throw new TRPCError({ code: "FORBIDDEN" });
      // Never execute Markdown/HTML, follow links, or send this text to an AI provider.
      const contentHash = createHash("sha256")
        .update(JSON.stringify([input.title, input.content]))
        .digest("hex");
      return ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${input.projectId} FOR UPDATE`;
        const where = {
          projectId_requestId: {
            projectId: input.projectId,
            requestId: input.requestId,
          },
        };
        let run = await tx.projectPopulationDocumentRun.findUnique({ where });
        if (run?.cancelledAt)
          throw conflict("This preview was cancelled. Start a new preview.");
        if (
          run &&
          (run.actorId !== ctx.user.id ||
            run.contentHash !== contentHash ||
            run.sourceKey !== input.sourceKey)
        )
          throw conflict("Preview identifier belongs to different input.");
        const previous = await tx.projectPopulationDocument.findUnique({
          where: {
            projectId_sourceKey: {
              projectId: input.projectId,
              sourceKey: input.sourceKey,
            },
          },
        });
        if (!run) {
          const pendingCount = await tx.projectPopulationDocumentRun.count({
            where: {
              projectId: input.projectId,
              approvedAt: null,
              cancelledAt: null,
            },
          });
          if (pendingCount >= 100)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Pending preview limit reached. Review existing previews before adding more.",
            });
          run = await tx.projectPopulationDocumentRun.create({
            data: {
              projectId: input.projectId,
              requestId: input.requestId,
              sourceKey: input.sourceKey,
              title: input.title,
              content: input.content,
              contentHash,
              actorId: ctx.user.id,
              expectedVersion: previous?.version ?? 0,
            },
          });
        }
        return {
          requestId: run.requestId,
          sourceKey: run.sourceKey,
          title: run.title,
          content: run.content,
          expectedVersion: run.expectedVersion,
          status:
            run.expectedVersion !== (previous?.version ?? 0) && !run.approvedAt
              ? ("conflict" as const)
              : !previous
                ? ("new" as const)
                : previous.contentHash === contentHash
                  ? ("unchanged" as const)
                  : ("changed" as const),
          previous: previous
            ? {
                title: previous.title,
                content: previous.content,
                version: previous.version,
              }
            : null,
          approved: run.approvedAt !== null,
          costCredits: 0,
        };
      });
    }),
  approve: protectedProcedure
    .input(identity.extend({ approve: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const { membership } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      if (membership.seatType === "READ_ONLY")
        throw new TRPCError({ code: "FORBIDDEN" });
      return ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${input.projectId} FOR UPDATE`;
        const where = {
          projectId_requestId: {
            projectId: input.projectId,
            requestId: input.requestId,
          },
        };
        const run = await tx.projectPopulationDocumentRun.findUnique({ where });
        if (!run || run.actorId !== ctx.user.id)
          throw new TRPCError({ code: "NOT_FOUND" });
        if (run.cancelledAt) throw conflict("This preview was cancelled.");
        if (run.approvedAt)
          return { version: run.appliedVersion!, replayed: true };
        const docWhere = {
          projectId_sourceKey: {
            projectId: input.projectId,
            sourceKey: run.sourceKey,
          },
        };
        const previous = await tx.projectPopulationDocument.findUnique({
          where: docWhere,
        });
        if ((previous?.version ?? 0) !== run.expectedVersion)
          throw conflict(
            "Evidence changed since this preview. Preview again before approving.",
          );
        const version =
          previous?.contentHash === run.contentHash
            ? previous.version
            : (previous?.version ?? 0) + 1;
        const approvedAt = new Date();
        if (version !== previous?.version) {
          const data = {
            version,
            title: run.title,
            content: run.content,
            contentHash: run.contentHash,
            approvedBy: ctx.user.id,
            approvedAt,
          };
          await tx.projectPopulationDocument.upsert({
            where: docWhere,
            create: {
              projectId: input.projectId,
              sourceKey: run.sourceKey,
              ...data,
            },
            update: data,
          });
        }
        await tx.projectPopulationDocumentRun.update({
          where,
          data: { approvedAt, appliedVersion: version },
        });
        return { version, replayed: false };
      });
    }),
});
