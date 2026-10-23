type Pair = { dependentId: string; prerequisiteId: string };
type Input = {
  projectId: string;
  copyInternalPrerequisites?: true;
  expectedPrerequisiteHash?: string;
  expectedInternalPrerequisites?: Pair[];
};
type Result = {
  copyInternalPrerequisites?: boolean;
  prerequisiteReviewHash?: string | null;
  copies: Array<{ sourceId: string; caseId: string; displayId: string }>;
  copiedPrerequisites?: Array<{
    sourceDependentId: string;
    sourcePrerequisiteId: string;
    sourceDependentDisplayId: string;
    sourcePrerequisiteDisplayId: string;
    dependentId: string;
    prerequisiteId: string;
    dependentDisplayId: string;
    prerequisiteDisplayId: string;
  }>;
};
const id = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;
const canonicalPairs = (pairs: Pair[]) =>
  pairs
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
/** Bounded receipt validation, not a claim the historical links are still current.
 * The original scoped UUID/input must remain retained if validation is unavailable. */
export async function verifiedFolderPrerequisiteAck(
  input: Input,
  result: Result,
): Promise<boolean> {
  const edges = result.copiedPrerequisites ?? [];
  if (!input.copyInternalPrerequisites)
    return (
      result.copyInternalPrerequisites !== true &&
      !edges.length &&
      !result.prerequisiteReviewHash
    );
  if (
    !result.copyInternalPrerequisites ||
    !input.expectedInternalPrerequisites ||
    !input.expectedPrerequisiteHash ||
    result.prerequisiteReviewHash !== input.expectedPrerequisiteHash ||
    edges.length > 2500 ||
    input.expectedInternalPrerequisites.length > 2500 ||
    result.copies.length > 50 ||
    edges.length !== input.expectedInternalPrerequisites.length
  )
    return false;
  const sourceIds = new Set(result.copies.map((c) => c.sourceId)),
    copiedIds = new Set(result.copies.map((c) => c.caseId));
  if (
    sourceIds.size !== result.copies.length ||
    copiedIds.size !== result.copies.length ||
    result.copies.some(
      (c) =>
        !id(c.sourceId) ||
        !id(c.caseId) ||
        !id(c.displayId) ||
        sourceIds.has(c.caseId),
    )
  )
    return false;
  const map = new Map(result.copies.map((c) => [c.sourceId, c]));
  const pairs: Pair[] = [];
  for (const edge of edges) {
    if (!Object.values(edge).every(id)) return false;
    const dependent = map.get(edge.sourceDependentId),
      prerequisite = map.get(edge.sourcePrerequisiteId);
    if (
      !dependent ||
      !prerequisite ||
      edge.dependentId === edge.prerequisiteId ||
      dependent.caseId !== edge.dependentId ||
      prerequisite.caseId !== edge.prerequisiteId ||
      dependent.displayId !== edge.dependentDisplayId ||
      prerequisite.displayId !== edge.prerequisiteDisplayId
    )
      return false;
    pairs.push({
      dependentId: edge.sourceDependentId,
      prerequisiteId: edge.sourcePrerequisiteId,
    });
  }
  const canonical = canonicalPairs(pairs);
  if (
    new Set(canonical.map((e) => JSON.stringify(e))).size !==
      canonical.length ||
    JSON.stringify(canonical) !==
      JSON.stringify(input.expectedInternalPrerequisites)
  )
    return false;
  // Match server qualityProfileHash's canonical key order without importing
  // its Node/database dependencies into the browser.
  try {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ edges: canonical, projectId: input.projectId }),
    );
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    return hash === input.expectedPrerequisiteHash;
  } catch {
    return false;
  }
}
