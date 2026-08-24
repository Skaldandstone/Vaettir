import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";

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
});
