import { z } from "zod";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

// P3-06: read side of the audit trail. Project-scoped (not org-wide) to
// match how every other project page is scoped, and reverse-chronological
// since "what just happened" is the actual auditor question, not "show me
// everything ever."
export const auditLogRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        entityType: z.string().optional(),
        take: z.number().min(1).max(200).default(50),
      }),
    )
    .output(
      z.array(
        z.object({
          id: z.string(),
          entityType: z.string(),
          entityId: z.string(),
          action: z.string(),
          summary: z.string(),
          metadata: z.unknown().nullable(),
          createdAt: z.date(),
          actor: z.object({ id: z.string(), name: z.string().nullable(), email: z.string() }),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const entries = await ctx.prisma.auditLog.findMany({
        where: { projectId: input.projectId, entityType: input.entityType },
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: input.take,
      });
      return entries.map((e) => ({
        id: e.id,
        entityType: e.entityType,
        entityId: e.entityId,
        action: e.action,
        summary: e.summary,
        metadata: e.metadata,
        createdAt: e.createdAt,
        actor: e.actor,
      }));
    }),
});
