import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { manualProcedurePhases } from "./manual-procedure-phases";
import { manualCaseHistoryAnchor } from "./case-observation-history-entry";

const source = readFileSync(
  new URL(
    "../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const ast = ts.createSourceFile(
  "manual-run.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const row = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "CaseRow",
);
const colors = ast.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(ast) === "STATUS_COLORS",
    ),
);
if (!row || !colors)
  throw Error("Actual manual row and status presentation required");
const printer = ts.createPrinter();
const code = ts.transpileModule(
  `${printer.printNode(ts.EmitHint.Unspecified, colors, ast)}\n${printer.printNode(ts.EmitHint.Unspecified, row, ast)}\nthis.row=CaseRow;`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
    },
  },
).outputText;
type Step = Readonly<{
  order: number;
  action: string;
  expectedActionOrData: string | null;
  expectedResult: string | null;
  expectedResponse: string | null;
  mediaAttachmentIds: readonly string[];
}>;
type Options = {
  stepMode?: boolean;
  recordedStep?: boolean;
  readable?: boolean;
  expanded?: boolean;
  hidden?: boolean;
  steps?: readonly Step[];
  labels?: Record<string, string>;
};
const defaultStep: Step = Object.freeze({
  order: 0,
  action: "  Click button\nthen observe  ",
  expectedActionOrData: "GET /synthetic\n  exact ",
  expectedResult: "",
  expectedResponse: null,
  mediaAttachmentIds: Object.freeze(["reference-one", "reference-one"]),
});
function render({
  stepMode = false,
  recordedStep = false,
  readable = true,
  expanded = true,
  hidden = false,
  steps = [defaultStep],
  labels = {},
}: Options = {}) {
  const testCase = {
    testCaseId: "synthetic-case",
    displayId: "SYN-01",
    title: "Frozen synthetic case",
    validationDomain: "SOFTWARE",
    background: null,
    verificationProfile: {
      setup: "",
      safety: "",
      instruments: "",
      acceptanceCriteria: "",
    },
    given: ["Saved Given"],
    when: ["Saved When"],
    then: ["Saved Then"],
    steps,
    currentResult: null,
    stepResults: recordedStep
      ? [{ stepIndex: 0, current: { status: "PASS" } }]
      : [],
  };
  const before = JSON.stringify(testCase),
    effect = vi.fn(),
    onMode = vi.fn(),
    onChanged = vi.fn(),
    onPending = vi.fn();
  let stateIndex = 0;
  const host = vm.createContext({
    React,
    manualProcedurePhases,
    manualCaseHistoryAnchor,
    // Render only the actual row. Native editors are intentionally not executed;
    // this fixture proves presentation, not their readers/writers or SDK effects.
    StepExecutionPanel: () => null,
    ManualCaseResultHistory: () => null,
    useState: (initial: unknown) => [
      stateIndex++ === 1
        ? stepMode
        : typeof initial === "function"
          ? (initial as () => unknown)()
          : initial,
      vi.fn(),
    ],
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: effect,
    useLayoutEffect: effect,
  });
  vm.runInContext(code, host);
  const component = (
    host as unknown as { row(props: unknown): React.ReactElement }
  ).row;
  const element = component({
    projectId: "synthetic-project",
    testRunId: "synthetic-run",
    testCase,
    stepFieldLabels: labels,
    disabled: false,
    runClosed: false,
    prerequisites: [],
    blockedBy: [],
    initiallyExpanded: expanded,
    readable,
    hidden,
    readScope: {
      projectId: "synthetic-project",
      expectedClerkActorId: "synthetic-clerk",
    },
    selectedFromHistory: false,
    navigationTarget: false,
    navigationRevision: 0,
    parentCurrent: () => true,
    parentActivation: "synthetic-activation",
    parentRunScope: null,
    onModeActive: onMode,
    onStepsChanged: onChanged,
    onUnconfirmedStep: onPending,
    onUnconfirmedWholeCase: onPending,
    onOpenCase: onMode,
  });
  const html = renderToStaticMarkup(element);
  expect(JSON.stringify(testCase)).toBe(before);
  expect(onMode).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
  expect(onPending).not.toHaveBeenCalled();
  return { html, element };
}
function table(html: string) {
  return html.match(/<table\b[\s\S]*?<\/table>/)?.[0] ?? null;
}
function cells(html: string) {
  return [...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(
    (match) => match[1],
  );
}

describe("actual manual run frozen procedure presentation, synthetic SSR only", () => {
  it("keeps the identical complete stored table in case, explicitly chosen step and already-recorded step modes", () => {
    const whole = render(),
      chosen = render({ stepMode: true }),
      recorded = render({ recordedStep: true });
    expect(table(whole.html)).not.toBeNull();
    expect(table(chosen.html)).toBe(table(whole.html));
    expect(table(recorded.html)).toBe(table(whole.html));
    for (const html of [chosen.html, recorded.html]) {
      expect(html).toContain(defaultStep.action);
      expect(html).toContain(defaultStep.expectedActionOrData!);
      expect(html).toContain("Not supplied");
      expect(html).toContain("<em>Empty text</em>");
      expect(html).not.toContain("Saved Given");
      expect(html).not.toContain("Saved When");
      expect(html).not.toContain("Saved Then");
      expect(html).not.toContain("Review an observation below");
    }
    expect(whole.html).toContain("Saved Given");
    expect(whole.html).toContain("Saved When");
    expect(whole.html).toContain("Saved Then");
    expect(whole.html).toContain("Review an observation below");
  });
  it.each([
    { readable: false, stepMode: false },
    { readable: false, stepMode: true },
    { expanded: false, stepMode: false },
    { expanded: false, stepMode: true },
  ])(
    "retains unreadable/collapsed admission without exposing procedure content: %s",
    (options) => {
      const html = render(options).html;
      expect(table(html)).toBeNull();
      expect(html).not.toContain(defaultStep.action);
      expect(html).not.toContain(defaultStep.expectedActionOrData!);
      expect(html).not.toContain("reference-one");
    },
  );
  it("preserves existing filtered-row hidden admission rather than activating a hidden editor", () => {
    const { html, element } = render({ hidden: true, stepMode: true });
    expect(element.props).toMatchObject({
      hidden: true,
      style: { display: "none" },
    });
    expect(html).toMatch(/^<div[^>]*hidden=""[^>]*style="[^"]*display:none/);
  });
  it("retains stored order, duplicated raw rows, literal null/empty/whitespace and media references without fetching", () => {
    const step = Object.freeze({
      ...defaultStep,
      order: 7,
      action: "Repeated literal action",
      expectedResult: " \n ",
      expectedResponse: "  HTTP 200\n{} ",
      mediaAttachmentIds: Object.freeze(["same-reference", "same-reference"]),
    });
    const html = render({
        stepMode: true,
        steps: Object.freeze([step, step]),
      }).html,
      value = table(html)!;
    expect(cells(value)).toEqual([
      "7",
      step.action,
      step.expectedActionOrData,
      step.expectedResult,
      step.expectedResponse,
      '<ul><li style="overflow-wrap:anywhere">same-reference</li><li style="overflow-wrap:anywhere">same-reference</li></ul>',
      "7",
      step.action,
      step.expectedActionOrData,
      step.expectedResult,
      step.expectedResponse,
      '<ul><li style="overflow-wrap:anywhere">same-reference</li><li style="overflow-wrap:anywhere">same-reference</li></ul>',
    ]);
    expect(value).toContain("white-space:pre-wrap");
    expect(value).toContain("overflow-wrap:anywhere");
    expect(value).toContain("references, not fetched or verified files");
    expect(value).not.toMatch(/<img|href=|src=/);
  });
  it("uses existing custom column labels and escapes literal markup without clipping long multiline text", () => {
    const text =
        "Exact long content ".repeat(200) +
        '\n<script>literal</script> <img onerror="literal">',
      labels = {
        action: "Tester gesture",
        expectedActionOrData: "Engine API",
        expectedResult: "",
        expectedResponse: "Network\nreply",
      };
    const html = table(
      render({
        recordedStep: true,
        labels,
        steps: [{ ...defaultStep, action: text }],
      }).html,
    )!;
    expect(html).toContain("Tester gesture");
    expect(html).toContain("Engine API");
    expect(html).toContain("Network\nreply");
    expect(html).toContain("Exact long content ".repeat(200));
    expect(html).toContain("\n&lt;script&gt;literal&lt;/script&gt;");
    expect(html).not.toMatch(
      /<script|<img|<[^>]*\sonerror=|line-clamp|text-overflow/,
    );
    expect(html).toContain('<th style="text-align:left;font-size:11px"></th>');
  });
  it("does not invent a structured table for cases with no stored steps", () => {
    expect(table(render({ stepMode: true, steps: [] }).html)).toBeNull();
    expect(table(render({ steps: [] }).html)).toBeNull();
  });
});
