import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { describe, expect, it, vi } from "vitest";

type AnalysisProps = Parameters<
  typeof import("../components/DurableCaseAnalysis").DurableCaseAnalysis
>[0];
type Case = Readonly<{
  id: string;
  archived: boolean;
  reviewStatus: "APPROVED" | "PENDING_REVIEW" | "REJECTED";
}>;
const source = readFileSync(
  new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "repository.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const durableSource = readFileSync(
  new URL("../components/DurableCaseAnalysis.tsx", import.meta.url),
  "utf8",
);
const durableAst = ts.createSourceFile(
  "DurableCaseAnalysis.tsx",
  durableSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const wrapper = durableAst.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "DurableCaseAnalysis",
);
if (!wrapper || !ts.isFunctionDeclaration(wrapper))
  throw Error("Actual durable wrapper required");
const printer = ts.createPrinter();
const wrapperCode = ts.transpileModule(
  printer
    .printNode(ts.EmitHint.Unspecified, wrapper, durableAst)
    .replace(/\bexport\s+/, ""),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
    },
  },
).outputText;
const callers: ts.JsxSelfClosingElement[] = [];
function visit(node: ts.Node) {
  if (
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(ast) === "DurableCaseAnalysis"
  )
    callers.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
function caller(label: string) {
  const matches = callers.filter((node) => node.getText(ast).includes(label));
  expect(matches).toHaveLength(1);
  return matches[0]!;
}
const all = caller("Analyze all loaded approved cases"),
  filtered = caller("Analyze filtered suite");
function capture(
  node: ts.JsxSelfClosingElement,
  cases: readonly Case[],
  visibleCases: readonly Case[],
  projectId = "synthetic-project",
) {
  const reload = vi.fn();
  // Execute the unchanged real page JSX and real outer wrapper only. Never
  // mount the private controller, run hooks or create a query/mutation client.
  const Analysis = vi.fn(() => {
    throw Error("Private workflow must not execute in caller-only tests");
  });
  const host = vm.createContext({
    React,
    Analysis,
    projectId,
    cases,
    visibleCases,
    reload,
  });
  vm.runInContext(wrapperCode, host);
  vm.runInContext(
    ts.transpileModule(
      `this.element=(${printer.printNode(ts.EmitHint.Unspecified, node, ast)});`,
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.None,
          jsx: ts.JsxEmit.React,
        },
      },
    ).outputText,
    host,
  );
  const element = (
    host as unknown as { element: React.ReactElement<AnalysisProps> }
  ).element;
  const actualWrapper = (
    host as unknown as {
      DurableCaseAnalysis(
        props: AnalysisProps,
      ): React.ReactElement<AnalysisProps>;
    }
  ).DurableCaseAnalysis;
  expect(element.type).toBe(actualWrapper);
  const wrapped = actualWrapper(element.props);
  expect(wrapped.props).toEqual(element.props);
  expect(wrapped.key).toBe(projectId);
  expect(Analysis).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  return { element, reload };
}
const approved = (count: number): readonly Case[] =>
  Array.from({ length: count }, (_, index) =>
    Object.freeze({
      id: `synthetic-${index}`,
      archived: false,
      reviewStatus: "APPROVED" as const,
    }),
  );

describe("actual whole repository analysis caller scope, no native/provider/AI/spending execution", () => {
  it("passes all 851 loaded approved IDs while the unchanged filtered caller still passes only its 20 visible IDs", () => {
    const cases = approved(851),
      visible = cases.slice(40, 60),
      before = JSON.stringify(cases);
    const whole = capture(all, cases, visible),
      current = capture(filtered, cases, visible);
    expect(whole.element.props.selectedIds).toEqual(
      cases.map((item) => item.id),
    );
    expect(whole.element.props.buttonLabel).toBe(
      "Analyze all loaded approved cases (851)",
    );
    expect(current.element.props.selectedIds).toEqual(
      visible.map((item) => item.id),
    );
    expect(current.element.props.buttonLabel).toBe(
      "Analyze filtered suite (20)",
    );
    expect(whole.element.props.onCompleted).toBe(whole.reload);
    expect(JSON.stringify(cases)).toBe(before);
  });
  it("excludes archived, pending and rejected cases, without normalizing approved IDs", () => {
    const cases: readonly Case[] = Object.freeze([
      Object.freeze({
        id: " approved literal ID ",
        archived: false,
        reviewStatus: "APPROVED",
      }),
      Object.freeze({
        id: "pending",
        archived: false,
        reviewStatus: "PENDING_REVIEW",
      }),
      Object.freeze({
        id: "rejected",
        archived: false,
        reviewStatus: "REJECTED",
      }),
      Object.freeze({
        id: "archived-approved",
        archived: true,
        reviewStatus: "APPROVED",
      }),
      Object.freeze({
        id: "archived-pending",
        archived: true,
        reviewStatus: "PENDING_REVIEW",
      }),
    ]);
    const result = capture(all, cases, cases);
    expect(result.element.props.selectedIds).toEqual([" approved literal ID "]);
    expect(result.element.props.buttonLabel).toBe(
      "Analyze all loaded approved cases (1)",
    );
  });
  it.each([0, 1000, 1001])(
    "passes the entire %s-case scope without truncation; the existing review controller owns refusal",
    (count) => {
      const cases = approved(count),
        result = capture(all, cases, []);
      expect(result.element.props.selectedIds).toHaveLength(count);
      expect(result.element.props.selectedIds).toEqual(
        cases.map((item) => item.id),
      );
      expect(result.element.props.buttonLabel).toBe(
        `Analyze all loaded approved cases (${count})`,
      );
      expect(durableSource).toContain("selectedIds.length > 1000");
      expect(durableSource).toContain(
        "Select at most 1,000 cases. Nothing has been truncated or",
      );
      expect(durableSource).toContain("ids: [...selectedIds]");
      expect(durableSource).not.toContain("selectedIds.slice");
    },
  );
  it("uses a stable separate caller instance and preserves current project binding", () => {
    const cases = approved(2),
      first = capture(all, cases, [], "project-a"),
      second = capture(all, cases, [], "project-a");
    expect(first.element.key).toBe("project-a:all-loaded-approved");
    expect(second.element.key).toBe(first.element.key);
    const other = capture(all, cases, [], "project-b");
    expect(other.element.key).toBe("project-b:all-loaded-approved");
    expect(other.element.props.projectId).toBe("project-b");
    expect(capture(filtered, cases, cases).element.key).toBeNull();
  });
  it("adds only an explicit scope caller after the filtered caller, with no scope reset or mutation invocation", () => {
    expect(all.pos).toBeGreaterThan(filtered.end);
    let parent: ts.Node | undefined = all.parent,
      projectGuarded = false;
    while (parent) {
      if (
        ts.isBinaryExpression(parent) &&
        parent.left.getText(ast) === "project"
      )
        projectGuarded = true;
      parent = parent.parent;
    }
    expect(projectGuarded).toBe(true);
    const calls: string[] = [];
    const visitCalls = (node: ts.Node) => {
      if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast));
      ts.forEachChild(node, visitCalls);
    };
    visitCalls(all);
    expect(calls.sort()).toEqual(
      [
        "cases.filter",
        "cases.filter",
        'cases.filter(testCase => !testCase.archived && testCase.reviewStatus === "APPROVED").map',
      ].sort(),
    );
    expect(all.getText(ast)).not.toMatch(
      /\b(?:mutate|fetch|setSelected|resetFilters|approve|allowCaseProcessing)\b|\.slice\b/,
    );
    expect(source).toContain("selectedIds={[...selected]}");
    for (const guard of [
      "reviewRequest ??",
      "approvalRequest ??",
      "allowCaseProcessing: true",
      "saved.balance >= saved.maximumCredits",
      "scopeMatches",
      "queueMatches",
      "Retry identical approval",
    ])
      expect(durableSource).toContain(guard);
  });
});
