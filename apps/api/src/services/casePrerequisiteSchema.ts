import { createHash } from "node:crypto";
import { z } from "zod";
import { caseFieldReadScopeSchema, caseFieldReadPinFields, pairedCaseFieldReadPins } from "./caseFieldReadScope.js";

const id = z.string().min(1).max(200).refine(value => !value.includes("\0"));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const prerequisiteAccessInput = z.object({ projectId: id, caseId: id, readRequestId: z.string().uuid(), ...caseFieldReadPinFields, expectedActorId: id.optional() }).strict().superRefine((value, ctx) => {
  pairedCaseFieldReadPins(value, ctx);
  if (value.expectedActorId !== undefined && value.originalOrganizationId === undefined) ctx.addIssue({ code: "custom", message: "Native actor pins require the original organization and Clerk actor." });
});
const pinned = z.object({ projectId: id, caseId: id, originalOrganizationId: id, expectedClerkActorId: id, expectedActorId: id });
export const prerequisitePageInput = pinned.extend({ readRequestId: z.string().uuid(), search: z.string().max(200), sort: z.enum(["case-id", "title", "inventory"]), cursor: z.object({ offset: z.number().int().min(0).max(1000000), populationHash: hash, graphHash: hash }).strict().optional() }).strict();
const ids = z.array(id).max(50).refine(value => new Set(value).size === value.length, "Prerequisite IDs must be unique.");
export const prerequisiteSetInput = pinned.extend({ requestId: z.string().uuid(), expectedGraphHash: hash, expectedPrerequisiteIds: ids, prerequisiteIds: ids, confirmed: z.literal(true) }).strict().refine(value => !value.prerequisiteIds.includes(value.caseId), "A case cannot require itself.");
export const prerequisiteAccessOutput = z.object({ projectId: id, caseId: id, readRequestId: z.string().uuid(), readScope: caseFieldReadScopeSchema, canEdit: z.boolean() }).strict();
export const prerequisiteCaseMetadata = z.object({ id, displayId: z.string().max(200).nullable(), title: z.string().max(2000).nullable(), reviewStatus: z.string().max(100).nullable(), archived: z.boolean().nullable(), unavailable: z.boolean() }).strict();
export const prerequisitePageOutput = prerequisiteAccessOutput.extend({ graphHash: hash, prerequisiteIds: ids, linked: z.array(prerequisiteCaseMetadata).max(50), items: z.array(prerequisiteCaseMetadata).max(20), total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), populationHash: hash, nextCursor: prerequisitePageInput.shape.cursor.unwrap().nullable() }).strict();
export const prerequisiteSetOutput = z.object({ projectId: id, caseId: id, organizationId: id, actorId: id, actorClerkUserId: id, requestId: z.string().uuid(), requestHash: hash, prerequisiteIds: ids, replayed: z.boolean() }).strict();
export type PrerequisiteEdge = { dependentId: string; prerequisiteId: string };
export function prerequisiteDigest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function prerequisiteRequestHash(input: z.infer<typeof prerequisiteSetInput>) { return prerequisiteDigest(prerequisiteSetInput.parse(input)); }
export function prerequisiteGraphHash(projectId: string, edges: readonly PrerequisiteEdge[]) {
  return prerequisiteDigest({ kind: "CasePrerequisiteGraph/v1", projectId, edges: [...edges].sort((a, b) => a.dependentId < b.dependentId ? -1 : a.dependentId > b.dependentId ? 1 : a.prerequisiteId < b.prerequisiteId ? -1 : a.prerequisiteId > b.prerequisiteId ? 1 : 0) });
}
export function samePrerequisiteSet(a: readonly string[], b: readonly string[]) { return a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every(value => b.includes(value)); }
/** Complete stored graph, including retained archived/unavailable references.
 * Only the outgoing edge set for the edited case is replaced. */
export function reviewedPrerequisiteGraph(edges: readonly PrerequisiteEdge[], caseId: string, next: readonly string[]) {
  if (edges.length > 10000) throw Error("The saved prerequisite graph exceeds the supported 10,000-edge bound.");
  const result = edges.filter(edge => edge.dependentId !== caseId).concat(next.map(prerequisiteId => ({ dependentId: caseId, prerequisiteId })));
  if (result.length > 10000) throw Error("The resulting prerequisite graph exceeds the supported 10,000-edge bound.");
  const adjacency = new Map<string, string[]>(), indegree = new Map<string, number>();
  for (const edge of result) {
    indegree.set(edge.dependentId, indegree.get(edge.dependentId) ?? 0);
    indegree.set(edge.prerequisiteId, (indegree.get(edge.prerequisiteId) ?? 0) + 1);
    adjacency.set(edge.dependentId, [...(adjacency.get(edge.dependentId) ?? []), edge.prerequisiteId]);
  }
  const ready = [...indegree].filter(([, count]) => !count).map(([node]) => node); let processed = 0;
  while (ready.length) { const node = ready.pop()!; processed++; for (const prior of adjacency.get(node) ?? []) { const count = indegree.get(prior)! - 1; indegree.set(prior, count); if (!count) ready.push(prior); } }
  if (processed !== indegree.size) throw Error("Prerequisites cannot form a cycle. Retained graph links were not discarded.");
  const closure = new Set<string>(), todo = [caseId];
  while (todo.length) { const node = todo.pop()!; if (closure.has(node)) continue; closure.add(node); if (closure.size > 1000) throw Error("This case's prerequisite closure exceeds the existing 1,000-case manual-run bound."); todo.push(...(adjacency.get(node) ?? [])); }
  return result;
}
