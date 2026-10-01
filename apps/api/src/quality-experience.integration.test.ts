import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@vaettir/db";
import { experienceProfileSchema } from "@vaettir/core";
import { appRouter } from "./router.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");

describe.skipIf(!isolated)("saved experiences and immutable repeated run definitions", () => {
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let readOnlyEditor: ReturnType<typeof appRouter.createCaller>;
  let outsider: ReturnType<typeof appRouter.createCaller>;
  let secondOwner: ReturnType<typeof appRouter.createCaller>;
  let projectId: string;
  let caseId: string;
  const key = `quality-experience-${Date.now()}`;
  const game = experienceProfileSchema.parse({ version: 1, offerings: ["GAME"], gameGenres: ["RPG"], gamePlatforms: ["PS5", "WINDOWS_PC"], multiplayerModes: ["CROSS_PLAY"] });
  const hil = experienceProfileSchema.parse({ version: 1, offerings: ["HARDWARE", "HIL"], hardwareKinds: ["CONTROLLER"] });

  beforeAll(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
    const otherOrg = await prisma.organization.create({ data: { name: `${key}-outside`, slug: `${key}-outside`, planTierId: tier.id } });
    async function caller(suffix: string, organizationId: string, role: "OWNER" | "VIEWER" | "EDITOR", seatType: "FULL" | "READ_ONLY" = "FULL") {
      const user = await prisma.user.create({ data: { email: `${key}-${suffix}@example.com`, clerkUserId: `${key}-${suffix}`, memberships: { create: { organizationId, role, seatType } } }, include: { memberships: true } });
      return appRouter.createCaller({ prisma, user });
    }
    owner = await caller("owner", org.id, "OWNER"); viewer = await caller("viewer", org.id, "VIEWER");
    secondOwner = await caller("second-owner", org.id, "OWNER");
    readOnlyEditor = await caller("read-only", org.id, "EDITOR", "READ_ONLY"); outsider = await caller("outside", otherOrg.id, "OWNER");
    projectId = (await owner.project.create({ organizationId: org.id, name: "Synthetic domain project" })).id;
    await prisma.project.update({ where: { id: projectId }, data: { qualityProfile: { objective: "Preserve this human objective", future: { retained: true }, softwareTypes: ["Unmapped legacy label"] } } });
    caseId = (await owner.testCases.create({ projectId, title: "Original definition", background: "Original preconditions", testType: "FUNCTIONAL", validationDomain: "HIL", verificationProfile: { setup: "Synthetic rig", safety: "Reviewed by operator", instruments: "Synthetic meter", acceptanceCriteria: "Operator supplied limits" }, steps: [{ action: "Original action", expectedResult: "Original result" }] })).id;
  });

  it("reads legacy context without inferred classification and checks roles/tenants/full seats", async () => {
    expect((await viewer.project.experience({ projectId })).experience).toBeNull();
    const state = await owner.project.experience({ projectId });
    await expect(outsider.project.experience({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const caller of [viewer, outsider, readOnlyEditor]) {
      await expect(caller.project.saveExperience({ projectId, expectedProfileHash: state.profileHash, experience: game })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const saved = await owner.project.saveExperience({ projectId, expectedProfileHash: state.profileHash, experience: game });
    expect(saved.experience).toEqual(game);
    const raw = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(raw.qualityProfile).toMatchObject({ objective: "Preserve this human objective", future: { retained: true }, softwareTypes: ["Unmapped legacy label"] });
    expect((await owner.project.byId({ id: projectId })).qualityProfile.experience).toEqual(game);
  });

  it("rejects stale and concurrent writes and includes unrelated profile changes in the hash", async () => {
    const current = await owner.project.experience({ projectId });
    const results = await Promise.allSettled([
      owner.project.saveExperience({ projectId, expectedProfileHash: current.profileHash, experience: hil }),
      owner.project.saveExperience({ projectId, expectedProfileHash: current.profileHash, experience: { ...game, gamePlatforms: ["ANDROID"] } }),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(r => r.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ code: "CONFLICT" });
    const beforeEdit = await owner.project.experience({ projectId });
    const raw = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await prisma.project.update({ where: { id: projectId }, data: { qualityProfile: { ...(raw.qualityProfile as object), future: { retained: true, manualEdit: "new" } } } });
    await expect(owner.project.saveExperience({ projectId, expectedProfileHash: beforeEdit.profileHash, experience: game })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("preserves experience/unknown keys in partial legacy edits and rejects a CAS bypass", async () => {
    const before = await owner.project.experience({ projectId });
    await owner.project.update({ id: projectId, name: "Synthetic edited", defaultBranch: "main", qualityProfile: { objective: "Updated objective" } });
    expect((await owner.project.experience({ projectId })).experience).toEqual(before.experience);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).qualityProfile).toMatchObject({ future: { retained: true, manualEdit: "new" }, objective: "Updated objective" });
    await expect(owner.project.update({ id: projectId, name: "No bypass", defaultBranch: "main", qualityProfile: { experience: hil } as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await owner.project.experience({ projectId })).experience).toEqual(before.experience);
  });

  it("freezes case/profile/configuration on each run and never rewrites them after edits", async () => {
    let state = await owner.project.experience({ projectId });
    state = await owner.project.saveExperience({ projectId, expectedProfileHash: state.profileHash, experience: game });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await prisma.organization.update({ where: { id: project.organizationId }, data: { stepFieldLabels: { action: "Operator action" } } });
    await expect(owner.manualExecution.start({ projectId, testCaseIds: [caseId], expectedProfileHash: "0".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(readOnlyEditor.manualExecution.start({ projectId, testCaseIds: [caseId] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const first = await owner.manualExecution.start({ projectId, testCaseIds: [caseId], expectedProfileHash: state.profileHash, executionContext: { platform: "PS5", build: "synthetic-build-a", rig: "Synthetic rig A", batchOrLot: "Synthetic batch A" } });
    const initial = await owner.manualExecution.getForExecution(first);
    expect(initial.executionContext).toMatchObject({ version: 1, experience: game, profileHash: state.profileHash, configuration: { platform: "PS5", build: "synthetic-build-a" } });
    expect(initial.stepFieldLabels.action).toBe("Operator action");
    await owner.project.saveExperience({ projectId, expectedProfileHash: state.profileHash, experience: hil });
    await prisma.organization.update({ where: { id: project.organizationId }, data: { stepFieldLabels: { action: "Changed action label" } } });
    await prisma.testCase.update({ where: { id: caseId }, data: { title: "Changed definition", background: "Changed preconditions", verificationProfile: { setup: "Changed rig", acceptanceCriteria: "Changed criteria" } } });
    await prisma.testCaseStep.updateMany({ where: { testCaseId: caseId }, data: { action: "Changed action", expectedResult: "Changed result" } });
    const unchanged = await owner.manualExecution.getForExecution(first);
    expect(unchanged.executionContext).toEqual(initial.executionContext);
    expect(unchanged.stepFieldLabels.action).toBe("Operator action");
    expect(unchanged.cases[0]).toMatchObject({ title: "Original definition", background: "Original preconditions", verificationProfile: { setup: "Synthetic rig", acceptanceCriteria: "Operator supplied limits" }, steps: [{ action: "Original action", expectedResult: "Original result" }] });
    const second = await owner.manualExecution.start({ projectId, testCaseIds: [caseId], executionContext: { rig: "Synthetic rig B", firmwareVersion: "synthetic-b" } });
    expect(second.testRunId).not.toBe(first.testRunId);
    expect((await owner.manualExecution.getForExecution(second)).executionContext).toMatchObject({ experience: hil, configuration: { rig: "Synthetic rig B", firmwareVersion: "synthetic-b" } });
    expect((await owner.manualExecution.getForExecution(second)).cases[0]?.title).toBe("Changed definition");
    expect((await owner.manualExecution.getForExecution(second)).stepFieldLabels.action).toBe("Changed action label");
    await expect(outsider.manualExecution.getForExecution(first)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not retrofit profiles into legacy runs, and rejects oversized definitions with no new run", async () => {
    const legacy = await prisma.testRun.create({ data: { projectId, ciProvider: "manual", commitSha: "manual", branch: "manual", startedAt: new Date(), manualTestCaseIds: [caseId] } });
    expect((await owner.manualExecution.getForExecution({ testRunId: legacy.id })).executionContext).toBeNull();
    const before = await prisma.testRun.count({ where: { projectId } });
    await prisma.testCase.update({ where: { id: caseId }, data: { given: Array.from({ length: 250 }, () => "x".repeat(10000)) } });
    await expect(owner.manualExecution.start({ projectId, testCaseIds: [caseId] })).rejects.toThrow("bounded run snapshot");
    expect(await prisma.testRun.count({ where: { projectId } })).toBe(before);
    await prisma.testCase.update({ where: { id: caseId }, data: { given: [] } });
  });

  it("freezes shared procedure steps including legacy missing media lists", async () => {
    const group = await owner.sharedStepGroups.create({ projectId, name: "Synthetic shared procedure", steps: [{ action: "Original shared action", expectedResult: "Original shared result" }] });
    await prisma.testCase.update({ where: { id: caseId }, data: { sharedStepGroupId: group.id } });
    const run = await owner.manualExecution.start({ projectId, testCaseIds: [caseId] });
    await owner.sharedStepGroups.update({ id: group.id, name: "Synthetic shared procedure", steps: [{ action: "Changed shared action", expectedResult: "Changed shared result" }] });
    const execution = await owner.manualExecution.getForExecution(run);
    expect(execution.cases[0]?.steps).toEqual([{ order: 0, action: "Original shared action", expectedActionOrData: null, expectedResult: "Original shared result", expectedResponse: null, mediaAttachmentIds: [] }]);
  });

  it("returns stored native framework family without guessing from a display label", async () => {
    await prisma.testCaseSource.create({ data: { testCaseId: caseId, filePath: "synthetic/example.test.ts", framework: "Editable external label", frameworkFamily: "VITEST" } });
    expect((await owner.testCases.byId({ id: caseId })).source).toMatchObject({ framework: "Editable external label", frameworkFamily: "VITEST" });
    await expect(outsider.testCases.byId({ id: caseId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("recovers a lost start response after profile/case edits without duplicating or reopening a completed run", async () => {
    const state = await owner.project.experience({ projectId });
    const request = { projectId, testCaseIds: [caseId], expectedProfileHash: state.profileHash, executionContext: { build: "original reviewed build" }, idempotencyKey: randomUUID() };
    const first = await owner.manualExecution.start(request);
    const frozen = (await owner.manualExecution.getForExecution(first)).executionContext;
    await owner.manualExecution.complete(first);
    await owner.project.saveExperience({ projectId, expectedProfileHash: state.profileHash, experience: game });
    await prisma.testCase.update({ where: { id: caseId }, data: { title: "Changed after completed run" } });
    const beforeRetry = await prisma.testRun.count({ where: { projectId } });
    expect(await owner.manualExecution.start(request)).toEqual(first);
    expect(await prisma.testRun.count({ where: { projectId } })).toBe(beforeRetry);
    expect((await owner.manualExecution.getForExecution(first)).executionContext).toEqual(frozen);
    expect((await owner.manualExecution.getForExecution(first)).status).toBe("PARTIAL");
    await expect(owner.manualExecution.start({ ...request, executionContext: { build: "different build" } })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(outsider.manualExecution.start(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("serializes simultaneous duplicate starts into one durable execution", async () => {
    const before = await prisma.testRun.count({ where: { projectId } });
    const request = { projectId, testCaseIds: [caseId], executionContext: { rig: "Concurrent synthetic rig" }, idempotencyKey: randomUUID() };
    const [first, retry] = await Promise.all([owner.manualExecution.start(request), owner.manualExecution.start(request)]);
    expect(retry).toEqual(first);
    expect(await prisma.testRun.count({ where: { projectId } })).toBe(before + 1);
  });

  it("binds start keys to the actor and project rather than sharing them across users", async () => {
    const idempotencyKey = randomUUID();
    const request = { projectId, testCaseIds: [caseId], idempotencyKey };
    const first = await owner.manualExecution.start(request);
    const otherActor = await secondOwner.manualExecution.start(request);
    expect(otherActor.testRunId).not.toBe(first.testRunId);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const otherProject = await owner.project.create({ organizationId: project.organizationId, name: "Synthetic idempotency project" });
    const otherCase = await owner.testCases.create({ projectId: otherProject.id, title: "Synthetic alternate scope", testType: "FUNCTIONAL", steps: [{ action: "Synthetic action" }] });
    const otherScope = await owner.manualExecution.start({ projectId: otherProject.id, testCaseIds: [otherCase.id], idempotencyKey });
    expect(otherScope.testRunId).not.toBe(first.testRunId);
    await expect(owner.manualExecution.start({ ...request, idempotencyKey: "not-a-uuid" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
