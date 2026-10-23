export type ComparedProcedureStep = {
  order: number;
  action: string;
  expectedActionOrData: string | null;
  expectedResult: string | null;
  expectedResponse: string | null;
  mediaAttachmentIds: string[];
};
const keys = [
  "order",
  "action",
  "expectedActionOrData",
  "expectedResult",
  "expectedResponse",
  "mediaAttachmentIds",
] as const;

/** Presentation only. Never sorts, normalizes, drops unsupported rows, writes
 * records or fetches media. A null result keeps the complete raw comparison. */
export function readComparedProcedureSteps(
  serialized: string,
): ComparedProcedureStep[] | null {
  if (
    serialized.length > 2 * 1024 * 1024 ||
    new TextEncoder().encode(serialized).byteLength > 2 * 1024 * 1024
  )
    return null;
  let rows: unknown;
  try {
    rows = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length > 500) return null;
  let priorOrder = -1;
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return null;
    const row = candidate as Record<string, unknown>;
    if (
      Object.keys(row).length !== keys.length ||
      keys.some((key) => !Object.prototype.hasOwnProperty.call(row, key))
    )
      return null;
    if (
      typeof row.order !== "number" ||
      !Number.isSafeInteger(row.order) ||
      row.order < 0 ||
      row.order <= priorOrder
    )
      return null;
    if (typeof row.action !== "string" || row.action.length > 100000)
      return null;
    for (const key of [
      "expectedActionOrData",
      "expectedResult",
      "expectedResponse",
    ] as const) {
      const expected = row[key];
      if (
        expected !== null &&
        (typeof expected !== "string" || expected.length > 100000)
      )
        return null;
    }
    if (
      !Array.isArray(row.mediaAttachmentIds) ||
      row.mediaAttachmentIds.length > 100 ||
      row.mediaAttachmentIds.some(
        (value) =>
          typeof value !== "string" || value.length < 1 || value.length > 200,
      ) ||
      new Set(row.mediaAttachmentIds).size !== row.mediaAttachmentIds.length
    )
      return null;
    priorOrder = row.order;
  }
  return rows as ComparedProcedureStep[];
}
