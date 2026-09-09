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
import type { Prisma, PrismaClient } from "@vaettir/db";
import { sendReadinessDigestForOrg } from "../jobs/readinessDigestScheduler.js";
import { getAiCreditBalance } from "../services/aiCredits.js";
import { computeRetentionDryRun } from "../services/retentionAudit.js";
import { WEBHOOK_EVENT_TYPES } from "../services/webhookDelivery.js";
import { assertPublicHttpUrl, UnsafeUrlError } from "../services/urlGuard.js";
import { bootstrapBetaOrganization, PRIVATE_BETA_TIER } from "../services/privateBeta.js";

const INVITATION_EXPIRY_DAYS = 7;

async function getSeatCounts(prisma: PrismaClient, organizationId: string) {
  const [fullSeats, readOnlySeats] = await Promise.all([
    prisma.membership.count({ where: { organizationId, seatType: "FULL" } }),
    prisma.membership.count({ where: { organizationId, seatType: "READ_ONLY" } }),
  ]);
  return { fullSeats, readOnlySeats };
}

async function lockActiveOrganization(tx: Prisma.TransactionClient, organizationId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; suspendedAt: Date | null }>>`
    SELECT "id", "suspendedAt" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE
  `;
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  if (rows[0].suspendedAt) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This organization is suspended. Contact support." });
  }
}

async function requireTransactionAdmin(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const membership = await tx.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role) || membership.seatType === "READ_ONLY") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization admin access required" });
  }
}

async function getReservedSeatCounts(
  tx: Prisma.TransactionClient,
  organizationId: string,
  excludeInvitationId?: string,
) {
  const [members, pending] = await Promise.all([
    tx.membership.findMany({ where: { organizationId }, select: { seatType: true } }),
    tx.invitation.findMany({
      where: {
        organizationId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
        ...(excludeInvitationId ? { id: { not: excludeInvitationId } } : {}),
      },
      select: { seatType: true },
    }),
  ]);
  return {
    fullSeats: [...members, ...pending].filter((seat) => seat.seatType === "FULL").length,
    readOnlySeats: [...members, ...pending].filter((seat) => seat.seatType === "READ_ONLY").length,
  };
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
    // .output() bounds the inferred type instead of letting it flow straight
    // from Prisma's Organization model -- same TS2589 fix `mine` below
    // already needed, tripped here once a react-query `useMutation` wrapper
    // (P1-15) tried to fully resolve the unbounded type.
    .output(z.object({ id: z.string(), name: z.string(), slug: z.string() }))
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
      return ctx.prisma.$transaction(async (tx) => {
        await lockActiveOrganization(tx, input.organizationId);
        await requireTransactionAdmin(tx, input.organizationId, ctx.user.id);
        if (input.seatType === "READ_ONLY" && input.role !== "VIEWER") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Read-only seats can only hold the Viewer role" });
        }

        const email = input.email.trim().toLowerCase();
        const [org, existingMember, existingInvitation] = await Promise.all([
          tx.organization.findUniqueOrThrow({ where: { id: input.organizationId }, include: { planTier: true } }),
          tx.membership.findFirst({
            where: { organizationId: input.organizationId, user: { email: { equals: email, mode: "insensitive" } } },
          }),
          tx.invitation.findFirst({
            where: {
              organizationId: input.organizationId,
              email: { equals: email, mode: "insensitive" },
              status: "PENDING",
              expiresAt: { gt: new Date() },
            },
          }),
        ]);
        if (existingMember) throw new TRPCError({ code: "BAD_REQUEST", message: "This person is already a member" });
        if (existingInvitation) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This person already has a pending invitation" });
        }

        const counts = await getReservedSeatCounts(tx, input.organizationId);
        const check = canAddSeat(org.planTier, counts, input.seatType as CoreSeatType);
        if (!check.allowed) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${check.reason ?? "Seat limit reached"}. Pending invitations reserve seats; revoke an unused invitation to free one.`,
          });
        }

        const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        return tx.invitation.create({
          data: {
            organizationId: input.organizationId,
            email,
            role: input.role,
            seatType: input.seatType,
            invitedById: ctx.user.id,
            expiresAt,
          },
          select: { id: true, token: true, expiresAt: true },
        });
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
      const target = await ctx.prisma.membership.findUniqueOrThrow({ where: { id: input.membershipId } });
      requireOrgRole(ctx, target.organizationId, "ADMIN");
      return ctx.prisma.$transaction(async (tx) => {
        await lockActiveOrganization(tx, target.organizationId);
        await requireTransactionAdmin(tx, target.organizationId, ctx.user.id);
        const membership = await tx.membership.findUniqueOrThrow({
          where: { id: input.membershipId },
          include: { organization: { include: { planTier: true } } },
        });
        if (input.seatType === "READ_ONLY" && input.role !== "VIEWER") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Read-only seats can only hold the Viewer role" });
        }
        if (membership.role === "OWNER" && input.role !== "OWNER") {
          const otherOwners = await tx.membership.count({
            where: { organizationId: membership.organizationId, role: "OWNER", id: { not: membership.id } },
          });
          if (otherOwners === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "An organization must have at least one Owner" });
          }
        }

        if (input.seatType !== membership.seatType) {
          const counts = await getReservedSeatCounts(tx, membership.organizationId);
          const check = canAddSeat(membership.organization.planTier, counts, input.seatType as CoreSeatType);
          if (!check.allowed) {
            throw new TRPCError({ code: "BAD_REQUEST", message: check.reason ?? "Seat limit reached" });
          }
        }

        return tx.membership.update({
          where: { id: input.membershipId },
          data: { role: input.role, seatType: input.seatType },
        });
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
      const target = await ctx.prisma.invitation.findUniqueOrThrow({ where: { token: input.token } });
      return ctx.prisma.$transaction(async (tx) => {
        await lockActiveOrganization(tx, target.organizationId);
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ctx.user.id} FOR UPDATE`;
        const invitation = await tx.invitation.findUniqueOrThrow({
          where: { token: input.token },
          include: { organization: { include: { planTier: true } } },
        });
        if (invitation.status !== "PENDING" || invitation.expiresAt <= new Date()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation is expired or no longer pending" });
        }
        if (invitation.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Sign in with the email address this invitation was sent to",
          });
        }
        if (await tx.membership.findUnique({
          where: { organizationId_userId: { organizationId: invitation.organizationId, userId: ctx.user.id } },
        })) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You're already a member of this organization" });
        }
        const counts = await getReservedSeatCounts(tx, invitation.organizationId, invitation.id);
        const check = canAddSeat(invitation.organization.planTier, counts, invitation.seatType as CoreSeatType);
        if (!check.allowed) {
          throw new TRPCError({ code: "BAD_REQUEST", message: check.reason ?? "Seat limit reached" });
        }
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
    .query(({ ctx }) => ctx.prisma.planTier.findMany({ where: { isPublic: true }, orderBy: { sortOrder: "asc" } })),

  // P12-04: switching plans is validated against ACTUAL seated usage, not
  // just accepted and left to silently misbehave -- a downgrade that would
  // leave the org over the new tier's seat caps is refused, and the error
  // says exactly how many of which seat type would need to go first, so an
  // admin isn't left guessing why the change failed.
  changePlanTier: protectedProcedure
    .input(z.object({ organizationId: z.string(), planTierId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      return ctx.prisma.$transaction(async (tx) => {
        await lockActiveOrganization(tx, input.organizationId);
        await requireTransactionAdmin(tx, input.organizationId, ctx.user.id);
        const [organization, targetTier, counts] = await Promise.all([
          tx.organization.findUniqueOrThrow({
            where: { id: input.organizationId },
            include: { planTier: { select: { key: true } } },
          }),
          tx.planTier.findUniqueOrThrow({ where: { id: input.planTierId } }),
          getReservedSeatCounts(tx, input.organizationId),
        ]);

        if (organization.planTier.key === PRIVATE_BETA_TIER || !targetTier.isPublic) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Private-beta plan changes are managed by staff",
          });
        }

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
            message: `Can't switch to ${targetTier.name}: remove ${overflows.join(" and ")} first (currently ${counts.fullSeats} full / ${counts.readOnlySeats} read-only reserved).`,
          });
        }

        await tx.organization.update({ where: { id: input.organizationId }, data: { planTierId: input.planTierId } });
        return { planTierId: input.planTierId, planTierName: targetTier.name };
      });
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
        privateBeta: z.boolean(),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId);
      const [org, counts, allTiers] = await Promise.all([
        ctx.prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId }, include: { planTier: true } }),
        getSeatCounts(ctx.prisma, input.organizationId),
        ctx.prisma.planTier.findMany({ where: { isPublic: true } }),
      ]);

      let nextTierNameForOneMoreFullSeat: string | null = null;
      const privateBeta = org.planTier.key === PRIVATE_BETA_TIER;
      if (!privateBeta && org.planTier.maxFullSeats !== null && counts.fullSeats >= org.planTier.maxFullSeats) {
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
        privateBeta,
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

  // P10-01: how long since this org last completed a full access review -
  // the UI's cue for whether one is overdue. null means never reviewed.
  accessReviewStatus: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(z.object({ lastReviewedAt: z.date().nullable(), daysSinceLastReview: z.number().nullable() }))
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      const last = await ctx.prisma.accessReview.findFirst({
        where: { organizationId: input.organizationId },
        orderBy: { performedAt: "desc" },
        select: { performedAt: true },
      });
      if (!last) return { lastReviewedAt: null, daysSinceLastReview: null };
      const daysSinceLastReview = Math.floor((Date.now() - last.performedAt.getTime()) / (1000 * 60 * 60 * 24));
      return { lastReviewedAt: last.performedAt, daysSinceLastReview };
    }),

  listAccessReviews: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          period: z.string(),
          performedAt: z.date(),
          performedByEmail: z.string(),
          confirmedCount: z.number(),
          revokedCount: z.number(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      const reviews = await ctx.prisma.accessReview.findMany({
        where: { organizationId: input.organizationId },
        include: { performedBy: { select: { email: true } }, entries: { select: { decision: true } } },
        orderBy: { performedAt: "desc" },
      });
      return reviews.map((r) => ({
        id: r.id,
        period: r.period,
        performedAt: r.performedAt,
        performedByEmail: r.performedBy.email,
        confirmedCount: r.entries.filter((e) => e.decision === "CONFIRMED").length,
        revokedCount: r.entries.filter((e) => e.decision === "REVOKED").length,
      }));
    }),

  getAccessReviewDetail: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        period: z.string(),
        performedAt: z.date(),
        performedByEmail: z.string(),
        entries: z.array(
          z.object({
            userEmail: z.string(),
            role: z.string(),
            seatType: z.string(),
            decision: z.string(),
            note: z.string().nullable(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const review = await ctx.prisma.accessReview.findUniqueOrThrow({
        where: { id: input.id },
        include: { performedBy: { select: { email: true } }, entries: true },
      });
      requireOrgRole(ctx, review.organizationId, "ADMIN");
      return {
        id: review.id,
        period: review.period,
        performedAt: review.performedAt,
        performedByEmail: review.performedBy.email,
        entries: review.entries.map((e) => ({
          userEmail: e.userEmail,
          role: e.role,
          seatType: e.seatType,
          decision: e.decision,
          note: e.note,
        })),
      };
    }),

  // A review must cover every current member in one pass (no partial/drip
  // review) so each completed AccessReview row is genuinely "we reviewed
  // everyone's access on this date," which is what a SOC 2 auditor actually
  // wants to see - not an open-ended queue that might never finish.
  // REVOKED decisions take effect immediately (the member is removed), same
  // rule as removeMember/updateMember: can't revoke every Owner at once.
  submitAccessReview: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        period: z.string().min(1),
        decisions: z
          .array(
            z.object({
              membershipId: z.string(),
              decision: z.enum(["CONFIRMED", "REVOKED"]),
              note: z.string().optional(),
            }),
          )
          .min(1),
      }),
    )
    .output(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");

      const memberships = await ctx.prisma.membership.findMany({
        where: { organizationId: input.organizationId },
        include: { user: { select: { email: true } } },
      });
      const byId = new Map(memberships.map((m) => [m.id, m]));
      const decisionIds = new Set(input.decisions.map((d) => d.membershipId));
      if (decisionIds.size !== input.decisions.length || decisionIds.size !== memberships.length || memberships.some((m) => !decisionIds.has(m.id))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A review must cover every current member exactly once, with no omissions or duplicates",
        });
      }

      const revokedIds = input.decisions.filter((d) => d.decision === "REVOKED").map((d) => d.membershipId);
      const remainingOwners = memberships.filter((m) => m.role === "OWNER" && !revokedIds.includes(m.id)).length;
      if (memberships.some((m) => m.role === "OWNER") && remainingOwners === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An organization must have at least one Owner - can't revoke every Owner in the same review",
        });
      }

      const review = await ctx.prisma.accessReview.create({
        data: {
          organizationId: input.organizationId,
          period: input.period,
          performedById: ctx.user.id,
          entries: {
            create: input.decisions.map((d) => {
              const m = byId.get(d.membershipId)!;
              return {
                userId: m.userId,
                userEmail: m.user.email,
                role: m.role,
                seatType: m.seatType,
                decision: d.decision,
                note: d.note,
              };
            }),
          },
        },
      });

      if (revokedIds.length > 0) {
        await ctx.prisma.membership.deleteMany({ where: { id: { in: revokedIds } } });
      }

      return { id: review.id };
    }),
});
