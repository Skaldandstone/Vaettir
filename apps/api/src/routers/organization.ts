import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { DEFAULT_STEP_FIELD_LABELS, resolveStepFieldLabels, type StepFieldKey } from "@tci/core";
import { router, protectedProcedure, requireOrgRole } from "../trpc.js";

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
});
