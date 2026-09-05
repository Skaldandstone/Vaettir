import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DEFAULT_STEP_FIELD_LABELS,
  resolveStepFieldLabels,
  canAddSeat,
  minimumTierForSeatCount,
  type StepFieldKey,
  type SeatType as CoreSeatType,
} from "@vaettir/core";
import { router, protectedProcedure, requireOrgRole } from "../trpc.js";
import type { PrismaClient } from "@vaettir/db";
import { sendReadinessDigestForOrg } from "../jobs/readinessDigestScheduler.js";
import { getAiCreditBalance } from "../services/aiCredits.js";
import { computeRetentionDryRun } from "../services/retentionAudit.js";
import { WEBHOOK_EVENT_TYPES } from "../services/webhookDelivery.js";
import { assertPublicHttpUrl, UnsafeUrlError } from "../services/urlGuard.js";

const INVITATION_EXPIRY_DAYS = 7;

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

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "org"
  );
}

export const organizationRouter = router({
  // Clerk only knows about the signed-in person, not our org/seat model.
  // A brand-new Clerk user has zero Memberships until they either create an
  // org (this) or accept an invite (P12-02, not yet built) -- the web app's
  // onboarding step calls this the first time someone signs in with no
  // memberships.
  bootstrap: protectedProcedure
    .input(z.object({ organizationName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.memberships.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "User already belongs to an organization" });
      }

      const freeTier = await ctx.prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });

      const baseSlug = slugify(input.organizationName);
      let slug = baseSlug;
      let suffix = 1;
      while (await ctx.prisma.organization.findUnique({ where: { slug } })) {
        slug = `${baseSlug}-${++suffix}`;
      }

      return ctx.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: { name: input.organizationName, slug, planTierId: freeTier.id },
        });
        await tx.membership.create({
          data: { organizationId: organization.id, userId: ctx.user.id, role: "OWNER", seatType: "FULL" },
        });
        return organization;
      });
    }),

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
          where: { memberships: { some: { userId: ctx.user.id } } },
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
        slackEventTypes: z.array(z.string()),
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
          slackEventTypes: true,
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
        slackEventTypes: org.slackEventTypes,
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
        const trimmed = input.slackWebhookUrl.trim();
        if (trimmed.length > 0) {
          try {
            await assertPublicHttpUrl(trimmed);
          } catch (err) {
            if (err instanceof UnsafeUrlError) {
              throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
            }
            throw err;
          }
        }
        data.slackWebhookUrl = trimmed.length > 0 ? trimmed : null;
      }
      if (data.slackWebhookUrl === null) data.digestEnabled = false;
      await ctx.prisma.organization.update({ where: { id: input.organizationId }, data });
    }),

  // Fires a digest immediately -- both "test my webhook" during setup and
  // the "pre-release summary" half of P7-09's ticket (send-on-demand
  // rather than waiting for the daily schedule).
  // P9-03: which of WEBHOOK_EVENT_TYPES should also post to the same Slack
  // webhook the digest above uses, in real time as they happen - a second,
  // independent subscriber of the exact same events P9-06's outbound
  // webhook system already dispatches, not a replacement for it. Doesn't
  // require slackWebhookUrl to already be set (an org can pick event types
  // ahead of adding a webhook; nothing sends until both exist), matching
  // notifySlackEvent's own no-op-when-unconfigured guard.
  updateSlackEventTypes: protectedProcedure
    .input(z.object({ organizationId: z.string(), eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)) }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      await ctx.prisma.organization.update({
        where: { id: input.organizationId },
        data: { slackEventTypes: input.eventTypes },
      });
    }),

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
          userId: z.string(),
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
        userId: m.userId,
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

  // Seat availability is checked here (at invite time) AND again in
  // acceptInvitation (at accept time), since usage can change in between --
  // an invite is a standing offer against a seat, not a seat hold.
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
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");

      if (input.seatType === "READ_ONLY" && input.role !== "VIEWER") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Read-only seats can only hold the Viewer role" });
      }

      const org = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
        include: { planTier: true },
      });
      const counts = await getSeatCounts(ctx.prisma, input.organizationId);
      const check = canAddSeat(org.planTier, counts, input.seatType as CoreSeatType);
      if (!check.allowed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: check.reason ?? "Seat limit reached" });
      }

      const existingMember = await ctx.prisma.membership.findFirst({
        where: { organizationId: input.organizationId, user: { email: input.email } },
      });
      if (existingMember) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This person is already a member" });
      }

      const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      return ctx.prisma.invitation.create({
        data: {
          organizationId: input.organizationId,
          email: input.email,
          role: input.role,
          seatType: input.seatType,
          invitedById: ctx.user.id,
          expiresAt,
        },
        select: { id: true, token: true, expiresAt: true },
      });
    }),

  // Changing role/seatType is checked the same way an invite is: the seat
  // limit only applies when the change actually consumes a seat that wasn't
  // already held (e.g. switching a READ_ONLY member to FULL). Demoting or
  // switching to READ_ONLY never needs a seat check -- it only frees one up.
  updateMember: protectedProcedure
    .input(
      z.object({
        membershipId: z.string(),
        role: z.enum(["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"]),
        seatType: z.enum(["FULL", "READ_ONLY"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.prisma.membership.findUniqueOrThrow({
        where: { id: input.membershipId },
        include: { organization: { include: { planTier: true } } },
      });
      requireOrgRole(ctx, membership.organizationId, "ADMIN");

      if (input.seatType === "READ_ONLY" && input.role !== "VIEWER") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Read-only seats can only hold the Viewer role" });
      }
      if (membership.role === "OWNER" && input.role !== "OWNER") {
        const otherOwners = await ctx.prisma.membership.count({
          where: { organizationId: membership.organizationId, role: "OWNER", id: { not: membership.id } },
        });
        if (otherOwners === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "An organization must have at least one Owner" });
        }
      }

      if (input.seatType === "FULL" && membership.seatType === "READ_ONLY") {
        const counts = await getSeatCounts(ctx.prisma, membership.organizationId);
        const check = canAddSeat(membership.organization.planTier, counts, "FULL" as CoreSeatType);
        if (!check.allowed) {
          throw new TRPCError({ code: "BAD_REQUEST", message: check.reason ?? "Seat limit reached" });
        }
      }

      return ctx.prisma.membership.update({
        where: { id: input.membershipId },
        data: { role: input.role, seatType: input.seatType },
      });
    }),

  removeMember: protectedProcedure
    .input(z.object({ membershipId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.prisma.membership.findUniqueOrThrow({ where: { id: input.membershipId } });
      requireOrgRole(ctx, membership.organizationId, "ADMIN");

      if (membership.role === "OWNER") {
        const otherOwners = await ctx.prisma.membership.count({
          where: { organizationId: membership.organizationId, role: "OWNER", id: { not: membership.id } },
        });
        if (otherOwners === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "An organization must have at least one Owner" });
        }
      }

      await ctx.prisma.membership.delete({ where: { id: input.membershipId } });
    }),

  revokeInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await ctx.prisma.invitation.findUniqueOrThrow({ where: { id: input.invitationId } });
      requireOrgRole(ctx, invitation.organizationId, "ADMIN");
      await ctx.prisma.invitation.update({ where: { id: input.invitationId }, data: { status: "REVOKED" } });
    }),

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
    .mutation(async ({ ctx, input }) => {
      const invitation = await ctx.prisma.invitation.findUniqueOrThrow({
        where: { token: input.token },
        include: { organization: { include: { planTier: true } } },
      });

      if (invitation.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `This invitation is ${invitation.status.toLowerCase()}` });
      }
      if (invitation.expiresAt < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation has expired" });
      }
      if (invitation.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `This invitation was sent to ${invitation.email}, not your account's email`,
        });
      }

      const existingMembership = await ctx.prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId: ctx.user.id } },
      });
      if (existingMembership) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You're already a member of this organization" });
      }

      const counts = await getSeatCounts(ctx.prisma, invitation.organizationId);
      const check = canAddSeat(invitation.organization.planTier, counts, invitation.seatType as CoreSeatType);
      if (!check.allowed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${check.reason ?? "Seat limit reached"} -- ask an admin to free up a seat or upgrade the plan`,
        });
      }

      return ctx.prisma.$transaction(async (tx) => {
        const membership = await tx.membership.create({
          data: {
            organizationId: invitation.organizationId,
            userId: ctx.user.id,
            role: invitation.role,
            seatType: invitation.seatType,
          },
        });
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: "ACCEPTED", acceptedAt: new Date() },
        });
        return membership;
      });
    }),

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
    .query(({ ctx }) => ctx.prisma.planTier.findMany({ orderBy: { sortOrder: "asc" } })),

  // P12-04: switching plans is validated against ACTUAL seated usage, not
  // just accepted and left to silently misbehave -- a downgrade that would
  // leave the org over the new tier's seat caps is refused, and the error
  // says exactly how many of which seat type would need to go first, so an
  // admin isn't left guessing why the change failed.
  changePlanTier: protectedProcedure
    .input(z.object({ organizationId: z.string(), planTierId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      const [targetTier, counts] = await Promise.all([
        ctx.prisma.planTier.findUniqueOrThrow({ where: { id: input.planTierId } }),
        getSeatCounts(ctx.prisma, input.organizationId),
      ]);

      const overflows: string[] = [];
      if (targetTier.maxFullSeats !== null && counts.fullSeats > targetTier.maxFullSeats) {
        overflows.push(`${counts.fullSeats - targetTier.maxFullSeats} full seat(s)`);
      }
      if (targetTier.maxReadOnlySeats !== null && counts.readOnlySeats > targetTier.maxReadOnlySeats) {
        overflows.push(`${counts.readOnlySeats - targetTier.maxReadOnlySeats} read-only seat(s)`);
      }
      if (overflows.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Can't switch to ${targetTier.name}: remove ${overflows.join(" and ")} first (currently ${counts.fullSeats} full / ${counts.readOnlySeats} read-only seated).`,
        });
      }

      await ctx.prisma.organization.update({ where: { id: input.organizationId }, data: { planTierId: input.planTierId } });
      return { planTierId: input.planTierId, planTierName: targetTier.name };
    }),

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
      }),
    )
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId);
      const [org, counts, allTiers] = await Promise.all([
        ctx.prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId }, include: { planTier: true } }),
        getSeatCounts(ctx.prisma, input.organizationId),
        ctx.prisma.planTier.findMany(),
      ]);

      let nextTierNameForOneMoreFullSeat: string | null = null;
      if (org.planTier.maxFullSeats !== null && counts.fullSeats >= org.planTier.maxFullSeats) {
        const next = minimumTierForSeatCount(allTiers, counts.fullSeats + 1);
        if (next.key !== org.planTier.key) nextTierNameForOneMoreFullSeat = allTiers.find((t) => t.key === next.key)!.name;
      }

      return {
        planTierId: org.planTier.id,
        planTierName: org.planTier.name,
        fullSeatsUsed: counts.fullSeats,
        fullSeatsIncluded: org.planTier.maxFullSeats,
        readOnlySeatsUsed: counts.readOnlySeats,
        readOnlySeatsIncluded: org.planTier.includedReadOnlySeats,
        readOnlySeatsMax: org.planTier.maxReadOnlySeats,
        nextTierNameForOneMoreFullSeat,
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
