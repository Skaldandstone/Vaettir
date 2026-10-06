import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { assertGovernanceAcknowledgement, planGovernanceRequestHash, retainedGovernancePending } from "./plan-governance-receipt";
import * as draftHelpers from "./plan-change-draft";

const source = readFileSync(new URL("./use-plan-change-editor.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("editor.ts", source, ts.ScriptTarget.Latest, true);
const printer = ts.createPrinter(), declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "usePlanChangeEditor")!, reader = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(entry => entry.name.getText(ast) === "samePlanChangeReader"))!;
const compiled = ts.transpileModule(`${printer.printNode(ts.EmitHint.Unspecified, reader, ast).replace(/^export /, "")}\n${printer.printNode(ts.EmitHint.Unspecified, declaration, ast).replace(/^export /, "")}\nthis.controller=usePlanChangeEditor;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const origin = { projectId: "project", organizationId: "org", clerkActorId: "clerk", caseId: null };
const scope = { projectId: "project", organizationId: "org", actorClerkUserId: "clerk", actorId: "native" };
function baseline() { return { scope, snapshot: { id: "plan", projectId: "project", status: "DRAFT", customFields: { n: 12, notes: "Native", unknown: { retained: [null, false, 0] } } }, planRevision: "a".repeat(64), canRecover: true, statusActions: { canChange: true, canReopen: false }, metadataSchema: { fieldSchema: { properties: { n: { type: "number" }, notes: { type: "string" } } }, fieldSchemaHash: "b".repeat(64), supported: true, canEdit: true } }; }
type AnyEditor = { show: () => void; close: () => void; review: () => void; commit: () => Promise<void>; change: (patch: Record<string, unknown>) => void; draft: any; draftRef: { current: any }; pending: any; pendingRef: { current: any }; canSave: boolean; notice: string; readable: boolean };
function harness(operation: "SET_PLAN_STATUS" | "EDIT_PLAN_CUSTOM_FIELDS" = "SET_PLAN_STATUS") {
  const hooks: unknown[] = [], effects: Array<() => void> = [], cleanups = new Map<number, () => void>(); let cursor = 0, dirty = false, uuid = 0, editor: AnyEditor;
  const reads = { fresh: baseline() as ReturnType<typeof baseline> | null, origin, nativeActorId: "native", activation: "activation-A", refresh: () => { effectsDone.refreshes++; } };
  const effectsDone = { callbacks: 0, refreshes: 0 }, sent: any[] = [], state = { failure: null as unknown, wrongNative: false, wrongHash: false, onSend: null as null | (() => void), onHash: null as null | (() => void), callbackFail: false };
  const config = {
    projectId: "project", testPlanId: "plan", organizationId: "org", readOnly: false, operation,
    mutation: { isPending: false, mutateAsync: async (input: any) => { sent.push(input); state.onSend?.(); if (state.failure) throw state.failure; return { scope: state.wrongNative ? { ...scope, actorId: "other-native" } : scope, requestId: input.requestId, requestHash: state.wrongHash ? "f".repeat(64) : await planGovernanceRequestHash(operation, input), operation, testPlanId: input.testPlanId, criterionId: null, releaseId: null, versionId: "version", versionNumber: 2, beforeRevision: input.expectedPlanRevision, afterRevision: "c".repeat(64), replayed: sent.length > 1 }; } },
    initialize: () => operation === "SET_PLAN_STATUS" ? { status: "DRAFT", intent: "CHANGE" } : draftHelpers.emptyPlanMetadataDraft(),
    canChange: (current: any) => operation === "SET_PLAN_STATUS" ? current.statusActions.canChange || current.statusActions.canReopen : current.metadataSchema.canEdit && current.metadataSchema.supported && !!current.metadataSchema.fieldSchemaHash,
    validate: (draft: any, current: any) => { if (draft.baseline.planRevision !== current.planRevision) return "Stale plan"; try { if (operation === "SET_PLAN_STATUS") draftHelpers.reviewedPlanStatus(draft.baseline.snapshot.status, draft.values.status, draft.values.intent); else { if (draft.baseline.metadataSchema.fieldSchemaHash !== current.metadataSchema.fieldSchemaHash) return "Stale schema"; if (!draftHelpers.reviewedPlanMetadataChanges(draft.baseline.metadataSchema.fieldSchema, draft.baseline.snapshot.customFields, draft.values).length) return "No changes"; } return null; } catch (cause) { return String(cause); } },
    makeInput: (draft: any, base: any) => operation === "SET_PLAN_STATUS" ? { ...base, ...draftHelpers.reviewedPlanStatus(draft.baseline.snapshot.status, draft.values.status, draft.values.intent) } : { ...base, expectedFieldSchemaHash: draft.baseline.metadataSchema.fieldSchemaHash, changes: draftHelpers.reviewedPlanMetadataChanges(draft.baseline.metadataSchema.fieldSchema, draft.baseline.snapshot.customFields, draft.values) },
    onChanged: () => { effectsDone.callbacks++; if (state.callbackFail) throw Error("Synthetic callback failure"); }, savedNotice: "Known saved change",
  };
  const context = vm.createContext({
    assertGovernanceAcknowledgement, retainedGovernancePending, freezePlanChangeJson: draftHelpers.freezePlanChangeJson,
    planGovernanceRequestHash: async (op: string, input: unknown) => { state.onHash?.(); return planGovernanceRequestHash(op, input); },
    crypto: { randomUUID: () => `6ee2ec04-4d34-40bf-b0e9-${String(++uuid).padStart(12, "0")}` },
    usePlanChangeAccess: (_project: string, _plan: string, _org: string, active: boolean) => ({ ...reads, fresh: active ? reads.fresh : null }),
    useState: (initial: unknown) => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], (value: unknown) => { const next = typeof value === "function" ? value(hooks[index]) : value; if (!Object.is(next, hooks[index])) { hooks[index] = next; dirty = true; } }]; },
    useRef: (initial: unknown) => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = { current: initial }; return hooks[index]; },
    useLayoutEffect: (effect: () => (() => void) | void, deps: unknown[]) => { const index = cursor++, prior = hooks[index] as unknown[] | undefined; if (!prior || deps.some((value, n) => !Object.is(value, prior[n]))) { hooks[index] = deps; effects.push(() => { cleanups.get(index)?.(); const cleanup = effect(); if (cleanup) cleanups.set(index, cleanup); }); } },
  });
  vm.runInContext(compiled, context);
  const control = (context as unknown as { controller: (config: unknown) => AnyEditor }).controller;
  function render() { for (let at = 0; at < 30; at++) { cursor = 0; dirty = false; editor = control(config); effects.splice(0).forEach(effect => effect()); if (!dirty) return editor; } throw Error("Editor did not settle"); }
  function ready() { render().show(); render().review(); render(); editor.change({ values: operation === "SET_PLAN_STATUS" ? { status: "ACTIVE", intent: "CHANGE" } : draftHelpers.setPlanMetadataNumber(editor.draft.values, "n", "2.00") }); render().change({ reason: "  Exact reviewed change  " }); render().change({ confirmed: true }); return render(); }
  return { render, ready, reads, config, state, sent, effectsDone, unmount: () => { cleanups.forEach(cleanup => cleanup()); }, get editor() { return editor; } };
}

describe("actual new plan status/metadata controller, synthetic hooks NOT native/browser acceptance", () => {
  it.each(["SET_PLAN_STATUS", "EDIT_PLAN_CUSTOM_FIELDS"] as const)("%s sends only its explicit protocol and exact baseline/hash once", async operation => {
    const h = harness(operation); expect(h.ready().canSave).toBe(true); await h.editor.commit(); h.render();
    expect(h.sent).toHaveLength(1); expect(h.sent[0]).toMatchObject({ expectedPlanRevision: "a".repeat(64), originalOrganizationId: "org", expectedClerkActorId: "clerk", reason: "Exact reviewed change", confirmed: true });
    expect(h.sent[0]).not.toHaveProperty("customFields"); expect(h.sent[0]).not.toHaveProperty("name"); expect(h.sent[0]).not.toHaveProperty("description");
    expect(h.editor.pending).toBeNull(); expect(h.editor.draft).toBeNull(); expect(h.effectsDone).toEqual({ callbacks: 1, refreshes: 1 });
  });
  it("numeric invalid buffer blocks metadata save synchronously, even before a rerender", async () => {
    const h = harness("EDIT_PLAN_CUSTOM_FIELDS"); h.ready(); const oldHandler = h.editor.commit;
    h.editor.change({ values: draftHelpers.setPlanMetadataNumber(h.editor.draft.values, "n", "-") }); await oldHandler();
    expect(h.sent).toEqual([]); expect(h.render().canSave).toBe(false); expect(h.editor.draft.values.numberBuffers.n).toBe("-");
  });
  it("frozen request and reviewed values do not share source draft arrays during hash/ACK", async () => {
    const h = harness("EDIT_PLAN_CUSTOM_FIELDS"); h.reads.fresh!.metadataSchema.fieldSchema.properties = { ...h.reads.fresh!.metadataSchema.fieldSchema.properties, areas: { type: "array", items: { type: "string" } } } as never;
    h.ready(); const originalRows = [" exact ", "same", "same", ""];
    h.editor.change({ values: draftHelpers.replacePlanMetadataChange(h.editor.draft.values, { operation: "SET", key: "areas", value: originalRows }) }); h.render().change({ confirmed: true }); h.render();
    h.state.onHash = () => { originalRows[0] = "Changed while hashing"; };
    h.state.onSend = () => { originalRows.push("Changed while awaiting ACK"); }; h.state.failure = Error("Lost response");
    await h.editor.commit(); h.render(); const held = h.editor.pending, wireRows = held.input.changes.find((change: any) => change.key === "areas").value;
    expect(wireRows).toEqual([" exact ", "same", "same", ""]); expect(wireRows).not.toBe(originalRows);
    expect(held.reviewedDraft.values.changes.find((change: any) => change.key === "areas").value).toEqual(wireRows);
    expect(Object.isFrozen(held.input)).toBe(true); expect(Object.isFrozen(held.input.changes)).toBe(true); expect(Object.isFrozen(wireRows)).toBe(true);
    expect(held.requestHash).toBe(await planGovernanceRequestHash("EDIT_PLAN_CUSTOM_FIELDS", held.input));
  });
  it("hash preparation outliving actor/frame changes sends no request and retains draft", async () => {
    const h = harness(); h.ready(); const draft = h.editor.draft;
    h.state.onHash = () => { h.config.readOnly = true; h.render(); }; await h.editor.commit(); h.render();
    expect(h.sent).toEqual([]); expect(h.editor.draft).toBe(draft); expect(h.editor.pending).toBeNull();
  });
  it.each(["close", "unmount", "session-A-B-A", "readOnly-A-B-A", "plan-reuse"])("known matching ACK after %s privately consumes only its receipt, not draft/notice/cache/callback", async loss => {
    const h = harness(); h.ready(); const draft = h.editor.draft, notice = h.editor.notice;
    h.state.onSend = () => {
      if (loss === "close") { h.editor.close(); h.render(); }
      else if (loss === "unmount") h.unmount();
      else if (loss === "session-A-B-A") { h.reads.activation = "activation-B"; h.render(); h.reads.activation = "activation-A-returned"; h.render(); }
      else if (loss === "readOnly-A-B-A") { h.config.readOnly = true; h.render(); h.config.readOnly = false; h.render(); }
      else { h.config.testPlanId = "other-plan"; h.reads.fresh = { ...baseline(), snapshot: { ...baseline().snapshot, id: "other-plan" } }; h.render(); }
    };
    await h.editor.commit(); h.render(); expect(h.editor.pending).toBeNull(); expect(h.editor.draft).toBe(draft); expect(h.editor.notice).toBe(notice); expect(h.effectsDone).toEqual({ callbacks: 0, refreshes: 0 });
  });
  it("stale local review/edit handlers cannot reset drafts after loss and return", () => {
    const h = harness(); h.ready(); const old = h.editor, draft = old.draft;
    h.config.readOnly = true; h.render(); h.config.readOnly = false; h.render(); old.change({ reason: "Stale reason" }); old.review(); h.render(); expect(h.editor.draft).toBe(draft);
  });
  it("unknown ACK retains exact input/hash/body; later typed refusal cannot erase its earlier ambiguity", async () => {
    const h = harness("EDIT_PLAN_CUSTOM_FIELDS"); h.ready(); h.state.failure = Error("Lost response"); await h.editor.commit(); h.render();
    const original = h.editor.pending; expect(original.uncertain).toBe(true);
    h.state.failure = { data: { code: "CONFLICT" } }; await h.editor.commit(); h.render();
    expect(h.editor.pending.input).toBe(original.input); expect(h.editor.pending.requestHash).toBe(original.requestHash); expect(h.sent[1]).toBe(h.sent[0]); expect(h.editor.draft.identity).toBe(original.reviewedDraft.identity); expect(h.editor.draft).not.toBe(original.reviewedDraft);
  });
  it("first proven rejection unlocks draft; malformed/hash/native-reader ACK remains pending", async () => {
    const rejected = harness(); rejected.ready(); rejected.state.failure = { data: { code: "BAD_REQUEST" } }; await rejected.editor.commit(); rejected.render(); expect(rejected.editor.pending).toBeNull(); expect(rejected.editor.draft).not.toBeNull();
    for (const patch of [{ wrongNative: true }, { wrongHash: true }]) { const h = harness(); h.ready(); Object.assign(h.state, patch); await h.editor.commit(); h.render(); expect(h.editor.pending?.uncertain).toBe(true); expect(h.editor.draft).not.toBeNull(); expect(h.effectsDone.callbacks).toBe(0); }
  });
  it("exact old metadata request recovers when later schema becomes unreadable/frozen, but native actor change still forbids retry", async () => {
    const h = harness("EDIT_PLAN_CUSTOM_FIELDS"); h.ready(); h.state.failure = Error("Unknown"); await h.editor.commit(); h.render(); const input = h.editor.pending.input;
    h.state.failure = null; h.reads.fresh = { ...baseline(), metadataSchema: { ...baseline().metadataSchema, fieldSchema: null as never, fieldSchemaHash: null as never, supported: false, canEdit: false }, statusActions: { canChange: false, canReopen: false } }; h.render(); await h.editor.commit(); h.render();
    expect(h.sent[1]).toBe(input); expect(h.editor.pending).toBeNull();
    const denied = harness(); denied.ready(); denied.state.failure = Error("Unknown"); await denied.editor.commit(); denied.render(); denied.reads.fresh = { ...baseline(), scope: { ...scope, actorId: "replacement" } }; denied.render(); await denied.editor.commit(); expect(denied.sent).toHaveLength(1);
  });
  it("known ACK survives parent refresh failure without resending or reconstructing pending work", async () => {
    const h = harness(); h.ready(); h.state.callbackFail = true; await h.editor.commit(); h.render(); await h.editor.commit();
    expect(h.sent).toHaveLength(1); expect(h.editor.pending).toBeNull(); expect(h.editor.notice).toContain("Known saved change"); expect(h.editor.notice).toContain("refresh reads only");
  });
  it("no shared legacy API/native/client processing or automatic whole-record save was introduced", () => {
    for (const file of ["../components/PlanStatusEditor.tsx", "../components/PlanCustomFieldsEditor.tsx", "./use-plan-change-access.ts"]) { const text = readFileSync(new URL(file, import.meta.url), "utf8"); expect(text).not.toContain("testPlans.update"); expect(text).not.toContain("useCaseFieldAccess"); expect(text).not.toMatch(/assessRisk|generateQaStrategyDraft|\.approve\(/); }
    expect(source).toContain("saved.scope.actorId !== retained.nativeActorId"); expect(source.indexOf("pendingRef.current = null; setPending")).toBeLessThan(source.indexOf("if (!owns()) return;", source.indexOf("assertGovernanceAcknowledgement(saved")));
  });
});
