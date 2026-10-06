import { readFileSync } from "node:fs";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../components/ManualRetestWizard.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile("ManualRetestWizard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const access = ast.statements.find(
  (node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "useRetestAccess",
);
if (!access?.body) throw Error("Actual retest metadata access hook was not found.");
const endpoints = ["project", "organizations"] as const;
type Endpoint = (typeof endpoints)[number];

function actualOptions(endpoint: Endpoint, enabled = true) {
  const declaration = access!.body!.statements
    .filter(ts.isVariableStatement)
    .flatMap(node => [...node.declarationList.declarations])
    .find(node => ts.isIdentifier(node.name) && node.name.text === endpoint);
  if (!declaration?.initializer || !ts.isCallExpression(declaration.initializer)) throw Error("Actual metadata observer call is missing.");
  expect(declaration.initializer.expression.getText(ast)).toBe(
    endpoint === "project" ? "trpcReact.project.byId.useQuery" : "trpcReact.organization.mine.useQuery",
  );
  const options = declaration.initializer.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) throw Error("Actual metadata observer options are missing.");
  // Evaluate ONLY the real option object (literal values plus the explicit
  // metadataReadEnabled parameter), never the component or native transport.
  const code = ts.transpileModule(`return (${options.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function("metadataReadEnabled", code)(enabled) as {
    enabled: boolean;
    staleTime: number;
    retry: false;
    refetchOnMount?: false;
  };
}

function actualMetadataAdmission(endpoint: Endpoint, result: { data: unknown; error: Error | null; isFetching: boolean; isPaused: boolean }) {
  const retained = { data: metadata(endpoint === "project" ? "organizations" : "project"), error: null, isFetching: false, isPaused: false };
  const names = new Set(["projectReady", "memberChecked", "member", "memberReady", "canWrite", "current"]);
  const statements = access!.body!.statements.filter(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.every(declaration => ts.isIdentifier(declaration.name) && names.has(declaration.name.text)));
  expect(statements).toHaveLength(6);
  const code = ts.transpileModule(statements.map(node => node.getText(ast)).join("\n") + "\nreturn current;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function("project", "organizations", "projectId", "actorReady", "userId", code)(
    endpoint === "project" ? result : retained,
    endpoint === "organizations" ? result : retained,
    "synthetic-project", true, "synthetic-clerk",
  );
}

const clients: QueryClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.clear(); });
const client = () => {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(value);
  return value;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function metadata(endpoint: Endpoint) {
  return endpoint === "project"
    ? { id: "synthetic-project", organizationId: "synthetic-org" }
    : [{ id: "synthetic-org", role: "EDITOR", seatType: "FULL" }];
}
const queryKey = (endpoint: Endpoint) => endpoint === "project"
  ? [["project", "byId"], { input: { id: "synthetic-project" }, type: "query" }]
  : [["organization", "mine"], { type: "query" }];

describe("actual installed TanStack retest metadata mount lifecycle, synthetic transport only", () => {
  it.each(endpoints)("%s newly mounted observer does not refetch an already populated shared metadata cache", async endpoint => {
    const cache = client(), key = queryKey(endpoint), next = deferred<ReturnType<typeof metadata>>();
    let reads = 0;
    const queryFn = () => ++reads === 1 ? Promise.resolve(metadata(endpoint)) : next.promise;
    const parent = new QueryObserver(cache, { queryKey: key, queryFn, ...actualOptions(endpoint) });
    const parentEvents: boolean[] = [];
    const parentStop = parent.subscribe(result => parentEvents.push(result.isFetching));
    // The parent's observer is ALREADY mounted and its initial request has
    // completed, like the verified page before the first failed-case child.
    await parent.refetch();
    expect(reads).toBe(1);
    expect(parent.getCurrentResult().isFetching).toBe(false);
    parentEvents.length = 0;
    const child = new QueryObserver(cache, { queryKey: key, queryFn, ...actualOptions(endpoint) });
    const childStop = child.subscribe(() => {});
    try {
      expect(reads).toBe(1);
      expect(parent.getCurrentResult().isFetching).toBe(false);
      expect(actualMetadataAdmission(endpoint, parent.getCurrentResult())).toEqual({ projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-clerk" });
      expect(child.getCurrentResult().data).toEqual(metadata(endpoint));
      expect(parentEvents).not.toContain(true);
    } finally { next.resolve(metadata(endpoint)); childStop(); parentStop(); }
  });

  it.each(endpoints)("%s empty metadata cache still makes the initial native-boundary query", async endpoint => {
    const cache = client(), next = deferred<ReturnType<typeof metadata>>();
    let reads = 0;
    const observer = new QueryObserver(cache, { queryKey: queryKey(endpoint), queryFn: () => { reads++; return next.promise; }, ...actualOptions(endpoint) });
    const stop = observer.subscribe(() => {});
    try {
      expect(reads).toBe(1);
      expect(observer.getCurrentResult().isFetching).toBe(true);
      expect(observer.getCurrentResult().data).toBeUndefined();
      next.resolve(metadata(endpoint));
      await observer.refetch();
      expect(observer.getCurrentResult().isSuccess).toBe(true);
      expect(observer.getCurrentResult().data).toEqual(metadata(endpoint));
    } finally { next.resolve(metadata(endpoint)); stop(); }
  });

  it.each(endpoints)("%s explicit refetch still withholds shared metadata during fetching and after failure", async endpoint => {
    const cache = client(), key = queryKey(endpoint), next = deferred<ReturnType<typeof metadata>>();
    cache.setQueryData(key, metadata(endpoint));
    let reads = 0;
    const options = actualOptions(endpoint);
    const parent = new QueryObserver(cache, { queryKey: key, queryFn: () => { reads++; return next.promise; }, ...options });
    const child = new QueryObserver(cache, { queryKey: key, queryFn: () => { reads++; return next.promise; }, ...options });
    const parentStop = parent.subscribe(() => {}), childStop = child.subscribe(() => {});
    try {
      const attempt = child.refetch();
      expect(reads).toBe(1);
      expect(parent.getCurrentResult().isFetching).toBe(true);
      expect(actualMetadataAdmission(endpoint, parent.getCurrentResult())).toBeNull();
      next.reject(Error("Synthetic private metadata failure"));
      await attempt;
      expect(parent.getCurrentResult().isError).toBe(true);
      expect(parent.getCurrentResult().isFetching).toBe(false);
      expect(parent.getCurrentResult().data).toEqual(metadata(endpoint));
      // Retained data is NOT success/readiness: no repaired/default role or
      // suppressed error is introduced by declining mount-triggered refetch.
      expect(parent.getCurrentResult().isSuccess).toBe(false);
      expect(actualMetadataAdmission(endpoint, parent.getCurrentResult())).toBeNull();
    } finally { childStop(); parentStop(); }
  });

  it.each(endpoints)("%s existing admission and explicit refresh options remain unchanged", endpoint => {
    const options = actualOptions(endpoint);
    expect(options).toEqual({ enabled: true, staleTime: 0, retry: false, refetchOnMount: false });
    expect(actualOptions(endpoint, false).enabled).toBe(false);
    expect(options).not.toHaveProperty("refetchOnWindowFocus");
    const refresh = access!.body!.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "refresh");
    expect(refresh?.getText(ast)).toContain("Promise.all([project.refetch(), organizations.refetch()])");
  });

  it.each(endpoints.flatMap(endpoint => (["FOCUS", "INVALIDATE"] as const).map(event => [endpoint, event] as const)))("%s %s remains a real fetch/revocation path", async (endpoint, event) => {
    const cache = client(), key = queryKey(endpoint), next = deferred<ReturnType<typeof metadata>>();
    cache.setQueryData(key, metadata(endpoint));
    let reads = 0;
    const observer = new QueryObserver(cache, { queryKey: key, queryFn: () => { reads++; return next.promise; }, ...actualOptions(endpoint) });
    const stop = observer.subscribe(() => {});
    try {
      expect(reads).toBe(0);
      expect(observer.shouldFetchOnWindowFocus()).toBe(true);
      let completed: Promise<unknown>;
      if (event === "FOCUS") {
        const query = cache.getQueryCache().find({ queryKey: key, exact: true });
        expect(query).toBeDefined();
        query!.onFocus();
        completed = observer.refetch({ cancelRefetch: false });
      } else completed = cache.invalidateQueries({ queryKey: key, exact: true });
      expect(reads).toBe(1);
      expect(actualMetadataAdmission(endpoint, observer.getCurrentResult())).toBeNull();
      next.resolve(metadata(endpoint));
      await completed;
      expect(actualMetadataAdmission(endpoint, observer.getCurrentResult())).not.toBeNull();
    } finally { next.resolve(metadata(endpoint)); stop(); }
  });

  it.each(endpoints)("%s cached identity/role disagreement and paused metadata remain withheld", endpoint => {
    const value = metadata(endpoint);
    const invalid = endpoint === "project"
      ? { ...(value as { id: string; organizationId: string }), id: "foreign-project" }
      : [{ id: "synthetic-org", role: "RETIRED_ROLE", seatType: "FULL" }];
    expect(actualMetadataAdmission(endpoint, { data: invalid, error: null, isFetching: false, isPaused: false })).toBeNull();
    expect(actualMetadataAdmission(endpoint, { data: value, error: null, isFetching: false, isPaused: true })).toBeNull();
  });
});
