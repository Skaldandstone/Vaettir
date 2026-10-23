import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { sameCaseFieldOrigin, type CaseFieldOrigin } from "./case-field-origin";
import { assertGovernanceAcknowledgement, planGovernanceRequestHash, retainedGovernancePending } from "./plan-governance-receipt";
import type { RouterInputs, RouterOutputs } from "./trpcReact";

type Input = RouterInputs["testPlanGovernance"]["detachAttachedPlan"];
type Ack = RouterOutputs["testPlanGovernance"]["detachAttachedPlan"];
type Preview = RouterOutputs["testPlanGovernance"]["preview"];
type Props = { projectId: string; releaseId: string; releaseStatus: string; plans: Array<{ id: string; name: string }>; active: boolean; onChanged: () => void };
type Event = { target: { value: string; checked: boolean } };
type Element = React.ReactElement<{ children?: React.ReactNode; value?: string; type?: string; disabled?: boolean; onClick?: () => unknown; onChange?: (event: Event) => void }>;
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const event = (value = "", checked = false): Event => ({ target: { value, checked } });
function nodes(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node as Element, ...nodes(node.props.children)];
}
function text(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return text(node.props.children);
  return React.Children.toArray(node).map(text).join("");
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function required<T>(value: T | undefined): T { if (value === undefined) throw Error("Missing actual synthetic evidence"); return value; }
const origin: CaseFieldOrigin = { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-clerk", caseId: null };
const preview = (): Preview => ({ scope: { projectId: origin.projectId, organizationId: origin.organizationId, actorId: "native-synthetic-actor", actorClerkUserId: origin.clerkActorId },
  snapshot: { snapshotVersion: 1, id: "synthetic-plan", projectId: origin.projectId, testPlanTypeId: "synthetic-type", releaseId: "synthetic-release", strategyId: null, name: "Literal <plan>\n second line", description: null, status: "DRAFT", customFields: {}, executionTemplate: {}, createdById: null, updatedById: null, createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z", latestVersion: null, criteria: [] },
  planRevision: "a".repeat(64), criterionRevisions: {}, canEdit: true, canRecover: true, editBlockedReason: null, manualVerdicts: true,
  statusActions: { canChange: true, canReopen: false, blockedReason: null }, metadataSchema: { testPlanTypeId: "synthetic-type", fieldSchema: {}, fieldSchemaHash: null, supported: false, canEdit: false, blockedReason: null },
});
async function ack(input: Input): Promise<Ack> { return { scope: preview().scope, requestId: input.requestId, requestHash: await planGovernanceRequestHash("DETACH_ATTACHED_PLAN", input), operation: "DETACH_ATTACHED_PLAN", testPlanId: input.testPlanId, releaseId: null, criterionId: null, beforeRevision: input.expectedPlanRevision, afterRevision: "b".repeat(64), versionId: "synthetic-version", versionNumber: 1, replayed: false }; }

/** Complete actual controller, original receipt/scope/hash helpers, synthetic
 * hooks and RPC only. Not browser, PostgreSQL, Clerk or deployment acceptance. */
function harness() {
  const props: Props = { projectId: origin.projectId, releaseId: "synthetic-release", releaseStatus: "PLANNING", plans: [{ id: "synthetic-plan", name: "Synthetic plan" }], active: true, onChanged: vi.fn() };
  const auth = { isLoaded: true, isSignedIn: true, userId: origin.clerkActorId, sessionId: "synthetic-session" };
  const sdk = { loaded: true, session: { id: auth.sessionId, user: { id: auth.userId } } };
  const access = { origin, current: origin as CaseFieldOrigin | null, readable: true, canEdit: true, owns: (expected: CaseFieldOrigin, mode = "read") => sameCaseFieldOrigin(expected, access.current) && (mode !== "edit" || access.canEdit) };
  const state = { fresh: preview() as Preview | null };
  const query = { error: null as unknown, isFetching: false, refetch: vi.fn(async () => undefined) };
  const save = { isPending: false, mutateAsync: vi.fn<(input: Input) => Promise<Ack>>(ack) };
  const hook = vi.fn(() => ({ access, fresh: state.fresh, query }));
  const uuid = vi.fn((() => { let id = 0; return () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`; })());
  const slots: Slot[] = [], effects: Array<() => void> = [];
  let cursor = 0, dirty = false, tree: React.ReactElement;
  function slot() { const index = cursor++; return slots[index] ?? (slots[index] = {}); }
  function sameDeps(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) { return !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])); }
  const context = vm.createContext({ React, Object, Error, sameCaseFieldOrigin, currentSessionScope, sameAuthScope, assertGovernanceAcknowledgement, planGovernanceRequestHash, retainedGovernancePending,
    crypto: { randomUUID: uuid }, window: { Clerk: sdk }, useAuth: () => auth, usePlanGovernance: hook,
    trpcReact: { testPlanGovernance: { detachAttachedPlan: { useMutation: () => save } } },
    useState: (initial: unknown) => { const held = slot(); if (!Object.hasOwn(held, "value")) held.value = initial; return [held.value, (next: unknown) => { const value = typeof next === "function" ? next(held.value) : next; if (!Object.is(value, held.value)) { held.value = value; dirty = true; } }]; },
    useRef: (initial: unknown) => { const held = slot(); if (!Object.hasOwn(held, "value")) held.value = { current: initial }; return held.value; },
    useMemo: (make: () => unknown, deps: readonly unknown[]) => { const held = slot(); if (!sameDeps(held.deps, deps)) { held.deps = deps; held.value = make(); } return held.value; },
    useLayoutEffect: (make: () => unknown, deps: readonly unknown[]) => { const held = slot(); if (!sameDeps(held.deps, deps)) { held.deps = deps; effects.push(() => { held.cleanup?.(); const cleanup = make(); held.cleanup = typeof cleanup === "function" ? cleanup as () => void : undefined; }); } },
  });
  const source = readFileSync(new URL("../components/PlanReleaseDetach.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("controller.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
  const body = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/^export\s+/gm, "")).join("\n");
  vm.runInContext(ts.transpileModule(`${body}\nthis.actual=PlanReleaseDetach`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  function render() { let turns = 0; do { if (++turns > 30) throw Error("Unsettled synthetic render"); dirty = false; cursor = 0; tree = (context as unknown as { actual: (props: Props) => React.ReactElement }).actual(props); while (effects.length) effects.shift()!(); } while (dirty); return tree; }
  render();
  function button(label: string) { return required(nodes(tree).find(node => node.type === "button" && text(node) === label)); }
  function input(label: string) { const wrapper = required(nodes(tree).find(node => node.type === "label" && text(node).trimStart().startsWith(label))); return required(nodes(wrapper).find(node => node.type === "input" || node.type === "select")); }
  function change(label: string, value: string, checked = false) { required(input(label).props.onChange)(event(value, checked)); render(); }
  function review() { change("Attached test plan", "synthetic-plan"); required(button("Load current plan for review").props.onClick)(); render(); change("Reason for detachment", "  Synthetic reason\nline  "); change("I reviewed this plan", "", true); }
  async function settle() { for (let n = 0; n < 12; n++) { await new Promise(resolve => setTimeout(resolve, 0)); render(); } }
  async function click(label: string) { await required(button(label).props.onClick)(); await settle(); }
  return { props, auth, sdk, access, state, query, save, hook, uuid, render, button, input, change, review, settle, click, tree: () => tree, html: () => renderToStaticMarkup(tree), unmount: () => { for (const slot of slots) slot.cleanup?.(); } };
}

describe("retained release-detail plan detach actual controller", () => {
  it("requires deliberate original plan/revision review and freezes explicit NULL request", async () => {
    const h = harness();
    expect(h.save.mutateAsync).not.toHaveBeenCalled(); h.review();
    expect(h.html()).toContain("Literal &lt;plan&gt;"); expect(h.html()).toContain("Reviewed revision:");
    await h.click("Detach reviewed plan");
    const input = required(h.save.mutateAsync.mock.calls[0])[0];
    expect(input).toEqual({ projectId: origin.projectId, testPlanId: "synthetic-plan", releaseId: null, expectedReleaseId: "synthetic-release", expectedPlanRevision: "a".repeat(64), originalOrganizationId: origin.organizationId, expectedClerkActorId: origin.clerkActorId, requestId: expect.any(String), reason: "Synthetic reason\nline", confirmed: true });
    expect(Object.isFrozen(input)).toBe(true); expect(h.props.onChanged).toHaveBeenCalledTimes(1); expect(h.query.refetch).toHaveBeenCalledTimes(1);
    expect(h.html()).toContain("Plan detached with an audited version");
  });
  it("blocks duplicate callbacks during hashing/send and completed captured callbacks after ACK", async () => {
    const h = harness(); h.review(); const click = required(h.button("Detach reviewed plan").props.onClick), result = deferred<Ack>(); h.save.mutateAsync.mockReturnValueOnce(result.promise);
    const first = click(), duplicate = click(); expect(h.uuid).toHaveBeenCalledTimes(1); h.render();
    for (let n = 0; n < 10 && !h.save.mutateAsync.mock.calls.length; n++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.save.mutateAsync).toHaveBeenCalledTimes(1); const input = required(h.save.mutateAsync.mock.calls[0])[0];
    result.resolve(await ack(input)); await first; await duplicate; await h.settle(); await click(); await h.settle();
    expect(h.uuid).toHaveBeenCalledTimes(1); expect(h.save.mutateAsync).toHaveBeenCalledTimes(1);
  });
  it("refuses captured commit review cancel and field handlers after newer deliberate edits", async () => {
    const h = harness(); h.review();
    const commit = required(h.button("Detach reviewed plan").props.onClick), review = required(h.button("Reload current plan for review (replaces unsaved reason)").props.onClick), cancel = required(h.button("Cancel unsaved detachment").props.onClick), oldReason = required(h.input("Reason for detachment").props.onChange), oldConfirm = required(h.input("I reviewed this plan").props.onChange);
    h.change("Reason for detachment", "New exact reason");
    await commit(); review(); cancel(); oldReason(event("Old reason")); oldConfirm(event("", true)); h.render();
    expect(h.input("Reason for detachment").props.value).toBe("New exact reason");
    expect(h.button("Detach reviewed plan").props.disabled).toBe(true); expect(h.uuid).not.toHaveBeenCalled(); expect(h.save.mutateAsync).not.toHaveBeenCalled();
    h.change("I reviewed this plan", "", true); await h.click("Detach reviewed plan"); expect(required(h.save.mutateAsync.mock.calls[0])[0].reason).toBe("New exact reason");
    const pick = harness(), oldPick = required(pick.input("Attached test plan").props.onChange); pick.change("Attached test plan", "synthetic-plan"); oldPick(event("other-plan")); pick.render(); expect(pick.input("Attached test plan").props.value).toBe("synthetic-plan");
  });
  it("retains exact UNKNOWN UUID/body across list disappearance later refusal and newer locked lifecycle", async () => {
    const h = harness(); h.review(); h.save.mutateAsync.mockRejectedValueOnce(new Error("private synthetic timeout"));
    await h.click("Detach reviewed plan"); const original = required(h.save.mutateAsync.mock.calls[0])[0], bytes = JSON.stringify(original);
    h.props.plans = []; h.props.releaseStatus = "SHIPPED"; h.state.fresh = { ...preview(), canEdit: false, snapshot: { ...preview().snapshot, releaseId: null, status: "APPROVED" } }; h.render();
    expect(h.button("Retry same detachment").props.disabled).toBe(false); expect(h.html()).not.toContain("private synthetic timeout");
    h.save.mutateAsync.mockRejectedValueOnce({ data: { code: "FORBIDDEN" } }); await h.click("Retry same detachment");
    await h.click("Retry same detachment");
    expect(required(h.save.mutateAsync.mock.calls[1])[0]).toBe(original); expect(required(h.save.mutateAsync.mock.calls[2])[0]).toBe(original); expect(JSON.stringify(original)).toBe(bytes); expect(h.uuid).toHaveBeenCalledTimes(1);
  });
  it("a first definite refusal retains reason but requires deliberate fresh review before a new UUID", async () => {
    const h = harness(); h.review(); const oldClick = required(h.button("Detach reviewed plan").props.onClick);
    h.save.mutateAsync.mockRejectedValueOnce({ data: { code: "CONFLICT" } }); await h.click("Detach reviewed plan");
    expect(h.input("Reason for detachment").props.value).toBe("  Synthetic reason\nline  "); expect(h.input("Reason for detachment").props.disabled).toBe(true); expect(h.button("Detach reviewed plan").props.disabled).toBe(true); expect(h.query.refetch).toHaveBeenCalledTimes(1);
    await oldClick(); await h.click("Detach reviewed plan"); h.change("I reviewed this plan", "", true); await h.click("Detach reviewed plan"); expect(h.uuid).toHaveBeenCalledTimes(1); expect(h.save.mutateAsync).toHaveBeenCalledTimes(1);
    required(h.button("Reload current plan for review (replaces unsaved reason)").props.onClick)(); h.render(); h.change("Reason for detachment", "Deliberate new review"); h.change("I reviewed this plan", "", true); await h.click("Detach reviewed plan"); expect(h.uuid).toHaveBeenCalledTimes(2); expect(required(h.save.mutateAsync.mock.calls[1])[0].requestId).not.toBe(required(h.save.mutateAsync.mock.calls[0])[0].requestId);
  });
  it("failed recovery preview retains UNKNOWN and offers only the original guarded read retry", async () => {
    const h = harness(); h.review(); h.save.mutateAsync.mockRejectedValueOnce(new Error("lost ACK")); await h.click("Detach reviewed plan"); const original = required(h.save.mutateAsync.mock.calls[0])[0];
    h.state.fresh = null; h.query.error = new Error("private preview error"); h.render();
    expect(h.button("Retry same detachment").props.disabled).toBe(true); expect(h.html()).not.toContain("private preview error");
    const retry = required(h.button("Retry plan read").props.onClick); await retry(); expect(h.query.refetch).toHaveBeenCalledTimes(1); expect(h.save.mutateAsync).toHaveBeenCalledTimes(1);
    h.props.releaseId = "another-release"; h.render(); retry(); expect(h.query.refetch).toHaveBeenCalledTimes(1);
    h.props.releaseId = "synthetic-release"; h.query.error = null; h.state.fresh = preview(); h.render(); await h.click("Retry same detachment"); expect(required(h.save.mutateAsync.mock.calls[1])[0]).toBe(original); expect(h.uuid).toHaveBeenCalledTimes(1);
  });
  it.each(["parent", "query"])("post-ACK %s refresh failure preserves confirmed detachment and never resubmits", async failure => {
    const h = harness(); h.review(); const captured = required(h.button("Detach reviewed plan").props.onClick);
    if (failure === "parent") h.props.onChanged = vi.fn(() => { throw Error("private refresh failure"); });
    else h.query.refetch.mockRejectedValueOnce(new Error("private refresh failure"));
    h.render();
    await h.click("Detach reviewed plan"); expect(h.html()).toContain("acknowledged as detached"); expect(h.html()).not.toContain("No change was submitted"); expect(h.html()).not.toContain("private refresh failure");
    await captured(); h.render(); expect(h.save.mutateAsync).toHaveBeenCalledTimes(1); expect(h.uuid).toHaveBeenCalledTimes(1);
    h.props.onChanged = vi.fn(); h.render(); await h.click("Retry plan read"); expect(h.save.mutateAsync).toHaveBeenCalledTimes(1); expect(h.uuid).toHaveBeenCalledTimes(1); expect(h.query.refetch).toHaveBeenCalled();
  });
  it.each(["READY", "SHIPPED", "IN_TESTING", "BLOCKED"])("refuses a new draft from source status %s", status => {
    const h = harness(); h.props.releaseStatus = status; h.render(); expect(h.button("Load current plan for review").props.disabled).toBe(true); required(h.button("Load current plan for review").props.onClick)(); h.render(); expect(h.html()).not.toContain("Reason for detachment"); expect(h.uuid).not.toHaveBeenCalled();
  });
  it.each(["APPROVED", "ARCHIVED"] as const)("refuses new draft from %s plan", status => {
    const h = harness(); h.state.fresh = { ...preview(), snapshot: { ...preview().snapshot, status } }; h.render(); expect(h.button("Load current plan for review").props.disabled).toBe(true); required(h.button("Load current plan for review").props.onClick)(); h.render(); expect(h.uuid).not.toHaveBeenCalled();
  });
  it("retains reviewed reason but refuses a changed revision/source plan", async () => {
    for (const changed of [{ planRevision: "c".repeat(64) }, { snapshot: { ...preview().snapshot, releaseId: "other-release" } }]) {
      const h = harness(); h.review(); const click = required(h.button("Detach reviewed plan").props.onClick); h.state.fresh = { ...preview(), ...changed }; h.render(); await click(); expect(h.save.mutateAsync).not.toHaveBeenCalled(); expect(h.input("Reason for detachment").props.value).toBe("  Synthetic reason\nline  ");
    }
  });
  it("withholds original draft and forbids captured sends after actor organization route SDK readonly or unmount loss", async () => {
    for (const loss of ["actor", "organization", "project", "release", "sdk", "readonly", "inactive", "unmount"]) {
      const h = harness(); h.review(); const click = required(h.button("Detach reviewed plan").props.onClick);
      if (loss === "actor") { h.auth.userId = "other-clerk"; h.access.current = { ...origin, clerkActorId: "other-clerk" }; }
      if (loss === "organization") h.access.current = { ...origin, organizationId: "other-org" };
      if (loss === "project") h.props.projectId = "other-project";
      if (loss === "release") h.props.releaseId = "other-release";
      if (loss === "sdk") h.sdk.session = { id: "other-session", user: { id: "other-clerk" } };
      if (loss === "readonly") { h.access.canEdit = false; h.access.readable = false; }
      if (loss === "inactive") h.props.active = false;
      if (loss === "unmount") h.unmount(); else h.render();
      await click(); expect(h.save.mutateAsync).not.toHaveBeenCalled(); expect(h.uuid).not.toHaveBeenCalled();
      if (loss !== "unmount") expect(h.html()).not.toContain("Synthetic reason");
    }
  });
  it("retains an in-flight ACK after account loss and resumes exact original request", async () => {
    const h = harness(); h.review(); const result = deferred<Ack>(); h.save.mutateAsync.mockReturnValueOnce(result.promise); const first = required(h.button("Detach reviewed plan").props.onClick)();
    for (let n = 0; n < 10 && !h.save.mutateAsync.mock.calls.length; n++) await new Promise(resolve => setTimeout(resolve, 0));
    const original = required(h.save.mutateAsync.mock.calls[0])[0]; h.props.active = false; h.render(); result.resolve(await ack(original)); await first; await h.settle(); expect(h.props.onChanged).not.toHaveBeenCalled(); expect(h.html()).not.toContain("Synthetic reason");
    h.props.active = true; h.render(); await h.click("Retry same detachment"); expect(required(h.save.mutateAsync.mock.calls[1])[0]).toBe(original); expect(h.props.onChanged).toHaveBeenCalledTimes(1);
  });
  it.each(["release", "scope", "hash", "operation", "revision", "criterion"])("rejects mismatched %s acknowledgement without losing exact request", async mismatch => {
    const h = harness(); h.review(); h.save.mutateAsync.mockImplementationOnce(async input => {
      const result = await ack(input);
      if (mismatch === "release") result.releaseId = "wrong-release";
      if (mismatch === "scope") result.scope = { ...result.scope, organizationId: "wrong-org" };
      if (mismatch === "hash") result.requestHash = "c".repeat(64);
      if (mismatch === "operation") result.operation = "ATTACH_UNASSIGNED_PLAN";
      if (mismatch === "revision") result.beforeRevision = "c".repeat(64);
      if (mismatch === "criterion") result.criterionId = "wrong-criterion";
      return result;
    });
    await h.click("Detach reviewed plan"); expect(h.props.onChanged).not.toHaveBeenCalled(); expect(h.button("Retry same detachment")).toBeDefined(); const original = required(h.save.mutateAsync.mock.calls[0])[0];
    await h.click("Retry same detachment"); expect(required(h.save.mutateAsync.mock.calls[1])[0]).toBe(original);
  });
  it("mounted page removes all legacy immediate detach writers and keeps controller at stable root position through volatile reads", () => {
    const source = readFileSync(new URL("../app/projects/[projectId]/releases/[releaseId]/page.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect(source).not.toContain("testPlans.setRelease"); expect(source).not.toContain("detachPlan(");
    const locations: ts.JsxExpression[] = [];
    function walk(node: ts.Node) { if (ts.isJsxExpression(node) && node.expression?.getText(ast) === "detachControl") locations.push(node); ts.forEachChild(node, walk); } walk(ast);
    expect(locations).toHaveLength(3);
    for (const location of locations) { const parent = location.parent; expect(ts.isJsxElement(parent)).toBe(true); if (!ts.isJsxElement(parent)) throw Error("Controller not mounted in root"); expect(parent.openingElement.tagName.getText(ast)).toBe("div"); expect(parent.children.find(child => !ts.isJsxText(child))).toBe(location); }
  });
  it("actual page keeps the same unkeyed controller position with rows removed and through loading or error returns", () => {
    const source = readFileSync(new URL("../app/projects/[projectId]/releases/[releaseId]/page.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
    const query = (data: unknown) => ({ data, error: null as { message: string } | null, isFetching: false, isPaused: false });
    const release = query({ id: "synthetic-release", projectId: origin.projectId, status: "PLANNING", name: "Synthetic release", goals: [], targetDate: null });
    const readiness = query({ score: 0, label: "PENDING", criteria: { met: 0, atRisk: 0, notMet: 0, pending: 0 }, riskFlags: { openTotal: 0, critical: 0, high: 0 } });
    const plans = query([{ id: "synthetic-plan", name: "Synthetic plan", testPlanType: { name: "Synthetic type" }, acceptanceCriteria: [] }]);
    const detachBoundary = () => null, child = () => null;
    const context = vm.createContext({ React, useParams: () => ({ projectId: origin.projectId, releaseId: "synthetic-release" }), useState: (value: unknown) => [value, vi.fn()], useReadOnlySeat: () => false,
      PlanReleaseDetach: detachBoundary, ReadinessBadge: child, DistributionBar: child, ScoreRing: child, ReleaseSnapshotExport: child, Modal: child, CriterionDescriptionEditor: child, CriterionVerdictEditor: child, AttachUnassignedPlan: child, PlanGovernanceHistory: child, GovernedCriterionCollection: child,
      releasePlanChoices: () => ({ available: [], assignedElsewhere: [] }),
      trpcReact: { useUtils: () => ({ releases: { invalidate: vi.fn() }, testPlans: { list: { invalidate: vi.fn() } } }),
        project: { byId: { useQuery: () => query({ id: origin.projectId, organizationId: origin.organizationId, repoUrl: null, defaultBranch: "main" }) } },
        testPlans: { list: { useQuery: () => query([]) } },
        releases: { byId: { useQuery: () => release }, readiness: { useQuery: () => readiness }, listTestPlans: { useQuery: () => plans }, listRiskFlags: { useQuery: () => query([]) }, readinessHistory: { useQuery: () => query([]) }, updateStatus: { useMutation: () => ({}) }, resolveRiskFlag: { useMutation: () => ({}) } },
      },
    });
    const body = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/^export\s+(?:default\s+)?/gm, "")).join("\n");
    vm.runInContext(ts.transpileModule(`${body}\nthis.actual=ReleaseReadinessPage`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
    function render() { return (context as unknown as { actual: () => React.ReactElement<{ children: React.ReactNode }> }).actual(); }
    for (const phase of ["loaded", "rows-removed", "loading", "error"]) {
      if (phase === "rows-removed") plans.data = [];
      if (phase === "loading") readiness.data = undefined;
      if (phase === "error") readiness.error = { message: "Synthetic read failure" };
      const root = render(), first = required(React.Children.toArray(root.props.children)[0]);
      expect(root.type).toBe("div"); expect(React.isValidElement(first)).toBe(true);
      if (!React.isValidElement<Props>(first)) throw Error("Missing retained controller");
      expect(first.type).toBe(detachBoundary); expect(first.key).toBe(".0"); expect(first.props.projectId).toBe(origin.projectId); expect(first.props.releaseId).toBe("synthetic-release");
    }
  });
});
