import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import {
  documentRequirements,
  normalizeRequirement,
} from "../services/documentRequirements.js";
const scope = z.object({
  projectId: z.string().min(1),
  sourceKey: z.string().min(1).max(100),
});
export const populationRequirementsRouter = router({
  preview: protectedProcedure.input(scope).query(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);
    const doc = await ctx.prisma.projectPopulationDocument.findUnique({
      where: { projectId_sourceKey: input },
    });
    if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
    const [requirements, links] = await Promise.all([
      ctx.prisma.requirement.findMany({
        where: { projectId: input.projectId },
        select: { id: true, title: true },
      }),
      ctx.prisma.projectPopulationRequirement.findMany({
        where: input,
        include: { requirement: { select: { id: true, title: true } } },
      }),
    ]);
    const candidates = documentRequirements(doc.content);
    const currentKeys = new Set(candidates.map(row=>row.key));
    return {
      sourceKey: doc.sourceKey,
      version: doc.version,
      title: doc.title,
      costCredits: 0,
      method: "literal-statements" as const,
      staleLinks: links.filter(link=>!currentKeys.has(link.candidateKey)).map(link=>({requirementId:link.requirementId,title:link.requirement?.title ?? link.approvedTitle,sourceVersion:link.sourceVersion,sourceQuote:link.sourceQuote})),
      candidates: candidates.map((candidate) => {
        const link = links.find((link) => link.candidateKey === candidate.key);
        const match = requirements.find(
          (req) =>
            normalizeRequirement(req.title) ===
            normalizeRequirement(candidate.title),
        );
        return {
          ...candidate,
          status: link
            ? !link.requirement
              ? ("removed" as const)
              : link.requirement.title !== link.approvedTitle
                ? ("human-edited" as const)
                : ("linked" as const)
            : match
              ? ("existing" as const)
              : ("new" as const),
          requirementId: link?.requirementId ?? match?.id ?? null,
        };
      }),
    };
  }),
  approve: protectedProcedure
    .input(
      scope.extend({
        version: z.number().int().positive(),
        candidateKey: z.string().regex(/^[a-f0-9]{64}$/),
        title: z.string().trim().min(1).max(500),
        approve: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { membership } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      if (membership.seatType === "READ_ONLY")
        throw new TRPCError({ code: "FORBIDDEN" });
      return ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${input.projectId} FOR UPDATE`;
        const key = {
          projectId: input.projectId,
          sourceKey: input.sourceKey,
          candidateKey: input.candidateKey,
        };
        const previous = await tx.projectPopulationRequirement.findUnique({
          where: { projectId_sourceKey_candidateKey: key },
        });
        if (previous) {
          if (previous.approvedTitle !== input.title || !previous.requirementId)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This suggestion was already reviewed or removed. Existing human changes are preserved.",
            });
          return { requirementId: previous.requirementId, created: false };
        }
        const doc = await tx.projectPopulationDocument.findUnique({
          where: {
            projectId_sourceKey: {
              projectId: input.projectId,
              sourceKey: input.sourceKey,
            },
          },
        });
        if (!doc || doc.version !== input.version)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Document changed. Review the latest suggestions first.",
          });
        const candidate = documentRequirements(doc.content).find(
          (row) => row.key === input.candidateKey,
        );
        if (!candidate)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Suggestion is not present in the approved source.",
          });
        const requirements = await tx.requirement.findMany({
          where: { projectId: input.projectId },
          select: { id: true, title: true },
        });
        const match = requirements.find(
          (req) =>
            normalizeRequirement(req.title) ===
            normalizeRequirement(input.title),
        );
        const requirement =
          match ??
          (await tx.requirement.create({
            data: {
              projectId: input.projectId,
              title: input.title,
              description: `Documented intent from ${doc.title}, version ${doc.version}, line ${candidate.line}:\n${candidate.quote}`,
              externalRef: `vaettir-document:${encodeURIComponent(doc.sourceKey)}@${doc.version}:L${candidate.line}`,
            },
          }));
        await tx.projectPopulationRequirement.create({
          data: {
            ...key,
            sourceVersion: doc.version,
            sourceLine: candidate.line,
            sourceQuote: candidate.quote,
            approvedTitle: input.title,
            approvedBy: ctx.user.id,
            requirementId: requirement.id,
          },
        });
        return { requirementId: requirement.id, created: !match };
      });
    }),
});
