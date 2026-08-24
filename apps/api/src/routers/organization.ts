import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DEFAULT_STEP_FIELD_LABELS,
  resolveStepFieldLabels,
  canAddSeat,
  type StepFieldKey,
  type SeatType as CoreSeatType,
} from "@tci/core";
import { router, protectedProcedure, requireOrgRole } from "../trpc.js";
import type { PrismaClient } from "@tci/db";

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
  mine: protectedProcedure
    .output(z.array(z.object({ id: z.string(), name: z.string(), slug: z.string() })))
    .query(({ ctx }) =>
      ctx.prisma.organization.findMany({
        where: { memberships: { some: { userId: ctx.user.id } } },
        select: { id: true, name: true, slug: true },
      }),
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
      }),
    )
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.id);
      const org = await ctx.prisma.organization.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, name: true, slug: true, stepFieldLabels: true },
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
      };
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
});
