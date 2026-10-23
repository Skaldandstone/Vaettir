import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";

const nativeId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const reportReleaseScopeIdentity = z
  .object({ projectId: nativeId, releaseId: nativeId })
  .strict();
export type ResolvedReportReleaseScope = {
  releaseId: string;
  releaseName: string;
  releaseNameIsExcerpt: boolean;
  planIds: string[];
  limitations: string[];
};

/** SQL reads at most240 Unicode characters; returned label is <=240 UTF16 units. */
export function reportReleaseLabel(
  boundedName: string,
  databaseExcerpt: boolean,
) {
  if (
    !boundedName.trim() ||
    Array.from(boundedName).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The release label is unavailable or unsupported. Repair the native release name before capturing this scope.",
    });
  for (let index = 0; index < boundedName.length; index++) {
    const point = boundedName.codePointAt(index)!;
    if (point >= 0xd800 && point <= 0xdfff)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The native release label contains unsupported Unicode.",
      });
    if (point > 0xffff) index++;
  }
  let label = boundedName.slice(0, 240);
  if (/[\ud800-\udbff]$/u.test(label)) label = label.slice(0, -1);
  return {
    releaseName: label,
    releaseNameIsExcerpt: databaseExcerpt || label.length < boundedName.length,
  };
}

/**
 * CALLER CONTRACT: use inside a bounded RepeatableRead report transaction AFTER
 * current original-org/member/project authorization and locks. This helper has
 * no actor and does not independently authorize a customer request. Lock order
 * within that scope is selected release, then native plan IDs in ascending order.
 * No run/branch/configuration-derived association or release verdict is inferred.
 */
export async function resolveReportReleaseScope(
  tx: Prisma.TransactionClient,
  projectId: string,
  releaseId: string,
): Promise<ResolvedReportReleaseScope> {
  const identity = reportReleaseScopeIdentity.safeParse({
    projectId,
    releaseId,
  });
  if (!identity.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a supported native project and release identity.",
    });
  const releases = await tx.$queryRaw<
    Array<{ id: string; projectId: string; name: string; excerpt: boolean }>
  >(
    Prisma.sql`SELECT id,"projectId",left(name,240) AS name,length(name)>240 AS excerpt
      FROM "Release" WHERE id=${releaseId} AND "projectId"=${projectId} FOR UPDATE`,
  );
  const release = releases[0];
  if (!release || release.id !== releaseId || release.projectId !== projectId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "That native release is not available in this project.",
    });
  const label = reportReleaseLabel(release.name, release.excerpt);
  // The single-column FK alone permits malformed historical cross-project links.
  // Read existence only, no foreign label/body, and never substitute a subset as
  // the complete selected release scope. Release lock prevents new FK links.
  const foreign = await tx.$queryRaw<Array<{ exists: boolean }>>(
    Prisma.sql`SELECT EXISTS(SELECT 1 FROM "TestPlan" WHERE "releaseId"=${releaseId} AND "projectId"<>${projectId}) AS exists`,
  );
  if (foreign[0]?.exists !== false)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The release has an unavailable or cross-project plan association. Repair its native links before capturing a release report.",
    });
  const plans = await tx.$queryRaw<
    Array<{ id: string; projectId: string; releaseId: string }>
  >(
    Prisma.sql`SELECT id,"projectId","releaseId" FROM "TestPlan"
      WHERE "projectId"=${projectId} AND "releaseId"=${releaseId}
      ORDER BY id ASC LIMIT 201 FOR SHARE`,
  );
  if (plans.length > 200)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This release links more than200 plans. Narrow or reorganize the native release scope; no truncated release report was produced.",
    });
  const planIds = plans.map((plan) => plan.id);
  if (
    plans.some(
      (plan) =>
        plan.projectId !== projectId ||
        plan.releaseId !== releaseId ||
        !nativeId.safeParse(plan.id).success,
    ) ||
    new Set(planIds).size !== planIds.length
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The complete native release-plan identity scope is unavailable. No smaller substitute was used.",
    });
  return {
    releaseId: release.id,
    ...label,
    planIds,
    limitations: [
      "Release scope uses the current native same-project TestPlan.releaseId association, not branches, provider labels or inferred configuration. At most200 complete linked plans; unsupported or cross-project associations refuse capture.",
      "The exact linked plan IDs and release label become frozen report membership only when the caller captures them in the approved snapshot workflow. This helper alone is current read-time scope, not an immutable historical release baseline.",
      "A plan being linked to this release today does not certify that older runs executed for this release, that their historical procedures match, or that the release passed a regulatory or deployment gate. Historic run release certification is unavailable and is not inferred.",
      ...(label.releaseNameIsExcerpt
        ? [
            "The retained release label is an excerpt of at most240 UTF16 units without a split surrogate pair; the native release identity, not this display excerpt, defines scope.",
          ]
        : []),
      ...(planIds.length
        ? []
        : [
            "This release currently has no native linked plans. Empty membership is explicit; it must never expand to all project plans or imply readiness.",
          ]),
    ],
  };
}
