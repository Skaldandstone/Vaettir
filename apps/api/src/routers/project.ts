import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { router, protectedProcedure, requireOrgRole } from "../trpc.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "project"
  );
}

export const projectRouter = router({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          repoUrl: z.string().nullable(),
          createdAt: z.date(),
        }),
      ),
    )
    .query(({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId);
      return ctx.prisma.project.findMany({
        where: { organizationId: input.organizationId },
        orderBy: { createdAt: "desc" },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1),
        repoUrl: z.string().optional(),
        defaultBranch: z.string().default("main"),
      }),
    )
    .output(z.object({ id: z.string(), name: z.string(), slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "EDITOR");

      const baseSlug = slugify(input.name);
      let slug = baseSlug;
      let suffix = 1;
      while (
        await ctx.prisma.project.findUnique({
          where: { organizationId_slug: { organizationId: input.organizationId, slug } },
        })
      ) {
        slug = `${baseSlug}-${++suffix}`;
      }

      return ctx.prisma.project.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
          slug,
          repoUrl: input.repoUrl,
          defaultBranch: input.defaultBranch,
        },
        select: { id: true, name: true, slug: true },
      });
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        organizationId: z.string(),
        name: z.string(),
        slug: z.string(),
        repoUrl: z.string().nullable(),
        defaultBranch: z.string(),
        pagerdutyServiceId: z.string().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: input.id } });
      requireOrgRole(ctx, project.organizationId);
      return project;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        repoUrl: z.string().optional(),
        defaultBranch: z.string().min(1),
        // P9-04: undefined = leave unchanged; "" (or whitespace) explicitly
        // clears it to null, never to an empty string - this column is
        // @unique, and two projects both storing "" would collide on the
        // very first project that ever clears it.
        pagerdutyServiceId: z.string().optional(),
      }),
    )
    .output(z.object({ id: z.string(), name: z.string(), slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: input.id },
        select: { organizationId: true },
      });
      requireOrgRole(ctx, existing.organizationId, "EDITOR");
      try {
        return await ctx.prisma.project.update({
          where: { id: input.id },
          data: {
            name: input.name,
            repoUrl: input.repoUrl,
            defaultBranch: input.defaultBranch,
            pagerdutyServiceId: input.pagerdutyServiceId === undefined ? undefined : input.pagerdutyServiceId.trim() || null,
          },
          select: { id: true, name: true, slug: true },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Another project is already configured with that PagerDuty service ID." });
        }
        throw e;
      }
    }),

  // Deliberately ADMIN+ (not EDITOR, which can create). Every child relation
  // (test cases, test plans, requirements, releases, test runs, reverse-
  // engineer jobs) is RESTRICT, not CASCADE -- deleting a project with any
  // content in it is a deliberate no-op with a clear message, not a silent
  // wipe of everything under it. Delete the content first.
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: input.id },
        select: { organizationId: true },
      });
      requireOrgRole(ctx, existing.organizationId, "ADMIN");
      try {
        await ctx.prisma.project.delete({ where: { id: input.id } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This project still has test cases, test plans, requirements, or other content. Delete those first.",
          });
        }
        throw e;
      }
    }),
});
