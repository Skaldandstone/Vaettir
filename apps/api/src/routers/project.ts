import { z } from "zod";
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
      }),
    )
    .output(z.object({ id: z.string(), name: z.string(), slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: input.id },
        select: { organizationId: true },
      });
      requireOrgRole(ctx, existing.organizationId, "EDITOR");
      return ctx.prisma.project.update({
        where: { id: input.id },
        data: { name: input.name, repoUrl: input.repoUrl, defaultBranch: input.defaultBranch },
        select: { id: true, name: true, slug: true },
      });
    }),
});
