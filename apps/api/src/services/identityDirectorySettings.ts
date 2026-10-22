import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { identityConfigurationSchema } from "@vaettir/core";
import { currentIdentityMember, type IdentityActor } from "./identityAccessPolicy.js";
import { recordAudit } from "./auditLog.js";

import { directoryMappingsSchema, type DirectoryMapping } from "./identityDirectoryMappingSchema.js";
export async function requireIdentityAdministrator(db: Prisma.TransactionClient, actor: IdentityActor, organizationId: string) {
  const member = await currentIdentityMember(db, actor, organizationId);
  if (member.seatType !== "FULL" || !["OWNER", "ADMIN"].includes(member.role)) throw new TRPCError({ code: "FORBIDDEN" });
}
export async function directorySettings(db: Prisma.TransactionClient, actor: IdentityActor, organizationId: string) {
  await requireIdentityAdministrator(db, actor, organizationId);
  const connections = await db.identityDirectoryConnection.findMany({ where: { organizationId }, orderBy: { id: "asc" }, take: 51,
    include: { subjects: { take: 1001, orderBy: { id: "asc" }, select: { id: true, enabled: true, active: true, externalGroupIds: true,
      expiresAt: true, observedAt: true, observedConnectionRevision: true, observedSubjectRevision: true, revision: true } } } });
  if (connections.length > 50 || connections.some(connection => connection.subjects.length > 1000))
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This directory needs a paginated review. No members or groups were omitted." });
  const now = Date.now();
  return connections.map(connection => {
    const current = connection.subjects.filter(subject => subject.enabled && subject.observedAt && subject.observedAt.getTime() <= now &&
      subject.expiresAt && subject.expiresAt.getTime() > now && subject.observedConnectionRevision === connection.revision && subject.observedSubjectRevision === subject.revision);
    return { id: connection.id, providerConnectionId: connection.providerConnectionId, enabled: connection.enabled, revision: connection.revision,
      mappings: directoryMappingsSchema.parse(connection.mappings),
      groups: [...new Set(current.filter(subject => subject.active).flatMap(subject => subject.externalGroupIds))].sort(),
      observedMembers: connection.subjects.length, activeMembers: connection.enabled ? current.filter(subject => subject.active).length : 0,
      staleMembers: connection.subjects.length - current.length,
      lastObservedAt: connection.subjects.reduce<string | null>((latest, subject) => {
        const value = subject.observedAt?.toISOString(); return value && (!latest || value > latest) ? value : latest;
      }, null),
    };
  });
}
export async function updateDirectorySettings(prisma: PrismaClient, actor: IdentityActor, input: {
  organizationId: string; connectionId: string; expectedRevision: number;
  change: { kind: "mappings"; mappings: DirectoryMapping[] } | { kind: "disable" };
}) {
  try {
    return await prisma.$transaction(async db => {
      await requireIdentityAdministrator(db, actor, input.organizationId);
      const connection = await db.identityDirectoryConnection.findUnique({ where: { organizationId_id: { organizationId: input.organizationId, id: input.connectionId } } });
      if (!connection || connection.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "Directory settings changed. Reload before retrying." });
      let mappings: DirectoryMapping[] | undefined;
      if (input.change.kind === "mappings") {
        mappings = directoryMappingsSchema.parse(input.change.mappings);
        const policy = await db.identityAccessPolicy.findUnique({ where: { organizationId: input.organizationId } });
        const roles = policy ? identityConfigurationSchema.parse(policy.configuration).roles : [];
        const projects = await db.project.findMany({ where: { organizationId: input.organizationId }, select: { id: true } });
        const catalog = (await directorySettings(db, actor, input.organizationId)).find(item => item.id === connection.id)!;
        if (mappings.some(mapping => !catalog.groups.includes(mapping.externalGroupId) || !roles.some(role => role.id === mapping.roleId) ||
          (mapping.scope.kind === "projects" && mapping.scope.projectIds.some(id => !projects.some(project => project.id === id)))))
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Choose current directory groups, published roles and workspace projects." });
      }
      const changed = await db.identityDirectoryConnection.updateMany({ where: { organizationId: input.organizationId, id: connection.id, revision: input.expectedRevision },
        data: { revision: { increment: 1 }, ...(mappings ? { mappings } : { enabled: false }) } });
      if (changed.count !== 1) throw new TRPCError({ code: "CONFLICT" });
      // Revision invalidation withdraws this source's existing observations.
      // Fresh authenticated reconciliation is required before grants can return.
      await recordAudit(db, { organizationId: input.organizationId, actorId: actor.userId, entityType: "IdentityDirectoryConnection", entityId: connection.id,
        action: "UPDATE", summary: mappings ? "Updated external group mappings; fresh sync required" : "Disabled directory access",
        metadata: { previousRevision: input.expectedRevision, revision: input.expectedRevision + 1, change: input.change.kind, mappingCount: mappings?.length ?? 0 } });
      return { revision: input.expectedRevision + 1 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new TRPCError({ code: "CONFLICT", message: "Directory settings changed. Reload before retrying." });
    throw error;
  }
}
