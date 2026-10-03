import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import {
  router,
  protectedProcedure,
  requireOrgRole,
  requireProjectAccess,
} from "../trpc.js";
import {
  RepositoryProvider,
  validateRepositoryLocation,
} from "../services/projectRepository.js";
import { experienceProfileSchema } from "@vaettir/core";
import {
  qualityProfileRecord,
  readQualityExperience,
} from "../services/qualityExperienceProfile.js";
import { requireCurrentPlanAccess } from "../services/testPlanExecution.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "project"
  );
}

const qualityProfileSchema = z
  .object({
    objective: z.string().max(1000).default(""),
    systemScope: z
      .enum(["SOFTWARE", "HARDWARE", "BOTH", "PROCESS"])
      .default("SOFTWARE"),
    softwareTypes: z.array(z.string()).max(20).default([]),
    hardwareTypes: z.array(z.string()).max(20).default([]),
    testEnvironments: z.array(z.string()).max(20).default([]),
    qualityObjectives: z.array(z.string()).max(20).default([]),
    complianceNeeds: z.array(z.string()).max(30).default([]),
    regulatoryNeeds: z.array(z.string()).max(30).default([]),
    executionSources: z.array(z.string()).max(20).default([]),
    experience: experienceProfileSchema.optional(),
  })
  .passthrough();

// Old clients may update only familiar fields. They cannot mutate the approved
// experience through this route or erase future fields by round-tripping JSON.
const qualityProfileUpdateSchema = qualityProfileSchema
  .omit({ experience: true })
  .partial()
  .strict();
const caseKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9-]{0,23}$/,
    "Use 1–24 letters, numbers or hyphens, starting with a letter.",
  );

export const projectRouter = router({
  caseIdentity: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const row = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        select: { caseKey: true, nextCaseNumber: true },
      });
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      return {
        caseKey: row.caseKey,
        allocatedCount: row.nextCaseNumber,
        keyLocked: row.nextCaseNumber > 0,
      };
    }),
  saveCaseKey: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          expectedCaseKey: caseKeySchema,
          caseKey: caseKeySchema,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const { project, membership } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      if (membership.seatType !== "FULL")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A full editor seat is required.",
        });
      try {
        return await ctx.prisma.$transaction(async (tx) => {
          // Shares the exact project row lock used by case allocation, so a
          // concurrent first case and key change cannot receive mixed prefixes.
          await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${input.projectId} AND "organizationId" = ${project.organizationId} FOR UPDATE`;
          await requireCurrentPlanAccess(
            tx,
            ctx.user.id,
            input.projectId,
            true,
          );
          const row = await tx.project.findUnique({
            where: { id: input.projectId },
            select: { caseKey: true, nextCaseNumber: true },
          });
          if (!row)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Project not found",
            });
          if (row.caseKey !== input.expectedCaseKey)
            throw new TRPCError({
              code: "CONFLICT",
              message: "Project key changed. Refresh before saving.",
            });
          if (row.caseKey === input.caseKey)
            return { caseKey: row.caseKey, keyLocked: row.nextCaseNumber > 0 };
          if (row.nextCaseNumber > 0)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Project key is fixed after the first case ID is assigned. Existing case references will not be renamed.",
            });
          await tx.project.update({
            where: { id: input.projectId },
            data: { caseKey: input.caseKey },
          });
          await tx.auditLog.create({
            data: {
              organizationId: project.organizationId,
              projectId: input.projectId,
              actorId: ctx.user.id,
              entityType: "Project",
              entityId: input.projectId,
              action: "UPDATE",
              summary: "Configured test case project key",
              metadata: { from: row.caseKey, to: input.caseKey },
            },
          });
          return { caseKey: input.caseKey, keyLocked: false };
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "This project key is already used in your workspace.",
          });
        throw error;
      }
    }),
  experience: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId);
      const row = await ctx.prisma.project.findUnique({
        where: { id: project.id },
        select: { organizationId: true, qualityProfile: true },
      });
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      requireOrgRole(ctx, row.organizationId);
      return readQualityExperience(row.qualityProfile);
    }),
  saveExperience: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          expectedProfileHash: z.string().regex(/^[a-f0-9]{64}$/),
          experience: experienceProfileSchema,
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const { project, membership } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      if (membership.seatType !== "FULL")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A full editor seat is required.",
        });
      const row = await ctx.prisma.project.findUnique({
        where: { id: project.id },
        select: { organizationId: true, qualityProfile: true },
      });
      if (!row)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      requireOrgRole(ctx, row.organizationId, "EDITOR");
      const current = readQualityExperience(row.qualityProfile);
      if (current.profileHash !== input.expectedProfileHash)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Project context changed. Refresh and review before saving.",
        });
      const qualityProfile = {
        ...qualityProfileRecord(row.qualityProfile),
        experience: input.experience,
      } as Prisma.InputJsonObject;
      const written = await ctx.prisma.project.updateMany({
        where: {
          id: project.id,
          organizationId: row.organizationId,
          qualityProfile: {
            equals: row.qualityProfile as Prisma.InputJsonValue,
          },
        },
        data: { qualityProfile },
      });
      if (!written.count)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Project context changed. Refresh and review before saving.",
        });
      return readQualityExperience(qualityProfile);
    }),
  repositories: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const rows = await ctx.prisma.projectRepository.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "asc" },
        include: {
          connection: { select: { status: true, tokenExpiresAt: true } },
        },
      });
      return rows.map(({ connection, ...row }) => ({
        ...row,
        accessVerified:
          connection?.status === "VERIFIED" &&
          !!connection.tokenExpiresAt &&
          connection.tokenExpiresAt.getTime() > Date.now() + 30000,
      }));
    }),
  addRepository: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        provider: RepositoryProvider,
        url: z.string().max(1000),
        revision: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { membership } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      if (membership.seatType !== "FULL")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A full editor seat is required.",
        });
      let url: string;
      try {
        url = validateRepositoryLocation(input.provider, input.url);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Invalid repository URL",
        });
      }
      // Register metadata only: never fetch source, validate credentials, or replace the legacy primary repository.
      return ctx.prisma.projectRepository.upsert({
        where: {
          projectId_provider_url: {
            projectId: input.projectId,
            provider: input.provider,
            url,
          },
        },
        create: {
          projectId: input.projectId,
          provider: input.provider,
          url,
          revision: input.revision || null,
        },
        update: {},
      });
    }),
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
        caseKey: caseKeySchema.optional(),
        repoUrl: z.string().optional(),
        defaultBranch: z.string().default("main"),
        qualityProfile: qualityProfileSchema.default({}),
      }),
    )
    .output(z.object({ id: z.string(), name: z.string(), slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = requireOrgRole(ctx, input.organizationId, "EDITOR");
      if (
        input.qualityProfile.experience !== undefined &&
        membership.seatType !== "FULL"
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A full editor seat is required.",
        });

      const baseSlug = slugify(input.name);
      let slug = baseSlug;
      let suffix = 1;
      while (
        await ctx.prisma.project.findUnique({
          where: {
            organizationId_slug: { organizationId: input.organizationId, slug },
          },
        })
      ) {
        slug = `${baseSlug}-${++suffix}`;
      }

      return ctx.prisma.project.create({
        data: {
          organizationId: input.organizationId,
          name: input.name,
          caseKey: input.caseKey,
          slug,
          repoUrl: input.repoUrl,
          defaultBranch: input.defaultBranch,
          qualityProfile: input.qualityProfile as Prisma.InputJsonObject,
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
        datadogProjectTag: z.string().nullable(),
        qualityProfile: qualityProfileSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.id },
      });
      if (!project)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      requireOrgRole(ctx, project.organizationId);
      return {
        ...project,
        qualityProfile: qualityProfileSchema.parse(project.qualityProfile),
      };
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
        // Same undefined/""-clears-to-null convention; unique per-org only
        // (see the schema comment on Project.datadogProjectTag).
        datadogProjectTag: z.string().optional(),
        qualityProfile: qualityProfileUpdateSchema.optional(),
      }),
    )
    .output(z.object({ id: z.string(), name: z.string(), slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.project.findUnique({
        where: { id: input.id },
        select: { organizationId: true, qualityProfile: true },
      });
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      requireOrgRole(ctx, existing.organizationId, "EDITOR");
      try {
        if (input.qualityProfile !== undefined) {
          const qualityProfile = {
            ...qualityProfileRecord(existing.qualityProfile),
            ...input.qualityProfile,
          } as Prisma.InputJsonObject;
          const written = await ctx.prisma.project.updateMany({
            where: {
              id: input.id,
              organizationId: existing.organizationId,
              qualityProfile: {
                equals: existing.qualityProfile as Prisma.InputJsonValue,
              },
            },
            data: {
              name: input.name,
              repoUrl: input.repoUrl,
              defaultBranch: input.defaultBranch,
              pagerdutyServiceId:
                input.pagerdutyServiceId === undefined
                  ? undefined
                  : input.pagerdutyServiceId.trim() || null,
              datadogProjectTag:
                input.datadogProjectTag === undefined
                  ? undefined
                  : input.datadogProjectTag.trim() || null,
              qualityProfile,
            },
          });
          if (!written.count)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Project context changed. Refresh and review before saving.",
            });
          const updated = await ctx.prisma.project.findUnique({
            where: { id: input.id },
            select: { id: true, name: true, slug: true },
          });
          if (!updated)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Project not found",
            });
          return updated;
        }
        return await ctx.prisma.project.update({
          where: { id: input.id },
          data: {
            name: input.name,
            repoUrl: input.repoUrl,
            defaultBranch: input.defaultBranch,
            pagerdutyServiceId:
              input.pagerdutyServiceId === undefined
                ? undefined
                : input.pagerdutyServiceId.trim() || null,
            datadogProjectTag:
              input.datadogProjectTag === undefined
                ? undefined
                : input.datadogProjectTag.trim() || null,
            qualityProfile: input.qualityProfile,
          },
          select: { id: true, name: true, slug: true },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2025"
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Another project is already configured with that PagerDuty service ID or Datadog project tag.",
          });
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
      const existing = await ctx.prisma.project.findUnique({
        where: { id: input.id },
        select: { organizationId: true },
      });
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      requireOrgRole(ctx, existing.organizationId, "ADMIN");
      try {
        await ctx.prisma.project.delete({ where: { id: input.id } });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2025"
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2003"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This project still has test cases, test plans, requirements, or other content. Delete those first.",
          });
        }
        throw e;
      }
    }),
});
