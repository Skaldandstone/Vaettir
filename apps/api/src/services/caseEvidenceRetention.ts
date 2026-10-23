import type { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";

/** Caller must hold the shared project lock before checking or deleting a case. */
export async function ensureCaseEvidenceNotRetained(
  tx: Prisma.TransactionClient,
  projectId: string,
  testCaseId: string,
) {
  const attachments = await tx.testCaseAttachment.findMany({
    where: { testCaseId, testCase: { projectId } },
    select: { id: true },
    take: 1001,
  });
  if (attachments.length > 1000)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This case has a large evidence archive. Archive the case instead of deleting its records.",
    });
  if (!attachments.length) return;
  const retained = await tx.manualStepResultRevision.count({
    where: { evidenceAttachmentIds: { hasSome: attachments.map((a) => a.id) } },
  });
  const [frozen] = await tx.$queryRaw<{ retained: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM "TestRun" r, "TestCaseAttachment" a
      WHERE r."projectId" = ${projectId} AND a."testCaseId" = ${testCaseId}
      AND r."executionContext" @> jsonb_build_object('caseDefinitions',
        jsonb_build_array(jsonb_build_object('steps',
          jsonb_build_array(jsonb_build_object('mediaAttachmentIds', jsonb_build_array(a.id))))))
    ) AS retained`;
  if (retained || frozen?.retained)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This case owns evidence retained by a recorded step or saved run procedure. Archive the case instead; historical evidence cannot be deleted.",
    });
}
