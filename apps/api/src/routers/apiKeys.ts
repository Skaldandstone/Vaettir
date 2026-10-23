import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { router, protectedProcedure, requireOrgRole } from "../trpc.js";
import { generateApiKey } from "../services/apiKeyAuth.js";

const ROLES = z.enum(["VIEWER", "COMPLIANCE_AUDITOR", "EDITOR", "ADMIN"]);

async function requireLiveKeyAdmin(tx: Prisma.TransactionClient, organizationId: string, userId: string, fullSeat: boolean) {
  // Lock both rows through the credential write. Member removal and staff
  // ownership transfers do not all take the organization lock.
  const org = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM "Organization" WHERE "id"=${organizationId} FOR UPDATE`;
  const member = await tx.$queryRaw<Array<{ role: string; seatType: string }>>`SELECT "role", "seatType" FROM "Membership" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR UPDATE`;
  if (!org[0] || org[0].suspendedAt || !member[0] || !["OWNER", "ADMIN"].includes(member[0].role) || (fullSeat && member[0].seatType !== "FULL")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Current workspace administrator access is required." });
  }
}

export const apiKeysRouter = router({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          keyPrefix: z.string(),
          role: z.string(),
          createdAt: z.date(),
          lastUsedAt: z.date().nullable(),
          revokedAt: z.date().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      return ctx.prisma.$transaction(async tx => {
        await requireLiveKeyAdmin(tx, input.organizationId, ctx.user.id, false);
        return tx.apiKey.findMany({
          where: { organizationId: input.organizationId },
          orderBy: { createdAt: "desc" },
        });
      });
    }),

  // Only ADMIN+ can mint a service token -- it's a standing credential that
  // can act on the org (scoped to whatever role it's granted), not
  // something an EDITOR should be able to hand out on their own.
  create: protectedProcedure
    .input(z.object({ organizationId: z.string(), name: z.string().min(1), role: ROLES.default("EDITOR") }))
    .output(z.object({ id: z.string(), key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      const { rawKey, hashedKey, keyPrefix } = generateApiKey();

      const created = await ctx.prisma.$transaction(async (tx) => {
        await requireLiveKeyAdmin(tx, input.organizationId, ctx.user.id, true);
        const serviceUser = await tx.user.create({
          data: {
            clerkUserId: `apikey_${keyPrefix}_${Date.now()}`,
            email: `apikey+${keyPrefix}@vaettir.internal`,
            name: `API: ${input.name}`,
          },
        });
        await tx.membership.create({
          data: { organizationId: input.organizationId, userId: serviceUser.id, role: input.role, seatType: "FULL" },
        });
        return tx.apiKey.create({
          data: {
            organizationId: input.organizationId,
            name: input.name,
            keyPrefix,
            hashedKey,
            role: input.role,
            serviceUserId: serviceUser.id,
            createdByUserId: ctx.user.id,
          },
          select: { id: true },
        });
      });

      return { id: created.id, key: rawKey };
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const apiKey = await ctx.prisma.apiKey.findUniqueOrThrow({ where: { id: input.id } });
      requireOrgRole(ctx, apiKey.organizationId, "ADMIN");
      await ctx.prisma.$transaction(async tx => {
        await requireLiveKeyAdmin(tx, apiKey.organizationId, ctx.user.id, true);
        await tx.apiKey.update({ where: { id: input.id }, data: { revokedAt: new Date() } });
      });
    }),
});
