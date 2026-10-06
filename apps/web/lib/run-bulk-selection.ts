import { MAX_MANUAL_CASES } from "./run-configuration-request.ts";
export type RunBulkSelectionMode = "SET" | "ADD" | "REMOVE";
export type RunBulkScope = { key: string; label: string; testCaseIds: readonly string[] };

/** Operates only on caller-supplied, already approved loaded scopes. It never
 * fetches cases, infers selection from navigation, or returns partial overflow. */
export function applyRunBulkSelection(current: readonly string[], candidates: readonly string[], mode: RunBulkSelectionMode):
  { ok: true; ids: string[]; before: number; matched: number; added: number; removed: number; after: number } |
  { ok: false; error: string } {
  if (!["SET", "ADD", "REMOVE"].includes(mode) || [...current, ...candidates].some(id => typeof id !== "string" || !id || id.length > 200)) {
    return { ok: false, error: "The selection scope contains an unsupported case identity or operation. Nothing was changed." };
  }
  const before = new Set(current), matching = new Set(candidates);
  if (before.size !== current.length) return { ok: false, error: "The current selection contains duplicate identities. Review the selected cases before changing the scope." };
  const next = mode === "SET" ? [...matching] : mode === "ADD" ? [...before, ...[...matching].filter(id => !before.has(id))] : [...before].filter(id => !matching.has(id));
  if (next.length > MAX_MANUAL_CASES) return { ok: false, error: `This operation would select ${next.length.toLocaleString("en-US")} cases. A run supports up to 1,000 cases including required prerequisites. Narrow or split the scope; nothing was partially selected.` };
  const remaining = new Set(next);
  return { ok: true, ids: next, before: before.size, matched: matching.size, added: next.filter(id => !before.has(id)).length, removed: [...before].filter(id => !remaining.has(id)).length, after: next.length };
}
