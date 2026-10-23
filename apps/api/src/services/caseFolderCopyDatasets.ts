import { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import {
  executionDatasetSchema,
  resolveDatasetProcedure,
} from "./datasetExecution.js";
import {
  qualityProfileHash,
  runCaseDefinitionSchema,
} from "./qualityExperienceProfile.js";
import { verificationProfileSchema } from "./physicalValidation.js";
import {
  MAX_FOLDER_COPY_CASES,
  MAX_FOLDER_COPY_DATASET_ROWS,
  folderDatasetSourceSchema,
  copiedFolderDatasetSchema,
} from "./caseFolderCopySchema.js";
import type { sourceState } from "./caseClone.js";
import type { z } from "zod";

function fail(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
const MAX_DATASET_BYTES = 256 * 1024,
  MAX_ALL_DATASET_BYTES = 2 * 1024 * 1024,
  MAX_RESOLVED_BYTES = 4 * 1024 * 1024;
type CopyCase = {
  row: { id: string; displayId: string };
  state: Awaited<ReturnType<typeof sourceState>>;
};
type Pair = { dependentId: string; prerequisiteId: string };
export function supportedCopyDataset(value: unknown) {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let bytes = 0,
    nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 8000 || item.depth > 6)
      fail(
        "Dataset nesting is unsupported; no variables or overrides were dropped.",
      );
    const v = item.value;
    if (typeof v === "string") bytes += Buffer.byteLength(v, "utf8") + 2;
    else if (Array.isArray(v)) {
      if (v.length > 50)
        fail("Each copied dataset supports at most 50 rows and 50 parameters.");
      bytes += v.length + 2;
      for (const child of v)
        pending.push({ value: child, depth: item.depth + 1 });
    } else if (v && typeof v === "object") {
      const entries = Object.entries(v);
      if (entries.length > 50)
        fail("Copied dataset values exceed the supported parameter bound.");
      for (const [key, child] of entries) {
        bytes += Buffer.byteLength(key, "utf8") + 4;
        pending.push({ value: child, depth: item.depth + 1 });
      }
    } else bytes += 5;
    if (bytes > MAX_DATASET_BYTES)
      fail(
        "Each copied dataset must fit 256 KiB; the complete original was retained.",
      );
  }
  const parsed = executionDatasetSchema.safeParse(value);
  if (!parsed.success)
    fail(
      "Dataset shape or variables are unsupported. Supply exactly the declared concrete string values; row overrides, IDs and correlations are not supported and were not dropped.",
    );
  if (qualityProfileHash(parsed.data) !== qualityProfileHash(value))
    fail(
      "Dataset parameter names require repair before copying; normalization must not silently change the saved original.",
    );
  if (
    Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > MAX_DATASET_BYTES
  )
    fail("Each copied dataset must fit 256 KiB.");
  return parsed.data;
}
export function validateDatasetCopyClosure(
  datasets: Array<{
    caseId: string;
    data: ReturnType<typeof supportedCopyDataset>;
  }>,
  cases: CopyCase[],
  edges: Pair[],
) {
  const datasetIds = new Set(datasets.map((d) => d.caseId));
  if (edges.some((edge) => datasetIds.has(edge.prerequisiteId)))
    fail(
      "A selected prerequisite has its own dataset. Explicit row pairing is unsupported; the whole copy was refused without guessing a correlation.",
    );
  const byId = new Map(cases.map((c) => [c.row.id, c])),
    graph = new Map<string, string[]>();
  for (const edge of edges)
    graph.set(edge.dependentId, [
      ...(graph.get(edge.dependentId) ?? []),
      edge.prerequisiteId,
    ]);
  let expandedBytes = 0;
  for (const dataset of datasets) {
    const selected = new Set<string>(),
      pending = [dataset.caseId];
    while (pending.length) {
      const id = pending.pop()!;
      if (selected.has(id)) continue;
      selected.add(id);
      if (!byId.has(id) || selected.size > MAX_FOLDER_COPY_CASES)
        fail("Dataset prerequisites are not wholly selected in this project.");
      pending.push(...(graph.get(id) ?? []));
    }
    if (selected.size * dataset.data.rows.length > 500)
      fail(
        "Copied dataset prerequisite expansion exceeds the existing 500-instance limit.",
      );
    for (const row of dataset.data.rows)
      for (const id of selected) {
        const c = byId.get(id)!;
        const profile = verificationProfileSchema
          .strict()
          .parse(c.state.source.verificationProfile);
        const definition = runCaseDefinitionSchema.parse({
          testCaseId: id,
          ...c.state.preview.definition,
          reviewStatus: "PENDING_REVIEW",
          verificationProfile: profile,
        });
        const resolved = resolveDatasetProcedure(definition, row.values);
        expandedBytes += Buffer.byteLength(JSON.stringify(resolved), "utf8");
        if (expandedBytes > MAX_RESOLVED_BYTES)
          fail(
            "Complete dataset copy validation exceeds the 4 MiB resolved-procedure limit. No row was omitted.",
          );
      }
  }
  return { resolvedBytes: expandedBytes };
}
/** Metadata/SQL preflight precedes any JSON dataset projection. */
export async function prepareFolderDatasets(
  tx: Prisma.TransactionClient,
  projectId: string,
  cases: CopyCase[],
  edges: Pair[],
) {
  const ids = cases.map((c) => c.row.id);
  const sizes = ids.length
    ? await tx.$queryRaw<
        Array<{
          id: string;
          testCaseId: string;
          bytes: bigint;
          rowCount: number;
          parameterCount: number;
        }>
      >(Prisma.sql`
    SELECT d.id,d."testCaseId",(octet_length(d.rows::text)+octet_length(d."parameterNames"::text))::bigint AS bytes,
      CASE WHEN jsonb_typeof(d.rows)='array' THEN jsonb_array_length(d.rows) ELSE 51 END AS "rowCount",cardinality(d."parameterNames") AS "parameterCount"
    FROM "TestCaseDataset" d JOIN "TestCase" c ON c.id=d."testCaseId" WHERE c."projectId"=${projectId} AND c.id IN (${Prisma.join(ids)}) ORDER BY d."testCaseId" LIMIT ${MAX_FOLDER_COPY_CASES + 1}`)
    : [];
  if (
    sizes.length > MAX_FOLDER_COPY_CASES ||
    sizes.some(
      (d) =>
        d.bytes > BigInt(MAX_DATASET_BYTES) ||
        d.rowCount > 50 ||
        d.rowCount < 1 ||
        d.parameterCount > 50 ||
        d.parameterCount < 1,
    ) ||
    sizes.reduce((sum, d) => sum + d.bytes, 0n) >
      BigInt(MAX_ALL_DATASET_BYTES) ||
    sizes.reduce((sum, d) => sum + d.rowCount, 0) > MAX_FOLDER_COPY_DATASET_ROWS
  )
    fail(
      "Complete dataset copy exceeds 50 parameters/rows per dataset, 256 KiB each, or 500 rows / 2 MiB in the selected batch. Nothing was truncated.",
    );
  const datasetRows = sizes.length
    ? await tx.testCaseDataset.findMany({
        where: { id: { in: sizes.map((d) => d.id) }, testCase: { projectId } },
        select: {
          id: true,
          testCaseId: true,
          parameterNames: true,
          rows: true,
          updatedAt: true,
        },
        orderBy: { testCaseId: "asc" },
        take: MAX_FOLDER_COPY_CASES + 1,
      })
    : [];
  if (datasetRows.length !== sizes.length)
    fail(
      "Complete source dataset selection changed. Review again; nothing was copied.",
    );
  const datasets = datasetRows.map((d) => {
    const data = supportedCopyDataset({
        parameterNames: d.parameterNames,
        rows: d.rows,
      }),
      contentHash = qualityProfileHash(data);
    const source = folderDatasetSourceSchema.parse({
      sourceCaseId: d.testCaseId,
      sourceDatasetId: d.id,
      sourceRevisionHash: qualityProfileHash({
        datasetId: d.id,
        updatedAt: d.updatedAt.toISOString(),
        contentHash,
      }),
      contentHash,
      parameterCount: data.parameterNames.length,
      rowCount: data.rows.length,
      rows: data.rows.map((row, rowIndex) => ({ rowIndex, name: row.name })),
    });
    return { caseId: d.testCaseId, data, source };
  });
  validateDatasetCopyClosure(datasets, cases, edges);
  const sources = datasets.map((d) => d.source);
  return {
    datasets,
    sources,
    bytes: sizes.reduce((sum, d) => sum + d.bytes, 0n),
    reviewHash: qualityProfileHash({ projectId, datasets: sources }),
  };
}
export function validatedDatasetReplay(
  projectId: string,
  expected: z.infer<typeof folderDatasetSourceSchema>[],
  saved: z.infer<typeof copiedFolderDatasetSchema>[],
  copies: Array<{ sourceId: string; caseId: string; displayId: string }>,
  reviewHash: string,
) {
  const sources = saved.map(
    ({ caseId: _case, displayId: _label, datasetId: _dataset, ...source }) =>
      source,
  );
  const sourceIds = new Set(sources.map((d) => d.sourceCaseId)),
    oldDatasets = new Set(sources.map((d) => d.sourceDatasetId)),
    newDatasets = new Set(saved.map((d) => d.datasetId));
  const map = new Map(copies.map((c) => [c.sourceId, c]));
  const allSourceCases = new Set(copies.map((c) => c.sourceId));
  if (
    copies.length > MAX_FOLDER_COPY_CASES ||
    map.size !== copies.length ||
    new Set(copies.map((c) => c.caseId)).size !== copies.length ||
    copies.some(
      (c) =>
        !c.sourceId ||
        c.sourceId.length > 200 ||
        !c.caseId ||
        c.caseId.length > 200 ||
        !c.displayId ||
        c.displayId.length > 200 ||
        allSourceCases.has(c.caseId),
    ) ||
    saved.length > MAX_FOLDER_COPY_CASES ||
    saved.reduce((sum, d) => sum + d.rowCount, 0) >
      MAX_FOLDER_COPY_DATASET_ROWS ||
    sourceIds.size !== saved.length ||
    oldDatasets.size !== saved.length ||
    newDatasets.size !== saved.length ||
    qualityProfileHash(sources) !== qualityProfileHash(expected) ||
    qualityProfileHash({ projectId, datasets: sources }) !== reviewHash ||
    saved.some((d) => {
      const c = map.get(d.sourceCaseId);
      return (
        !c ||
        c.caseId !== d.caseId ||
        c.displayId !== d.displayId ||
        allSourceCases.has(d.caseId) ||
        oldDatasets.has(d.datasetId) ||
        d.rows.length !== d.rowCount ||
        d.rows.some((row, index) => row.rowIndex !== index)
      );
    })
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Retained dataset copy mapping does not match the exact reviewed fresh identities. Nothing was recreated.",
    });
  return saved;
}
