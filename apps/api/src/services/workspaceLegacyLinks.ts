import { z } from "@vaettir/core/dist/validation.js";
import type { Context } from "../trpc.js";
import { requireProjectAccess, requireOrgRole, requireNotSuspended } from "../trpc.js";
import { workspaceHostname } from "@vaettir/core";

export const legacyWorkspaceLinkInput = z.object({ path: z.string().min(1).max(4000) }).strict();
const safeQuery = new Set(["tab", "view", "page", "sort", "status"]);
// A project permission or a single current workspace establishes the tenant.
// Unknown/unclaimed tenants and setup/token callbacks stay on the legacy host.
export async function resolveLegacyWorkspaceLink(ctx: Context & { user: NonNullable<Context["user"]> }, path: string) {
  if (process.env.VAETTIR_WORKSPACE_DOMAINS_ENABLED !== "1" || ctx.workspaceOrganizationId)
    return { url: null };
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    return { url: null };
  const url = new URL(path, "https://legacy.invalid");
  const match = url.pathname.match(/^\/projects\/([a-zA-Z0-9_-]{1,100})(?:\/|$)/);
  let organizationId: string;
  if (match) {
    const access = await requireProjectAccess(ctx, match[1]!);
    organizationId = access.project.organizationId;
  } else if (url.pathname === "/projects" || url.pathname === "/projects/") {
    const ids = [...new Set(ctx.user.memberships.map(m => m.organizationId))];
    if (ids.length !== 1) return { url: null };
    organizationId = ids[0]!;
    requireOrgRole(ctx, organizationId);
    await requireNotSuspended(ctx.prisma, organizationId);
  } else return { url: null };
  const claim = await ctx.prisma.workspaceDomain.findUnique({ where: { organizationId } });
  // Activation is an explicit deployment decision, independent of a claim.
  const active = new Set((process.env.VAETTIR_ACTIVE_WORKSPACE_NAMES ?? "").split(",").map(s => s.trim()).filter(Boolean));
  if (!claim || !(active.has(claim.name) || active.has("*"))) return { url: null };
  const target = new URL(url.pathname, `https://${workspaceHostname(claim.name)}`);
  for (const [name, value] of url.searchParams)
    if (safeQuery.has(name) && value.length <= 200) target.searchParams.append(name, value);
  return { url: target.toString() };
}
