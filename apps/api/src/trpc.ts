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

  return { prisma, user };
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

// P13-01: staff auth gate. Deliberately independent of any Membership --
// a customer OWNER in their own org must not get access here, and a Skald
// & Stone staff member shouldn't need a Membership in every customer org
// just to look one up. Gated on the user's real Clerk-verified email
// (never client-suppliable), matched against a configured staff domain
// (default skaldandstone.com) plus an optional explicit allowlist for
// staff on a different domain.
const STAFF_EMAIL_DOMAIN = (process.env.STAFF_EMAIL_DOMAIN ?? "skaldandstone.com").toLowerCase();
const STAFF_EMAIL_ALLOWLIST = new Set(
  (process.env.STAFF_EMAIL_ALLOWLIST ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function isStaffEmail(email: string): boolean {
  const normalized = email.toLowerCase();
  return normalized.endsWith(`@${STAFF_EMAIL_DOMAIN}`) || STAFF_EMAIL_ALLOWLIST.has(normalized);
}

export const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isStaffEmail(ctx.user.email)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Staff access required" });
  }
  return next({ ctx });
});
