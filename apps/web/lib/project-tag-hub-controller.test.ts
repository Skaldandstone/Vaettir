import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import * as helpers from "./project-tag-navigation";

const source = readFileSync(new URL("../components/ProjectTagHub.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("hub.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ProjectTagHubView")!;
const printed = ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration, ast);
const origin = { projectId: "project", organizationId: "org", clerkActorId: "actor", caseId: null };

function harness(tag: string | null = " spaced ", bootstrapReady = true) {
  const hooks: unknown[] = [], effects: Array<() => void> = [], pushes: string[] = [];
  let cursor = 0, dirty = false, lastInput: Record<string, unknown> = {}, enabled = false, uuid = 0;
  const auth = { isLoaded: true, isSignedIn: true, userId: "actor", sessionId: "A" };
  const retries: Array<typeof origin | null> = [];
  const access = { origin: bootstrapReady ? origin : null, readable: bootstrapReady, fresh: { readScope: { actorId: "native" } }, query: {
    error: null as Error | null, isFetching: false,
    refetch: async () => { retries.push(access.origin ? { ...access.origin } : null); },
  } };
  const query = { data: undefined as unknown, isFetchedAfterMount: false, isFetching: false, isPaused: false, error: null as Error | null };
  const globals = { React, ...helpers, crypto: { randomUUID: () => `read-${++uuid}` },
    sections: { CASES: "Directly tagged cases", PLANS: "Linked plans", RELEASES: "Linked releases", REQUIREMENTS: "Linked requirements" },
    edges: { DIRECT_CASE_TAG: "Exact current case tag", DIRECT_CASE_PLAN: "Through the case’s assigned plan", DIRECT_CASE_PLAN_RELEASE: "Through the case’s assigned plan and release", ACTIVE_CASE_REQUIREMENT_REFERENCE: "Active saved case-to-requirement reference" },
    useAuth: () => auth, useRouter: () => ({ push: (href: string) => pushes.push(href) }), useCaseFieldAccess: () => access,
    trpcReact: { projectTags: { page: { useQuery: (input: Record<string, unknown>, options: { enabled: boolean }) => { lastInput = input; enabled = options.enabled; return query; } } } },
    useState: (initial: unknown) => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], (value: unknown) => { const next = typeof value === "function" ? value(hooks[index]) : value; if (!Object.is(next, hooks[index])) { hooks[index] = next; dirty = true; } }]; },
    useRef: (initial: unknown) => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = { current: initial }; return hooks[index]; },
    useEffect: (effect: () => void, deps: unknown[]) => { const index = cursor++, prior = hooks[index] as unknown[] | undefined; if (!prior || deps.some((value, n) => !Object.is(value, prior[n]))) { hooks[index] = deps; effects.push(effect); } },
  };
  const compiled = ts.transpileModule(`${printed}\nthis.hub = ProjectTagHubView;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const context = vm.createContext(globals); vm.runInContext(compiled, context);
  const component = (context as unknown as { hub: (props: { projectId: string; tag: string | null }) => React.ReactNode }).hub;
  let tree: React.ReactNode;
  function render() { for (let count = 0; count < 30; count++) { cursor = 0; dirty = false; tree = component({ projectId: "project", tag }); effects.splice(0).forEach(effect => effect()); if (!dirty) return tree; } throw Error("Controller did not settle"); }
  function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] { return !React.isValidElement<Record<string, unknown>>(node) ? [] : [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)]; }
  function html() { return renderToStaticMarkup(render()); }
  function button(text: string) { return elements(render()).find(node => node.type === "button" && React.Children.toArray(node.props.children as React.ReactNode).join("") === text); }
  function click(text: string) { const found = button(text); expect(found).toBeTruthy(); (found!.props.onClick as () => void)(); render(); }
  function receive(patch = {}) { query.isFetchedAfterMount = true; query.error = null; query.data = { projectId: "project", organizationId: "org", clerkActorId: "actor", requestId: lastInput.requestId, tag: lastInput.tag, section: lastInput.section, archive: lastInput.archive, review: lastInput.review, scopeHash: "a".repeat(64), readScope: { projectId: "project", organizationId: "org", actorId: "native", actorClerkUserId: "actor" }, asOf: "2026-10-06T03:00:00.000Z", total: 1, matchingCases: 1, items: [{ id: "case", title: "Secret tagged title", displayId: "CASE-1", matchingCaseCount: 1, edge: "DIRECT_CASE_TAG", reviewStatus: "APPROVED", archived: false }], nextCursor: null, limitations: ["Current saved association, not frozen historical tags."], ...patch }; render(); }
  render(); return { auth, access, query, receive, html, click, button, retries, input: () => lastInput, enabled: () => enabled, pushes };
}

it("shows no cached body until a completed exact current read; approved/active is default and tags stay raw", () => {
  const host = harness(); expect(host.enabled()).toBe(true); expect(host.input()).toMatchObject({ tag: " spaced ", archive: "ACTIVE", review: "APPROVED" });
  expect(host.html()).not.toContain("Secret tagged title"); host.receive(); expect(host.html()).toContain("Secret tagged title");
  expect(host.html()).toContain("not a frozen all-sections snapshot"); expect(host.html()).toContain("current tags do not describe historical run evidence");
  host.click("Linked plans"); expect(host.html()).not.toContain("Secret tagged title"); expect(host.input().section).toBe("PLANS");
});

it("A-B-A session transitions and refreshed pages require distinct echoed requests", () => {
  const host = harness(); host.receive(); const original = host.input().requestId;
  host.auth.sessionId = "B"; expect(host.html()).not.toContain("Secret tagged title"); const second = host.input().requestId; expect(second).not.toBe(original);
  host.auth.sessionId = "A"; expect(host.html()).not.toContain("Secret tagged title"); expect(host.input().requestId).not.toBe(original); expect(host.input().requestId).not.toBe(second);
  host.receive(); expect(host.html()).toContain("Secret tagged title"); host.click("Refresh current scope"); expect(host.html()).not.toContain("Secret tagged title");
});

it("actor loss/native remapping and read failures hide private results without fabricating zero counts", () => {
  const host = harness(); host.receive(); host.auth.userId = "other"; expect(host.html()).not.toContain("Secret tagged title"); expect(host.enabled()).toBe(false);
  host.auth.userId = "actor"; host.receive(); host.access.fresh.readScope.actorId = "replacement"; expect(host.html()).not.toContain("Secret tagged title"); expect(host.enabled()).toBe(false);
  host.access.fresh.readScope.actorId = "native"; host.query.error = Error("native scope unavailable"); expect(host.html()).toContain("No counts are being shown as zero"); expect(host.html()).not.toContain("Secret tagged title");
});

it("absent selection makes no tag request but the exact empty tag remains a real selection", () => {
  const missing = harness(null); expect(missing.enabled()).toBe(false); expect(missing.html()).toContain("No repository-wide request has been made");
  const empty = harness(""); expect(empty.enabled()).toBe(true); expect(empty.input().tag).toBe(""); empty.receive(); expect(empty.html()).toContain("Empty retained tag");
});

it("Next and Previous bind exact cursor pages and hide old page bodies while replacement reads complete", () => {
  const host = harness(), next = { scopeHash: "a".repeat(64), populationHash: "b".repeat(32), afterId: "case" };
  host.receive({ total: 51, matchingCases: 51, nextCursor: next }); host.click("Next page");
  expect(host.input().cursor).toEqual(next); expect(host.html()).not.toContain("Secret tagged title");
  host.receive({ total: 51, matchingCases: 51 }); expect(host.html()).toContain("Page 2");
  host.click("Previous page"); expect(host.input().cursor).toBeUndefined(); expect(host.html()).not.toContain("Secret tagged title");
  host.receive(); expect(host.html()).toContain("Page 1");
});

it("fetching and paused reads hide body; resume needs a new request rather than cached results", () => {
  const host = harness(); host.receive(); host.query.isFetching = true; expect(host.html()).not.toContain("Secret tagged title");
  host.query.isFetching = false; host.query.isPaused = true; expect(host.html()).not.toContain("Secret tagged title"); expect(host.html()).toContain("Reconnecting requires a new read");
  const before = host.input().requestId; host.query.isPaused = false; expect(host.html()).not.toContain("Secret tagged title"); expect(host.input().requestId).not.toBe(before);
  host.receive(); expect(host.html()).toContain("Secret tagged title");
});

it("failed access bootstrap exposes only safe original-scope recovery, not private errors or cached tag data", () => {
  const host = harness(); host.receive();
  const initialOrigin = host.access.origin;
  host.access.readable = false;
  host.access.query.error = Error("PRIVATE_BOOTSTRAP_DETAIL original credentials/private schema");
  const failed = host.html();
  expect(failed).toContain("Original project access could not be verified");
  expect(failed).toContain("retained scope was not replaced");
  expect(failed).not.toContain("PRIVATE_BOOTSTRAP_DETAIL");
  expect(failed).not.toContain("Secret tagged title");
  expect(failed).not.toContain("distinct cases");
  expect(failed).not.toContain("Waiting for current original project membership");
  expect(host.enabled()).toBe(false);
  expect(host.button("Refresh current scope")!.props.disabled).toBe(true);
  expect(host.button("Retry original project access")!.props.disabled).toBe(false);
  host.click("Retry original project access");
  expect(host.retries).toEqual([initialOrigin]);
  expect(host.access.origin).toBe(initialOrigin);
  expect(host.enabled()).toBe(false);
  expect(host.html()).not.toContain("Secret tagged title");
  expect(host.pushes).toEqual([]);
  host.access.query.isFetching = true;
  expect(host.button("Retry original project access")!.props.disabled).toBe(true);
});

it("bootstrap recovery requires a fresh exact tag page after original access returns", () => {
  const host = harness(); host.receive();
  const originalRead = host.input().requestId;
  host.access.readable = false; host.access.query.error = Error("Temporary failure");
  host.html(); const failedRead = host.input().requestId;
  host.click("Retry original project access");
  host.access.query.error = null; host.access.readable = true;
  expect(host.html()).not.toContain("Secret tagged title");
  expect(host.html()).toContain("Awaiting a new completed scoped read");
  expect(host.input().requestId).not.toBe(originalRead);
  expect(host.input().requestId).not.toBe(failedRead);
  expect(host.input()).toMatchObject({ projectId: "project", originalOrganizationId: "org", expectedClerkActorId: "actor", tag: " spaced ", archive: "ACTIVE", review: "APPROVED" });
  host.receive();
  expect(host.html()).toContain("Secret tagged title");
  expect(host.html()).not.toContain("Retry original project access");
  expect(host.retries).toEqual([origin]);
});

it("first bootstrap failure retries the existing unpinned read without guessing a native reader or organization", () => {
  const host = harness(" spaced ", false);
  host.access.query.error = Error("PRIVATE_INITIAL_ERROR");
  expect(host.html()).toContain("Original project access could not be verified");
  expect(host.html()).not.toContain("PRIVATE_INITIAL_ERROR");
  expect(host.enabled()).toBe(false);
  expect(host.input()).toMatchObject({ projectId: "project", originalOrganizationId: "pending", expectedClerkActorId: "pending" });
  host.click("Retry original project access");
  expect(host.retries).toEqual([null]);
  expect(host.access.origin).toBeNull();
  expect(host.enabled()).toBe(false);
  host.access.origin = origin; host.access.readable = true; host.access.query.error = null;
  expect(host.html()).not.toContain("Secret tagged title");
  expect(host.input()).toMatchObject({ projectId: "project", originalOrganizationId: "org", expectedClerkActorId: "actor" });
  host.receive(); expect(host.html()).toContain("Secret tagged title");
});

it("signed-out, foreign actor and native-remap withholding are not represented as bootstrap failure", () => {
  for (const reason of ["signed-out", "foreign-actor", "missing-session", "native-remap"]) {
    const host = harness(); host.receive(); host.access.query.error = Error("PRIVATE_OLD_ERROR");
    if (reason === "native-remap") host.access.fresh.readScope.actorId = "replacement";
    else {
      host.access.readable = false;
      if (reason === "signed-out") host.auth.isSignedIn = false;
      if (reason === "foreign-actor") host.auth.userId = "other";
      if (reason === "missing-session") host.auth.sessionId = "";
    }
    const withheld = host.html();
    expect(withheld).toContain("Waiting for current original project membership");
    expect(withheld).not.toContain("Original project access could not be verified");
    expect(withheld).not.toContain("PRIVATE_OLD_ERROR");
    expect(withheld).not.toContain("Secret tagged title");
    expect(host.button("Retry original project access")).toBeUndefined();
    expect(host.enabled()).toBe(false);
    expect(host.retries).toEqual([]);
  }
});

it("tag-page errors retain their own current-view retry, separate from bootstrap recovery", () => {
  const host = harness(); host.receive(); host.query.error = Error("Native tag page refused");
  const failed = host.html();
  expect(failed).toContain("Tag associations are unavailable");
  expect(failed).toContain("No counts are being shown as zero");
  expect(failed).not.toContain("Secret tagged title");
  expect(host.button("Retry original project access")).toBeUndefined();
  host.click("Restart current view");
  expect(host.retries).toEqual([]);
  expect(host.access.origin).toBe(origin);
});
