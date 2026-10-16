import type { Prisma } from "@vaettir/db";
import { authorizeForgeSharing } from "./atlassianQualitySharing.js";
import type { ForgeIdentity } from "./forgeInvocation.js";

export type VerificationObservation = {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  runStatus: string;
  statuses: string[];
  href: string;
};
export function ticketObservation(observations: VerificationObservation[]) {
  const ordered = [...observations].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  );
  if (!ordered.length)
    return { outcome: "NOT_RUN", runs: [] as VerificationObservation[] };
  const recent = ordered.filter((o) => o.startedAt === ordered[0]!.startedAt);
  if (recent.length > 1) return { outcome: "AMBIGUOUS", runs: recent };
  const distinct = [...new Set(recent[0]!.statuses)];
  return {
    outcome:
      distinct.length === 0
        ? "NOT_RECORDED"
        : distinct.length === 1
          ? distinct[0]!
          : "MIXED",
    runs: recent,
  };
}

/** Exact ticket links only. A matching title, nearby requirement, shared suite
 * or entire plan is not evidence that a test verifies this particular issue. */
export async function readJiraTicketVerification(
  tx: Prisma.TransactionClient,
  connectionKey: string,
  identity: ForgeIdentity,
) {
  if (
    identity.product !== "jira" ||
    identity.moduleKey !== "vaettir-issue-quality" ||
    !identity.resourceId ||
    !identity.issueKey
  )
    throw new Error("Ticket context required");
  const { sharing, projectId } = await authorizeForgeSharing(
    tx,
    connectionKey,
    identity,
  );
  if (!sharing.shareTicketTests)
    throw new Error("Ticket verification sharing is not approved");
  const links = await tx.caseTraceabilityLink.findMany({
    where: {
      projectId,
      provider: "jira",
      providerOrigin: identity.siteOrigin,
      nativeId: { in: [identity.resourceId, identity.issueKey] },
      removedAt: null,
    },
    select: {
      caseId: true,
      testCase: {
        select: {
          id: true,
          projectId: true,
          displayId: true,
          title: true,
          priority: true,
          reviewStatus: true,
          archived: true,
        },
      },
    },
    take: 2001,
  });
  if (
    links.length > 2000 ||
    links.some((l) => l.testCase.projectId !== projectId)
  )
    throw new Error("Complete ticket verification scope is unavailable");
  const cases = [...new Map(links.map((l) => [l.caseId, l.testCase])).values()],
    ids = cases.map((c) => c.id);
  const results = ids.length
    ? await tx.testResult.findMany({
        where: { testCaseId: { in: ids }, testRun: { projectId } },
        select: {
          testCaseId: true,
          status: true,
          testRun: {
            select: {
              id: true,
              startedAt: true,
              finishedAt: true,
              status: true,
              ciProvider: true,
            },
          },
        },
        orderBy: { testRun: { startedAt: "desc" } },
        take: 10001,
      })
    : [];
  const planned = ids.length
    ? await tx.testRun.findMany({
        where: {
          projectId,
          ciProvider: "manual",
          manualTestCaseIds: { hasSome: ids },
        },
        select: {
          id: true,
          startedAt: true,
          finishedAt: true,
          status: true,
          ciProvider: true,
          manualTestCaseIds: true,
        },
        take: 1001,
      })
    : [];
  if (results.length > 10000 || planned.length > 1000)
    throw new Error(
      "The complete ticket execution history exceeds this view’s capacity. No partial pass summary was inferred.",
    );
  const tests = cases.map((c) => {
    const observations = new Map<string, VerificationObservation>();
    const add = (r: {
      id: string;
      startedAt: Date;
      finishedAt: Date | null;
      status: string;
      ciProvider: string;
    }) => {
      if (!observations.has(r.id))
        observations.set(r.id, {
          runId: r.id,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
          runStatus: r.status,
          statuses: [],
          href:
            r.ciProvider === "manual"
              ? `https://vaettir.skaldandstone.com/projects/${encodeURIComponent(projectId)}/test-runs/manual/${encodeURIComponent(r.id)}`
              : `https://vaettir.skaldandstone.com/projects/${encodeURIComponent(projectId)}/test-runs#run-${encodeURIComponent(r.id)}`,
        });
      return observations.get(r.id)!;
    };
    for (const run of planned)
      if (run.manualTestCaseIds.includes(c.id)) add(run);
    for (const result of results)
      if (result.testCaseId === c.id)
        add(result.testRun).statuses.push(result.status);
    return {
      id: c.id,
      displayId: c.displayId,
      title: c.title,
      priority: c.priority,
      reviewStatus: c.reviewStatus,
      archived: c.archived,
      ...ticketObservation([...observations.values()]),
      definitionMatch: "NOT_VERIFIED" as const,
      href: `https://vaettir.skaldandstone.com/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(c.id)}`,
    };
  });
  return {
    protocol: "vaettir-ticket-verification/v1" as const,
    issueKey: identity.issueKey,
    asOf: new Date().toISOString(),
    tests,
    notice:
      "Recorded results for explicitly linked tests. A past Pass is not proof of the current ticket, release revision or current case definition. Open the linked run to review its execution scope and evidence.",
  };
}
