import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffTokenProcedure } from "../trpc.js";
import { adjustAiCredits } from "../services/aiCredits.js";
import { lockOrganization } from "../services/organizationLock.js";
import { requireUnmanagedBilling, usage } from "../services/seatManagement.js";
import { revokeApiKey } from "../services/revokeApiKey.js";

/**
 * Staff support console (cross-tenant). This is Vaettir's roadmap Phase 13
 * surface, reached through the staff plane rather than per-org membership.
 * Read-only by design in this wave: it gives support the visibility that
 * per-org roles structurally cannot, without granting cross-org mutation.
 * Every call is authorized by the staff token and attributed to the
 * forwarded staff actor, and audited at the Adminhelper layer.
 */
export const staffRouter = router({
  // Every org with at-a-glance health: plan, seats, credit balance, activity.
  listOrgs: staffTokenProcedure
    .input(z.object({ query: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const q = input?.query?.trim();
      const orgs = await ctx.prisma.organization.findMany({
        where: q
          ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }, { id: q }] }
          : undefined,
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          planTier: { select: { key: true, name: true, includedAiCreditsPerMonth: true } },
          _count: { select: { memberships: true, projects: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });

      // Credit balance is the sum of the append-only ledger, per org.
      const balances = await ctx.prisma.aiCreditTransaction.groupBy({
        by: ["organizationId"],
        _sum: { amount: true },
      });
      const balanceByOrg = new Map(balances.map((b) => [b.organizationId, b._sum.amount ?? 0]));

      return orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        createdAt: o.createdAt,
        planTier: o.planTier.key,
        members: o._count.memberships,
        projects: o._count.projects,
        creditBalance: balanceByOrg.get(o.id) ?? 0,
        monthlyCredits: o.planTier.includedAiCreditsPerMonth,
      }));
    }),

  // One org in full: members, seats, live API keys, credit balance.
  orgDetail: staffTokenProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          dataRetentionYears: true,
          planTier: { select: { key: true, name: true, includedAiCreditsPerMonth: true, minFullSeats: true, maxFullSeats: true } },
          memberships: {
            select: { id: true, role: true, seatType: true, user: { select: { email: true, name: true } } },
            orderBy: { createdAt: "asc" },
          },
          apiKeys: {
            select: { id: true, name: true, keyPrefix: true, role: true, lastUsedAt: true, revokedAt: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          },
        },
      });
      if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });

      const balance = await ctx.prisma.aiCreditTransaction.aggregate({
        where: { organizationId: input.organizationId },
        _sum: { amount: true },
      });

      const fullSeats = org.memberships.filter((m) => m.seatType === "FULL").length;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.createdAt,
        dataRetentionYears: org.dataRetentionYears,
        planTier: org.planTier,
        seats: { full: fullSeats, total: org.memberships.length },
        creditBalance: balance._sum.amount ?? 0,
        members: org.memberships.map((m) => ({
          id: m.id,
          role: m.role,
          seatType: m.seatType,
          email: m.user.email,
          name: m.user.name,
        })),
        apiKeys: org.apiKeys.map((k) => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          role: k.role,
          lastUsedAt: k.lastUsedAt,
          revokedAt: k.revokedAt,
          createdAt: k.createdAt,
        })),
      };
    }),

  // AI-credit forensics: the recent ledger for one org, with a running
  // balance. The "why did we run out of credits" answer.
  creditForensics: staffTokenProcedure
    .input(z.object({ organizationId: z.string(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: { id: true },
      });
      if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });

      const balance = await ctx.prisma.aiCreditTransaction.aggregate({
        where: { organizationId: input.organizationId },
        _sum: { amount: true },
      });
      const rows = await ctx.prisma.aiCreditTransaction.findMany({
        where: { organizationId: input.organizationId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        select: { id: true, type: true, amount: true, operation: true, description: true, createdAt: true },
      });
      return { balance: balance._sum.amount ?? 0, transactions: rows };
    }),

  // The tiers available to move an org between.
  listPlanTiers: staffTokenProcedure.query(async ({ ctx }) => {
    return ctx.prisma.planTier.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, key: true, name: true, includedAiCreditsPerMonth: true },
    });
  }),

  // ------------------------------------------------------------------ writes
  // Bounded, reversible staff support actions. Each is attributed to the
  // forwarded staff actor and audited at the Adminhelper layer; the finer
  // admin-vs-support gate is enforced there before the call is made.

  // Grant or deduct AI credits as a signed ledger ADJUSTMENT -- reversible by
  // another entry, never a mutated balance. Positive tops up, negative claws back.
  adjustCredits: staffTokenProcedure
    .input(
      z.object({
        organizationId: z.string(),
        amount: z.number().int().refine((n) => n !== 0, "amount cannot be zero"),
        reason: z.string().min(1).max(280),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const org = await ctx.prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } });
      if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      return adjustAiCredits(ctx.prisma, input.organizationId, input.amount, `[staff:${ctx.staff.actor}] ${input.reason}`);
    }),

  // Move an org to a different plan tier (comps, downgrades, billing fixes).
  setPlanTier: staffTokenProcedure
    .input(z.object({ organizationId: z.string(), planTierKey: z.string() }))
    .mutation(({ ctx, input }) => ctx.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, input.organizationId);
      const tier = await tx.planTier.findUnique({ where: { key: input.planTierKey } });
      await requireUnmanagedBilling(tx, input.organizationId);
      if (!tier) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown plan tier" });
      if (!tier.isPublic) throw new TRPCError({ code: "BAD_REQUEST", message: "Use staff beta enrollment to reserve a cohort slot." });
      const counts = await usage(tx, input.organizationId);
      if ((tier.maxFullSeats !== null && counts.fullSeats > tier.maxFullSeats) || (tier.maxReadOnlySeats !== null && counts.readOnlySeats > tier.maxReadOnlySeats)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Remove excess members and reserved invitations first." });
      }
      await tx.organization.update({ where: { id: input.organizationId }, data: { planTierId: tier.id } });
      return { planTier: { id: tier.id, key: tier.key, name: tier.name } };
    })),

  // Revoke a (leaked/stale) service API key. Reversible only forward -- the
  // safe direction for an incident.
  revokeApiKey: staffTokenProcedure
    .input(z.object({ apiKeyId: z.string() }))
    .mutation(({ ctx, input }) => revokeApiKey(ctx.prisma, input.apiKeyId)),
});
