import { type PrismaClient } from "@vaettir/db";
import { z } from "zod";
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
// copy that could drift. Existing rows are reconciled against the last
// imported snapshot; source changes never silently replace human edits.

const importedSnapshotSchema = z.object({
  title: z.string(), background: z.string().nullable(),
  given: z.array(z.string()), when: z.array(z.string()), then: z.array(z.string()),
  tags: z.array(z.string()), priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  testType: z.string(), automationStatus: z.string(), suitePath: z.string().nullable(),
  steps: z.array(z.object({
    order: z.number().int(), action: z.string(),
    expectedActionOrData: z.string().nullable(), expectedResult: z.string().nullable(),
    expectedResponse: z.string().nullable(),
    mediaAttachmentIds: z.array(z.string()).default([]),
  })),
}).strict();
type ImportedSnapshot = z.infer<typeof importedSnapshotSchema>;

function sameSnapshot(a: ImportedSnapshot, b: ImportedSnapshot) {
  return JSON.stringify(a) === JSON.stringify(b);
}

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
  // Keep the source baseline, case changes, version snapshots and job outcome
  // indivisible. A failed import must never leave edited cases without the
  // corresponding version and audit/job record.
  if (args.rows.length > 2_500) throw new Error("Import exceeds the 2,500-case batch limit; split the file and retry.");
  return prisma.$transaction(
    tx => commitImportedTestCasesInTransaction(tx as unknown as PrismaClient, args),
    { timeout: 120_000 },
  );
}

// For callers that must atomically validate additional scope and retain a
// durable operation receipt. The caller must already own a DB transaction.
export async function commitImportedTestCasesInTransaction(
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

  // A source identity maps to one case. Expanded outlines must carry stable
  // distinct ids (e.g. #2), otherwise additional rows are review-only.
  const seenUpdateKeys = new Set<string>();
  const seenIncomingKeys = new Set<string>();
  const skipped = [...args.skipped];
  const toUpdate: ImportedTestCaseRow[] = [];
  const toCreate: ImportedTestCaseRow[] = [];
  for (const r of args.rows) {
    const key = r.externalId ? keyFor(r.externalId) : null;
    if (key && seenIncomingKeys.has(key)) {
      skipped.push({ rowNumber: r.rowNumber, reason: "Duplicate source identity in this import; the additional row was not created." });
      continue;
    }
    if (key) seenIncomingKeys.add(key);
    if (key && sourceByKey.has(key) && !seenUpdateKeys.has(key)) {
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
      mediaAttachmentIds: [],
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

  const snapshotFromRow = (r: ImportedTestCaseRow): ImportedSnapshot => ({
    title: r.title,
    background: r.background ?? null,
    given: r.given,
    when: r.when,
    then: r.then,
    tags: r.tags,
    priority: r.priority,
    ...classification(r),
    suitePath: r.suitePath ?? null,
    steps: stepsData(r),
  });

  const updated = [] as Awaited<ReturnType<typeof prisma.testCase.findMany<{ include: { steps: true } }>>>;
  for (const row of toUpdate) {
    const source = sourceByKey.get(keyFor(row.externalId!))!;
    const incoming = snapshotFromRow(row);
    const result = await (async () => {
      const tx = prisma;
      // An editor's committed change must be visible before we compare
      // against the last source snapshot. A later editor waits for this
      // transaction and remains the last intentional human write.
      await tx.$queryRaw`SELECT id FROM "TestCase" WHERE id = ${source.testCaseId} AND "projectId" = ${args.projectId} FOR UPDATE`;
      const current = await tx.testCase.findFirst({
        where: { id: source.testCaseId, projectId: args.projectId, origin: "IMPORTED" },
        include: { steps: { orderBy: { order: "asc" } }, source: true },
      });
      if (!current || !current.source || current.source.externalTestId !== keyFor(row.externalId!)) {
        return { kind: "conflict" as const, reason: "Imported case identity changed or is outside this project; review manually." };
      }
      const baseline = importedSnapshotSchema.safeParse(current.source.importSnapshot);
      if (!baseline.success) {
        return { kind: "conflict" as const, reason: "Existing imported case has no verified source baseline; review manually before replacing edits." };
      }
      const live = importedSnapshotSchema.parse({
        title: current.title, background: current.background,
        given: current.given, when: current.when, then: current.then,
        tags: current.tags, priority: current.priority,
        testType: current.testType, automationStatus: current.automationStatus,
        suitePath: current.suitePath,
        steps: current.steps.map(step => ({
          order: step.order, action: step.action,
          expectedActionOrData: step.expectedActionOrData,
          expectedResult: step.expectedResult,
          expectedResponse: step.expectedResponse,
          mediaAttachmentIds: step.mediaAttachmentIds,
        })),
      });
      if (!sameSnapshot(live, baseline.data)) {
        return { kind: "conflict" as const, reason: "Case changed since its last import; source updates were not applied. Review the human edits and source changes." };
      }
      if (sameSnapshot(incoming, baseline.data)) {
        return { kind: "unchanged" as const };
      }
      const changed = await tx.testCase.update({
        where: { id: current.id },
        data: {
          title: incoming.title,
          background: incoming.background,
          given: incoming.given,
          when: incoming.when,
          then: incoming.then,
          tags: incoming.tags,
          priority: incoming.priority,
          testType: incoming.testType as never,
          automationStatus: incoming.automationStatus as never,
          suitePath: incoming.suitePath,
          updatedById: args.actorId,
          source: { update: { importSnapshot: incoming, lastSyncedAt: new Date() } },
          steps: { deleteMany: {}, create: incoming.steps },
        },
        include: { steps: { orderBy: { order: "asc" } } },
      });
      return { kind: "updated" as const, changed };
    })();
    if (result.kind === "updated") updated.push(result.changed);
    if (result.kind === "conflict") skipped.push({ rowNumber: row.rowNumber, reason: result.reason });
  }

  const created = await Promise.all(
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
                    importSnapshot: snapshotFromRow(r),
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
        skipped.length > 0 && created.length === 0 && updated.length === 0
          ? "FAILED"
          : "SUCCEEDED",
      createdCount: created.length,
      updatedCount: updated.length,
      skippedCount: skipped.length,
      errors: skipped,
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
    skipped,
  };
}
