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

// Cross-org staff support access for the admin PORTAL (grok-adminhelper
// Worker), which authenticates with X-Staff-Token and is not a Clerk user -
// deliberately distinct from the Clerk-email-gated `staffProcedure` below,
// which serves staff humans signed into the product itself. Calls are audited
// at the Adminhelper layer via the forwarded X-Staff-Actor.
export const staffTokenProcedure = t.procedure.use(({ ctx, next }) => {
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

// P13-05: a suspended org's members are rejected here regardless of role -
// even an OWNER can't work around a staff suspension through the customer-
// facing surface. Deliberately a separate check from requireOrgRole rather
// than folded into it, since staffProcedure's own admin mutations (the ONLY
// way to actually lift a suspension) must stay reachable on a suspended org -
// requireProjectAccess calls this, staffProcedure never does.
export async function requireNotSuspended(db: typeof prisma, organizationId: string) {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { suspendedAt: true } });
  if (org?.suspendedAt) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This organization has been suspended. Contact support." });
  }
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
  await requireNotSuspended(ctx.prisma, project.organizationId);
  return { project, membership };
}

// P13-01: owner/staff auth gate. Deliberately independent of any Membership --
// a customer OWNER in their own org must not get access here, and a Skald
// & Stone staff member shouldn't need a Membership in every customer org
// just to look one up. Gated on the user's real Clerk-verified email
// (never client-suppliable), matched against an exact allowlist. A domain
// match is intentionally insufficient: public sign-up means another address
// at the company domain must not silently inherit cross-organization access.
// Keep the old STAFF_EMAIL_ALLOWLIST name as a deployment-compatible fallback,
// but the default and preferred variable grant only James full product access.
const DEFAULT_FULL_ACCESS_EMAIL = "james@skaldandstone.com";

function fullAccessEmailAllowlist() {
  const configured = process.env.FULL_ACCESS_EMAIL_ALLOWLIST?.trim()
    || process.env.STAFF_EMAIL_ALLOWLIST?.trim()
    || DEFAULT_FULL_ACCESS_EMAIL;
  return new Set(
    configured
      .split(",")
      .map((e: string) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isStaffEmail(email: string): boolean {
  return fullAccessEmailAllowlist().has(email.trim().toLowerCase());
}

export const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isStaffEmail(ctx.user.email)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Staff access required" });
  }
  return next({ ctx });
});

// SSE-181 (live-app test generation): a real gap deliberately kept
// narrower than staffProcedure above. Server-side browser automation
// against an arbitrary caller-supplied URL is a genuinely new, unproven
// capability - it goes through the same SSRF-hardened URL guard every
// other server-side URL fetch in this codebase uses (services/urlGuard.ts),
// but "the guard held" isn't the same bar as "this is ready for every
// staff member to use against arbitrary targets." Scoped to a specific
// allowlist (defaulting to just James) rather than the whole staff domain,
// on direct instruction, until this has real usage behind it. Widening
// this to staffProcedure (or further) is a deliberate later decision, not
// a default to relax toward.
const LIVE_APP_SCAN_ALLOWLIST = new Set(
  (process.env.LIVE_APP_SCAN_ALLOWLIST ?? "james@skaldandstone.com")
    .split(",")
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean),
);

export const liveAppScanProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!LIVE_APP_SCAN_ALLOWLIST.has(ctx.user.email.toLowerCase())) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This feature is limited to a small allowlist while it's new and unproven." });
  }
  return next({ ctx });
});
