import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { connectionAccessState } from "./connection-access";
import { gitlabInstanceOrigin } from "./gitlab-instance-selection";
import { retainAnalysisRequest } from "./analysis-request-recovery";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import type { RouterInputs, RouterOutputs } from "./trpcReact";

type VerifyInput = RouterInputs["repositoryConnections"]["connectToken"];
type VerifyResult = RouterOutputs["repositoryConnections"]["connectToken"];
type Listing = RouterOutputs["repositoryConnections"]["list"];
type SelectInput = RouterInputs["repositoryConnections"]["connectSelected"];
type Connection = RouterOutputs["repositoryConnections"]["mine"][number];
type Props = { projectId: string; providerId?: string; provider?: string; active: boolean; onConnected: () => void; onClose: () => void };
type Event = { preventDefault: () => void; target: { value: string; checked: boolean } };
type Element = React.ReactElement<{ children?: React.ReactNode; type?: string; value?: string; checked?: boolean; disabled?: boolean; "aria-pressed"?: boolean; "aria-label"?: string; onChange?: (event: Event) => void; onSubmit?: (event: Event) => unknown; onClick?: () => unknown }>;
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function event(value = "", checked = false): Event { return { preventDefault: vi.fn(), target: { value, checked } }; }
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw Error(`Missing required synthetic evidence at position ${index}`);
  return value;
}
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
function compile(name: string, context: vm.Context) {
  const source = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
  const body = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/^export\s+(?:default\s+)?/gm, "")).join("\n");
  vm.runInContext(ts.transpileModule(`${body}\nthis.actual=${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText, context);
}
const repository = (id: string): Listing["repositories"][number] => ({ id, name: `Synthetic ${id}`, url: `https://gitlab.example.com/synthetic/${encodeURIComponent(id)}`, defaultBranch: "main" });
const listing = (ids: string[], hasMore = false, catalogReset = false): Listing => ({ repositories: ids.map(repository), hasMore, catalogReset, catalogVersion: "c".repeat(64),limitReached:false,listingStatus:hasMore?"more-pages":"end-of-scope",scopeKey:null,githubInstallationRequired:false });

/** Complete current component JSX and handlers, with synthetic hook commit
 * cycles/RPC boundaries only. No browser, Clerk/provider access or native proof. */
function harness(component = "TokenRepositoryConnection") {
  const slots: Slot[] = [];
  let cursor = 0, dirty = false, current: React.ReactElement;
  const effects: Array<() => void> = [];
  const auth = { isLoaded: true, isSignedIn: true, userId: "synthetic-clerk", sessionId: "synthetic-session" };
  const sdk = { loaded: true, session: { id: auth.sessionId, user: { id: auth.userId } } };
  const props: Props = { projectId: "synthetic-project", providerId: "gitlab", provider: "gitlab", active: true, onConnected: vi.fn(), onClose: vi.fn() };
  const forbidden = vi.fn(() => { throw Error("Browser, storage, source and unrelated actions forbidden in fixture"); });
  const capabilities = { isSuccess: true, isLoading: false, isFetching: false, error: null as unknown, data: { organizationId: "synthetic-org", canConnect: true, canConfigure: true, credentialStorageReady: true, storageReady: false, configurations: [] }, refetch: vi.fn(async () => capabilities) };
  const recent = { isSuccess: true, isFetching: false, error: null as unknown, data: [] as Connection[], refetch: vi.fn(async () => recent) };
  const verify = { isPending: false, mutateAsync: vi.fn<(input: VerifyInput) => Promise<VerifyResult>>(async input => ({ id: "synthetic-connection", accountLabel: "Synthetic account", requestId: input.requestId, projectId: input.projectId, originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId })) };
  const connect = { isPending: false, mutateAsync: vi.fn<(input: SelectInput) => Promise<{ connected: number }>>(async input => ({ connected: input.repositoryIds.length })) };
  const fetchList = vi.fn<(input: RouterInputs["repositoryConnections"]["list"]) => Promise<Listing>>(async () => listing(["repo-1", "repo-2"]));
  function slot() { const index = cursor++; return slots[index] ?? (slots[index] = {}); }
  function sameDeps(prior: readonly unknown[] | undefined, next: readonly unknown[] | undefined) { return !!prior && !!next && prior.length === next.length && prior.every((value, index) => Object.is(value, next[index])); }
  function effect(make: () => unknown, deps?: readonly unknown[]) {
    const held = slot();
    if (!sameDeps(held.deps, deps)) {
      held.deps = deps;
      effects.push(() => { held.cleanup?.(); const cleanup = make(); held.cleanup = typeof cleanup === "function" ? cleanup as () => void : undefined; });
    }
  }
  const oauth = vi.fn(() => React.createElement("div", null, "Synthetic OAuth boundary"));
  const tokenBoundary = vi.fn(() => React.createElement("div", null, "Synthetic token boundary"));
  const choicesBoundary = vi.fn(() => React.createElement("div", null, "Synthetic connection method boundary"));
  const context = vm.createContext({
    React, URL, Object, Error, connectionAccessState, gitlabInstanceOrigin, retainAnalysisRequest, currentSessionScope, sameAuthScope,
    useAuth: () => auth,
    useState: (initial: unknown) => { const held = slot(); if (!Object.hasOwn(held, "value")) held.value = typeof initial === "function" ? initial() : initial; return [held.value, (next: unknown) => { const value = typeof next === "function" ? next(held.value) : next; if (!Object.is(value, held.value)) { held.value = value; dirty = true; } }]; },
    useRef: (initial: unknown) => { const held = slot(); if (!Object.hasOwn(held, "value")) held.value = { current: initial }; return held.value; },
    useEffect: effect, useLayoutEffect: effect,
    useMemo: (make: () => unknown, deps?: readonly unknown[]) => { const held = slot(); if (!sameDeps(held.deps, deps)) { held.deps = deps; held.value = make(); } return held.value; },
    useCallback: (callback: unknown) => callback,
    crypto: { randomUUID: (() => { let value = 0; return () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}`; })() },
    window: { Clerk: sdk, open: forbidden, localStorage: { setItem: forbidden }, sessionStorage: { setItem: forbidden } }, localStorage: { setItem: forbidden }, sessionStorage: { setItem: forbidden }, fetch: forbidden,
    ProviderMark: () => React.createElement("span", null, "GitLab"),
    ConnectionAccessGate: ({ state }: { state: string }) => React.createElement("p", { role: "status" }, state),
    RepositoryOAuthConnection: oauth, TokenRepositoryConnection: tokenBoundary, GitlabConnectionChoices: choicesBoundary,
    trpcReact: { useUtils: () => ({ repositoryConnections: { list: { fetch: fetchList } } }), repositoryConnections: {
      configurations: { useQuery: () => capabilities }, mine: { useQuery: () => recent },groups:{useQuery:()=>({data:{groups:[{id:"1",path:"synthetic/team",name:"Synthetic team"}],hasMore:false,limitReached:false},error:null,refetch:vi.fn()})},
      connectToken: { useMutation: () => verify }, forgetToken: { useMutation: () => ({ isPending: false, mutateAsync: forbidden }) }, connectSelected: { useMutation: () => connect },
    } },
  });
  compile(component, context);
  function render() {
    let turns = 0;
    do {
      if (++turns > 40) throw Error("Synthetic hook commits did not settle");
      dirty = false; cursor = 0;
      current = (context as unknown as { actual: (props: Props) => React.ReactElement }).actual(props);
      while (effects.length) effects.shift()!();
    } while (dirty);
    return current;
  }
  render();
  function button(label: string | RegExp) {
    const value = elements(current).find(node => node.type === "button" && (typeof label === "string" ? text(node) === label : label.test(text(node))));
    if (!value) throw Error(`Missing actual button ${String(label)}`);
    return value;
  }
  function input(label: string) {
    const value = elements(current).filter(node => node.type === "label").find(node => text(node).startsWith(label));
    const control = value && elements(value).find(node => node.type === "input");
    if (!control) throw Error(`Missing actual input ${label}`);
    return control;
  }
  async function settle() { for (let index = 0; index < 8; index++) { await Promise.resolve(); render(); } }
  return { auth, sdk, props, capabilities, recent, verify, connect, fetchList, forbidden, oauth, tokenBoundary, choicesBoundary, render, button, input, settle,
    tree: () => current, html: () => renderToStaticMarkup(current),
    unmount: () => { for (const held of slots) held.cleanup?.(); },
    submit: () => { const form = elements(current).find(node => node.type === "form"); if (!form?.props.onSubmit) throw Error("Missing actual form submit"); return form.props.onSubmit(event()); },
    change: (label: string, value: string) => { input(label).props.onChange!(event(value)); render(); },
    consent: () => { const control = elements(current).find(node => node.type === "input" && node.props.type === "checkbox"); if (!control?.props.onChange) throw Error("Missing metadata consent"); control.props.onChange(event("", true)); render(); },
  };
}

function fillVerification(h: ReturnType<typeof harness>, url = "https://gitlab.revyrie.co/dashboard/projects") {
  h.change("GitLab instance or project URL", url);
  h.change("API token", "synthetic-read-only-token");
  h.consent();
}
function acknowledgement(input: VerifyInput): VerifyResult {
  return { id: "synthetic-connection", accountLabel: "Synthetic account", requestId: input.requestId, projectId: input.projectId, originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId };
}

describe("GitLab token connection actual component workflow (synthetic)", () => {
  it.each(["Clear selection","Select this page (up to 100 total)","toggle"])("unknown token save retains exact retry input against pre-review %s callback",async action=>{
    const h=harness();fillVerification(h);await h.submit();h.render();h.button(/Synthetic repo-1/).props.onClick!();h.render();const retained=h.button(action==="toggle"?/Synthetic repo-1/:action).props.onClick!;
    h.button("Review 1 selected").props.onClick!();h.render();const pending=deferred<{connected:number}>();h.connect.mutateAsync.mockReturnValueOnce(pending.promise);const first=h.button("Approve and connect").props.onClick!();retained();h.render();pending.reject(Error("synthetic unknown network"));await first;h.render();const original=h.connect.mutateAsync.mock.calls[0]?.[0];expect(original).toMatchObject({repositoryIds:["repo-1"]});
    retained();h.render();expect(h.button("Approve and connect").props.disabled).toBe(false);await h.button("Approve and connect").props.onClick!();h.render();expect(h.connect.mutateAsync.mock.calls[1]?.[0]).toEqual(original);
  });
  it("group scope keeps old choices until exact reset ACK and carries reviewed scope across pages",async()=>{
    const h=harness();fillVerification(h);await h.submit();h.render();h.button("Select this page (up to 100 total)").props.onClick!();h.render();
    h.change("Exact group/subgroup path","synthetic/team");const held=deferred<Listing>();h.fetchList.mockReturnValueOnce(held.promise);h.button("Browse this scope").props.onClick!();h.render();
    expect(h.html()).toContain("2 selected across visited pages");const scope={groupPath:"synthetic/team",includeSubgroups:true,includeShared:false};expect(h.fetchList).toHaveBeenLastCalledWith({id:"synthetic-connection",page:1,search:"",gitlabScope:scope});
    const key=JSON.stringify(["gitlab-group/v1","synthetic/team",true,false,"44"]);const scoped=(ids:string[],reset:boolean)=>({...listing(ids,true,reset),scopeKey:key,repositories:ids.map(id=>({...repository(id),scopeKey:key}))});
    held.resolve(scoped(["group-repo"],true));await h.settle();expect(h.html()).toContain("0 selected across visited pages");expect(h.html()).toContain("Synthetic group-repo");
    h.fetchList.mockResolvedValueOnce(scoped(["group-page2"],false));h.button("Next page").props.onClick!();await h.settle();expect(h.fetchList).toHaveBeenLastCalledWith({id:"synthetic-connection",page:2,search:"",gitlabScope:scope});expect(h.connect.mutateAsync).not.toHaveBeenCalled();expect(h.verify.mutateAsync).toHaveBeenCalledOnce();
  });
  it("mismatched scope ACK and unconfirmed save cannot erase original selections",async()=>{
    const h=harness();fillVerification(h);await h.submit();h.render();h.button("Select this page (up to 100 total)").props.onClick!();h.render();h.change("Exact group/subgroup path","synthetic/team");
    h.fetchList.mockResolvedValueOnce(listing(["wrong-scope"],false,true));h.button("Browse this scope").props.onClick!();await h.settle();expect(h.html()).toContain("2 selected across visited pages");expect(h.html()).not.toContain("wrong-scope");
    const staleBrowse=h.button("Browse this scope").props.onClick!;h.button("Review 2 selected").props.onClick!();h.render();const staleBack=h.button("Back").props.onClick!;h.connect.mutateAsync.mockRejectedValueOnce(Error("synthetic uncertain network"));await h.button("Approve and connect").props.onClick!();h.render();expect(h.html()).toContain("original scope, choices and approval are retained");expect(h.button("Back").props.disabled).toBe(true);const reads=h.fetchList.mock.calls.length;staleBrowse();staleBack();h.render();expect(h.fetchList.mock.calls.length).toBe(reads);expect(h.html()).toContain("Connect 2 GitLab repositories");
    await h.button("Approve and connect").props.onClick!();h.render();expect(h.connect.mutateAsync.mock.calls[0]?.[0]).toEqual(h.connect.mutateAsync.mock.calls[1]?.[0]);expect(h.html()).toContain("Repository connections saved");
  });
  it("routes the actual repository chooser to GitLab method selection instead of implicit OAuth", () => {
    const h = harness("RepositoryConnectionContent");
    expect(h.tree().type).toBe(h.choicesBoundary);
    expect((h.tree().props as Props).projectId).toBe("synthetic-project");
    expect(h.oauth).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("starts with an explicit method choice and never launches OAuth automatically", () => {
    const h = harness("GitlabConnectionChoices");
    expect(h.html()).toContain("No OAuth application registration is needed");
    expect(h.forbidden).not.toHaveBeenCalled();
    expect(h.verify.mutateAsync).not.toHaveBeenCalled();
    h.button("Use a read-only access token").props.onClick!(); h.render();
    expect(h.tree().type).toBe(h.tokenBoundary);
    expect((h.tree().props as Props).providerId).toBe("gitlab");
    expect(h.oauth).not.toHaveBeenCalled();
    const oauth = harness("GitlabConnectionChoices");
    oauth.button("Use workspace-configured OAuth").props.onClick!(); oauth.render();
    expect(oauth.tree().type).toBe(oauth.oauth);
    expect(oauth.forbidden).not.toHaveBeenCalled();
  });

  it("uses a password input and explicit metadata consent without browser storage or source reads", () => {
    const h = harness();
    expect(h.input("API token").props.type).toBe("password");
    expect(h.button("Verify and choose repositories").props.disabled).toBe(true);
    expect(h.html()).toContain("read_api");
    expect(h.html()).toContain("broader repository read access than metadata");
    expect(h.html()).toContain("Source files are not read");
    fillVerification(h);
    expect(h.button("Verify and choose repositories").props.disabled).toBe(false);
    expect(h.forbidden).not.toHaveBeenCalled();
    expect(h.verify.mutateAsync).not.toHaveBeenCalled();
  });

  it("validates an HTTPS public instance and refuses invalid hosts before metadata verification", async () => {
    for (const url of ["http://gitlab.example.com", "https://localhost", "https://127.0.0.1", "https://gitlab.internal", "https://user:password@gitlab.example.com", "https://gitlab.example.com:8443", "https://gitlab.example.com/?secret=x", "https://gitlab.example.com/#fragment"]) {
      const h = harness(); fillVerification(h, url);
      expect(h.button("Verify and choose repositories").props.disabled).toBe(true);
      await h.submit();
      expect(h.verify.mutateAsync).not.toHaveBeenCalled();
      expect(h.fetchList).not.toHaveBeenCalled();
      expect(h.forbidden).not.toHaveBeenCalled();
    }
    const h = harness(); fillVerification(h);
    await h.submit(); h.render();
    const input = at(h.verify.mutateAsync.mock.calls, 0)[0];
    expect(input.instanceUrl).toBe("https://gitlab.revyrie.co");
    expect(input.originalOrganizationId).toBe("synthetic-org");
    expect(input.expectedClerkActorId).toBe("synthetic-clerk");
    expect(input.provider).toBe("gitlab");
    expect(input.approveMetadataAccess).toBe(true);
    expect(h.fetchList).toHaveBeenCalledWith({ id: "synthetic-connection", page: 1, search: "" });
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("freezes token verification before awaiting and blocks duplicate submits and draft edits", async () => {
    const h = harness(), held = deferred<VerifyResult>(); fillVerification(h);
    const staleTokenChange = h.input("API token").props.onChange!;
    h.verify.mutateAsync.mockReturnValueOnce(held.promise);
    const first = h.submit(), duplicate = h.submit();
    expect(h.verify.mutateAsync).toHaveBeenCalledTimes(1);
    const input = at(h.verify.mutateAsync.mock.calls, 0)[0], bytes = JSON.stringify(input);
    expect(Object.isFrozen(input)).toBe(true);
    staleTokenChange(event("synthetic-replacement-token")); h.render();
    expect(h.input("API token").props.disabled).toBe(true);
    expect(h.input("API token").props.value).toBe("synthetic-read-only-token");
    expect(h.button("Cancel").props.disabled).toBe(true);
    held.resolve(acknowledgement(input)); await first; await duplicate; h.render();
    expect(JSON.stringify(input)).toBe(bytes);
    expect(h.html()).toContain("Choose repositories");
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("a completed captured verification callback cannot mint another request after ACK or initial definitive refusal", async () => {
    for (const outcome of ["acknowledged", "refused"]) {
      const h = harness(); fillVerification(h);
      const submit = elements(h.tree()).find(node => node.type === "form")!.props.onSubmit!;
      if (outcome === "refused") h.verify.mutateAsync.mockRejectedValueOnce({ data: { code: "BAD_REQUEST" } });
      await submit(event()); h.render();
      const original = at(h.verify.mutateAsync.mock.calls, 0)[0], bytes = JSON.stringify(original);
      await submit(event()); h.render();
      expect(h.verify.mutateAsync).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(original)).toBe(bytes);
      if (outcome === "refused") {
        h.change("API token", "synthetic-deliberate-new-token");
        await h.submit(); h.render();
        const fresh = at(h.verify.mutateAsync.mock.calls, 1)[0];
        expect(fresh.requestId).not.toBe(original.requestId);
        expect(fresh.token).toBe("synthetic-deliberate-new-token");
      }
      expect(h.forbidden).not.toHaveBeenCalled();
    }
  });

  it("retains the same exact UUID and body after UNKNOWN and a later refusal until matching acknowledgement", async () => {
    const h = harness(); fillVerification(h);
    h.verify.mutateAsync.mockRejectedValueOnce(new Error("Synthetic lost acknowledgement"));
    await h.submit(); h.render();
    const original = at(h.verify.mutateAsync.mock.calls, 0)[0], bytes = JSON.stringify(original);
    expect(h.button("Retry original verification").props.disabled).toBe(false);
    expect(h.input("API token").props.disabled).toBe(true);
    expect(h.button("Cancel").props.disabled).toBe(true);
    h.verify.mutateAsync.mockRejectedValueOnce({ data: { code: "BAD_REQUEST" } });
    await h.submit(); h.render();
    expect(at(h.verify.mutateAsync.mock.calls, 1)[0]).toBe(original);
    expect(h.input("API token").props.disabled).toBe(true);
    await h.submit(); h.render();
    expect(at(h.verify.mutateAsync.mock.calls, 2)[0]).toBe(original);
    expect(JSON.stringify(original)).toBe(bytes);
    expect(h.html()).toContain("Choose repositories");
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("a wrong acknowledgement retains original body and does not browse repositories", async () => {
    const h = harness(); fillVerification(h);
    h.verify.mutateAsync.mockImplementationOnce(async input => ({ ...acknowledgement(input), requestId: "00000000-0000-4000-8000-999999999999" }));
    await h.submit(); h.render();
    expect(h.fetchList).not.toHaveBeenCalled();
    expect(h.input("API token").props.disabled).toBe(true);
    expect(h.button("Retry original verification")).toBeDefined();
    expect(h.props.onConnected).not.toHaveBeenCalled();
  });

  it("rejects sends after live SDK mismatch inactive view or unmount even through captured submit", async () => {
    for (const state of ["sdk", "inactive", "unmount"]) {
      const h = harness(); fillVerification(h);
      const submit = elements(h.tree()).find(node => node.type === "form")!.props.onSubmit!;
      if (state === "sdk") h.sdk.session = { id: "other-session", user: { id: "other-clerk" } };
      if (state === "inactive") { h.props.active = false; h.render(); }
      if (state === "unmount") h.unmount();
      await submit(event());
      expect(h.verify.mutateAsync).not.toHaveBeenCalled();
      expect(h.fetchList).not.toHaveBeenCalled();
      expect(h.forbidden).not.toHaveBeenCalled();
    }
  });

  it("withholds a retained original token from another actor and never rebinds its verification", async () => {
    const h = harness(); fillVerification(h);
    h.verify.mutateAsync.mockRejectedValueOnce(new Error("Synthetic lost acknowledgement"));
    await h.submit(); h.render();
    const original = at(h.verify.mutateAsync.mock.calls, 0)[0], bytes = JSON.stringify(original);
    const submit = elements(h.tree()).find(node => node.type === "form")!.props.onSubmit!;
    h.auth.userId = "other-clerk"; h.auth.sessionId = "other-session";
    h.sdk.session = { id: h.auth.sessionId, user: { id: h.auth.userId } }; h.render();
    expect(h.html()).not.toContain("synthetic-read-only-token");
    await submit(event());
    expect(h.verify.mutateAsync).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(original)).toBe(bytes);
    expect(h.fetchList).not.toHaveBeenCalled();
  });

  it("an unsent token draft is private after actor workspace project provider or SDK changes", () => {
    for (const changed of ["actor", "organization", "project", "provider", "sdk"]) {
      const h = harness(); fillVerification(h);
      if (changed === "actor") { h.auth.userId = "other-clerk"; h.sdk.session.user.id = "other-clerk"; }
      if (changed === "organization") h.capabilities.data.organizationId = "other-org";
      if (changed === "project") h.props.projectId = "other-project";
      if (changed === "provider") h.props.providerId = "bitbucket";
      if (changed === "sdk") h.sdk.session.user.id = "other-clerk";
      h.render();
      expect(h.html()).not.toContain("synthetic-read-only-token");
      expect(elements(h.tree()).filter(node => node.type === "input" || node.type === "form")).toHaveLength(0);
      expect(h.verify.mutateAsync).not.toHaveBeenCalled();
      expect(h.forbidden).not.toHaveBeenCalled();
    }
  });

  it("late verification acknowledgement after actor change does not browse or expose the original account", async () => {
    const h = harness(), held = deferred<VerifyResult>(); fillVerification(h);
    h.verify.mutateAsync.mockReturnValueOnce(held.promise);
    const first = h.submit();
    const original = at(h.verify.mutateAsync.mock.calls, 0)[0], bytes = JSON.stringify(original);
    h.auth.userId = "other-clerk"; h.auth.sessionId = "other-session";
    h.sdk.session = { id: h.auth.sessionId, user: { id: h.auth.userId } }; h.render();
    held.resolve(acknowledgement(original)); await first; h.render();
    expect(h.fetchList).not.toHaveBeenCalled();
    expect(h.html()).not.toContain("Synthetic account");
    expect(h.html()).not.toContain("synthetic-read-only-token");
    h.auth.userId = "synthetic-clerk"; h.auth.sessionId = "synthetic-session";
    h.sdk.session = { id: h.auth.sessionId, user: { id: h.auth.userId } }; h.render();
    await h.submit(); h.render();
    expect(at(h.verify.mutateAsync.mock.calls, 1)[0]).toBe(original);
    expect(JSON.stringify(original)).toBe(bytes);
    expect(h.html()).toContain("Choose repositories");
  });

  it("late repository metadata after view deactivation is not published into a hidden connection", async () => {
    const h = harness(), held = deferred<Listing>(); fillVerification(h);
    h.fetchList.mockReturnValueOnce(held.promise);
    const first = h.submit(); await h.settle();
    expect(h.fetchList).toHaveBeenCalledTimes(1);
    h.props.active = false; h.render();
    held.resolve(listing(["synthetic-late-private-repository"])); await first; h.render();
    expect(h.html()).not.toContain("synthetic-late-private-repository");
    expect(h.props.onConnected).not.toHaveBeenCalled();
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
  });

  it("saved GitLab token access does not show or remove an OAuth grant as a token", () => {
    const h = harness();
    h.recent.data = [
      { id: "token", provider: "gitlab", origin: "https://gitlab.example.com", status: "VERIFIED", accountLabel: "Synthetic token account", accessMethod: "token", authorizationKind: "token", installationUrl: null },
      { id: "oauth", provider: "gitlab", origin: "https://gitlab.example.com", status: "VERIFIED", accountLabel: "Synthetic OAuth account", accessMethod: "oauth", authorizationKind: "oauth", installationUrl: null },
    ]; h.render();
    expect(h.html()).toContain("Synthetic token account");
    expect(h.html()).not.toContain("Synthetic OAuth account");
    expect(elements(h.tree()).filter(node => node.type === "button" && text(node) === "Remove saved access")).toHaveLength(1);
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("selects raw metadata across pages and connects only explicitly reviewed exact IDs", async () => {
    const h = harness(); fillVerification(h);
    h.fetchList.mockImplementation(async input => listing(input.page === 1 ? ["repo-1", "repo-2"] : ["repo-3", "repo-4"], input.page === 1));
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.button("Next page").props.onClick!(); await h.settle();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    expect(h.html()).toContain("4 selected across visited pages");
    h.button("Review 4 selected").props.onClick!(); h.render();
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
    await h.button("Approve and connect").props.onClick!(); h.render();
    expect(h.connect.mutateAsync).toHaveBeenCalledWith({ id: "synthetic-connection", repositoryIds: ["repo-1", "repo-2", "repo-3", "repo-4"], catalogVersion: "c".repeat(64), approved: true });
    expect(h.props.onConnected).toHaveBeenCalledTimes(1);
    expect(h.html()).toContain("Source files have not been read");
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("verified account selections stay private and captured approval refuses after actor loss", async () => {
    const h = harness(); fillVerification(h);
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.button("Review 2 selected").props.onClick!(); h.render();
    const approve = h.button("Approve and connect").props.onClick!;
    h.auth.userId = "other-clerk"; h.auth.sessionId = "other-session";
    h.sdk.session = { id: h.auth.sessionId, user: { id: h.auth.userId } }; h.render();
    expect(h.html()).not.toContain("Synthetic account");
    expect(h.html()).not.toContain("Synthetic repo-1");
    await approve();
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
    expect(h.props.onConnected).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("page selection and captured individual clicks preserve the 100-repository cap", async () => {
    const h = harness(); fillVerification(h);
    const first = Array.from({ length: 99 }, (_, index) => `first-${index}`), second = ["second-0", "second-1"];
    h.fetchList.mockImplementation(async input => listing(input.page === 1 ? first : second, input.page === 1));
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.button("Next page").props.onClick!(); await h.settle();
    const choices = elements(h.tree()).filter(node => node.type === "button" && node.props["aria-pressed"] !== undefined);
    at(choices, 0).props.onClick!(); at(choices, 1).props.onClick!(); h.render();
    expect(h.html()).toContain("100 selected across visited pages");
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.button("Review 100 selected").props.onClick!(); h.render();
    await h.button("Approve and connect").props.onClick!();
    expect(at(h.connect.mutateAsync.mock.calls, 0)[0].repositoryIds).toEqual([...first, "second-0"]);
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("catalog reset explicitly clears prior selected metadata instead of approving a stale union", async () => {
    const h = harness(); fillVerification(h);
    h.fetchList.mockImplementation(async input => listing(input.page === 1 ? ["old"] : ["new"], input.page === 1, input.page === 2));
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.button("Next page").props.onClick!(); await h.settle();
    expect(h.html()).toContain("0 selected across visited pages");
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("Connect more explicitly starts an acknowledged fresh catalogue batch without inherited choices", async () => {
    const h = harness(); fillVerification(h);
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.button("Review 2 selected").props.onClick!(); h.render();
    await h.button("Approve and connect").props.onClick!(); h.render();
    h.fetchList.mockResolvedValueOnce({ ...listing(["fresh-batch"], false, true), catalogVersion: "d".repeat(64) });
    h.button("Connect more repositories").props.onClick!(); await h.settle();
    expect(at(h.fetchList.mock.calls, 1)[0]).toEqual({ id: "synthetic-connection", page: 1, search: "", restartCatalogue: true });
    expect(h.html()).toContain("0 selected across visited pages");
    expect(h.html()).toContain("Synthetic fresh-batch");
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.button("Review 1 selected").props.onClick!(); h.render();
    await h.button("Approve and connect").props.onClick!(); h.render();
    expect(at(h.connect.mutateAsync.mock.calls, 1)[0]).toEqual({ id: "synthetic-connection", repositoryIds: ["fresh-batch"], catalogVersion: "d".repeat(64), approved: true });
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("normal paging and search never request catalogue restart or clear an admitted visited selection", async () => {
    const h = harness(); fillVerification(h);
    h.fetchList.mockImplementation(async input => listing(input.search ? ["search-only"] : input.page === 1 ? ["first", "second"] : ["third"], !input.search && input.page === 1));
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.button("Next page").props.onClick!(); await h.settle();
    expect(h.html()).toContain("2 selected across visited pages");
    h.change("Search repositories", "Synthetic query"); await h.submit(); await h.settle();
    expect(h.html()).toContain("2 selected across visited pages");
    expect(h.fetchList.mock.calls.map(call => call[0])).toEqual([
      { id: "synthetic-connection", page: 1, search: "" },
      { id: "synthetic-connection", page: 2, search: "" },
      { id: "synthetic-connection", page: 1, search: "Synthetic query" },
    ]);
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("explicit new selection batch discloses clearing but retains choices until active reset acknowledgement", async () => {
    const h = harness(), reset = deferred<Listing>(); fillVerification(h);
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    expect(h.html()).toContain("browse 500 repositories and connect up to 100");
    expect(h.html()).toContain("clears unsaved choices after a successful refresh");
    h.fetchList.mockReturnValueOnce(reset.promise);
    h.button("Start a new selection batch").props.onClick!(); h.render();
    expect(h.html()).toContain("2 selected across visited pages");
    expect(at(h.fetchList.mock.calls, 1)[0]).toEqual({ id: "synthetic-connection", page: 1, search: "", restartCatalogue: true });
    reset.resolve(listing(["fresh-only"], false, true)); await h.settle();
    expect(h.html()).toContain("0 selected across visited pages");
    expect(h.html()).toContain("Synthetic fresh-only");
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
  });

  it("failed or unacknowledged restart retains original selected IDs and metadata for deliberate retry", async () => {
    for (const failure of ["rejected", "no-reset-ack"]) {
      const h = harness(); fillVerification(h);
      await h.submit(); h.render();
      h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
      if (failure === "rejected") h.fetchList.mockRejectedValueOnce(new Error("Synthetic reset failure"));
      else h.fetchList.mockResolvedValueOnce(listing(["unacknowledged-new-row"], false, false));
      h.button("Start a new selection batch").props.onClick!(); await h.settle();
      expect(h.html()).toContain("2 selected across visited pages");
      expect(h.html()).toContain("Your existing choices are retained");
      expect(h.html()).not.toContain("unacknowledged-new-row");
      h.button("Review 2 selected").props.onClick!(); h.render();
      expect(elements(h.tree()).filter(node => node.type === "li").map(node => node.key)).toEqual(["repo-1", "repo-2"]);
      // A failed read is not native catalogue acceptance. Retention is checked
      // without asking a synthetic mutation to approve an old catalogue hash.
      expect(h.connect.mutateAsync).not.toHaveBeenCalled();
      expect(h.forbidden).not.toHaveBeenCalled();
    }
  });

  it("late reset after deactivation cannot clear retained selection or publish replacement metadata", async () => {
    const h = harness(), reset = deferred<Listing>(); fillVerification(h);
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.fetchList.mockReturnValueOnce(reset.promise);
    h.button("Start a new selection batch").props.onClick!(); h.render();
    h.props.active = false; h.render();
    reset.resolve(listing(["late-reset-row"], false, true)); await h.settle();
    expect(h.html()).not.toContain("late-reset-row");
    h.props.active = true; h.render();
    expect(h.html()).toContain("2 selected across visited pages");
    expect(h.html()).not.toContain("late-reset-row");
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("continues from page six beyond the first 500 visited repositories with one explicit reset and exact reviewed next 100 IDs", async () => {
    const h = harness(), pending = deferred<Listing>(), visited = new Set<string>(); fillVerification(h);
    h.fetchList.mockImplementation(async input => {
      const ids = Array.from({ length: 100 }, (_, index) => String((input.page! - 1) * 100 + index + 1));
      const next = input.restartCatalogue ? new Set(ids) : new Set([...visited, ...ids]);
      // Synthetic native cap model, not PostgreSQL/provider acceptance.
      if (next.size > 500) throw Error("Synthetic visited catalogue cap");
      visited.clear(); for (const id of next) visited.add(id);
      return listing(ids, true, !!input.restartCatalogue);
    });
    await h.submit(); h.render();
    for (let page = 2; page <= 5; page++) { h.button("Next page").props.onClick!(); await h.settle(); }
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.button("Next page").props.onClick!(); await h.settle();
    expect(visited.size).toBe(500);
    expect(h.button("Continue from page 6 in a fresh batch").props.disabled).toBe(false);
    expect(h.html()).toContain("100 selected across visited pages");
    expect(h.html()).toContain("clears unsaved choices only after a successful refresh");
    const before = h.fetchList.mock.calls.length, advance = h.button("Continue from page 6 in a fresh batch").props.onClick!;
    h.fetchList.mockReturnValueOnce(pending.promise);
    advance(); advance(); h.render();
    expect(h.fetchList).toHaveBeenCalledTimes(before + 1);
    expect(at(h.fetchList.mock.calls, before)[0]).toEqual({ id: "synthetic-connection", page: 6, search: "", restartCatalogue: true });
    expect(h.html()).toContain("100 selected across visited pages");
    expect(h.button("Continue from page 6 in a fresh batch").props.disabled).toBe(true);
    const nextIds = Array.from({ length: 100 }, (_, index) => String(501 + index));
    pending.resolve({ ...listing(nextIds, true, true), catalogVersion: "d".repeat(64) }); await h.settle();
    expect(h.html()).toContain("0 selected across visited pages");
    expect(h.html()).toContain("Synthetic 501");
    expect(h.button("Continue from page 7 in a fresh batch")).toBeDefined();
    advance(); await h.settle(); expect(h.fetchList).toHaveBeenCalledTimes(before + 1);
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.button("Review 100 selected").props.onClick!(); h.render();
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
    await h.button("Approve and connect").props.onClick!(); h.render();
    expect(h.connect.mutateAsync).toHaveBeenCalledExactlyOnceWith({ id: "synthetic-connection", repositoryIds: nextIds, catalogVersion: "d".repeat(64), approved: true });
    expect(h.verify.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("saved page-five batch can continue directly from done at page six without re-browsing or another automatic connection", async () => {
    const h = harness(), pending = deferred<Listing>(); fillVerification(h);
    h.fetchList.mockImplementation(async input => listing(["page-" + input.page], true, !!input.restartCatalogue));
    await h.submit(); h.render();
    for (let page = 2; page <= 5; page++) { h.button("Next page").props.onClick!(); await h.settle(); }
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    const beforeSave = h.button("Continue from page 6 in a fresh batch").props.onClick!;
    h.button("Review 1 selected").props.onClick!(); h.render();
    await h.button("Approve and connect").props.onClick!(); h.render();
    expect(h.html()).toContain("Repository connections saved");
    expect(h.button("Connect more repositories")).toBeDefined();
    const reads = h.fetchList.mock.calls.length; beforeSave(); await h.settle();
    expect(h.fetchList).toHaveBeenCalledTimes(reads);
    h.fetchList.mockReturnValueOnce(pending.promise);
    const advance = h.button("Continue from page 6 in a fresh batch").props.onClick!;
    advance(); advance(); h.render();
    expect(h.fetchList).toHaveBeenCalledTimes(reads + 1);
    expect(at(h.fetchList.mock.calls, reads)[0]).toEqual({ id: "synthetic-connection", page: 6, search: "", restartCatalogue: true });
    expect(h.html()).toContain("Repository connections saved");
    expect(h.html()).not.toContain("page-6");
    pending.resolve(listing(["page-6"], true, true)); await h.settle();
    expect(h.html()).toContain("Choose repositories");
    expect(h.html()).toContain("0 selected across visited pages");
    expect(h.html()).toContain("page-6");
    expect(h.connect.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.props.onConnected).toHaveBeenCalledTimes(1);
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("next-page continuation keeps the last applied search and retires old page/search/review callbacks", async () => {
    const h = harness(); fillVerification(h);
    h.fetchList.mockImplementation(async input => listing(["page-" + input.page], true, !!input.restartCatalogue));
    await h.submit(); h.render();
    const beforeSearch = h.button("Continue from page 2 in a fresh batch").props.onClick!;
    h.change("Search repositories", "applied-search"); await h.submit(); await h.settle();
    const afterSearchReads = h.fetchList.mock.calls.length; beforeSearch(); await h.settle();
    expect(h.fetchList).toHaveBeenCalledTimes(afterSearchReads);
    h.change("Search repositories", "not-yet-applied");
    h.button("Continue from page 2 in a fresh batch").props.onClick!(); await h.settle();
    expect(at(h.fetchList.mock.calls, afterSearchReads)[0]).toEqual({ id: "synthetic-connection", page: 2, search: "applied-search", restartCatalogue: true });
    expect(h.input("Search repositories").props.value).toBe("applied-search");
    const beforeReview = h.button("Continue from page 3 in a fresh batch").props.onClick!;
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.button("Review 1 selected").props.onClick!(); h.render();
    const beforeReviewReads = h.fetchList.mock.calls.length; beforeReview(); await h.settle();
    expect(h.fetchList).toHaveBeenCalledTimes(beforeReviewReads);
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
  });

  it.each(["refused", "missing-reset-ack"])("next-page %s preserves original selection and page until a deliberate acknowledged retry", async failure => {
    const h = harness(); fillVerification(h);
    h.fetchList.mockResolvedValue(listing(["old-choice"], true));
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    if (failure === "refused") h.fetchList.mockRejectedValueOnce(Error("Synthetic private failure"));
    else h.fetchList.mockResolvedValueOnce(listing(["unacknowledged-next-page"], true, false));
    h.button("Continue from page 2 in a fresh batch").props.onClick!(); await h.settle();
    expect(h.html()).toContain("1 selected across visited pages");
    expect(h.html()).not.toContain("unacknowledged-next-page");
    expect(h.html()).not.toContain("Synthetic private failure");
    expect(h.html()).toContain("Your existing choices are retained");
    expect(h.button("Continue from page 2 in a fresh batch").props.disabled).toBe(false);
    h.fetchList.mockResolvedValueOnce(listing(["reviewed-next-page"], true, true));
    h.button("Continue from page 2 in a fresh batch").props.onClick!(); await h.settle();
    expect(h.html()).toContain("0 selected across visited pages");
    expect(h.html()).toContain("reviewed-next-page");
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
  });

  it.each(["actor", "project", "inactive", "unmount"])("next-page ACK after %s loss cannot replace retained choices or expose new metadata", async loss => {
    const h = harness(), pending = deferred<Listing>(); fillVerification(h);
    h.fetchList.mockResolvedValue(listing(["old-choice"], true));
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    h.fetchList.mockReturnValueOnce(pending.promise);
    const advance = h.button("Continue from page 2 in a fresh batch").props.onClick!;
    advance(); h.render();
    if (loss === "actor") { h.auth.userId = "other-clerk"; h.sdk.session.user.id = "other-clerk"; }
    if (loss === "project") h.props.projectId = "other-project";
    if (loss === "inactive") h.props.active = false;
    if (loss === "unmount") h.unmount();
    h.render();
    pending.resolve(listing(["foreign-late-next-page"], true, true)); await h.settle();
    expect(h.html()).not.toContain("foreign-late-next-page");
    h.auth.userId = "synthetic-clerk"; h.sdk.session.user.id = "synthetic-clerk";
    h.props.projectId = "synthetic-project"; h.props.active = true; h.render();
    expect(h.html()).toContain("1 selected across visited pages");
    const reads = h.fetchList.mock.calls.length; advance(); await h.settle();
    expect(h.fetchList).toHaveBeenCalledTimes(reads);
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("superseded next-page reset cannot replace a later admitted listing or clear its retained choices", async () => {
    const h = harness(), pending = deferred<Listing>(); fillVerification(h);
    h.fetchList.mockResolvedValue(listing(["old-choice"], true));
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    const next = h.button("Next page").props.onClick!;
    h.fetchList.mockReturnValueOnce(pending.promise);
    h.button("Continue from page 2 in a fresh batch").props.onClick!(); h.render();
    h.fetchList.mockResolvedValueOnce(listing(["later-admitted-page"], true)); next(); await h.settle();
    pending.resolve(listing(["superseded-reset-page"], true, true)); await h.settle();
    expect(h.html()).toContain("later-admitted-page");
    expect(h.html()).not.toContain("superseded-reset-page");
    expect(h.html()).toContain("1 selected across visited pages");
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
  });

  it("next-page continuation refuses exhausted listing, page 100, uncertainty and current-access loss without widening native bounds", async () => {
    const exhausted = harness(); fillVerification(exhausted);
    await exhausted.submit(); exhausted.render();
    const disabled = exhausted.button("Continue from page 2 in a fresh batch");
    expect(disabled.props.disabled).toBe(true); disabled.props.onClick!(); await exhausted.settle();
    expect(exhausted.fetchList).toHaveBeenCalledTimes(1);
    const h = harness(); fillVerification(h);
    h.fetchList.mockImplementation(async input => listing(["page-" + input.page], true));
    await h.submit(); h.render();
    for (let page = 2; page <= 100; page++) { h.button("Next page").props.onClick!(); await h.settle(); }
    expect(h.button("Continue from page 101 in a fresh batch").props.disabled).toBe(true);
    expect(h.button("Next page").props.disabled).toBe(true);
    const reads = h.fetchList.mock.calls.length, maximumPageNext = h.button("Next page").props.onClick!;
    h.button("Continue from page 101 in a fresh batch").props.onClick!(); maximumPageNext(); await h.settle();
    expect(h.fetchList).toHaveBeenCalledTimes(reads);
    expect(h.fetchList.mock.calls.some(call => at(call, 0).page === 101)).toBe(false);
    const lost = harness(); fillVerification(lost); lost.fetchList.mockResolvedValue(listing(["choice"], true));
    await lost.submit(); lost.render(); const advance = lost.button("Continue from page 2 in a fresh batch").props.onClick!;
    lost.capabilities.isSuccess = false; lost.render(); advance(); await lost.settle();
    expect(lost.fetchList).toHaveBeenCalledTimes(1);
    const uncertain = harness(); fillVerification(uncertain);
    uncertain.verify.mutateAsync.mockRejectedValueOnce(Error("Synthetic unknown verification"));
    await uncertain.submit(); uncertain.render();
    expect(uncertain.html()).not.toContain("Continue from page");
    expect(uncertain.button("Retry original verification")).toBeDefined();
    expect(uncertain.fetchList).not.toHaveBeenCalled();
  });

  it.each(["bitbucket", "azure-devops"])("does not add GitLab catalogue continuation to %s", async provider => {
    const h = harness(); h.props.providerId = provider; h.render();
    if (provider === "bitbucket") { h.change("Bitbucket workspace", "synthetic-workspace"); h.change("Atlassian account email", "synthetic@example.invalid"); }
    else h.change("Organization URL", "https://dev.azure.com/synthetic");
    h.change("API token", "synthetic-token"); h.consent();
    h.fetchList.mockResolvedValue(listing(["choice"], true));
    await h.submit(); h.render();
    expect(h.button("Next page")).toBeDefined();
    expect(h.html()).not.toContain("Continue from page");
    expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("captured original-account reset callback sends no read after current actor changes", async () => {
    const h = harness(); fillVerification(h);
    await h.submit(); h.render();
    h.button("Select this page (up to 100 total)").props.onClick!(); h.render();
    const reset = h.button("Start a new selection batch").props.onClick!, reads = h.fetchList.mock.calls.length;
    h.auth.userId = "other-clerk"; h.auth.sessionId = "other-session";
    h.sdk.session = { id: h.auth.sessionId, user: { id: h.auth.userId } }; h.render();
    reset(); await h.settle();
    expect(h.fetchList).toHaveBeenCalledTimes(reads);
    expect(h.html()).not.toContain("Synthetic repo-1");
    expect(h.connect.mutateAsync).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
  });
});
