import type { PrismaClient } from "@vaettir/db";
import { recommendTestPlansForDiff } from "@vaettir/ai-agent";
import { getChangedFiles, getDiffContent } from "./changeImpact.js";
import { matchChangedFilesToTestCases } from "./changeMatch.js";
import { postMergeRequestNote } from "./gitlabApi.js";
import { chargeAiCredits, meterAiCall } from "./aiCredits.js";

// P6-07: the GitLab equivalent of P6-01/P6-05's GitHub PR webhook +
// comment bot. This is deliberately adapter work, not a parallel
// implementation: getChangedFiles/getDiffContent/matchChangedFilesToTestCases
// are plain `git clone` + `git diff` against a repoUrl - already fully
// provider-agnostic, never touching a GitHub- or GitLab-specific API - so
// the only genuinely new code here is parsing GitLab's payload shape and
// (best-effort) posting the result back as a merge request note.
const RELEVANT_ACTIONS = new Set(["open", "reopen", "update"]);

export interface GitlabMergeRequestPayload {
  object_kind: string;
  project: {
    id: number;
    git_http_url: string;
    web_url: string;
  };
  object_attributes: {
    iid: number;
    action: string;
    target_branch: string;
    source_branch: string;
    diff_refs: { base_sha: string; head_sha: string };
  };
}

export interface HandleMergeRequestResult {
  handled: boolean;
  reason?: string;
  runId?: string;
  notePosted?: boolean;
}

// Mirrors handlePullRequestWebhook's shape exactly (see githubWebhook.ts) -
// a webhook-triggered scan always persists a TestSelectionRun as a record,
// independent of any Vaettir Release, and only spends an LLM call / posts
// a note when the project's PrScanPolicy asks for it.
export async function handleMergeRequestWebhook(
  prisma: PrismaClient,
  payload: GitlabMergeRequestPayload,
): Promise<HandleMergeRequestResult> {
  if (payload.object_kind !== "merge_request") {
    return { handled: false, reason: `ignored object_kind: ${payload.object_kind}` };
  }
  if (!RELEVANT_ACTIONS.has(payload.object_attributes.action)) {
    return { handled: false, reason: `ignored action: ${payload.object_attributes.action}` };
  }

  const project = await prisma.project.findFirst({
    where: { repoUrl: { in: [payload.project.git_http_url, payload.project.web_url] } },
  });
  if (!project || !project.repoUrl) {
    return { handled: false, reason: "no project configured for this repository" };
  }

  const policy = await prisma.prScanPolicy.findUnique({ where: { projectId: project.id } });
  const triggerBranches = policy?.triggerBranches ?? ["main"];
  if (!triggerBranches.includes(payload.object_attributes.target_branch)) {
    return { handled: false, reason: `target branch "${payload.object_attributes.target_branch}" is not in the trigger list` };
  }

  const baseSha = payload.object_attributes.diff_refs.base_sha;
  const headSha = payload.object_attributes.diff_refs.head_sha;

  const changedFiles = await getChangedFiles(project.repoUrl, baseSha, headSha);
  const { mustRun, coverageGaps } = await matchChangedFilesToTestCases(prisma, project.id, changedFiles);

  const run = await prisma.testSelectionRun.create({
    data: {
      projectId: project.id,
      baseRef: baseSha,
      headRef: headSha,
      changedFiles,
      recommendations: {
        create: mustRun.map((m) => ({
          testCaseId: m.testCaseId,
          recommended: true,
          matchReason: m.matchReason,
          riskScoreSnapshot: m.riskScore,
        })),
      },
    },
  });

  const commentMode = policy?.commentMode ?? "COMMENT";
  if (commentMode !== "COMMENT") {
    return { handled: true, runId: run.id, notePosted: false };
  }

  const gitlabBaseUrl = process.env.GITLAB_BASE_URL ?? "https://gitlab.com";
  const accessToken = process.env.GITLAB_ACCESS_TOKEN;
  if (!accessToken) {
    return { handled: true, runId: run.id, notePosted: false, reason: "missing GITLAB_ACCESS_TOKEN" };
  }

  // Everything below is best-effort commentary on top of the already-
  // persisted run, same reasoning as githubWebhook.ts's identical comment -
  // a transient GitLab API failure or LLM error shouldn't turn into a 500
  // that makes GitLab retry-storm the whole scan.
  try {
    const diffContent = await getDiffContent(project.repoUrl, baseSha, headSha);
    let aiSection = "";
    if (diffContent.trim().length > 0) {
      const testPlans = await prisma.testPlan.findMany({
        where: { projectId: project.id },
        select: { id: true, name: true, description: true },
      });
      if (testPlans.length > 0) {
        const charge = await chargeAiCredits(prisma, project.organizationId, "recommendTestPlansForDiff", `GitLab webhook MR !${payload.object_attributes.iid}`);
        const recommendation = await meterAiCall(prisma, charge, () => recommendTestPlansForDiff({ diffContent, testPlans }));
        const relevantNames = testPlans.filter((p) => recommendation.relevantTestPlanIds.includes(p.id)).map((p) => p.name);
        aiSection = [
          "",
          "**Relevant test plans:**",
          relevantNames.length > 0 ? relevantNames.map((n) => `- ${n}`).join("\n") : "_None of the existing test plans look relevant._",
          "",
          recommendation.rationale,
          recommendation.suggestedNewTestCases.length > 0
            ? ["", "**Suggested new test cases:**", ...recommendation.suggestedNewTestCases.map((t) => `- ${t}`)].join("\n")
            : "",
        ].join("\n");
      }
    }

    const noteBody = buildNoteBody(mustRun, coverageGaps, aiSection);
    await postMergeRequestNote(gitlabBaseUrl, accessToken, payload.project.id, payload.object_attributes.iid, noteBody);

    return { handled: true, runId: run.id, notePosted: true };
  } catch (err) {
    return { handled: true, runId: run.id, notePosted: false, reason: err instanceof Error ? err.message : "unknown error posting merge request note" };
  }
}

function buildNoteBody(
  mustRun: { title: string; sourceFilePath: string | null }[],
  coverageGaps: string[],
  aiSection: string,
): string {
  const lines = ["### Vaettir MR Scan", ""];
  if (mustRun.length > 0) {
    lines.push("**Must-run test cases** (source file changed in this MR):");
    lines.push(...mustRun.slice(0, 25).map((m) => `- ${m.title} (\`${m.sourceFilePath}\`)`));
  } else {
    lines.push("No tracked test cases match the files changed in this MR.");
  }
  lines.push("");
  if (coverageGaps.length > 0) {
    lines.push("**Coverage gaps** (changed, but no tracked test case covers them):");
    lines.push(...coverageGaps.slice(0, 25).map((f) => `- \`${f}\``));
  } else {
    lines.push("No coverage gaps detected.");
  }
  if (aiSection) lines.push(aiSection);
  return lines.join("\n");
}
