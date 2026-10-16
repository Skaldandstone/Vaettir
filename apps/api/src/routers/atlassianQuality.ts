import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import {
  protectedProcedure,
  requireProjectAccess,
  router,
  type Context,
} from "../trpc.js";
import { lockedProcessingEditor } from "../services/repositoryProcessingApproval.js";
import {
  forgeQualityBinding,
  forgeSharingEntityType,
  forgeSharingKey,
  latestForgeSharing,
  sharedQualitySnapshot,
} from "../services/atlassianQualitySharing.js";
import {
  forgeReleaseLink,
  releaseEvidenceSummary,
} from "../services/forgeReleaseSchema.js";
import {
  releaseClosureEntity,
  releaseClosureId,
} from "../services/jiraReleaseEvidence.js";

const input = z
  .object({
    projectId: z.string().min(1).max(120),
    organizationId: z.string().min(1).max(120),
  })
  .strict();
type Actor = Context & { user: NonNullable<Context["user"]> };
async function access(ctx: Actor, value: z.infer<typeof input>) {
  const user = await ctx.prisma.user.findUnique({
    where: { id: ctx.user.id },
    include: { memberships: true },
  });
  if (
    !user ||
    !ctx.authenticatedClerkSubject ||
    user.clerkUserId !== ctx.authenticatedClerkSubject
  )
    throw new TRPCError({ code: "UNAUTHORIZED" });
  const scope = await requireProjectAccess(
    { ...ctx, user },
    value.projectId,
    "ADMIN",
  );
  if (
    scope.project.organizationId !== value.organizationId ||
    scope.membership.seatType !== "FULL"
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  return scope;
}
export const atlassianQualityRouter = router({
  settings: protectedProcedure.input(input).query(async ({ ctx, input }) => {
    await access(ctx, input);
    const rows = await ctx.prisma.auditLog.findMany({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        entityType: forgeSharingEntityType,
      },
      orderBy: { createdAt: "desc" },
      take: 5001,
    });
    if (rows.length > 5000)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Review sharing retention before changing connections.",
      });
    const grouped = new Map<string, typeof rows>();
    for (const r of rows)
      grouped.set(r.entityId, [...(grouped.get(r.entityId) ?? []), r]);
    const snapshots = await ctx.prisma.projectReportSnapshot.findMany({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        payload: { path: ["state"], equals: "approved" },
      },
      orderBy: [{ asOf: "desc" }, { id: "desc" }],
      take: 500,
    });
    const [releases, runs, closures] = await Promise.all([
      ctx.prisma.release.findMany({
        where: { projectId: input.projectId },
        select: { id: true, name: true },
        orderBy: { createdAt: "desc" },
        take: 501,
      }),
      ctx.prisma.testRun.findMany({
        where: { projectId: input.projectId },
        select: {
          id: true,
          status: true,
          startedAt: true,
          commitSha: true,
          branch: true,
        },
        orderBy: [{ startedAt: "desc" }, { id: "asc" }],
        take: 501,
      }),
      ctx.prisma.auditLog.findMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          entityType: releaseClosureEntity,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 501,
      }),
    ]);
    return {
      projectId: input.projectId,
      organizationId: input.organizationId,
      actorClerkUserId: ctx.authenticatedClerkSubject,
      appId: process.env.VAETTIR_FORGE_APP_ID ?? null,
      environmentId: process.env.VAETTIR_FORGE_ENVIRONMENT_ID ?? null,
      releases: releases.slice(0, 500),
      runs: runs.slice(0, 500),
      catalogLimited:
        releases.length > 500 || runs.length > 500 || closures.length > 500,
      closures: closures.slice(0, 500).map((c) => {
        const summary = releaseEvidenceSummary.parse(
          (c.metadata as Prisma.JsonObject).summary,
        );
        return {
          id: c.id,
          releaseName: summary.releaseName,
          jiraVersionName: summary.jiraVersionName,
          capturedAt: summary.capturedAt,
        };
      }),
      connections: [...grouped].map(([id, versions]) => ({
        id,
        ...latestForgeSharing(versions)!,
      })),
      snapshots: snapshots.map((s) => ({
        id: s.id,
        title: s.title,
        asOf: s.asOf,
      })),
    };
  }),
  publish: protectedProcedure
    .input(
      input
        .extend({
          connectionId: z.string().uuid(),
          expectedVersion: z.number().int().nonnegative(),
          requestId: z.string().uuid(),
          binding: forgeQualityBinding,
          snapshotIds: z
            .array(z.string().length(64))
            .max(50)
            .refine((ids) => new Set(ids).size === ids.length),
          shareTicketTests: z.boolean(),
          releaseLinks: z
            .array(forgeReleaseLink)
            .max(50)
            .refine(
              (links) =>
                new Set(links.map((l) => l.jiraVersionId)).size ===
                links.length,
            ),
          closureSnapshotIds: z
            .array(z.string().length(64))
            .max(50)
            .refine((ids) => new Set(ids).size === ids.length),
          approveTargetSharing: z.literal(true),
        })
        .refine(
          (v) =>
            v.snapshotIds.length > 0 ||
            v.closureSnapshotIds.length > 0 ||
            ((v.shareTicketTests || v.releaseLinks.length > 0) &&
              v.binding.product === "jira"),
          "Choose snapshots or explicitly approve ticket verification sharing.",
        ),
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx, input);
      if (
        input.binding.appId !== process.env.VAETTIR_FORGE_APP_ID ||
        input.binding.environmentId !== process.env.VAETTIR_FORGE_ENVIRONMENT_ID
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The company-owned app and environment must be enabled on this Vaettir deployment first.",
        });
      return ctx.prisma.$transaction(async (tx) => {
        await lockedProcessingEditor(
          tx,
          input.organizationId,
          ctx.user.id,
          input.projectId,
        );
        await access({ ...ctx, prisma: tx as unknown as PrismaClient }, input);
        const id =
          "forge-publish-" +
          createHash("sha256")
            .update(
              JSON.stringify([ctx.user.id, input.projectId, input.requestId]),
            )
            .digest("hex");
        const payloadHash = createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex");
        const prior = await tx.auditLog.findUnique({ where: { id } });
        const entityId = forgeSharingKey(input.connectionId);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${entityId}))::text`;
        const versions = await tx.auditLog.findMany({
          where: { entityId, entityType: forgeSharingEntityType },
          take: 501,
        });
        if (
          versions.some(
            (v) =>
              v.organizationId !== input.organizationId ||
              v.projectId !== input.projectId,
          )
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This connection identifier is already used by another project.",
          });
        const previous = latestForgeSharing(versions);
        if (prior) {
          if ((prior.metadata as Prisma.JsonObject).payloadHash !== payloadHash)
            throw new TRPCError({ code: "CONFLICT" });
          return {
            saved: true,
            state: previous?.state ?? "REVOKED",
            version: previous?.version ?? 0,
          };
        }
        if ((previous?.version ?? 0) !== input.expectedVersion)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Sharing changed. Refresh and review its current audience and evidence before approving.",
          });
        if (versions.length >= 500)
          throw new TRPCError({ code: "PRECONDITION_FAILED" });
        if (input.binding.product !== "jira" && input.releaseLinks.length)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Live release sharing requires a Jira project. Approve frozen captures separately for Confluence.",
          });
        for (const link of input.releaseLinks) {
          const release = await tx.release.findFirst({
            where: { id: link.releaseId, projectId: input.projectId },
            select: { id: true },
          });
          const runs = await tx.testRun.count({
            where: { projectId: input.projectId, id: { in: link.runIds } },
          });
          if (!release || runs !== link.runIds.length)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Choose an existing project release and its explicit validation runs.",
            });
          const closureId = releaseClosureId(
            input.projectId,
            input.binding,
            link.jiraVersionId,
          );
          const closure = await tx.auditLog.findUnique({
            where: { id: closureId },
          });
          if (
            closure &&
            releaseEvidenceSummary.parse(
              (closure.metadata as Prisma.JsonObject).summary,
            ).releaseId !== link.releaseId
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "This Jira version already has a historical capture for a different release. It cannot be reassigned.",
            });
        }
        const closures = await tx.auditLog.findMany({
          where: {
            id: { in: input.closureSnapshotIds },
            organizationId: input.organizationId,
            projectId: input.projectId,
            entityType: releaseClosureEntity,
          },
        });
        if (
          closures.length !== input.closureSnapshotIds.length ||
          closures.some(
            (c) =>
              !releaseEvidenceSummary.safeParse(
                (c.metadata as Prisma.JsonObject).summary,
              ).success,
          )
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Only retained closure captures from this project can be shared.",
          });
        const snapshots = await tx.projectReportSnapshot.findMany({
          where: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            id: { in: input.snapshotIds },
          },
        });
        if (
          snapshots.length !== input.snapshotIds.length ||
          snapshots.some(
            (s) => !sharedQualitySnapshot.safeParse(s.payload).success,
          )
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Only existing approved snapshots from this project can be shared.",
          });
        if (
          previous &&
          JSON.stringify(previous.binding) !== JSON.stringify(input.binding)
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Use a new connection identifier for a different installation, environment or target.",
          });
        await tx.auditLog.create({
          data: {
            id,
            organizationId: input.organizationId,
            projectId: input.projectId,
            actorId: ctx.user.id,
            entityType: forgeSharingEntityType,
            entityId,
            action: "CREATE",
            summary:
              "Approved selected quality snapshots and explicit ticket-verification scope for the specified audience; no architecture/source sharing",
            metadata: {
              connectionId: input.connectionId,
              version: (previous?.version ?? 0) + 1,
              state: "APPROVED",
              binding: input.binding,
              snapshotIds: input.snapshotIds,
              releaseLinks: input.releaseLinks,
              closureSnapshotIds: input.closureSnapshotIds,
              shareTicketTests:
                input.shareTicketTests && input.binding.product === "jira",
              payloadHash,
            },
          },
        });
        return {
          saved: true,
          state: "APPROVED" as const,
          version: (previous?.version ?? 0) + 1,
        };
      });
    }),
  revoke: protectedProcedure
    .input(
      input.extend({
        id: z.string().regex(/^forge-sharing-[a-f0-9]{64}$/),
        requestId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx, input);
      return ctx.prisma.$transaction(async (tx) => {
        await lockedProcessingEditor(
          tx,
          input.organizationId,
          ctx.user.id,
          input.projectId,
        );
        await access({ ...ctx, prisma: tx as unknown as PrismaClient }, input);
        const versions = await tx.auditLog.findMany({
          where: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            entityType: forgeSharingEntityType,
            entityId: input.id,
          },
          take: 501,
        });
        if (versions.length > 500)
          throw new TRPCError({ code: "PRECONDITION_FAILED" });
        const previous = latestForgeSharing(versions);
        if (!previous) throw new TRPCError({ code: "NOT_FOUND" });
        const id =
          "forge-revoke-" +
          createHash("sha256")
            .update(
              JSON.stringify([ctx.user.id, input.projectId, input.requestId]),
            )
            .digest("hex");
        const replay = await tx.auditLog.findUnique({ where: { id } });
        if (replay) {
          if (replay.entityId !== input.id)
            throw new TRPCError({ code: "CONFLICT" });
          return {
            revoked: true,
            state: previous.state,
            version: previous.version,
          };
        }
        await tx.auditLog.create({
          data: {
            id,
            organizationId: input.organizationId,
            projectId: input.projectId,
            actorId: ctx.user.id,
            entityType: forgeSharingEntityType,
            entityId: input.id,
            action: "CREATE",
            summary:
              "Revoked Atlassian quality snapshot sharing; Vaettir records retained",
            metadata: {
              ...previous,
              version: previous.version + 1,
              state: "REVOKED",
            },
          },
        });
        return {
          revoked: true,
          state: "REVOKED" as const,
          version: previous.version + 1,
        };
      });
    }),
});
