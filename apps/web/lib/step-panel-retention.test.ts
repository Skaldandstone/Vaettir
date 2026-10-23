import { expect, it } from "vitest";
import { StepPanelRetention } from "./step-panel-retention";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { currentSessionScope } from "./auth-query-cache";
import { technicalBehaviorLabel } from "./case-authoring-fields";
it("visits are original indexed instances, not reset by collapse/filter or duplicate opens", () => {
  const state = new StepPanelRetention();
  expect(state.visit(2, 4)).toBe(true); expect(state.visit(0, 4)).toBe(true); expect(state.visit(2, 4)).toBe(true);
  expect(state.indexes()).toEqual([0, 2]); expect(state.has(1)).toBe(false);
  for (const index of [-1, 0.1, 4, Infinity, NaN]) expect(state.visit(index, 4)).toBe(false);
  expect(state.visit(0, 1001)).toBe(false); expect(state.indexes()).toEqual([0, 2]);
});
it("aggregate pending is synchronous and one ACK cannot clear another step", () => {
  const state = new StepPanelRetention(); state.visit(0, 2); state.visit(1, 2);
  expect(state.markPending(0, true)).toBe(true); expect(state.markPending(1, true)).toBe(true);
  expect(state.markPending(0, false)).toBe(true); expect(state.markPending(8, false)).toBe(true);
  expect(state.markPending(1, false)).toBe(false); expect(state.indexes()).toEqual([0, 1]);
});
it("actual panel forwards exact native parent pins to retained indexed children, while NULL parent disables without removing them", () => {
  const source = readFileSync(new URL("../components/StepExecutionPanel.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("actual.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const code = ts.transpileModule(ast.statements.filter(ts.isFunctionDeclaration).map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, "")).join("\n") + "\nthis.panel=StepExecutionPanel;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
  const Child = () => null;
  let counter = 0;
  const context = vm.createContext({ React, StepPanelRetention, currentSessionScope, technicalBehaviorLabel, ReviewedStepObservation: Child, window: { Clerk: { loaded: true, session: { id: "A", user: { id: "cl" } } } }, useState: (initial: unknown) => [++counter === 3 ? [0] : typeof initial === "function" ? initial() : initial, () => {}] });
  vm.runInContext(code, context);
  const panel = context.panel as (props: Record<string, unknown>) => React.ReactElement;
  function nodes(value: unknown): React.ReactElement[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!React.isValidElement(value)) return []; return [value, ...nodes((value.props as { children?: unknown }).children)]; }
  const pin = { projectId: "p", testRunId: "r", organizationId: "o", clerkActorId: "cl", nativeActorId: "n" }, props = { testRunId: "r", testCase: { testCaseId: "c", validationDomain: "SOFTWARE", stepExecutionAvailable: true, stepResults: [], steps: [{ action: "first" }] }, stepFieldLabels: {}, active: true, readable: true, readScope: { projectId: "p", originalOrganizationId: "o", expectedClerkActorId: "cl" }, disabled: false, blockedBy: [], onModeActive: () => {}, onChanged: async () => {} };
  const parentCurrent = () => true;
  for (const parentRunScope of [pin, null]) {
    counter = 0;
    const child = nodes(panel({ ...props, parentRunScope, parentCurrent, parentActivation: "parentA" })).find(node => node.type === Child)!;
    expect(child).toBeDefined();
    expect((child.props as { parentRunScope: unknown }).parentRunScope).toBe(parentRunScope);
    expect((child.props as { active: boolean }).active).toBe(parentRunScope !== null);
    expect((child.props as { parentCurrent: unknown }).parentCurrent).toBe(parentCurrent); expect((child.props as { parentActivation: string }).parentActivation).toBe("parentA");
  }
  let current = true, modes = 0, changes = 0, pending = 0;
  counter = 0;
  const tree = nodes(panel({ ...props, active: false, parentRunScope: pin, parentCurrent: () => current, parentActivation: "parentA", onModeActive: () => { modes++; }, onChanged: async () => { changes++; }, onUnconfirmedChange: () => { pending++; } }));
  const mode = tree.find(node => node.type === "button")!, child = tree.find(node => node.type === Child)!;
  current = false;
  (mode.props as { onClick: () => void }).onClick(); (child.props as { onChanged: () => void }).onChanged(); (child.props as { onUnconfirmedChange: (pending: boolean) => void }).onUnconfirmedChange(true);
  expect({ modes, changes, pending }).toEqual({ modes: 0, changes: 0, pending: 0 });
});
