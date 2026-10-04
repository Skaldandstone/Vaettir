import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { previewManualCaseResultErasure, eraseManualCaseResultHistory } from "./manualCaseResultErasure.js";

// Only these compile-time native identifiers may reach raw SQL. All IDs remain
// one opaque bound JSON string exposed as a relational membership set, never a
// per-element Prisma array serialization or expanded IN/Prisma.join. An IN
// subquery permits a hash semijoin, unlike scalar ANY over an InitPlan array.
const nativeScopeColumns = {
  CoverageFileEntry: "reportId", ExploratorySessionNote: "sessionId",
  ReleaseReadinessSnapshot: "releaseId", RiskFlag: "releaseId",
  AcceptanceCriterion: "testPlanId", TestCaseAttachment: "testCaseId",
  TestCaseComplianceControl: "testCaseId", TestCaseDataset: "testCaseId",
  TestCaseSource: "testCaseId", TestCaseStep: "testCaseId",
  TestCaseVersion: "testCaseId", TestResultArtifact: "testResultId",
  TestResult: "testRunId", ManualStepResultHead: "testRunId",
  ManualStepResultRevision: "testRunId", TestSelectionRecommendation: "testSelectionRunId",
  TestPlanVersion: "testPlanId", WebhookDelivery: "webhookEndpointId",
} as const;
const nativeScopeFamilies = {
  CoverageFileEntry: "CoverageReport", ExploratorySessionNote: "ExploratorySession",
  ReleaseReadinessSnapshot: "Release", RiskFlag: "Release",
  AcceptanceCriterion: "TestPlan", TestCaseAttachment: "TestCase",
  TestCaseComplianceControl: "TestCase", TestCaseDataset: "TestCase",
  TestCaseSource: "TestCase", TestCaseStep: "TestCase", TestCaseVersion: "TestCase",
  TestResultArtifact: "TestResult", TestResult: "TestRun",
  ManualStepResultHead: "TestRun", ManualStepResultRevision: "TestRun",
  TestSelectionRecommendation: "TestSelectionRun", TestPlanVersion: "TestPlan",
  WebhookDelivery: "WebhookEndpoint",
} as const satisfies Record<keyof typeof nativeScopeColumns, keyof typeof nativeIdentityParents>;
type NativeScopeModel = keyof typeof nativeScopeColumns;
const MAX_NATIVE_SCOPE_IDS = 1000000, MAX_NATIVE_SCOPE_BYTES = 64 * 1024 * 1024;
const nativeScopeJson = new WeakMap<string[], string>();
function encodedNativeScopeIds(ids: string[]) {
  const cached = nativeScopeJson.get(ids);
  if (cached !== undefined) return cached;
  if (ids.length > MAX_NATIVE_SCOPE_IDS || ids.some(id => typeof id !== "string" || !id || id.includes("\0"))) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Native erasure identity scope exceeds its complete count/byte bound. No partial deletion is permitted." });
  }
  const encoded = JSON.stringify(ids);
  if (Buffer.byteLength(encoded, "utf8") > MAX_NATIVE_SCOPE_BYTES) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Native erasure identity scope exceeds its complete byte bound. No partial deletion is permitted." });
  // These lists are internally enumerated native IDs, never editable drafts.
  // Freeze before caching so a reused opaque parameter cannot become stale.
  Object.freeze(ids);
  nativeScopeJson.set(ids, encoded);
  return encoded;
}
function checkNativeScopeIds(ids: string[]) { void encodedNativeScopeIds(ids); }
function nativeScopeValues(ids: string[]) { return Prisma.sql`(SELECT value FROM jsonb_array_elements_text(${encodedNativeScopeIds(ids)}::jsonb) AS native_scope(value))`; }
// Transaction-local families only. Native IDs keep their original TEXT type
// and collation; fixed numeric keys avoid repeating locale comparisons of
// model names during bulk unique-index construction.
const nativeScopeFamilyCodes = Object.freeze({
  Project: 1, TestCase: 2, TestPlan: 3, TestRun: 4, Release: 5,
  TestSelectionRun: 6, CoverageReport: 7, ExploratorySession: 8,
  WebhookEndpoint: 9, TestResult: 10,
} as const satisfies Record<keyof typeof nativeIdentityParents, number>);
function stagedNativeScopeCode(model: keyof typeof nativeIdentityParents) {
  if (!Object.hasOwn(nativeIdentityParents, model) || !Object.hasOwn(nativeScopeFamilyCodes, model)) throw Error("Unsupported staged native erasure family");
  return nativeScopeFamilyCodes[model];
}
function stagedNativeScopeValues(model: keyof typeof nativeIdentityParents) {
  return Prisma.sql`(SELECT id FROM pg_temp.vaettir_native_erasure_scope WHERE model=${stagedNativeScopeCode(model)})`;
}
function nativeScopePredicate(model: NativeScopeModel, ids: string[], revisionNumber?: number, useStagedScope = false) {
  checkNativeScopeIds(ids);
  if (!Object.hasOwn(nativeScopeColumns, model)) throw Error("Unsupported native erasure table");
  if (revisionNumber !== undefined && (model !== "ManualStepResultRevision" || !Number.isInteger(revisionNumber) || revisionNumber < 1 || revisionNumber > 100)) throw Error("Unsupported native erasure revision level");
  const column = Prisma.raw(`"${nativeScopeColumns[model]}"`);
  const values = useStagedScope ? stagedNativeScopeValues(nativeScopeFamilies[model]) : nativeScopeValues(ids);
  return Prisma.sql`${column} IN ${values} ${revisionNumber === undefined ? Prisma.empty : Prisma.sql`AND "revisionNumber"=${revisionNumber}`}`;
}
async function countNativeScope(db: PrismaClient | Prisma.TransactionClient, model: NativeScopeModel, ids: string[], revisionNumber?: number, useStagedScope = false) {
  const predicate = nativeScopePredicate(model, ids, revisionNumber, useStagedScope);
  if (!ids.length) return 0;
  const [row] = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM ${Prisma.raw(`"${model}"`)} WHERE ${predicate}`);
  if (!row || row.count < 0n || row.count > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("Invalid complete native erasure count");
  return Number(row.count);
}
async function deleteNativeScope(tx: Prisma.TransactionClient, model: NativeScopeModel, ids: string[], revisionNumber?: number) {
  const predicate = nativeScopePredicate(model, ids, revisionNumber, true);
  if (!ids.length) return { count: 0 };
  const table = Prisma.raw(`"${model}"`);
  // Count and DELETE see the same statement snapshot. RETURNING contains only
  // a scalar marker, not native bodies. A concurrent update/delete that changes
  // the affected scope still fails exact equality and rolls back the whole org.
  // Zero expected rows still execute DELETE; no unprotected zero-scope skip.
  const [row] = await tx.$queryRaw<Array<{ expected: bigint; count: bigint }>>(Prisma.sql`
    WITH expected AS MATERIALIZED (SELECT count(*)::bigint AS count FROM ${table} WHERE ${predicate}),
      deleted AS (DELETE FROM ${table} WHERE ${predicate}
        AND (SELECT count FROM expected) BETWEEN 0 AND ${BigInt(Number.MAX_SAFE_INTEGER)} RETURNING 1)
    SELECT (SELECT count FROM expected) AS expected,count(*)::bigint AS count FROM deleted`);
  if (!row || typeof row.expected !== "bigint" || typeof row.count !== "bigint" || row.expected < 0n || row.count < 0n || row.expected > BigInt(Number.MAX_SAFE_INTEGER) || row.count > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("Invalid complete native erasure deletion count");
  const expected = Number(row.expected), count = Number(row.count);
  if (count !== expected) throw new TRPCError({ code: "CONFLICT", message: "Native erasure row count changed; the entire transaction must roll back." });
  return { count };
}
const nativeIdentityParents = { Project: "organizationId", TestCase: "projectId", TestPlan: "projectId", TestRun: "projectId", Release: "projectId", TestSelectionRun: "projectId", CoverageReport: "projectId", ExploratorySession: "projectId", WebhookEndpoint: "organizationId", TestResult: "testRunId" } as const;
async function readNativeIdentityScope(db: PrismaClient | Prisma.TransactionClient, model: keyof typeof nativeIdentityParents, parent: string[] | string) {
  if (!Object.hasOwn(nativeIdentityParents, model)) throw Error("Unsupported native erasure identity table");
  const field = nativeIdentityParents[model], column = Prisma.raw(`"${field}"`), table = Prisma.raw(`"${model}"`);
  if ((field === "organizationId") !== (typeof parent === "string")) throw Error("Invalid native erasure identity parent");
  if (Array.isArray(parent)) checkNativeScopeIds(parent);
  const predicate = typeof parent === "string" ? Prisma.sql`${column}=${parent}` : Prisma.sql`${column} IN ${nativeScopeValues(parent)}`;
  // Count and actual JSON-encoded ID bytes BEFORE any complete body projection.
  // +1 accounts for separators; +2 for array delimiters, including empty scope.
  const [size] = await db.$queryRaw<Array<{ count: bigint; bytes: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count,coalesce(sum(octet_length(to_json(id)::text)+1),0)::bigint+2 AS bytes FROM ${table} WHERE ${predicate}`);
  const maxCount = model === "Project" ? 10000 : MAX_NATIVE_SCOPE_IDS;
  if (!size || typeof size.count !== "bigint" || typeof size.bytes !== "bigint" || size.count < 0n || size.bytes < 2n || size.count > BigInt(maxCount) || size.bytes > BigInt(MAX_NATIVE_SCOPE_BYTES)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Native erasure identity population exceeds its complete count/byte bound. No partial scope is returned." });
  if (size.count === 0n) return [];
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ${table} WHERE ${predicate}`);
  if (BigInt(rows.length) !== size.count) throw new TRPCError({ code: "CONFLICT", message: "Native erasure identity population changed. Obtain a fresh preview." });
  checkNativeScopeIds(rows.map(row => row.id));
  return rows;
}
type NativeIdentityScope = Awaited<ReturnType<typeof scopeIds>>;
function nativeIdentityInventories(organizationId: string, scope: NativeIdentityScope) {
  return [
    { model: "Project", parent: organizationId, ids: scope.projectIds },
    { model: "TestCase", parent: scope.projectIds, ids: scope.testCaseIds },
    { model: "TestPlan", parent: scope.projectIds, ids: scope.testPlanIds },
    { model: "TestRun", parent: scope.projectIds, ids: scope.testRunIds },
    { model: "Release", parent: scope.projectIds, ids: scope.releaseIds },
    { model: "TestSelectionRun", parent: scope.projectIds, ids: scope.testSelectionRunIds },
    { model: "CoverageReport", parent: scope.projectIds, ids: scope.coverageReportIds },
    { model: "ExploratorySession", parent: scope.projectIds, ids: scope.exploratorySessionIds },
    { model: "WebhookEndpoint", parent: organizationId, ids: scope.webhookEndpointIds },
    { model: "TestResult", parent: scope.testRunIds, ids: scope.testResultIds },
  ] satisfies Array<{ model: keyof typeof nativeIdentityParents; parent: string | string[]; ids: string[] }>;
}
async function stageNativeIdentityScopes(tx: Prisma.TransactionClient, organizationId: string, scope: NativeIdentityScope) {
  const inventories = nativeIdentityInventories(organizationId, scope);
  let expected = 0n, encodedBytes = 2;
  const parts = inventories.map(({ model, ids }) => {
    const encoded = encodedNativeScopeIds(ids);
    if (new Set(ids).size !== ids.length || model === "Project" && ids.length > 10000) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Native erasure captured identities exceed their exact family bound. No child records were deleted." });
    expected += BigInt(ids.length);
    const key = JSON.stringify(model);
    encodedBytes += Buffer.byteLength(key, "utf8") + 2 + Buffer.byteLength(encoded, "utf8");
    return `${key}:${encoded}`;
  });
  // Every family retains its original 64MiB bound. The combined parameter is
  // bounded before joining/binding, including static JSON key/separator bytes.
  if (inventories.length !== 10 || new Set(inventories.map(row => row.model)).size !== 10 ||
    Object.keys(nativeScopeFamilyCodes).length !== 10 || new Set(Object.values(nativeScopeFamilyCodes)).size !== 10 ||
    Object.values(nativeScopeFamilyCodes).some(code => !Number.isInteger(code) || code < 1 || code > 10) ||
    encodedBytes > 10 * MAX_NATIVE_SCOPE_BYTES + 1024) throw Error("Unsupported complete staged erasure scope");
  const encoded = `{${parts.join(",")}}`;
  const [existing] = await tx.$queryRaw<Array<{ existing: boolean }>>`SELECT to_regclass('pg_temp.vaettir_native_erasure_scope') IS NOT NULL AS existing`;
  if (!existing || existing.existing !== false) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This transaction's native erasure staging name is already in use. No relation was replaced or deleted." });
  // TEMP capability failure refuses. Never alter privileges or replace another
  // relation. Creation/population roll back atomically; successful commit drops
  // this transaction-local resource, never a permanent application table.
  await tx.$executeRaw`CREATE TEMP TABLE pg_temp.vaettir_native_erasure_scope (
    model SMALLINT NOT NULL CHECK (model BETWEEN 1 AND 10),
    id TEXT NOT NULL) ON COMMIT DROP`;
  const familyCode = Prisma.sql`CASE family.key ${Prisma.join(inventories.map(({ model }) =>
    Prisma.sql`WHEN ${model} THEN ${stagedNativeScopeCode(model)}::smallint`), " ")} ELSE NULL END`;
  const [inserted] = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    WITH inserted AS (INSERT INTO pg_temp.vaettir_native_erasure_scope(model,id)
      SELECT ${familyCode},identity.value FROM jsonb_each(${encoded}::jsonb) AS family(key,ids)
        CROSS JOIN LATERAL jsonb_array_elements_text(family.ids) AS identity(value) RETURNING 1)
    SELECT count(*)::bigint AS count FROM inserted`);
  if (!inserted || typeof inserted.count !== "bigint" || inserted.count !== expected) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The complete captured native erasure staging count could not be verified. No child records were deleted." });
  // Bulk-load the new transaction-local heap before building its unique index.
  // CREATE UNIQUE INDEX verifies every existing (model,id), not just metadata;
  // await its successful completion BEFORE returning any usable staged scope.
  // No conditional reuse or concurrent build: unsupported/duplicate data refuses
  // atomically. The index shares the temp table's namespace/lifetime and drops
  // with it on commit; rollback also removes both newly created resources.
  await tx.$executeRaw`CREATE UNIQUE INDEX vaettir_native_erasure_scope_identity_idx
    ON pg_temp.vaettir_native_erasure_scope(model,id)`;
  // Autovacuum cannot analyze this session's temporary table. Give subsequent
  // native family joins actual populated statistics, only after uniqueness is
  // established. Failure still aborts before reconciliation or child deletion.
  await tx.$executeRaw`ANALYZE pg_temp.vaettir_native_erasure_scope`;
}
async function reconcileNativeIdentityScopes(db: Prisma.TransactionClient, organizationId: string, scope: NativeIdentityScope) {
  const inventories = nativeIdentityInventories(organizationId, scope);
  const statements = inventories.map(({ model, parent, ids }) => {
    if (!Object.hasOwn(nativeIdentityParents, model)) throw Error("Unsupported native erasure identity table");
    const field = nativeIdentityParents[model], column = Prisma.raw(`"${field}"`), table = Prisma.raw(`"${model}"`);
    if ((field === "organizationId") !== (typeof parent === "string")) throw Error("Invalid native erasure identity parent");
    checkNativeScopeIds(ids);
    if (new Set(ids).size !== ids.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Native erasure captured identities are duplicated. No child records were deleted." });
    const predicate = typeof parent === "string" ? Prisma.sql`${column}=${parent}` : Prisma.sql`${column} IN ${stagedNativeScopeValues(field === "projectId" ? "Project" : "TestRun")}`;
    // Both sets are unique under unchanged native TEXT/default collation:
    // current IDs are native primary keys and captured IDs have the completed
    // UNIQUE(model,id) index. Equal ACTUAL cardinality plus current-subset is
    // therefore exact set equality, including empty, missing and extra IDs.
    // One driver round trip, complete sets retained server-side; each branch
    // returns count/bytes/exact mismatch only, never another native ID body.
    return Prisma.sql`SELECT ${model}::text AS model, verified.* FROM (
      WITH current_scope AS MATERIALIZED (SELECT id FROM ${table} WHERE ${predicate}),
        captured_scope AS MATERIALIZED (SELECT id FROM pg_temp.vaettir_native_erasure_scope WHERE model=${stagedNativeScopeCode(model)})
      SELECT count(*)::bigint AS count,coalesce(sum(octet_length(to_json(id)::text)+1),0)::bigint+2 AS bytes,
        (count(*)::bigint <> (SELECT count(*)::bigint FROM captured_scope)
          OR EXISTS (SELECT 1 FROM current_scope current_id WHERE NOT EXISTS
            (SELECT 1 FROM captured_scope captured_id WHERE captured_id.id=current_id.id))) AS changed
      FROM current_scope) AS verified`;
  });
  // join combines ten statically enumerated SQL fragments, NOT client IDs.
  const rows = await db.$queryRaw<Array<{ model: string; count: bigint; bytes: bigint; changed: boolean }>>(Prisma.join(statements, " UNION ALL "));
  if (rows.length !== inventories.length || new Set(rows.map(row => row.model)).size !== inventories.length) throw Error("Incomplete native erasure reconciliation metadata");
  for (const { model, ids } of inventories) {
    const size = rows.find(row => row.model === model);
    const maxCount = model === "Project" ? 10000 : MAX_NATIVE_SCOPE_IDS;
    if (!size || typeof size.count !== "bigint" || typeof size.bytes !== "bigint" || size.count !== BigInt(ids.length) || size.count > BigInt(maxCount) || size.bytes > BigInt(MAX_NATIVE_SCOPE_BYTES) || size.bytes < 2n || size.changed !== false) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Native erasure identities or ownership changed. Obtain a fresh preview; no child records were deleted." });
  }
}

// P13-05: the genuinely destructive half of "ownership actions" -
// deliberately built separately from suspend/reactivate/transfer (all
// reversible), and only after a real, careful pass mapping every foreign
// key in the schema (queried directly from Postgres's own
// information_schema, not hand-traced from schema.prisma - too easy to
// miss one). Two real correctness findings from that pass, both handled
// below:
//
// 1. ComplianceFramework/ComplianceControl have NO organizationId/
//    projectId anywhere in the schema - they're shared, platform-wide
//    reference data (even a "custom" framework is visible to every org).
//    Deleting them because this org happened to reference them would
//    silently corrupt every OTHER org using the same framework. Never
//    touched here - only the per-project/per-case rows that reference
//    them (evidence, sign-offs, the test-case mapping) are deleted.
// 2. The permanent "this org was hard-deleted" record can't be a normal
//    AuditLog row (organizationId there is a real, non-cascading FK -
//    the very act of deleting the org would either be blocked by that
//    row's existence, or cascade-delete the row proving the deletion
//    happened). See OrganizationDeletionLog in schema.prisma: a plain
//    snapshot, not a live FK, so it survives the org it describes.
//
// Deletion order is real child-before-parent FK order (several of these
// already cascade at the schema level - kept explicit here anyway for
// accurate per-model row counts and so correctness never depends on
// remembering which ones do).

export interface OrgDeletionPreview {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  projectCount: number;
  rowCounts: Record<string, number>;
  reportScope: ReportErasureScope;
  manualCaseResultScope: {
    basis: "ORIGINAL_ORGANIZATION";
    originalOrganizationId: string;
    blocked: boolean;
    overBound: boolean;
    limits: { heads: number; revisions: number };
    unsupportedOriginalScopeTuples: number;
    limitations: string[];
  };
}

type ReportErasureScope = {
  basis: "ORIGINAL_ORGANIZATION";
  originalOrganizationId: string;
  originalRecordsOnReparentedProjects: Record<string, number>;
  unsupportedForeignOriginalRecordsOnCurrentProjects: Record<string, number>;
  unsupportedForeignSnapshotsReferencingOriginalDefinitions: number;
  blocked: boolean;
  limitations: string[];
};
async function reportErasureCounts(
  db: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
) {
  const original = { organizationId },
    reparented = {
      organizationId,
      project: { organizationId: { not: organizationId } },
    },
    foreignCurrent = {
      organizationId: { not: organizationId },
      project: { organizationId },
    };
  const [
    snapshots,
    definitions,
    writes,
    movedSnapshots,
    movedDefinitions,
    movedWrites,
    foreignSnapshots,
    foreignDefinitions,
    foreignWrites,
    foreignReferences,
  ] = await Promise.all([
    db.projectReportSnapshot.count({ where: original }),
    db.projectReportDefinition.count({ where: original }),
    db.projectReportDefinitionWrite.count({ where: original }),
    db.projectReportSnapshot.count({ where: reparented }),
    db.projectReportDefinition.count({ where: reparented }),
    db.projectReportDefinitionWrite.count({ where: reparented }),
    db.projectReportSnapshot.count({ where: foreignCurrent }),
    db.projectReportDefinition.count({ where: foreignCurrent }),
    db.projectReportDefinitionWrite.count({ where: foreignCurrent }),
    db.projectReportSnapshot.count({
      where: {
        organizationId: { not: organizationId },
        definition: { organizationId },
      },
    }),
  ]);
  const rowCounts = {
    ProjectReportSnapshot: snapshots,
    ProjectReportDefinition: definitions,
    ProjectReportDefinitionWrite: writes,
  };
  const reportScope: ReportErasureScope = {
    basis: "ORIGINAL_ORGANIZATION",
    originalOrganizationId: organizationId,
    originalRecordsOnReparentedProjects: {
      ProjectReportSnapshot: movedSnapshots,
      ProjectReportDefinition: movedDefinitions,
      ProjectReportDefinitionWrite: movedWrites,
    },
    unsupportedForeignOriginalRecordsOnCurrentProjects: {
      ProjectReportSnapshot: foreignSnapshots,
      ProjectReportDefinition: foreignDefinitions,
      ProjectReportDefinitionWrite: foreignWrites,
    },
    unsupportedForeignSnapshotsReferencingOriginalDefinitions:
      foreignReferences,
    blocked:
      foreignSnapshots +
        foreignDefinitions +
        foreignWrites +
        foreignReferences >
      0,
    limitations: [
      "Report counts use each record's recorded original organization scalar, including records whose project now belongs to another organization. Reparented current foreign projects are not erased.",
      "Foreign-original report rows under current projects, or foreign snapshots referencing original definitions, require explicit ownership reconciliation before erasure; they are never silently reinterpreted or deleted.",
      "This preview is read-time metadata, not a locked erasure approval. The destructive workflow rechecks scope and refuses drift. Report scope locks are bounded to 10,000 projects and 100,000 records per report model; larger scopes refuse, not truncate.",
    ],
  };
  return { rowCounts, reportScope };
}

async function lockReportErasureScope(
  tx: Prisma.TransactionClient,
  organizationId: string,
  expectedProjectIds: string[],
) {
  // Existing writers lock Org before Project. Pin the destructive authority and
  // every current/original report project's FK parent before any child deletion.
  const org = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
  if (!org.length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Organization erasure scope changed. Obtain a fresh preview.",
    });
  if (expectedProjectIds.length > 10000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Report erasure exceeds the bounded project lock scope. No records were deleted.",
    });
  const projects = await tx.$queryRaw<
    Array<{ id: string; organizationId: string }>
  >(Prisma.sql`
    SELECT p.id,p."organizationId" FROM "Project" p WHERE p."organizationId"=${organizationId}
      OR ${expectedProjectIds.length ? Prisma.sql`p.id IN (${Prisma.join(expectedProjectIds)})` : Prisma.sql`false`}
      OR p.id IN (SELECT "projectId" FROM "ProjectReportSnapshot" WHERE "organizationId"=${organizationId}
        UNION SELECT "projectId" FROM "ProjectReportDefinition" WHERE "organizationId"=${organizationId}
        UNION SELECT "projectId" FROM "ProjectReportDefinitionWrite" WHERE "organizationId"=${organizationId})
    ORDER BY p.id LIMIT 10001 FOR UPDATE OF p`);
  if (projects.length > 10000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Report erasure exceeds the bounded project lock scope. No records were deleted.",
    });
  const current = new Set(
    projects
      .filter((p) => p.organizationId === organizationId)
      .map((p) => p.id),
  );
  if (
    current.size !== expectedProjectIds.length ||
    expectedProjectIds.some((id) => !current.has(id))
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Current project ownership changed before erasure. Obtain a fresh preview; no child records were deleted.",
    });
  // Definition locks prevent a new foreign FK reference between the refusal
  // check and DELETE/SET NULL; project UPDATE locks protect incoming report rows.
  const lockedDefinitions = await tx.$queryRaw<
    Array<{ locked: number }>
  >`SELECT 1 AS locked FROM "ProjectReportDefinition" WHERE "organizationId"=${organizationId} ORDER BY id LIMIT 100001 FOR UPDATE`;
  const lockedWrites = await tx.$queryRaw<
    Array<{ locked: number }>
  >`SELECT 1 AS locked FROM "ProjectReportDefinitionWrite" WHERE "organizationId"=${organizationId} ORDER BY "key" LIMIT 100001 FOR UPDATE`;
  const lockedSnapshots = await tx.$queryRaw<
    Array<{ locked: number }>
  >`SELECT 1 AS locked FROM "ProjectReportSnapshot" WHERE "organizationId"=${organizationId} ORDER BY id LIMIT 100001 FOR UPDATE`;
  if (
    [lockedDefinitions, lockedWrites, lockedSnapshots].some(
      (rows) => rows.length > 100000,
    )
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Report erasure exceeds the bounded record lock scope. No records were deleted.",
    });
  const evidence = await reportErasureCounts(tx, organizationId);
  if (evidence.reportScope.blocked)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Report ownership reconciliation is required: foreign-original report rows or foreign definition references would be affected. No records were deleted.",
    });
}

async function scopeIds(prisma: PrismaClient | Prisma.TransactionClient, organizationId: string) {
  const projects = await readNativeIdentityScope(prisma, "Project", organizationId);
  const projectIds = projects.map((p) => p.id);
  if (projectIds.length > 10000) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Native erasure exceeds the complete bounded project scope." });
  checkNativeScopeIds(projectIds);

  const [
    testCases,
    testPlans,
    testRuns,
    releases,
    testSelectionRuns,
    coverageReports,
    exploratorySessions,
    webhookEndpoints,
  ] = await Promise.all([
    readNativeIdentityScope(prisma, "TestCase", projectIds),
    readNativeIdentityScope(prisma, "TestPlan", projectIds),
    readNativeIdentityScope(prisma, "TestRun", projectIds),
    readNativeIdentityScope(prisma, "Release", projectIds),
    readNativeIdentityScope(prisma, "TestSelectionRun", projectIds),
    readNativeIdentityScope(prisma, "CoverageReport", projectIds),
    readNativeIdentityScope(prisma, "ExploratorySession", projectIds),
    readNativeIdentityScope(prisma, "WebhookEndpoint", organizationId),
  ]);
  const testRunIds = testRuns.map((r) => r.id);
  checkNativeScopeIds(testRunIds);
  const testResults = await readNativeIdentityScope(prisma, "TestResult", testRunIds);

  const scope = {
    projectIds,
    testCaseIds: testCases.map((c) => c.id),
    testPlanIds: testPlans.map((p) => p.id),
    testRunIds,
    testResultIds: testResults.map((r) => r.id),
    releaseIds: releases.map((r) => r.id),
    testSelectionRunIds: testSelectionRuns.map((r) => r.id),
    coverageReportIds: coverageReports.map((r) => r.id),
    exploratorySessionIds: exploratorySessions.map((s) => s.id),
    webhookEndpointIds: webhookEndpoints.map((w) => w.id),
  };
  for (const ids of Object.values(scope)) checkNativeScopeIds(ids);
  return scope;
}

export async function previewOrgHardDelete(
  prisma: PrismaClient,
  organizationId: string,
): Promise<OrgDeletionPreview> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });
  const scope = await scopeIds(prisma, organizationId);
  const reportEvidence = await reportErasureCounts(prisma, organizationId);
  const manualCaseEvidence = await previewManualCaseResultErasure(prisma, organizationId);
  const [caseFolderWrite, caseFolderState] = await Promise.all([
    prisma.caseFolderWrite.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.caseFolderState.count({ where: { projectId: { in: scope.projectIds } } }),
  ]);

  const [caseAnalysisQueueItem, caseAnalysisQueue] = await Promise.all([
    prisma.caseAnalysisQueueItem.count({ where: { queue: { organizationId } } }),
    prisma.caseAnalysisQueue.count({ where: { organizationId } }),
  ]);
  const [savedTypedCaseQueryWrite, savedTypedCaseQuery] = await Promise.all([
    prisma.savedTypedCaseQueryWrite.count({ where: { organizationId } }),
    prisma.savedTypedCaseQuery.count({ where: { organizationId } }),
  ]);
  const [caseAuthoringPresetWrite,caseAuthoringPreset]=await Promise.all([
    prisma.caseAuthoringPresetWrite.count({where:{organizationId}}),
    prisma.caseAuthoringPreset.count({where:{organizationId}}),
  ]);
  const [qualityRiskDecision, qualityRiskWrite, qualityRiskEntry, projectQualityRiskState] = await Promise.all([
    prisma.qualityRiskDecision.count({ where: { entry: { state: { organizationId } } } }),
    prisma.qualityRiskWrite.count({ where: { state: { organizationId } } }),
    prisma.qualityRiskEntry.count({ where: { state: { organizationId } } }),
    prisma.projectQualityRiskState.count({ where: { organizationId } }),
  ]);
  const [requirementBaselineWrite, requirementBaseline, projectRequirementBaselineState] = await Promise.all([
    prisma.requirementBaselineWrite.count({ where: { state: { organizationId } } }),
    prisma.requirementBaseline.count({ where: { state: { organizationId } } }),
    prisma.projectRequirementBaselineState.count({ where: { organizationId } }),
  ]);

  const [
    coverageFileEntry,
    coverageReport,
    exploratorySessionNote,
    exploratorySession,
    aiCreditTransaction,
    aiCreditUseRequest,
    apiKey,
    auditLog,
    invitation,
    membership,
    aiEditFeedback,
    complianceEvidence,
    complianceSignOff,
    customFrameworkHeuristic,
    healingSuggestion,
    importJob,
    prScanPolicy,
    releaseReadinessSnapshot,
    riskFlag,
    acceptanceCriterion,
    testCaseAttachment,
    testCaseComplianceControl,
    testCaseDataset,
    testCaseSource,
    caseTraceabilityLink,
    caseTraceabilityWrite,
    caseTraceabilityState,
    testCasePrerequisite,
    testCaseStep,
    testCaseVersion,
    reverseEngineerJob,
    testResultArtifact,
    testResult,
    manualStepResultHead,
    manualStepResultRevision,
    testSelectionRecommendation,
    testCase,
    testPlanVersion,
    testPlan,
    release,
    requirement,
    sharedStepGroup,
    sharedStepGroupRevision,
    testRun,
    testSelectionRun,
    webhookDelivery,
    webhookEndpoint,
  ] = await Promise.all([
    countNativeScope(prisma, "CoverageFileEntry", scope.coverageReportIds),
    prisma.coverageReport.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    countNativeScope(prisma, "ExploratorySessionNote", scope.exploratorySessionIds),
    prisma.exploratorySession.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    prisma.aiCreditTransaction.count({ where: { organizationId } }),
    prisma.aiCreditUseRequest.count({ where: { organizationId } }),
    prisma.apiKey.count({ where: { organizationId } }),
    prisma.auditLog.count({ where: { organizationId } }),
    prisma.invitation.count({ where: { organizationId } }),
    prisma.membership.count({ where: { organizationId } }),
    prisma.aiEditFeedback.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    prisma.complianceEvidence.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    prisma.complianceSignOff.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    prisma.customFrameworkHeuristic.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    prisma.healingSuggestion.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    prisma.importJob.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.prScanPolicy.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    countNativeScope(prisma, "ReleaseReadinessSnapshot", scope.releaseIds),
    countNativeScope(prisma, "RiskFlag", scope.releaseIds),
    countNativeScope(prisma, "AcceptanceCriterion", scope.testPlanIds),
    countNativeScope(prisma, "TestCaseAttachment", scope.testCaseIds),
    countNativeScope(prisma, "TestCaseComplianceControl", scope.testCaseIds),
    countNativeScope(prisma, "TestCaseDataset", scope.testCaseIds),
    countNativeScope(prisma, "TestCaseSource", scope.testCaseIds),
    prisma.caseTraceabilityLink.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    prisma.caseTraceabilityWrite.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    prisma.caseTraceabilityState.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    prisma.testCasePrerequisite.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    countNativeScope(prisma, "TestCaseStep", scope.testCaseIds),
    countNativeScope(prisma, "TestCaseVersion", scope.testCaseIds),
    prisma.reverseEngineerJob.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    countNativeScope(prisma, "TestResultArtifact", scope.testResultIds),
    countNativeScope(prisma, "TestResult", scope.testRunIds),
    countNativeScope(prisma, "ManualStepResultHead", scope.testRunIds),
    countNativeScope(prisma, "ManualStepResultRevision", scope.testRunIds),
    countNativeScope(prisma, "TestSelectionRecommendation", scope.testSelectionRunIds),
    prisma.testCase.count({ where: { projectId: { in: scope.projectIds } } }),
    countNativeScope(prisma, "TestPlanVersion", scope.testPlanIds),
    prisma.testPlan.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.release.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.requirement.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    prisma.sharedStepGroup.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    prisma.sharedStepGroupRevision.count({
      where: { group: { projectId: { in: scope.projectIds } } },
    }),
    prisma.testRun.count({ where: { projectId: { in: scope.projectIds } } }),
    prisma.testSelectionRun.count({
      where: { projectId: { in: scope.projectIds } },
    }),
    countNativeScope(prisma, "WebhookDelivery", scope.webhookEndpointIds),
    prisma.webhookEndpoint.count({ where: { organizationId } }),
  ]);

  return {
    organizationId,
    organizationName: org.name,
    organizationSlug: org.slug,
    projectCount: scope.projectIds.length,
    reportScope: reportEvidence.reportScope,
    manualCaseResultScope: {
      basis: "ORIGINAL_ORGANIZATION",
      originalOrganizationId: organizationId,
      blocked: manualCaseEvidence.blocked,
      overBound: manualCaseEvidence.overBound,
      limits: manualCaseEvidence.limits,
      unsupportedOriginalScopeTuples: manualCaseEvidence.unsupportedOriginalScopeTuples,
      limitations: [
        "Whole-case history counts follow its original organization. Reparented or foreign-original native tuples require reconciliation; no other organization's history is erased.",
        "History erasure is only part of complete authorized organization deletion in one transaction. This read-time preview does not authorize deletion or prove recovery.",
        "The destructive workflow rechecks original scope and bounded inventory before deleting any children. Unsupported scope or excessive inventory refuses the whole transaction.",
      ],
    },
    rowCounts: {
      ManualCaseResultHead: manualCaseEvidence.ManualCaseResultHead,
      ManualCaseResultRevision: manualCaseEvidence.ManualCaseResultRevision,
      ...reportEvidence.rowCounts,
      CaseFolderWrite: caseFolderWrite,
      CaseFolderState: caseFolderState,
      CaseAnalysisQueueItem: caseAnalysisQueueItem,
      CaseAnalysisQueue: caseAnalysisQueue,
      SavedTypedCaseQueryWrite: savedTypedCaseQueryWrite,
      SavedTypedCaseQuery: savedTypedCaseQuery,
      CaseAuthoringPresetWrite:caseAuthoringPresetWrite,
      CaseAuthoringPreset:caseAuthoringPreset,
      QualityRiskDecision: qualityRiskDecision,
      QualityRiskWrite: qualityRiskWrite,
      QualityRiskEntry: qualityRiskEntry,
      ProjectQualityRiskState: projectQualityRiskState,
      RequirementBaselineWrite: requirementBaselineWrite,
      RequirementBaseline: requirementBaseline,
      ProjectRequirementBaselineState: projectRequirementBaselineState,
      CoverageFileEntry: coverageFileEntry,
      CoverageReport: coverageReport,
      ExploratorySessionNote: exploratorySessionNote,
      ExploratorySession: exploratorySession,
      AiCreditTransaction: aiCreditTransaction,
      AiCreditUseRequest: aiCreditUseRequest,
      ApiKey: apiKey,
      AuditLog: auditLog,
      Invitation: invitation,
      Membership: membership,
      AiEditFeedback: aiEditFeedback,
      ComplianceEvidence: complianceEvidence,
      ComplianceSignOff: complianceSignOff,
      CustomFrameworkHeuristic: customFrameworkHeuristic,
      HealingSuggestion: healingSuggestion,
      ImportJob: importJob,
      PrScanPolicy: prScanPolicy,
      ReleaseReadinessSnapshot: releaseReadinessSnapshot,
      RiskFlag: riskFlag,
      AcceptanceCriterion: acceptanceCriterion,
      TestCaseAttachment: testCaseAttachment,
      TestCaseComplianceControl: testCaseComplianceControl,
      TestCaseDataset: testCaseDataset,
      TestCaseSource: testCaseSource,
      CaseTraceabilityLink: caseTraceabilityLink,
      CaseTraceabilityWrite: caseTraceabilityWrite,
      CaseTraceabilityState: caseTraceabilityState,
      TestCasePrerequisite: testCasePrerequisite,
      TestCaseStep: testCaseStep,
      TestCaseVersion: testCaseVersion,
      ReverseEngineerJob: reverseEngineerJob,
      TestResultArtifact: testResultArtifact,
      TestResult: testResult,
      ManualStepResultHead: manualStepResultHead,
      ManualStepResultRevision: manualStepResultRevision,
      TestSelectionRecommendation: testSelectionRecommendation,
      TestCase: testCase,
      TestPlanVersion: testPlanVersion,
      TestPlan: testPlan,
      Release: release,
      Requirement: requirement,
      SharedStepGroup: sharedStepGroup,
      SharedStepGroupRevision: sharedStepGroupRevision,
      TestRun: testRun,
      TestSelectionRun: testSelectionRun,
      WebhookDelivery: webhookDelivery,
      WebhookEndpoint: webhookEndpoint,
      Project: scope.projectIds.length,
    },
  };
}

export interface OrgHardDeleteResult {
  deletionLogId: string;
  rowCounts: Record<string, number>;
}

export async function hardDeleteOrganization(
  prisma: PrismaClient,
  organizationId: string,
  actorId: string,
  reason: string,
): Promise<OrgHardDeleteResult> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
  });
  const scope = await scopeIds(prisma, organizationId);

  return prisma.$transaction(async (tx) => {
    const counts: Record<string, number> = {};
    const del = async (name: string, fn: () => Promise<{ count: number }>) => {
      counts[name] = (await fn()).count;
    };
    await lockReportErasureScope(tx, organizationId, scope.projectIds);
    await stageNativeIdentityScopes(tx, organizationId, scope);
    // Keep the exact preflight identity sets; never turn their erasure into an
    // unreviewed live relation traversal. Locked current ownership must still
    // produce precisely those complete IDs before ANY child record is removed.
    await reconcileNativeIdentityScopes(tx, organizationId, scope);
    // Org UPDATE excludes current whole-case writers (Org SHARE first).
    // Recheck original tuple ownership BEFORE any report or other child deletion.
    const manualCaseEvidence = await previewManualCaseResultErasure(tx, organizationId);
    if (manualCaseEvidence.blocked) throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Original whole-case history scope or inventory is unsupported. Reconcile it and obtain a fresh preview; no child records were deleted.",
    });
    // Bound and freeze only step-history count metadata before any child DELETE.
    // The existing Org/Project locks pin current ownership; restrictive FKs and
    // per-level count checks remain in force. No observation bodies are loaded.
    const stepHeadCount = await countNativeScope(tx, "ManualStepResultHead", scope.testRunIds, undefined, true);
    const stepRevisionCount = await countNativeScope(tx, "ManualStepResultRevision", scope.testRunIds, undefined, true);
    if ([stepHeadCount, stepRevisionCount].some(count => !Number.isSafeInteger(count) || count < 0 || count > 100000)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Step-history erasure exceeds the complete bounded inventory. No child records were deleted." });
    }
    const stepLevelRows = stepRevisionCount === 0 ? [] : await tx.$queryRaw<Array<{ revisionNumber: number; count: bigint }>>`
      SELECT "revisionNumber",count(*)::bigint AS count FROM "ManualStepResultRevision"
      WHERE "testRunId" IN ${stagedNativeScopeValues("TestRun")} GROUP BY "revisionNumber" ORDER BY "revisionNumber" DESC LIMIT 101`;
    const stepLevels = stepLevelRows.map(level => ({ revisionNumber: level.revisionNumber, _count: { _all: Number(level.count) } }));
    if (stepLevels.length > 100 || stepLevels.some(level => !Number.isInteger(level.revisionNumber) || level.revisionNumber < 1 || level.revisionNumber > 100 || !Number.isSafeInteger(level._count._all) || level._count._all < 1) ||
      stepLevels.reduce((sum, level) => sum + level._count._all, 0) !== stepRevisionCount) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Step-history revision levels do not match the complete bounded inventory. No child records were deleted." });
    }
    // Exact original-org ownership, never current foreign-project ownership.
    // Receipts/captures before definitions keeps history counts accurate and
    // avoids definition SET NULL changing a retained foreign tenant's capture.
    await del("ProjectReportDefinitionWrite", () =>
      tx.projectReportDefinitionWrite.deleteMany({ where: { organizationId } }),
    );
    await del("ProjectReportSnapshot", () =>
      tx.projectReportSnapshot.deleteMany({ where: { organizationId } }),
    );
    await del("ProjectReportDefinition", () =>
      tx.projectReportDefinition.deleteMany({ where: { organizationId } }),
    );
    await tx.$queryRaw`SELECT set_config('vaettir.case_folder_erasure',${organizationId},true)`;
    await del("CaseFolderWrite", () => tx.caseFolderWrite.deleteMany({ where: { projectId: { in: scope.projectIds } } }));
    await del("CaseFolderState", () => tx.caseFolderState.deleteMany({ where: { projectId: { in: scope.projectIds } } }));

    await del("CoverageFileEntry", () =>
      deleteNativeScope(tx, "CoverageFileEntry", scope.coverageReportIds),
    );
    await del("CoverageReport", () =>
      tx.coverageReport.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    if (counts.CoverageReport !== scope.coverageReportIds.length) throw new TRPCError({ code: "CONFLICT", message: "Native coverage erasure count changed; transaction must roll back." });
    await del("ExploratorySessionNote", () =>
      deleteNativeScope(tx, "ExploratorySessionNote", scope.exploratorySessionIds),
    );
    await del("ExploratorySession", () =>
      tx.exploratorySession.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    if (counts.ExploratorySession !== scope.exploratorySessionIds.length) throw new TRPCError({ code: "CONFLICT", message: "Native session erasure count changed; transaction must roll back." });
    await del("CaseAnalysisQueueItem", () =>
      tx.caseAnalysisQueueItem.deleteMany({ where: { queue: { organizationId } } }),
    );
    await del("SavedTypedCaseQueryWrite", () =>
      tx.savedTypedCaseQueryWrite.deleteMany({ where: { organizationId } }),
    );
    await tx.$queryRaw`SELECT set_config('vaettir.case_authoring_preset_erasure',${organizationId},true)`;
    await del("CaseAuthoringPresetWrite",()=>tx.caseAuthoringPresetWrite.deleteMany({where:{organizationId}}));
    await del("CaseAuthoringPreset",()=>tx.caseAuthoringPreset.deleteMany({where:{organizationId}}));
    await tx.$queryRaw`SELECT set_config('vaettir.quality_risk_erasure',${organizationId},true)`;
    await del("QualityRiskDecision", () => tx.qualityRiskDecision.deleteMany({ where: { entry: { state: { organizationId } } } }));
    await del("QualityRiskWrite", () => tx.qualityRiskWrite.deleteMany({ where: { state: { organizationId } } }));
    await del("QualityRiskEntry", () => tx.qualityRiskEntry.deleteMany({ where: { state: { organizationId } } }));
    await del("ProjectQualityRiskState", () => tx.projectQualityRiskState.deleteMany({ where: { organizationId } }));
    await tx.$queryRaw`SELECT set_config('vaettir.requirement_baseline_erasure',${organizationId},true)`;
    await del("RequirementBaselineWrite", () => tx.requirementBaselineWrite.deleteMany({ where: { state: { organizationId } } }));
    await del("RequirementBaseline", () => tx.requirementBaseline.deleteMany({ where: { state: { organizationId } } }));
    await del("ProjectRequirementBaselineState", () => tx.projectRequirementBaselineState.deleteMany({ where: { organizationId } }));
    await del("SavedTypedCaseQuery", () =>
      tx.savedTypedCaseQuery.deleteMany({ where: { organizationId } }),
    );
    await del("CaseAnalysisQueue", () =>
      tx.caseAnalysisQueue.deleteMany({ where: { organizationId } }),
    );
    await del("AiCreditTransaction", () =>
      tx.aiCreditTransaction.deleteMany({ where: { organizationId } }),
    );
    await del("AiCreditUseRequest", () =>
      tx.aiCreditUseRequest.deleteMany({ where: { organizationId } }),
    );
    await del("ApiKey", () =>
      tx.apiKey.deleteMany({ where: { organizationId } }),
    );
    await del("AuditLog", () =>
      tx.auditLog.deleteMany({ where: { organizationId } }),
    );
    await del("Invitation", () =>
      tx.invitation.deleteMany({ where: { organizationId } }),
    );
    await del("Membership", () =>
      tx.membership.deleteMany({ where: { organizationId } }),
    );
    await del("AiEditFeedback", () =>
      tx.aiEditFeedback.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("ComplianceEvidence", () =>
      tx.complianceEvidence.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("ComplianceSignOff", () =>
      tx.complianceSignOff.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("CustomFrameworkHeuristic", () =>
      tx.customFrameworkHeuristic.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("HealingSuggestion", () =>
      tx.healingSuggestion.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("ImportJob", () =>
      tx.importJob.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("PrScanPolicy", () =>
      tx.prScanPolicy.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("ReleaseReadinessSnapshot", () =>
      deleteNativeScope(tx, "ReleaseReadinessSnapshot", scope.releaseIds),
    );
    await del("RiskFlag", () =>
      deleteNativeScope(tx, "RiskFlag", scope.releaseIds),
    );
    await del("AcceptanceCriterion", () =>
      deleteNativeScope(tx, "AcceptanceCriterion", scope.testPlanIds),
    );
    await del("TestCaseAttachment", () =>
      deleteNativeScope(tx, "TestCaseAttachment", scope.testCaseIds),
    );
    await del("TestCaseComplianceControl", () =>
      deleteNativeScope(tx, "TestCaseComplianceControl", scope.testCaseIds),
    );
    await del("TestCaseDataset", () =>
      deleteNativeScope(tx, "TestCaseDataset", scope.testCaseIds),
    );
    await del("TestCaseSource", () =>
      deleteNativeScope(tx, "TestCaseSource", scope.testCaseIds),
    );
    await del("TestCasePrerequisite", () =>
      tx.testCasePrerequisite.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    // Active and removed traceability links both restrict case/requirement
    // deletion. Count the leaves explicitly before the state would cascade
    // them, and scope by owned projects, never the caller-provided native IDs.
    await del("CaseTraceabilityLink", () =>
      tx.caseTraceabilityLink.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("CaseTraceabilityWrite", () =>
      tx.caseTraceabilityWrite.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("CaseTraceabilityState", () =>
      tx.caseTraceabilityState.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("TestCaseStep", () =>
      deleteNativeScope(tx, "TestCaseStep", scope.testCaseIds),
    );
    await del("TestCaseVersion", () =>
      deleteNativeScope(tx, "TestCaseVersion", scope.testCaseIds),
    );
    await del("ReverseEngineerJob", () =>
      tx.reverseEngineerJob.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("TestResultArtifact", () =>
      deleteNativeScope(tx, "TestResultArtifact", scope.testResultIds),
    );
    // Only this explicit organization-erasure workflow removes recorded history.
    // Heads before derived results satisfy mixed-version write guards; then
    // leaf revisions before parents preserve normal restrictive FKs.
    const deletedStepHeads = stepHeadCount === 0 ? { count: 0 } : await deleteNativeScope(tx, "ManualStepResultHead", scope.testRunIds);
    if (deletedStepHeads.count !== stepHeadCount) throw new TRPCError({ code: "CONFLICT", message: "The exact step-history head inventory changed; transaction must roll back." });
    counts.ManualStepResultHead = deletedStepHeads.count;
    // Heads, then immutable revision tips, BEFORE restrictive native result FKs.
    // Deferred guards allow this only when original org and native result are
    // also deleted in this same transaction; never standalone history pruning.
    Object.assign(counts, await eraseManualCaseResultHistory(tx, organizationId));
    await del("TestResult", () =>
      deleteNativeScope(tx, "TestResult", scope.testRunIds),
    );
    if (counts.TestResult !== scope.testResultIds.length) throw new TRPCError({ code: "CONFLICT", message: "Native result erasure count changed; transaction must roll back." });
    let revisionCount = 0;
    // Delete only populated levels, newest first. Empty scopes now perform no
    // step-revision DELETEs, not 100 empty round trips inside a 5s transaction.
    for (const level of stepLevels) {
      const deleted = await deleteNativeScope(tx, "ManualStepResultRevision", scope.testRunIds, level.revisionNumber);
      if (deleted.count !== level._count._all) throw new TRPCError({ code: "CONFLICT", message: "The exact step-history revision level changed; transaction must roll back." });
      revisionCount += deleted.count;
    }
    if (revisionCount !== stepRevisionCount) throw new TRPCError({ code: "CONFLICT", message: "The exact step-history erasure inventory changed; transaction must roll back." });
    counts.ManualStepResultRevision = revisionCount;
    await del("TestSelectionRecommendation", () =>
      deleteNativeScope(tx, "TestSelectionRecommendation", scope.testSelectionRunIds),
    );
    await del("TestCase", () =>
      tx.testCase.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    if (counts.TestCase !== scope.testCaseIds.length) throw new TRPCError({ code: "CONFLICT", message: "Native case erasure count changed; transaction must roll back." });
    await del("TestPlanVersion", () =>
      deleteNativeScope(tx, "TestPlanVersion", scope.testPlanIds),
    );
    await del("TestPlan", () =>
      tx.testPlan.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    if (counts.TestPlan !== scope.testPlanIds.length) throw new TRPCError({ code: "CONFLICT", message: "Native plan erasure count changed; transaction must roll back." });
    await del("Release", () =>
      tx.release.deleteMany({ where: { projectId: { in: scope.projectIds } } }),
    );
    if (counts.Release !== scope.releaseIds.length) throw new TRPCError({ code: "CONFLICT", message: "Native release erasure count changed; transaction must roll back." });
    await del("Requirement", () =>
      tx.requirement.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    // Explicit retained-library erasure scope, never another organization's rows.
    await tx.$queryRaw`SELECT set_config('vaettir.shared_library_erasure',${organizationId},true)`;
    await del("SharedStepGroupRevision", () =>
      tx.sharedStepGroupRevision.deleteMany({
        where: { group: { projectId: { in: scope.projectIds } } },
      }),
    );
    await del("SharedStepGroup", () =>
      tx.sharedStepGroup.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    await del("TestRun", () =>
      tx.testRun.deleteMany({ where: { projectId: { in: scope.projectIds } } }),
    );
    if (counts.TestRun !== scope.testRunIds.length) throw new TRPCError({ code: "CONFLICT", message: "Native run erasure count changed; transaction must roll back." });
    await del("TestSelectionRun", () =>
      tx.testSelectionRun.deleteMany({
        where: { projectId: { in: scope.projectIds } },
      }),
    );
    if (counts.TestSelectionRun !== scope.testSelectionRunIds.length) throw new TRPCError({ code: "CONFLICT", message: "Native selection erasure count changed; transaction must roll back." });
    await del("WebhookDelivery", () =>
      deleteNativeScope(tx, "WebhookDelivery", scope.webhookEndpointIds),
    );
    await del("WebhookEndpoint", () =>
      tx.webhookEndpoint.deleteMany({ where: { organizationId } }),
    );
    if (counts.WebhookEndpoint !== scope.webhookEndpointIds.length) throw new TRPCError({ code: "CONFLICT", message: "Native webhook erasure count changed; transaction must roll back." });

    counts.Project = (
      await tx.project.deleteMany({ where: { organizationId } })
    ).count;
    if (counts.Project !== scope.projectIds.length) throw new TRPCError({ code: "CONFLICT", message: "Native project erasure count changed; transaction must roll back." });
    await tx.organization.delete({ where: { id: organizationId } });

    // The permanent receipt is part of the destructive transaction. Its actor
    // FK or any write failure must roll back every deletion, not leave an
    // erased tenant with no durable audit record.
    const log = await tx.organizationDeletionLog.create({
      data: {
        organizationId: org.id,
        organizationName: org.name,
        organizationSlug: org.slug,
        deletedById: actorId,
        reason,
        rowCounts: counts,
      },
    });

    return { deletionLogId: log.id, rowCounts: counts };
  });
}
