import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { assertPriorityAck, freezePriorityEnvelope, priorityRequestHash, samePriorityReader } from "./case-priority-draft";
import { manualStartDefinitivelyRejected } from "./manual-run-start";
import type { PriorityController } from "./use-case-priority-controller";
import type { PriorityEnvelope, PriorityInput, PriorityAck, PriorityPreview } from "./case-priority-draft";
const source = readFileSync(new URL("./use-case-priority-controller.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("controller.ts", source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "useCasePriorityController")!;
const code = ts.transpileModule(`${ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration, ast).replace(/\bexport\s+/, "")}\nthis.controller=useCasePriorityController;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const origin = { projectId: "project", caseId: "case", organizationId: "org", clerkActorId: "clerk", nativeActorId: "native" }, scope = { projectId: "project", organizationId: "org", actorClerkUserId: "clerk", actorId: "native" };
function harness() {
  const hooks: unknown[] = [], effects: Array<() => void> = [], cleanups = new Map<number, () => void>(); let cursor = 0, dirty = false, uuid = 0, editor: PriorityController;
  const sent: PriorityEnvelope[] = [], counts = { callbacks: 0, refresh: 0 }, reads: { fresh: PriorityPreview | null; origin: typeof origin; activation: string; refresh: () => void } = { fresh: { projectId: "project", caseId: "case", requestId: "read", readScope: scope, priority: "MEDIUM", caseRevision: "a".repeat(64), canChange: true, canRecover: true, blockedReason: null }, origin, activation: "A", refresh: () => { counts.refresh++; } };
  const params = { projectId: "project", caseId: "case", active: true, readOnly: false }, state = { failure: null as unknown, wrong: null as null | string, onHash: null as null | (() => void), onSend: null as null | (() => void), callbackFail: false };
  const mutation = { isPending: false, mutateAsync: async (envelope: PriorityEnvelope) => { sent.push(envelope); state.onSend?.(); if (state.failure) throw state.failure; const input = envelope.input, result: PriorityAck = { projectId: input.projectId, caseId: input.caseId, requestId: input.requestId, requestHash: await priorityRequestHash(input), priority: input.priority, replayed: sent.length > 1, readScope: scope }; if (state.wrong === "hash") result.requestHash = "b".repeat(64); if (state.wrong === "native") result.readScope = { ...scope, actorId: "replacement" }; if (state.wrong === "choice") result.priority = "LOW"; return result; } };
  const context = vm.createContext({ Error, assertPriorityAck, freezePriorityEnvelope, samePriorityReader, manualStartDefinitivelyRejected, priorityRequestHash: async (input: PriorityInput) => { state.onHash?.(); return priorityRequestHash(input); }, crypto: { randomUUID: () => `6ee2ec04-4d34-40bf-b0e9-${String(++uuid).padStart(12, "0")}` },
    useCasePriorityAccess: (_project: string, _case: string, active: boolean) => ({ ...reads, fresh: active ? reads.fresh : null }),
    useState: (initial: unknown) => { const at = cursor++; if (!Object.hasOwn(hooks, at)) hooks[at] = typeof initial === "function" ? initial() : initial; return [hooks[at], (value: unknown) => { const next = typeof value === "function" ? value(hooks[at]) : value; if (!Object.is(next, hooks[at])) { hooks[at] = next; dirty = true; } }]; },
    useRef: (initial: unknown) => { const at = cursor++; if (!Object.hasOwn(hooks, at)) hooks[at] = { current: initial }; return hooks[at]; },
    useLayoutEffect: (effect: () => (() => void) | void, deps: unknown[]) => { const at = cursor++, prior = hooks[at] as unknown[] | undefined; if (!prior || deps.some((value, n) => !Object.is(value, prior[n]))) { hooks[at] = deps; effects.push(() => { cleanups.get(at)?.(); const cleanup = effect(); if (cleanup) cleanups.set(at, cleanup); }); } },
  }); vm.runInContext(code, context);
  const controller = (context as unknown as { controller: (...args: unknown[]) => PriorityController }).controller;
  function render() { for (let n = 0; n < 30; n++) { cursor = 0; dirty = false; editor = controller(params.projectId, params.caseId, params.active, params.readOnly, mutation, () => { counts.callbacks++; if (state.callbackFail) throw Error("Refresh failure"); }); effects.splice(0).forEach(effect => effect()); if (!dirty) return editor; } throw Error("Priority controller did not settle"); }
  render(); function ready() { editor.change("HIGH"); return render(); }
  return { render, ready, reads, params, state, mutation, counts, sent, unmount: () => { cleanups.forEach(fn => fn()); }, get editor() { return editor; } };
}
describe("actual full-editor priority controller, synthetic hooks NOT native/browser acceptance", () => {
  it("explicit dropdown choice sends unchanged old request inside native envelope once, no schema/business rationale mutation", async () => {
    const h = harness(); expect(h.ready().canSave).toBe(true); await h.editor.save(); h.render(); expect(h.sent).toHaveLength(1); expect(h.sent[0]!.expectedNativeActorId).toBe("native"); expect(h.sent[0]!.input).toMatchObject({ priority: "HIGH", expectedCaseRevision: "a".repeat(64), originalOrganizationId: "org", expectedClerkActorId: "clerk" }); expect(h.sent[0]!.input).not.toHaveProperty("rationale"); expect(Object.isFrozen(h.sent[0]!)).toBe(true); expect(Object.isFrozen(h.sent[0]!.input)).toBe(true); expect(h.editor.pending).toBeNull(); expect(h.editor.draft).toBeNull(); expect(h.counts).toEqual({ callbacks: 1, refresh: 1 });
  });
  it("read-only membership/prop cannot allocate a write despite valid scoped priority read", async () => {
    const h = harness(); h.reads.fresh!.canChange = false; h.reads.fresh!.canRecover = false; h.render().change("HIGH"); await h.editor.save(); expect(h.sent).toEqual([]); expect(h.editor.readable).toBe(true); expect(h.editor.canSave).toBe(false);
    const prop = harness(); prop.ready(); prop.params.readOnly = true; prop.render(); await prop.editor.save(); expect(prop.sent).toEqual([]);
  });
  it("same-tick hash/send/choice events cannot duplicate UUID or alter retained intent", async () => {
    const h = harness(); h.ready(); h.state.onHash = () => { h.editor.change("LOW"); }; const a = h.editor.save(), b = h.editor.save(); await Promise.all([a, b]); expect(h.sent).toHaveLength(1); expect(h.sent[0]!.input.priority).toBe("HIGH");
  });
  it.each(["unmount", "inactive", "session-A-B-A", "readOnly-A-B-A", "case-reuse"])("known matching ACK after %s privately consumes receipt, not choice/notice/cache/callback", async loss => {
    const h = harness(); h.ready(); const draft = h.editor.draft, notice = h.editor.notice;
    h.state.onSend = () => { if (loss === "unmount") h.unmount(); else if (loss === "inactive") { h.params.active = false; h.render(); } else if (loss === "session-A-B-A") { h.reads.activation = "B"; h.render(); h.reads.activation = "A-return"; h.render(); } else if (loss === "readOnly-A-B-A") { h.params.readOnly = true; h.render(); h.params.readOnly = false; h.render(); } else { h.params.caseId = "other"; h.reads.fresh = null; h.render(); } };
    await h.editor.save(); h.render(); expect(h.editor.pending).toBeNull(); expect(h.editor.draft).toBe(draft); expect(h.editor.settled).toBe(true); expect(h.editor.notice).toBe(notice); expect(h.counts).toEqual({ callbacks: 0, refresh: 0 }); await h.editor.save(); expect(h.sent).toHaveLength(1);
  });
  it("unknown original request retries even after later unsupported snapshot, but never rebases to new current case", async () => {
    const h = harness(); h.ready(); h.state.failure = Error("Unknown"); await h.editor.save(); h.render(); const held = h.editor.pending!;
    h.reads.fresh = { ...h.reads.fresh!, canChange: false, caseRevision: null, blockedReason: "Native precision" }; h.render(); h.editor.reviewCurrent(); h.editor.change("LOW"); h.state.failure = { data: { code: "CONFLICT" } }; await h.editor.save(); h.render(); expect(h.editor.pending?.envelope).toBe(held.envelope); expect(h.editor.pending?.requestHash).toBe(held.requestHash); h.state.failure = null; await h.editor.save(); h.render(); expect(h.sent[1]!).toBe(h.sent[0]!); expect(h.sent[2]!).toBe(h.sent[0]!); expect(h.editor.pending).toBeNull();
  });
  it("first definitive refusal unlocks local choice; wrong choice/hash/native ACK remains unknown", async () => {
    const h = harness(); h.ready(); h.state.failure = { data: { code: "BAD_REQUEST" } }; await h.editor.save(); h.render(); expect(h.editor.pending).toBeNull(); expect(h.editor.draft).not.toBeNull();
    for (const wrong of ["choice", "hash", "native"]) { const m = harness(); m.ready(); m.state.wrong = wrong; await m.editor.save(); m.render(); expect(m.editor.pending?.everAmbiguous).toBe(true); expect(m.counts.callbacks).toBe(0); }
  });
  it("stale handlers after reader A-B-A cannot change/save/review the original choice", async () => {
    const h = harness(); h.ready(); const old = h.editor, draft = old.draft; h.params.readOnly = true; h.render(); h.params.readOnly = false; h.render(); old.change("LOW"); old.reviewCurrent(); await old.save(); h.render(); expect(h.editor.draft).toBe(draft); expect(h.sent).toEqual([]);
  });
  it("stale native case baseline requires explicit re-review with choice retained; no automatic overwritten CAS", async () => {
    const h = harness(); h.ready(); h.reads.fresh = { ...h.reads.fresh!, caseRevision: "b".repeat(64) }; h.render(); expect(h.editor.canSave).toBe(false); await h.editor.save(); expect(h.sent).toEqual([]); h.editor.reviewCurrent(); h.render(); expect(h.editor.draft?.priority).toBe("HIGH"); expect(h.editor.draft?.caseRevision).toBe("b".repeat(64)); await h.editor.save(); expect(h.sent[0]!.input.expectedCaseRevision).toBe("b".repeat(64));
  });
  it("known prior decision after view change requires explicit new review and cannot silently repeat", async () => {
    const h = harness(); h.ready(); h.state.onSend = () => { h.params.active = false; h.render(); }; await h.editor.save(); h.render(); h.params.active = true; h.render(); await h.editor.save(); expect(h.sent).toHaveLength(1); h.reads.fresh = { ...h.reads.fresh!, priority: "HIGH", caseRevision: "c".repeat(64) }; h.render(); h.editor.reviewCurrent(); h.render(); expect(h.editor.canSave).toBe(false); expect(h.editor.draft?.priority).toBe("HIGH"); expect(h.editor.draft?.previousPriority).toBe("HIGH");
  });
  it("hash preparation outliving current native editor sends nothing; native remapping refuses exact pending retry", async () => {
    const h = harness(); h.ready(); const draft = h.editor.draft; h.state.onHash = () => { h.params.readOnly = true; h.render(); }; await h.editor.save(); h.render(); expect(h.sent).toEqual([]); expect(h.editor.draft).toBe(draft);
    const p = harness(); p.ready(); p.state.failure = Error("Unknown"); await p.editor.save(); p.render(); const held = p.editor.pending; p.reads.fresh = { ...p.reads.fresh!, readScope: { ...scope, actorId: "replacement" } }; p.render(); await p.editor.save(); expect(p.sent).toHaveLength(1); expect(p.editor.pending).toBe(held); expect(p.editor.readable).toBe(false);
  });
  it("known ACK parent refresh failure never recreates or duplicates a priority version", async () => {
    const h = harness(); h.ready(); h.state.callbackFail = true; await h.editor.save(); h.render(); await h.editor.save(); expect(h.sent).toHaveLength(1); expect(h.editor.pending).toBeNull(); expect(h.editor.notice).toContain("Refresh reads only");
  });
});
