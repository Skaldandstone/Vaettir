import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { expect, it } from "vitest";
import { StepPanelRetention } from "./step-panel-retention";
import { technicalBehaviorLabel } from "./case-authoring-fields";
import { currentSessionScope } from "./auth-query-cache";
import type { StepExecutionPanel } from "../components/StepExecutionPanel";
type Props = Parameters<typeof StepExecutionPanel>[0];
type ChildProps = { active: boolean; initiallyOpen: boolean; stepIndex: number; onUnconfirmedChange: (pending: boolean) => void; onChanged: () => Promise<void>; stepFieldLabels: Record<string, string> };
const source = readFileSync(new URL("../components/StepExecutionPanel.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("StepExecutionPanel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, "")).join("\n");
const executable = ts.transpileModule(functions + "\nthis.panel=StepExecutionPanel;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
function descendants(node: unknown): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants((node.props as { children?: unknown }).children)];
}
function harness() {
  const hooks: unknown[] = [], pending: boolean[] = []; let cursor = 0;
  const sdk = { loaded: true, session: { id: "session", user: { id: "cl" } } };
  const editor = () => null;
  const props: Props = { testRunId: "r", testCase: { testCaseId: "case", steps: [{ order: 0, action: "First" }, { order: 1, action: "Second" }], stepResults: [], stepExecutionAvailable: true, validationDomain: "SOFTWARE" } as unknown as Props["testCase"], readScope: { projectId: "p", originalOrganizationId: "o", expectedClerkActorId: "cl" }, stepFieldLabels: { expectedActionOrData: "Wire behavior" }, active: true, readable: true, disabled: false, blockedBy: [], onModeActive: () => {}, onChanged: async () => {}, onUnconfirmedChange: value => pending.push(value) };
  const context = vm.createContext({ React, StepPanelRetention, ReviewedStepObservation: editor, currentSessionScope, technicalBehaviorLabel, window: { Clerk: sdk }, useState: (initial: unknown) => { const at = cursor++; if (!Object.hasOwn(hooks, at)) hooks[at] = typeof initial === "function" ? initial() : initial; return [hooks[at], (next: unknown) => { hooks[at] = next; }]; } });
  vm.runInContext(executable, context); const render = () => { cursor = 0; return descendants((context as unknown as { panel: (props: Props) => React.ReactElement }).panel(props)); };
  const children = () => render().filter(node => node.type === editor);
  function visit(index: number) { const node = render().find(node => node.type === "button" && JSON.stringify((node.props as { children?: unknown }).children) === JSON.stringify(["Review step ", index + 1, " observation"])); expect(node).toBeTruthy(); (node!.props as { onClick: () => void }).onClick(); }
  return { props, sdk, pending, render, children, visit };
}
it("actual central caller lazily visits once, opens first review and retains stable original editors across collapse and summary changes", () => {
  const h = harness(); expect(h.children()).toHaveLength(0); h.visit(1);
  const first = h.children()[0]!; expect((first.props as ChildProps).initiallyOpen).toBe(true); expect((first.props as ChildProps).stepIndex).toBe(1);
  expect((first.props as ChildProps).stepFieldLabels.expectedActionOrData).toBe("Wire behavior");
  h.props.readable = false; h.props.testCase = { ...h.props.testCase, steps: [], stepResults: [] };
  expect(h.children()).toHaveLength(1); expect(h.children()[0]!.key).toBe(first.key); expect((h.children()[0]!.props as ChildProps).active).toBe(false);
  h.props.readable = true; h.props.readScope = { ...h.props.readScope!, projectId: "foreign" };
  expect(h.children()[0]!.key).toBe(first.key); expect((h.children()[0]!.props as ChildProps).active).toBe(false);
});
it("two current visited steps report aggregate pending, never releasing another uncertain request", () => {
  const h = harness(); h.visit(0); h.visit(1); const children = h.children().map(node => node.props as ChildProps);
  children[0]!.onUnconfirmedChange(true); children[1]!.onUnconfirmedChange(true); children[0]!.onUnconfirmedChange(false); children[1]!.onUnconfirmedChange(false);
  expect(h.pending).toEqual([true, true, true, false]);
});
it("SDK user movement refuses new presentation visits while already visited native editor remains inactive on scope loss", () => {
  const h = harness(); h.sdk.session.user.id = "foreign"; h.visit(0); expect(h.children()).toHaveLength(0);
  h.sdk.session.user.id = "cl"; h.visit(0); h.props.readable = false;
  expect(h.children()).toHaveLength(1); expect((h.children()[0]!.props as ChildProps).active).toBe(false);
  expect(source).not.toMatch(/recordStepResult|listStepEvidence|stepResultHistory|window.open|parseStepMeasurements/);
});
