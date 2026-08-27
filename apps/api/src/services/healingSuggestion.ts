import type { HealingSuggestion, PrismaClient } from "@vaettir/db";
import { classifyTestFailure } from "@vaettir/ai-agent";
import { fetchFileAtCommit } from "./changeImpact.js";
import { chargeAiCredits } from "./aiCredits.js";

export type ClassifyResult =
  | { ok: true; suggestion: HealingSuggestion }
  | { ok: false; reason: string };

// P6.5-01/02: classifies a failing TestResult as brittle vs. real, and for
// a confident brittle case, proposes a fix -- grounded in the actual diff
// between the test source at its last known-good commit and the failing
// commit, not just the error message. Never touches the repo; the result
// is a HealingSuggestion row for a human to review (P6.5-03).
export async function classifyAndSuggestHealing(prisma: PrismaClient, testResultId: string): Promise<ClassifyResult> {
  const existing = await prisma.healingSuggestion.findUnique({ where: { testResultId } });
  if (existing) return { ok: true, suggestion: existing };

  const failingResult = await prisma.testResult.findUniqueOrThrow({
    where: { id: testResultId },
    include: { testRun: true, testCase: { include: { source: true, project: true } } },
  });

  if (failingResult.status !== "FAIL") {
    return { ok: false, reason: "Only FAIL results can be classified" };
  }
  if (!failingResult.testCaseId || !failingResult.testCase) {
    return { ok: false, reason: "This result isn't linked to a tracked test case yet" };
  }
  const filePath = failingResult.testCase.source?.filePath;
  if (!filePath) {
    return { ok: false, reason: "This test case has no known source file to diff against" };
  }
  const repoUrl = failingResult.testCase.project.repoUrl;
  if (!repoUrl) {
    return { ok: false, reason: "This project has no repo URL configured" };
  }

  const lastPassing = await prisma.testResult.findFirst({
    where: {
      testCaseId: failingResult.testCaseId,
      status: "PASS",
      testRun: { startedAt: { lt: failingResult.testRun.startedAt } },
    },
    orderBy: { testRun: { startedAt: "desc" } },
    include: { testRun: true },
  });
  if (!lastPassing) {
    return { ok: false, reason: "No prior passing result found for this test case to diff against" };
  }

  const [sourceAtLastPass, sourceAtFailure] = await Promise.all([
    fetchFileAtCommit(repoUrl, lastPassing.testRun.commitSha, filePath),
    fetchFileAtCommit(repoUrl, failingResult.testRun.commitSha, filePath),
  ]);
  if (sourceAtLastPass === null || sourceAtFailure === null) {
    return { ok: false, reason: "Could not fetch the test source at one or both commits" };
  }

  const project = failingResult.testCase.project;
  await chargeAiCredits(prisma, project.organizationId, "classifyTestFailure", `TestResult ${testResultId}`);

  const result = await classifyTestFailure({
    testTitle: failingResult.testCase.title,
    errorMessage: failingResult.errorMessage,
    filePath,
    sourceAtLastPass,
    sourceAtFailure,
  });

  const suggestion = await prisma.healingSuggestion.create({
    data: {
      testResultId,
      testCaseId: failingResult.testCaseId,
      projectId: project.id,
      classification: result.classification,
      classificationRationale: result.classificationRationale,
      suggestedDiff: result.suggestedDiff,
      suggestionRationale: result.suggestionRationale,
    },
  });

  return { ok: true, suggestion };
}

// P6.5-04: closes the loop without needing repo write access or a
// triggered re-run -- when a normal CI ingestion later reports this same
// test case PASSing again, any of its still-open (reviewed or not, just
// not yet resolved) suggestions are marked resolved. Called from the
// result ingestion path (testRuns.ts), not on a schedule -- there's
// nothing to check until a new result actually arrives.
export async function resolveHealingSuggestionsOnPass(prisma: PrismaClient, testCaseId: string): Promise<void> {
  await prisma.healingSuggestion.updateMany({
    where: { testCaseId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}
