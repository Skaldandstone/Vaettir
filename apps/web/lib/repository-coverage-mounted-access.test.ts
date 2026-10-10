// Actual Review, picker and access-hook declarations plus real TanStack query
// observers. React mounting/effects are modeled; markup uses installed React SSR.
// This is not browser, Clerk, provider/source-read or native write acceptance.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryObserver, onlineManager, type QueryObserverOptions } from "@tanstack/react-query";
import ts from "typescript";
import { expect, it } from "vitest";
import { caseFieldReadOrigin, caseFieldReadPins, sameCaseFieldOrigin } from "./case-field-origin";

type Element = React.ReactElement<Record<string, unknown>>;
type Observer = QueryObserver<unknown, Error, unknown, unknown, readonly unknown[]>;
type Options = QueryObserverOptions<unknown, Error, unknown, unknown, readonly unknown[]>;
type Slot = { kind: string; value?: unknown; deps?: readonly unknown[]; cleanup?: () => void; observer?: Observer; unsubscribe?: () => void };
type Mounted = { slots: Slot[]; cursor: number; name: string };
function declaration(file: string, name: string) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === name);
  if (!node) throw Error("Actual declaration absent: " + name);
  return node.getText(ast).replace(/^export /, "");
}
const currentReview = declaration("../components/RepositoryCoverageReview.tsx", "Review");
function reviewCode(legacyMountFault: boolean) {
  if (!legacyMountFault) return currentReview;
  // Reproduce only the retired mounting structure, keeping actual current hooks
  // and callbacks: access early-return + picker under the scope branch.
  const fieldset = /<fieldset[\s\S]*?<\/fieldset>/.exec(currentReview)?.[0];
  if (!fieldset) throw Error("Actual stable picker fieldset absent");
  const conditional = /\{access\.readable&&\(!scope\?<div[^\n]*>/.exec(currentReview)?.[0];
  if (!conditional) throw Error("Actual scope branch absent");
  return currentReview.replace(fieldset, "{null}").replace(conditional, conditional + fieldset)
    .replace("return <section", 'if(!access.readable)return <p role="status">Checking project access…</p>;\n  return <section');
}
function elements(value: unknown): Element[] {
  if (React.isValidElement(value)) {
    const node = value as Element;
    return [node, ...elements(node.props.children)];
  }
  return Array.isArray(value) ? value.flatMap(elements) : [];
}
const repositories = Array.from({ length: 14 }, (_, index) => ({
  id: `synthetic-repo-${index}`, projectId: "synthetic-project", provider: "gitlab",
  url: `https://gitlab.synthetic.example/services/service-${index}`, revision: null, accessVerified: false,
}));
function harness(legacyMountFault = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.mount();
  const instances = new Map<string, Mounted>(), mounts: string[] = [], unmounts: string[] = [], reads: Array<{ kind: string; input: Record<string, unknown> }> = [], writes: unknown[] = [];
  const pending: Array<() => void> = [], effects: Array<() => void> = [], layouts: Array<() => void> = [];
  const auth = { isLoaded: true, isSignedIn: true, userId: "synthetic-clerk" };
  let canEdit = true, organizationId = "synthetic-org", readFailure: Error | null = null, dirty = true, active: Mounted | null = null, uuid = 0;
  let tree: React.ReactNode = null;
  const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  function slot(kind: string): Slot {
    if (!active) throw Error("Synthetic hook outside mounted instance");
    const index = active.cursor++;
    active.slots[index] ??= { kind };
    const value = active.slots[index]!;
    if (value.kind !== kind) throw Error("Actual hook order changed");
    return value;
  }
  function effect(queue: Array<() => void>, fn: () => unknown, deps: readonly unknown[]) {
    const value = slot("effect");
    if (!same(value.deps, deps)) {
      value.deps = deps;
      queue.push(() => { value.cleanup?.(); const cleanup = fn(); value.cleanup = typeof cleanup === "function" ? cleanup as () => void : undefined; });
    }
  }
  const queryFunctions = new Map<string, () => Promise<unknown>>();
  function useQuery(kind: string, input: Record<string, unknown>, requested: Record<string, unknown> = {}) {
    const value = slot("query"), cacheKey = JSON.stringify([kind, input]);
    if (!queryFunctions.has(cacheKey)) queryFunctions.set(cacheKey, () => new Promise((resolve, reject) => {
      reads.push({ kind, input });
      const reader = { ...auth }, org = organizationId, editor = canEdit;
      pending.push(() => {
        if (kind === "caseFields") {
          if (readFailure) { reject(readFailure); return; }
          if (!reader.isSignedIn || input.expectedClerkActorId && input.expectedClerkActorId !== reader.userId || input.originalOrganizationId && input.originalOrganizationId !== org) { reject(Error("Synthetic native scope refusal")); return; }
          resolve({ projectId: input.projectId, caseId: null, organizationId: org, canEdit: editor, canConfigure: false,
            readScope: { projectId: input.projectId, organizationId: org, actorId: "synthetic-native", actorClerkUserId: reader.userId } });
        } else if (kind === "repositories") resolve(repositories);
        else resolve({ scopeHash: "synthetic-scope-hash", repositoryUrl: repositories[2]!.url, aiProcessing: false, credits: 0 });
      });
    }));
    // useBaseQuery sets this before getOptimisticResult: a new stale observer
    // must report its mount refetch optimistically, not a cached ready frame.
    const options: Options = { ...requested, queryKey: [kind, input], queryFn: queryFunctions.get(cacheKey)!, retry: false, _optimisticResults: "optimistic" };
    const defaulted = client.defaultQueryOptions(options);
    if (!value.observer) value.observer = new QueryObserver(client, defaulted);
    const observer = value.observer;
    effects.push(() => {
      observer.setOptions(defaulted);
      if (!value.unsubscribe) value.unsubscribe = observer.subscribe(() => { dirty = true; });
    });
    return observer.getOptimisticResult(defaulted);
  }
  const mutation = { isPending: false, error: null, reset() {}, mutateAsync: async (input: unknown) => { writes.push(input); throw Error("Synthetic source read prohibited"); } };
  const context = vm.createContext({
    React, caseFieldReadOrigin, caseFieldReadPins, sameCaseFieldOrigin,
    useAuth: () => auth, crypto: { randomUUID: () => `synthetic-request-${++uuid}` },
    useState: (initial: unknown) => {
      const value = slot("state");
      if (!("value" in value)) value.value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [value.value, (next: unknown) => {
        const replacement = typeof next === "function" ? (next as (before: unknown) => unknown)(value.value) : next;
        if (!Object.is(value.value, replacement)) { value.value = replacement; dirty = true; }
      }];
    },
    useMemo: (fn: () => unknown, deps: readonly unknown[]) => { const value = slot("memo"); if (!same(value.deps, deps)) { value.value = fn(); value.deps = deps; } return value.value; },
    useRef: (initial: unknown) => { const value = slot("ref"); value.value ??= { current: initial }; return value.value; },
    useEffect: (fn: () => unknown, deps: readonly unknown[]) => effect(effects, fn, deps),
    useLayoutEffect: (fn: () => unknown, deps: readonly unknown[]) => effect(layouts, fn, deps),
    Link: ({ children, ...props }: { children: React.ReactNode }) => React.createElement("a", props, children),
    SourceConnectionChips: () => React.createElement("span", null, "Synthetic connection setup boundary"),
    trpcReact: {
      caseFields: { get: { useQuery: (input: Record<string, unknown>, options: Record<string, unknown>) => useQuery("caseFields", input, options) } },
      project: { repositories: { useQuery: (input: Record<string, unknown>, options: Record<string, unknown>) => useQuery("repositories", input, options) } },
      repositoryCoverageChecks: { preview: { useQuery: (input: Record<string, unknown>, options: Record<string, unknown>) => useQuery("preview", input, options) }, compare: { useMutation: () => mutation } },
    },
  });
  const code = [declaration("./use-case-field-access.ts", "useCaseFieldAccess"), declaration("../components/ConnectedRepositoryPicker.tsx", "ConnectedRepositoryPicker"), reviewCode(legacyMountFault)].join("\n");
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText, context);
  const components = context as unknown as {
    Review: (props: { projectId: string }) => React.ReactNode;
    ConnectedRepositoryPicker: (props: { projectId: string; selectedId: string; onSelect: (repository: unknown) => void }) => React.ReactNode;
  };
  function render() {
    dirty = false; effects.length = 0; layouts.length = 0;
    const seen = new Set<string>();
    function mount(node: React.ReactNode, path: string): React.ReactNode {
      if (Array.isArray(node)) return node.map((child, index) => mount(child, `${path}/${index}`));
      if (!React.isValidElement<Record<string, unknown>>(node)) return node;
      if (typeof node.type === "function") {
        const key = path + ":" + node.type.name;
        seen.add(key);
        if (!instances.has(key)) { instances.set(key, { slots: [], cursor: 0, name: node.type.name }); mounts.push(node.type.name); }
        const previous = active;
        active = instances.get(key)!; active.cursor = 0;
        const value = (node.type as (props: unknown) => React.ReactNode)(node.props);
        active = previous;
        return mount(value, path + "/render");
      }
      const children = mount(node.props.children as React.ReactNode, path + "/children");
      return Array.isArray(children) ? React.cloneElement(node, undefined, ...children) : React.cloneElement(node, undefined, children);
    }
    tree = mount(React.createElement("div", null,
      React.createElement(components.ConnectedRepositoryPicker, { projectId: "synthetic-project", selectedId: "", onSelect() {} }),
      React.createElement(components.Review, { projectId: "synthetic-project" })), "root");
    for (const [key, instance] of instances) if (!seen.has(key)) {
      for (const value of instance.slots) { value.cleanup?.(); value.unsubscribe?.(); }
      instances.delete(key); unmounts.push(instance.name);
    }
    layouts.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn());
    return tree;
  }
  async function pump(rounds = 12) {
    for (let index = 0; index < rounds; index++) {
      if (dirty) render();
      // Deliver observer fetch notifications before resolving synthetic HTTP.
      // Immediate completion would skip the real mounted isFetching frame.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!dirty) pending.splice(0).forEach(finish => finish());
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (dirty) render();
  }
  function reviewNodes() { return elements(tree).find(node => node.props["aria-label"] === "Compare repository test files")!; }
  function button(label: string) {
    const found = elements(reviewNodes()).find(node => node.type === "button" && node.props.children === label);
    if (!found) throw Error("Actual comparison button missing: " + label);
    return found;
  }
  function close() { for (const instance of instances.values()) for (const value of instance.slots) { value.cleanup?.(); value.unsubscribe?.(); } instances.clear(); client.unmount(); client.clear(); }
  return { auth, client, reads, writes, mounts, unmounts, render, pump, button, reviewNodes, mutation, close,
    get tree() { return tree; }, html: () => renderToStaticMarkup(tree),
    setEditor(value: boolean) { canEdit = value; }, setOrganization(value: string) { organizationId = value; },
    setReadFailure(value: Error | null) { readFailure = value; },
    async refreshAccess() { void client.invalidateQueries({ queryKey: ["caseFields"] }); await pump(); },
    forceRender() { dirty = true; render(); },
  };
}

it("real staleTime-zero observer mounting reproduces the retired early-return loop, while the actual fixed parent settles", async () => {
  const legacy = harness(true), fixed = harness();
  try {
    await legacy.pump(16); await fixed.pump(16);
    expect(legacy.mounts.filter(name => name === "ConnectedRepositoryPicker").length).toBeGreaterThan(3);
    expect(legacy.unmounts).toContain("ConnectedRepositoryPicker");
    expect(legacy.reads.filter(read => read.kind === "caseFields").length).toBeGreaterThan(fixed.reads.filter(read => read.kind === "caseFields").length);
    expect(fixed.mounts.filter(name => name === "ConnectedRepositoryPicker")).toHaveLength(2);
    expect(fixed.unmounts.filter(name => name === "ConnectedRepositoryPicker")).toEqual([]);
    expect(fixed.html().match(/Choose from 14 project repositories/g)).toHaveLength(2);
    const count = fixed.reads.length; await fixed.pump(8); expect(fixed.reads).toHaveLength(count);
    expect(fixed.reads.filter(read => read.kind === "preview")).toEqual([]);
    expect(fixed.writes).toEqual([]); expect(legacy.writes).toEqual([]);
  } finally { legacy.close(); fixed.close(); }
});

it("ordinary scope review/back preserves the mounted picker, exact selection/draft and no source read", async () => {
  const h = harness();
  try {
    await h.pump();
    const picker = elements(h.reviewNodes()).find(node => node.type === "select")!;
    (picker.props.onChange as (event: unknown) => void)({ target: { value: repositories[2]!.id } }); h.forceRender();
    const paths = elements(h.reviewNodes()).find(node => node.type === "textarea")!;
    (paths.props.onChange as (event: unknown) => void)({ target: { value: " tests\nsrc/tests " } }); h.forceRender();
    expect(h.button("Review source comparison").props.disabled).toBe(false);
    (h.button("Review source comparison").props.onClick as () => void)(); await h.pump();
    expect(h.html()).toContain("Allowed paths: tests, src/tests");
    expect(h.button("Compare source links").props.disabled).toBe(true);
    (h.button("Back to scope").props.onClick as () => void)(); await h.pump();
    expect(elements(h.reviewNodes()).find(node => node.type === "select")!.props.value).toBe(repositories[2]!.id);
    expect(elements(h.reviewNodes()).find(node => node.type === "textarea")!.props.value).toBe(" tests\nsrc/tests ");
    expect(h.mounts.filter(name => name === "ConnectedRepositoryPicker")).toHaveLength(2);
    expect(h.unmounts.filter(name => name === "ConnectedRepositoryPicker")).toEqual([]);
    expect(h.writes).toEqual([]);
  } finally { h.close(); }
});

it("refresh withholds/disables private controls without unmounting; original access returns without new mount reads", async () => {
  const h = harness();
  try {
    await h.pump();
    void h.client.invalidateQueries({ queryKey: ["caseFields"] }); h.forceRender();
    expect(h.html()).toContain("Checking project access");
    expect(h.html()).not.toContain("service-2");
    expect(elements(h.reviewNodes()).find(node => node.type === "fieldset")!.props).toMatchObject({ disabled: true, hidden: true });
    await h.pump();
    expect(h.html().match(/Choose from 14 project repositories/g)).toHaveLength(2);
    expect(h.mounts.filter(name => name === "ConnectedRepositoryPicker")).toHaveLength(2);
    expect(h.unmounts.filter(name => name === "ConnectedRepositoryPicker")).toEqual([]);
    expect(h.writes).toEqual([]);
  } finally { h.close(); }
});

it.each(["actor", "organization", "signed-out"])("original scope loss %s cannot reveal old choices or admit a captured selection/review", async loss => {
  const h = harness();
  try {
    await h.pump();
    const select = elements(h.reviewNodes()).find(node => node.type === "select")!;
    (select.props.onChange as (event: unknown) => void)({ target: { value: repositories[2]!.id } }); h.forceRender();
    const paths = elements(h.reviewNodes()).find(node => node.type === "textarea")!;
    (paths.props.onChange as (event: unknown) => void)({ target: { value: "tests" } }); h.forceRender();
    const oldReview = h.button("Review source comparison").props.onClick as () => void;
    if (loss === "actor") h.auth.userId = "foreign-clerk";
    if (loss === "organization") h.setOrganization("foreign-org");
    if (loss === "signed-out") h.auth.isSignedIn = false;
    await h.refreshAccess(); h.forceRender();
    (select.props.onChange as (event: unknown) => void)({ target: { value: repositories[3]!.id } }); oldReview(); h.forceRender();
    expect(h.html()).not.toContain("service-2");
    expect(h.html()).not.toContain("tests</textarea>");
    expect(h.reads.filter(read => read.kind === "preview")).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.mounts.filter(name => name === "ConnectedRepositoryPicker")).toHaveLength(2);
  } finally { h.close(); }
});

it.each(["error", "paused", "read-only"])("%s fresh access retains the picker and denies captured review without leaking error details", async state => {
  const h = harness();
  try {
    await h.pump();
    const select = elements(h.reviewNodes()).find(node => node.type === "select")!;
    (select.props.onChange as (event: unknown) => void)({ target: { value: repositories[2]!.id } }); h.forceRender();
    const paths = elements(h.reviewNodes()).find(node => node.type === "textarea")!;
    (paths.props.onChange as (event: unknown) => void)({ target: { value: " tests\nraw-path " } }); h.forceRender();
    const oldReview = h.button("Review source comparison").props.onClick as () => void;
    if (state === "error") h.setReadFailure(Error("Synthetic private access error detail"));
    if (state === "paused") onlineManager.setOnline(false);
    if (state === "read-only") h.setEditor(false);
    await h.refreshAccess(); h.forceRender(); oldReview(); h.forceRender();
    const fieldset = elements(h.reviewNodes()).find(node => node.type === "fieldset")!;
    expect(fieldset.props.disabled).toBe(true);
    expect(h.html()).not.toContain("Synthetic private access error detail");
    if (state !== "read-only") {
      expect(fieldset.props.hidden).toBe(true);
      expect(h.html()).not.toContain("service-2");
      expect(h.html()).not.toContain("raw-path</textarea>");
    } else {
      expect(fieldset.props.hidden).toBe(false);
      expect(h.button("Review source comparison").props.disabled).toBe(true);
    }
    expect(h.mounts.filter(name => name === "ConnectedRepositoryPicker")).toHaveLength(2);
    expect(h.unmounts.filter(name => name === "ConnectedRepositoryPicker")).toEqual([]);
    expect(h.reads.filter(read => read.kind === "preview")).toEqual([]); expect(h.writes).toEqual([]);
    h.setReadFailure(null); onlineManager.setOnline(true); h.setEditor(true);
    await h.refreshAccess(); h.forceRender();
    expect(elements(h.reviewNodes()).find(node => node.type === "select")!.props.value).toBe(repositories[2]!.id);
    expect(elements(h.reviewNodes()).find(node => node.type === "textarea")!.props.value).toBe(" tests\nraw-path ");
  } finally { onlineManager.setOnline(true); h.close(); }
});
