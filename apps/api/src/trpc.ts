import { TRPCError, initTRPC } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { prisma, type OrgRole } from "@tci/db";
import { verifyClerkSessionToken, getOrCreateLocalUser } from "./clerk.js";

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim() || null;
}

export async function createContext({ req }: CreateFastifyContextOptions) {
  const token = extractBearerToken(req.headers.authorization);
  const clerkUserId = token ? await verifyClerkSessionToken(token) : null;

  const user = clerkUserId
    ? await getOrCreateLocalUser(clerkUserId).then((u) =>
        prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { memberships: true } }),
      )
    : null;

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

  const membership = ctx.user.memberships.find((m) => m.organizationId === project.organizationId);
  if (!membership || ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this project's organization" });
  }

  return { project, membership };
}
