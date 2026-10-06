import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { StepReviewCompletionController } from "./step-execution-review-completion";
import { decodeStepReviewWire, sameStepReviewReader, stepReviewRequestHash, type StepReviewBuffer } from "./step-execution-review-draft";
import type { ReviewedStepWriteInput } from "@vaettir/api/src/services/manualStepExecutionReviewSchema";
import type { StepReviewController } from "./use-step-execution-review-controller";

// Execute both actual hooks and the real private completion class. Only React
// bookkeeping, Clerk and RPC are synthetic. These are not native/browser tests.
const code = ["use-step-execution-review-access.ts", "use-step-execution-review-controller.ts"].map(name => {
  const source = readFileSync(new URL(name, import.meta.url), "utf8"), ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(ts.isFunctionDeclaration).map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, "")).join("\n");
}).join("\n");
const executable = ts.transpileModule(code + "\nthis.workflow=useStepExecutionReviewController;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const buffer = (): StepReviewBuffer => ({ status: "PASS", note: " exact ", context: { specimen: "", hardwareRevision: "", firmwareVersion: "", environment: "" }, readings: [], evidenceAttachmentIds: [], correctionReason: null });

function harness() {
  const hooks: unknown[] = [], cleanups = new Map<number, () => void>(), effects: Array<() => void> = [], listeners = new Set<() => void>(), cache = new Map<string, unknown>();
  const auth = { isLoaded: true, isSignedIn: true, userId: "cl", sessionId: "A" }, sdk = { loaded: true, session: { id: "A", user: { id: "cl" } } as null | { id: string; user: { id: string } }, addListener: (fn: () => void) => { listeners.add(fn); fn(); return () => { listeners.delete(fn); }; } };
  const params = { visible: true, readOnly: false, stepIndex: 0 }, query = { isFetching: false, isPaused: false, error: null as unknown, isFetchedAfterMount: true, supported: true, wrongNative: false };
  const scope = { projectId: "p", organizationId: "o", actorId: "n", actorClerkUserId: "cl" }, calls = { acknowledged: 0, pending: [] as boolean[], sent: [] as Readonly<ReviewedStepWriteInput>[] };
  let cursor = 0, dirty = false, counter = 0, workflow: StepReviewController, record: (input: Readonly<ReviewedStepWriteInput>) => Promise<unknown>;
  const acknowledge = () => { calls.acknowledged++; }, unconfirmed = (value: boolean) => { calls.pending.push(value); };
  async function ack(input: Readonly<ReviewedStepWriteInput>) { return { projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, scope, idempotencyKey: input.idempotencyKey, requestHash: await stepReviewRequestHash(input), revisionId: "new", caseStatus: null, recovered: false, provenance: "REVIEWED_REQUEST_BOUND_AT_WRITE" }; }
  record = ack;
  const context = vm.createContext({ window: { Clerk: sdk }, Object, JSON, currentSessionScope, sameAuthScope, decodeStepReviewWire, sameStepReviewReader, StepReviewCompletionController,
    crypto: { randomUUID: () => `6ee2ec04-4d34-40bf-b0e9-${String(++counter).padStart(12, "0")}` }, useAuth: () => auth,
    useState: (initial: unknown) => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], (value: unknown) => { const next = typeof value === "function" ? value(hooks[index]) : value; if (!Object.is(next, hooks[index])) { hooks[index] = next; dirty = true; } }]; },
    useRef: (initial: unknown) => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = { current: initial }; return hooks[index]; },
    useMemo: (fn: () => unknown, deps: unknown[]) => { const index = cursor++, previous = hooks[index] as { deps: unknown[]; value: unknown } | undefined; if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) hooks[index] = { deps, value: fn() }; return (hooks[index] as { value: unknown }).value; },
    useLayoutEffect: (fn: () => void | (() => void), deps: unknown[]) => { const index = cursor++, previous = hooks[index] as unknown[] | undefined; if (!previous || deps.some((value, n) => !Object.is(value, previous[n]))) { hooks[index] = deps; effects.push(() => { cleanups.get(index)?.(); const cleanup = fn(); if (cleanup) cleanups.set(index, cleanup); }); } },
    trpcReact: { manualStepExecutionReview: {
      preview: { useQuery: (input: Record<string, unknown>) => { const key = JSON.stringify([input, query.supported, query.wrongNative]); if (!cache.has(key)) cache.set(key, { projectId: "p", testRunId: "r", testCaseId: "c", stepIndex: input.stepIndex, readRequestId: input.readRequestId, scope: { ...scope, actorId: query.wrongNative ? "replacement" : "n" }, canRecover: true, canRecord: query.supported, supported: query.supported, blockedReason: null, frozenDefinition: query.supported ? { testCaseId: "c", steps: [{ order: 0, action: "First" }, { order: 1, action: "Next" }] } : null, current: null, rawCurrent: null, procedureHash: query.supported ? "a".repeat(64) : null, currentFingerprint: query.supported ? "b".repeat(64) : null, provenance: "CURRENT_AUTHORITY_LEGACY_ORIGINAL_TENANCY_UNRECORDED" }); return { ...query, data: cache.get(key) }; } },
      record: { useMutation: () => ({ mutateAsync: (input: Readonly<ReviewedStepWriteInput>) => { calls.sent.push(input); return record(input); } }) }
    } } });
  vm.runInContext(executable, context); const invokeWorkflow = (context as { workflow: (...args: unknown[]) => StepReviewController }).workflow;
  function render() { for (let n = 0; n < 40; n++) { cursor = 0; dirty = false; workflow = invokeWorkflow({ projectId: "p", testRunId: "r", testCaseId: "c" }, params.stepIndex, params.visible, params.readOnly, acknowledge, unconfirmed); effects.splice(0).forEach(fn => fn()); if (!dirty) return workflow; } throw Error("Workflow failed to settle."); }
  function beforeLayout() { cursor = 0; dirty = false; return invokeWorkflow({ projectId: "p", testRunId: "r", testCaseId: "c" }, params.stepIndex, params.visible, params.readOnly, acknowledge, unconfirmed); }
  function prepare() { workflow.change(buffer()); render(); workflow.reviewCurrent(); render(); }
  function emit(session: typeof sdk.session) { sdk.session = session; Array.from(listeners).forEach(fn => fn()); }
  render(); return { params, query, auth, sdk, calls, render, beforeLayout, prepare, ack, emit, setRecord: (fn: typeof record) => { record = fn; }, get workflow() { return workflow; }, unmount: () => { Array.from(cleanups.values()).forEach(fn => fn()); cleanups.clear(); } };
}

describe("actual step reader/controller hooks and private class, synthetic RPC only", () => {
  it.each(["close", "readonly", "fetch", "step"])("render %s revokes old private bodies/handlers BEFORE layout effects", async loss => {
    const h = harness(); h.prepare(); const prior = h.workflow, draft = prior.view.draft;
    if (loss === "close") h.params.visible = false;
    if (loss === "readonly") h.params.readOnly = true;
    if (loss === "fetch") h.query.isFetching = true;
    if (loss === "step") h.params.stepIndex = 1;
    const duringRender = h.beforeLayout();
    expect(duringRender.view.draft).toBeNull(); expect(duringRender.view.acknowledgement).toBeNull(); expect(duringRender.view.canSave).toBe(false);
    expect(prior.change({ ...buffer(), note: "stale render callback" })).toBe(false);
    expect(prior.discardUnsaved()).toBe(false); await prior.save(); expect(h.calls.sent).toHaveLength(0);
    h.params.visible = true; h.params.readOnly = false; h.params.stepIndex = 0; h.query.isFetching = false;
    h.render(); expect(h.workflow.view.draft?.buffer).toEqual(draft?.buffer);
  });
  it("captures admitted handler identity and synchronously refuses double submit before React updates", async () => { const h = harness(), stale = h.workflow; expect(stale.view.canEdit).toBe(true); h.prepare(); expect(stale.change({ ...buffer(), note: "stale" })).toBe(false); const save = h.workflow.save; await Promise.all([save(), save()]); h.render(); expect(h.calls.sent).toHaveLength(1); expect(h.calls.acknowledged).toBe(1); expect(h.workflow.view.acknowledgement?.revisionId).toBe("new"); });
  it.each(["ACK", "rejected", "malformed"])("installed SDK listeners revoke A-B-A before React commit for late %s", async kind => { const h = harness(); h.prepare(); const activation = h.workflow.reads.activation; h.setRecord(async input => { h.emit({ id: "B", user: { id: "cl" } }); h.emit({ id: "A", user: { id: "cl" } }); if (kind === "rejected") throw { data: { code: "FORBIDDEN" } }; const ack = await h.ack(input); return kind === "malformed" ? { ...ack, requestHash: "f".repeat(64) } : ack; }); await h.workflow.save(); expect(h.calls.acknowledged).toBe(0); const current = h.render(); expect(current.reads.activation).not.toBe(activation); if (kind === "ACK") { expect(current.view.canSave).toBe(false); expect(current.view.acknowledgement?.revisionId).toBe("new"); await current.synchronizeAcknowledged(); expect(h.calls.acknowledged).toBe(1); expect(h.calls.sent).toHaveLength(1); } else { expect(current.view.hasPending).toBe(true); expect(current.view.canEdit).toBe(false); } });
  it("close and unmount make a matched ACK private while original frozen request remains exact", async () => { for (const loss of ["close", "unmount"]) { const h = harness(); h.prepare(); h.setRecord(async input => { if (loss === "close") { h.params.visible = false; h.render(); } else h.unmount(); return h.ack(input); }); await h.workflow.save(); expect(h.calls.acknowledged).toBe(0); expect(h.calls.sent).toHaveLength(1); expect(Object.isFrozen(h.calls.sent[0])).toBe(true); } });
  it("unsupported freshly pinned preview only recovers an identical ambiguous request, never creates new input", async () => { const h = harness(); h.prepare(); h.setRecord(async () => { throw Error("lost response"); }); await h.workflow.save(); h.query.supported = false; h.workflow.reads.refresh(); h.render(); expect(h.workflow.view.draft).toBeNull(); expect(h.workflow.view.canEdit).toBe(false); expect(h.workflow.view.canSave).toBe(true); h.setRecord(h.ack); await h.workflow.save(); h.render(); expect(h.calls.sent[1]).toBe(h.calls.sent[0]); expect(h.calls.acknowledged).toBe(0); expect(h.workflow.view.hasPending).toBe(false); });
  it("current fetch/readonly/native identity refusal cannot expose active write affordances", () => { const h = harness(); h.prepare(); h.params.readOnly = true; expect(h.render().view.canSave).toBe(false); h.params.readOnly = false; h.query.isFetching = true; expect(h.render().view.draft).toBeNull(); h.query.isFetching = false; h.query.wrongNative = true; expect(h.render().view.draft).toBeNull(); expect(h.workflow.view.canEdit).toBe(false); });
});
