import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { connectionAccessState } from "./connection-access";
import { gitlabInstanceOrigin } from "./gitlab-instance-selection";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { caseFieldReadOrigin, sameCaseFieldOrigin, type CaseFieldOrigin } from "./case-field-origin";
import type { RouterOutputs } from "./trpcReact";

type Props = Parameters<typeof import("../components/GitlabRepositoryConnection").RepositoryOAuthConnection>[0];
type Listing = RouterOutputs["repositoryConnections"]["list"];
type Repository = Listing["repositories"][number];
type Selection = { ids: string[]; details: Record<string, Repository> };
type Element = React.ReactElement<{
  children?: React.ReactNode; className?: string; disabled?: boolean; "aria-pressed"?: boolean;
  onClick?: () => void; onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: { preventDefault(): void }) => void;
}>;
const source = readFileSync(new URL("../components/GitlabRepositoryConnection.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("Repository.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) || ts.isVariableStatement(node))
  .map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, "")).join("\n");
const compiled = ts.transpileModule(declarations + "\nthis.actual=RepositoryOAuthConnection;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText;
const repository = (id: string, name = `synthetic/${id}`): Repository => ({ id, name, url: `https://synthetic.example/${id}`, defaultBranch: "main" });
const listing = (repositories: Repository[], catalogReset = false): Listing => ({ repositories, catalogReset, hasMore: true, catalogVersion: "a".repeat(64),limitReached:false,listingStatus:"more-pages",scopeKey:null,githubInstallationRequired:false });
const selection = (count: number): Selection => {
  const repositories = Array.from({ length: count }, (_, index) => repository(`visited-${index}`));
  return { ids: repositories.map(repo => repo.id), details: Object.fromEntries(repositories.map(repo => [repo.id, repo])) };
};
function elements(node: React.ReactNode): Element[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node as Element, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
function text(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return text(node.props.children);
  return React.Children.toArray(node).map(text).join("");
}
function harness(initial: Selection, currentListing = listing([repository("new-a"), repository("new-b")])) {
  // Full actual component JSX/handlers and actual pure access/URL helpers.
  // Hook state and metadata replies are synthetic; this is not OAuth/provider,
  // native catalog, authorization, connection acceptance or browser evidence.
  const hooks: unknown[] = ["repositories", "", "", "synthetic-connection", "", "", 1, currentListing, initial, false, ""];
  let cursor = 0, memoCursor = 0, dirty = false;
  const memos: Array<{ value: unknown; dependencies: unknown[] }> = [];
  const updaterChecks: Array<{ before: Selection; after: Selection; repeated: Selection }> = [];
  const writes = vi.fn(async () => { throw Error("External/write action forbidden in synthetic selection model"); });
  const fetch = vi.fn(async (_input: { id: string; page: number; search: string; restartCatalogue?: boolean }): Promise<Listing> => { throw Error("Unprepared synthetic metadata reply"); });
  const query = <T,>(data: T) => ({ data, isSuccess: true, error: null, isFetching: false, refetch: writes });
  const auth = { isLoaded: true, isSignedIn: true, userId: "synthetic-clerk", sessionId: "synthetic-session" };
  const nativeReaderEcho = { projectId: "synthetic-project", caseId: null, organizationId: "synthetic-org",
    readScope: { projectId: "synthetic-project", organizationId: "synthetic-org", actorId: "synthetic-native", actorClerkUserId: auth.userId } };
  const origin = caseFieldReadOrigin(nativeReaderEcho, nativeReaderEcho.projectId, null, auth.userId)!;
  const reader = { origin, current: origin as CaseFieldOrigin | null, readable: true, canEdit: true,
    owns: (original: CaseFieldOrigin, mode?: "read" | "edit" | "configure") => sameCaseFieldOrigin(original, reader.current) && reader.readable && (mode !== "edit" || reader.canEdit),
    query: { refetch: writes } };
  const utils = { repositoryConnections: { list: { fetch } } };
  const context = vm.createContext({ React, connectionAccessState, gitlabInstanceOrigin, currentSessionScope, sameAuthScope, sameCaseFieldOrigin, URL,
    useAuth: () => auth, useCaseFieldAccess: () => reader,
    window: { Clerk: { loaded: true, session: { id: auth.sessionId, user: { id: auth.userId } } } },
    useMemo: (make: () => unknown, dependencies: unknown[]) => {
      const index = memoCursor++, previous = memos[index];
      if (!previous || dependencies.length !== previous.dependencies.length || dependencies.some((value, at) => !Object.is(value, previous.dependencies[at])))
        memos[index] = { value: make(), dependencies };
      return memos[index]!.value;
    },
    useState: (initialValue: unknown) => {
      const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [hooks[index], (next: unknown) => {
        if (typeof next !== "function") { if (!Object.is(next, hooks[index])) dirty = true; hooks[index] = next; return; }
        const before = hooks[index], after = next(before);
        // React can replay a pure updater. Invoke twice on the same input to
        // check deterministic output and ensure the previous state is untouched.
        if (index === 8) updaterChecks.push({ before: before as Selection, after, repeated: next(before) });
        if (!Object.is(after, before)) dirty = true; hooks[index] = after;
      }];
    },
    useRef: (initialValue: unknown) => { const index = cursor++; return hooks[index] ??= { current: initialValue }; },
    useCallback: (callback: unknown) => callback, useEffect: (callback: () => void) => callback(), useLayoutEffect: (callback: () => void) => callback(),
    trpcReact: { useUtils: () => utils, repositoryConnections: {
      configurations: { useQuery: () => query({ organizationId: origin.organizationId, canConnect: true, canConfigure: false, storageReady: true, configurations: [] }) },
      mine: { useQuery: () => query([]) }, status: { useQuery: () => query({ status: "VERIFIED" }) },
      groups:{useQuery:()=>query({groups:[],hasMore:false,limitReached:false})},
      installations:{useQuery:()=>({data:{installations:[],hasMore:false,limitReached:false},isFetchedAfterMount:false,isSuccess:false,error:null})},
      begin: { useMutation: () => ({ isPending: false, mutateAsync: writes }) },
      connectSelected: { useMutation: () => ({ isPending: false, mutateAsync: writes }) },
      disconnect: { useMutation: () => ({ isPending: false, mutateAsync: writes }) },
      renewGitlab: { useMutation: () => ({ isPending: false, mutateAsync: writes }) },
    } },
    ProviderMark: () => React.createElement("span", null, "GitLab"),
    Link: ({ children }: { children: React.ReactNode }) => React.createElement("span", null, children),
    ConnectionAccessGate: () => { throw Error("Unexpected access gate"); },
    authorizeRepositoryAccount: writes, cancelRepositoryAuthorization: writes,
  });
  vm.runInContext(compiled, context);
  const actual = (context as unknown as { actual(props: Props): React.ReactElement }).actual;
  const props: Props = { projectId: "synthetic-project", providerId: "gitlab", onConnected: writes, onClose: writes };
  const render = () => {
    for (let turn = 0; turn < 10; turn++) { cursor = 0; memoCursor = 0; dirty = false; const tree = actual(props); if (!dirty) return tree; }
    throw Error("Synthetic repository hooks did not settle");
  };
  const button = (label: string) => {
    const found = elements(render()).find(node => node.type === "button" && text(node.props.children) === label);
    if (!found) throw Error(`Missing actual button ${label}`); return found;
  };
  const chips = () => elements(render()).filter(node => node.props.className === "source-connection-chip");
  const selected = () => hooks[8] as Selection;
  const flush = async () => { for (let turn = 0; turn < 8; turn++) await Promise.resolve(); };
  const assertCoherent = () => {
    const current = selected();
    expect(new Set(current.ids).size).toBe(current.ids.length);
    expect(Object.keys(current.details).sort()).toEqual([...current.ids].sort());
    expect(current.ids.length).toBeLessThanOrEqual(100);
    for (const update of updaterChecks) expect(update.repeated).toEqual(update.after);
    expect(writes).not.toHaveBeenCalled();
  };
  return { hooks, render, button, chips, selected, fetch, writes, flush, updaterChecks, assertCoherent };
}

describe("actual repository selection transitions (synthetic hooks/metadata only)", () => {
  it("two captured distinct clicks at 99 enforce latest-state 100 cap and matching review metadata", () => {
    const original = selection(99), before = JSON.stringify(original), h = harness(original), [first, second] = h.chips();
    first!.props.onClick!(); second!.props.onClick!();
    expect(h.selected().ids).toEqual([...original.ids, "new-a"]);
    expect(h.selected().details["new-b"]).toBeUndefined();
    expect(JSON.stringify(original)).toBe(before); h.assertCoherent();
    h.button("Review 100 selected").props.onClick!();
    const html = renderToStaticMarkup(h.render());
    expect(html).toContain("Connect 100 repositories"); expect(html).toContain("synthetic/new-a"); expect(html).not.toContain("synthetic/new-b");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("repeated captured same-repository clicks toggle latest state instead of creating duplicate IDs", () => {
    const original = selection(99), h = harness(original), captured = h.chips()[0]!.props.onClick!;
    captured(); expect(h.selected().ids).toHaveLength(100);
    captured(); expect(h.selected()).toEqual(original); h.assertCoherent();
    captured(); expect(h.selected().ids.filter(id => id === "new-a")).toHaveLength(1); h.assertCoherent();
  });
  it("at cap a captured add is refused without state replacement, while removal and subsequent add remain usable", () => {
    const original = selection(100), h = harness(original, listing([original.details[original.ids[0]!]!, repository("new-a")]));
    const [remove, add] = h.chips(); expect(remove!.props.disabled).toBe(false); expect(add!.props.disabled).toBe(true);
    add!.props.onClick!(); expect(h.selected()).toBe(original);
    remove!.props.onClick!(); expect(h.selected().ids).toHaveLength(99); expect(h.selected().details[original.ids[0]!]).toBeUndefined();
    add!.props.onClick!(); expect(h.selected().ids).toHaveLength(100); expect(h.selected().details["new-a"]).toEqual(repository("new-a")); h.assertCoherent();
  });
  it("paging retains off-page IDs and atomically refreshes selected metadata before further selection/review", async () => {
    const original = selection(1), selectedId = original.ids[0]!, h = harness(original);
    h.fetch.mockResolvedValueOnce(listing([repository(selectedId, "synthetic/updated-name"), repository("page-two")]));
    h.button("Next page").props.onClick!(); await h.flush();
    expect(h.fetch).toHaveBeenCalledExactlyOnceWith({ id: "synthetic-connection", page: 2, search: "" });
    expect(h.selected().ids).toEqual(original.ids); expect(h.selected().details[selectedId]!.name).toBe("synthetic/updated-name");
    expect(original.details[selectedId]!.name).toBe(`synthetic/${selectedId}`);
    h.chips()[1]!.props.onClick!(); h.assertCoherent(); h.button("Review 2 selected").props.onClick!();
    const html = renderToStaticMarkup(h.render()); expect(html).toContain("Connect 2 repositories"); expect(html).toContain("synthetic/updated-name"); expect(html).toContain("synthetic/page-two");
  });
  it("search retains selected off-page metadata and sends only the actual local metadata filter", async () => {
    const original = selection(2), h = harness(original), input = elements(elements(h.render()).find(node=>node.type==="form")!).find(node => node.type === "input")!;
    input.props.onChange!({ target: { value: "needle" } });
    h.fetch.mockResolvedValueOnce(listing([repository("match")]));
    const prevented = vi.fn(); elements(h.render()).find(node => node.type === "form")!.props.onSubmit!({ preventDefault: prevented }); await h.flush();
    expect(prevented).toHaveBeenCalledOnce(); expect(h.fetch).toHaveBeenCalledExactlyOnceWith({ id: "synthetic-connection", page: 1, search: "needle" });
    expect(h.selected()).toEqual(original); h.chips()[0]!.props.onClick!(); expect(h.selected().ids).toEqual([...original.ids, "match"]); h.assertCoherent();
  });
  it("catalog reset clears IDs/details together, and a new listing can be selected without stale review metadata", async () => {
    const h = harness(selection(99)); h.fetch.mockResolvedValueOnce(listing([repository("fresh")], true));
    h.button("Next page").props.onClick!(); await h.flush();
    expect(h.selected()).toEqual({ ids: [], details: {} }); expect(h.button("Review 0 selected").props.disabled).toBe(true);
    h.chips()[0]!.props.onClick!(); h.assertCoherent(); h.button("Review 1 selected").props.onClick!();
    const html = renderToStaticMarkup(h.render()); expect(html).toContain("Connect 1 repository"); expect(html).toContain("synthetic/fresh"); expect(html).not.toContain("synthetic/visited-");
  });
  it("Clear selection remains local, while connect-more resets both halves only after a fresh catalogue ACK", async () => {
    const h = harness(selection(3)); h.button("Clear selection").props.onClick!(); expect(h.selected()).toEqual({ ids: [], details: {} }); h.assertCoherent();
    // Seed the existing done UI, without asserting any native connect occurred.
    h.hooks[0] = "done"; h.hooks[8] = selection(3); const original = h.selected();
    h.fetch.mockResolvedValueOnce(listing([repository("fresh")], true)); h.button("Connect more repositories").props.onClick!();
    expect(h.hooks[0]).toBe("done"); expect(h.selected()).toBe(original);
    expect(h.fetch).toHaveBeenCalledExactlyOnceWith({ id: "synthetic-connection", page: 1, search: "", restartCatalogue: true });
    await h.flush();
    expect(h.hooks[0]).toBe("repositories"); expect(h.selected()).toEqual({ ids: [], details: {} }); h.assertCoherent();
  });
});
