import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  placementReadScopeSchema,
  placementMoveInput,
  placementPreviewInput,
  placementMetadata,
} from "./casePlacementReviewedWireSchema.js";
export * from "./casePlacementReviewedWireSchema.js";
export const placementDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function placementMoveRequestHash(
  raw: z.input<typeof placementMoveInput>,
) {
  return placementDigest([
    "CasePlacementReviewedMove/v1",
    placementMoveInput.parse(raw),
  ]);
}
export function placementCohortHash(
  scope: z.infer<typeof placementReadScopeSchema>,
  intent: Pick<
    z.infer<typeof placementPreviewInput>,
    | "caseId"
    | "expectedSuitePath"
    | "expectedSortPosition"
    | "targetSuitePath"
    | "beforeCaseId"
  >,
  rows: readonly z.infer<typeof placementMetadata>[],
) {
  return placementDigest([
    "CasePlacementReviewedCohort/v1",
    scope,
    intent.caseId,
    intent.expectedSuitePath,
    intent.expectedSortPosition,
    intent.targetSuitePath,
    intent.beforeCaseId,
    rows,
  ]);
}
/** Metadata is already ordered by native sortPosition, createdAt and id. */
export function reviewedPlacementOrders(
  rows: readonly z.infer<typeof placementMetadata>[],
  input: Pick<
    z.infer<typeof placementMoveInput>,
    "caseId" | "expectedSuitePath" | "targetSuitePath" | "beforeCaseId"
  >,
) {
  const moving = rows.find((row) => row.id === input.caseId);
  if (
    !moving ||
    moving.suitePath !== input.expectedSuitePath ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw Error("Unsupported placement cohort");
  const source = rows.filter(
      (row) =>
        row.suitePath === input.expectedSuitePath && row.id !== input.caseId,
    ),
    target =
      input.expectedSuitePath === input.targetSuitePath
        ? source
        : rows.filter((row) => row.suitePath === input.targetSuitePath);
  if (source.length + 1 > 2000 || target.length >= 2000 || rows.length > 4000)
    throw Error("Unsupported placement cohort");
  const index =
    input.beforeCaseId === null
      ? target.length
      : target.findIndex((row) => row.id === input.beforeCaseId);
  if (index < 0) throw Error("Changed placement anchor");
  const inserted = [...target];
  inserted.splice(index, 0, moving);
  const changes = new Map<
    string,
    { suitePath: string | null; sortPosition: number }
  >();
  if (input.expectedSuitePath !== input.targetSuitePath)
    source.forEach((row, position) =>
      changes.set(row.id, {
        suitePath: input.expectedSuitePath,
        sortPosition: position,
      }),
    );
  inserted.forEach((row, position) =>
    changes.set(row.id, {
      suitePath: input.targetSuitePath,
      sortPosition: position,
    }),
  );
  return {
    index,
    after: rows.map((row) => ({ ...row, ...changes.get(row.id) })),
  };
}
