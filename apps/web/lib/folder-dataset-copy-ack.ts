export type FolderDatasetSource = {
  sourceCaseId: string;
  sourceDatasetId: string;
  sourceRevisionHash: string;
  contentHash: string;
  parameterCount: number;
  rowCount: number;
  rows: Array<{ rowIndex: number; name: string }>;
};
type Request = {
  projectId: string;
  copyParameterDatasets?: true;
  expectedDatasetHash?: string;
  expectedDatasets?: FolderDatasetSource[];
};
type Receipt = {
  copyParameterDatasets?: boolean;
  datasetReviewHash?: string | null;
  copies: Array<{ sourceId: string; caseId: string; displayId: string }>;
  copiedDatasets?: Array<
    FolderDatasetSource & {
      caseId: string;
      displayId: string;
      datasetId: string;
    }
  >;
};
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;
const hash = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
/** Receipt validates the approved historical mapping, not later current edits.
 * Never consume an uncertain request when WebCrypto/identity proof is absent. */
export async function verifiedFolderDatasetAck(
  input: Request,
  result: Receipt,
): Promise<boolean> {
  const saved = result.copiedDatasets ?? [];
  if (!Array.isArray(saved)) return false;
  if (!input.copyParameterDatasets)
    return (
      result.copyParameterDatasets !== true &&
      !saved.length &&
      !result.datasetReviewHash
    );
  if (
    result.copyParameterDatasets !== true ||
    !id(input.projectId) ||
    !Array.isArray(input.expectedDatasets) ||
    !hash(input.expectedDatasetHash) ||
    result.datasetReviewHash !== input.expectedDatasetHash ||
    saved.length > 50 ||
    input.expectedDatasets.length > 50 ||
    saved.length !== input.expectedDatasets.length ||
    !Array.isArray(result.copies) ||
    result.copies.length > 50 ||
    result.copies.some((c) => !c || typeof c !== "object") ||
    saved.some((d) => !d || typeof d !== "object")
  )
    return false;
  const map = new Map(result.copies.map((c) => [c.sourceId, c])),
    oldCaseIds = new Set(result.copies.map((c) => c.sourceId)),
    newCaseIds = new Set(result.copies.map((c) => c.caseId));
  if (
    map.size !== result.copies.length ||
    newCaseIds.size !== result.copies.length ||
    result.copies.some(
      (c) =>
        !id(c.sourceId) ||
        !id(c.caseId) ||
        !id(c.displayId) ||
        oldCaseIds.has(c.caseId),
    )
  )
    return false;
  const oldDatasetIds = new Set(saved.map((d) => d.sourceDatasetId)),
    newDatasetIds = new Set(saved.map((d) => d.datasetId));
  if (
    oldDatasetIds.size !== saved.length ||
    newDatasetIds.size !== saved.length ||
    new Set(saved.map((d) => d.sourceCaseId)).size !== saved.length
  )
    return false;
  let rows = 0;
  const sources: FolderDatasetSource[] = [];
  for (const d of saved) {
    const c = map.get(d.sourceCaseId);
    if (
      !c ||
      !id(d.sourceDatasetId) ||
      !id(d.datasetId) ||
      d.caseId !== c.caseId ||
      d.displayId !== c.displayId ||
      oldDatasetIds.has(d.datasetId) ||
      !hash(d.contentHash) ||
      !hash(d.sourceRevisionHash) ||
      !Number.isInteger(d.rowCount) ||
      d.rowCount < 1 ||
      d.rowCount > 50 ||
      !Number.isInteger(d.parameterCount) ||
      d.parameterCount < 1 ||
      d.parameterCount > 50 ||
      !Array.isArray(d.rows) ||
      d.rows.length !== d.rowCount ||
      d.rows.some(
        (row, index) => !row || row.rowIndex !== index || !id(row.name),
      )
    )
      return false;
    rows += d.rowCount;
    if (rows > 500) return false;
    sources.push({
      sourceCaseId: d.sourceCaseId,
      sourceDatasetId: d.sourceDatasetId,
      sourceRevisionHash: d.sourceRevisionHash,
      contentHash: d.contentHash,
      parameterCount: d.parameterCount,
      rowCount: d.rowCount,
      rows: d.rows,
    });
  }
  if (canonicalJson(sources) !== canonicalJson(input.expectedDatasets))
    return false;
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        canonicalJson({ projectId: input.projectId, datasets: sources }),
      ),
    );
    return (
      Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("") === input.expectedDatasetHash
    );
  } catch {
    return false;
  }
}
