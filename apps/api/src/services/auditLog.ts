import type { PrismaClient, AuditAction } from "@vaettir/db";

// P3-06: a single append-only entry point every instrumented mutation calls
// after its own write succeeds. Kept fire-and-forget-shaped but awaited (not
// queued) since an audit record that silently failed to write would defeat
// the point -- if this throws, the caller's mutation should fail too.
export async function recordAudit(
  prisma: PrismaClient,
  args: {
    organizationId: string;
    projectId?: string;
    actorId: string;
    entityType: string;
    entityId: string;
    action: AuditAction;
    summary: string;
    metadata?: Record<string, unknown>;
  },
) {
  await prisma.auditLog.create({
    data: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      actorId: args.actorId,
      entityType: args.entityType,
      entityId: args.entityId,
      action: args.action,
      summary: args.summary,
      metadata: (args.metadata as never) ?? undefined,
    },
  });
}
