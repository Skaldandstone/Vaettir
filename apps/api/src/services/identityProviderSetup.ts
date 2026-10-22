import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@vaettir/db";
import type { ClerkClient } from "@clerk/backend";
import { requireIdentityAdministrator } from "./identityDirectorySettings.js";
import type { IdentityActor } from "./identityAccessPolicy.js";

/** Read-only provider preflight. The browser supplies only its Vaettir tenant.
 * The operator owns the exact organization binding and enablement. No creation,
 * provider mutation, email lookup, domain inference or broad organization list. */
export async function identityProviderSetup(db: PrismaClient, actor: IdentityActor, organizationId: string,
  provider: Pick<ClerkClient, "organizations" | "enterpriseConnections">) {
  await requireIdentityAdministrator(db, actor, organizationId);
  const binding = await db.identityProviderBinding.findUnique({ where: { organizationId } });
  if (!binding?.setupEnabled) return { status: "unavailable" as const, connections: [] };
  let memberships: Awaited<ReturnType<typeof provider.organizations.getOrganizationMembershipList>>;
  let connections: Awaited<ReturnType<typeof provider.enterpriseConnections.getEnterpriseConnectionList>>;
  try {
    memberships = await provider.organizations.getOrganizationMembershipList({ organizationId: binding.clerkOrganizationId, userId: [actor.clerkSubject!], limit: 2 });
    const member = memberships.data[0];
    if (memberships.totalCount !== 1 || memberships.data.length !== 1 || member?.organization.id !== binding.clerkOrganizationId ||
      member.publicUserData?.userId !== actor.clerkSubject || !member.permissions.includes("org:sys_entconns:manage"))
      return { status: "provider-admin-required" as const, connections: [] };
    connections = await provider.enterpriseConnections.getEnterpriseConnectionList({ organizationId: binding.clerkOrganizationId, limit: 100 });
  } catch {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Identity provider status is unavailable. Retry without changing your connection." });
  }
  if (connections.totalCount !== connections.data.length || connections.data.some(connection => connection.organizationId !== binding.clerkOrganizationId))
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Provider connections require an administrator review." });
  // A slow response may outlive a local disable, rebind, demotion or suspension.
  await requireIdentityAdministrator(db, actor, organizationId);
  const current = await db.identityProviderBinding.findUnique({ where: { organizationId } });
  if (!current?.setupEnabled || current.revision !== binding.revision || current.clerkOrganizationId !== binding.clerkOrganizationId)
    throw new TRPCError({ code: "CONFLICT", message: "Identity setup changed. Reload before continuing." });
  return { status: "ready" as const, clerkOrganizationId: binding.clerkOrganizationId, clerkSubject: actor.clerkSubject!, revision: binding.revision,
    // Provider active is configuration state, NOT proof of this session's SSO.
    connections: connections.data.map(connection => ({ id: connection.id, name: connection.name, provider: connection.provider, active: connection.active })) };
}
