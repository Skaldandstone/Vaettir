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

function harness(tag: string | null = " spaced ") {
  const hooks: unknown[] = [], effects: Array<() => void> = [], pushes: string[] = [];
  let cursor = 0, dirty = false, lastInput: Record<string, unknown> = {}, enabled = false, uuid = 0;
  const auth = { isLoaded: true, isSignedIn: true, userId: "actor", sessionId: "A" };
  const access = { origin, readable: true, fresh: { readScope: { actorId: "native" } } };
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
  function click(text: string) { const button = elements(render()).find(node => node.type === "button" && React.Children.toArray(node.props.children as React.ReactNode).join("") === text); expect(button).toBeTruthy(); (button!.props.onClick as () => void)(); render(); }
  function receive(patch = {}) { query.isFetchedAfterMount = true; query.error = null; query.data = { projectId: "project", organizationId: "org", clerkActorId: "actor", requestId: lastInput.requestId, tag: lastInput.tag, section: lastInput.section, archive: lastInput.archive, review: lastInput.review, scopeHash: "a".repeat(64), readScope: { projectId: "project", organizationId: "org", actorId: "native", actorClerkUserId: "actor" }, asOf: "2026-10-06T03:00:00.000Z", total: 1, matchingCases: 1, items: [{ id: "case", title: "Secret tagged title", displayId: "CASE-1", matchingCaseCount: 1, edge: "DIRECT_CASE_TAG", reviewStatus: "APPROVED", archived: false }], nextCursor: null, limitations: ["Current saved association, not frozen historical tags."], ...patch }; render(); }
  render(); return { auth, access, query, receive, html, click, input: () => lastInput, enabled: () => enabled, pushes };
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
