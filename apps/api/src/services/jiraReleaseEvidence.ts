import { createHash } from "node:crypto";
import { Prisma } from "@vaettir/db";
import { buildReleaseVisualReport } from "@vaettir/core";
import { z } from "@vaettir/core/dist/validation.js";
import {
  authorizeForgeSharing,
  forgeSharingEntityType,
  latestForgeSharing,
} from "./atlassianQualitySharing.js";
import { readReportPlanCaseScope } from "./reportPlanCaseScope.js";
import {
  ticketObservation,
  type VerificationObservation,
} from "./jiraTicketVerification.js";
import type { ForgeIdentity, ForgeEventIdentity } from "./forgeInvocation.js";
import {
  forgeReleaseLink,
  jiraVersionMetadata,
  releaseEvidenceSummary,
  type ReleaseEvidenceSummary,
} from "./forgeReleaseSchema.js";

export const releaseClosureEntity = "JiraReleaseClosure";
export function publicReleaseEvidence(summary: ReleaseEvidenceSummary) {
  const attention = summary.tests.filter(
    (t) => t.outcome !== "PASS" || t.reviewStatus !== "APPROVED",
  );
  return {
    ...summary,
    visuals: buildReleaseVisualReport(summary),
    tests: attention.slice(0, 100),
    totalAttention: attention.length,
    testsLimited: attention.length > 100,
  };
}
export function releaseClosureId(
  projectId: string,
  identity: Pick<
    ForgeIdentity,
    "installationId" | "environmentId" | "cloudId" | "targetId"
  >,
  versionId: string,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        projectId,
        identity.installationId,
        identity.environmentId,
        identity.cloudId,
        identity.targetId,
        versionId,
      ]),
    )
    .digest("hex");
}
type Case = {
  id: string;
  displayId: string;
  title: string;
  priority: string;
  reviewStatus: string;
};
type Run = {
  id: string;
  status: string;
  ciProvider: string;
  startedAt: Date;
  finishedAt: Date | null;
  commitSha: string;
  branch: string;
  manualTestCaseIds: string[];
};
type Result = { testCaseId: string | null; testRunId: string; status: string };
export function releaseVerificationMetrics(
  projectId: string,
  cases: Case[],
  runs: Run[],
  results: Result[],
) {
  const ids = new Set(cases.map((c) => c.id)),
    runMap = new Map(runs.map((r) => [r.id, r]));
  if (
    ids.size !== cases.length ||
    runMap.size !== runs.length ||
    results.some((r) => !runMap.has(r.testRunId))
  )
    throw new Error("Release evidence identities conflict");
  const counts = {
    planned: cases.length,
    recorded: 0,
    pass: 0,
    fail: 0,
    blocked: 0,
    skipped: 0,
    flaky: 0,
    mixed: 0,
    ambiguous: 0,
    notRecorded: 0,
  };
  const statusesByCase = new Map<string, Map<string, string[]>>(),
    plansByCase = new Map<string, Set<string>>();
  for (const result of results) {
    if (!result.testCaseId || !ids.has(result.testCaseId)) continue;
    const byRun =
      statusesByCase.get(result.testCaseId) ?? new Map<string, string[]>();
    const statuses = byRun.get(result.testRunId) ?? [];
    statuses.push(result.status);
    byRun.set(result.testRunId, statuses);
    statusesByCase.set(result.testCaseId, byRun);
  }
  for (const run of runs)
    if (run.ciProvider === "manual")
      for (const id of run.manualTestCaseIds) {
        const selected = plansByCase.get(id) ?? new Set<string>();
        selected.add(run.id);
        plansByCase.set(id, selected);
      }
  const tests = cases.map((c) => {
    const observations: VerificationObservation[] = [];
    const selected = new Set([
      ...(statusesByCase.get(c.id)?.keys() ?? []),
      ...(plansByCase.get(c.id) ?? []),
    ]);
    for (const runId of selected) {
      const run = runMap.get(runId)!,
        statuses = statusesByCase.get(c.id)?.get(runId) ?? [];
      observations.push({
        runId: run.id,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        runStatus: run.status,
        statuses,
        href: "https://vaettir.skaldandstone.com/",
      });
    }
    const observation = ticketObservation(observations),
      outcome = observation.outcome;
    const observed = observation.runs.some((r) => r.statuses.length > 0);
    if (!observed) counts.notRecorded++;
    else counts.recorded++;
    if (observed) {
      if (outcome === "PASS") counts.pass++;
      else if (outcome === "FAIL") counts.fail++;
      else if (outcome === "BLOCKED") counts.blocked++;
      else if (outcome === "SKIP") counts.skipped++;
      else if (outcome === "FLAKY") counts.flaky++;
      else if (outcome === "MIXED") counts.mixed++;
      else if (outcome === "AMBIGUOUS") counts.ambiguous++;
    }
    return {
      ...c,
      outcome,
      runIds: observation.runs.map((r) => r.runId),
      href: `https://vaettir.skaldandstone.com/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(c.id)}`,
    };
  });
  return {
    counts,
    tests,
    recordedFailures: results.filter((r) => r.status === "FAIL").length,
    failedRuns: runs.filter((r) => r.status === "FAILED").length,
    unmatchedObservations: results.filter((r) => !r.testCaseId).length,
    outsideCohortObservations: results.filter(
      (r) => r.testCaseId && !ids.has(r.testCaseId),
    ).length,
  };
}
export async function readReleaseEvidence(
  tx: Prisma.TransactionClient,
  projectId: string,
  link: z.infer<typeof forgeReleaseLink>,
  version: z.infer<typeof jiraVersionMetadata>,
  capture = false,
): Promise<{ summary: ReleaseEvidenceSummary; definitions: Prisma.JsonValue }> {
  const release = await tx.release.findFirst({
    where: { id: link.releaseId, projectId },
    include: {
      testPlans: { select: { id: true } },
      riskFlags: { where: { resolvedAt: null }, select: { severity: true } },
    },
  });
  if (!release) throw new Error("The linked release is no longer available");
  const plans = release.testPlans.map((p) => p.id);
  if (plans.length)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "TestPlan" WHERE "projectId"=${projectId} AND id IN (${Prisma.join(plans)}) FOR SHARE`,
    );
  const { caseIds } = await readReportPlanCaseScope(tx, projectId, plans);
  if (caseIds.length)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "TestCase" WHERE "projectId"=${projectId} AND id IN (${Prisma.join(caseIds)}) ORDER BY id FOR SHARE`,
    );
  if (link.runIds.length)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "TestRun" WHERE "projectId"=${projectId} AND id IN (${Prisma.join([...link.runIds].sort())}) ORDER BY id ${capture ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`,
    );
  const cases = await tx.testCase.findMany({
    where: { projectId, id: { in: caseIds } },
    select: {
      id: true,
      displayId: true,
      title: true,
      priority: true,
      reviewStatus: true,
      ...(capture
        ? {
            background: true,
            given: true,
            when: true,
            then: true,
            verificationProfile: true,
            steps: {
              orderBy: { order: "asc" as const },
              select: {
                order: true,
                action: true,
                expectedActionOrData: true,
                expectedResponse: true,
                expectedResult: true,
                mediaAttachmentIds: true,
              },
            },
            sharedStepGroup: {
              select: {
                id: true,
                projectId: true,
                revision: true,
                name: true,
                steps: true,
              },
            },
            versions: {
              orderBy: { versionNumber: "desc" as const },
              take: 1,
              select: { id: true, versionNumber: true },
            },
          }
        : {}),
    },
    orderBy: { id: "asc" },
  });
  if (
    capture &&
    cases.some(
      (c) => c.sharedStepGroup && c.sharedStepGroup.projectId !== projectId,
    )
  )
    throw new Error("Shared procedure scope conflicts");
  const runs = await tx.testRun.findMany({
    where: { projectId, id: { in: link.runIds } },
    orderBy: [{ startedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      ciProvider: true,
      startedAt: true,
      finishedAt: true,
      commitSha: true,
      branch: true,
      manualTestCaseIds: true,
      ...(capture ? { executionContext: true } : {}),
    },
  });
  if (cases.length !== caseIds.length || runs.length !== link.runIds.length)
    throw new Error(
      "A complete release cohort and all approved validation runs are required",
    );
  const results = await tx.testResult.findMany({
    where: { testRunId: { in: link.runIds }, testRun: { projectId } },
    select: { id: true, testCaseId: true, testRunId: true, status: true },
    take: 100001,
  });
  if (results.length > 100000)
    throw new Error(
      "Release evidence exceeds capture capacity; no partial snapshot was saved",
    );
  const definitions = capture
    ? (JSON.parse(JSON.stringify({ cases, runs, results })) as Prisma.JsonValue)
    : {};
  if (Buffer.byteLength(JSON.stringify(definitions)) > 16_000_000)
    throw new Error(
      "Complete release definitions exceed capture capacity; no data was truncated",
    );
  const riskCounts = new Map<string, number>();
  for (const risk of release.riskFlags)
    riskCounts.set(risk.severity, (riskCounts.get(risk.severity) ?? 0) + 1);
  const summary = releaseEvidenceSummary.parse({
    protocol: "vaettir-release-quality/v1",
    mode: "LIVE",
    projectId,
    releaseId: release.id,
    releaseName: release.name,
    jiraVersionId: version.id,
    jiraVersionName: version.name,
    capturedAt: new Date().toISOString(),
    ...releaseVerificationMetrics(projectId, cases, runs, results),
    risks: [...riskCounts].map(([severity, count]) => ({ severity, count })),
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      commitSha: run.commitSha,
      branch: run.branch,
      href:
        run.ciProvider === "manual"
          ? `https://vaettir.skaldandstone.com/projects/${encodeURIComponent(projectId)}/test-runs/manual/${encodeURIComponent(run.id)}`
          : `https://vaettir.skaldandstone.com/projects/${encodeURIComponent(projectId)}/test-runs#run-${encodeURIComponent(run.id)}`,
    })),
    notice:
      "Results are from explicitly selected validation runs and the captured release-plan cohort. Recorded progress is not approval or proof of the current case definition. Pending review, blocked, skipped, flaky, mixed, ambiguous and unrun tests remain distinct from Pass. Run links retain access controls.",
  });
  return { summary, definitions };
}

export async function readJiraReleaseQuality(
  tx: Prisma.TransactionClient,
  connectionKey: string,
  identity: ForgeIdentity,
  version: z.infer<typeof jiraVersionMetadata>,
) {
  const { projectId, orgId, sharing } = await authorizeForgeSharing(
    tx,
    connectionKey,
    identity,
  );
  if (
    identity.product !== "jira" ||
    String(version.projectId) !== identity.targetId
  )
    throw new Error("Jira version project differs from approved sharing");
  const link = sharing.releaseLinks.find((l) => l.jiraVersionId === version.id);
  if (!link)
    throw new Error(
      "This release and validation-run scope has not been approved",
    );
  const id = releaseClosureId(projectId, identity, version.id);
  const frozen = await tx.auditLog.findFirst({
    where: {
      id,
      organizationId: orgId,
      projectId,
      entityType: releaseClosureEntity,
    },
  });
  if (version.released && frozen)
    return releaseEvidenceSummary.parse(
      (frozen.metadata as Prisma.JsonObject).summary,
    );
  const { summary } = await readReleaseEvidence(tx, projectId, link, version);
  return {
    ...summary,
    mode: version.released
      ? ("RELEASED_CAPTURE_UNAVAILABLE" as const)
      : ("LIVE" as const),
    notice: version.released
      ? "Jira is Released, but no verified release-notification capture is retained. These are CURRENT metrics, not reconstructed historical closure metrics. " +
        summary.notice
      : summary.notice,
  };
}

/** The first successful notification capture is immutable. Reopened releases,
 * changed runs, repeated notifications and retries never replace that history.
 * This captures notification-processing time, not an invented exact Jira
 * transition timestamp. The private definitions never leave Vaettir. */
export async function captureJiraRelease(
  tx: Prisma.TransactionClient,
  connectionKey: string,
  identity: ForgeIdentity,
  version: z.infer<typeof jiraVersionMetadata>,
  observedAt: string,
) {
  if (
    !version.released ||
    identity.product !== "jira" ||
    String(version.projectId) !== identity.targetId
  )
    throw new Error("A verified Released version is required");
  const { sharing, orgId, projectId } = await authorizeForgeSharing(
    tx,
    connectionKey,
    identity,
  );
  const link = sharing.releaseLinks.find((l) => l.jiraVersionId === version.id);
  if (!link) return { captured: false };
  const id = releaseClosureId(projectId, identity, version.id);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))::text`;
  const prior = await tx.auditLog.findUnique({ where: { id } });
  if (prior) {
    if (
      prior.entityType !== releaseClosureEntity ||
      prior.projectId !== projectId ||
      prior.organizationId !== orgId
    )
      throw new Error("Closure identity conflict");
    return { captured: true };
  }
  const grants = await tx.auditLog.findMany({
    where: {
      organizationId: orgId,
      projectId,
      entityType: forgeSharingEntityType,
      entityId: connectionKey,
    },
    take: 501,
  });
  const grant = grants.find(
    (g) => (g.metadata as Prisma.JsonObject)?.version === sharing.version,
  );
  if (!grant) throw new Error("Release sharing approval unavailable");
  const { summary, definitions } = await readReleaseEvidence(
    tx,
    projectId,
    link,
    version,
    true,
  );
  const frozen = releaseEvidenceSummary.parse({
    ...summary,
    mode: "FROZEN",
    closureId: id,
    notice:
      "Frozen automatically following Jira's Released notification. Captured at the time shown; delivery or processing may lag the Jira transition. Later run edits, release reopening and repeated release events do not rewrite this first capture. " +
      summary.notice,
  });
  await tx.auditLog.create({
    data: {
      id,
      organizationId: orgId,
      projectId,
      actorId: grant.actorId,
      entityType: releaseClosureEntity,
      entityId: id,
      action: "CREATE",
      summary:
        "Automated historical quality capture following Jira version Released; authorized by the recorded sharing approval",
      metadata: {
        automation: "JIRA_VERSION_RELEASED",
        approvalId: grant.id,
        approvalVersion: sharing.version,
        binding: sharing.binding,
        observedAt,
        jiraVersion: version,
        summary: frozen,
        definitions,
      },
    },
  });
  return { captured: true };
}

export async function releaseEventConnections(
  tx: Prisma.TransactionClient,
  identity: ForgeEventIdentity,
  version: z.infer<typeof jiraVersionMetadata>,
) {
  const fields = {
    appId: identity.appId,
    installationId: identity.installationId,
    environmentId: identity.environmentId,
    cloudId: identity.cloudId,
    product: "jira",
    targetId: String(version.projectId),
  };
  const rows = await tx.auditLog.findMany({
    where: {
      entityType: forgeSharingEntityType,
      AND: Object.entries(fields).map(([key, value]) => ({
        metadata: { path: ["binding", key], equals: value },
      })),
    },
    take: 5001,
  });
  if (rows.length > 5000)
    throw new Error("Release sharing catalog exceeds capacity");
  const groups = new Map<string, typeof rows>();
  for (const row of rows)
    groups.set(row.entityId, [...(groups.get(row.entityId) ?? []), row]);
  return [...groups].flatMap(([key, versions]) => {
    const sharing = latestForgeSharing(versions);
    return sharing?.state === "APPROVED" &&
      sharing.releaseLinks.some((l) => l.jiraVersionId === version.id)
      ? [
          {
            key,
            identity: {
              ...identity,
              ...sharing.binding,
              principal: "automated-release-event",
              moduleKey: "release-event",
            } as ForgeIdentity,
          },
        ]
      : [];
  });
}

export async function readSharedClosure(
  tx: Prisma.TransactionClient,
  connectionKey: string,
  identity: ForgeIdentity,
  closureId: string,
) {
  const { sharing, orgId, projectId } = await authorizeForgeSharing(
    tx,
    connectionKey,
    identity,
  );
  if (!sharing.closureSnapshotIds.includes(closureId))
    throw new Error(
      "This closure capture has not been approved for this audience",
    );
  const closure = await tx.auditLog.findFirst({
    where: {
      id: closureId,
      projectId,
      organizationId: orgId,
      entityType: releaseClosureEntity,
    },
  });
  if (!closure) throw new Error("Closure capture unavailable");
  return releaseEvidenceSummary.parse(
    (closure.metadata as Prisma.JsonObject).summary,
  );
}
