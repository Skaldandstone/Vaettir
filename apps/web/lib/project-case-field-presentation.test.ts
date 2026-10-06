import { describe, expect, it } from "vitest";
import { fieldPresentationWidgets, initialFieldPresentationDraft, changeFieldPresentation, freezeFieldPresentationRequest, assertFieldPresentationAck, retainedFieldPresentationReceipt, sameFieldPresentationFrame, currentFieldPresentationBaseline, fieldPresentationSessionRead, sameFieldPresentationSessionProof, type FieldPresentationState, type FieldPresentationReceipt } from "./project-case-field-presentation";
import { resolveCaseFieldPresentation } from "@vaettir/api/src/services/caseFieldPresentationSchema";
const origin = { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-actor", caseId: null };
const id = "aa7d600c-453d-4c57-850c-1133f518b81d";
function state(): FieldPresentationState {
  return { ...origin, caseId: null, readScope: { projectId: origin.projectId, organizationId: origin.organizationId, actorId: "synthetic-native", actorClerkUserId: origin.clerkActorId }, profileHash: "a".repeat(64), fieldSchemaHash: "b".repeat(64), fieldAuthoringSchemaHash: "c".repeat(64), definitionSchemaVersion: 3, definitionSupported: true, configurationSupported: true, canConfigure: true, warnings: [], definitionSchema: { version: 1, fields: [ { key: "notes", label: " Exact native label ", type: "TEXT", required: false, retired: false, options: [] }, { key: "retained", label: "Retired", type: "BOOLEAN", required: false, retired: true, options: [] } ] }, configuration: { version: 1, fields: { notes: { widget: "PARAGRAPH", placeholder: "  exact, text\n", visibility: "HIDE_WHEN_EMPTY" }, retained: { widget: "CHECKBOX" }, unknown: { widget: "AUTO", placeholder: "" } } } };
}
function receipt(): FieldPresentationReceipt {
  return { input: freezeFieldPresentationRequest(initialFieldPresentationDraft(state())!, origin, " explicit review ", id), origin, sessionId: "synthetic-session", uncertain: false };
}
describe("custom field presentation draft and receipt", () => {
  it("retains exact raw native labels, empty settings, unknown and retired siblings through an unrelated change", () => {
    const native = state(), draft = initialFieldPresentationDraft(native)!;
    expect(draft.baseline.definitionSchema!.fields[0]!.label).toBe(" Exact native label ");
    const next = changeFieldPresentation(draft, "notes", { ...draft.configuration.fields.notes!, widget: "TEXT_INPUT" });
    expect(next.configuration.fields.retained).toEqual(native.configuration!.fields.retained);
    expect(next.configuration.fields.unknown).toEqual(native.configuration!.fields.unknown);
    expect(next.configuration.fields.notes!.placeholder).toBe("  exact, text\n");
    expect(native.configuration!.fields.notes!.widget).toBe("PARAGRAPH");
    expect(() => changeFieldPresentation(next, "retained", null)).toThrow(/read-only/);
    expect(() => changeFieldPresentation(next, "unknown", null)).toThrow(/read-only/);
  });
  it("never substitutes local defaults for unsupported saved/native state; genuine absence is only an unsaved draft", () => {
    const native = state(); delete native.configuration;
    expect(initialFieldPresentationDraft(native)!.configuration).toEqual({ version: 1, fields: {} });
    expect(Object.hasOwn(native, "configuration")).toBe(false);
    for (const patch of [{ configurationSupported: false }, { definitionSupported: false }, { definitionSchema: null }]) expect(initialFieldPresentationDraft({ ...state(), ...patch })).toBeNull();
  });
  it("offers only native compatible widgets and preserves null/empty/false/zero visibility with explicit reveal", () => {
    const field = state().definitionSchema!.fields[0]!;
    expect(fieldPresentationWidgets(field)).toEqual(["AUTO", "TEXT_INPUT", "PARAGRAPH"]);
    expect(fieldPresentationWidgets({ ...field, type: "CHOICE" })).toEqual(["AUTO", "DROPDOWN", "RADIO"]);
    expect(fieldPresentationWidgets({ ...field, type: "BOOLEAN" })).toEqual(["AUTO", "TRI_STATE", "CHECKBOX"]);
    expect(fieldPresentationWidgets({ ...field, type: "NUMBER" })).toEqual(["AUTO"]);
    const setting = { widget: "AUTO", visibility: "HIDE_WHEN_EMPTY" };
    const hidden = resolveCaseFieldPresentation({ key: field.key, definition: field, setting, values: {} });
    expect(hidden.visible).toBe(false); expect(hidden.canReveal).toBe(true);
    expect(resolveCaseFieldPresentation({ key: field.key, definition: field, setting, values: {}, revealed: true }).visible).toBe(true);
    for (const value of [null, "", " ", false, 0]) expect(resolveCaseFieldPresentation({ key: field.key, definition: field, setting, values: { notes: value } }).visible).toBe(true);
  });
  it("freezes exact UUID/profile/raw-schema pins and cloned prose without authoring types/defaults/values", () => {
    const draft = initialFieldPresentationDraft(state())!, input = freezeFieldPresentationRequest(draft, origin, "  Reviewed  ", id);
    expect(input.expectedProfileHash).toBe(draft.baseline.profileHash);
    expect(input.expectedFieldSchemaHash).toBe(draft.baseline.fieldSchemaHash);
    expect(input.expectedFieldSchemaHash).not.toBe(draft.baseline.fieldAuthoringSchemaHash);
    expect(input.requestId).toBe(id); expect(Object.isFrozen(input.configuration.fields.notes)).toBe(true);
    draft.configuration.fields.notes!.placeholder = "later edit";
    expect(input.configuration.fields.notes!.placeholder).toBe("  exact, text\n");
    expect(input.reason).toBe("Reviewed");
    expect(Object.keys(input).sort()).toEqual(["projectId", "originalOrganizationId", "expectedClerkActorId", "expectedProfileHash", "expectedFieldSchemaHash", "configuration", "reason", "confirmed", "requestId"].sort());
  });
  it("validates all ACK scope pins; uncertain receipt cannot be replaced after later definitive refusal", () => {
    const held = receipt(), ack = { projectId: origin.projectId, organizationId: origin.organizationId, actorClerkUserId: origin.clerkActorId, requestId: id, replayed: false };
    expect(() => assertFieldPresentationAck(ack, held)).not.toThrow();
    for (const key of ["projectId", "organizationId", "actorClerkUserId", "requestId", "replayed"]) expect(() => assertFieldPresentationAck({ ...ack, [key]: "other" }, held)).toThrow(/original scoped request/);
    expect(retainedFieldPresentationReceipt(held, { data: { code: "FORBIDDEN" } })).toBeNull();
    const uncertain = retainedFieldPresentationReceipt(held, Error("lost response"))!;
    const retained = retainedFieldPresentationReceipt(uncertain, { data: { code: "FORBIDDEN" } })!;
    expect(retained.input).toBe(held.input); expect(retained.uncertain).toBe(true); expect(retained.sessionId).toBe(held.sessionId);
  });
  it("revokes review/frame authority after close, new actor/session, scope, access or unmount", () => {
    const frame = { ready: true, open: true, epoch: 3, origin, sessionId: "session" };
    expect(sameFieldPresentationFrame(frame, { ...frame })).toBe(true);
    for (const change of [{ ready: false }, { open: false }, { epoch: 4 }, { sessionId: "other" }, { origin: { ...origin, clerkActorId: "other" } }, { origin: { ...origin, organizationId: "other" } }]) expect(sameFieldPresentationFrame(frame, { ...frame, ...change })).toBe(false);
    const draft = initialFieldPresentationDraft(state())!;
    expect(currentFieldPresentationBaseline(draft, state())).toBe(true);
    for (const patch of [{ profileHash: "d".repeat(64) }, { fieldSchemaHash: "d".repeat(64) }, { definitionSchemaVersion: 4 }, { canConfigure: false }, { configurationSupported: false }]) expect(currentFieldPresentationBaseline(draft, { ...state(), ...patch })).toBe(false);
  });
  it("requires a new native full-admin read with unchanged native actor as well as Clerk/org identity", () => {
    const data = state(), held = receipt(), args = { data, origin, nativeActorId: data.readScope.actorId, sessionId: "renewed-session", epoch: 6, beforeRevision: 100, revision: 101, input: held.input };
    const proof = fieldPresentationSessionRead(args);
    expect(proof.input).toBe(held.input); expect(held.sessionId).toBe("synthetic-session");
    for (const patch of [{ revision: 100 }, { revision: NaN }, { nativeActorId: null }, { nativeActorId: "replacement-native-actor" }, { sessionId: "" }, { data: undefined }, { data: { ...data, canConfigure: false } }, { origin: { ...origin, clerkActorId: "other" } }, { origin: { ...origin, organizationId: "other" } }]) expect(() => fieldPresentationSessionRead({ ...args, ...patch })).toThrow(/new completed native read/);
    const current = { ready: true, busy: false, origin, nativeActorId: data.readScope.actorId, sessionId: args.sessionId, epoch: args.epoch, data, revision: args.revision, input: held.input };
    expect(sameFieldPresentationSessionProof(proof, current)).toBe(true);
    for (const patch of [{ ready: false }, { busy: true }, { origin: null }, { nativeActorId: "other" }, { sessionId: "other" }, { epoch: 7 }, { data: structuredClone(data) }, { revision: 102 }, { input: null }]) expect(sameFieldPresentationSessionProof(proof, { ...current, ...patch })).toBe(false);
    expect(sameFieldPresentationSessionProof(null, current)).toBe(false);
  });
});
