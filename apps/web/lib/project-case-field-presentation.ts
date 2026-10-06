import type { caseFieldPresentationStateOutput, caseFieldPresentationConfigureInput } from "@vaettir/api/src/services/caseFieldPresentation";
import { caseFieldPresentationJsonBytes, caseFieldPresentationWriteProblems, type CaseFieldPresentation, type CaseFieldPresentationSetting } from "@vaettir/api/src/services/caseFieldPresentationSchema";
import type { CaseFieldDefinition } from "@vaettir/api/src/services/caseFieldSchema";
import { sameCaseFieldOrigin, type CaseFieldOrigin } from "./case-field-origin";
import { retainedTraceabilityReceipt } from "./traceability-receipt";

export type FieldPresentationState = ReturnType<typeof caseFieldPresentationStateOutput.parse>;
export type FieldPresentationInput = ReturnType<typeof caseFieldPresentationConfigureInput.parse>;
export type FieldPresentationFrame = { ready: boolean; open: boolean; epoch: number; origin: CaseFieldOrigin | null; sessionId: string | null };
export type FieldPresentationReceipt = { input: FieldPresentationInput; origin: CaseFieldOrigin; sessionId: string; uncertain: boolean };
export type FieldPresentationDraft = { baseline: FieldPresentationState; configuration: CaseFieldPresentation };
export function fieldPresentationWidgets(field: CaseFieldDefinition): CaseFieldPresentationSetting["widget"][] {
  return field.type === "TEXT" ? ["AUTO", "TEXT_INPUT", "PARAGRAPH"] : field.type === "CHOICE" ? ["AUTO", "DROPDOWN", "RADIO"] : field.type === "BOOLEAN" ? ["AUTO", "TRI_STATE", "CHECKBOX"] : ["AUTO"];
}
export function initialFieldPresentationDraft(state: FieldPresentationState): FieldPresentationDraft | null {
  if (!state.definitionSupported || !state.definitionSchema || !state.configurationSupported) return null;
  // Genuine absence is a local unsaved draft, not a fabricated saved default.
  const configuration = state.configuration ?? { version: 1 as const, fields: {} };
  if (caseFieldPresentationWriteProblems(configuration, state.definitionSchema.fields, state.configuration).length) return null;
  caseFieldPresentationJsonBytes(configuration);
  return { baseline: state, configuration: structuredClone(configuration) };
}
export function changeFieldPresentation(draft: FieldPresentationDraft, key: string, setting: CaseFieldPresentationSetting | null): FieldPresentationDraft {
  const definitions = draft.baseline.definitionSchema?.fields;
  if (!definitions?.some(field => field.key === key && !field.retired)) throw Error("Unknown or retired settings remain read-only.");
  const fields = { ...draft.configuration.fields };
  if (setting === null) delete fields[key]; else fields[key] = { ...setting };
  const configuration = { ...draft.configuration, fields };
  const problems = caseFieldPresentationWriteProblems(configuration, definitions, draft.baseline.configuration);
  if (problems.length) throw Error(problems.join(" "));
  return { ...draft, configuration };
}
function freezeJson<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freezeJson(child); Object.freeze(value); }
  return value;
}
export function freezeFieldPresentationRequest(draft: FieldPresentationDraft, origin: CaseFieldOrigin, reason: string, requestId: string): FieldPresentationInput {
  const state = draft.baseline;
  if (!state.canConfigure || !state.definitionSupported || !state.configurationSupported || !state.definitionSchema || state.projectId !== origin.projectId || state.organizationId !== origin.organizationId || state.readScope.actorClerkUserId !== origin.clerkActorId) throw Error("The reviewed native scope is not configurable.");
  const problems = caseFieldPresentationWriteProblems(draft.configuration, state.definitionSchema.fields, state.configuration);
  if (problems.length) throw Error(problems.join(" "));
  if (!reason.trim() || reason.trim().length > 1000 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw Error("A reviewed reason and exact request UUID are required.");
  return freezeJson({ projectId: origin.projectId, originalOrganizationId: origin.organizationId, expectedClerkActorId: origin.clerkActorId, expectedProfileHash: state.profileHash, expectedFieldSchemaHash: state.fieldSchemaHash, configuration: structuredClone(draft.configuration), reason: reason.trim(), confirmed: true, requestId });
}
export function assertFieldPresentationAck(result: unknown, receipt: FieldPresentationReceipt) {
  if (!result || typeof result !== "object") throw Error("Presentation acknowledgement is missing; retain the identical request.");
  const value = result as Record<string, unknown>;
  if (value.projectId !== receipt.origin.projectId || value.organizationId !== receipt.origin.organizationId || value.actorClerkUserId !== receipt.origin.clerkActorId || value.requestId !== receipt.input.requestId || typeof value.replayed !== "boolean") throw Error("Presentation acknowledgement did not match the original scoped request. Retry that exact request.");
}
export function retainedFieldPresentationReceipt(receipt: FieldPresentationReceipt, cause: unknown): FieldPresentationReceipt | null {
  const held = retainedTraceabilityReceipt(receipt, cause);
  return held ? { ...receipt, uncertain: held.uncertain } : null;
}
export function sameFieldPresentationFrame(original: FieldPresentationFrame, current: FieldPresentationFrame): boolean {
  return original.ready && current.ready && original.open && current.open && original.epoch === current.epoch && !!original.sessionId && original.sessionId === current.sessionId && sameCaseFieldOrigin(original.origin, current.origin);
}
export function currentFieldPresentationBaseline(draft: FieldPresentationDraft, fresh: FieldPresentationState | undefined): boolean {
  return !!fresh && fresh.canConfigure && fresh.definitionSupported && fresh.configurationSupported && draft.baseline.profileHash === fresh.profileHash && draft.baseline.fieldSchemaHash === fresh.fieldSchemaHash && draft.baseline.definitionSchemaVersion === fresh.definitionSchemaVersion;
}
