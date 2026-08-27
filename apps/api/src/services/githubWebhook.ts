import type { PrismaClient } from "@vaettir/db";
import { recommendTestPlansForDiff } from "@vaettir/ai-agent";
import { getChangedFiles, getDiffContent } from "./changeImpact.js";
import { matchChangedFilesToTestCases } from "./changeMatch.js";
import { getInstallationAccessToken, postPrComment } from "./githubApp.js";

const RELEVANT_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

export interface GithubPullRequestPayload {
  action: string;
  number: number;
  installation?: { id: number };
  repository: { html_url: string; clone_url: string; name: string; owner: { login: string } };
  pull_request: {
    base: { ref: string; sha: string };
    head: { ref: string; sha: string };
  };
}

export interface HandlePullRequestResult {
  handled: boolean;
  reason?: string;
  runId?: string;
  commentPosted?: boolean;
}

// A live PR isn't naturally tied to any Vaettir Release, so unlike
// recommendForChange (which needs a releaseId to persist RiskFlags against),
// a webhook-triggered scan is deliberately lighter-weight: it always
// persists a TestSelectionRun as a record of the scan, and only spends an
// LLM call + posts a PR comment when the project's policy asks for one.
// Preparing an actual release still goes through the human-triggered
// recommendForChange/recommendTestPlansForDiff flow on the Test Strategy
// page, against a specific release, where gaps become real RiskFlags.
export async function handlePullRequestWebhook(
  prisma: PrismaClient,
  payload: GithubPullRequestPayload,
): Promise<HandlePullRequestResult> {
  if (!RELEVANT_ACTIONS.has(payload.action)) {
    return { handled: false, reason: `ignored action: ${payload.action}` };
  }

  const project = await prisma.project.findFirst({
    where: { repoUrl: { in: [payload.repository.html_url, payload.repository.clone_url] } },
  });
  if (!project || !project.repoUrl) {
    return { handled: false, reason: "no project configured for this repository" };
  }

  const policy = await prisma.prScanPolicy.findUnique({ where: { projectId: project.id } });
  const triggerBranches = policy?.triggerBranches ?? ["main"];
  if (!triggerBranches.includes(payload.pull_request.base.ref)) {
    return { handled: false, reason: `base branch "${payload.pull_request.base.ref}" is not in the trigger list` };
  }

  const baseSha = payload.pull_request.base.sha;
  const headSha = payload.pull_request.head.sha;

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
    return { handled: true, runId: run.id, commentPosted: false };
  }

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = payload.installation?.id;
  if (!appId || !privateKey || !installationId) {
    return { handled: true, runId: run.id, commentPosted: false, reason: "missing GitHub App credentials or installation id" };
  }

  // Everything below is best-effort commentary on top of the already-
  // persisted run: a transient GitHub API failure or LLM error here
  // shouldn't turn into a 500 that makes GitHub retry-storm the whole scan.
  try {
    const diffContent = await getDiffContent(project.repoUrl, baseSha, headSha);
    let aiSection = "";
    if (diffContent.trim().length > 0) {
      const testPlans = await prisma.testPlan.findMany({
        where: { projectId: project.id },
        select: { id: true, name: true, description: true },
      });
      if (testPlans.length > 0) {
        const recommendation = await recommendTestPlansForDiff({ diffContent, testPlans });
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

    const commentBody = buildCommentBody(mustRun, coverageGaps, aiSection);
    const token = await getInstallationAccessToken(appId, privateKey, installationId);
    await postPrComment(token, payload.repository.owner.login, payload.repository.name, payload.number, commentBody);

    return { handled: true, runId: run.id, commentPosted: true };
  } catch (err) {
    return { handled: true, runId: run.id, commentPosted: false, reason: err instanceof Error ? err.message : "unknown error posting PR comment" };
  }
}

function buildCommentBody(
  mustRun: { title: string; sourceFilePath: string | null }[],
  coverageGaps: string[],
  aiSection: string,
): string {
  const lines = ["### Vaettir PR Scan", ""];
  if (mustRun.length > 0) {
    lines.push("**Must-run test cases** (source file changed in this PR):");
    lines.push(...mustRun.slice(0, 25).map((m) => `- ${m.title} (\`${m.sourceFilePath}\`)`));
  } else {
    lines.push("No tracked test cases match the files changed in this PR.");
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
