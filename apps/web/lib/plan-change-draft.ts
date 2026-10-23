import { finitePlanNumber, planCustomFields, type PlanCustomField } from "./plan-custom-fields";
import { caseFieldPresentationJsonBytes } from "@vaettir/api/src/services/caseFieldPresentationSchema";
export type PlanStatus = "DRAFT" | "ACTIVE" | "IN_REVIEW" | "APPROVED" | "ARCHIVED";
export type PlanMetadataValue = string | number | boolean | string[];
export type PlanMetadataChange = { operation: "SET"; key: string; value: PlanMetadataValue } | { operation: "REMOVE"; key: string };
export type PlanMetadataDraft = { changes: PlanMetadataChange[]; numberBuffers: Record<string, string>; rendererError?: string };
export const emptyPlanMetadataDraft = (): PlanMetadataDraft => ({ changes: [], numberBuffers: {} });
/** Freeze only a separately cloned supported JSON graph, never the live draft
 * or QueryClient body. Hooks/cycles/deep structures refuse before cloning. */
export function freezePlanChangeJson<T>(body: T): T {
  caseFieldPresentationJsonBytes(body);
  const copy = structuredClone(body);
  const freeze = (value: unknown) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(copy); return copy;
}
export const planMetadataObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nativeText = (value: string) => !value.includes("\0") && Array.from(value).every(char => { const point = char.codePointAt(0)!; return point < 0xd800 || point > 0xdfff; });
const safeKey = (key: string) => key.length > 0 && key.length <= 200 && nativeText(key) && !["__proto__", "constructor", "prototype"].includes(key);
export function governedPlanFields(schema: unknown, raw: unknown): PlanCustomField[] {
  if (!planMetadataObject(raw)) return [];
  return planCustomFields(schema, raw).map(field => safeKey(field.key) ? field : { ...field, kind: "retained", reason: "This saved key is retained read-only. It is not an editable governed metadata key." });
}
export function reviewedPlanStatus(before: PlanStatus, status: PlanStatus, intent: "CHANGE" | "REOPEN") {
  if (status === before) throw Error("Choose a different reviewed planning status.");
  const frozen = before === "APPROVED" || before === "ARCHIVED";
  if (frozen ? intent !== "REOPEN" || status !== "DRAFT" : intent !== "CHANGE")
    throw Error("An approved or archived plan requires an explicit Reopen to draft intent.");
  return { expectedStatus: before, status, intent };
}
export function replacePlanMetadataChange(draft: PlanMetadataDraft, change: PlanMetadataChange): PlanMetadataDraft {
  const at = draft.changes.findIndex(old => old.key === change.key), changes = [...draft.changes];
  if (at < 0) changes.push(change); else changes[at] = change;
  return { ...draft, changes };
}
export function leavePlanMetadataUnchanged(draft: PlanMetadataDraft, key: string): PlanMetadataDraft {
  const numberBuffers = { ...draft.numberBuffers }; delete numberBuffers[key];
  return { changes: draft.changes.filter(change => change.key !== key), numberBuffers };
}
export function setPlanMetadataNumber(draft: PlanMetadataDraft, key: string, text: string): PlanMetadataDraft {
  const parsed = finitePlanNumber(text), next = { ...draft, numberBuffers: { ...draft.numberBuffers, [key]: text } };
  return parsed === null ? next : replacePlanMetadataChange(next, { operation: "SET", key, value: parsed });
}
export function removePlanMetadataValue(draft: PlanMetadataDraft, key: string): PlanMetadataDraft {
  return replacePlanMetadataChange(leavePlanMetadataUnchanged(draft, key), { operation: "REMOVE", key });
}
export function planMetadataDraftValue(field: PlanCustomField, draft: PlanMetadataDraft) {
  const change = draft.changes.find(entry => entry.key === field.key);
  return change ? change.operation === "REMOVE" ? { present: false, value: undefined } : { present: true, value: change.value } : { present: field.present, value: field.value };
}
export function projectedPlanMetadataValues(raw: unknown, draft: PlanMetadataDraft): Record<string, unknown> {
  if (!planMetadataObject(raw)) throw Error("The retained native metadata root is not an object.");
  const values = { ...raw };
  for (const change of draft.changes) { if (change.operation === "REMOVE") delete values[change.key]; else Object.defineProperty(values, change.key, { value: change.value, enumerable: true, writable: true, configurable: true }); }
  return values;
}
/** Specialized QA list renderer retains useful scoped suggestions. Its whole
 * draft echo is diffed locally; only declared supported string-list operations
 * can enter this path, not metadata replacement or hidden numeric buffers. */
export function planMetadataListRendererChanges(schema: unknown, raw: unknown, draft: PlanMetadataDraft, proposed: unknown): PlanMetadataDraft {
  if (!planMetadataObject(proposed)) throw Error("The specialized renderer must retain the complete object draft.");
  const current = projectedPlanMetadataValues(raw, draft), fields = new Map(governedPlanFields(schema, raw).map(field => [field.key, field]));
  const { rendererError: _oldError, ...clean } = draft;
  let result: PlanMetadataDraft = clean;
  for (const key of new Set([...Object.keys(current), ...Object.keys(proposed)])) {
    const currentPresent = Object.hasOwn(current, key), nextPresent = Object.hasOwn(proposed, key);
    if (currentPresent === nextPresent && (!currentPresent || sameValue(current[key], proposed[key]))) continue;
    const field = fields.get(key);
    if (!field || field.kind !== "string-array") throw Error("The specialized renderer cannot replace retained, undeclared or non-list metadata.");
    result = !nextPresent ? field.present ? removePlanMetadataValue(result, key) : leavePlanMetadataUnchanged(result, key)
      : replacePlanMetadataChange(result, { operation: "SET", key, value: proposed[key] as string[] });
  }
  reviewedPlanMetadataChanges(schema, raw, result);
  return result;
}
function sameValue(left: unknown, right: unknown) { return Array.isArray(left) && Array.isArray(right) ? left.length === right.length && left.every((entry, index) => entry === right[index]) : left === right; }
/** Payload contains selected operations only. No full-record resend/defaults;
 * unsupported/null/unknown siblings remain outside this edit protocol. */
export function reviewedPlanMetadataChanges(schema: unknown, raw: unknown, draft: PlanMetadataDraft): PlanMetadataChange[] {
  if (draft.rendererError) throw Error(draft.rendererError);
  if (!planMetadataObject(raw)) throw Error("The native metadata root is not an editable object. It remains unchanged.");
  const fields = governedPlanFields(schema, raw), byKey = new Map(fields.map(field => [field.key, field]));
  for (const [key, text] of Object.entries(draft.numberBuffers)) if (finitePlanNumber(text) === null) throw Error(`Enter a finite number for ${key} or explicitly leave/remove that field. The old value will not be saved.`);
  if (draft.changes.length > 50 || new Set(draft.changes.map(change => change.key)).size !== draft.changes.length) throw Error("Review at most 50 unique declared field changes.");
  const changes: PlanMetadataChange[] = [];
  for (const change of draft.changes) {
    const field = byKey.get(change.key);
    if (!field || field.kind === "retained" || !safeKey(change.key)) throw Error("A selected field is undeclared, unsupported or contains retained incompatible data.");
    if (change.operation === "REMOVE") {
      if (!field.present) throw Error(`There is no saved value to remove for ${change.key}.`);
      changes.push(change); continue;
    }
    const value = change.value;
    const valid = field.kind === "string" ? typeof value === "string" && value.length <= 40000 && nativeText(value)
      : field.kind === "number" ? typeof value === "number" && Number.isFinite(value)
        : field.kind === "boolean" ? typeof value === "boolean"
          : Array.isArray(value) && value.length <= 500 && value.every(row => typeof row === "string" && row.length <= 10000 && nativeText(row));
    if (!valid) throw Error(`The reviewed value for ${change.key} is outside its supported native type or size.`);
    if (!field.present || !sameValue(value, field.value)) changes.push(change);
  }
  // Reuse the browser-safe JSONB visitor (including expanded finite exponent
  // widths). Measure operations incrementally, without encoding a huge patch.
  let bytes = 2;
  for (const change of changes) {
    bytes += 2 + caseFieldPresentationJsonBytes(change);
    if (bytes > 64 * 1024) throw Error("The complete reviewed metadata patch exceeds its 64 KiB bound. No subset was selected.");
  }
  return changes;
}
