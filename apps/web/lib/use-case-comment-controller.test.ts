import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { assertCommentAck, commentRequestHash, freezeCommentInput, sameCommentReader } from "./case-comment-draft";
import type { CommentController } from "./use-case-comment-controller";
import { manualStartDefinitivelyRejected } from "./manual-run-start";
const source = readFileSync(new URL("./use-case-comment-controller.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("controller.ts", source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "useCaseCommentController")!;
const code = ts.transpileModule(`${ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration, ast).replace(/\bexport\s+/, "")}\nthis.controller=useCaseCommentController;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const origin = { projectId: "project", caseId: "case", organizationId: "org", clerkActorId: "clerk", nativeActorId: "native" }, scope = { projectId: "project", organizationId: "org", actorId: "native", actorClerkUserId: "clerk" };
function harness() {
  const hooks: unknown[] = [], effects: Array<() => void> = [], cleanups = new Map<number, () => void>(); let cursor = 0, dirty = false, uuid = 0, editor: CommentController;
  const sent: any[] = [], counts = { saved: 0, refresh: 0 }, reads = { fresh: { projectId: "project", caseId: "case", requestId: "read", readScope: scope, canComment: true } as any, origin, activation: "A", refresh: () => { counts.refresh++; } };
  const params = { projectId: "project", caseId: "case", active: true }, state = { failure: null as unknown, wrong: null as null | string, onHash: null as null | (() => void), onSend: null as null | (() => void), callbackFail: false };
  const mutation = { isPending: false, mutateAsync: async (input: any) => { sent.push(input); state.onSend?.(); if (state.failure) throw state.failure; const result = { id: "6ee2ec04-4d34-40bf-b0e9-000000000100", projectId: input.projectId, caseId: input.caseId, requestId: input.requestId, requestHash: await commentRequestHash(input), body: input.body, readScope: scope, authorName: "Synthetic READ_ONLY member", isOwn: true, createdAt: "2026-10-06T04:00:00Z" }; if (state.wrong === "hash") result.requestHash = "b".repeat(64); if (state.wrong === "native") result.readScope = { ...scope, actorId: "replacement" }; if (state.wrong === "body") result.body = "Other"; return result; } };
  const context = vm.createContext({ Error, assertCommentAck, freezeCommentInput, sameCommentReader, manualStartDefinitivelyRejected,
    commentRequestHash: async (input: any) => { state.onHash?.(); return commentRequestHash(input); }, crypto: { randomUUID: () => `6ee2ec04-4d34-40bf-b0e9-${String(++uuid).padStart(12, "0")}` },
    useCaseCommentAccess: (_project: string, _case: string, active: boolean) => ({ ...reads, fresh: active ? reads.fresh : null }),
    useState: (initial: unknown) => { const at = cursor++; if (!Object.hasOwn(hooks, at)) hooks[at] = typeof initial === "function" ? initial() : initial; return [hooks[at], (value: unknown) => { const next = typeof value === "function" ? value(hooks[at]) : value; if (!Object.is(next, hooks[at])) { hooks[at] = next; dirty = true; } }]; },
    useRef: (initial: unknown) => { const at = cursor++; if (!Object.hasOwn(hooks, at)) hooks[at] = { current: initial }; return hooks[at]; },
    useLayoutEffect: (effect: () => (() => void) | void, deps: unknown[]) => { const at = cursor++, prior = hooks[at] as unknown[] | undefined; if (!prior || deps.some((value, index) => !Object.is(value, prior[index]))) { hooks[at] = deps; effects.push(() => { cleanups.get(at)?.(); const cleanup = effect(); if (cleanup) cleanups.set(at, cleanup); }); } },
  }); vm.runInContext(code, context);
  const controller = (context as unknown as { controller: (...args: unknown[]) => CommentController }).controller;
  function render() { for (let n = 0; n < 30; n++) { cursor = 0; dirty = false; editor = controller(params.projectId, params.caseId, params.active, mutation, () => { counts.saved++; if (state.callbackFail) throw Error("Refresh failure"); }); effects.splice(0).forEach(effect => effect()); if (!dirty) return editor; } throw Error("Comment controller did not settle"); }
  render(); function ready() { editor.change("  Exact plain text λ\n<not HTML>  "); return render(); }
  return { render, ready, state, reads, params, mutation, sent, counts, unmount: () => { cleanups.forEach(fn => fn()); }, get editor() { return editor; } };
}
describe("actual comments controller with synthetic hooks; not native/browser acceptance", () => {
  it("READ_ONLY-style collaboration sends exact frozen body/hash/UUID once, no case editing or schema request", async () => {
    const h = harness(); h.ready(); await h.editor.submit(); h.render(); expect(h.sent).toHaveLength(1); expect(h.sent[0].body).toBe("Exact plain text λ\n<not HTML>"); expect(Object.isFrozen(h.sent[0])).toBe(true); expect(h.sent[0]).not.toHaveProperty("customFields"); expect(h.editor.draft).toBeNull(); expect(h.editor.pending).toBeNull(); expect(h.counts).toEqual({ saved: 1, refresh: 1 });
  });
  it("same-tick double submit/field event cannot allocate another request or mutate captured text", async () => {
    const h = harness(); h.ready(); h.state.onHash = () => { h.editor.change("Newer text during hash"); }; const first = h.editor.submit(), second = h.editor.submit(); await Promise.all([first, second]); expect(h.sent).toHaveLength(1); expect(h.sent[0].body).toBe("Exact plain text λ\n<not HTML>");
  });
  it("hash preparation after view/actor loss sends nothing and preserves raw draft", async () => {
    const h = harness(); h.ready(); const draft = h.editor.draft; h.state.onHash = () => { h.params.active = false; h.render(); }; await h.editor.submit(); h.render(); expect(h.sent).toEqual([]); expect(h.editor.draft).toBe(draft); expect(h.editor.pending).toBeNull();
  });
  it.each(["close", "unmount", "session-A-B-A", "active-A-B-A", "case-reuse"])("matching known ACK after %s privately settles receipt but not draft/notice/cache effects", async loss => {
    const h = harness(); h.ready(); const draft = h.editor.draft, notice = h.editor.notice;
    h.state.onSend = () => { if (loss === "close") { h.editor.close(); h.render(); } else if (loss === "unmount") h.unmount(); else if (loss === "session-A-B-A") { h.reads.activation = "B"; h.render(); h.reads.activation = "A-returned"; h.render(); } else if (loss === "active-A-B-A") { h.params.active = false; h.render(); h.params.active = true; h.render(); } else { h.params.caseId = "other"; h.reads.fresh = null; h.render(); } };
    await h.editor.submit(); h.render(); expect(h.editor.pending).toBeNull(); expect(h.editor.draft).toBe(draft); expect(h.editor.notice).toBe(notice); expect(h.editor.settled).toBe(true); expect(h.counts).toEqual({ saved: 0, refresh: 0 }); await h.editor.submit(); expect(h.sent).toHaveLength(1);
  });
  it("confirmed old draft cannot be posted as a fresh UUID until explicit current-owner start-new", async () => {
    const h = harness(); h.ready(); h.state.onSend = () => { h.editor.close(); h.render(); }; await h.editor.submit(); h.render(); h.editor.show(); h.render(); await h.editor.submit(); expect(h.sent).toHaveLength(1); h.editor.change("Different comment"); expect(h.render().draft?.body).toContain("Exact plain"); h.editor.startNew(); h.render(); expect(h.editor.draft).toBeNull(); expect(h.editor.settled).toBe(false); h.state.onSend = null; h.editor.change("Deliberate second comment"); h.render(); await h.editor.submit(); expect(h.sent).toHaveLength(2); expect(h.sent[1].requestId).not.toBe(h.sent[0].requestId);
  });
  it("unknown ACK survives close/session return, typed later refusal and exact retry without rehash/body replacement", async () => {
    const h = harness(); h.ready(); h.state.failure = Error("Lost ACK"); await h.editor.submit(); h.render(); const held = h.editor.pending!; expect(held.everAmbiguous).toBe(true);
    h.editor.close(); h.render(); h.reads.activation = "B"; h.render(); h.reads.activation = "A-returned"; h.render(); h.editor.show(); h.render(); h.editor.change("Must not change pending body"); h.state.failure = { data: { code: "CONFLICT" } }; await h.editor.submit(); h.render(); expect(h.editor.pending?.input).toBe(held.input); expect(h.editor.pending?.requestHash).toBe(held.requestHash); expect(h.editor.draft).toBe(held.draft); h.state.failure = null; await h.editor.submit(); h.render(); expect(h.sent[1]).toBe(h.sent[0]); expect(h.sent[2]).toBe(h.sent[0]); expect(h.editor.pending).toBeNull();
  });
  it("first proven refusal unlocks edits; malformed body/hash/native ACKs retain exact unknown request", async () => {
    const h = harness(); h.ready(); h.state.failure = { data: { code: "BAD_REQUEST" } }; await h.editor.submit(); h.render(); expect(h.editor.pending).toBeNull(); expect(h.editor.draft).not.toBeNull();
    for (const wrong of ["body", "hash", "native"]) { const m = harness(); m.ready(); m.state.wrong = wrong; await m.editor.submit(); m.render(); expect(m.editor.pending?.everAmbiguous).toBe(true); expect(m.editor.draft).not.toBeNull(); expect(m.counts.saved).toBe(0); }
  });
  it("stale handlers after active/reader A-B-A cannot edit, clear or post the original draft", async () => {
    const h = harness(); h.ready(); const old = h.editor, draft = old.draft; h.params.active = false; h.render(); h.params.active = true; h.render(); old.change("Stale body"); await old.submit(); h.render(); expect(h.editor.draft).toBe(draft); expect(h.sent).toEqual([]);
  });
  it("native remapping/current-read failure prevents recovery without discarding pending input", async () => {
    const h = harness(); h.ready(); h.state.failure = Error("Unknown"); await h.editor.submit(); h.render(); const held = h.editor.pending; h.reads.fresh = { ...h.reads.fresh, readScope: { ...scope, actorId: "replacement" } }; h.render(); await h.editor.submit(); expect(h.sent).toHaveLength(1); expect(h.editor.pending).toBe(held); expect(h.editor.readable).toBe(false);
  });
  it("known ACK refresh failure never recreates pending work or sends another comment", async () => {
    const h = harness(); h.ready(); h.state.callbackFail = true; await h.editor.submit(); h.render(); await h.editor.submit(); expect(h.sent).toHaveLength(1); expect(h.editor.pending).toBeNull(); expect(h.editor.notice).toContain("Refresh comments only");
  });
  it("closing the composer retains the draft and current read-only browsing; stale pre-close read handlers still refuse", () => {
    const h = harness(); h.ready(); const old = h.editor, draft = old.draft; h.editor.close(); h.render(); expect(h.editor.canHandle()).toBe(false); expect(h.editor.canRead()).toBe(true); expect(old.canRead()).toBe(false); expect(h.editor.draft).toBe(draft);
  });
});
