import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { unrealBindingSchema } from "./routers/unrealPlaytests.js";

const marker = `unreal-bridge-${Date.now()}`;
let tierId = "";
let orgId = "";
let projectId = "";
let caseId = "";
let serviceId = "";
let viewerId = "";
let editorId = "";

async function callerFor(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } });
  return appRouter.createCaller({ prisma, user });
}

const config = {
  projectKey: "demo-game", map: "/Game/Maps/L_Bridge", persona: "careful-first-timer",
  walkSeconds: 60, drivePlayer: true, knowsObjectives: false,
  objectives: [{ name: "reach bridge", actorTag: "", actorLabel: "BridgeTarget", optional: false,
    acceptanceRadiusCm: 100, timeBudgetSeconds: 45, interactOnArrival: false, interactionVerb: "" }],
};

beforeAll(async () => {
  const tier = await prisma.planTier.create({ data: { key: marker, name: marker, sortOrder: 999, minFullSeats: 0 } });
  tierId = tier.id;
  const org = await prisma.organization.create({ data: { name: marker, slug: marker, planTierId: tierId } });
  orgId = org.id;
  const project = await prisma.project.create({ data: { organizationId: orgId, name: marker, slug: marker } });
  projectId = project.id;
  const [service, viewer, editor] = await Promise.all([
    prisma.user.create({ data: { clerkUserId: `${marker}-service`, email: `${marker}-service@example.com` } }),
    prisma.user.create({ data: { clerkUserId: `${marker}-viewer`, email: `${marker}-viewer@example.com` } }),
    prisma.user.create({ data: { clerkUserId: `${marker}-editor`, email: `${marker}-editor@example.com` } }),
  ]);
  serviceId = service.id; viewerId = viewer.id; editorId = editor.id;
  await Promise.all([
    prisma.membership.create({ data: { organizationId: orgId, userId: serviceId, role: "EDITOR" } }),
    prisma.membership.create({ data: { organizationId: orgId, userId: viewerId, role: "VIEWER" } }),
    prisma.membership.create({ data: { organizationId: orgId, userId: editorId, role: "EDITOR" } }),
    prisma.apiKey.create({ data: { organizationId: orgId, name: marker, keyPrefix: "test", hashedKey: marker, serviceUserId: serviceId } }),
  ]);
  const testCase = await prisma.testCase.create({ data: {
    projectId, title: "Cross the bridge", testType: "E2E", given: ["on the starting deck"],
    when: ["I cross the bridge"], then: ["I reach the target"], tags: [],
  } });
  caseId = testCase.id;
});

afterAll(async () => {
  if (projectId) {
    const runIds = (await prisma.unrealPlaytestJob.findMany({ where: { projectId }, select: { testRunId: true } })).map((job) => job.testRunId).filter((id): id is string => Boolean(id));
    await prisma.unrealPlaytestJob.deleteMany({ where: { projectId } });
    if (runIds.length) {
      await prisma.testResult.deleteMany({ where: { testRunId: { in: runIds } } });
      await prisma.testRun.deleteMany({ where: { id: { in: runIds } } });
    }
    await prisma.unrealPlaytestBinding.deleteMany({ where: { testCaseId: caseId } });
    await prisma.unrealPlaytestCatalog.deleteMany({ where: { projectId } });
    if (caseId) await prisma.testCase.delete({ where: { id: caseId } });
    await prisma.project.delete({ where: { id: projectId } });
  }
  if (orgId) {
    await prisma.apiKey.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [serviceId, viewerId, editorId].filter(Boolean) } } });
    await prisma.organization.delete({ where: { id: orgId } });
  }
  if (tierId) await prisma.planTier.delete({ where: { id: tierId } });
});

describe("Vaettir to Unreal objective bridge", () => {
  it("rejects unsafe map paths and ambiguous objective selectors", () => {
    expect(unrealBindingSchema.safeParse({ ...config, map: "../../Other" }).success).toBe(false);
    expect(unrealBindingSchema.safeParse({ ...config, objectives: [{ ...config.objectives[0], actorTag: "Bridge" }] }).success).toBe(false);
    expect(unrealBindingSchema.safeParse({ ...config, objectives: [{ ...config.objectives[0], optional: true }] }).success).toBe(false);
  });

  it("scopes publishing and binding writes to authorized identities", async () => {
    const viewer = await callerFor(viewerId);
    await expect(viewer.unrealPlaytests.publishCatalog({ projectId, projectKey: "demo-game", maps: [{ path: config.map, actors: [{ label: "BridgeTarget", tags: ["Bridge"] }] }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.unrealPlaytests.saveBinding({ testCaseId: caseId, config })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const service = await callerFor(serviceId);
    await service.unrealPlaytests.publishCatalog({ projectId, projectKey: "demo-game", maps: [{ path: config.map, actors: [{ label: "BridgeTarget", tags: ["Bridge"] }] }] });
    const editor = await callerFor(editorId);
    await editor.unrealPlaytests.saveBinding({ testCaseId: caseId, config });
    expect(await editor.unrealPlaytests.binding({ testCaseId: caseId })).toMatchObject({ map: config.map });
    await editor.unrealPlaytests.saveBinding({ testCaseId: caseId, config: { ...config, objectives: [{ ...config.objectives[0], actorLabel: "MissingActor" }] } });
    await expect(editor.unrealPlaytests.queue({ testCaseId: caseId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await editor.unrealPlaytests.saveBinding({ testCaseId: caseId, config });
  });

  it("queues a frozen case, permits only a service claim, and links a missed objective to a failed TestRun", async () => {
    const editor = await callerFor(editorId);
    const queued = await editor.unrealPlaytests.queue({ testCaseId: caseId });
    await expect(editor.unrealPlaytests.claimNext({ projectId, projectKey: "demo-game" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const service = await callerFor(serviceId);
    const claimed = await service.unrealPlaytests.claimNext({ projectId, projectKey: "demo-game" });
    expect(claimed?.id).toBe(queued.id);
    const completed = await service.unrealPlaytests.complete({
      jobId: queued.id, engineExitCode: 255, testFailureOnly: true, reportFound: true,
      objectives: [{ name: "reach bridge", reached: false, resolvedTo: "BridgeTarget", seconds: 45, wrongTurns: 2 }],
      commitSha: "abcdef1234567", branch: "test", durationMs: 45000,
    });
    expect(completed.status).toBe("FAILED");
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: completed.testRunId }, include: { results: true } });
    expect(run.results[0]).toMatchObject({ testCaseId: caseId, status: "FAIL" });
    await expect(service.unrealPlaytests.complete({
      jobId: queued.id, engineExitCode: 0, reportFound: true,
      objectives: [{ name: "reach bridge", reached: true, resolvedTo: "BridgeTarget", seconds: 10, wrongTurns: 0 }],
      commitSha: "abcdef1234567", branch: "test", durationMs: 10000,
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reports an incomplete or mismatched engine report as an error, never a pass", async () => {
    const editor = await callerFor(editorId);
    const service = await callerFor(serviceId);
    const queued = await editor.unrealPlaytests.queue({ testCaseId: caseId });
    await service.unrealPlaytests.claimNext({ projectId, projectKey: "demo-game" });
    const completed = await service.unrealPlaytests.complete({
      jobId: queued.id, engineExitCode: 0, reportFound: true,
      objectives: [{ name: "another goal", reached: true, resolvedTo: "BridgeTarget", seconds: 10, wrongTurns: 0 }],
      commitSha: "abcdef1234567", branch: "test", durationMs: 10000,
    });
    expect(completed.status).toBe("ERROR");
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: completed.testRunId }, include: { results: true } });
    expect(run.results[0]?.status).toBe("BLOCKED");
  });
});
