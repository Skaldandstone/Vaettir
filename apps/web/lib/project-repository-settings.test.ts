// Actual complete JSX/controllers with synthetic hooks/RPC/child boundaries.
// Does not authorize a provider, read source, spend credits or prove deployment.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { repositoryDisplayName } from "./repository-display";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { retainAnalysisRequest } from "./analysis-request-recovery";

type Element = React.ReactElement<Record<string, unknown>>;
function elements(value: unknown, list: Element[] = []): Element[] { if (React.isValidElement(value)) { const element = value as Element; list.push(element); elements(element.props.children, list); } else if (Array.isArray(value)) value.forEach(child => elements(child, list)); return list; }
function text(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : React.isValidElement(value) ? text((value as Element).props.children) : Array.isArray(value) ? value.map(text).join("") : ""; }
function controller(path: string, modules: Record<string, unknown>, extra = "", browser: unknown = undefined) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8"), output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", "React", "window", output + extra)((name: string) => { if (!(name in modules)) throw Error("Unreviewed fixture dependency: " + name); return modules[name]; }, exports, React, browser);
  return exports;
}
function states() { const slots: unknown[] = []; let cursor = 0; return { reset: () => { cursor = 0; }, hooks: { ...React, useState: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? (next as (prior: unknown) => unknown)(slots[index]) : next; }]; } } }; }
const rows = Array.from({ length: 14 }, (_, i) => ({ id: "repo-" + i, projectId: "owned", provider: "gitlab", url: "https://gitlab.synthetic.example/group/subgroup/service-" + i + ".git", accessVerified: i === 0, revision: null }));

// Hook scheduling model executes the whole real controller and its callbacks.
// Native transport and SDK are synthetic boundaries; this is not ReactDOM or
// provider/renewal acceptance. Effects retire original frames on every change.
function frames() {
  const slots: unknown[] = []; let cursor = 0; const effects: Array<() => void> = [];
  function same(a: unknown[], b: unknown[]) { return a.length === b.length && a.every((value, i) => Object.is(value, b[i])); }
  return { reset: () => { cursor = 0; }, commit: () => { for (const effect of effects.splice(0)) effect(); }, hooks: { ...React,
    useState: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial; return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? (next as (prior: unknown) => unknown)(slots[index]) : next; }]; },
    useRef: (initial: unknown) => { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useMemo: (factory: () => unknown, deps: unknown[]) => { const index = cursor++, old = slots[index] as { deps: unknown[]; value: unknown } | undefined; if (!old || !same(old.deps, deps)) slots[index] = { deps, value: factory() }; return (slots[index] as { value: unknown }).value; },
    useLayoutEffect: (effect: () => undefined | (() => void), deps: unknown[]) => { const index = cursor++, old = slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined; if (!old || !same(old.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; }); },
  } };
}
type SavedInput = { projectId: string; repositoryId: string; originalOrganizationId: string; expectedNativeActorId: string; expectedClerkActorId: string; expectedConnectionId: string };
function savedFixture() {
  const s = frames(), auth = { isLoaded: true, isSignedIn: true, userId: "clerk-owner", sessionId: "session-owner" };
  const browser = { Clerk: { loaded: true, session: { id: "session-owner", user: { id: "clerk-owner" } } } };
  const access = { readable: true, canEdit: true, origin: { projectId: "owned", organizationId: "org", clerkActorId: "clerk-owner", caseId: null }, fresh: { readScope: { actorId: "native-owner" } }, owns: vi.fn(() => true) };
  const repositories = [{ ...rows[0]!, connectionId: "connection-owner" }];
  const refresh = vi.fn(async () => undefined);
  let outcome: (input: SavedInput) => Promise<unknown> = async input => ({ projectId: input.projectId, repositoryId: input.repositoryId, connectionId: input.expectedConnectionId, originalOrganizationId: input.originalOrganizationId, expectedNativeActorId: input.expectedNativeActorId, expectedClerkActorId: input.expectedClerkActorId, status: "VERIFIED", accessMethod: "oauth", reused: true, renewed: false });
  const mutate = vi.fn((input: SavedInput) => outcome(input));
  const noop = () => null;
  const exports = controller("../components/ProjectRepositories.tsx", {
    react: s.hooks, "@clerk/nextjs": { useAuth: () => auth }, "@/lib/repository-display": { repositoryDisplayName }, "@tanstack/react-query": { useIsMutating: () => 0 }, "@/lib/connection-mutation": { isConnectionMutation: () => false },
    "@/lib/trpcReact": { trpcReact: { repositoryIntelligence: { savedAccess: { useMutation: () => ({ mutateAsync: mutate }) } } } },
    "@/lib/use-case-field-access": { useCaseFieldAccess: () => access }, "@/lib/auth-query-cache": { currentSessionScope, sameAuthScope }, "@/lib/analysis-request-recovery": { retainAnalysisRequest },
    "./SourceConnectionChips": { ProviderMark: noop }, "./Modal": { Modal: noop }, "./RepositoryConnectionContent": { RepositoryConnectionContent: noop, repositoryProviders: [["gitlab", "GitLab"]] }, "./RepositoryProviderPicker": { RepositoryProviderPicker: noop, cancelRepositoryAuthorization: noop },
  }, "\nexports.check=SavedRepositoryAccessCheck;", browser);
  const actual = exports.check as (props: { projectId: string; repositories: typeof repositories | null; canEdit: boolean; onChecked: typeof refresh }) => React.ReactNode;
  const props = { projectId: "owned", repositories: repositories as typeof repositories | null, canEdit: true, onChecked: refresh };
  function render() { s.reset(); actual(props); s.commit(); s.reset(); const tree = actual(props); s.commit(); return tree; }
  function button(label: string) { return elements(render()).find(node => node.type === "button" && text(node.props.children) === label)!; }
  function select() { const node = elements(render()).find(node => node.type === "select")!; (node.props.onChange as (event: unknown) => void)({ target: { value: "repo-0" } }); return render(); }
  return { render, button, select, auth, browser, access, repositories, props, mutate, refresh, setOutcome: (next: typeof outcome) => { outcome = next; } };
}

it("one deliberate saved check sends exact fresh native/Clerk/org/project/grant pins; duplicates and stale completed handlers never rotate again", async () => {
  const f = savedFixture(); f.select(); let resolve!: (result: unknown) => void;
  f.setOutcome(input => new Promise(done => { resolve = () => done({ projectId: input.projectId, repositoryId: input.repositoryId, connectionId: input.expectedConnectionId, originalOrganizationId: input.originalOrganizationId, expectedNativeActorId: input.expectedNativeActorId, expectedClerkActorId: input.expectedClerkActorId, status: "VERIFIED", accessMethod: "token", reused: true, renewed: true }); }));
  const click = f.button("Check connection").props.onClick as () => Promise<void>;
  const pending = click(); await click(); expect(f.mutate).toHaveBeenCalledOnce();
  expect(f.mutate.mock.calls[0]![0]).toEqual({ projectId: "owned", repositoryId: "repo-0", originalOrganizationId: "org", expectedNativeActorId: "native-owner", expectedClerkActorId: "clerk-owner", expectedConnectionId: "connection-owner" });
  expect(Object.isFrozen(f.mutate.mock.calls[0]![0])).toBe(true); expect(text(f.render())).toContain("Checking connection");
  resolve(null); await pending; expect(f.refresh).toHaveBeenCalledOnce(); expect(text(f.render())).toContain("Saved account connection verified for this repository reference");
  await click(); expect(f.mutate).toHaveBeenCalledOnce(); expect(text(f.render())).not.toContain("https://");
});
it.each(["projectId", "repositoryId", "connectionId", "originalOrganizationId", "expectedNativeActorId", "expectedClerkActorId", "status", "accessMethod", "reused", "renewed", "extra"])("forged %s acknowledgement latches original UNKNOWN and never refreshes or automatically retries", async field => {
  const f = savedFixture(); f.select(); f.setOutcome(async input => { const ack: Record<string, unknown> = { projectId: input.projectId, repositoryId: input.repositoryId, connectionId: input.expectedConnectionId, originalOrganizationId: input.originalOrganizationId, expectedNativeActorId: input.expectedNativeActorId, expectedClerkActorId: input.expectedClerkActorId, status: "VERIFIED", accessMethod: "oauth", reused: true, renewed: false }; ack[field] = "foreign"; return ack; });
  const click = f.button("Check connection").props.onClick as () => Promise<void>; await click(); await click();
  expect(f.mutate).toHaveBeenCalledOnce(); expect(f.refresh).not.toHaveBeenCalled(); expect(text(f.render())).toContain("not acknowledged");
  expect(f.button("Check connection").props.disabled).toBe(true);
  await (f.button("Refresh saved status").props.onClick as () => Promise<void>)(); expect(f.refresh).toHaveBeenCalledOnce(); expect(f.mutate).toHaveBeenCalledOnce(); expect(text(f.render())).toContain("not acknowledged");
});
it.each(["actor", "session", "native-remap", "organization", "project", "connection", "readonly", "refresh"])("captured check refuses %s scope changes before sending, and restores original scope without rebinding", async fault => {
  const f = savedFixture(); f.select(); const click = f.button("Check connection").props.onClick as () => Promise<void>;
  if (fault === "actor") f.auth.userId = "foreign"; if (fault === "session") f.browser.Clerk.session.id = "foreign"; if (fault === "native-remap") f.access.fresh.readScope.actorId = "foreign"; if (fault === "organization") f.access.origin.organizationId = "foreign"; if (fault === "project") f.props.projectId = "foreign"; if (fault === "connection") f.repositories[0]!.connectionId = "foreign"; if (fault === "readonly") f.access.canEdit = false; if (fault === "refresh") { f.access.readable = false; f.props.repositories = null; }
  f.render(); await click(); expect(f.mutate).not.toHaveBeenCalled();
  f.auth.userId = "clerk-owner"; f.browser.Clerk.session.id = "session-owner"; f.access.fresh.readScope.actorId = "native-owner"; f.access.origin.organizationId = "org"; f.props.projectId = "owned"; f.repositories[0]!.connectionId = "connection-owner"; f.access.canEdit = true; f.access.readable = true; f.props.repositories = f.repositories;
  f.render(); await click(); expect(f.mutate).not.toHaveBeenCalled();
  await (f.button("Check connection").props.onClick as () => Promise<void>)(); expect(f.mutate).toHaveBeenCalledOnce();
});
it("an exact ACK after actor/eligibility loss and restoration remains retained UNKNOWN and cannot invalidate any queries", async () => {
  const f = savedFixture(); f.select(); let resolve!: () => void;
  f.setOutcome(input => new Promise(done => { resolve = () => done({ projectId: input.projectId, repositoryId: input.repositoryId, connectionId: input.expectedConnectionId, originalOrganizationId: input.originalOrganizationId, expectedNativeActorId: input.expectedNativeActorId, expectedClerkActorId: input.expectedClerkActorId, status: "VERIFIED", accessMethod: "oauth", reused: true, renewed: false }); }));
  const click = f.button("Check connection").props.onClick as () => Promise<void>, pending = click();
  f.access.canEdit = false; f.render(); f.access.canEdit = true; f.render(); resolve(); await pending;
  expect(f.refresh).not.toHaveBeenCalled(); expect(text(f.render())).toContain("not acknowledged"); expect(f.button("Check connection").props.disabled).toBe(true); await click(); expect(f.mutate).toHaveBeenCalledOnce();
});
it("an in-flight UNKNOWN keeps original pins through actor/session loss and only reveals its unchanged outcome after original restoration", async () => {
  const f = savedFixture(); f.select(); let refuse!: () => void; f.setOutcome(() => new Promise((_resolve, reject) => { refuse = () => reject(Error("private provider failure")); }));
  const click = f.button("Check connection").props.onClick as () => Promise<void>, pending = click();
  f.auth.userId = "foreign"; f.browser.Clerk.session.user.id = "foreign"; f.render(); refuse(); await pending;
  expect(f.refresh).not.toHaveBeenCalled(); expect(text(f.render())).toContain("Restore the original account"); expect(text(f.render())).not.toContain("group/subgroup/service"); expect(text(f.render())).not.toContain("private provider failure");
  f.auth.userId = "clerk-owner"; f.browser.Clerk.session.user.id = "clerk-owner"; f.render(); await click(); expect(f.mutate).toHaveBeenCalledOnce(); expect(f.button("Check connection").props.disabled).toBe(true);
});
it("first definite refusal permits a deliberate fresh check; cache refresh failure after exact ACK stays verified, never 'not submitted'", async () => {
  const f = savedFixture(); f.select(); f.setOutcome(async () => { throw { data: { code: "PRECONDITION_FAILED" } }; });
  const old = f.button("Check connection").props.onClick as () => Promise<void>; await old(); await old(); expect(f.mutate).toHaveBeenCalledOnce(); expect(text(f.render())).toContain("could not be verified"); expect(f.button("Check connection").props.disabled).toBe(false);
  f.setOutcome(async input => ({ projectId: input.projectId, repositoryId: input.repositoryId, connectionId: input.expectedConnectionId, originalOrganizationId: input.originalOrganizationId, expectedNativeActorId: input.expectedNativeActorId, expectedClerkActorId: input.expectedClerkActorId, status: "VERIFIED", accessMethod: "oauth", reused: true, renewed: false }));
  f.refresh.mockRejectedValueOnce(Error("private refresh failure")); await (f.button("Check connection").props.onClick as () => Promise<void>)();
  expect(f.mutate).toHaveBeenCalledTimes(2); expect(text(f.render())).toContain("was verified, but its displayed status could not be refreshed"); expect(text(f.render())).not.toContain("private refresh failure");
});
it("repository display names are presentation-only and exclude credentials/query/fragment/scheme while retaining namespaces", () => {
  expect(repositoryDisplayName("https://user:password@gitlab.example/group/sub/repo.git?token=secret#private")).toBe("group/sub/repo");
  expect(repositoryDisplayName("git@host.example:group/sub/repo.git")).toBe("group/sub/repo");
  expect(repositoryDisplayName("<literal invalid URL>")).toBe("Repository reference");
  const saved = rows[0]!.url; expect(repositoryDisplayName(saved)).toBe("group/subgroup/service-0"); expect(rows[0]!.url).toBe(saved);
});
it("overview summary counts actual shared membership but never shows URL chips, provider chooser or false verified health", () => {
  const reads: unknown[] = [], refetch = vi.fn(), query = { data: rows, isSuccess: true, isFetching: false, isPaused: false, error: null as unknown, refetch };
  const access = { readable: true, origin: { actorId: "actor", organizationId: "org", projectId: "owned" }, owns: vi.fn(() => true) };
  const exports = controller("../components/ProjectRepositorySummary.tsx", { "@/lib/use-case-field-access": { useCaseFieldAccess: () => access }, "@/lib/trpcReact": { trpcReact: { project: { repositories: { useQuery: (input: unknown) => { reads.push(input); return query; } } } } } });
  const render = exports.ProjectRepositorySummary as (props: { projectId: string }) => React.ReactNode;
  const tree = render({ projectId: "owned" }); expect(text(tree)).toContain("14 registered repositories");
  expect(renderToStaticMarkup(tree)).toContain("/projects/owned/settings/integrations"); expect(text(tree)).not.toContain("https://"); expect(text(tree)).not.toContain("Access verified"); expect(elements(tree).some(node => node.type === "select")).toBe(false);
  for (const fault of ["error", "fetching", "paused"]) { query.error = fault === "error" ? Error("private failure") : null; query.isFetching = fault === "fetching"; query.isPaused = fault === "paused"; const withheld = render({ projectId: "owned" }); expect(text(withheld)).not.toContain("14 registered"); expect(text(withheld)).not.toContain("0 registered"); }
  query.error = Error("private failure"); query.isFetching = false; query.isPaused = false;
  const retry = elements(render({ projectId: "owned" })).find(node => node.type === "button")!; (retry.props.onClick as () => void)(); expect(refetch).toHaveBeenCalledOnce(); expect(reads.every(input => JSON.stringify(input) === JSON.stringify({ projectId: "owned" }))).toBe(true);
  access.readable = false; access.owns.mockReturnValue(false);
  expect(text(render({ projectId: "owned" }))).not.toContain("14 registered");
  (retry.props.onClick as () => void)(); expect(refetch).toHaveBeenCalledOnce();
});
it("project Settings retains one keyed manager through permission refresh, withholds controls and never grants read-only editing", () => {
  const query = { data: { id: "owned", organizationId: "org", repoUrl: null as string | null, defaultBranch: "main" }, isSuccess: true, isFetching: false, isPaused: false, error: null as unknown, refetch: vi.fn() };
  const access = { readable: true, canEdit: true, canConfigure: true, authReady: true, origin: { actorId: "actor", clerkActorId: "clerk-owner", organizationId: "org", projectId: "owned" }, query: { error: null as unknown, isFetching: false, refetch: vi.fn() } }, Manager = () => null, Sharing = () => null;
  const exports = controller("../app/projects/[projectId]/settings/integrations/page.tsx", { "next/navigation": { useParams: () => ({ projectId: "owned" }) }, "@/lib/trpcReact": { trpcReact: { project: { byId: { useQuery: () => query } } } }, "@/lib/use-case-field-access": { useCaseFieldAccess: () => access }, "@/components/ProjectRepositories": { ProjectRepositories: Manager }, "@/components/AtlassianQualitySettings": { AtlassianQualitySettings: Sharing }, "@/components/AiDisclosureSettings": { AiDisclosureSettings: () => null }, "@/lib/repository-display": { repositoryDisplayName } });
  const render = exports.default as () => React.ReactNode;
  const original = elements(render()).find(node => node.type === Manager)!; expect(original.key).toBe("owned"); expect(original.props.projectId).toBe("owned"); expect(original.props.canEdit).toBe(true);
  expect(elements(render()).find(node => node.type === Sharing)!.props).toMatchObject({ projectId: "owned", organizationId: "org", canConfigure: true });
  expect(elements(render()).find(node => node.type === Sharing)!.key).toBe("owned:clerk-owner");
  query.isFetching = true; const refreshing = render(), retained = elements(refreshing).find(node => node.type === Manager)!;
  expect(retained.type).toBe(original.type); expect(retained.key).toBe(original.key); expect(retained.props.canEdit).toBe(false);
  expect(elements(refreshing).find(node => node.type === Sharing)!.props.canConfigure).toBe(false);
  expect(elements(refreshing).find(node => node.type === "fieldset")!.props).toMatchObject({ hidden: true, disabled: true });
  query.isFetching = false; access.canEdit = false; expect(elements(render()).find(node => node.type === Manager)!.props.canEdit).toBe(false);
  query.data.repoUrl = "https://secret:token@host.example/private/repo.git?credential=hidden";
  for (const fault of ["actor/session", "org", "error", "paused", "fresh-project"]) {
    access.readable = fault !== "actor/session"; query.data.organizationId = fault === "org" ? "foreign" : "org"; query.error = fault === "error" ? Error("private failure") : null; query.isPaused = fault === "paused"; query.data.id = fault === "fresh-project" ? "other" : "owned";
    const withheld = render(); expect(elements(withheld).find(node => node.type === "fieldset")!.props).toMatchObject({ hidden: true, disabled: true });
    expect(elements(withheld).find(node => node.type === Manager)!.key).toBe(original.key);
    expect(text(withheld)).not.toContain("private/repo"); expect(text(withheld)).not.toContain("private failure");
  }
  query.data.id = "owned"; query.data.organizationId = "org"; query.error = null; query.isPaused = false; access.readable = true; access.canEdit = true;
  const restored = render(); expect(elements(restored).find(node => node.type === "fieldset")!.props.hidden).toBe(false); expect(text(restored)).toContain("private/repo"); expect(text(restored)).not.toContain("secret:token");
});
it("one release workspace swaps batch for detail and returns to the original batch offset, without any parallel selector", () => {
  const s = states();
  const exports = controller("../components/RepositoryReleaseDiscovery.tsx", { react: s.hooks, "@/lib/trpcReact": { trpcReact: {} }, "@/lib/use-case-field-access": { useCaseFieldAccess: () => ({}) }, "@/lib/repository-display": { repositoryDisplayName } }, "\nexports.parts={RepositoryReleaseWorkspace,ProjectReleaseBatch,ReleaseList};");
  const parts = exports.parts as { RepositoryReleaseWorkspace: (props: { projectId: string }) => React.ReactNode; ProjectReleaseBatch: React.ComponentType; ReleaseList: React.ComponentType };
  function render() { s.reset(); return parts.RepositoryReleaseWorkspace({ projectId: "owned" }); }
  let tree = render(), batch = elements(tree).find(node => node.type === parts.ProjectReleaseBatch)!;
  expect(elements(tree).filter(node => node.type === parts.ReleaseList)).toHaveLength(0);
  (batch.props.onOffsetChange as (offset: number) => void)(5); tree = render(); batch = elements(tree).find(node => node.type === parts.ProjectReleaseBatch)!;
  (batch.props.onBrowse as (id: string, label: string) => void)("repo-7", "group/service-7"); tree = render();
  expect(elements(tree).filter(node => node.type === parts.ProjectReleaseBatch)).toHaveLength(0);
  expect(elements(tree).filter(node => node.type === parts.ReleaseList)).toHaveLength(1);
  expect(elements(tree).find(node => node.type === parts.ReleaseList)!.props).toMatchObject({ projectId: "owned", repositoryId: "repo-7", label: "group/service-7" });
  const back = elements(tree).find(node => node.type === "button")!; (back.props.onClick as () => void)(); tree = render();
  expect(elements(tree).find(node => node.type === parts.ProjectReleaseBatch)!.props.offset).toBe(5);
  expect(elements(tree).some(node => node.type === "select")).toBe(false);
});
it("repository release metadata requires the same fresh original editor guards and never represents failures as empty success", () => {
  const s = states(), browse = vi.fn(), origin = { projectId: "owned" }, access = { readable: true, canEdit: true, origin, owns: vi.fn(() => true) };
  const query = { isSuccess: true, isFetching: false, isPaused: false, error: null as unknown, refetch: vi.fn(), data: { projectId: "owned", offset: 0, nextOffset: 5, repositories: [{ repositoryId: "repo-0", url: rows[0]!.url, status: "CHECKED", releases: [], hasMore: true }] } };
  const exports = controller("../components/RepositoryReleaseDiscovery.tsx", { react: s.hooks, "@/lib/trpcReact": { trpcReact: { repositoryIntelligence: { projectReleases: { useQuery: () => query } } } }, "@/lib/use-case-field-access": { useCaseFieldAccess: () => access }, "@/lib/repository-display": { repositoryDisplayName } }, "\nexports.batch=ProjectReleaseBatch;");
  const batch = exports.batch as (props: { projectId: string; offset: number; onBrowse: typeof browse; onOffsetChange: () => void }) => React.ReactNode;
  const render = () => batch({ projectId: "owned", offset: 0, onBrowse: browse, onOffsetChange: vi.fn() });
  let tree = render(); const open = elements(tree).find(node => node.type === "button" && text(node.props.children) === "Browse releases")!;
  (open.props.onClick as () => void)(); expect(browse).toHaveBeenCalledWith("repo-0", "group/subgroup/service-0");
  access.owns.mockReturnValue(false); (open.props.onClick as () => void)(); expect(browse).toHaveBeenCalledTimes(1);
  for (const fault of ["error", "fetching", "paused", "readonly", "foreign-project"]) { query.error = fault === "error" ? Error("private") : null; query.isFetching = fault === "fetching"; query.isPaused = fault === "paused"; access.canEdit = fault !== "readonly"; query.data.projectId = fault === "foreign-project" ? "other" : "owned"; tree = render(); expect(text(tree)).not.toContain("group/subgroup/service-0"); expect(text(tree)).not.toContain("No provider releases returned"); }
});
it("overview and management links are project-scoped, while organization administration and saved repository transports remain unchanged", () => {
  const overview = readFileSync(new URL("../app/projects/[projectId]/page.tsx", import.meta.url), "utf8"), picker = readFileSync(new URL("../components/ConnectedRepositoryPicker.tsx", import.meta.url), "utf8"), manager = readFileSync(new URL("../components/ProjectRepositories.tsx", import.meta.url), "utf8");
  expect(overview).toContain("<ProjectRepositorySummary"); expect(overview).not.toContain("<ProjectRepositories"); expect(overview).not.toMatch(/Legacy repository reference:|Scan \{project.repoUrl\}|<ConnectionLink/);
  expect(picker).toContain("/settings/integrations"); expect(picker).toContain("onSelect(query.data.find(repo => repo.id === event.target.value) ?? null)");
  expect(manager).toContain('repositoryDisplayName(repo.url)'); expect(manager).toContain('repo.accessVerified?"Registered · Access verified":"Registered · Access unverified"');
  expect(manager).toContain("initialAuthorization={authorizations[id]}"); expect(manager).toContain("active={provider===id&&canEdit&&ready}"); expect(manager).toContain("cancelRepositoryAuthorization(intent)");
  const index = readFileSync(new URL("../app/projects/[projectId]/settings/page.tsx", import.meta.url), "utf8"); expect(index).toContain("encodeURIComponent(projectId)"); expect(index).toContain("/settings/integrations");
});
