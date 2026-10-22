import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@vaettir/db";
import { emptyIdentityConfiguration, identityConfigurationSchema, validateIdentityReferences } from "@vaettir/core";
import { router, protectedProcedure, requireOrgRole, type Context } from "../trpc.js";
import { recordAudit } from "../services/auditLog.js";
import { localIdentityPublicationAvailable, publishIdentityDraft, readPublishedLocalAccess } from "../services/identityAccessPolicy.js";

const organizationInput = z.object({ organizationId: z.string().min(1).max(512) }).strict();
const conflict = () => new TRPCError({ code: "CONFLICT", message: "Access settings changed in another session. Reload the saved version before saving again." });

/** Recheck transport identity and admin membership inside the same transaction as the write. */
async function requireAccessAdministrator(db: Prisma.TransactionClient, ctx: Context & { user: NonNullable<Context["user"]> }, organizationId: string) {
  requireOrgRole(ctx, organizationId, "ADMIN");
  if (!ctx.authenticatedClerkSubject) throw new TRPCError({ code: "FORBIDDEN", message: "Sign in to manage access settings." });
  const [user, member, org] = await Promise.all([
    db.user.findUnique({ where: { id: ctx.user.id }, select: { clerkUserId: true } }),
    db.membership.findUnique({ where: { organizationId_userId: { organizationId, userId: ctx.user.id } } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { suspendedAt: true } }),
  ]);
  if (user?.clerkUserId !== ctx.authenticatedClerkSubject || !member || member.seatType !== "FULL"
    || !["OWNER", "ADMIN"].includes(member.role) || !org || org.suspendedAt)
    throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator access is required." });
}

export const identityAccessRouter = router({
  configuration: protectedProcedure.input(organizationInput).query(({ ctx, input }) => ctx.prisma.$transaction(async db => {
    await requireAccessAdministrator(db, ctx, input.organizationId);
    const [saved, members, projects, published] = await Promise.all([
      db.identityAccessDraft.findUnique({ where: { organizationId: input.organizationId } }),
      db.membership.findMany({ where: { organizationId: input.organizationId }, select: { user: { select: { id: true, name: true, email: true } } }, orderBy: { userId: "asc" } }),
      db.project.findMany({ where: { organizationId: input.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      db.identityAccessPolicy.findUnique({ where: { organizationId: input.organizationId }, select: { revision: true, sourceDraftRevision: true, publishedAt: true } }),
    ]);
    return {
      revision: saved?.revision ?? 0,
      configuration: saved ? identityConfigurationSchema.parse(saved.configuration) : emptyIdentityConfiguration(),
      updatedAt: saved?.updatedAt.toISOString() ?? null,
      members: members.map(member => member.user), projects,
      // Never infer readiness from a saved ID, linked account, email domain or draft.
      activation: published ? "LOCAL_RULES" as const : "PREPARATION_ONLY" as const,
      publication: { available: localIdentityPublicationAvailable(input.organizationId), revision: published?.revision ?? 0,
        sourceDraftRevision: published?.sourceDraftRevision ?? null, publishedAt: published?.publishedAt.toISOString() ?? null },
    };
  })),

  publishDraft: protectedProcedure.input(organizationInput.extend({
    expectedDraftRevision: z.number().int().positive().max(2147483646),
    expectedPolicyRevision: z.number().int().min(0).max(2147483646),
    approveLocalRules: z.literal(true),
  }).strict()).mutation(({ ctx, input }) => {
    requireOrgRole(ctx, input.organizationId, "ADMIN");
    if (!localIdentityPublicationAvailable(input.organizationId)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Local rule activation is not available for this workspace yet." });
    return publishIdentityDraft(ctx.prisma, { userId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject, workspaceOrganizationId: ctx.workspaceOrganizationId }, input);
  }),

  publishedLocalAccess: protectedProcedure.input(organizationInput.extend({ projectId: z.string().min(1).max(512) }).strict())
    .query(({ ctx, input }) => ctx.prisma.$transaction(db => readPublishedLocalAccess(db,
      { userId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject, workspaceOrganizationId: ctx.workspaceOrganizationId }, input.organizationId, input.projectId),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })),

  saveDraft: protectedProcedure.input(organizationInput.extend({
    expectedRevision: z.number().int().min(0).max(2147483646), configuration: identityConfigurationSchema,
  }).strict()).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.prisma.$transaction(async db => {
        await requireAccessAdministrator(db, ctx, input.organizationId);
        const [members, projects] = await Promise.all([
          db.membership.findMany({ where: { organizationId: input.organizationId }, select: { userId: true } }),
          db.project.findMany({ where: { organizationId: input.organizationId }, select: { id: true } }),
        ]);
        try {
          validateIdentityReferences(input.configuration, { userIds: members.map(member => member.userId), projectIds: projects.map(project => project.id) });
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Review the selected members and projects." });
        }
        if (input.expectedRevision === 0) {
          await db.identityAccessDraft.create({ data: { organizationId: input.organizationId, configuration: input.configuration } });
        } else {
          const changed = await db.identityAccessDraft.updateMany({ where: { organizationId: input.organizationId, revision: input.expectedRevision },
            data: { configuration: input.configuration, revision: { increment: 1 } } });
          if (changed.count !== 1) throw conflict();
        }
        const revision = input.expectedRevision + 1;
        await recordAudit(db, { organizationId: input.organizationId, actorId: ctx.user.id,
          entityType: "IdentityAccessDraft", entityId: input.organizationId, action: input.expectedRevision === 0 ? "CREATE" : "UPDATE",
          summary: "Prepared workspace access settings; active access unchanged",
          metadata: { previousRevision: input.expectedRevision, revision, roleCount: input.configuration.roles.length, groupCount: input.configuration.groups.length, activation: "PREPARATION_ONLY" },
        });
        return { revision };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw conflict();
      throw error;
    }
  }),
});
