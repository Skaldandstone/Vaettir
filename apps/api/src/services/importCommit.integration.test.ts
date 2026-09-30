// P11-05: real-DB proof of the shared import write path - create, then
// re-import the same external ids and see safe updates (steps replaced, not
// appended), an ImportJob row and an audit entry per run. Throwaway org.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { commitImportedTestCases, type ImportedTestCaseRow } from "./importCommit.js";
import { parseXrayExport } from "./xrayImport.js";

const RUN = `import-commit-${randomUUID()}`;
let orgId: string;
let userId: string;
let projectId: string;

beforeAll(async () => {
  const tier = await prisma.planTier.findFirstOrThrow();
  const org = await prisma.organization.create({ data: { name: `Import commit ${RUN}`, slug: RUN, planTierId: tier.id } });
  orgId = org.id;
  const user = await prisma.user.create({ data: { clerkUserId: `${RUN}-u`, email: `${RUN}@example.com` } });
  userId = user.id;
  await prisma.membership.create({ data: { organizationId: orgId, userId, role: "OWNER" } });
  const project = await prisma.project.create({ data: { organizationId: orgId, name: "Import project", slug: RUN } });
  projectId = project.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
  await prisma.importJob.deleteMany({ where: { projectId } });
  await prisma.testCaseVersion.deleteMany({ where: { testCase: { projectId } } });
  await prisma.testCaseStep.deleteMany({ where: { testCase: { projectId } } });
  await prisma.testCaseSource.deleteMany({ where: { testCase: { projectId } } });
  await prisma.testCase.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.delete({ where: { id: userId } });
});

function rows(version: 1 | 2): ImportedTestCaseRow[] {
  return [
    {
      rowNumber: 2,
      title: version === 1 ? "Login succeeds" : "Login succeeds (v2)",
      given: ["a user"],
      when: ["they log in"],
      then: ["dashboard"],
      priority: "HIGH",
      tags: ["auth"],
      suitePath: "/Auth",
      externalId: "ABC-101",
      steps:
        version === 1
          ? [
              { action: "open", expectedActionOrData: null, expectedResult: "form" },
              { action: "submit", expectedActionOrData: "creds", expectedResult: "dashboard" },
            ]
          : [{ action: "open v2", expectedActionOrData: null, expectedResult: "form v2" }],
    },
    { rowNumber: 3, title: "No id row", given: ["g"], when: ["w"], then: ["t"], priority: "LOW", tags: [] },
  ];
}

const common = () => ({
  projectId,
  organizationId: orgId,
  actorId: userId,
  source: "XRAY" as const,
  sourceLabel: "export.csv",
  fieldMapping: { format: "jira-csv" },
  keyPrefix: "xray",
  framework: "xray",
});

describe("commitImportedTestCases (real DB)", () => {
  it("creates cases with structured steps, a source key, a version and an ImportJob", async () => {
    const r = await commitImportedTestCases(prisma, { ...common(), rows: rows(1), skipped: [{ rowNumber: 4, reason: "No steps" }] });
    expect(r).toMatchObject({ createdCount: 2, updatedCount: 0, skipped: [{ rowNumber: 4, reason: "No steps" }] });

    const tc = await prisma.testCase.findFirstOrThrow({
      where: { projectId, source: { externalTestId: `xray:${projectId}:ABC-101` } },
      include: { steps: { orderBy: { order: "asc" } }, versions: true, source: true },
    });
    expect(tc).toMatchObject({ title: "Login succeeds", origin: "IMPORTED", suitePath: "/Auth", priority: "HIGH" });
    expect(tc.steps.map((s) => s.action)).toEqual(["open", "submit"]);
    expect(tc.source?.framework).toBe("xray");
    expect(tc.source?.importSnapshot).toMatchObject({ title: "Login succeeds", suitePath: "/Auth" });
    expect(tc.versions).toHaveLength(1);

    const job = await prisma.importJob.findFirstOrThrow({ where: { id: r.importJobId } });
    expect(job).toMatchObject({ source: "XRAY", status: "SUCCEEDED", createdCount: 2, skippedCount: 1 });
    expect(await prisma.auditLog.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("re-importing the same external id updates in place and replaces its steps", async () => {
    const r = await commitImportedTestCases(prisma, { ...common(), rows: rows(2), skipped: [] });
    // ABC-101 is updated; the id-less row is created again (nothing to key on).
    expect(r).toMatchObject({ createdCount: 1, updatedCount: 1 });

    const tc = await prisma.testCase.findFirstOrThrow({
      where: { projectId, source: { externalTestId: `xray:${projectId}:ABC-101` } },
      include: { steps: { orderBy: { order: "asc" } }, versions: true },
    });
    expect(tc.title).toBe("Login succeeds (v2)");
    expect(tc.steps.map((s) => s.action)).toEqual(["open v2"]);
    expect(tc.versions).toHaveLength(2);
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(3);
  });

  it("flows a parsed Xray export straight through, including an outline that expands", async () => {
    const parsed = parseXrayExport(
      JSON.stringify([
        {
          key: "XR-9",
          summary: "Totals",
          type: "Cucumber",
          definition: "Scenario Outline: t\n  Given <n> items\n  When checkout\n  Then total <t>\n  Examples:\n    | n | t |\n    | 1 | 10 |\n    | 2 | 20 |",
        },
      ]),
    );
    expect(parsed.cases.map((c) => c.key)).toEqual(["XR-9", "XR-9#2"]);
    // Same mapping the commitXray router does: the Jira key is the re-import id.
    const asRows = parsed.cases.map((c) => ({ ...c, externalId: c.key }));
    const r = await commitImportedTestCases(prisma, { ...common(), rows: asRows, skipped: parsed.skipped });
    expect(r).toMatchObject({ createdCount: 2, updatedCount: 0 });
    // Identical rerun: stable keys, no duplicate rows or version snapshots.
    const again = await commitImportedTestCases(prisma, { ...common(), rows: asRows, skipped: parsed.skipped });
    expect(again).toMatchObject({ createdCount: 0, updatedCount: 0, skipped: [] });
    for (const key of ["XR-9", "XR-9#2"]) {
      const caseRecord = await prisma.testCase.findFirstOrThrow({ where: { projectId, source: { externalTestId: `xray:${projectId}:${key}` } }, include: { versions: true } });
      expect(caseRecord.versions).toHaveLength(1);
    }
  });

  it("preserves human title, suite and steps when the source changes", async () => {
    const base = { rowNumber: 20, title: "Source original", given: ["member"], when: ["login"], then: ["home"], priority: "MEDIUM" as const, tags: ["auth"], suitePath: "/Source", externalId: "MAN-1", steps: [{ action: "open", expectedActionOrData: null, expectedResult: "form" }] };
    await commitImportedTestCases(prisma, { ...common(), rows: [base], skipped: [] });
    const original = await prisma.testCase.findFirstOrThrow({ where: { projectId, source: { externalTestId: `xray:${projectId}:MAN-1` } } });
    await prisma.testCase.update({ where: { id: original.id }, data: { title: "Human title", suitePath: "/Curated", steps: { deleteMany: {}, create: [{ order: 0, action: "human step" }] } } });
    const result = await commitImportedTestCases(prisma, { ...common(), rows: [{ ...base, title: "Source changed", steps: [{ action: "source change", expectedActionOrData: null, expectedResult: "new" }] }], skipped: [] });
    expect(result).toMatchObject({ createdCount: 0, updatedCount: 0 });
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain("human edits");
    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: original.id }, include: { steps: true, versions: true, source: true } });
    expect(after.title).toBe("Human title");
    expect(after.suitePath).toBe("/Curated");
    expect(after.steps.map(step => step.action)).toEqual(["human step"]);
    expect(after.versions).toHaveLength(1);
    expect(after.source?.importSnapshot).toMatchObject({ title: "Source original" });
  });

  it("does not erase a media reference added to an imported step", async () => {
    const base = { rowNumber: 22, title: "Media import", given: ["g"], when: ["w"], then: ["t"], priority: "LOW" as const,
      tags: [], externalId: "MEDIA-1", steps: [{ action: "Inspect", expectedActionOrData: null, expectedResult: "Image visible" }] };
    await commitImportedTestCases(prisma, { ...common(), rows: [base], skipped: [] });
    const imported = await prisma.testCase.findFirstOrThrow({ where: { projectId, source: { externalTestId: `xray:${projectId}:MEDIA-1` } }, include: { steps: true } });
    await prisma.testCaseStep.update({ where: { id: imported.steps[0]!.id }, data: { mediaAttachmentIds: ["human-image-reference"] } });
    const result = await commitImportedTestCases(prisma, { ...common(), rows: [{ ...base, title: "Updated source" }], skipped: [] });
    expect(result).toMatchObject({ updatedCount: 0, createdCount: 0 });
    expect(result.skipped[0]?.reason).toContain("Case changed since its last import");
    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: imported.id }, include: { steps: true } });
    expect(after.title).toBe("Media import");
    expect(after.steps[0]?.mediaAttachmentIds).toEqual(["human-image-reference"]);
  });

  it("fails closed for legacy imports with no source baseline", async () => {
    const legacy = await prisma.testCase.create({ data: {
      projectId, title: "Legacy edited case", testType: "FUNCTIONAL", origin: "IMPORTED",
      source: { create: { filePath: "legacy.csv", framework: "xray", externalTestId: `xray:${projectId}:LEGACY-1` } },
    } });
    const result = await commitImportedTestCases(prisma, { ...common(), rows: [{ rowNumber: 21, title: "Source replacement", given: ["g"], when: ["w"], then: ["t"], priority: "HIGH", tags: [], externalId: "LEGACY-1" }], skipped: [] });
    expect(result).toMatchObject({ createdCount: 0, updatedCount: 0 });
    expect(result.skipped[0]?.reason).toContain("no verified source baseline");
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: legacy.id } })).title).toBe("Legacy edited case");
  });

  it("imports a repeated external id only once within one batch", async () => {
    const duplicate = { rowNumber: 30, title: "One identity", given: ["g"], when: ["w"], then: ["t"], priority: "LOW" as const, tags: [], externalId: "DUP-1" };
    const result = await commitImportedTestCases(prisma, {
      ...common(), rows: [duplicate, { ...duplicate, rowNumber: 31, title: "Conflicting duplicate" }], skipped: [],
    });
    expect(result).toMatchObject({ createdCount: 1, updatedCount: 0 });
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain("Duplicate source identity");
    const imported = await prisma.testCase.findMany({
      where: { projectId, source: { externalTestId: `xray:${projectId}:DUP-1` } },
    });
    expect(imported).toHaveLength(1);
    expect(imported[0]?.title).toBe("One identity");
  });

  it("uses external identity rather than row number to classify creates", async () => {
    const sharedRowNumber = 40;
    const result = await commitImportedTestCases(prisma, {
      ...common(), skipped: [], rows: [
        { rowNumber: sharedRowNumber, title: "Updated existing", given: ["g"], when: ["w"], then: ["t"], priority: "HIGH", tags: [], externalId: "ABC-101" },
        { rowNumber: sharedRowNumber, title: "New identity", given: ["g"], when: ["w"], then: ["t"], priority: "LOW", tags: [], externalId: "NEW-40" },
      ],
    });
    expect(result).toMatchObject({ createdCount: 1, updatedCount: 1 });
    expect(await prisma.testCase.count({ where: { projectId, source: { externalTestId: `xray:${projectId}:NEW-40` } } })).toBe(1);
  });

  it("rolls back earlier updates when a later create fails", async () => {
    const before = await prisma.testCase.findFirstOrThrow({
      where: { projectId, source: { externalTestId: `xray:${projectId}:ABC-101` } },
      include: { versions: true, source: true },
    });
    const jobCount = await prisma.importJob.count({ where: { projectId } });
    await expect(commitImportedTestCases(prisma, {
      ...common(), testPlanId: "missing-test-plan", skipped: [],
      rows: [
        { ...rows(2)[0]!, title: "Must roll back" },
        { rowNumber: 50, title: "Cannot create", given: [], when: [], then: [], priority: "LOW", tags: [], externalId: "ROLLBACK-1" },
      ],
    })).rejects.toThrow();
    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: before.id }, include: { versions: true, source: true } });
    expect(after.title).toBe(before.title);
    expect(after.source?.importSnapshot).toEqual(before.source?.importSnapshot);
    expect(after.versions).toHaveLength(before.versions.length);
    expect(await prisma.testCase.count({ where: { projectId, source: { externalTestId: `xray:${projectId}:ROLLBACK-1` } } })).toBe(0);
    expect(await prisma.importJob.count({ where: { projectId } })).toBe(jobCount);
  });
});
