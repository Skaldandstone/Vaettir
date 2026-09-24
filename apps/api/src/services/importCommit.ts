import type { PrismaClient } from "@vaettir/db";
import { recordAudit } from "./auditLog.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";
import {
  inferTestCaseType,
  normalizeAutomationStatus,
  normalizeTestType,
  type InferredAutomationStatus,
  type InferredTestCaseType,
} from "./csvFieldMapping.js";

// P11-05: the one write path every file-based importer shares. Started
// life inline in importJobs.commitCsv (P11-01/P11-11); pulled out here so
// the Xray importer gets the exact same create-vs-update-by-external-id,
// version-snapshot, ImportJob-row and audit behavior instead of a second
// copy that could drift. Structured steps are new here (CSV rows never
// carried them); on an update they are replaced wholesale, matching how a
// re-import is meant to make the case look like the source again.

export interface ImportedTestCaseRow {
  rowNumber: number;
  title: string;
  background?: string | null;
  given: string[];
  when: string[];
  then: string[];
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  tags: string[];
  testType?: InferredTestCaseType | string;
  automationStatus?: InferredAutomationStatus | string;
  suitePath?: string | null;
  externalId?: string;
  steps?: {
    action: string;
    expectedActionOrData: string | null;
    expectedResult: string | null;
  }[];
}

export interface CommitImportArgs {
  projectId: string;
  organizationId: string;
  actorId: string;
  rows: ImportedTestCaseRow[];
  skipped: { rowNumber: number; reason: string }[];
  source: "CSV" | "XRAY" | "TESTRAIL" | "ZEPHYR" | "QTEST";
  sourceLabel?: string;
  // Recorded on the ImportJob row for the audit trail (the CSV importer
  // stores the user-confirmed column mapping; file-format importers store
  // what they detected).
  fieldMapping: Record<string, string>;
  // Namespace for TestCaseSource.externalTestId, e.g. "csv" / "xray" -
  // keys are per-project so two projects importing the same source ids
  // never collide.
  keyPrefix: string;
  framework: string;
  testPlanId?: string;
}

export interface CommitImportResult {
  importJobId: string;
  createdCount: number;
  updatedCount: number;
  skipped: { rowNumber: number; reason: string }[];
}

export async function commitImportedTestCases(
  prisma: PrismaClient,
  args: CommitImportArgs,
): Promise<CommitImportResult> {
  const keyFor = (raw: string) => `${args.keyPrefix}:${args.projectId}:${raw}`;
  const rowsWithExternalId = args.rows.filter(
    (r): r is ImportedTestCaseRow & { externalId: string } =>
      Boolean(r.externalId),
  );
  const existingSources =
    rowsWithExternalId.length > 0
      ? await prisma.testCaseSource.findMany({
          where: {
            externalTestId: {
              in: rowsWithExternalId.map((r) => keyFor(r.externalId)),
            },
          },
        })
      : [];
  const sourceByKey = new Map(
    existingSources.map((s) => [s.externalTestId!, s]),
  );

  const updateRowNumbers = new Set(
    rowsWithExternalId
      .filter((r) => sourceByKey.has(keyFor(r.externalId)))
      .map((r) => r.rowNumber),
  );
  // A Cucumber outline can expand one source row into several cases that
  // share an externalId; only the first can be an in-place update, the
  // rest are created (and would need their own ids to re-sync - accepted).
  const seenUpdateKeys = new Set<string>();
  const toUpdate: ImportedTestCaseRow[] = [];
  const toCreate: ImportedTestCaseRow[] = [];
  for (const r of args.rows) {
    const key = r.externalId ? keyFor(r.externalId) : null;
    if (key && updateRowNumbers.has(r.rowNumber) && !seenUpdateKeys.has(key)) {
      seenUpdateKeys.add(key);
      toUpdate.push(r);
    } else {
      toCreate.push(r);
    }
  }

  const stepsData = (r: ImportedTestCaseRow) =>
    (r.steps ?? []).map((s, i) => ({
      order: i,
      action: s.action,
      expectedActionOrData: s.expectedActionOrData,
      expectedResult: s.expectedResult,
      expectedResponse: null,
    }));

  const classification = (r: ImportedTestCaseRow) => ({
    testType:
      normalizeTestType(r.testType) ??
      inferTestCaseType({
        title: r.title,
        given: r.given,
        when: r.when,
        then: r.then,
        tags: r.tags,
      }),
    automationStatus:
      normalizeAutomationStatus(r.automationStatus) ?? ("MANUAL" as const),
  });

  const updated = await prisma.$transaction(
    toUpdate.map((r) => {
      const source = sourceByKey.get(keyFor(r.externalId!))!;
      return prisma.testCase.update({
        where: { id: source.testCaseId },
        data: {
          title: r.title,
          background: r.background ?? null,
          given: r.given,
          when: r.when,
          then: r.then,
          tags: r.tags,
          priority: r.priority,
          ...classification(r),
          suitePath: r.suitePath ?? undefined,
          updatedById: args.actorId,
          source: { update: { lastSyncedAt: new Date() } },
          steps: { deleteMany: {}, create: stepsData(r) },
        },
        include: { steps: { orderBy: { order: "asc" } } },
      });
    }),
  );

  const created = await prisma.$transaction(
    toCreate.map((r) =>
      prisma.testCase.create({
        data: {
          projectId: args.projectId,
          testPlanId: args.testPlanId,
          title: r.title,
          background: r.background ?? null,
          given: r.given,
          when: r.when,
          then: r.then,
          tags: r.tags,
          ...classification(r),
          priority: r.priority,
          suitePath: r.suitePath ?? undefined,
          origin: "IMPORTED",
          createdById: args.actorId,
          updatedById: args.actorId,
          steps: { create: stepsData(r) },
          ...(r.externalId
            ? {
                source: {
                  create: {
                    filePath: args.sourceLabel ?? `${args.keyPrefix}-import`,
                    framework: args.framework,
                    frameworkFamily: "CUSTOM",
                    externalTestId: keyFor(r.externalId),
                    lastSyncedAt: new Date(),
                  },
                },
              }
            : {}),
        },
        include: { steps: { orderBy: { order: "asc" } } },
      }),
    ),
  );

  await Promise.all(
    [...created, ...updated].map((c) =>
      snapshotTestCaseVersion(prisma, {
        testCaseId: c.id,
        title: c.title,
        background: c.background,
        given: c.given,
        when: c.when,
        then: c.then,
        steps: c.steps.map((s) => ({
          order: s.order,
          action: s.action,
          expectedActionOrData: s.expectedActionOrData,
          expectedResult: s.expectedResult,
          expectedResponse: s.expectedResponse,
        })),
        tags: c.tags,
        priority: c.priority,
        testType: c.testType,
        actorId: args.actorId,
      }),
    ),
  );

  const importJob = await prisma.importJob.create({
    data: {
      projectId: args.projectId,
      source: args.source,
      sourceLabel: args.sourceLabel,
      fieldMapping: args.fieldMapping,
      testPlanId: args.testPlanId,
      status:
        args.skipped.length > 0 && created.length === 0 && updated.length === 0
          ? "FAILED"
          : "SUCCEEDED",
      createdCount: created.length,
      updatedCount: updated.length,
      skippedCount: args.skipped.length,
      errors: args.skipped,
      createdById: args.actorId,
      completedAt: new Date(),
    },
  });

  if (created.length + updated.length > 0) {
    const first = created[0] ?? updated[0]!;
    await recordAudit(prisma, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      actorId: args.actorId,
      entityType: "TestCase",
      entityId: first.id,
      action: created.length > 0 ? "CREATE" : "UPDATE",
      summary: `Imported ${created.length} new and updated ${updated.length} existing test case(s) from ${args.sourceLabel ?? args.source} (job ${importJob.id})`,
    });
  }

  return {
    importJobId: importJob.id,
    createdCount: created.length,
    updatedCount: updated.length,
    skipped: args.skipped,
  };
}
