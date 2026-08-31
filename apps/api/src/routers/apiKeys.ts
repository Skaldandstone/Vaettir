import { z } from "zod";
import { router, protectedProcedure, requireOrgRole } from "../trpc.js";
import { generateApiKey } from "../services/apiKeyAuth.js";
import { TRPCError } from "@trpc/server";
import { canAddSeat } from "@vaettir/core";
import { assertActiveOrganization, lockOrganization } from "../services/organizationLock.js";
import { requireAdmin, usage } from "../services/seatManagement.js";
import { revokeApiKey } from "../services/revokeApiKey.js";

const ROLES = z.enum(["VIEWER", "COMPLIANCE_AUDITOR", "EDITOR", "ADMIN"]);

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
      return ctx.prisma.apiKey.findMany({
        where: { organizationId: input.organizationId },
        orderBy: { createdAt: "desc" },
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
        assertActiveOrganization(await lockOrganization(tx, input.organizationId));
        await requireAdmin(tx, input.organizationId, ctx.user.id);
        const org = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId }, include: { planTier: true } });
        const seats = canAddSeat(org.planTier, await usage(tx, input.organizationId), "FULL");
        if (!seats.allowed) throw new TRPCError({ code: "BAD_REQUEST", message: "Service accounts use a full seat. " + seats.reason });
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
      await revokeApiKey(ctx.prisma, input.id, ctx.user.id);
    }),
});
