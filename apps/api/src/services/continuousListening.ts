import type { PrismaClient } from "@vaettir/db";
import { fetchFileAtCommit } from "./changeImpact.js";
import { kickReverseEngineerQueue } from "../jobs/reverseEngineerWorker.js";
import { lockMappingProject, validateTriggeringResult } from "./externalTestMapping.js";

// P5-14: turns reverse-engineering from something someone has to remember
// to run into a standing guarantee. Called from ingestJUnit for every
// result that landed with no TestCaseSource match -- rather than just
// leaving it queued for manual linking (P5-04), fetch that test's source
// at the run's commit and auto-enqueue a scoped ReverseEngineerJob against
// just that file, matching the same content-fetched-at-enqueue-time
// pattern P2-02's repo scan already uses (see agent.ts's scanRepo).
//
// Silently does nothing (not an error) when it can't proceed: no
// project.repoUrl, no externalFilePath on the result (most JUnit reporters
// don't emit one), the file can't be fetched at that commit, or a job for
// this exact result already exists (triggeringResultId is unique). Every
// one of those cases is already covered by the manual "Link to test case"
// picker (P5-04) -- this is a bonus fast path, not the only path.
export async function autoEnqueueUnmatchedResult(
  prisma: PrismaClient,
  args: { projectId: string; testResultId: string; externalFilePath: string; commitSha: string },
): Promise<void> {
  const result = await validateTriggeringResult(prisma, args.projectId, args.testResultId);
  if (result.testCaseId) return;
  const project = await prisma.project.findUnique({ where: { id: args.projectId }, select: { repoUrl: true } });
  if (!project?.repoUrl) return;

  const existing = await prisma.reverseEngineerJob.findUnique({ where: { triggeringResultId: args.testResultId } });
  if (existing) return;

  const content = await fetchFileAtCommit(project.repoUrl, args.commitSha, args.externalFilePath);
  if (!content) return;

  await prisma.$transaction(async (tx) => {
    await lockMappingProject(tx, args.projectId);
    const current = await validateTriggeringResult(tx, args.projectId, args.testResultId);
    if (current.testCaseId || await tx.reverseEngineerJob.findUnique({ where: { triggeringResultId: args.testResultId } })) return;
    await tx.reverseEngineerJob.create({
      data: {
        projectId: args.projectId,
        inputType: "CI_UNMATCHED_RESULT",
        inputRef: args.externalFilePath,
        content,
        triggeringResultId: args.testResultId,
      },
    });
  });
  void kickReverseEngineerQueue();
}
