// ActionButton is a native-button boundary in this synthetic controller fixture.
// Its real DOM/event/tooltip behavior is tested in action-button-ui.test.mjs.
// Actual complete Web JSX and actual native schema/hash declarations. Hook,
// Clerk SDK, RPC and Modal boundaries are synthetic; this is not ReactDOM,
// authenticated native mutation, alias-resolution or deployment acceptance.
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { manualStartDefinitivelyRejected } from "./manual-run-start";
import type { RouterInputs, RouterOutputs } from "./trpcReact";

type Input = RouterInputs["project"]["saveCaseKey"];
type Identity = RouterOutputs["project"]["caseIdentity"];
type Receipt = RouterOutputs["project"]["saveCaseKey"];
type Element = React.ReactElement<Record<string, unknown>>;
function elements(value: unknown, list: Element[] = []): Element[] {
  if (React.isValidElement(value)) { const element = value as Element; list.push(element); elements(element.props.children, list); }
  else if (Array.isArray(value)) value.forEach(child => elements(child, list));
  return list;
}
function text(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : React.isValidElement(value) ? text(((value as Element).props.tooltip ?? (value as Element).props.children)) : Array.isArray(value) ? value.map(text).join("") : ""; }
const source = readFileSync(new URL("../components/ProjectCaseKey.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const nativeSource = readFileSync(new URL("../../api/src/services/projectCaseKeys.ts", import.meta.url), "utf8");
const nativeAst = ts.createSourceFile("projectCaseKeys.ts", nativeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
// Use the native package's already-installed direct dependency; Web receives
// no new dependency and no service module is imported.
const { z } = createRequire(new URL("../../api/package.json", import.meta.url))("zod") as { z: unknown };
// Extract only the fixed pure declarations; never import Prisma, service/router
// code or run any native transaction. Fail closed if the genuine names change.
const pureNames = ["id", "projectCaseKeySchema", "projectCaseKeySave", "projectCaseKeyRequestHash"];
const printer = ts.createPrinter();
const pureSource = pureNames.map(name => {
  const statement = nativeAst.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(nativeAst) === name) || ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!statement) throw Error("Missing actual pure native declaration: " + name);
  return printer.printNode(ts.EmitHint.Unspecified, statement, nativeAst).replace(/^export /m, "");
}).join("\n");
const native = new Function("z", "createHash", ts.transpileModule(pureSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText + "\nreturn { projectCaseKeySave, projectCaseKeyRequestHash };")(z, createHash) as {
  projectCaseKeySave: { parse: (input: unknown) => Input };
  projectCaseKeyRequestHash: (input: Input, actorId: string) => string;
};

function harness() {
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
  const slots: Slot[] = [], effects: Array<() => void> = [], sent: Input[] = [], reads: unknown[] = [], invalidations: unknown[] = [];
  let cursor = 0, tree: React.ReactNode, uuid = 0, refetches = 0;
  const issued: Array<{ count: number; resolve: () => void }> = [];
  const props = { projectId: "synthetic-p", canEdit: true };
  const auth = { isLoaded: true, isSignedIn: true, userId: "synthetic-Clerk", sessionId: "synthetic-session-A" };
  const window = { Clerk: { loaded: true, session: { id: auth.sessionId, user: { id: auth.userId } } } };
  const initial: Identity = { projectId: props.projectId, organizationId: "synthetic-org", actorId: "synthetic-native-user", actorClerkUserId: auth.userId, caseKey: "old", revision: 3, allocatedCount: 851, keyLocked: false, canEdit: true };
  const query = { data: initial as Identity | undefined, error: null as unknown, isFetching: false, isPaused: false, isFetchedAfterMount: true, refetch: async () => { refetches++; if (readFailure) throw Error("Private read error"); return { data: query.data }; } };
  let mutationPending = false, readFailure = false, cacheFailure = false;
  let respond: (input: Input) => Promise<unknown> = async input => acknowledgement(input);
  const same = (left: readonly unknown[] | undefined, right: readonly unknown[]) => !!left && left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  const hooks = { ...React, useId: () => "synthetic-help-id", useState: (initialValue: unknown) => {
    const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initialValue === "function" ? (initialValue as () => unknown)() : initialValue };
    return [slots[index]!.value, (next: unknown) => { slots[index]!.value = typeof next === "function" ? (next as (previous: unknown) => unknown)(slots[index]!.value) : next; }];
  }, useRef: (initialValue: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = { value: { current: initialValue } }; return slots[index]!.value; },
  useMemo: (factory: () => unknown, deps: readonly unknown[]) => { const index = cursor++; if (!(index in slots) || !same(slots[index]!.deps, deps)) slots[index] = { value: factory(), deps }; return slots[index]!.value; },
  useLayoutEffect: (effect: () => (() => void) | void, deps: readonly unknown[]) => { const index = cursor++; if (!(index in slots) || !same(slots[index]!.deps, deps)) {
    const previous = slots[index]; slots[index] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[index]!.cleanup = effect() || undefined; });
  } } };
  const Modal = (p: Record<string, unknown>) => p.open ? React.createElement("section", { "aria-label": p.title as string }, p.children as React.ReactNode) : null;
  const api = { useUtils: () => ({ project: { caseIdentity: { invalidate: async (input: unknown) => { invalidations.push(input); if (cacheFailure) throw Error("Private cache failure"); } } }, testCases: { list: { invalidate: async (input: unknown) => { invalidations.push(input); if (cacheFailure) throw Error("Private cache failure"); } } } }), project: {
    caseIdentity: { useQuery: (input: unknown, options: unknown) => { reads.push({ input, options }); return query; } },
    saveCaseKey: { useMutation: () => ({ isPending: mutationPending, mutateAsync: async (input: Input) => { native.projectCaseKeySave.parse(input); sent.push(input); issued.filter(waiter => sent.length >= waiter.count).forEach(waiter => waiter.resolve()); return respond(input); } }) },
  } };
  const modules: Record<string, unknown> = { react: hooks, "@clerk/nextjs": { useAuth: () => auth }, "@/lib/trpcReact": { trpcReact: api }, "@/lib/auth-query-cache": { currentSessionScope, sameAuthScope }, "@/lib/manual-run-start": { manualStartDefinitivelyRejected }, "@/components/Modal": { Modal } };
  const exports: { ProjectCaseKey?: (p: typeof props) => React.ReactNode } = {};
  new Function("require", "exports", "React", "window", "crypto", compiled)((name: string) => {
    if (name === "@/components/ui/ActionButton") return { ActionButton: "button" };
 if (!(name in modules)) throw Error("Unexpected dependency: " + name); return modules[name]; }, exports, React, window, { subtle: webcrypto.subtle, randomUUID: () => `10000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` });
  function acknowledgement(input: Input): Receipt { return { projectId: input.projectId, organizationId: input.originalOrganizationId, actorId: input.expectedNativeActorId, actorClerkUserId: input.expectedClerkActorId,
    requestId: input.requestId, requestHash: native.projectCaseKeyRequestHash(input, input.expectedNativeActorId), beforeKey: input.expectedCaseKey, caseKey: input.caseKey, beforeRevision: input.expectedRevision,
    revision: input.expectedRevision + (input.caseKey === input.expectedCaseKey ? 0 : 1), keyLocked: false, aliasesPreserved: true, replayed: sent.length > 1 }; }
  function render() { cursor = 0; effects.length = 0; tree = exports.ProjectCaseKey!(props); effects.splice(0).forEach(effect => effect()); }
  async function flush() { for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setImmediate(resolve)); render(); }
  function button(label: string) { const element = elements(tree).find(e => e.type === "button" && text(e.props.children).replace(/\s+/g, " ").trim() === label); if (!element) throw Error("Missing button: " + label); return element; }
  function click(label: string) { const element = button(label); expect(element.props.disabled).not.toBe(true); (element.props.onClick as () => void)(); render(); }
  function input(type: string) { const element = elements(tree).find(e => e.type === "input" && (e.props.type ?? "text") === type); if (!element) throw Error("Missing input: " + type); return element; }
  function change(value: string) { (input("text").props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); render(); }
  function submitHandler() { const form = elements(tree).find(e => e.type === "form")!; return form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>; }
  function submit() { const completion = submitHandler()({ preventDefault() {} }); render(); return completion; }
  render();
  return { props, auth, window, initial, query, sent, reads, invalidations, render, flush, button, click, input, change, submit, submitHandler, acknowledgement, waitForRequest: (count: number) => sent.length >= count ? Promise.resolve() : new Promise<void>(resolve => issued.push({ count, resolve })), html: () => renderToStaticMarkup(tree), get tree() { return tree; }, get uuidCount() { return uuid; }, get refetchCount() { return refetches; }, respond: (value: typeof respond) => { respond = value; }, mutationPending: (value: boolean) => { mutationPending = value; }, cacheFailure: (value: boolean) => { cacheFailure = value; }, readFailure: (value: boolean) => { readFailure = value; }, unmount: () => { slots.forEach(slot => slot.cleanup?.()); } };
}
function reviewed() { const h = harness(); h.click("Change key"); h.change("  ATE  "); return h; }
it("offers renaming for 851 existing cases with a compact example and truthful preservation explanation", () => {
  const h = harness(); expect(h.html()).toContain("Example: old-01"); h.click("Change key");
  expect(h.html()).toContain("851 cases keep their IDs and numbers"); expect(h.html()).toContain("Old keys remain aliases"); expect(h.html()).toContain("saved evidence is unchanged");
  expect(h.html()).not.toContain("fixed after the first case"); expect(h.sent).toEqual([]);
  expect(h.reads[0]).toMatchObject({ input: { projectId: "synthetic-p", expectedClerkActorId: "synthetic-Clerk" }, options: { enabled: true, retry: false, staleTime: 0 } });
});
it("saves valid letters directly with strict native pins and the actual native hash receipt", async () => {
  const h = harness(); h.click("Change key"); h.change("  ATE  ");
  expect(h.button("Save").props.disabled).toBe(false); expect(elements(h.tree).some(e => e.type === "input" && e.props.type === "checkbox")).toBe(false);
  await h.submit(); await h.flush(); expect(h.sent).toHaveLength(1);
  expect(h.sent[0]).toEqual({ projectId: "synthetic-p", originalOrganizationId: "synthetic-org", expectedClerkActorId: "synthetic-Clerk", expectedNativeActorId: "synthetic-native-user", requestId: "10000000-0000-4000-8000-000000000001", expectedCaseKey: "old", expectedRevision: 3, caseKey: "ate" });
  expect(Object.isFrozen(h.sent[0])).toBe(true); expect(h.html()).toContain("Project key renamed"); expect(h.html()).not.toContain('aria-label="Project key"');
  expect(h.invalidations).toEqual([{ projectId: "synthetic-p" }, { projectId: "synthetic-p" }]);
});
it.each(["fetching", "paused", "error", "cached", "signed-out", "SDK", "native-actor", "Clerk", "org", "project", "readonly", "parent-permission"])("%s refuses a captured submit and withholds private data when original scope is unverified", async state => {
  const h = reviewed(), old = h.submitHandler();
  if (state === "fetching") h.query.isFetching = true;
  if (state === "paused") h.query.isPaused = true;
  if (state === "error") h.query.error = Error("Private native failure");
  if (state === "cached") h.query.isFetchedAfterMount = false;
  if (state === "signed-out") h.auth.isSignedIn = false;
  if (state === "SDK") h.window.Clerk.session.user.id = "other-Clerk";
  if (state === "native-actor") h.query.data = { ...h.initial, actorId: "replacement-native-user" };
  if (state === "Clerk") { h.auth.userId = "other-Clerk"; h.window.Clerk.session.user.id = "other-Clerk"; h.query.data = { ...h.initial, actorClerkUserId: "other-Clerk" }; }
  if (state === "org") h.query.data = { ...h.initial, organizationId: "other-org" };
  if (state === "project") { h.props.projectId = "other-project"; h.query.data = { ...h.initial, projectId: "other-project" }; }
  if (state === "readonly") h.query.data = { ...h.initial, canEdit: false };
  if (state === "parent-permission") h.props.canEdit = false;
  h.render(); await old({ preventDefault() {} }); await h.flush(); expect(h.sent).toEqual([]); expect(h.uuidCount).toBe(0);
  expect(h.html()).not.toContain("Private native failure");
  if (!["readonly", "parent-permission"].includes(state)) { expect(h.html()).not.toContain("ATE"); expect(h.html()).not.toContain("851 cases"); }
  else expect(elements(h.tree).some(e => e.type === "fieldset" && e.props.disabled)).toBe(true);
});
it("changed current revision disables a new write, retains draft, and requires deliberate reload/review", async () => {
  const h = reviewed(), old = h.submitHandler(); h.query.data = { ...h.initial, caseKey: "other", revision: 4 }; h.render();
  await old({ preventDefault() {} }); await h.flush(); expect(h.sent).toEqual([]); expect(h.input("text").props.value).toBe("  ATE  ");
  expect(h.html()).toContain("Load current identity before reviewing another request"); h.click("Refresh"); expect(h.input("text").props.value).toBe("other");
  expect(h.button("Save").props.disabled).toBe(false); h.change("ate"); await h.submit(); await h.flush(); expect(h.sent[0]).toMatchObject({ expectedRevision: 4, expectedCaseKey: "other" });
});
it("UNKNOWN retains original request/UUID through mapping, actor, organization and revision changes and later refusal", async () => {
  const h = reviewed(); h.respond(async () => { throw Error("Synthetic lost acknowledgement"); }); await h.submit(); await h.flush();
  const original = h.sent[0]!; expect(h.html()).toContain("Retry"); expect(h.html()).toContain(original.requestId);
  for (const data of [{ ...h.initial, actorId: "replacement-native" }, { ...h.initial, organizationId: "other-org" }, { ...h.initial, actorClerkUserId: "other-Clerk" }]) {
    h.query.data = data; h.render(); expect(h.html()).not.toContain(original.requestId); expect(h.sent).toHaveLength(1);
  }
  h.query.data = { ...h.initial, caseKey: "ate", revision: 4 }; h.auth.sessionId = "refreshed-original-session"; h.render();
  expect(h.html()).not.toContain(original.requestId); // hook-only session refresh is not independent SDK proof
  h.window.Clerk.session.id = h.auth.sessionId; h.render();
  h.respond(async () => { throw { data: { code: "FORBIDDEN" } }; }); await h.submit(); await h.flush();
  expect(h.sent[1]).toBe(original); expect(h.html()).toContain(original.requestId);
  h.respond(async input => h.acknowledgement(input)); await h.submit(); await h.flush();
  expect(h.sent).toHaveLength(3); expect(h.sent.every(request => request === original)).toBe(true); expect(h.uuidCount).toBe(1);
  expect(h.html()).toContain("Project key renamed"); expect(h.html()).not.toContain("Retry");
});
it("first collision/refusal retains raw draft but requires a new deliberate review before another UUID", async () => {
  const h = reviewed(); h.respond(async () => { throw { data: { code: "CONFLICT" } }; }); await h.submit(); await h.flush();
  expect(h.html()).toContain("may be reserved"); expect(h.input("text").props.value).toBe("  ATE  "); expect(h.button("Save").props.disabled).toBe(true);
  await h.submit(); await h.flush(); expect(h.sent).toHaveLength(1); expect(h.uuidCount).toBe(1);
  h.click("Refresh"); h.change("other"); h.respond(async input => h.acknowledgement(input)); await h.submit(); await h.flush();
  expect(h.sent).toHaveLength(2); expect(h.sent[1]!.requestId).not.toBe(h.sent[0]!.requestId);
});
it.each(["actorId", "actorClerkUserId", "organizationId", "projectId", "requestId", "requestHash", "beforeKey", "caseKey", "beforeRevision", "revision", "keyLocked", "aliasesPreserved", "replayed", "extra"])("mismatched ACK %s cannot close or replace the retained request", async field => {
  const h = reviewed(); h.respond(async input => ({ ...h.acknowledgement(input), [field]: field === "beforeRevision" || field === "revision" ? 999 : field === "keyLocked" ? true : field === "aliasesPreserved" ? false : "foreign" }));
  await h.submit(); await h.flush(); expect(h.sent).toHaveLength(1); expect(h.html()).toContain("Retry"); expect(h.html()).toContain(h.sent[0]!.requestId); expect(h.invalidations).toEqual([]);
});
it("duplicate/captured callbacks cannot mint extra UUIDs or change a held request before or after ACK", async () => {
  const h = reviewed(), old = h.submitHandler();
  let resolve!: (value: unknown) => void; h.respond(() => new Promise(value => { resolve = value; }));
  const completion = old({ preventDefault() {} }); await old({ preventDefault() {} }); await h.waitForRequest(1); await h.flush(); expect(h.sent).toHaveLength(1); expect(h.uuidCount).toBe(1);
  const capturedChange = h.input("text").props.onChange as (event: { target: { value: string } }) => void;
  capturedChange({ target: { value: "replacement" } }); h.render(); expect(h.input("text").props.value).toBe("  ATE  ");
  resolve(h.acknowledgement(h.sent[0]!)); await completion; await h.flush(); await old({ preventDefault() {} }); await h.flush(); expect(h.sent).toHaveLength(1); expect(h.uuidCount).toBe(1);
});
it("a stale reviewed submit cannot send an older key after a newer input edit", async () => {
  const h = reviewed(), old = h.submitHandler(); h.change("newer"); await old({ preventDefault() {} }); await h.flush();
  expect(h.sent).toEqual([]); await h.submit(); await h.flush(); expect(h.sent[0]!.caseKey).toBe("newer");
});
it("valid ACK after access loss remains recoverable rather than rebinding the receipt", async () => {
  const h = reviewed(); let resolve!: (value: unknown) => void; h.respond(() => new Promise(value => { resolve = value; })); const completion = h.submit(); await h.waitForRequest(1); await h.flush();
  const original = h.sent[0]!; h.query.data = { ...h.initial, actorId: "replacement-native" }; h.render(); resolve(h.acknowledgement(original)); await completion; await h.flush();
  expect(h.html()).not.toContain(original.requestId); expect(h.invalidations).toEqual([]);
  h.query.data = { ...h.initial, caseKey: "ate", revision: 4 }; h.render(); expect(h.html()).toContain(original.requestId);
  h.respond(async input => h.acknowledgement(input)); await h.submit(); await h.flush(); expect(h.sent[1]).toBe(original); expect(h.html()).toContain("Project key renamed");
});
it("post-ACK cache failure stays acknowledged and offers a read retry without another write", async () => {
  const h = reviewed(); h.cacheFailure(true); await h.submit(); await h.flush();
  expect(h.html()).toContain("rename was acknowledged"); expect(h.html()).not.toContain("No change was submitted"); expect(h.html()).not.toContain("Private cache failure");
  h.cacheFailure(false); h.click("Refresh"); await h.flush(); expect(h.refetchCount).toBe(1); expect(h.sent).toHaveLength(1); expect(h.uuidCount).toBe(1);
});
it("unmount revokes a captured writer without discarding private state or issuing any request", async () => {
  const h = reviewed(), old = h.submitHandler(); h.unmount(); await old({ preventDefault() {} }); await h.flush(); expect(h.sent).toEqual([]); expect(h.uuidCount).toBe(0);
});
