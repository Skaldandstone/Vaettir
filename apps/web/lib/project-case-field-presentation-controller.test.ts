import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as helpers from "./project-case-field-presentation";
import { manualSummaryReadActivation } from "./manual-run-summary";
import { freshCasePresentation } from "./case-presentation-read";
import { caseFieldReadPins } from "./case-field-origin";
import type { FieldPresentationState } from "./project-case-field-presentation";

const source = readFileSync(new URL("../components/ProjectCaseFieldPresentation.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("control.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ProjectCaseFieldPresentationControl")!;
const component = printer.printNode(ts.EmitHint.Unspecified, declaration, ast).replace(/\bexport (?=function)/g, "");
const widgets = { AUTO: "Native default (no value changes)", TEXT_INPUT: "Single-line text", PARAGRAPH: "Multiline paragraph", DROPDOWN: "Dropdown", RADIO: "Radio choices", TRI_STATE: "Tri-state: unset / yes / no", CHECKBOX: "Checkbox with explicit unset control" };
const origin = { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-actor", caseId: null };
function native(): FieldPresentationState {
  return { projectId: origin.projectId, organizationId: origin.organizationId, caseId: null, readScope: { projectId: origin.projectId, organizationId: origin.organizationId, actorId: "synthetic-native", actorClerkUserId: origin.clerkActorId }, profileHash: "a".repeat(64), fieldSchemaHash: "b".repeat(64), fieldAuthoringSchemaHash: "c".repeat(64), definitionSchemaVersion: 3, definitionSupported: true, configurationSupported: true, canConfigure: true, warnings: [], definitionSchema: { version: 1, fields: [ { key: "notes", label: " Exact native label ", type: "TEXT", required: false, retired: false, options: [] }, { key: "choice", label: "Choice", type: "CHOICE", required: false, retired: false, options: ["one", "two"] }, { key: "flag", label: "Flag", type: "BOOLEAN", required: false, retired: false, options: [] } ] }, configuration: { version: 1, fields: { unknown: { widget: "AUTO", placeholder: "" } } } };
}
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return !React.isValidElement<Record<string, unknown>>(node) ? [] : [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)];
}
function deferred() { let resolve!: (value: unknown) => void, reject!: (cause: unknown) => void; const promise = new Promise<unknown>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
// The actual React click intentionally ignores its internally caught promise.
// Drain its awaited mutation/refresh turns, not a fabricated handler return.
async function drain() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function harness() {
  const hooks: unknown[] = [], effects: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  let cursor = 0, dirty = false, reads = 0, invalidations = 0;
  const auth = { isLoaded: true, isSignedIn: true, userId: origin.clerkActorId, sessionId: "synthetic-session" };
  const access = { origin, current: origin, fresh: { readScope: native().readScope }, readable: true, canConfigure: true, owns: (original: typeof origin) => access.canConfigure && access.readable && original.clerkActorId === auth.userId && original.organizationId === access.current.organizationId };
  let nextRead: ReturnType<typeof deferred> | null = null;
  const query = { data: native(), dataUpdatedAt: 100, isFetchedAfterMount: true, isPaused: false, isFetching: false, error: null as Error | null, refetch: () => { reads++; return nextRead ? nextRead.promise : Promise.resolve({ data: query.data, dataUpdatedAt: query.dataUpdatedAt, error: query.error, isFetching: query.isFetching, isPaused: query.isPaused }); } };
  const calls: unknown[] = [], nativeReadInputs: unknown[] = []; let response: ReturnType<typeof deferred> | null = null, refresh: ReturnType<typeof deferred> | null = null;
  const save = { isPending: false, mutateAsync: (input: unknown) => { calls.push(input); response = deferred(); return response.promise; } };
  function Modal(props: { open: boolean; children: React.ReactNode }) { return props.open ? React.createElement("div", { role: "dialog" }, props.children) : null; }
  const h: Record<string, unknown> = { React, ...helpers, manualSummaryReadActivation, freshCasePresentation, caseFieldReadPins, widgets, Modal, crypto: { randomUUID: () => "aa7d600c-453d-4c57-850c-1133f518b81d" }, useAuth: () => auth, useCaseFieldAccess: () => access,
    trpcReact: { useUtils: () => ({ client: { caseFieldPresentation: { get: { query: (input: unknown) => { reads++; nativeReadInputs.push(input); return nextRead ? nextRead.promise : Promise.reject(Error("Synthetic fixture has no new native response; cached query is not proof.")); } } } }, caseFieldPresentation: { get: { invalidate: async () => { invalidations++; if (refresh) await refresh.promise; } } }, project: { experience: { invalidate: async () => { invalidations++; } } } }), caseFieldPresentation: { get: { useQuery: (_input: unknown, options: { enabled: boolean }) => { h.enabled = options.enabled; return query; } }, configure: { useMutation: () => save } } },
    useState: (initial: unknown) => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = initial; return [hooks[index], (next: unknown) => { if (!Object.is(hooks[index], next)) { hooks[index] = next; dirty = true; } }]; },
    useRef: (initial: unknown) => { const index = cursor++; return hooks[index] ??= { current: initial }; },
  };
  const effect = (callback: () => (() => void) | undefined, deps: unknown[]) => { const index = cursor++, previous = effects[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { previous?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; } };
  h.useEffect = effect; h.useLayoutEffect = effect;
  vm.createContext(h); vm.runInContext(ts.transpileModule(component, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText, h);
  let tree: React.ReactElement;
  function render() { for (let i = 0; i < 15; i++) { dirty = false; cursor = 0; tree = (h.ProjectCaseFieldPresentationControl as (props: { projectId: string }) => React.ReactElement)({ projectId: origin.projectId }); if (!dirty) return tree; } throw Error("Synthetic hook controller did not settle."); }
  function button(label: string) { const match = elements(render()).find(node => node.type === "button" && React.Children.toArray(node.props.children as React.ReactNode).join("") === label); if (!match) throw Error(`Missing button: ${label}`); return match.props; }
  function click(label: string) { return (button(label).onClick as () => unknown)(); }
  function html() { return renderToStaticMarkup(render()); }
  function load() { click("Configure custom-field presentation"); render(); query.dataUpdatedAt++; render(); click("Load current settings for review"); render(); }
  function review() { const textarea = elements(render()).find(node => node.type === "textarea")!; (textarea.props.onChange as (event: unknown) => void)({ target: { value: " explicit native review " } }); render(); click("Review unsaved presentation"); render(); const checkbox = elements(render()).find(node => node.type === "input" && node.props.type === "checkbox")!; (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } }); render(); }
  function close() { const modal = elements(render()).find(node => node.type === Modal)!; (modal.props.onClose as () => void)(); render(); }
  function ack(input: unknown = calls.at(-1)) { const request = input as { requestId: string }; return { projectId: origin.projectId, organizationId: origin.organizationId, actorClerkUserId: origin.clerkActorId, requestId: request.requestId, replayed: false }; }
  function freshRead(data = native()) { const held = nextRead!; nextRead = null; held.resolve(data); }
  return { auth, access, query, calls, nativeReadInputs, render, click, button, html, load, review, close, ack, freshRead, holdRead: () => nextRead = deferred(), response: () => response!, reads: () => reads, invalidations: () => invalidations, holdRefresh: () => refresh = deferred(), unmount: () => effects.forEach(effect => effect?.cleanup?.()) };
}
describe("actual custom-field presentation controller source", () => {
  it("waits for fresh settings after open/reopen or same-session recovery; renders compatible dropdowns and exact retained mappings", () => {
    const host = harness(); host.render(); host.click("Configure custom-field presentation");
    expect(host.html()).not.toContain("Load current settings for review"); expect(host.reads()).toBe(1);
    host.query.dataUpdatedAt++; host.render(); host.click("Load current settings for review");
    let html = host.html(); for (const text of [" Exact native label ", "Single-line text", "Multiline paragraph", "Radio choices", "Tri-state: unset / yes / no", "Unknown saved mapping", "Hide only when native value is absent", "Null, empty text, whitespace, false and zero"]) expect(html).toContain(text);
    host.close(); host.click("Configure custom-field presentation"); expect(host.html()).toContain("Cached settings cannot authorize"); expect(host.button("Review unsaved presentation").disabled).toBe(true);
    host.query.dataUpdatedAt++; expect(host.html()).not.toContain("Awaiting a fresh");
    host.auth.isSignedIn = false; html = host.html(); expect(html).not.toContain(" Exact native label ");
    host.auth.isSignedIn = true; expect(host.html()).toContain("Cached settings cannot authorize");
    host.query.dataUpdatedAt++; expect(host.html()).not.toContain("Awaiting a fresh");
  });
  it("freezes the actual reviewed request, prevents double send and retains exact UNKNOWN content through close/access loss and later refusal", async () => {
    const host = harness(); host.load(); host.review(); const task = host.click("Save reviewed presentation") as Promise<void>;
    expect(host.calls).toHaveLength(1); const original = host.calls[0]; expect(Object.isFrozen(original)).toBe(true);
    host.click("Retry identical presentation request"); expect(host.calls).toHaveLength(1);
    host.close(); host.access.canConfigure = false; host.render(); host.response().reject(Error("synthetic lost response")); await task; await drain();
    host.access.canConfigure = true; host.render(); host.click("Configure custom-field presentation"); host.query.dataUpdatedAt++; host.render();
    expect(host.html()).toContain("previous response was uncertain"); const retry = host.click("Retry identical presentation request") as Promise<void>;
    expect(host.calls[1]).toBe(original); host.response().reject({ data: { code: "FORBIDDEN" } }); await retry; await drain();
    expect(host.html()).toContain("previous response was uncertain"); expect(host.html()).toContain("aa7d600c-453d-4c57-850c-1133f518b81d");
    host.auth.sessionId = "another-session"; host.render(); expect(host.html()).not.toContain("aa7d600c"); expect(host.html()).toContain("unchanged original account");
  });
  it("valid ACK after close settles receipt but does not clear/rebase the retained draft or refresh another frame", async () => {
    const host = harness(); host.load(); host.review(); const task = host.click("Save reviewed presentation") as Promise<void>;
    host.close(); host.response().resolve(host.ack()); await task; await drain();
    expect(host.invalidations()).toBe(0); host.click("Configure custom-field presentation"); host.query.dataUpdatedAt++; host.render();
    expect(host.html()).toContain(" Exact native label "); expect(host.html()).toContain(" explicit native review "); expect(host.html()).not.toContain("Retry identical presentation request"); expect(host.button("Save reviewed presentation").disabled).toBe(true);
  });
  it("ACK pin mismatch stays UNKNOWN; unmount cannot clear the draft or run cache side effects", async () => {
    const host = harness(); host.load(); host.review(); let task = host.click("Save reviewed presentation") as Promise<void>;
    host.response().resolve({ ...host.ack(), organizationId: "another-org" }); await task; await drain(); expect(host.html()).toContain("previous response was uncertain");
    task = host.click("Retry identical presentation request") as Promise<void>; host.unmount(); host.response().resolve(host.ack()); await task; await drain();
    expect(host.invalidations()).toBe(0);
  });
  it("same-frame success consumes only the exact receipt and refreshes after ACK, not as a write retry", async () => {
    const host = harness(); host.load(); host.review(); const task = host.click("Save reviewed presentation") as Promise<void>;
    host.response().resolve(host.ack()); await task; await drain(); expect(host.invalidations()).toBe(2); expect(host.calls).toHaveLength(1);
    expect(host.html()).toContain("Saved custom-field presentation"); expect(host.html()).not.toContain("role=\"dialog\"");
  });
  it("unsupported current native settings never fabricate a replacement draft", () => {
    const host = harness(); host.query.data.configurationSupported = false; host.load();
    expect(host.html()).toContain("unsupported and remain read-only"); expect(host.html()).not.toContain("Review unsaved presentation"); expect(host.html()).not.toContain("Save reviewed presentation"); expect(host.calls).toHaveLength(0);
  });
  it("an exact retained request can recover while the new settings read fails; never replaces its UUID or hashes", async () => {
    const host = harness(); host.load(); host.review(); host.click("Save reviewed presentation");
    host.response().reject(Error("synthetic lost response")); await drain(); const input = host.calls[0];
    host.query.error = Error("synthetic current settings unreadable"); host.render();
    expect(host.button("Retry identical presentation request").disabled).toBe(false);
    host.click("Retry identical presentation request"); expect(host.calls[1]).toBe(input);
    host.response().resolve(host.ack()); await drain(); expect(host.html()).toContain("Saved custom-field presentation");
  });
  it("session loss during refresh prevents further post-await cache side effects or uncertain-write replacement", async () => {
    const host = harness(); host.load(); host.review(); const refresh = host.holdRefresh(); host.click("Save reviewed presentation");
    host.response().resolve(host.ack()); await drain(); expect(host.invalidations()).toBe(1);
    host.auth.sessionId = "new-session"; host.render(); refresh.resolve(undefined); await drain();
    expect(host.invalidations()).toBe(1); expect(host.calls).toHaveLength(1); expect(host.html()).not.toContain("Saved custom-field presentation");
  });
  it("a fresh settings refusal revokes private controls even if the other access read is still cached", () => {
    const host = harness(); host.load(); host.query.data = { ...host.query.data, canConfigure: false }; host.query.dataUpdatedAt++;
    expect(host.html()).toContain("current full Owner/Admin access"); expect(host.html()).not.toContain(" Exact native label "); expect(host.calls).toHaveLength(0);
  });
  it("explicit fresh verification then adoption recovers a same-native-actor renewed session without altering the original receipt", async () => {
    const host = harness(); host.load(); host.review(); host.click("Save reviewed presentation"); host.response().reject(Error("synthetic unknown response")); await drain();
    const held = host.calls[0] as { requestId: string; expectedProfileHash: string; expectedFieldSchemaHash: string }, priorReads = host.reads();
    host.auth.sessionId = "renewed-session"; host.render();
    expect(host.html()).not.toContain(" Exact native label "); expect(host.html()).not.toContain(held.requestId);
    host.holdRead(); host.click("Verify current session"); expect(host.reads()).toBe(priorReads + 1);
    expect(host.nativeReadInputs).toEqual([{ projectId: origin.projectId, originalOrganizationId: origin.organizationId, expectedClerkActorId: origin.clerkActorId }]);
    expect(host.html()).not.toContain("Adopt verified current session");
    host.freshRead(); await drain(); expect(host.html()).toContain("Adopt verified current session");
    expect(host.html()).not.toContain(" Exact native label "); expect(host.html()).not.toContain(held.requestId);
    host.click("Adopt verified current session"); expect(host.html()).toContain(" Exact native label "); expect(host.html()).toContain(held.requestId);
    expect(host.html()).toContain("original receipt session"); host.click("Retry identical presentation request");
    expect(host.calls[1]).toBe(held); expect((host.calls[1] as typeof held).expectedProfileHash).toBe("a".repeat(64)); expect((host.calls[1] as typeof held).expectedFieldSchemaHash).toBe("b".repeat(64));
    host.response().resolve(host.ack()); await drain(); expect(host.html()).toContain("Saved custom-field presentation"); expect(host.invalidations()).toBe(2);
  });
  it("cannot adopt cached results or join an old in-flight read; new verification refuses changed native identity/admin status", async () => {
    const host = harness(); host.load(); host.auth.sessionId = "renewed-session"; host.render(); const reads = host.reads();
    host.query.isFetching = true; host.render(); host.click("Verify current session"); expect(host.reads()).toBe(reads);
    host.query.isFetching = false; host.render(); host.click("Verify current session"); await drain();
    expect(host.html()).not.toContain("Adopt verified current session"); expect(host.html()).not.toContain(" Exact native label ");
    for (const patch of [{ canConfigure: false }, { readScope: { ...native().readScope, actorId: "replacement-native-actor" } }, { readScope: { ...native().readScope, actorClerkUserId: "other-clerk" } }, { organizationId: "other-org" }]) {
      host.holdRead(); host.click("Verify current session"); host.freshRead({ ...native(), ...patch }); await drain();
      expect(host.html()).not.toContain("Adopt verified current session"); expect(host.html()).not.toContain(" Exact native label ");
    }
  });
  it("A-B-A authorization transitions revoke a deferred verification even when the final session string matches", async () => {
    const host = harness(); host.load(); host.review(); host.auth.sessionId = "renewed-session"; host.render();
    host.holdRead(); host.click("Verify current session"); host.auth.sessionId = "third-session"; host.render(); host.auth.sessionId = "renewed-session"; host.render();
    host.freshRead(); await drain(); expect(host.html()).not.toContain("Adopt verified current session"); expect(host.html()).not.toContain(" Exact native label ");
    host.holdRead(); host.click("Verify current session"); host.freshRead(); await drain();
    host.click("Adopt verified current session"); host.query.dataUpdatedAt++; host.render();
    expect(host.button("Save reviewed presentation").disabled).toBe(true); expect(host.html()).not.toContain("I reviewed these exact");
  });
  it("session verification/adoption is blocked while the original write is busy and never transfers to another actor/org", async () => {
    const host = harness(); host.load(); host.review(); host.click("Save reviewed presentation"); host.auth.sessionId = "renewed-session"; host.render(); const reads = host.reads();
    host.click("Verify current session"); expect(host.reads()).toBe(reads); host.response().reject(Error("synthetic unknown")); await drain();
    host.auth.userId = "another-clerk"; host.render(); expect(host.html()).not.toContain("Verify current session"); expect(host.html()).not.toContain(" Exact native label ");
    host.auth.userId = origin.clerkActorId; host.access.current = { ...origin, organizationId: "other-org" }; host.render();
    expect(host.html()).not.toContain("Verify current session"); expect(host.html()).not.toContain("aa7d600c");
  });
  it("a read error or modal close revokes recovery proof without changing a held draft/request", async () => {
    const host = harness(); host.load(); host.auth.sessionId = "renewed-session"; host.render();
    const read = host.holdRead(); host.click("Verify current session"); read.reject(Error("synthetic native read failed")); await drain();
    expect(host.html()).not.toContain("Adopt verified current session"); expect(host.html()).not.toContain(" Exact native label ");
    host.holdRead(); host.click("Verify current session"); host.close(); host.freshRead(); await drain();
    host.click("Recover retained settings in this session"); expect(host.html()).not.toContain("Adopt verified current session"); expect(host.html()).not.toContain(" Exact native label ");
  });
  it("a changed query revision invalidates explicit adoption even after its independent native read completed", async () => {
    const host = harness(); host.load(); host.auth.sessionId = "renewed-session"; host.render(); host.holdRead(); host.click("Verify current session"); host.freshRead(); await drain();
    expect(host.button("Adopt verified current session").disabled).toBe(false); host.query.dataUpdatedAt++; host.render();
    expect(host.button("Adopt verified current session").disabled).toBe(true); host.click("Adopt verified current session");
    expect(host.html()).not.toContain(" Exact native label "); expect(host.html()).toContain("Verification is no longer current");
  });
  it("a saved ACK arriving after access loss and return cannot clear the retained draft by A-B-A coincidence", async () => {
    const host = harness(); host.load(); host.review(); host.click("Save reviewed presentation");
    host.access.canConfigure = false; host.render(); host.access.canConfigure = true; host.render();
    host.response().resolve(host.ack()); await drain(); expect(host.invalidations()).toBe(0);
    expect(host.html()).toContain(" Exact native label "); expect(host.html()).toContain(" explicit native review "); expect(host.html()).not.toContain("Retry identical presentation request");
    expect(host.button("Save reviewed presentation").disabled).toBe(true);
  });
});
