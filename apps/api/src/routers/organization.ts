import { z } from "zod";
import {
  DEFAULT_STEP_FIELD_LABELS,
  resolveStepFieldLabels,
  minimumTierForSeatCount,
  type StepFieldKey,
} from "@vaettir/core";
import { router, protectedProcedure, requireOrgRole, requireNotSuspended } from "../trpc.js";
import type { PrismaClient } from "@vaettir/db";
import { sendReadinessDigestForOrg } from "../jobs/readinessDigestScheduler.js";
import { getAiCreditBalance } from "../services/aiCredits.js";
import { computeRetentionDryRun } from "../services/retentionAudit.js";
import { bootstrapBetaOrganization } from "../services/privateBeta.js";

import * as seats from "../services/seatManagement.js";
import { effectiveSeatLimits } from "../services/billingSeats.js";

async function getSeatCounts(prisma: PrismaClient, organizationId: string) {
  const [fullSeats, readOnlySeats] = await Promise.all([
    prisma.membership.count({ where: { organizationId, seatType: "FULL" } }),
    prisma.membership.count({ where: { organizationId, seatType: "READ_ONLY" } }),
  ]);
  return { fullSeats, readOnlySeats };
}

const stepFieldLabelsInputSchema = z.object(
  Object.fromEntries(Object.keys(DEFAULT_STEP_FIELD_LABELS).map((k) => [k, z.string().min(1).optional()])) as Record<
    StepFieldKey,
    z.ZodOptional<z.ZodString>
  >,
);

export const organizationRouter = router({
  // Clerk only knows about the signed-in person, not our org/seat model.
  // A brand-new Clerk user has zero Memberships until they either create an
  // org (this) or accept an invite (P12-02, not yet built) -- the web app's
  // onboarding step calls this the first time someone signs in with no
  // memberships.
  bootstrap: protectedProcedure
    .input(z.object({ organizationName: z.string().trim().min(1).max(120) }))
    .mutation(({ ctx, input }) => bootstrapBetaOrganization(ctx.prisma, ctx.user, input.organizationName)),

  // .output() bounds the inferred type instead of letting it flow straight
  // from Prisma's Organization model -- see testCases.ts's byId for why
  // (TS2589, deep instantiation, once enough routers compose in one AppRouter).
  // P12-03: role/seatType are the CALLING USER's own membership in each org
  // (not the org's overall data), read off ctx.user.memberships already
  // loaded on context rather than a second query - this is what the web
  // app's read-only UI gating (lib/membership.ts) is built on.
  mine: protectedProcedure
    .output(z.array(z.object({ id: z.string(), name: z.string(), slug: z.string(), role: z.string(), seatType: z.string() })))
    .query(({ ctx }) =>
      ctx.prisma.organization
        .findMany({
          where: { id: { in: ctx.user.memberships.map((m) => m.organizationId) }, suspendedAt: null, memberships: { some: { userId: ctx.user.id } } },
          select: { id: true, name: true, slug: true },
        })
        .then((orgs) =>
          orgs.map((org) => {
            const membership = ctx.user.memberships.find((m) => m.organizationId === org.id)!;
            return { ...org, role: membership.role, seatType: membership.seatType };
          }),
        ),
    ),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        stepFieldLabelOverrides: z.record(z.string()),
        stepFieldLabels: z.record(z.string()),
        dataRetentionYears: z.number(),
        releaseGatePolicy: z.string(),
        slackWebhookConfigured: z.boolean(),
        digestEnabled: z.boolean(),
        digestHourUtc: z.number().nullable(),
        lastDigestSentAt: z.date().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.id);
      const org = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: input.id },
        select: {
          id: true,
          name: true,
          slug: true,
          stepFieldLabels: true,
          dataRetentionYears: true,
          releaseGatePolicy: true,
          slackWebhookUrl: true,
          digestEnabled: true,
          digestHourUtc: true,
          lastDigestSentAt: true,
        },
      });
      const overrides = (org.stepFieldLabels as Partial<Record<StepFieldKey, string>> | null) ?? {};
      // Strip undefined entries -- Partial<...> allows them, but the output
      // schema (and the JSON response) shouldn't carry keys with no value.
      const definedOverrides = Object.fromEntries(
        Object.entries(overrides).filter((entry): entry is [string, string] => entry[1] !== undefined),
      );
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        stepFieldLabelOverrides: definedOverrides,
        stepFieldLabels: resolveStepFieldLabels(overrides),
        dataRetentionYears: org.dataRetentionYears,
        releaseGatePolicy: org.releaseGatePolicy,
        slackWebhookConfigured: org.slackWebhookUrl !== null,
        digestEnabled: org.digestEnabled,
        digestHourUtc: org.digestHourUtc,
        lastDigestSentAt: org.lastDigestSentAt,
      };
    }),

  // P3-08: how long evidence/audit-log/test-result data is kept before it's
  // eligible for deletion. This only sets the configured policy - the actual
  // purge job (P12-08) doesn't exist yet, so changing this today has no
  // immediate effect beyond recording the org's intent. Different compliance
  // frameworks mandate different minimums (e.g. SOC 2 commonly expects
  // multi-year retention), so a floor is enforced rather than letting an org
  // configure something a real auditor would reject outright.
  updateDataRetention: protectedProcedure
    .input(z.object({ organizationId: z.string(), dataRetentionYears: z.number().int().min(1).max(20) }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      const org = await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: { dataRetentionYears: input.dataRetentionYears },
        select: { dataRetentionYears: true },
      });
      return org;
    }),

  // P7-08: SOFT_WARNING (default) lets the readiness page surface unmet
  // criteria/open CRITICAL flags without stopping anyone; HARD_BLOCK makes
  // releases.updateStatus refuse the READY transition server-side, so it
  // can't be bypassed by hitting the API directly either.
  updateReleaseGatePolicy: protectedProcedure
    .input(z.object({ organizationId: z.string(), releaseGatePolicy: z.enum(["SOFT_WARNING", "HARD_BLOCK"]) }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      const org = await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: { releaseGatePolicy: input.releaseGatePolicy },
        select: { releaseGatePolicy: true },
      });
      return org;
    }),

  // P7-09: the webhook URL is write-only from the client's perspective
  // (byId only ever reports slackWebhookConfigured, a boolean) -- it's a
  // bearer-token-like secret (anyone holding it can post to the channel),
  // so it's never round-tripped back to every VIEWER who can load org
  // settings. Passing an empty string clears it (and turns digestEnabled
  // off, since an enabled digest with no destination doesn't mean anything).
  updateDigestSettings: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        slackWebhookUrl: z.string().optional(),
        digestEnabled: z.boolean(),
        digestHourUtc: z.number().int().min(0).max(23).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      const data: { slackWebhookUrl?: string | null; digestEnabled: boolean; digestHourUtc: number | null } = {
        digestEnabled: input.digestEnabled,
        digestHourUtc: input.digestHourUtc,
      };
      if (input.slackWebhookUrl !== undefined) {
        data.slackWebhookUrl = input.slackWebhookUrl.trim().length > 0 ? input.slackWebhookUrl.trim() : null;
      }
      if (data.slackWebhookUrl === null) data.digestEnabled = false;
      await ctx.prisma.organization.update({ where: { id: input.organizationId }, data });
    }),

  // Fires a digest immediately -- both "test my webhook" during setup and
  // the "pre-release summary" half of P7-09's ticket (send-on-demand
  // rather than waiting for the daily schedule).
  sendTestDigest: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      await sendReadinessDigestForOrg(input.organizationId);
    }),

  // Renames the display labels for TestCaseStep's four fields (see
  // Organization.stepFieldLabels). Only fields present in the input are
  // set; omit a field to leave it at whatever it currently is (or the
  // default, if never overridden) rather than resetting it.
  updateStepFieldLabels: protectedProcedure
    .input(z.object({ organizationId: z.string(), labels: stepFieldLabelsInputSchema }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      const org = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
        select: { stepFieldLabels: true },
      });
      const current = (org.stepFieldLabels as Partial<Record<StepFieldKey, string>> | null) ?? {};
      const merged = { ...current, ...input.labels };
      await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: { stepFieldLabels: merged },
      });
      return resolveStepFieldLabels(merged);
    }),

  listMembers: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          role: z.string(),
          seatType: z.string(),
          userEmail: z.string(),
          userName: z.string().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId);
      const memberships = await ctx.prisma.membership.findMany({
        where: { organizationId: input.organizationId },
        include: { user: { select: { email: true, name: true } } },
        orderBy: { createdAt: "asc" },
      });
      return memberships.map((m) => ({
        id: m.id,
        role: m.role,
        seatType: m.seatType,
        userEmail: m.user.email,
        userName: m.user.name,
      }));
    }),

  listInvitations: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          email: z.string(),
          role: z.string(),
          seatType: z.string(),
          token: z.string(),
          expiresAt: z.date(),
        }),
      ),
    )
    .query(({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      return ctx.prisma.invitation.findMany({
        where: { organizationId: input.organizationId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
    }),

  // Unexpired pending invitations reserve seats. All seat writers serialize
  // on the organization row and recheck membership after acquiring the lock.
  inviteMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        email: z.string().email(),
        role: z.enum(["ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"]),
        seatType: z.enum(["FULL", "READ_ONLY"]).default("FULL"),
      }),
    )
    .output(z.object({ id: z.string(), token: z.string(), expiresAt: z.date() }))
    .mutation(({ ctx, input }) => seats.inviteMember(ctx.prisma, ctx.user.id, input)),

  // Changing role/seatType is checked the same way an invite is: the seat
  // limit only applies when the change actually consumes a seat that wasn't
  // already held. Both directions enforce the destination seat limit.
  updateMember: protectedProcedure
    .input(
      z.object({
        membershipId: z.string(),
        role: z.enum(["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"]),
        seatType: z.enum(["FULL", "READ_ONLY"]),
      }),
    )
    .mutation(({ ctx, input }) => seats.updateMember(ctx.prisma, ctx.user.id, input)),

  removeMember: protectedProcedure
    .input(z.object({ membershipId: z.string() }))
    .mutation(({ ctx, input }) => seats.removeMember(ctx.prisma, ctx.user.id, input.membershipId)),

  revokeInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(({ ctx, input }) => seats.revokeInvitation(ctx.prisma, ctx.user.id, input.invitationId)),

  // Looks up the invitation by token for display before the user commits --
  // deliberately returns org/role details without requiring the email match
  // yet, so a signed-in user can see what they're being offered.
  previewInvitation: protectedProcedure
    .input(z.object({ token: z.string() }))
    .output(
      z.object({
        organizationName: z.string(),
        role: z.string(),
        seatType: z.string(),
        status: z.string(),
        expired: z.boolean(),
        emailMatches: z.boolean(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const invitation = await ctx.prisma.invitation.findUniqueOrThrow({
        where: { token: input.token },
        include: { organization: { select: { name: true } } },
      });
      return {
        organizationName: invitation.organization.name,
        role: invitation.role,
        seatType: invitation.seatType,
        status: invitation.status,
        expired: invitation.expiresAt < new Date(),
        emailMatches: invitation.email.toLowerCase() === ctx.user.email.toLowerCase(),
      };
    }),

  acceptInvitation: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(({ ctx, input }) => seats.acceptInvitation(ctx.prisma, ctx.user, input.token)),

  // P12-08 (dry-run half): read-only report of what's currently older than
  // the org's retention window - no delete/purge capability exists yet
  // (see services/retentionAudit.ts). ADMIN-gated since it's compliance-
  // sensitive detail, not general org info.
  retentionDryRun: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.object({
        retentionYears: z.number(),
        cutoffDate: z.date(),
        auditLogRowsEligible: z.number(),
        oldestAuditLogDate: z.date().nullable(),
        testRunRowsEligible: z.number(),
        testResultArtifactRowsEligible: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      return computeRetentionDryRun(ctx.prisma, input.organizationId);
    }),

  // Plan tiers, sorted for display in a picker (Free -> Team -> Business ->
  // Corp). Public within an authenticated session -- pricing itself isn't
  // sensitive, and a user picking a plan needs to see all of them, not just
  // their org's current one.
  listPlanTiers: protectedProcedure
    .output(
      z.array(
        z.object({
          id: z.string(),
          key: z.string(),
          name: z.string(),
          sortOrder: z.number(),
          minFullSeats: z.number(),
          maxFullSeats: z.number().nullable(),
          includedReadOnlySeats: z.number(),
          maxReadOnlySeats: z.number().nullable(),
          monthlyPricePerSeatCents: z.number().nullable(),
          includedAiCreditsPerMonth: z.number(),
          enabledFeatures: z.array(z.string()),
        }),
      ),
    )
    .query(({ ctx }) => ctx.prisma.planTier.findMany({ where: { isPublic: true }, orderBy: { sortOrder: "asc" } })),

  // P12-04: switching plans is validated against ACTUAL seated usage, not
  // just accepted and left to silently misbehave -- a downgrade that would
  // leave the org over the new tier's seat caps is refused, and the error
  // says exactly how many of which seat type would need to go first, so an
  // admin isn't left guessing why the change failed.
  changePlanTier: protectedProcedure
    .input(z.object({ organizationId: z.string(), planTierId: z.string() }))
    .mutation(({ ctx, input }) => seats.changePlanTier(ctx.prisma, ctx.user.id, input.organizationId, input.planTierId)),

  // P12-06: current seats used vs. included at this tier, plus which tier
  // one more full seat would actually require -- so an admin sees "you're
  // at 9/10, the next seat needs Team" BEFORE they hit the wall mid-invite
  // (inviteMember's canAddSeat check still enforces this regardless; this
  // is purely the "don't be surprised" visibility layer).
  seatUsage: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.object({
        planTierId: z.string(),
        planTierName: z.string(),
        fullSeatsUsed: z.number(),
        fullSeatsIncluded: z.number().nullable(),
        readOnlySeatsUsed: z.number(),
        readOnlySeatsIncluded: z.number(),
        readOnlySeatsMax: z.number().nullable(),
        nextTierNameForOneMoreFullSeat: z.string().nullable(),
        privateBeta: z.boolean(),
        billingManaged: z.boolean(),
        fullSeatsReserved: z.number(),
        readOnlySeatsReserved: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId);
      await requireNotSuspended(ctx.prisma, input.organizationId);
      const [org, counts, allTiers, pending] = await Promise.all([
        ctx.prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId }, include: { planTier: true } }),
        getSeatCounts(ctx.prisma, input.organizationId),
        ctx.prisma.planTier.findMany({ where: { isPublic: true } }),
        ctx.prisma.invitation.findMany({ where: { organizationId: input.organizationId, status: "PENDING", expiresAt: { gt: new Date() } }, select: { seatType: true } }),
      ]);

      let nextTierNameForOneMoreFullSeat: string | null = null;
      const billingManaged = !!await ctx.prisma.stripeBillingAccount.findUnique({ where: { organizationId: org.id }, select: { id: true } });
      if (!billingManaged && org.planTier.isPublic && org.planTier.maxFullSeats !== null && counts.fullSeats >= org.planTier.maxFullSeats) {
        const next = minimumTierForSeatCount(allTiers, counts.fullSeats + 1);
        if (next.key !== org.planTier.key) nextTierNameForOneMoreFullSeat = allTiers.find((t) => t.key === next.key)!.name;
      }

      return {
        planTierId: org.planTier.id,
        planTierName: org.planTier.name,
        fullSeatsUsed: counts.fullSeats,
        fullSeatsIncluded: effectiveSeatLimits(org).maxFullSeats,
        readOnlySeatsUsed: counts.readOnlySeats,
        readOnlySeatsIncluded: org.planTier.includedReadOnlySeats,
        readOnlySeatsMax: org.planTier.maxReadOnlySeats,
        nextTierNameForOneMoreFullSeat,
        privateBeta: org.planTier.key === "private-beta",
        billingManaged,
        fullSeatsReserved: pending.filter((i) => i.seatType === "FULL").length,
        readOnlySeatsReserved: pending.filter((i) => i.seatType === "READ_ONLY").length,
      };
    }),

  // AI credit visibility: the running balance plus a recent-activity feed
  // (grants, consumption by operation, top-ups) so an admin can see where
  // credits went, not just a mystery number - same "auditable, not just a
  // counter" reasoning as the ledger itself (see AiCreditTransaction).
  aiCreditStatus: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.object({
        balance: z.number(),
        includedPerMonth: z.number(),
        planTierName: z.string(),
        recent: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            amount: z.number(),
            operation: z.string().nullable(),
            description: z.string().nullable(),
            createdAt: z.date(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId);
      const [balance, org, recent] = await Promise.all([
        getAiCreditBalance(ctx.prisma, input.organizationId),
        ctx.prisma.organization.findUniqueOrThrow({
          where: { id: input.organizationId },
          select: { planTier: { select: { name: true, includedAiCreditsPerMonth: true } } },
        }),
        ctx.prisma.aiCreditTransaction.findMany({
          where: { organizationId: input.organizationId },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      ]);
      return {
        balance,
        includedPerMonth: org.planTier.includedAiCreditsPerMonth,
        planTierName: org.planTier.name,
        recent,
      };
    }),
});
