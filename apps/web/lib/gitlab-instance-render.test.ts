import React, { createElement } from "react";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { connectionAccessState } from "./connection-access";
import { gitlabInstanceOrigin } from "./gitlab-instance-selection";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { sameCaseFieldOrigin, type CaseFieldOrigin } from "./case-field-origin";
import type { RouterInputs, RouterOutputs } from "./trpcReact";
import type { RepositoryOAuthConnection as Component } from "../components/GitlabRepositoryConnection";
const mock = { begin: vi.fn(), connections: [] as Array<{ id: string; provider: string; origin: string }> };
const sdk = { trpcReact: {
  useUtils: () => ({}),
  repositoryConnections: {
    groups:{useQuery:()=>({data:{groups:[],hasMore:false,limitReached:false},error:null})},
    configurations: { useQuery: () => ({ isSuccess: true, data: { organizationId: "synthetic-org", configurations: mock.connections, canConnect: true, canConfigure: true, storageReady: true } }) },
    mine: { useQuery: () => ({ isSuccess: true, data: [] }) },
    status: { useQuery: () => ({ isSuccess: false }) },
    begin: { useMutation: () => ({ mutateAsync: mock.begin, isPending: false }) },
    connectSelected: { useMutation: () => ({ isPending: false }) },
    disconnect: { useMutation: () => ({ isPending: false }) },
  },
} };
// Transpile the complete actual module, avoiding Vite's jsx:preserve limitation.
// Explicit stubs are synthetic SDK reads only, never runtime or OAuth proof.
const code = ts.transpileModule(readFileSync(new URL("../components/GitlabRepositoryConnection.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const imports: Record<string, unknown> = {
  react: React,
  "next/link": { __esModule: true, default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement("a", { href }, children) },
  "@/lib/trpcReact": sdk,
  "./SourceConnectionChips": { ProviderMark: () => null },
  "@/lib/connection-access": { connectionAccessState },
  "./ConnectionAccessGate": { ConnectionAccessGate: () => null },
  "./RepositoryProviderPicker": { cancelRepositoryAuthorization: vi.fn() },
  "@/lib/repository-authorization": { authorizeRepositoryAccount: vi.fn(() => { throw new Error("No authorization in SSR fixture"); }) },
  "@/lib/gitlab-instance-selection": { gitlabInstanceOrigin },
  "@clerk/nextjs": { useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "synthetic-clerk", sessionId: "synthetic-session" }) },
  "@/lib/use-case-field-access": { useCaseFieldAccess: () => ({ origin: { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-clerk", caseId: null }, current: { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-clerk", caseId: null }, readable: true, canEdit: true, owns: () => true, query: { refetch: vi.fn() } }) },
  "@/lib/auth-query-cache": { currentSessionScope, sameAuthScope },
  "@/lib/case-field-origin": { sameCaseFieldOrigin },
};
const context = vm.createContext({ React, URL, console, exports: {}, window: { Clerk: { loaded: true, session: { id: "synthetic-session", user: { id: "synthetic-clerk" } } } }, require: (name: string) => {
  if (!Object.hasOwn(imports, name)) throw new Error("Unexpected component dependency");
  return imports[name];
} });
vm.runInContext(code, context);
const RepositoryOAuthConnection = (context.exports as { RepositoryOAuthConnection: typeof Component }).RepositoryOAuthConnection;

describe("actual GitLab connection presentation with synthetic SDK reads", () => {
  it("renders an instance URL field and refuses to infer the sole configured GitLab.com host", () => {
    mock.connections = [{ id: "synthetic-cloud", provider: "gitlab", origin: "https://gitlab.com" }];
    const html = renderToStaticMarkup(createElement(RepositoryOAuthConnection, { projectId: "synthetic-project", providerId: "gitlab", onConnected: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain("GitLab instance or project URL");
    expect(html).toContain("Choose your GitLab instance above.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Connect GitLab<\/button>/);
    expect(html).not.toContain("Connect to <strong>");
    expect(mock.begin).not.toHaveBeenCalled();
  });
  it("preserves GitHub's explicit cloud configuration rather than breaking its existing flow", () => {
    mock.connections = [{ id: "synthetic-github", provider: "github", origin: "https://github.com" }];
    const html = renderToStaticMarkup(createElement(RepositoryOAuthConnection, { projectId: "synthetic-project", providerId: "github", onConnected: vi.fn(), onClose: vi.fn() }));
    expect(html).toContain("Connect to <strong>github.com</strong>");
    expect(html).not.toContain("GitLab instance or project URL");
    expect(mock.begin).not.toHaveBeenCalled();
  });
});

type ListInput = RouterInputs["repositoryConnections"]["list"];
type Listing = RouterOutputs["repositoryConnections"]["list"];
type ConnectInput = RouterInputs["repositoryConnections"]["connectSelected"];
type Event = { preventDefault: () => void; target: { value: string } };
type Element = React.ReactElement<{ children?: React.ReactNode; className?: string; disabled?: boolean; value?: string; onClick?: () => unknown; onChange?: (event: Event) => void; onSubmit?: (event: Event) => unknown }>;
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node as Element, ...elements(node.props.children)];
}
function text(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return text(node.props.children);
  return React.Children.toArray(node).map(text).join("");
}
function required<T>(value: T | undefined): T { if (value === undefined) throw Error("Missing actual synthetic evidence"); return value; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function listing(ids: string[], reset = false, hasMore = true): Listing { return { repositories: ids.map(id => ({ id, name: `Synthetic ${id}`, url: `https://synthetic-gitlab.example.com/repositories/${id}`, defaultBranch: "main" })), catalogReset: reset, hasMore, catalogVersion: reset ? "b".repeat(64) : "a".repeat(64),limitReached:false,listingStatus:hasMore?"more-pages":"end-of-scope",scopeKey:null }; }

/** Complete actual OAuth adapter JSX/hooks/events plus production scope helpers.
 * Synthetic metadata boundaries only, not authorization or native/provider proof. */
function workflow() {
  const origin: CaseFieldOrigin = { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-clerk", caseId: null };
  const auth = { isLoaded: true, isSignedIn: true, userId: origin.clerkActorId, sessionId: "synthetic-session" };
  const liveSdk = { loaded: true, session: { id: auth.sessionId, user: { id: auth.userId } } };
  const reader = { origin, current: origin as CaseFieldOrigin | null, readable: true, canEdit: true, query: { refetch: vi.fn() }, owns: (original: CaseFieldOrigin, mode = "read") => sameCaseFieldOrigin(original, reader.current) && (mode !== "edit" || reader.canEdit) };
  const props: Parameters<typeof Component>[0] = { projectId: origin.projectId, providerId: "gitlab", active: true, onConnected: vi.fn(), onClose: vi.fn() };
  const configurations = { isSuccess: true, isFetching: false, isPaused: false, error: null as unknown, data: { organizationId: origin.organizationId, canConnect: true, canConfigure: false, storageReady: true, configurations: [{ id: "synthetic-config", provider: "gitlab", origin: "https://synthetic-gitlab.example.com" }] }, refetch: vi.fn() };
  const recent = { isSuccess: true, isFetching: false, isPaused: false, error: null as unknown, data: [{ id: "synthetic-connection", provider: "gitlab", origin: "https://synthetic-gitlab.example.com", accessMethod: "oauth", accountLabel: "Synthetic account", status: "VERIFIED" }], refetch: vi.fn() };
  const status = { isSuccess: true, isFetching: false, isPaused: false, error: null as unknown, data: { status: "VERIFIED", accountLabel: "Synthetic account" }, refetch: vi.fn() };
  const fetchList = vi.fn<(input: ListInput) => Promise<Listing>>(async () => listing(["repo-1", "repo-2"]));
  const connect = { isPending: false, mutateAsync: vi.fn<(input: ConnectInput) => Promise<{ connected: number }>>(async input => ({ connected: input.repositoryIds.length })) };
  const forbidden = vi.fn(() => { throw Error("No OAuth popup, credential, provider or source actions in fixture"); });
  const utils = { repositoryConnections: { list: { fetch: fetchList } } };
  const slots: Slot[] = [], effects: Array<() => void> = [];
  let cursor = 0, dirty = false, current: React.ReactElement;
  function slot() { const index = cursor++; return slots[index] ?? (slots[index] = {}); }
  function sameDeps(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) { return !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])); }
  function memo(make: () => unknown, deps?: readonly unknown[]) { const held = slot(); if (!sameDeps(held.deps, deps)) { held.deps = deps; held.value = make(); } return held.value; }
  function effect(make: () => unknown, deps?: readonly unknown[]) { const held = slot(); if (!sameDeps(held.deps, deps)) { held.deps = deps; effects.push(() => { held.cleanup?.(); const cleanup = make(); held.cleanup = typeof cleanup === "function" ? cleanup as () => void : undefined; }); } }
  const harnessContext = vm.createContext({ React, URL, Error, Object, connectionAccessState, gitlabInstanceOrigin, currentSessionScope, sameAuthScope, sameCaseFieldOrigin,
    useAuth: () => auth, useCaseFieldAccess: () => reader, window: { Clerk: liveSdk },
    useState: (initial: unknown) => { const held = slot(); if (!Object.hasOwn(held, "value")) held.value = initial; return [held.value, (next: unknown) => { const value = typeof next === "function" ? next(held.value) : next; if (!Object.is(value, held.value)) { held.value = value; dirty = true; } }]; },
    useRef: (initial: unknown) => { const held = slot(); if (!Object.hasOwn(held, "value")) held.value = { current: initial }; return held.value; },
    useMemo: memo, useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps), useEffect: effect, useLayoutEffect: effect,
    trpcReact: { useUtils: () => utils, repositoryConnections: {groups:{useQuery:()=>({data:{groups:[{id:"1",path:"synthetic/team",name:"Synthetic team"}],hasMore:false},error:null})}, configurations: { useQuery: () => configurations }, mine: { useQuery: () => recent }, status: { useQuery: () => status }, begin: { useMutation: () => ({ isPending: false, mutateAsync: forbidden }) }, disconnect: { useMutation: () => ({ isPending: false, mutateAsync: forbidden }) }, connectSelected: { useMutation: () => connect } } },
    ProviderMark: () => React.createElement("span", null, "GitLab"), Link: ({ children }: { children: React.ReactNode }) => React.createElement("span", null, children), ConnectionAccessGate: ({ state }: { state: string }) => React.createElement("p", null, state), authorizeRepositoryAccount: forbidden, cancelRepositoryAuthorization: forbidden,
  });
  const source = readFileSync(new URL("../components/GitlabRepositoryConnection.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("connection.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
  const body = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/^export\s+/gm, "")).join("\n");
  vm.runInContext(ts.transpileModule(`${body}\nthis.actual=RepositoryOAuthConnection`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, harnessContext);
  function render() { let turns = 0; do { if (++turns > 30) throw Error("Unsettled synthetic hook model"); cursor = 0; dirty = false; current = (harnessContext as unknown as { actual: typeof Component }).actual(props); while (effects.length) effects.shift()!(); } while (dirty); return current; }
  render();
  function button(label: string | RegExp) { return required(elements(current).find(node => node.type === "button" && (typeof label === "string" ? text(node) === label : label.test(text(node))))); }
  async function settle() { for (let n = 0; n < 8; n++) { await Promise.resolve(); render(); } }
  async function resume() { required(button(/Synthetic account/).props.onClick)(); render(); await settle(); }
  async function done() { await resume(); required(button("Synthetic repo-1main · Metadata only").props.onClick)(); render(); required(button("Review 1 selected").props.onClick)(); render(); await required(button("Approve and connect").props.onClick)(); render(); }
  async function browseTo(target: number) { for (let next = 2; next <= target; next++) { fetchList.mockResolvedValueOnce(listing([`page-${next}`])); required(button("Next page").props.onClick)(); await settle(); } }
  return { props, auth, liveSdk, reader, configurations, recent, status, fetchList, connect, forbidden, render, button, settle, resume, done, browseTo, tree: () => current, html: () => renderToStaticMarkup(current), unmount: () => { for (const held of slots) held.cleanup?.(); } };
}

describe("OAuth metadata fresh selection batch actual workflow", () => {
  it.each(["Clear selection","Select this page (up to 100 total)","toggle"])("unknown OAuth save retains exact retry input against pre-review %s callback",async action=>{
    const h=workflow();h.fetchList.mockResolvedValueOnce(listing(["repo-1","repo-2"]));await h.resume();required(h.button("Synthetic repo-1main · Metadata only").props.onClick)();h.render();
    const retained=required(h.button(action==="toggle"?/Synthetic repo-1/:action).props.onClick);required(h.button("Review 1 selected").props.onClick)();h.render();const pending=deferred<{connected:number}>();h.connect.mutateAsync.mockReturnValueOnce(pending.promise);const first=required(h.button("Approve and connect").props.onClick)();retained();h.render();pending.reject(Error("synthetic unknown network"));await first;h.render();
    const original=h.connect.mutateAsync.mock.calls[0]?.[0];expect(original).toMatchObject({repositoryIds:["repo-1"]});retained();h.render();
    expect(h.button("Approve and connect").props.disabled).toBe(false);await required(h.button("Approve and connect").props.onClick)();h.render();expect(h.connect.mutateAsync.mock.calls[1]?.[0]).toEqual(original);
  });
  it("OAuth discovered group scope resets only after exact acknowledgement and selects current page without source processing",async()=>{
    const h=workflow();await h.resume();required(h.button("Synthetic repo-1main · Metadata only").props.onClick)();h.render();
    const label=required(elements(h.tree()).find(node=>node.type==="label"&&text(node).startsWith("Exact group/subgroup path")));const input=required(elements(label).find(node=>node.type==="input"));required(input.props.onChange)({preventDefault:vi.fn(),target:{value:"synthetic/team"}});h.render();
    const held=deferred<Listing>();h.fetchList.mockReturnValueOnce(held.promise);required(h.button("Browse this scope").props.onClick)();h.render();expect(h.html()).toContain("1 selected across visited pages");
    const scope={groupPath:"synthetic/team",includeSubgroups:true,includeShared:false};expect(h.fetchList).toHaveBeenLastCalledWith({id:"synthetic-connection",page:1,search:"",gitlabScope:scope});
    const key=JSON.stringify(["gitlab-group/v1","synthetic/team",true,false,"44"]);held.resolve({...listing(["group-repo"],true,false),scopeKey:key,repositories:[{id:"group-repo",name:"Synthetic group-repo",url:"https://synthetic-gitlab.example.com/synthetic/team/repo",defaultBranch:"main",scopeKey:key}]});await h.settle();expect(h.html()).toContain("0 selected across visited pages");required(h.button("Select this page (up to 100 total)").props.onClick)();h.render();expect(h.html()).toContain("1 selected across visited pages");expect(h.connect.mutateAsync).not.toHaveBeenCalled();expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("Connect more uses explicit fresh batch with same saved access and clears only acknowledged choices", async () => {
    const h = workflow(); await h.done(); const held = deferred<Listing>(); h.fetchList.mockReturnValueOnce(held.promise);
    const click = required(h.button("Connect more repositories").props.onClick), first = click(), duplicate = click(); h.render();
    expect(h.fetchList).toHaveBeenLastCalledWith({ id: "synthetic-connection", page: 1, search: "", restartCatalogue: true }); expect(h.fetchList).toHaveBeenCalledTimes(2); expect(h.button("Connect more repositories").props.disabled).toBe(true); expect(h.button("Done").props.disabled).toBe(true);
    held.resolve(listing(["fresh-repo"], true)); await first; await duplicate; h.render(); expect(h.html()).toContain("0 selected across visited pages"); expect(h.html()).toContain("Synthetic fresh-repo"); expect(h.html()).not.toContain("Synthetic repo-1");
    expect(h.connect.mutateAsync).toHaveBeenCalledTimes(1); expect(h.props.onConnected).toHaveBeenCalledTimes(1); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(["failure", "missing-ack"])("explicit %s reset retains exact existing choices and stays retryable", async outcome => {
    const h = workflow(); await h.resume(); required(h.button("Synthetic repo-1main · Metadata only").props.onClick)(); h.render();
    if (outcome === "failure") h.fetchList.mockRejectedValueOnce(new Error("private provider error")); else h.fetchList.mockResolvedValueOnce(listing(["not-acknowledged"], false));
    await required(h.button("Start a new selection batch").props.onClick)(); h.render(); expect(h.html()).toContain("1 selected across visited pages"); expect(h.html()).not.toContain("not-acknowledged"); expect(h.html()).not.toContain("private provider error"); expect(h.html()).toContain("Your existing choices are retained");
    required(h.button("Review 1 selected").props.onClick)(); h.render(); expect(h.html()).toContain("Synthetic repo-1"); expect(h.connect.mutateAsync).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("ordinary pages and searches preserve selections and never implicitly request reset", async () => {
    const h = workflow(); await h.resume(); required(h.button("Synthetic repo-1main · Metadata only").props.onClick)(); h.render(); h.fetchList.mockResolvedValueOnce(listing(["page-2"]));
    required(h.button("Next page").props.onClick)(); await h.settle(); expect(h.fetchList).toHaveBeenLastCalledWith({ id: "synthetic-connection", page: 2, search: "" }); expect(h.html()).toContain("1 selected across visited pages");
    const input = required(elements(required(elements(h.tree()).find(node=>node.type==="form"))).find(node => node.type === "input")); required(input.props.onChange)({ preventDefault: vi.fn(), target: { value: "needle" } }); h.render();
    const form = required(elements(h.tree()).find(node => node.type === "form")); required(form.props.onSubmit)({ preventDefault: vi.fn(), target: { value: "" } }); await h.settle();
    expect(h.fetchList).toHaveBeenLastCalledWith({ id: "synthetic-connection", page: 1, search: "needle" }); expect(h.html()).toContain("1 selected across visited pages"); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("explicit current-search batch discloses bounds and clears choices only after active reset ACK", async () => {
    const h = workflow(); await h.resume(); required(h.button("Synthetic repo-1main · Metadata only").props.onClick)(); h.render();
    required(required(elements(required(elements(h.tree()).find(node=>node.type==="form"))).find(node => node.type === "input")).props.onChange)({ preventDefault: vi.fn(), target: { value: "specific search" } }); h.render();
    const held = deferred<Listing>(); h.fetchList.mockReturnValueOnce(held.promise); const promise = required(h.button("Start a new selection batch").props.onClick)(); h.render();
    expect(h.html()).toContain("1 selected across visited pages"); expect(h.html()).toContain("500 repositories and connect up to 100"); expect(h.html()).toContain("saved connections stay in the project"); expect(h.fetchList).toHaveBeenLastCalledWith({ id: "synthetic-connection", page: 1, search: "specific search", restartCatalogue: true });
    held.resolve(listing(["specific-result"], true)); await promise; h.render(); expect(h.html()).toContain("0 selected across visited pages"); expect(h.html()).toContain("Synthetic specific-result");
  });
  it.each(["actor", "organization", "project", "provider", "sdk", "inactive", "readonly", "config-org", "config-refresh", "unmount"])("captured reset refuses %s access loss without metadata reads", async loss => {
    const h = workflow(); await h.resume(); const reset = required(h.button("Start a new selection batch").props.onClick);
    if (loss === "actor") { h.auth.userId = "other-clerk"; h.reader.current = { ...h.reader.origin, clerkActorId: "other-clerk" }; h.reader.readable = false; }
    if (loss === "organization") { h.reader.current = { ...h.reader.origin, organizationId: "other-org" }; h.reader.readable = false; }
    if (loss === "project") h.props.projectId = "other-project";
    if (loss === "provider") h.props.providerId = "github";
    if (loss === "sdk") h.liveSdk.session = { id: "other-session", user: { id: "other-clerk" } };
    if (loss === "inactive") h.props.active = false;
    if (loss === "readonly") h.reader.canEdit = false;
    if (loss === "config-org") h.configurations.data.organizationId = "other-org";
    if (loss === "config-refresh") h.configurations.isFetching = true;
    if (loss === "unmount") h.unmount(); else h.render();
    await reset(); expect(h.fetchList).toHaveBeenCalledTimes(1); expect(h.connect.mutateAsync).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it.each(["ack", "failure"])("late reset %s after scope loss cannot clear or replace original selection", async outcome => {
    const h = workflow(); await h.resume(); required(h.button("Synthetic repo-1main · Metadata only").props.onClick)(); h.render(); const held = deferred<Listing>(); h.fetchList.mockReturnValueOnce(held.promise); const promise = required(h.button("Start a new selection batch").props.onClick)();
    h.props.active = false; h.render(); if (outcome === "ack") held.resolve(listing(["foreign-late-metadata"], true)); else held.reject(new Error("private stale error")); await promise; h.render(); expect(h.html()).not.toContain("Synthetic repo-1"); expect(h.html()).not.toContain("private stale error");
    h.props.active = true; h.render(); expect(h.html()).toContain("1 selected across visited pages"); expect(h.html()).not.toContain("foreign-late-metadata"); expect(h.button("Start a new selection batch").props.disabled).toBe(false); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("a newly rendered provider or native account scope cannot reuse retained private connection metadata", async () => {
    const h = workflow(); await h.resume(); h.props.providerId = "github"; h.render();
    expect(h.html()).not.toContain("Synthetic repo-1"); expect(h.html()).not.toContain("Synthetic account"); expect(h.html()).not.toContain("Start a new selection batch"); expect(h.fetchList).toHaveBeenCalledTimes(1);
    h.props.providerId = "gitlab"; h.configurations.data.organizationId = "other-org"; h.render(); expect(h.html()).not.toContain("Synthetic repo-1"); expect(h.fetchList).toHaveBeenCalledTimes(1);
    h.configurations.data.organizationId = "synthetic-org"; h.render(); expect(h.html()).toContain("Synthetic repo-1"); expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("continues beyond the visited500 catalogue from page6 with active search and acknowledges reset before clearing choices", async () => {
    const h = workflow(); await h.resume();
    const input = required(elements(required(elements(h.tree()).find(node=>node.type==="form"))).find(node => node.type === "input")); required(input.props.onChange)({ preventDefault: vi.fn(), target: { value: "submitted search" } }); h.render();
    required(required(elements(h.tree()).find(node => node.type === "form")).props.onSubmit)({ preventDefault: vi.fn(), target: { value: "" } }); await h.settle();
    required(h.button("Synthetic repo-1main · Metadata only").props.onClick)(); h.render(); await h.browseTo(5);
    required(required(elements(required(elements(h.tree()).find(node=>node.type==="form"))).find(node => node.type === "input")).props.onChange)({ preventDefault: vi.fn(), target: { value: "unsubmitted search" } }); h.render();
    const held = deferred<Listing>(); h.fetchList.mockReturnValueOnce(held.promise);
    const continueClick = required(h.button("Continue from next page in a fresh batch").props.onClick), first = continueClick(), duplicate = continueClick(); h.render();
    expect(h.fetchList).toHaveBeenLastCalledWith({ id: "synthetic-connection", page: 6, search: "submitted search", restartCatalogue: true }); expect(h.fetchList).toHaveBeenCalledTimes(7);
    expect(h.html()).toContain("Continue from page 6"); expect(h.html()).toContain("1 selected across visited pages"); expect(h.html()).toContain("500-repository limit"); expect(h.html()).toContain("Unsaved choices clear only after a successful refresh"); expect(h.button("Continue from next page in a fresh batch").props.disabled).toBe(true);
    held.resolve(listing(["repo-501"], true)); await first; await duplicate; h.render();
    expect(h.html()).toContain("Page 6."); expect(h.html()).toContain("Synthetic repo-501"); expect(h.html()).toContain("0 selected across visited pages");
    await continueClick(); expect(h.fetchList).toHaveBeenCalledTimes(7); // Captured prior batch/page cannot start another reset.
    expect(h.connect.mutateAsync).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
  });

  it.each(["failure", "missing-ack"])("next-page fresh batch %s preserves current page, active search and selected metadata", async outcome => {
    const h = workflow(); await h.resume(); required(h.button("Synthetic repo-1main · Metadata only").props.onClick)(); h.render(); await h.browseTo(5);
    if (outcome === "failure") h.fetchList.mockRejectedValueOnce(new Error("private uncertain provider result")); else h.fetchList.mockResolvedValueOnce(listing(["unacknowledged-501"], false));
    await required(h.button("Continue from next page in a fresh batch").props.onClick)(); h.render();
    expect(h.fetchList).toHaveBeenLastCalledWith({ id: "synthetic-connection", page: 6, search: "", restartCatalogue: true }); expect(h.html()).toContain("Page 5."); expect(h.html()).toContain("1 selected across visited pages"); expect(h.html()).not.toContain("unacknowledged-501"); expect(h.html()).not.toContain("private uncertain provider result");
    h.fetchList.mockResolvedValueOnce(listing(["acknowledged-501"], true)); await required(h.button("Continue from next page in a fresh batch").props.onClick)(); h.render();
    expect(h.fetchList).toHaveBeenLastCalledWith({ id: "synthetic-connection", page: 6, search: "", restartCatalogue: true }); expect(h.html()).toContain("Page 6."); expect(h.html()).toContain("0 selected across visited pages"); expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("can recover the 501st-repository ordinary-list limit through a disclosed next-page reset without restarting page1", async () => {
    const h = workflow(); await h.resume(); required(h.button("Synthetic repo-1main · Metadata only").props.onClick)(); h.render(); await h.browseTo(5);
    h.fetchList.mockRejectedValueOnce(new Error("Synthetic500 visited catalogue limit")); required(h.button("Next page").props.onClick)(); await h.settle();
    expect(h.fetchList).toHaveBeenLastCalledWith({ id: "synthetic-connection", page: 6, search: "" }); expect(h.html()).toContain("Page 5."); expect(h.html()).toContain("1 selected across visited pages");
    h.fetchList.mockResolvedValueOnce(listing(["repo-501"], true)); await required(h.button("Continue from next page in a fresh batch").props.onClick)(); h.render();
    expect(h.fetchList).toHaveBeenLastCalledWith({ id: "synthetic-connection", page: 6, search: "", restartCatalogue: true }); expect(h.html()).toContain("Page 6."); expect(h.html()).toContain("Synthetic repo-501"); expect(h.html()).toContain("0 selected across visited pages"); expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("saved page5 batch can continue directly to fresh page6 without repeating browsing or saving twice", async () => {
    const h = workflow(); await h.resume(); required(h.button("Synthetic repo-1main · Metadata only").props.onClick)(); h.render(); await h.browseTo(5);
    required(h.button("Review 1 selected").props.onClick)(); h.render(); await required(h.button("Approve and connect").props.onClick)(); h.render();
    expect(h.html()).toContain("Repository connections saved"); expect(h.html()).toContain("Continue from page 6"); expect(h.html()).toContain("saved connections stay in the project");
    const held = deferred<Listing>(); h.fetchList.mockReturnValueOnce(held.promise); const click = required(h.button("Continue from next page in a fresh batch").props.onClick), pending = click(), duplicate = click(); h.render();
    expect(h.fetchList).toHaveBeenLastCalledWith({ id: "synthetic-connection", page: 6, search: "", restartCatalogue: true }); expect(h.button("Continue from next page in a fresh batch").props.disabled).toBe(true); expect(h.button("Connect more repositories").props.disabled).toBe(true); expect(h.button("Done").props.disabled).toBe(true);
    held.resolve(listing(["saved-batch-repo-501"], true)); await pending; await duplicate; h.render(); expect(h.html()).toContain("Page 6."); expect(h.html()).toContain("0 selected across visited pages"); expect(h.html()).toContain("Synthetic saved-batch-repo-501"); expect(h.connect.mutateAsync).toHaveBeenCalledTimes(1); expect(h.props.onConnected).toHaveBeenCalledTimes(1); expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("retires the captured repository continuation before review/save while admitting the fresh done callback", async () => {
    const h = workflow(); await h.resume(); required(h.button("Synthetic repo-1main · Metadata only").props.onClick)(); h.render();
    const beforeReview = required(h.button("Continue from next page in a fresh batch").props.onClick);
    required(h.button("Review 1 selected").props.onClick)(); h.render(); await beforeReview();
    expect(h.fetchList).toHaveBeenCalledTimes(1); expect(h.connect.mutateAsync).not.toHaveBeenCalled(); expect(h.html()).toContain("Connect 1 repository");
    required(h.button("Back").props.onClick)(); h.render(); const beforeSave = required(h.button("Continue from next page in a fresh batch").props.onClick);
    required(h.button("Review 1 selected").props.onClick)(); h.render(); await required(h.button("Approve and connect").props.onClick)(); h.render(); await beforeSave();
    expect(h.fetchList).toHaveBeenCalledTimes(1); expect(h.html()).toContain("Repository connections saved"); expect(h.connect.mutateAsync).toHaveBeenCalledTimes(1);
    h.fetchList.mockResolvedValueOnce(listing(["fresh-done-batch"], true)); await required(h.button("Continue from next page in a fresh batch").props.onClick)(); h.render();
    expect(h.fetchList).toHaveBeenLastCalledWith({ id: "synthetic-connection", page: 2, search: "", restartCatalogue: true }); expect(h.fetchList).toHaveBeenCalledTimes(2); expect(h.html()).toContain("Page 2."); expect(h.html()).toContain("0 selected across visited pages"); expect(h.html()).toContain("Synthetic fresh-done-batch"); expect(h.connect.mutateAsync).toHaveBeenCalledTimes(1); expect(h.forbidden).not.toHaveBeenCalled();
  });

  it.each(["fetching", "paused", "error", "expired", "unverified", "write-pending"])("captured fresh continuation refuses %s uncertainty instead of clearing choices or reading metadata", async uncertainty => {
    const h = workflow(); await h.resume(); required(h.button("Synthetic repo-1main · Metadata only").props.onClick)(); h.render(); const click = required(h.button("Continue from next page in a fresh batch").props.onClick);
    if (uncertainty === "fetching") h.status.isFetching = true;
    if (uncertainty === "paused") h.status.isPaused = true;
    if (uncertainty === "error") h.status.error = new Error("private status failure");
    if (uncertainty === "expired") h.status.data.status = "EXPIRED";
    if (uncertainty === "unverified") h.status.isSuccess = false;
    if (uncertainty === "write-pending") h.connect.isPending = true;
    h.render(); expect(h.button("Continue from next page in a fresh batch").props.disabled).toBe(true); await click(); expect(h.fetchList).toHaveBeenCalledTimes(1); expect(h.html()).toContain("1 selected across visited pages"); expect(h.connect.mutateAsync).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("withholds continuation at the terminal page/bound, for GitHub and after old-page navigation", async () => {
    const h = workflow(); await h.resume(); const captured = required(h.button("Continue from next page in a fresh batch").props.onClick); await h.browseTo(2); await captured(); expect(h.fetchList).toHaveBeenCalledTimes(2);
    h.fetchList.mockResolvedValueOnce(listing(["last-page"], false, false)); required(h.button("Next page").props.onClick)(); await h.settle(); expect(h.html()).not.toContain("Continue from next page in a fresh batch");
    const bounded = workflow(); await bounded.resume(); await bounded.browseTo(100); expect(bounded.html()).toContain("Page 100."); expect(bounded.html()).not.toContain("Continue from next page in a fresh batch"); expect(bounded.button("Next page").props.disabled).toBe(true); expect(bounded.fetchList).toHaveBeenCalledTimes(100);
    const github = workflow(); github.props.providerId = "github"; github.recent.data[0]!.provider = "github"; github.recent.data[0]!.origin = "https://github.com"; github.configurations.data.configurations[0]!.provider = "github"; github.configurations.data.configurations[0]!.origin = "https://github.com"; github.render(); await github.resume(); expect(github.html()).not.toContain("Continue from next page in a fresh batch"); expect(github.forbidden).not.toHaveBeenCalled();
  });

  it.each(["actor", "organization", "project", "sdk", "readonly", "inactive", "unmount"])("fresh continuation retains original access guards for %s loss", async loss => {
    const h = workflow(); await h.resume(); const click = required(h.button("Continue from next page in a fresh batch").props.onClick);
    if (loss === "actor") { h.auth.userId = "other-clerk"; h.reader.current = { ...h.reader.origin, clerkActorId: "other-clerk" }; h.reader.readable = false; }
    if (loss === "organization") { h.reader.current = { ...h.reader.origin, organizationId: "other-org" }; h.reader.readable = false; }
    if (loss === "project") h.props.projectId = "other-project";
    if (loss === "sdk") h.liveSdk.session = { id: "other-session", user: { id: "other-clerk" } };
    if (loss === "readonly") h.reader.canEdit = false;
    if (loss === "inactive") h.props.active = false;
    if (loss === "unmount") h.unmount(); else h.render();
    await click(); expect(h.fetchList).toHaveBeenCalledTimes(1); expect(h.connect.mutateAsync).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("late next-page reset ACK after current scope loss cannot rebind metadata or discard original choices", async () => {
    const h = workflow(); await h.resume(); required(h.button("Synthetic repo-1main · Metadata only").props.onClick)(); h.render(); const held = deferred<Listing>(); h.fetchList.mockReturnValueOnce(held.promise);
    const pending = required(h.button("Continue from next page in a fresh batch").props.onClick)(); h.props.active = false; h.render(); held.resolve(listing(["foreign-late-501"], true)); await pending; h.render(); expect(h.html()).not.toContain("foreign-late-501");
    h.props.active = true; h.render(); expect(h.html()).toContain("Page 1."); expect(h.html()).toContain("1 selected across visited pages"); expect(h.html()).not.toContain("foreign-late-501"); expect(h.forbidden).not.toHaveBeenCalled();
  });
});
