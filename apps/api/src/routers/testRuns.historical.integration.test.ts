import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "../router.js";

const marker = `historical-${Date.now()}`;
let orgId: string, projectId: string, userId: string, a: string, b: string;
beforeAll(async () => {
  const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
  const org = await prisma.organization.create({ data: { name: marker, slug: marker, planTierId: tier.id } }); orgId = org.id;
  projectId = (await prisma.project.create({ data: { organizationId: orgId, name: "Synthetic history", slug: marker } })).id;
  userId = (await prisma.user.create({ data: { clerkUserId: marker, email: `${marker}@example.invalid` } })).id;
  await prisma.membership.create({ data: { organizationId: orgId, userId, role: "EDITOR" } });
  const makeCase = (title: string) => prisma.testCase.create({ data: { projectId, title, given: ["Original setup"], when: ["Original procedure"], then: ["Original expected"], tags: [], testType: "FUNCTIONAL" } });
  a = (await makeCase("Historical A")).id; b = (await makeCase("Historical B")).id;
});
afterAll(async () => {
  if (!orgId) return;
  await prisma.testResult.deleteMany({ where: { testRun: { projectId } } }); await prisma.testRun.deleteMany({ where: { projectId } });
  await prisma.testCaseVersion.deleteMany({ where: { testCase: { projectId } } }); await prisma.testCase.deleteMany({ where: { projectId } });
  await prisma.auditLog.deleteMany({ where: { organizationId: orgId } }); await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } }); await prisma.user.deleteMany({ where: { id: userId } }); await prisma.organization.deleteMany({ where: { id: orgId } });
});
async function caller() { return appRouter.createCaller({ prisma, user: await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } }) }); }
const source = (label: string, csv?: string) => ({ projectId, sourceRef: "file:synthetic-history.csv", runLabel: label, csvText: csv ?? `ID,Result,Date,Notes\n${a},pass,2025-01-01,Original success\n${b},fail,2025-01-02,Original failure`, mapping: { caseId: "ID", result: "Result", date: "Date", note: "Notes" }, dateFormat: "iso" as const });
async function reviewed(label: string, csv?: string) { const c = await caller(), input = source(label, csv); const review = await c.testRuns.previewHistorical(input); return { c, input: { ...input, expectedDigest: review.fingerprint, acknowledgeHistoricalObservation: true as const }, review }; }

describe("historical results real PostgreSQL atomicity", () => {
  it("does no writes during review, records date-only provenance without changing procedures, and replays concurrent retries once", async () => {
    const before = await prisma.testCase.findMany({ where: { projectId }, orderBy: { id: "asc" } });
    const { c, input, review } = await reviewed("Original January observations");
    expect(review).toMatchObject({ matchedCount: 2, blockedCount: 0, runCount: 2 });
    expect(await prisma.testRun.count({ where: { projectId } })).toBe(0);
    const results = await Promise.all([c.testRuns.commitHistorical(input), c.testRuns.commitHistorical(input)]);
    expect(results.map(r => r.importedCount).sort()).toEqual([0, 2]);
    expect(await prisma.testRun.count({ where: { projectId } })).toBe(2);
    const runs = await prisma.testRun.findMany({ where: { projectId }, include: { results: true }, orderBy: { startedAt: "asc" } });
    expect(runs.map(r => r.startedAt.toISOString().slice(0, 10))).toEqual(["2025-01-01", "2025-01-02"]);
    expect(runs.every(r => r.finishedAt === null && r.ciProvider === "historical-import")).toBe(true);
    expect(runs[0]!.executionContext).toMatchObject({ historicalImport: { datePrecision: "day", timeUnknown: true, originalDate: "2025-01-01", recordedBy: userId } });
    expect(runs[1]!.results[0]).toMatchObject({ testCaseId: b, status: "FAIL", durationMs: null, observations: { historicalImport: { procedureNotReverified: true } } });
    expect(await prisma.testCase.findMany({ where: { projectId }, orderBy: { id: "asc" } })).toEqual(before);
    expect(await prisma.auditLog.count({ where: { projectId, entityType: "TestRun" } })).toBe(2);
  });
  it("prechecks conflicts across every date and leaves earlier new groups unwritten", async () => {
    const conflict = await reviewed("Original January observations", `ID,Result,Date,Notes\n${a},pass,2024-12-31,New earlier group\n${b},pass,2025-01-02,Changed old history`);
    const before = await prisma.testRun.count({ where: { projectId } });
    await expect(conflict.c.testRuns.commitHistorical(conflict.input)).rejects.toThrow(/different imported results/);
    expect(await prisma.testRun.count({ where: { projectId } })).toBe(before);
  });
  it("rolls back an earlier date and its audit when a later result write fails", async () => {
    const failureNote = `${marker}-fault`, name = `historical_fault_${marker.replace(/\D/g, "")}`;
    const { c, input } = await reviewed("Atomic rollback", `ID,Result,Date,Notes\n${a},pass,2024-02-01,First valid group\n${b},fail,2024-02-02,${failureNote}`);
    const count = await prisma.testRun.count({ where: { projectId } }), audits = await prisma.auditLog.count({ where: { projectId } });
    // Names and predicate are generated here from digits/fixed literals only.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."note" = '${failureNote}' THEN RAISE EXCEPTION 'synthetic historical write fault'; END IF; RETURN NEW; END $$`);
    try {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON "TestResult" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
      await expect(c.testRuns.commitHistorical(input)).rejects.toThrow(/synthetic historical write fault/);
      expect(await prisma.testRun.count({ where: { projectId } })).toBe(count);
      expect(await prisma.auditLog.count({ where: { projectId } })).toBe(audits);
    } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "TestResult"`); await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`); }
  });
  it("rejects stale reviews and revoked writers without inserting any run", async () => {
    const { c, input } = await reviewed("Stale authority");
    await expect(c.testRuns.commitHistorical({ ...input, runDate: "2020-01-01", expectedDigest: "0".repeat(64) })).rejects.toThrow(/changed/);
    const count = await prisma.testRun.count({ where: { projectId } });
    await prisma.membership.updateMany({ where: { organizationId: orgId, userId }, data: { role: "VIEWER" } });
    try { await expect(c.testRuns.commitHistorical(input)).rejects.toThrow(/access changed/); expect(await prisma.testRun.count({ where: { projectId } })).toBe(count); }
    finally { await prisma.membership.updateMany({ where: { organizationId: orgId, userId }, data: { role: "EDITOR" } }); }
  });
});
