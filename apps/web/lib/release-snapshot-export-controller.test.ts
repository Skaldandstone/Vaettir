import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import type { AppRouter } from "@vaettir/api/src/router";
import type { Prisma, PrismaClient } from "@vaettir/db";
import { readRunHistoryAccess } from "@vaettir/api/src/services/runHistoryRead";
import { runHistoryReadKey } from "@vaettir/api/src/services/runHistoryReadSchema";
import { describe, expect, it, vi } from "vitest";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { admitRunHistoryAccess, RunHistoryRenderGuard, sameRunHistoryOrigin, type RunHistoryAccessInput } from "./run-history-reader";
import { buildHtmlSnapshot, buildMarkdownSnapshot, type SnapshotData } from "./snapshotExport";
import { downloadFile as actualDownloadFile } from "./download";

// Actual component/owner/read-admission/download functions with synthetic RPCs
// and deterministic hook commits. No Clerk/backend/native browser operation.
const source = readFileSync(new URL("../components/ReleaseSnapshotExport.tsx", import.meta.url), "utf8"),
  ast = ts.createSourceFile("export.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  code = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node))
    .map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/^export\s+/gm, "")).join("\n") +
    "\nthis.wrapper=ReleaseSnapshotExport;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const routes = createTRPCReact<AppRouter>();
type Props = { projectId: string; releaseId: string; organizationId: string; active: boolean };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Button = React.ReactElement<{ onClick: () => void; disabled?: boolean; children?: React.ReactNode }>;
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"], reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function snapshot(releaseId = "release", projectId = "project"): SnapshotData {
  return { release: { id: releaseId, projectId, name: "Synthetic release", status: "PLANNING", targetDate: null }, projectName: "Synthetic project",
    readiness: { score: 0, label: "AT_RISK", criteria: { met: 0, atRisk: 0, notMet: 0, pending: 1, total: 1 }, riskFlags: { critical: 0, high: 0, medium: 0, low: 0, openTotal: 0 } },
    testPlans: [{ id: "plan", name: "Synthetic", status: "DRAFT", testPlanType: { id: "type", name: "Regression" }, acceptanceCriteria: [{ id: "criterion", description: "Private synthetic wording\nsecond", status: "PENDING", autoComputed: false }] }],
    riskFlags: [], trend: [], generatedAt: "2026-10-06T12:00:00.000Z" };
}
function accessDto(input: RunHistoryAccessInput, native = "native") {
  return { readContext: { requestId: input.requestId, requestedKey: runHistoryReadKey(input), projection: "ACCESS" as const,
    scope: { projectId: input.projectId, organizationId: input.originalOrganizationId, actorId: native, actorClerkUserId: input.expectedClerkActorId }, asOf: "2026-10-06T12:00:00.000Z" } };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function elements(node: unknown): Button[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node as Button, ...elements(node.props.children)];
}
function harness() {
  const auth = { isLoaded: true, isSignedIn: true, userId: "clerk", sessionId: "session-A" },
    props: Props = { projectId: "project", releaseId: "release", organizationId: "organization", active: true },
    sdkListeners = new Set<() => void>(), sdk = { loaded: true, session: { id: "session-A", user: { id: "clerk" } } as null | { id: string; user: { id: string } },
      addListener: (listener: () => void) => { sdkListeners.add(listener); return () => sdkListeners.delete(listener); } },
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }),
    download = vi.fn(), reads: { input: RunHistoryAccessInput; deferred: Deferred<ReturnType<typeof accessDto>> }[] = [],
    snapshots: { releaseId: string; deferred: Deferred<SnapshotData> }[] = [];
  let slots: Slot[] = [], cursor = 0, dirty = false, key: string | null = null, tree: React.ReactElement;
  const scheduled = new Map<number, () => void>();
  const equal = (left: unknown[], right?: unknown[]) => !!right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  function discovery() {
    client.setQueryData(getQueryKey(routes.project.byId, { id: props.projectId }, "query"), { id: props.projectId, organizationId: props.organizationId });
    client.setQueryData(getQueryKey(routes.releases.byId, { id: props.releaseId }, "query"), { id: props.releaseId, projectId: props.projectId });
  }
  discovery();
  const accessFetch = vi.fn((input: RunHistoryAccessInput, options: { retry: boolean; staleTime: number }) => {
    const request = { input, deferred: deferred<ReturnType<typeof accessDto>>() }; reads.push(request);
    return client.fetchQuery({ queryKey: getQueryKey(routes.runHistory.access, input, "query"), queryFn: () => request.deferred.promise, ...options });
  });
  const snapshotFetch = vi.fn((input: { releaseId: string }, options: { retry: boolean; staleTime: number }) => {
    const request = { ...input, deferred: deferred<SnapshotData>() }; snapshots.push(request);
    return client.fetchQuery({ queryKey: getQueryKey(routes.releases.getSnapshot, input, "query"), queryFn: () => request.deferred.promise, ...options });
  });
  const context = vm.createContext({ React, window: { Clerk: sdk }, crypto: { randomUUID: (() => { let i = 0; return () => `6ee2ec04-4d34-40bf-b0e9-${String(++i).padStart(12, "0")}`; })() },
    currentSessionScope, sameAuthScope, admitRunHistoryAccess, RunHistoryRenderGuard, sameRunHistoryOrigin, buildHtmlSnapshot, buildMarkdownSnapshot,
    downloadFile: download, getQueryKey,
    useAuth: () => auth, useQueryClient: () => client,
    trpcReact: { project: { byId: routes.project.byId }, releases: { byId: routes.releases.byId, getSnapshot: routes.releases.getSnapshot }, runHistory: { access: routes.runHistory.access },
      useUtils: () => ({ runHistory: { access: { fetch: accessFetch } }, releases: { getSnapshot: { fetch: snapshotFetch } } }) },
    useState: (initial: unknown) => { const at = cursor++; if (!slots[at]) slots[at] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[at]!.value, (next: unknown) => { const value = typeof next === "function" ? next(slots[at]!.value) : next; if (!Object.is(value, slots[at]!.value)) { slots[at]!.value = value; dirty = true; } }]; },
    useMemo: (create: () => unknown, deps: unknown[]) => { const at = cursor++; if (!slots[at] || !equal(deps, slots[at]!.deps)) slots[at] = { value: create(), deps }; return slots[at]!.value; },
    useLayoutEffect: (effect: () => (() => void) | void, deps: unknown[]) => { const at = cursor++; if (!slots[at] || !equal(deps, slots[at]!.deps)) {
      const previous = slots[at]; slots[at] = { ...previous, deps };
      scheduled.set(at, () => { previous?.cleanup?.(); const cleanup = effect(); slots[at]!.cleanup = cleanup || undefined; });
    } },
  });
  vm.runInContext(code, context);
  const wrapper = context.wrapper as (props: Props) => React.ReactElement<Props & { auth: typeof auth }>;
  function unmount() { for (const slot of slots) slot.cleanup?.(); slots = []; scheduled.clear(); key = null; }
  function render(commit = true) {
    const child = wrapper(props);
    if (key !== child.key) { unmount(); key = child.key; }
    cursor = 0; dirty = false;
    tree = (child.type as (props: typeof child.props) => React.ReactElement)(child.props);
    if (dirty) return render(commit);
    if (commit) { const effects = [...scheduled.values()]; scheduled.clear(); for (const effect of effects) effect(); }
    return renderToStaticMarkup(tree);
  }
  function abandonRender(change: () => void, restore: () => void) {
    const prior = slots.map(slot => ({ ...slot })), previousKey = key;
    change(); render(false); restore();
    slots = prior; key = previousKey; scheduled.clear();
  }
  function button(format: "html" | "markdown" = "html") {
    const node = elements(tree).find(node => node.type === "button" && renderToStaticMarkup(node).includes(format === "html" ? "HTML" : "Markdown"));
    if (!node) throw Error("Missing actual export button");
    return node.props.onClick;
  }
  function sdkChange(sessionId: string | null, actor = auth.userId) {
    sdk.session = sessionId ? { id: sessionId, user: { id: actor } } : null;
    for (const listener of sdkListeners) listener();
  }
  function cacheChange(kind: "project" | "release" | "proof" | "snapshot", state: "fetching" | "paused" | "error" | "replacement", read = 0) {
    const queryKey: QueryKey = kind === "project" ? getQueryKey(routes.project.byId, { id: props.projectId }, "query") :
      kind === "release" ? getQueryKey(routes.releases.byId, { id: props.releaseId }, "query") :
      kind === "snapshot" ? getQueryKey(routes.releases.getSnapshot, { releaseId: props.releaseId }, "query") : getQueryKey(routes.runHistory.access, reads[read]!.input, "query");
    const query = client.getQueryCache().find({ queryKey, exact: true })!;
    if (state === "replacement") query.setState({ data: { replacement: true }, dataUpdatedAt: query.state.dataUpdatedAt + 1 });
    else if (state === "error") query.setState({ status: "error", error: Error("synthetic revoked") });
    else query.setState({ fetchStatus: state });
    return queryKey;
  }
  render();
  return { auth, props, sdk, client, download, accessFetch, snapshotFetch, reads, snapshots, render, button, sdkChange, cacheChange, discovery, unmount, abandonRender };
}
async function preProof(h: ReturnType<typeof harness>, index = 0, native = "native") {
  h.reads[index]!.deferred.resolve(accessDto(h.reads[index]!.input, native)); await settle();
}
async function body(h: ReturnType<typeof harness>, index = 0, data = snapshot(h.props.releaseId, h.props.projectId)) {
  h.snapshots[index]!.deferred.resolve(data); await settle();
}
async function finish(h: ReturnType<typeof harness>, proof = 1, native = "native") { await preProof(h, proof, native); }

describe("actual release snapshot export ownership, synthetic hook/RPC boundaries only", () => {
  it.each([
    { role: "VIEWER", seatType: "READ_ONLY" },
    { role: "COMPLIANCE_AUDITOR", seatType: "FULL" },
    { role: "EDITOR", seatType: "FULL" },
  ])("existing native reader $role/$seatType authorizes export without a writer-capability substitute", async ({ role, seatType }) => {
    const h = harness();
    // Actual native ACCESS service and its actual role/seat/actor lock helper.
    // SQL calls are synthetic in-memory rows, not PostgreSQL acceptance.
    const tx = {
      project: { findUnique: async () => ({ organizationId: "organization" }) },
      $executeRaw: async () => 0,
      $queryRaw: async (query: TemplateStringsArray) => {
        const sql = query.join("?");
        if (sql.includes('FROM "User"')) return [{ clerkUserId: "clerk" }];
        if (sql.includes('FROM "Organization"')) return [{ suspendedAt: null }];
        if (sql.includes('FROM "Membership"')) return [{ role, seatType }];
        if (sql.includes('FROM "Project"')) return [{ organizationId: "organization" }];
        throw Error("Unexpected native ACCESS query");
      },
    };
    const db = { $transaction: async (action: (transaction: Prisma.TransactionClient) => Promise<unknown>) => action(tx as unknown as Prisma.TransactionClient) } as unknown as PrismaClient;
    h.accessFetch.mockImplementation((input, options) => h.client.fetchQuery({ queryKey: getQueryKey(routes.runHistory.access, input, "query"),
      queryFn: () => readRunHistoryAccess(db, "native", input, { clerkActorId: "clerk" }), ...options }));
    h.button()(); await h.accessFetch.mock.results[0]!.value; await settle(); expect(h.snapshots).toHaveLength(1); await body(h);
    await h.accessFetch.mock.results[1]!.value; await settle();
    expect(h.download).toHaveBeenCalledOnce(); expect(h.accessFetch).toHaveBeenCalledTimes(2);
    expect(h.accessFetch.mock.calls[1]![0].expectedNativeActorId).toBe("native"); h.unmount();
  });
  it.each(["html", "markdown"] as const)("fresh native pre/post proof permits one %s export and owns both exact response IDs", async format => {
    const h = harness(); h.button(format)(); h.render();
    expect(h.reads).toHaveLength(1); expect(h.snapshots).toHaveLength(0); expect(h.download).not.toHaveBeenCalled();
    await preProof(h); h.render(); expect(h.snapshots).toHaveLength(1);
    await body(h); h.render(); expect(h.reads).toHaveLength(2); expect(h.download).not.toHaveBeenCalled();
    expect(h.reads[1]!.input.expectedNativeActorId).toBe("native");
    expect(h.reads[0]!.input.requestId).not.toBe(h.reads[1]!.input.requestId);
    await finish(h); expect(h.download).toHaveBeenCalledOnce();
    expect(h.download.mock.calls[0]![0]).toBe(`synthetic-release-quality-snapshot.${format === "html" ? "html" : "md"}`);
    expect(h.download.mock.calls[0]![1]).toContain("Private synthetic wording");
    expect(typeof h.download.mock.calls[0]![3]).toBe("function");
    expect(h.render()).toContain("handed to your browser");
    for (const call of [...h.accessFetch.mock.calls, ...h.snapshotFetch.mock.calls]) expect(call[1]).toEqual({ retry: false, staleTime: 0 });
    h.unmount();
  });
  it("same-tick overlapping clicks and busy-state renders cannot create another attempt or revoke its own fresh proof", async () => {
    const h = harness(), first = h.button(), second = h.button("markdown"); first(); second(); first(); h.render();
    expect(h.reads).toHaveLength(1); await preProof(h); await body(h); await finish(h);
    expect(h.download).toHaveBeenCalledOnce(); expect(h.reads).toHaveLength(2); h.unmount();
  });
  it.each(["release", "project"] as const)("wrong response %s prevents post-proof/download and never echoes private errors", async field => {
    const h = harness(); h.button()(); await preProof(h);
    const data = snapshot(); if (field === "release") data.release.id = "foreign"; else data.release.projectId = "foreign";
    await body(h, 0, data); expect(h.reads).toHaveLength(1); expect(h.download).not.toHaveBeenCalled();
    expect(h.render()).toContain("could not be handed off"); expect(h.render()).not.toContain("Snapshot identity mismatch"); h.unmount();
  });
  it.each(["nonce", "key", "organization", "Clerk", "native"])("wrong native %s echo prevents a private snapshot", async field => {
    const h = harness(); h.button()(); const dto = accessDto(h.reads[0]!.input);
    if (field === "nonce") dto.readContext.requestId = "6ee2ec04-4d34-40bf-b0e9-000000099999";
    if (field === "key") dto.readContext.requestedKey = "wrong";
    if (field === "organization") dto.readContext.scope.organizationId = "foreign";
    if (field === "Clerk") dto.readContext.scope.actorClerkUserId = "foreign";
    if (field === "native") dto.readContext.scope.actorId = "";
    h.reads[0]!.deferred.resolve(dto); await settle(); expect(h.snapshots).toHaveLength(0); expect(h.download).not.toHaveBeenCalled(); h.unmount();
  });
  it("changed native mapping in the final proof cannot relabel a previously fetched private body", async () => {
    const h = harness(); h.button()(); await preProof(h); await body(h); await finish(h, 1, "replacement");
    expect(h.download).not.toHaveBeenCalled(); expect(h.render()).toContain("could not be handed off"); h.unmount();
  });
  it.each(["fetching", "paused", "error", "replacement"] as const)("project read %s and restoration retires the old body permanently", async state => {
    const h = harness(); h.button()(); await preProof(h); const old = h.client.getQueryData(getQueryKey(routes.project.byId, { id: "project" }, "query"));
    const queryKey = h.cacheChange("project", state); h.client.getQueryCache().find({ queryKey, exact: true })!.setState({ status: "success", fetchStatus: "idle", data: old });
    await body(h); expect(h.download).not.toHaveBeenCalled(); expect(h.reads).toHaveLength(1); expect(h.render()).not.toContain("handed to your browser"); h.unmount();
  });
  it.each(["release", "proof"] as const)("%s cache revocation suppresses completion even before React renders", async kind => {
    const h = harness(); h.button()(); await preProof(h); h.cacheChange(kind, "error"); await body(h);
    expect(h.download).not.toHaveBeenCalled(); expect(h.render()).not.toContain("could not be handed off"); h.unmount();
  });
  it.each(["fetching", "paused", "error", "replacement"] as const)("completed snapshot %s while final native proof is pending cannot export an old body", async state => {
    const h = harness(); h.button()(); await preProof(h); await body(h); h.cacheChange("snapshot", state); await finish(h);
    expect(h.download).not.toHaveBeenCalled(); expect(h.render()).not.toContain("handed to your browser"); h.unmount();
  });
  it("SDK A-B-A before hook updates never revives an old private export", async () => {
    const h = harness(); h.button()(); await preProof(h); h.sdkChange("session-B"); h.sdkChange("session-A"); await body(h);
    expect(h.download).not.toHaveBeenCalled(); expect(h.reads).toHaveLength(1); h.render(); h.button()();
    expect(h.reads).toHaveLength(2); h.unmount();
  });
  it("unmount while native proof or body is pending never publishes old completion", async () => {
    const beforeProof = harness(); beforeProof.button()(); beforeProof.unmount(); await preProof(beforeProof);
    expect(beforeProof.snapshots).toHaveLength(0); expect(beforeProof.download).not.toHaveBeenCalled();
    const afterProof = harness(); afterProof.button()(); await preProof(afterProof); afterProof.unmount(); await body(afterProof);
    expect(afterProof.download).not.toHaveBeenCalled(); expect(afterProof.reads).toHaveLength(1);
  });
  it("abandoned inactive render rollback preserves class revocation and cannot restore pending capability", async () => {
    const h = harness(); h.button()(); await preProof(h);
    h.abandonRender(() => { h.props.active = false; }, () => { h.props.active = true; }); h.render(); await body(h);
    expect(h.download).not.toHaveBeenCalled(); expect(h.render()).not.toContain("handed to your browser"); h.unmount();
  });
  it("new route/account may explicitly export after A while retired A never revives through A-B-A", async () => {
    const h = harness(); h.button()(); await preProof(h);
    h.props.projectId = "project-B"; h.props.releaseId = "release-B"; h.props.organizationId = "organization-B";
    h.auth.userId = "clerk-B"; h.auth.sessionId = "session-B"; h.sdkChange("session-B", "clerk-B"); h.discovery(); h.render(); h.button()();
    await preProof(h, 1, "native-B"); await body(h, 1); await finish(h, 2, "native-B");
    expect(h.download).toHaveBeenCalledOnce(); expect(h.reads[2]!.input.expectedNativeActorId).toBe("native-B");
    h.props.projectId = "project"; h.props.releaseId = "release"; h.props.organizationId = "organization";
    h.auth.userId = "clerk"; h.auth.sessionId = "session-A"; h.sdkChange("session-A", "clerk"); h.discovery(); h.render();
    await body(h, 0, snapshot()); expect(h.download).toHaveBeenCalledOnce(); expect(h.render()).not.toContain("handed to your browser"); h.unmount();
  });
  it("stale failed attempt cannot clear a newer explicit attempt's busy state", async () => {
    const h = harness(); h.button()(); h.sdkChange("session-B"); h.sdkChange("session-A"); h.render(); h.button()();
    h.reads[0]!.deferred.reject(Error("private synthetic failure")); await settle();
    expect(h.render()).toContain("Exporting…"); expect(h.render()).not.toContain("private synthetic failure");
    await preProof(h, 1); await body(h); await finish(h, 2); expect(h.download).toHaveBeenCalledOnce(); h.unmount();
  });
  it.each(["Blob", "URL", "anchor"])("actual browser %s boundary loss suppresses click and releases any object URL", async boundary => {
    const h = harness(), click = vi.fn(), revoke = vi.fn();
    const anchor = { set href(_value: string) { if (boundary === "anchor") h.sdkChange("session-B"); }, download: "", click };
    vi.stubGlobal("Blob", class { constructor() { if (boundary === "Blob") h.sdkChange("session-B"); } });
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => { if (boundary === "URL") h.sdkChange("session-B"); return "blob:synthetic"; }), revokeObjectURL: revoke });
    vi.stubGlobal("document", { createElement: () => anchor });
    h.download.mockImplementation(actualDownloadFile);
    try { h.button()(); await preProof(h); await body(h); await finish(h); expect(click).not.toHaveBeenCalled();
      expect(h.render()).not.toContain("handed to your browser");
      if (boundary === "Blob") expect(revoke).not.toHaveBeenCalled(); else expect(revoke).toHaveBeenCalledWith("blob:synthetic");
    } finally { h.unmount(); vi.unstubAllGlobals(); }
  });
  it("actual guarded download clicks once under a current completed proof and always releases the object URL", async () => {
    const h = harness(), click = vi.fn(), revoke = vi.fn(), anchor = { href: "", download: "", click };
    vi.stubGlobal("URL", { createObjectURL: () => "blob:synthetic", revokeObjectURL: revoke });
    vi.stubGlobal("document", { createElement: () => anchor });
    h.download.mockImplementation(actualDownloadFile);
    try {
      const oldClick = h.button(); oldClick(); oldClick();
      await preProof(h); await body(h); await finish(h);
      expect(click).toHaveBeenCalledOnce(); expect(h.download).toHaveBeenCalledOnce();
      expect(revoke).toHaveBeenCalledWith("blob:synthetic");
      expect(anchor.download).toBe("synthetic-release-quality-snapshot.html");
      expect(h.render()).toContain("handed to your browser");
    } finally { h.unmount(); vi.unstubAllGlobals(); }
  });
  it("server denial is not replaced by generic cached project membership or writer admission", async () => {
    const h = harness(); h.button()(); h.reads[0]!.deferred.reject(Error("FORBIDDEN")); await settle();
    expect(h.snapshots).toHaveLength(0); expect(h.download).not.toHaveBeenCalled();
    expect(source).not.toMatch(/organization\.mine|canEdit|canWrite|useReadOnlySeat|runHistory\.page|useManualExecutionAccess/); h.unmount();
  });
  it("parent extraction replaces only exporter and supplies scope discovery without changing existing governed drafts", () => {
    const parent = readFileSync(new URL("../app/projects/[projectId]/releases/[releaseId]/page.tsx", import.meta.url), "utf8");
    expect(parent).toContain("<ReleaseSnapshotExport"); expect(parent).toContain("organizationId={projectQuery.data?.organizationId}");
    expect(parent).not.toContain("async function exportSnapshot"); expect(parent).not.toContain("downloadFile(");
    for (const editor of ["CriterionDescriptionEditor", "CriterionVerdictEditor", "GovernedCriterionCollection", "AttachUnassignedPlan"]) expect(parent).toContain(`<${editor}`);
  });
});
