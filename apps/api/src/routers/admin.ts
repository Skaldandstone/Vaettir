import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { canAddSeat, type SeatType as CoreSeatType } from "@vaettir/core";
import { router, staffProcedure } from "../trpc.js";
import { recordAudit } from "../services/auditLog.js";
import { previewOrgHardDelete, hardDeleteOrganization } from "../services/orgHardDelete.js";
import { computeRepoHealthSnapshot } from "../services/repoHealthSnapshot.js";

// Phase 13: a staff-only surface for Skald & Stone team members to look up
// accounts and handle support requests across every org - distinct from
// Phase 12's org-scoped admin UI, which is "an org admin managing their own
// org." Every mutation here reuses AuditLog's shape (P13-04) rather than a
// separate model, but is tagged distinctly from a customer's own activity
// via a `source: "staff_admin"` metadata marker and a staff-only entityType
// namespace ("Admin:*") that a customer's own audit log page never queries
// for - so this never pollutes a customer-facing audit view, but the record
// still lives in the same auditable, append-only place.
async function recordStaffAction(
  prisma: Parameters<typeof recordAudit>[0],
  args: {
    organizationId: string;
    actorId: string;
    entityType: string;
    entityId: string;
    summary: string;
    reason: string;
  },
) {
  await recordAudit(prisma, {
    organizationId: args.organizationId,
    actorId: args.actorId,
    entityType: `Admin:${args.entityType}`,
    entityId: args.entityId,
    action: "UPDATE",
    summary: args.summary,
    metadata: { source: "staff_admin", reason: args.reason },
  });
}

export const adminRouter = router({
  // P13-02: the actual "find this customer" starting point every support
  // request needs. Search is a plain case-insensitive substring match on
  // name/slug - fine at this scale, same reasoning P1-14 already used for
  // global search before revisiting for a real search index.
  listOrganizations: staffProcedure
    .input(z.object({ query: z.string().optional() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          planTierName: z.string(),
          fullSeatsUsed: z.number(),
          readOnlySeatsUsed: z.number(),
          memberCount: z.number(),
          createdAt: z.date(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const orgs = await ctx.prisma.organization.findMany({
        where: input.query
          ? { OR: [{ name: { contains: input.query, mode: "insensitive" } }, { slug: { contains: input.query, mode: "insensitive" } }] }
          : undefined,
        include: { planTier: true, memberships: { select: { seatType: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      return orgs.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        planTierName: org.planTier.name,
        fullSeatsUsed: org.memberships.filter((m) => m.seatType === "FULL").length,
        readOnlySeatsUsed: org.memberships.filter((m) => m.seatType === "READ_ONLY").length,
        memberCount: org.memberships.length,
        createdAt: org.createdAt,
      }));
    }),

  // P13-02: the detail view - org fields, plan, every member, and pending
  // invitations, all in one call so a support conversation doesn't need
  // three separate lookups.
  getOrganization: staffProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        createdAt: z.date(),
        planTierId: z.string(),
        planTierName: z.string(),
        dataRetentionYears: z.number(),
        suspendedAt: z.date().nullable(),
        suspendedReason: z.string().nullable(),
        members: z.array(
          z.object({
            membershipId: z.string(),
            userId: z.string(),
            email: z.string(),
            name: z.string().nullable(),
            role: z.string(),
            seatType: z.string(),
          }),
        ),
        invitations: z.array(
          z.object({
            id: z.string(),
            email: z.string(),
            role: z.string(),
            seatType: z.string(),
            token: z.string(),
            status: z.string(),
            expiresAt: z.date(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
        include: {
          planTier: true,
          memberships: { include: { user: true } },
          invitations: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" } },
        },
      });

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.createdAt,
        planTierId: org.planTierId,
        planTierName: org.planTier.name,
        dataRetentionYears: org.dataRetentionYears,
        suspendedAt: org.suspendedAt,
        suspendedReason: org.suspendedReason,
        members: org.memberships.map((m) => ({
          membershipId: m.id,
          userId: m.userId,
          email: m.user.email,
          name: m.user.name,
          role: m.role,
          seatType: m.seatType,
        })),
        invitations: org.invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          seatType: i.seatType,
          token: i.token,
          status: i.status,
          expiresAt: i.expiresAt,
        })),
      };
    }),

  listPlanTiers: staffProcedure.query(({ ctx }) => ctx.prisma.planTier.findMany({ orderBy: { sortOrder: "asc" } })),

  // P13-03: manually adjust a customer's plan tier ahead of P12-05's real
  // billing integration - same overflow validation changePlanTier already
  // uses (can't move an org below what's actually seated), plus a required
  // reason since this bypasses the org's own self-serve flow entirely.
  adjustPlanTier: staffProcedure
    .input(z.object({ organizationId: z.string(), planTierId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [org, targetTier] = await Promise.all([
        ctx.prisma.organization.findUniqueOrThrow({
          where: { id: input.organizationId },
          include: { memberships: { select: { seatType: true } }, planTier: true },
        }),
        ctx.prisma.planTier.findUniqueOrThrow({ where: { id: input.planTierId } }),
      ]);

      const fullSeats = org.memberships.filter((m) => m.seatType === "FULL").length;
      const readOnlySeats = org.memberships.filter((m) => m.seatType === "READ_ONLY").length;
      const overflows: string[] = [];
      if (targetTier.maxFullSeats !== null && fullSeats > targetTier.maxFullSeats) {
        overflows.push(`${fullSeats - targetTier.maxFullSeats} full seat(s)`);
      }
      if (targetTier.maxReadOnlySeats !== null && readOnlySeats > targetTier.maxReadOnlySeats) {
        overflows.push(`${readOnlySeats - targetTier.maxReadOnlySeats} read-only seat(s)`);
      }
      if (overflows.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Can't switch to ${targetTier.name}: remove ${overflows.join(" and ")} first (currently ${fullSeats} full / ${readOnlySeats} read-only seated).`,
        });
      }

      await ctx.prisma.organization.update({ where: { id: input.organizationId }, data: { planTierId: input.planTierId } });
      await recordStaffAction(ctx.prisma, {
        organizationId: input.organizationId,
        actorId: ctx.user.id,
        entityType: "PlanTier",
        entityId: input.organizationId,
        summary: `Staff switched plan from ${org.planTier.name} to ${targetTier.name}`,
        reason: input.reason,
      });
      return { planTierId: targetTier.id, planTierName: targetTier.name };
    }),

  // P13-03: "resend a stuck invite" - there's no real email dispatch built
  // anywhere in this codebase yet (invitations are token-link based), so
  // resending IS re-surfacing the existing link, not sending a new email.
  // Refreshes the expiry so a genuinely stuck/expired invite becomes usable
  // again without the customer having to re-invite from scratch.
  resendInvite: staffProcedure
    .input(z.object({ invitationId: z.string(), reason: z.string().min(1) }))
    .output(z.object({ token: z.string(), expiresAt: z.date() }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await ctx.prisma.invitation.findUniqueOrThrow({ where: { id: input.invitationId } });
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const updated = await ctx.prisma.invitation.update({
        where: { id: input.invitationId },
        data: { expiresAt, status: "PENDING" },
      });
      await recordStaffAction(ctx.prisma, {
        organizationId: invitation.organizationId,
        actorId: ctx.user.id,
        entityType: "Invitation",
        entityId: invitation.id,
        summary: `Staff refreshed invite for ${invitation.email}`,
        reason: input.reason,
      });
      return { token: updated.token, expiresAt: updated.expiresAt };
    }),

  // P13-03: deactivate a member - same "must keep at least one Owner" rule
  // as the customer-facing removeMember, since a support action shouldn't
  // be able to leave an org ownerless any more than a self-serve one can.
  deactivateMember: staffProcedure
    .input(z.object({ membershipId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.prisma.membership.findUniqueOrThrow({
        where: { id: input.membershipId },
        include: { user: true },
      });

      if (membership.role === "OWNER") {
        const otherOwners = await ctx.prisma.membership.count({
          where: { organizationId: membership.organizationId, role: "OWNER", id: { not: membership.id } },
        });
        if (otherOwners === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "An organization must have at least one Owner" });
        }
      }

      await ctx.prisma.membership.delete({ where: { id: input.membershipId } });
      await recordStaffAction(ctx.prisma, {
        organizationId: membership.organizationId,
        actorId: ctx.user.id,
        entityType: "Membership",
        entityId: membership.id,
        summary: `Staff removed member ${membership.user.email}`,
        reason: input.reason,
      });
      return { removed: true };
    }),

  // P13-03 (seat-limit adjacent): a support-only escape hatch for the seat
  // check every other invite path enforces - useful for e.g. temporarily
  // letting an over-cap org (like Skald & Stone's own Free-tier overage)
  // finish an in-progress invite while a real plan-tier fix is pending.
  // Deliberately still records who/why via the same staff audit trail.
  overrideSeatCheck: staffProcedure
    .input(z.object({ organizationId: z.string(), seatType: z.enum(["FULL", "READ_ONLY"]), reason: z.string().min(1) }))
    .output(z.object({ allowed: z.boolean(), reason: z.string().nullable() }))
    .query(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
        include: { planTier: true, memberships: { select: { seatType: true } } },
      });
      const fullSeats = org.memberships.filter((m) => m.seatType === "FULL").length;
      const readOnlySeats = org.memberships.filter((m) => m.seatType === "READ_ONLY").length;
      const check = canAddSeat(org.planTier, { fullSeats, readOnlySeats }, input.seatType as CoreSeatType);
      await recordStaffAction(ctx.prisma, {
        organizationId: input.organizationId,
        actorId: ctx.user.id,
        entityType: "SeatCheck",
        entityId: input.organizationId,
        summary: `Staff checked seat availability (${input.seatType}): ${check.allowed ? "allowed" : "blocked"}`,
        reason: input.reason,
      });
      return { allowed: check.allowed, reason: check.reason ?? null };
    }),

  // P13-05: reversible by design - the actual product-blocking effect
  // lives in trpc.ts's requireProjectAccess (every project-scoped router
  // rejects with FORBIDDEN while suspended), not a data change here.
  // staffProcedure itself is never gated on suspension, so this remains
  // reachable specifically so it can be lifted again.
  suspendOrganization: staffProcedure
    .input(z.object({ organizationId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
      if (org.suspendedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This organization is already suspended" });
      }
      await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: { suspendedAt: new Date(), suspendedReason: input.reason },
      });
      await recordStaffAction(ctx.prisma, {
        organizationId: input.organizationId,
        actorId: ctx.user.id,
        entityType: "Organization",
        entityId: input.organizationId,
        summary: `Staff suspended organization "${org.name}"`,
        reason: input.reason,
      });
      return { suspended: true };
    }),

  reactivateOrganization: staffProcedure
    .input(z.object({ organizationId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
      if (!org.suspendedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This organization is not suspended" });
      }
      await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: { suspendedAt: null, suspendedReason: null },
      });
      await recordStaffAction(ctx.prisma, {
        organizationId: input.organizationId,
        actorId: ctx.user.id,
        entityType: "Organization",
        entityId: input.organizationId,
        summary: `Staff reactivated organization "${org.name}" (was suspended: ${org.suspendedReason ?? "no reason recorded"})`,
        reason: input.reason,
      });
      return { suspended: false };
    }),

  // P13-05: a real handoff, not just an addition - the target becomes
  // OWNER, and the specified previous owner is demoted to ADMIN (still a
  // full member, just no longer the org's Owner) rather than removed
  // outright. Distinct from deactivateMember's "at least one Owner"
  // guard: this is a same-organization role swap, so the org is never
  // ownerless even mid-operation.
  transferOwnership: staffProcedure
    .input(z.object({ organizationId: z.string(), newOwnerMembershipId: z.string(), previousOwnerMembershipId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [newOwner, previousOwner] = await Promise.all([
        ctx.prisma.membership.findUniqueOrThrow({ where: { id: input.newOwnerMembershipId }, include: { user: true } }),
        ctx.prisma.membership.findUniqueOrThrow({ where: { id: input.previousOwnerMembershipId }, include: { user: true } }),
      ]);
      if (newOwner.organizationId !== input.organizationId || previousOwner.organizationId !== input.organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Both members must belong to the target organization" });
      }
      if (previousOwner.role !== "OWNER") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The specified previous owner does not currently hold the Owner role" });
      }
      if (newOwner.id === previousOwner.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot transfer ownership to the same member" });
      }

      await ctx.prisma.$transaction([
        ctx.prisma.membership.update({ where: { id: newOwner.id }, data: { role: "OWNER", seatType: "FULL" } }),
        ctx.prisma.membership.update({ where: { id: previousOwner.id }, data: { role: "ADMIN" } }),
      ]);
      await recordStaffAction(ctx.prisma, {
        organizationId: input.organizationId,
        actorId: ctx.user.id,
        entityType: "Membership",
        entityId: newOwner.id,
        summary: `Staff transferred ownership from ${previousOwner.user.email} to ${newOwner.user.email}`,
        reason: input.reason,
      });
      return { newOwnerEmail: newOwner.user.email };
    }),

  // P13-05: hard-delete, the genuinely irreversible half. Read-only -
  // returns exactly what commitHardDeleteOrganization would remove, per
  // model, so the confirmation UI shows real numbers before anything is
  // destroyed. See services/orgHardDelete.ts for the full FK-order
  // reasoning (queried directly from Postgres, not hand-traced) and why
  // ComplianceFramework/ComplianceControl are deliberately never touched
  // (shared platform-wide reference data, not owned by any one org).
  previewOrgHardDelete: staffProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(({ ctx, input }) => previewOrgHardDelete(ctx.prisma, input.organizationId)),

  // Requires typing the org's exact slug as confirmation (not just a
  // click) - the same "type to confirm" pattern GitHub/most platforms use
  // for their own most destructive action, checked server-side so it
  // can't be bypassed by hitting the API directly. Writes a permanent
  // OrganizationDeletionLog row (NOT a normal AuditLog entry - see that
  // model's own comment for why a live FK to the now-gone org wouldn't
  // survive this) before returning, so "org X was hard-deleted, by whom,
  // when, why, and exactly what was removed" is provable after the fact.
  hardDeleteOrganization: staffProcedure
    .input(z.object({ organizationId: z.string(), confirmSlug: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
      if (input.confirmSlug !== org.slug) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Confirmation text must exactly match the organization's slug ("${org.slug}")` });
      }
      return hardDeleteOrganization(ctx.prisma, input.organizationId, ctx.user.id, input.reason);
    }),

  // P13-04: the admin action audit trail itself - every mutation above
  // writes through recordStaffAction, this surfaces it back. Scoped to a
  // specific org (matches how support actually works: "show me everything
  // staff has done to THIS account") rather than a firehose across every
  // org at once.
  staffActionLog: staffProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          actorEmail: z.string(),
          entityType: z.string(),
          summary: z.string(),
          reason: z.string().nullable(),
          createdAt: z.date(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const entries = await ctx.prisma.auditLog.findMany({
        where: { organizationId: input.organizationId, entityType: { startsWith: "Admin:" } },
        include: { actor: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return entries.map((e) => ({
        id: e.id,
        actorEmail: e.actor.email,
        entityType: e.entityType,
        summary: e.summary,
        reason: (e.metadata as { reason?: string } | null)?.reason ?? null,
        createdAt: e.createdAt,
      }));
    }),

  // Lightweight, on-demand-only replacement for the standalone
  // quality_dashboard CLI (ported from the rescued Skaldandstone/
  // test-case-management-platform repo, now retired): GitHub Actions job
  // pass-rate/flakiness plus a git-churn risk footprint for ANY repo,
  // without that repo needing to be a Vaettir customer with onboarded
  // test-case data. Deliberately not persisted -- no snapshot table, no
  // schedule -- staff runs it and reads the numbers, same as the CLI.
  repoHealthSnapshot: staffProcedure
    .input(
      z.object({
        repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "repo must be \"owner/name\""),
        workflowFile: z.string().default("ci.yml"),
        runs: z.number().int().min(1).max(100).default(50),
        sinceDays: z.number().int().min(1).max(365).default(90),
        topN: z.number().int().min(1).max(50).default(15),
      }),
    )
    .query(({ input }) =>
      computeRepoHealthSnapshot(input.repo, {
        workflowFile: input.workflowFile,
        runs: input.runs,
        sinceDays: input.sinceDays,
        topN: input.topN,
      }),
    ),
});
