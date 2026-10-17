import { z } from "zod";
import type { Context } from "../trpc.js";
import { requireProjectAccess } from "../trpc.js";
import { workspaceHostname } from "@vaettir/core";

export const legacyWorkspaceLinkInput = z.object({ path: z.string().min(1).max(4000) }).strict();
const safeQuery = new Set(["tab", "view", "page", "sort", "status"]);
// Only authenticated, project-addressed links have an unambiguous tenant.
// Unknown/unclaimed tenants and setup/token callbacks stay on the legacy host.
export async function resolveLegacyWorkspaceLink(ctx: Context & { user: NonNullable<Context["user"]> }, path: string) {
  if (process.env.VAETTIR_WORKSPACE_DOMAINS_ENABLED !== "1" || ctx.workspaceOrganizationId)
    return { url: null };
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    return { url: null };
  const url = new URL(path, "https://legacy.invalid");
  const match = url.pathname.match(/^\/projects\/([a-zA-Z0-9_-]{1,100})(?:\/|$)/);
  if (!match) return { url: null };
  const { project } = await requireProjectAccess(ctx, match[1]!);
  const claim = await ctx.prisma.workspaceDomain.findUnique({ where: { organizationId: project.organizationId } });
  // Activation is an explicit deployment decision, independent of a claim.
  const active = new Set((process.env.VAETTIR_ACTIVE_WORKSPACE_NAMES ?? "").split(",").map(s => s.trim()).filter(Boolean));
  if (!claim || !active.has(claim.name)) return { url: null };
  const target = new URL(url.pathname, `https://${workspaceHostname(claim.name)}`);
  for (const [name, value] of url.searchParams)
    if (safeQuery.has(name) && value.length <= 200) target.searchParams.append(name, value);
  return { url: target.toString() };
}
