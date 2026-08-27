import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffProcedure } from "../trpc.js";

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
  listOrgs: staffProcedure
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
  orgDetail: staffProcedure
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
  creditForensics: staffProcedure
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
});
