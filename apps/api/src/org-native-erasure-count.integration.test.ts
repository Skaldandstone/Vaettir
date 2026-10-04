// Real native DML regression; execute only on a uniquely owned disposable DB.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { hardDeleteOrganization, previewOrgHardDelete } from "./services/orgHardDelete.js";

const nativeModels = [
  "CoverageFileEntry", "ExploratorySessionNote", "ReleaseReadinessSnapshot",
  "RiskFlag", "AcceptanceCriterion", "TestCaseAttachment",
  "TestCaseComplianceControl", "TestCaseDataset", "TestCaseSource",
  "TestCaseStep", "TestCaseVersion", "TestResultArtifact", "TestResult",
  "ManualStepResultHead", "ManualStepResultRevision",
  "TestSelectionRecommendation", "TestPlanVersion", "WebhookDelivery",
] as const;
type NativeModel = (typeof nativeModels)[number];
const nativeFamilies: Record<NativeModel, string> = {
  CoverageFileEntry: "CoverageReport", ExploratorySessionNote: "ExploratorySession",
  ReleaseReadinessSnapshot: "Release", RiskFlag: "Release", AcceptanceCriterion: "TestPlan",
  TestCaseAttachment: "TestCase", TestCaseComplianceControl: "TestCase", TestCaseDataset: "TestCase",
  TestCaseSource: "TestCase", TestCaseStep: "TestCase", TestCaseVersion: "TestCase",
  TestResultArtifact: "TestResult", TestResult: "TestRun", ManualStepResultHead: "TestRun",
  ManualStepResultRevision: "TestRun", TestSelectionRecommendation: "TestSelectionRun",
  TestPlanVersion: "TestPlan", WebhookDelivery: "WebhookEndpoint",
};
const zeroCounts = () => Object.fromEntries(nativeModels.map((model) => [model, 0]));

function statementText(statement: unknown): string {
  if (statement === null || typeof statement !== "object" ||
      !("strings" in statement) || !Array.isArray(statement.strings)) return "";
  return statement.strings.join("").trim();
}

describe("native organization erasure statement counts", () => {
  const tag = `native-erasure-${randomUUID()}`;
  const owned = new Map<string, string>();
  const projects = new Set<string>();
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) ||
        !/test/i.test(url.pathname) || url.searchParams.has("host")) {
      throw Error("Owned disposable loopback DB required");
    }
  });
  afterEach(async () => {
    for (const projectId of projects) {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (project && (!project.slug.startsWith(tag) || !owned.has(project.organizationId))) {
        throw Error("Native erasure fixture project ownership mismatch");
      }
    }
    for (const [organizationId, actorId] of owned) {
      const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (organization) {
        if (!organization.slug.startsWith(tag)) throw Error("Native erasure fixture organization ownership mismatch");
        await hardDeleteOrganization(prisma, organizationId, actorId, "Owned native erasure regression cleanup");
      }
      expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: actorId } })).toBe(1);
    }
    // Permanent native deletion receipts and their synthetic FK actors remain.
    // This disposable database, not a production history exception, owns them.
    owned.clear();
    projects.clear();
  });

  async function actor() {
    return prisma.user.create({ data: {
      clerkUserId: `${tag}-${randomUUID()}`,
      email: `${tag}-${randomUUID()}@example.com`,
    } });
  }
  async function organization(actorId: string) {
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const slug = `${tag}-${randomUUID()}`;
    const org = await prisma.organization.create({ data: { name: slug, slug, planTierId: tier.id } });
    owned.set(org.id, actorId);
    return org;
  }
  async function cohort(organizationId: string, actorId: string, populated: boolean) {
    const slug = `${tag}-${randomUUID()}`;
    const project = await prisma.project.create({ data: {
      organizationId, name: slug, slug,
      caseKey: `e${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    } });
    projects.add(project.id);
    const planType = await prisma.testPlanType.findFirstOrThrow();
    const release = await prisma.release.create({ data: { projectId: project.id, name: "Synthetic native release" } });
    const plan = await prisma.testPlan.create({ data: {
      projectId: project.id, testPlanTypeId: planType.id, releaseId: release.id, name: "Synthetic native plan",
    } });
    const endpoint = await prisma.webhookEndpoint.create({ data: {
      organizationId, createdById: actorId, url: "https://example.invalid/native-fixture",
      secret: "synthetic-offline-not-a-credential", eventTypes: [],
    } });
    const cases = [];
    for (let index = 0; index < (populated ? 2 : 1); index++) {
      // Initial synthetic native records, not an unreviewed edit of a library.
      cases.push(await prisma.testCase.create({ data: {
        projectId: project.id, testPlanId: plan.id, title: `Synthetic native case ${index}`,
        testType: "FUNCTIONAL", given: ["Synthetic setup"], when: ["Synthetic action"], then: ["Synthetic outcome"],
        tags: [], createdById: actorId,
      } }));
    }
    const firstCase = cases[0]!;
    const run = await prisma.testRun.create({ data: {
      projectId: project.id, ciProvider: "synthetic-fixture", commitSha: "synthetic-not-source",
      branch: "synthetic", startedAt: new Date("2026-01-01T00:00:00Z"),
    } });
    const coverage = await prisma.coverageReport.create({ data: {
      projectId: project.id, commitSha: "synthetic-not-source", branch: "synthetic", tool: "ISTANBUL",
      linesCovered: 0, linesTotal: 2,
    } });
    const expected = zeroCounts();
    if (populated) {
      await prisma.testCaseStep.createMany({ data: [0, 1, 2].map((order) => ({
        testCaseId: firstCase.id, order, action: `Synthetic action ${order}`,
      })) });
      for (const testCase of cases) {
        await prisma.testCaseVersion.create({ data: {
          testCaseId: testCase.id, versionNumber: 1, title: testCase.title,
          given: testCase.given, when: testCase.when, then: testCase.then, tags: [],
          steps: [], priority: "MEDIUM", testType: "FUNCTIONAL", createdById: actorId,
        } });
      }
      await prisma.testCaseDataset.create({ data: {
        testCaseId: firstCase.id, parameterNames: ["sample"], rows: [{ name: "Synthetic row", values: { sample: "one" } }],
      } });
      await prisma.testCaseAttachment.create({ data: {
        testCaseId: firstCase.id, fileName: "synthetic.txt", contentType: "text/plain",
        storageUrl: "s3://synthetic-offline/native-fixture", sizeBytes: 1, uploadedById: actorId,
      } });
      await prisma.testCaseSource.create({ data: { testCaseId: firstCase.id, filePath: "synthetic.fixture.ts", framework: "synthetic" } });
      const result = await prisma.testResult.create({ data: { testRunId: run.id, testCaseId: firstCase.id, status: "FAIL" } });
      await prisma.testResult.create({ data: { testRunId: run.id, testCaseId: cases[1]!.id, status: "PASS" } });
      await prisma.testResultArtifact.createMany({ data: (["SCREENSHOT", "VIDEO"] as const).map((type) => ({
        testResultId: result.id, type,
        storageUrl: "s3://synthetic-offline/native-artifact",
      })) });
      await prisma.coverageFileEntry.createMany({ data: [0, 1].map((index) => ({
        reportId: coverage.id, filePath: `synthetic-${index}.ts`, linesCovered: 0, linesTotal: 1,
      })) });
      await prisma.acceptanceCriterion.createMany({ data: [0, 1].map((index) => ({ testPlanId: plan.id, description: `Synthetic criterion ${index}` })) });
      await prisma.testPlanVersion.create({ data: { testPlanId: plan.id, versionNumber: 1, name: plan.name, status: "DRAFT", customFields: {} } });
      await prisma.releaseReadinessSnapshot.create({ data: { releaseId: release.id, score: 0, label: "SYNTHETIC", criteriaMet: 0, criteriaTotal: 2, openRiskFlags: 1 } });
      await prisma.riskFlag.create({ data: { releaseId: release.id, severity: "LOW", source: "MANUAL_FLAG", description: "Synthetic fixture only" } });
      await prisma.webhookDelivery.createMany({ data: [0, 1].map(() => ({ webhookEndpointId: endpoint.id, eventType: "synthetic", payload: {}, success: false })) });
      Object.assign(expected, {
        CoverageFileEntry: 2, ReleaseReadinessSnapshot: 1, RiskFlag: 1, AcceptanceCriterion: 2,
        TestCaseAttachment: 1, TestCaseDataset: 1, TestCaseSource: 1, TestCaseStep: 3,
        TestCaseVersion: 2, TestResultArtifact: 2, TestResult: 2, TestPlanVersion: 1, WebhookDelivery: 2,
      });
    }
    return { project, firstCase, run, coverage, plan, release, endpoint, expected };
  }

  async function snapshot(c: Awaited<ReturnType<typeof cohort>>) {
    return {
      project: await prisma.project.findUniqueOrThrow({ where: { id: c.project.id } }),
      cases: await prisma.testCase.findMany({ where: { projectId: c.project.id }, orderBy: { id: "asc" }, include: {
        steps: { orderBy: { order: "asc" } }, versions: { orderBy: { versionNumber: "asc" } }, dataset: true, attachments: { orderBy: { id: "asc" } }, source: true,
      } }),
      runs: await prisma.testRun.findMany({ where: { projectId: c.project.id }, orderBy: { id: "asc" }, include: { results: { orderBy: { id: "asc" }, include: { artifacts: { orderBy: { id: "asc" } } } } } }),
      reports: await prisma.coverageReport.findMany({ where: { projectId: c.project.id }, orderBy: { id: "asc" }, include: { files: { orderBy: { id: "asc" } } } }),
      plans: await prisma.testPlan.findMany({ where: { projectId: c.project.id }, orderBy: { id: "asc" }, include: { versions: { orderBy: { versionNumber: "asc" } }, acceptanceCriteria: { orderBy: { id: "asc" } } } }),
      releases: await prisma.release.findMany({ where: { projectId: c.project.id }, orderBy: { id: "asc" }, include: { readinessSnapshots: { orderBy: { id: "asc" } }, riskFlags: { orderBy: { id: "asc" } } } }),
      endpoint: await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: c.endpoint.id }, include: { deliveries: { orderBy: { id: "asc" } } } }),
    };
  }
  function selectedCounts(counts: Record<string, number>) {
    return Object.fromEntries(nativeModels.map((model) => [model, counts[model]]));
  }
  async function retainedReceipt(actorId: string) {
    const foreign = await organization(actorId);
    const deleted = await hardDeleteOrganization(prisma, foreign.id, actorId, "Synthetic foreign receipt retention sentinel");
    return prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: deleted.deletionLogId } });
  }
  function observingClient(observations: Array<{ model: NativeModel; expected: bigint; count: bigint }>) {
    return new Proxy(prisma, { get(target, key) {
      if (key === "$transaction") return (...args: unknown[]) => {
        const work = args[0];
        if (typeof work !== "function") throw Error("Expected real interactive erasure transaction");
        const wrapped = async (tx: Prisma.TransactionClient) => work(new Proxy(tx, { get(transaction, member) {
          if (member === "$queryRaw") return async (...queryArgs: unknown[]) => {
            const rows: unknown = await Reflect.apply(transaction.$queryRaw, transaction, queryArgs);
            const text = statementText(queryArgs[0]);
            if (text.startsWith("WITH expected AS MATERIALIZED")) {
              const match = text.match(/deleted\s+AS\s*\(DELETE FROM "([A-Za-z]+)"/);
              const expectedTable = text.match(/expected\s+AS\s+MATERIALIZED\s*\(SELECT count\(\*\)::bigint AS count FROM "([A-Za-z]+)" WHERE/);
              const stagedPredicates = [...text.matchAll(/"([A-Za-z]+)" IN \(SELECT id FROM pg_temp\.vaettir_native_erasure_scope WHERE model=\)/g)];
              if (!match || !expectedTable || expectedTable[1] !== match[1] ||
                  stagedPredicates.length !== 2 || stagedPredicates[0]![1] !== stagedPredicates[1]![1] ||
                  !/AND \(SELECT count FROM expected\) BETWEEN 0 AND\s+RETURNING 1\)/.test(text) ||
                  !/SELECT \(SELECT count FROM expected\) AS expected,count\(\*\)::bigint AS count FROM deleted$/.test(text)) {
                throw Error("Expected the exact staged-native-scope/count/delete scalar structure");
              }
              const model = nativeModels.find((name) => name === match[1]);
              if (!model || !Array.isArray(rows) || rows.length !== 1 ||
                  rows[0] === null || typeof rows[0] !== "object" ||
                  typeof rows[0].expected !== "bigint" || typeof rows[0].count !== "bigint") throw Error("Expected actual native count/delete scalar receipt");
              const statement = queryArgs[0];
              expect(statement !== null && typeof statement === "object" && "values" in statement ? statement.values : null).toEqual([
                nativeFamilies[model], nativeFamilies[model], BigInt(Number.MAX_SAFE_INTEGER),
              ]);
              observations.push({ model, expected: rows[0].expected, count: rows[0].count });
            }
            return rows;
          };
          const value = Reflect.get(transaction, member);
          return typeof value === "function" ? value.bind(transaction) : value;
        } }));
        // Preserve the product's exact transaction options, including timeout.
        return Reflect.apply(target.$transaction, target, [wrapped, ...args.slice(1)]);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  }

  for (const populated of [true, false]) it(`returns exact ${populated ? "populated" : "zero-child"} native counts without changing foreign records or receipts`, async () => {
    const user = await actor();
    const ownOrg = await organization(user.id), foreignOrg = await organization(user.id);
    const own = await cohort(ownOrg.id, user.id, populated), foreign = await cohort(foreignOrg.id, user.id, true);
    const before = await snapshot(foreign), foreignReceipt = await retainedReceipt(user.id);
    const preview = await previewOrgHardDelete(prisma, ownOrg.id);
    expect(selectedCounts(preview.rowCounts)).toEqual(own.expected);
    const observations: Array<{ model: NativeModel; expected: bigint; count: bigint }> = [];
    const deleted = await hardDeleteOrganization(observingClient(observations), ownOrg.id, user.id, "Synthetic exact native statement count regression");
    expect(selectedCounts(deleted.rowCounts)).toEqual(own.expected);
    expect(await prisma.organization.count({ where: { id: ownOrg.id } })).toBe(0);
    const receipt = await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: deleted.deletionLogId } });
    expect(receipt).toMatchObject({ organizationId: ownOrg.id, deletedById: user.id, rowCounts: deleted.rowCounts });
    expect(await snapshot(foreign)).toEqual(before);
    expect(await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: foreignReceipt.id } })).toEqual(foreignReceipt);
    expect(observations.length).toBeGreaterThan(0);
    for (const observed of observations) {
      expect(observed.expected).toBe(BigInt(own.expected[observed.model]!));
      expect(observed.count).toBe(observed.expected);
    }
    // Even empty child tables with existing parent IDs execute the native DELETE;
    // these are actual returned SQL scalars, not substituted product outputs.
    for (const model of ["CoverageFileEntry", "TestCaseStep", "TestCaseVersion", "TestResult", "AcceptanceCriterion", "TestPlanVersion", "WebhookDelivery"] as const) {
      expect(observations.filter((row) => row.model === model)).toHaveLength(1);
    }
    if (!populated) expect(observations.every((row) => row.expected === 0n && row.count === 0n)).toBe(true);
  });

  it("refuses actual original-scope drift before the transaction with no child deletion or success receipt", async () => {
    const user = await actor(), ownOrg = await organization(user.id), foreignOrg = await organization(user.id);
    const own = await cohort(ownOrg.id, user.id, true), foreign = await cohort(foreignOrg.id, user.id, true);
    const ownBefore = await snapshot(own), foreignBefore = await snapshot(foreign), foreignReceipt = await retainedReceipt(user.id);
    let reparented = false, boundaryCalls = 0;
    const db = new Proxy(prisma, { get(target, key) {
      if (key === "$queryRaw") return async (...args: unknown[]) => {
        const rows: unknown = await Reflect.apply(target.$queryRaw, target, args);
        if (statementText(args[0]) === 'SELECT id FROM "Project" WHERE "organizationId"=' && !reparented) {
          const statement = args[0];
          expect(statement !== null && typeof statement === "object" && "values" in statement ? statement.values : null).toEqual([ownOrg.id]);
          if (!Array.isArray(rows)) throw Error("Expected actual project enumeration");
          expect(rows.some((row) => row?.id === own.project.id)).toBe(true);
          boundaryCalls++;
          await prisma.project.update({ where: { id: own.project.id }, data: { organizationId: foreignOrg.id } });
          reparented = true;
        }
        return rows;
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    try {
      await expect(hardDeleteOrganization(db, ownOrg.id, user.id, "Actual native scope drift must refuse")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(reparented).toBe(true);
      expect(boundaryCalls).toBe(1);
      expect(await prisma.project.findUniqueOrThrow({ where: { id: own.project.id } })).toEqual({ ...ownBefore.project, organizationId: foreignOrg.id });
      const after = await snapshot(own);
      expect({ ...after, project: ownBefore.project }).toEqual(ownBefore);
      expect(await snapshot(foreign)).toEqual(foreignBefore);
      expect(await prisma.organization.count({ where: { id: ownOrg.id } })).toBe(1);
      expect(await prisma.organizationDeletionLog.count({ where: { organizationId: ownOrg.id } })).toBe(0);
      expect(await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: foreignReceipt.id } })).toEqual(foreignReceipt);
    } finally {
      if (reparented) await prisma.project.update({ where: { id: own.project.id }, data: { organizationId: ownOrg.id } });
    }
  });
});
