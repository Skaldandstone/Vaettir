import { TRPCError, initTRPC } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { prisma, type OrgRole } from "@vaettir/db";
import { verifyClerkSessionToken, getOrCreateLocalUser } from "./clerk.js";
import { hashApiKey, looksLikeApiKey } from "./services/apiKeyAuth.js";

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim() || null;
}

// A CI service token (P1-05) resolves to its backing service User exactly
// like a human session resolves to theirs -- from here on, every
// protectedProcedure/requireOrgRole/audit-column call treats it identically.
async function resolveApiKeyUser(rawKey: string) {
  const apiKey = await prisma.apiKey.findUnique({ where: { hashedKey: hashApiKey(rawKey) } });
  if (!apiKey || apiKey.revokedAt) return null;
  // Best-effort last-used tracking; never let it block or fail the request.
  prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return prisma.user.findUnique({ where: { id: apiKey.serviceUserId }, include: { memberships: true } });
}

// The staff plane is a SEPARATE identity from tenant users: cross-org support
// access authorized by a single shared secret (STAFF_ADMIN_TOKEN), never an
// OWNER membership grafted onto a customer's org. The Skald & Stone Adminhelper
// Worker holds the token and forwards the Access-authenticated staff email as
// X-Staff-Actor for the audit trail. When the env secret is unset the plane is
// disabled outright.
function resolveStaff(headers: CreateFastifyContextOptions["req"]["headers"]): { actor: string } | null {
  const expected = process.env.STAFF_ADMIN_TOKEN;
  const provided = headers["x-staff-token"];
  if (!expected || typeof provided !== "string" || provided.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  const actor = headers["x-staff-actor"];
  return { actor: typeof actor === "string" && actor ? actor : "unknown" };
}

export async function createContext({ req }: CreateFastifyContextOptions) {
  const token = extractBearerToken(req.headers.authorization);

  const user = !token
    ? null
    : looksLikeApiKey(token)
      ? await resolveApiKeyUser(token)
      : await verifyClerkSessionToken(token).then((clerkUserId) =>
          clerkUserId
            ? getOrCreateLocalUser(clerkUserId).then((u) =>
                prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { memberships: true } }),
              )
            : null,
        );

  return { prisma, user, staff: resolveStaff(req.headers) };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Requires a valid Clerk session; does not by itself check org/project
// membership -- see requireProjectAccess for that. Every router handling
// org-scoped data should build on this, not publicProcedure (P1-02).
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Cross-org staff support access. Gated only by the staff plane (not tenant
// membership), so every procedure built on it is read-oriented and its calls
// are audited at the Adminhelper layer by the forwarded X-Staff-Actor.
export const staffProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.staff) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Staff access token required" });
  }
  return next({ ctx: { ...ctx, staff: ctx.staff } });
});

const ROLE_RANK: Record<OrgRole, number> = {
  VIEWER: 0,
  COMPLIANCE_AUDITOR: 1,
  EDITOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

/**
 * Enforces that the current session user belongs to `organizationId` at or
 * above `minRole`. The building block both requireProjectAccess and any
 * org-level router (settings, seats, billing) should use.
 */
export function requireOrgRole(
  ctx: { user: NonNullable<Context["user"]> },
  organizationId: string,
  minRole: OrgRole = "VIEWER",
) {
  const membership = ctx.user.memberships.find((m) => m.organizationId === organizationId);
  if (!membership || ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  }
  return membership;
}

/**
 * Enforces that the current session user belongs to the organization that
 * owns `projectId`, at or above `minRole`. This is what makes org/project
 * scoping real (P1-06) instead of trusting a client-supplied projectId --
 * every router resolving a project must call this before touching data.
 */
export async function requireProjectAccess(
  ctx: { prisma: typeof prisma; user: NonNullable<Context["user"]> },
  projectId: string,
  minRole: OrgRole = "VIEWER",
) {
  const project = await ctx.prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, organizationId: true },
  });
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  const membership = requireOrgRole(ctx, project.organizationId, minRole);
  return { project, membership };
}
