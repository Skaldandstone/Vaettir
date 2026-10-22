import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { identityConfigurationSchema, localGroupGrants, resolveIdentityPermissions,
  IDENTITY_PERMISSIONS, type IdentityPermission } from "@vaettir/core";
import { recordAudit } from "./auditLog.js";
import { directoryMappingsSchema } from "./identityDirectoryMappingSchema.js";

type Database = Prisma.TransactionClient;
export type IdentityActor = { userId: string; clerkSubject: string | null | undefined; workspaceOrganizationId?: string | null };
const denied = () => new TRPCError({ code: "FORBIDDEN", message: "Current workspace access is required." });
const conflict = () => new TRPCError({ code: "CONFLICT", message: "Access settings changed. Reload and review before publishing." });

// Rollout gate, supplied by the sole deployment operator for the isolated test
// tenant only after route/provider acceptance. No wildcard or email inference.
export function localIdentityPublicationAvailable(organizationId: string) {
  return (process.env.VAETTIR_IDENTITY_LOCAL_RULES_ORGANIZATIONS ?? "").split(",")
    .map(value => value.trim()).filter(Boolean).includes(organizationId);
}

/** A fresh human subject and native membership remain prerequisites. Never
 * derive the verified subject from the row that is being checked. */
export async function currentIdentityMember(db: Database, actor: IdentityActor, organizationId: string) {
  if (!actor.clerkSubject || (actor.workspaceOrganizationId && actor.workspaceOrganizationId !== organizationId)) throw denied();
  const [user, membership, organization] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { clerkUserId: true, apiKeyIdentity: { select: { id: true } } } }),
    db.membership.findUnique({ where: { organizationId_userId: { organizationId, userId: actor.userId } } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { suspendedAt: true } }),
  ]);
  if (!user || user.apiKeyIdentity || user.clerkUserId !== actor.clerkSubject || !membership || !organization || organization.suspendedAt) throw denied();
  return membership;
}

/** Only these custom actions are intrinsically read-only. Unknown actions deny. */
export const identityReadActions: ReadonlySet<IdentityPermission> = new Set([
  "project.read", "cases.read", "plans.read", "runs.read", "requirements.read",
  "architecture.read", "reports.read", "integrations.read", "audit.read",
]);

/** Evaluate PUBLISHED local rules from current server rows, not a draft/JWT.
 * This is the custom-rule contribution only; it neither cancels nor fabricates
 * native access. Directory rules and SSO proof are intentionally not inferred.
 * Call inside the business transaction for a mutation's authorization/read/write.
 */
export async function readPublishedLocalAccess(db: Database, actor: IdentityActor, organizationId: string, projectId: string) {
  const membership = await currentIdentityMember(db, actor, organizationId);
  const [policy, project, members, projects] = await Promise.all([
    db.identityAccessPolicy.findUnique({ where: { organizationId } }),
    db.project.findUnique({ where: { id: projectId }, select: { organizationId: true } }),
    db.membership.findMany({ where: { organizationId }, select: { userId: true } }),
    db.project.findMany({ where: { organizationId }, select: { id: true } }),
  ]);
  if (!project || project.organizationId !== organizationId) throw denied();
  if (!policy) return { revision: 0, permissions: [] as IdentityPermission[], sources: [] as { permission: IdentityPermission; groupId: string; roleId: string }[] };
  const parsed = identityConfigurationSchema.safeParse(policy.configuration);
  if (!parsed.success) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Published access rules need administrator review." });
  // Deleted members/projects must never acquire rules through a stale reference.
  // Prune stale members/scopes, rather than revoking unrelated valid groups.
  const memberIds = new Set(members.map(member => member.userId));
  const projectIds = projects.map(item => item.id);
  const catalog = { organizationId, projectIds, roles: parsed.data.roles.map(role => ({ ...role, organizationId })) };
  const groups = parsed.data.groups.flatMap(group => {
    const scope = group.scope.kind === "workspace" ? group.scope : { kind: "projects" as const, projectIds: group.scope.projectIds.filter(id => projectIds.includes(id)) };
    if (scope.kind === "projects" && !scope.projectIds.length) return [];
    return [{ ...group, organizationId, scope, userIds: group.userIds.filter(id => memberIds.has(id)) }];
  });
  const permissions = resolveIdentityPermissions({ catalog, userId: actor.userId, projectId, now: Date.now(), suspended: false,
    groups, directoryGrants: [], connections: [], mappings: [] }).filter(permission => membership.seatType === "FULL" || identityReadActions.has(permission));
  const sources = localGroupGrants(catalog, groups, actor.userId).flatMap(grant => {
    if (grant.source.kind !== "local-group" || (grant.scope.kind === "projects" && !grant.scope.projectIds.includes(projectId))) return [];
    const groupId = grant.source.groupId;
    return (catalog.roles.find(role => role.id === grant.roleId)?.permissions ?? [])
      .filter(permission => permissions.includes(permission)).map(permission => ({ permission, groupId, roleId: grant.roleId }));
  });
  return { revision: policy.revision, permissions, sources };
}

/** Explicit-action custom authorization. Never convert a scoped custom role to
 * legacy EDITOR, bypass entitlements, or accept service tokens as human proof. */
export async function requirePublishedLocalAction(db: Database, actor: IdentityActor, organizationId: string, projectId: string, action: IdentityPermission) {
  if (!(IDENTITY_PERMISSIONS as readonly string[]).includes(action)) throw denied();
  const access = await readPublishedIdentityAccess(db, actor, organizationId, projectId);
  if (!access.permissions.includes(action)) throw denied();
  return access;
}

/** Call only after the business operation locks organization/member/project.
 * Keep source revocation and subject rebinding serialized with the write. */
export async function lockPublishedIdentityAction(db: Database, actor: IdentityActor, organizationId: string, projectId: string, action: IdentityPermission) {
  await db.$queryRaw`SELECT id FROM "User" WHERE id=${actor.userId} FOR SHARE`;
  await db.$queryRaw`SELECT "organizationId" FROM "IdentityAccessPolicy" WHERE "organizationId"=${organizationId} FOR SHARE`;
  await db.$queryRaw`SELECT c.id FROM "IdentityDirectoryConnection" c
    JOIN "IdentityDirectorySubject" s ON s."connectionId"=c.id AND s."organizationId"=c."organizationId"
    WHERE c."organizationId"=${organizationId} AND s."userId"=${actor.userId}
    ORDER BY c.id,s.id FOR SHARE OF c,s`;
  return requirePublishedLocalAction(db, actor, organizationId, projectId, action);
}

/** Union source contributions, never a broad role conversion. Directory removal
 * affects only that source. A global provider user-active flag is not evidence. */
export async function readPublishedIdentityAccess(db: Database, actor: IdentityActor, organizationId: string, projectId: string) {
  const local = await readPublishedLocalAccess(db, actor, organizationId, projectId);
  const member = await currentIdentityMember(db, actor, organizationId);
  const policy = await db.identityAccessPolicy.findUnique({ where: { organizationId } });
  if (!policy) return { ...local, directorySources: [] as { connectionId: string; externalGroupId: string; roleId: string; permission: IdentityPermission }[] };
  const roles = identityConfigurationSchema.parse(policy.configuration).roles;
  const subjects = await db.identityDirectorySubject.findMany({ where: { organizationId, userId: actor.userId, clerkSubject: actor.clerkSubject!, enabled: true }, include: { connection: true } });
  const now = Date.now();
  const directorySources = subjects.flatMap(subject => {
    const connection = subject.connection;
    if (connection.organizationId !== organizationId || !connection.enabled || !subject.active || subject.appliedGeneration <= 0 ||
      !subject.observedAt || subject.observedAt.getTime() > now || !subject.expiresAt || subject.expiresAt.getTime() <= now ||
      subject.observedConnectionRevision !== connection.revision || subject.observedSubjectRevision !== subject.revision) return [];
    const parsed = directoryMappingsSchema.safeParse(connection.mappings);
    if (!parsed.success) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Directory mappings need administrator review." });
    return parsed.data.flatMap(mapping => {
      if (!subject.externalGroupIds.includes(mapping.externalGroupId) ||
        (mapping.scope.kind === "projects" && !mapping.scope.projectIds.includes(projectId))) return [];
      return (roles.find(role => role.id === mapping.roleId)?.permissions ?? [])
        .filter(permission => member.seatType === "FULL" || identityReadActions.has(permission))
        .map(permission => ({ connectionId: connection.id, externalGroupId: mapping.externalGroupId, roleId: mapping.roleId, permission }));
    });
  });
  return { ...local, permissions: [...new Set([...local.permissions, ...directorySources.map(source => source.permission)])], directorySources };
}

export async function publishIdentityDraft(prisma: PrismaClient, actor: IdentityActor, input: {
  organizationId: string; expectedDraftRevision: number; expectedPolicyRevision: number;
}) {
  try {
    return await prisma.$transaction(async db => {
      const membership = await currentIdentityMember(db, actor, input.organizationId);
      if (membership.seatType !== "FULL" || !["OWNER", "ADMIN"].includes(membership.role)) throw denied();
      const draft = await db.identityAccessDraft.findUnique({ where: { organizationId: input.organizationId } });
      if (!draft || draft.revision !== input.expectedDraftRevision) throw conflict();
      const configuration = identityConfigurationSchema.parse(draft.configuration);
      const [members, projects] = await Promise.all([
        db.membership.findMany({ where: { organizationId: input.organizationId }, select: { userId: true } }),
        db.project.findMany({ where: { organizationId: input.organizationId }, select: { id: true } }),
      ]);
      const memberIds = new Set(members.map(member => member.userId));
      const projectIds = new Set(projects.map(project => project.id));
      if (configuration.groups.some(group => group.userIds.some(id => !memberIds.has(id)) ||
        (group.scope.kind === "projects" && group.scope.projectIds.some(id => !projectIds.has(id)))))
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A selected member or project is unavailable. Review the saved draft." });
      const publishedAt = new Date();
      const revision = input.expectedPolicyRevision + 1;
      const data = { configuration, sourceDraftRevision: draft.revision, publishedAt };
      if (input.expectedPolicyRevision === 0) {
        await db.identityAccessPolicy.create({ data: { organizationId: input.organizationId, ...data } });
      } else {
        const updated = await db.identityAccessPolicy.updateMany({ where: { organizationId: input.organizationId, revision: input.expectedPolicyRevision }, data: { ...data, revision } });
        if (updated.count !== 1) throw conflict();
      }
      await recordAudit(db, { organizationId: input.organizationId, actorId: actor.userId, entityType: "IdentityAccessPolicy", entityId: input.organizationId,
        action: input.expectedPolicyRevision === 0 ? "CREATE" : "UPDATE", summary: "Published scoped local role and group rules",
        metadata: { previousRevision: input.expectedPolicyRevision, revision, sourceDraftRevision: draft.revision, roleCount: configuration.roles.length, groupCount: configuration.groups.length } });
      return { revision, sourceDraftRevision: draft.revision, publishedAt: publishedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw conflict();
    throw error;
  }
}
