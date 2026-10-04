import { TRPCError } from "@trpc/server";
import {
  MAX_FOLDER_COPY_CASES,
  MAX_FOLDER_COPY_PREREQUISITES,
} from "./caseFolderCopySchema.js";

type Edge = { projectId: string; dependentId: string; prerequisiteId: string };
const refuse = (): never => {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      "This selection has external, cross-project, invalid or cyclic prerequisite relationships. Copy requires every endpoint inside the complete selected subtree; no references were omitted.",
  });
};
/** Only project-local selected identities leave this helper. Foreign endpoint
 * IDs are never projected into preview/error messages. */
export function reviewedInternalPrerequisites(
  projectId: string,
  selectedIds: string[],
  touching: Edge[],
) {
  const ids = new Set(selectedIds);
  if (
    ids.size !== selectedIds.length ||
    ids.size > MAX_FOLDER_COPY_CASES ||
    selectedIds.some((id) => !id || id.length > 200) ||
    touching.length > MAX_FOLDER_COPY_PREREQUISITES
  )
    refuse();
  const pairs = new Set<string>();
  const indegrees = new Map(selectedIds.map((id) => [id, 0]));
  const next = new Map<string, string[]>();
  for (const edge of touching) {
    if (
      edge.projectId !== projectId ||
      !ids.has(edge.dependentId) ||
      !ids.has(edge.prerequisiteId) ||
      edge.dependentId === edge.prerequisiteId ||
      edge.dependentId.length > 200 ||
      edge.prerequisiteId.length > 200
    )
      refuse();
    const pair = JSON.stringify([edge.dependentId, edge.prerequisiteId]);
    if (pairs.has(pair)) refuse();
    pairs.add(pair);
    next.set(edge.dependentId, [
      ...(next.get(edge.dependentId) ?? []),
      edge.prerequisiteId,
    ]);
    indegrees.set(edge.prerequisiteId, indegrees.get(edge.prerequisiteId)! + 1);
  }
  const queue = [...indegrees]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.pop()!;
    visited++;
    for (const child of next.get(id) ?? []) {
      const degree = indegrees.get(child)! - 1;
      indegrees.set(child, degree);
      if (!degree) queue.push(child);
    }
  }
  if (visited !== selectedIds.length) refuse();
  return touching
    .map(({ dependentId, prerequisiteId }) => ({ dependentId, prerequisiteId }))
    .sort((a, b) =>
      a.dependentId < b.dependentId
        ? -1
        : a.dependentId > b.dependentId
          ? 1
          : a.prerequisiteId < b.prerequisiteId
            ? -1
            : a.prerequisiteId > b.prerequisiteId
              ? 1
              : 0,
    );
}
