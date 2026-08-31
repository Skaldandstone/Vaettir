import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@vaettir/db";
import { reverseEngineerTestFile } from "@vaettir/ai-agent";
import { appRouter } from "../router.js";
import { runReverseEngineerJob } from "../jobs/reverseEngineerWorker.js";
import { hardDeleteOrganization } from "./orgHardDelete.js";
import { autoEnqueueUnmatchedResult } from "./continuousListening.js";
import { linkExternalTestResult } from "./externalTestMapping.js";

vi.mock("@vaettir/ai-agent", async (importOriginal) => ({
  ...await importOriginal<typeof import("@vaettir/ai-agent")>(),
  reverseEngineerTestFile: vi.fn().mockRejectedValue(new Error("Live AI must never run in this test")),
}));

const run = `mapping-${randomUUID()}`;
let ownerId: string;
const orgIds: string[] = [], projectIds: string[] = [];
async function caller() { return appRouter.createCaller({ prisma, user: await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, include: { memberships: true } }), staff: null }); }
async function testCase(projectId: string, externalTestId?: string) {
  return prisma.testCase.create({ data: { projectId, title: randomUUID(), testType: "FUNCTIONAL", source: { create: { filePath: randomUUID(), functionName: "same", framework: "vitest", externalTestId } } }, include: { source: true } });
}
async function testResult(projectId: string, externalTestId: string) {
  const testRun = await prisma.testRun.create({ data: { projectId, ciProvider: "fixture", commitSha: "fixture", branch: "fixture", startedAt: new Date() } });
  return prisma.testResult.create({ data: { testRunId: testRun.id, externalTestId, status: "PASS" } });
}
function ingest(projectId: string, name: string) {
  return { projectId, ciProvider: "fixture", commitSha: "fixture", branch: "fixture", junitXml: `<testsuite><testcase classname="Suite" name="${name}" /></testsuite>` };
}
beforeAll(async () => {
  ownerId = (await prisma.user.create({ data: { clerkUserId: run, email: `${run}@example.com` } })).id;
  const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "private-beta" } });
  for (let n = 0; n < 2; n++) {
    const org = await prisma.organization.create({ data: { name: `${run}-${n}`, slug: `${run}-${n}`, planTierId: tier.id } }); orgIds.push(org.id);
    await prisma.membership.create({ data: { organizationId: org.id, userId: ownerId, role: "OWNER" } });
    for (let p = 0; p < (n === 0 ? 2 : 1); p++) projectIds.push((await prisma.project.create({ data: { organizationId: org.id, name: `${n}-${p}`, slug: `${n}-${p}` } })).id);
  }
});
afterAll(async () => {
  for (const organizationId of orgIds) {
    await hardDeleteOrganization(prisma, organizationId, ownerId, "Mapping fixture cleanup");
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId } });
  }
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
});

describe.sequential("Project-scoped CI mappings", () => {
  it("allows identical CI names in different orgs and different projects of the same org", async () => {
    const api = await caller();
    for (const projectId of projectIds) {
      const tc = await testCase(projectId, "Suite::shared");
      const result = await api.testRuns.ingestJUnit(ingest(projectId, "shared"));
      expect(result.matchedCount).toBe(1);
      expect((await prisma.testResult.findFirstOrThrow({ where: { testRunId: result.testRunId } })).testCaseId).toBe(tc.id);
    }
  });

  it("repeated concurrent mappings to the same case are idempotent", async () => {
    const api = await caller(), projectId = projectIds[0];
    const tc = await testCase(projectId);
    const result = await testResult(projectId, "Suite::repeat");
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => api.testRuns.linkResultToTestCase({ testResultId: result.id, testCaseId: tc.id })));
    expect(outcomes.every((r) => r.testCaseId === tc.id)).toBe(true);
    expect(await prisma.testCaseSource.count({ where: { testCase: { projectId }, externalTestId: "Suite::repeat" } })).toBe(1);
  });

  it("fails closed on ambiguous same-project mappings before ingestion writes or AI work", async () => {
    const api = await caller(), projectId = projectIds[0];
    await testCase(projectId, "Suite::ambiguous"); await testCase(projectId, "Suite::ambiguous");
    const beforeRuns = await prisma.testRun.count({ where: { projectId } });
    const beforeResults = await prisma.testResult.count({ where: { testRun: { projectId } } });
    const calls = vi.mocked(reverseEngineerTestFile).mock.calls.length;
    await expect(api.testRuns.ingestJUnit(ingest(projectId, "ambiguous"))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.testRun.count({ where: { projectId } })).toBe(beforeRuns);
    expect(await prisma.testResult.count({ where: { testRun: { projectId } } })).toBe(beforeResults);
    const result = await testResult(projectId, "Suite::ambiguous");
    const job = await prisma.reverseEngineerJob.create({ data: { projectId, inputType: "CI_UNMATCHED_RESULT", inputRef: "fixture.ts", content: "fixture", triggeringResultId: result.id } });
    const charges = await prisma.aiCreditTransaction.count({ where: { organizationId: orgIds[0], type: "CONSUMPTION" } });
    await runReverseEngineerJob(job.id);
    expect((await prisma.reverseEngineerJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
    expect(vi.mocked(reverseEngineerTestFile).mock.calls.length).toBe(calls);
    expect(await prisma.aiCreditTransaction.count({ where: { organizationId: orgIds[0], type: "CONSUMPTION" } })).toBe(charges);
  });

  it("rejects a worker/queue triggering result from another project before AI", async () => {
    const result = await testResult(projectIds[2], "Suite::foreign");
    const job = await prisma.reverseEngineerJob.create({ data: { projectId: projectIds[0], inputType: "CI_UNMATCHED_RESULT", inputRef: "fixture.ts", content: "fixture", triggeringResultId: result.id } });
    const calls = vi.mocked(reverseEngineerTestFile).mock.calls.length;
    await runReverseEngineerJob(job.id);
    expect((await prisma.reverseEngineerJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
    await expect(autoEnqueueUnmatchedResult(prisma, { projectId: projectIds[0], testResultId: result.id, externalFilePath: "fixture.ts", commitSha: "fixture" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(vi.mocked(reverseEngineerTestFile).mock.calls.length).toBe(calls);
  });

  it("allows a valid worker link and repeating the same mapping safely", async () => {
    const projectId = projectIds[1];
    const result = await testResult(projectId, "Suite::worker-success");
    const job = await prisma.reverseEngineerJob.create({ data: { projectId, inputType: "CI_UNMATCHED_RESULT", inputRef: "worker-success.ts", content: "stubbed test", triggeringResultId: result.id } });
    const generated = { detectedFramework: "vitest", detectedFrameworkFamily: "VITEST" as const, testCases: [{ title: "Generated fixture", given: ["a"], when: ["b"], then: ["c"], tags: [], testType: "FUNCTIONAL" as const, confidence: 1, sourceFunctionName: "worker-success" }] };
    vi.mocked(reverseEngineerTestFile).mockResolvedValueOnce(generated);
    await runReverseEngineerJob(job.id);
    expect((await prisma.reverseEngineerJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SUCCEEDED");
    const linked = await prisma.testResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(linked.testCaseId).not.toBeNull();
    const repeated = await Promise.all(Array.from({ length: 4 }, () => linkExternalTestResult(prisma, { projectId, testResultId: result.id, testCaseId: linked.testCaseId!, jobId: job.id })));
    expect(repeated.every((r) => r.testCaseId === linked.testCaseId)).toBe(true);
    expect(await prisma.testCaseSource.count({ where: { testCase: { projectId }, externalTestId: "Suite::worker-success" } })).toBe(1);
    const unrelated = await testCase(projectId);
    await expect(linkExternalTestResult(prisma, { projectId, testResultId: result.id, testCaseId: unrelated.id, jobId: job.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("serializes two competing manual mappings into exactly one project mapping", async () => {
    const projectId = projectIds[1], api = await caller();
    const cases = await Promise.all([testCase(projectId), testCase(projectId)]);
    const results = await Promise.all([testResult(projectId, "Suite::manual-race"), testResult(projectId, "Suite::manual-race")]);
    const outcomes = await Promise.allSettled(cases.map((tc, n) => api.testRuns.linkResultToTestCase({ testCaseId: tc.id, testResultId: results[n].id })));
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.testCaseSource.count({ where: { testCase: { projectId }, externalTestId: "Suite::manual-race" } })).toBe(1);
    expect(await prisma.testResult.count({ where: { id: { in: results.map((r) => r.id) }, testCaseId: { not: null } } })).toBe(1);
  });

  it("serializes conflicting manual and worker mappings without live AI", async () => {
    const api = await caller(), projectId = projectIds[1];
    const manualCase = await testCase(projectId), workerCase = await testCase(projectId);
    const manualResult = await testResult(projectId, "Suite::race"), workerResult = await testResult(projectId, "Suite::race");
    const job = await prisma.reverseEngineerJob.create({ data: { projectId, inputType: "CI_UNMATCHED_RESULT", inputRef: workerCase.source!.filePath, content: "stubbed test", triggeringResultId: workerResult.id } });
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(reverseEngineerTestFile).mockImplementationOnce(async () => {
      entered(); await barrier;
      return { detectedFramework: "vitest", detectedFrameworkFamily: "VITEST", testCases: [{ title: "Generated fixture", given: ["a"], when: ["b"], then: ["c"], tags: [], testType: "FUNCTIONAL", confidence: 1, sourceFunctionName: "same" }] };
    });
    const worker = runReverseEngineerJob(job.id);
    await ready;
    // Commit the competing manual mapping while the worker is at its AI barrier.
    // The worker must re-check after it resumes, not trust its pre-AI snapshot.
    try {
      await api.testRuns.linkResultToTestCase({ testResultId: manualResult.id, testCaseId: manualCase.id });
    } finally { release(); }
    await worker;
    expect((await prisma.reverseEngineerJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
    expect((await prisma.testResult.findUniqueOrThrow({ where: { id: workerResult.id } })).testCaseId).toBeNull();
    expect((await prisma.testResult.findUniqueOrThrow({ where: { id: manualResult.id } })).testCaseId).toBe(manualCase.id);
    expect(await prisma.testCaseSource.count({ where: { testCase: { projectId }, externalTestId: "Suite::race" } })).toBe(1);
  }, 20000);
});
