import { createHash } from "node:crypto";
import {
  architectureCaseSchema,
  type ArchitectureCase,
} from "@vaettir/ai-agent";
import { readArchitectureDocument } from "./architectureDocument.js";

export const architectureCaseFingerprint = (c: ArchitectureCase) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        ...architectureCaseSchema.parse(c),
        displayId: undefined,
      }),
    )
    .digest("hex");

export function architectureAnalysisScope(
  projectId: string,
  fileName: string,
  content: string,
  cases: ArchitectureCase[],
) {
  const document = readArchitectureDocument(fileName, content);
  if (
    cases.length > 15000 ||
    new Set(cases.map((c) => c.id)).size !== cases.length
  )
    throw new Error(
      "Architecture analysis requires distinct cases within the supported inventory capacity.",
    );
  const definitions = cases.map((c) => architectureCaseSchema.parse(c));
  if (JSON.stringify(definitions).length > 16_000_000)
    throw new Error(
      "This complete case inventory exceeds analysis capacity. No cases were truncated.",
    );
  const batches: ArchitectureCase[][] = [],
    unprocessed: Array<{ caseId: string; reason: string }> = [];
  // Reserve room for the JSON envelope; do not let a large diagram turn a
  // supposedly valid approved batch into an over-capacity provider request.
  const caseCapacity = Math.min(
    60_000,
    259_000 - JSON.stringify(document.elements).length,
  );
  let batch: ArchitectureCase[] = [],
    size = 0;
  for (const c of definitions) {
    const length = JSON.stringify(c).length;
    if (length > caseCapacity) {
      unprocessed.push({
        caseId: c.id,
        reason:
          "Complete definition exceeds one analysis batch; no partial-text mapping was attempted.",
      });
      continue;
    }
    if (batch.length && (batch.length === 20 || size + length > caseCapacity)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(c);
    size += length;
  }
  if (batch.length) batches.push(batch);
  // The last batch proposes tests for elements without a defensible mapping.
  batches.push([]);
  const scopeHash = createHash("sha256")
    .update(
      JSON.stringify({
        protocol: "architecture-review/v1",
        projectId,
        documentHash: document.hash,
        format: document.format,
        elements: document.elements,
        definitions,
      }),
    )
    .digest("hex");
  return { document, definitions, batches, unprocessed, scopeHash };
}
