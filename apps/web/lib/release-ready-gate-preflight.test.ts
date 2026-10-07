import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { releasePlanChoices } from "./release-planning-draft";
import type { RouterInputs, RouterOutputs } from "./trpcReact";

type Gate = RouterOutputs["releases"]["checkGate"];
type StatusInput = RouterInputs["releases"]["updateStatus"];
type Element = React.ReactElement<{ children?: React.ReactNode; role?: string; onChange?: (event: { target: { value: string } }) => Promise<void> }>;
const source = readFileSync(new URL("../app/projects/[projectId]/releases/[releaseId]/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("release.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const code = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node))
  .map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/^export\s+(?:default\s+)?/gm, "")).join("\n") +
  "\nthis.actual=ReleaseReadinessPage;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
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
function harness() {
  // Complete actual page JSX/handlers with synthetic query/hook/prompt/RPC
  // models only. No browser dialog, native authorization, status persistence,
  // gate-policy change, provider operation or production acceptance is claimed.
  const hooks: unknown[] = []; let cursor = 0;
  const gate = vi.fn(async (_input: { releaseId: string }): Promise<Gate> => ({ policy: "SOFT_WARNING", passes: true, reasons: [] }));
  const mutation = vi.fn(async (_input: StatusInput) => ({}));
  const alert = vi.fn(), confirm = vi.fn((_message: string) => false), invalidateRelease = vi.fn(), invalidatePlans = vi.fn();
  const forbidden = vi.fn(() => { throw Error("Unrelated action forbidden in status fixture"); });
  const query = <T,>(data: T) => ({ data, error: null, isFetching: false, isPaused: false, isLoading: false });
  const release = { id: "synthetic-release", projectId: "synthetic-project", name: "Synthetic release", status: "PLANNING", goals: [], targetDate: null };
  const readiness = { score: 0, label: "BLOCKED", criteria: { met: 0, atRisk: 0, notMet: 1, pending: 0, total: 1 }, riskFlags: { openTotal: 0, critical: 0, high: 0 } };
  const stub = () => null;
  const context = vm.createContext({ React, Error, releasePlanChoices, alert, confirm,
    useParams: () => ({ projectId: release.projectId, releaseId: release.id }), useReadOnlySeat: () => false,
    useState: (initial: unknown) => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (next: unknown) => { hooks[index] = typeof next === "function" ? next(hooks[index]) : next; }]; },
    ReadinessBadge: stub, DistributionBar: stub, ScoreRing: stub, ReleaseSnapshotExport: stub, Modal: stub,
    CriterionDescriptionEditor: stub, CriterionVerdictEditor: stub, AttachUnassignedPlan: stub, PlanGovernanceHistory: stub, GovernedCriterionCollection: stub,
    trpcReact: { useUtils: () => ({ releases: { invalidate: invalidateRelease, checkGate: { fetch: gate } }, testPlans: { list: { invalidate: invalidatePlans } } }),
      project: { byId: { useQuery: () => query({ id: release.projectId, organizationId: "synthetic-org", repoUrl: null, defaultBranch: "main" }) } },
      releases: { byId: { useQuery: () => query(release) }, readiness: { useQuery: () => query(readiness) },
        listTestPlans: { useQuery: () => query([]) }, listRiskFlags: { useQuery: () => query([]) }, readinessHistory: { useQuery: () => query([]) },
        updateStatus: { useMutation: () => ({ mutateAsync: mutation }) }, resolveRiskFlag: { useMutation: () => ({ mutateAsync: forbidden }) } },
      testPlans: { list: { useQuery: () => query([]) }, setRelease: { useMutation: () => ({ mutateAsync: forbidden }) } },
    },
  });
  vm.runInContext(code, context);
  const actual = (context as unknown as { actual(): React.ReactElement }).actual;
  const render = () => { cursor = 0; return actual(); };
  const choose = async (status: StatusInput["status"]) => {
    const control = elements(render()).find(node => node.type === "select");
    if (!control?.props.onChange) throw Error("Missing actual release status selector");
    await control.props.onChange({ target: { value: status } });
  };
  return { hooks, gate, mutation, alert, confirm, invalidateRelease, invalidatePlans, forbidden, render, choose };
}
const failedGate = (policy: "HARD_BLOCK" | "SOFT_WARNING"): Gate => ({ policy, passes: false, reasons: ["Acceptance criterion not met: Synthetic exact wording", "1 open CRITICAL risk flag"] });
const notice = "Release gates could not be checked. Refresh the workspace and try READY again; no status change was requested.";

describe("actual release READY gate preflight (synthetic page callbacks only)", () => {
  it("read outage refuses the READY mutation and shows only a generic retry notice, without prompts or invalidations", async () => {
    const h = harness(); h.gate.mockRejectedValueOnce(Error("Private synthetic gate failure must not be rendered"));
    await h.choose("READY");
    expect(h.gate).toHaveBeenCalledExactlyOnceWith({ releaseId: "synthetic-release" });
    expect(h.mutation).not.toHaveBeenCalled(); expect(h.alert).not.toHaveBeenCalled(); expect(h.confirm).not.toHaveBeenCalled();
    expect(h.invalidateRelease).not.toHaveBeenCalled(); expect(h.invalidatePlans).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
    expect(h.hooks[0]).toBe(notice);
    const alerts = elements(h.render()).filter(node => node.props.role === "alert");
    expect(alerts.some(node => text(node).includes(notice))).toBe(true); expect(text(h.render())).not.toContain("Private synthetic");
  });
  it("an explicit later retry checks again and a passing gate keeps the original status payload and refreshes", async () => {
    const h = harness(); h.gate.mockRejectedValueOnce(Error("Synthetic outage")); await h.choose("READY");
    expect(h.mutation).not.toHaveBeenCalled(); await h.choose("READY");
    expect(h.gate).toHaveBeenCalledTimes(2); expect(h.mutation).toHaveBeenCalledExactlyOnceWith({ id: "synthetic-release", status: "READY" });
    expect(h.hooks[0]).toBeNull(); expect(h.invalidateRelease).toHaveBeenCalledOnce(); expect(h.invalidatePlans).toHaveBeenCalledExactlyOnceWith({ projectId: "synthetic-project" });
    expect(h.alert).not.toHaveBeenCalled(); expect(h.confirm).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("hard-block failure retains its warning and refuses the mutation", async () => {
    const h = harness(); h.gate.mockResolvedValueOnce(failedGate("HARD_BLOCK")); await h.choose("READY");
    expect(h.alert).toHaveBeenCalledOnce(); expect(h.alert.mock.calls[0]![0]).toContain("Synthetic exact wording");
    expect(h.alert.mock.calls[0]![0]).toContain("1 open CRITICAL risk flag"); expect(h.confirm).not.toHaveBeenCalled(); expect(h.mutation).not.toHaveBeenCalled();
  });
  it("soft warning cancellation retains the original user decision and refuses the mutation", async () => {
    const h = harness(); h.gate.mockResolvedValueOnce(failedGate("SOFT_WARNING")); await h.choose("READY");
    expect(h.confirm).toHaveBeenCalledOnce(); expect(h.confirm.mock.calls[0]![0]).toContain("Synthetic exact wording");
    expect(h.confirm.mock.calls[0]![0]).toContain("Mark it READY anyway?"); expect(h.mutation).not.toHaveBeenCalled(); expect(h.alert).not.toHaveBeenCalled();
  });
  it("soft warning confirmation still requests READY without changing native policy or payload", async () => {
    const h = harness(); h.confirm.mockReturnValueOnce(true); h.gate.mockResolvedValueOnce(failedGate("SOFT_WARNING")); await h.choose("READY");
    expect(h.confirm).toHaveBeenCalledOnce(); expect(h.mutation).toHaveBeenCalledExactlyOnceWith({ id: "synthetic-release", status: "READY" });
    expect(h.invalidateRelease).toHaveBeenCalledOnce(); expect(h.alert).not.toHaveBeenCalled();
  });
  it.each(["PLANNING", "IN_TESTING", "SHIPPED", "BLOCKED"] as const)("non-READY %s does not gain a gate dependency or a different payload", async status => {
    const h = harness(); h.gate.mockRejectedValue(Error("Unused synthetic gate outage")); await h.choose(status);
    expect(h.gate).not.toHaveBeenCalled(); expect(h.mutation).toHaveBeenCalledExactlyOnceWith({ id: "synthetic-release", status });
    expect(h.alert).not.toHaveBeenCalled(); expect(h.confirm).not.toHaveBeenCalled(); expect(h.hooks[0]).toBeNull(); expect(h.forbidden).not.toHaveBeenCalled();
  });
  it("a status mutation refusal after a passing gate keeps existing error handling, without silently retrying", async () => {
    const h = harness(); h.mutation.mockRejectedValueOnce(Error("Synthetic native refusal")); await h.choose("READY");
    expect(h.gate).toHaveBeenCalledOnce(); expect(h.mutation).toHaveBeenCalledOnce(); expect(h.hooks[0]).toBe("Synthetic native refusal");
    expect(h.invalidateRelease).not.toHaveBeenCalled(); expect(h.invalidatePlans).not.toHaveBeenCalled();
  });
});
