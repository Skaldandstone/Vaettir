// P11-05: real-DB proof of the shared import write path - create, then
// re-import the same external ids and see updates (steps replaced, not
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
    // Re-run: both expansions have stable keys, so both update in place.
    const again = await commitImportedTestCases(prisma, { ...common(), rows: asRows, skipped: parsed.skipped });
    expect(again).toMatchObject({ createdCount: 0, updatedCount: 2 });
  });
});
