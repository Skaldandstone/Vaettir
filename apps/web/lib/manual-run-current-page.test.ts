import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  resolveQualityExperience,
  renderBoundedSpreadsheetCsv,
} from "@vaettir/core";
import {
  ManualRunCurrentRenderGuard,
  admitManualRunCurrent,
  manualRunCurrentBrowserKey,
  type ManualRunCurrentSnapshot,
  type ManualRunCurrentInput,
} from "./manual-run-current-reader";
import {
  retainManualRunRows,
  type ManualRunRowRetention,
} from "./manual-run-row-retention";
import { admittedManualRunProgress } from "./manual-run-scope-availability";
import {
  manualCaseHistoryAnchor,
  manualCaseHistorySelection,
} from "./case-observation-history-entry";
import {
  manualRunCaseMatches,
  nextUntestedManualCase,
} from "./manual-run-navigator";
import { manualProcedurePhases } from "./manual-procedure-phases";
import { currentSessionScope } from "./auth-query-cache";
import { renderCurrentManualRunRecordJson } from "./manual-run-record-export";
import { renderCurrentManualRunPortableHtml } from "./manual-run-portable-report";
import { StepReviewCompletionController } from "./step-execution-review-completion";
import {
  decodeStepReviewWire,
  stepReviewRequestHash,
  type StepReviewBuffer,
} from "./step-execution-review-draft";
import type { ReviewedStepWriteInput } from "@vaettir/api/src/services/manualStepExecutionReviewSchema";

type ViewNode = {
  type: unknown;
  key: string | null;
  props: Record<string, unknown>;
};
const fragment = Symbol("synthetic fragment");
function element(
  type: unknown,
  config: Record<string, unknown> | null,
  ...children: unknown[]
): ViewNode {
  const { key = null, ...props } = config ?? {};
  return {
    type,
    key: key === null ? null : String(key),
    props: { ...props, children },
  };
}
function nodes(value: unknown): ViewNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as ViewNode;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value === null || value === undefined || typeof value === "boolean")
    return "";
  if (typeof value === "object" && "props" in value)
    return text((value as ViewNode).props.children);
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
const sourcePath =
  "../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx";
function functionSource(path: string, selected: readonly string[]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8"),
    ast = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  const statements = ast.statements.filter(
    (statement) =>
      (ts.isFunctionDeclaration(statement) &&
        selected.includes(statement.name?.text ?? "")) ||
      (ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (declaration) => declaration.name.getText(ast) === "STATUS_COLORS",
        )),
  );
  if (
    !selected.every((name) =>
      statements.some(
        (statement) =>
          ts.isFunctionDeclaration(statement) && statement.name?.text === name,
      ),
    )
  )
    throw Error(
      "Actual source component missing; no alternate implementation used.",
    );
  return statements
    .map((statement) => statement.getText(ast).replace(/^export\s+/, ""))
    .join("\n");
}
function load(
  path: string,
  selected: readonly string[],
  bindings: Record<string, unknown>,
) {
  const js = ts.transpileModule(
    `${functionSource(path, selected)}\nreturn {${selected.join(",")}};`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
        jsx: ts.JsxEmit.React,
        jsxFactory: "element",
        jsxFragmentFactory: "fragment",
      },
    },
  ).outputText;
  return new Function(...Object.keys(bindings), js)(
    ...Object.values(bindings),
  ) as Record<string, (props?: Record<string, unknown>) => ViewNode>;
}
const snapshotFactory = load(
  "./manual-run-row-retention.test.ts",
  ["snapshot"],
  { randomUUID, expect, admitManualRunCurrent, manualRunCurrentBrowserKey },
).snapshot! as unknown as (options?: {
  missing?: string[];
  title?: string;
  origin?: ManualRunCurrentSnapshot["origin"];
}) => ManualRunCurrentSnapshot;
function syntheticSnapshot(
  options: {
    missing?: string[];
    untested?: boolean;
    writable?: boolean;
    title?: string;
    nativeActorId?: string;
    frozen?: boolean;
  } = {},
) {
  const base = snapshotFactory({
      ...options,
      ...(options.nativeActorId
        ? {
            origin: {
              projectId: "p",
              testRunId: "run",
              organizationId: "o",
              clerkActorId: "cl",
              nativeActorId: options.nativeActorId,
            },
          }
        : {}),
    }),
    raw = structuredClone(base.data);
  raw.view.canWrite = options.writable ?? true;
  if (options.untested)
    for (const row of raw.view.cases) row.currentResult = null;
  if (options.frozen) {
    raw.view.executionContext = {
      version: 1, experience: null, profileHash: "a".repeat(64),
      configuration: { configuration: "", platform: "", build: "", hardwareRevision: "", firmwareVersion: "", rig: "", batchOrLot: "", environment: "", calibrationReference: "", protocolReference: "" },
      stepFieldLabels: { ...raw.view.stepFieldLabels },
      caseDefinitions: raw.view.cases.map(row => ({ testCaseId: row.testCaseId, title: row.title, validationDomain: row.validationDomain,
        reviewStatus: "APPROVED", background: row.background, given: row.given, when: row.when, then: row.then,
        verificationProfile: row.verificationProfile, steps: row.steps })),
    };
    raw.view.scopeAvailability.procedureBasis = "FROZEN_RUN_DEFINITIONS";
    raw.provenance.procedures = "FROZEN_RUN_DEFINITIONS";
    for (const row of raw.view.cases) row.stepExecutionAvailable = true;
  }
  const input = JSON.parse(
    raw.readContext.requestedKey,
  ) as ManualRunCurrentInput;
  const admitted = admitManualRunCurrent(raw, input, base.origin)!;
  expect(admitted).not.toBeNull();
  return Object.freeze({
    ...base,
    origin: admitted.origin,
    data: admitted.data,
  });
}

type Slot = {
  value?: unknown;
  dependencies?: readonly unknown[];
  cleanup?: () => void;
};
function runtime() {
  const slots: Slot[] = [];
  let cursor = 0,
    dirty = false;
  let layout: {
      slot: Slot;
      dependencies: readonly unknown[];
      callback: () => unknown;
    }[] = [],
    effects: typeof layout = [];
  const equal = (a: readonly unknown[] | undefined, b: readonly unknown[]) =>
    !!a &&
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
  const useState = (initial: unknown) => {
    const index = cursor++;
    if (!slots[index])
      slots[index] = {
        value: typeof initial === "function" ? initial() : initial,
      };
    const slot = slots[index]!;
    return [
      slot.value,
      (action: unknown) => {
        const next = typeof action === "function" ? action(slot.value) : action;
        if (!Object.is(slot.value, next)) {
          slot.value = next;
          dirty = true;
        }
      },
    ];
  };
  const useRef = (initial: unknown) => {
    const index = cursor++;
    slots[index] ??= { value: { current: initial } };
    return slots[index]!.value;
  };
  const useMemo = (
    callback: () => unknown,
    dependencies: readonly unknown[],
  ) => {
    const index = cursor++;
    const slot = slots[index];
    if (!slot || !equal(slot.dependencies, dependencies))
      slots[index] = { value: callback(), dependencies: [...dependencies] };
    return slots[index]!.value;
  };
  const schedule = (
    queue: typeof layout,
    callback: () => unknown,
    dependencies: readonly unknown[],
  ) => {
    const index = cursor++;
    const slot = (slots[index] ??= {});
    if (!equal(slot.dependencies, dependencies))
      queue.push({ slot, callback, dependencies });
  };
  const hooks = {
    useState,
    useRef,
    useMemo,
    useLayoutEffect: (
      callback: () => unknown,
      dependencies: readonly unknown[],
    ) => schedule(layout, callback, dependencies),
    useEffect: (callback: () => unknown, dependencies: readonly unknown[]) =>
      schedule(effects, callback, dependencies),
  };
  function flush(queue: typeof layout) {
    for (const item of queue) {
      item.slot.cleanup?.();
      item.slot.dependencies = [...item.dependencies];
      const cleanup = item.callback();
      item.slot.cleanup =
        typeof cleanup === "function" ? (cleanup as () => void) : undefined;
    }
  }
  function render(callback: () => ViewNode, commit = true) {
    let tree: ViewNode,
      passes = 0;
    do {
      cursor = 0;
      dirty = false;
      layout = [];
      effects = [];
      tree = callback();
      if (++passes > 12)
        throw Error(
          "Actual page/component did not stabilize; no render loop waived.",
        );
      if (dirty) continue;
      if (commit) {
        flush(layout);
        flush(effects);
      }
    } while (dirty);
    return { tree: tree!, passes };
  }
  return { hooks, render };
}
function harness() {
  const pageRuntime = runtime();
  const state = {
    candidate: syntheticSnapshot({
      untested: true,
    }) as ManualRunCurrentSnapshot | null,
    held: null as ManualRunCurrentSnapshot | null,
    retained: null as ManualRunRowRetention | null,
    pending: false,
    beforeConfirm: null as (() => void) | null,
    afterSerialize: null as (() => void) | null,
    historyCaseIds: [] as string[],
  };
  state.held = state.candidate;
  const push = vi.fn(),
    refresh = vi.fn(),
    accessRefresh = vi.fn(async () => undefined),
    mutate = vi.fn(),
    download = vi.fn(),
    confirm = vi.fn(() => {
      state.beforeConfirm?.();
      return true;
    });
  const useReader = () => ({
    snapshot: state.candidate,
    current: () => state.held,
    refresh,
    error: state.candidate ? null : "Current native reader unavailable.",
  });
  const useRows = () => {
    const value = retainManualRunRows(state.retained, state.candidate);
    state.retained = value.retained;
    return value;
  };
  const StepExecutionPanel = () => null,
    ManualCaseResultHistory = () => null,
    ManualRetestActions = () => null,
    RunExecutionSummary = () => null;
  const bindings = {
    ...pageRuntime.hooks,
    element,
    fragment,
    useParams: () => ({ projectId: "p", testRunId: "run" }),
    useRouter: () => ({ push }),
    useSearchParams: () => ({ getAll: (key: string) => key === "caseId" ? state.historyCaseIds : [] }),
    useManualExecutionAccess: () => ({
      origin: { organizationId: "o", clerkActorId: "cl" },
      ready: true,
      canWrite: true,
      denied: false,
      refresh: accessRefresh,
    }),
    useManualRunCurrentReader: useReader,
    useRetainedManualRunRows: useRows,
    ManualRunCurrentRenderGuard,
    trpcReact: {
      manualExecution: {
        complete: { useMutation: () => ({ isPending: state.pending, mutate }) },
      },
    },
    StepExecutionPanel,
    ManualCaseResultHistory,
    ManualRetestActions,
    RunExecutionSummary,
    admittedManualRunProgress,
    manualCaseHistoryAnchor,
    manualCaseHistorySelection,
    manualRunCaseMatches,
    nextUntestedManualCase,
    manualProcedurePhases,
    resolveQualityExperience,
    currentSessionScope,
    window: {
      Clerk: { loaded: true, session: { id: "session-A", user: { id: "cl" } } },
    },
    document: { getElementById: vi.fn(() => null) },
    crypto: { randomUUID },
    confirm,
  };
  const actual = load(
    sourcePath,
    ["ManualExecutionContent", "CaseRow"],
    bindings,
  );
  function render(commit = true) {
    return pageRuntime.render(() => actual.ManualExecutionContent!(), commit);
  }
  function row(node: ViewNode) {
    const childRuntime = runtime(),
      child = load(sourcePath, ["CaseRow"], {
        ...bindings,
        ...childRuntime.hooks,
      });
    return {
      render: (props = node.props, commit = true) =>
        childRuntime.render(() => child.CaseRow!(props), commit),
    };
  }
  function summary(node: ViewNode) {
    const childRuntime = runtime();
    const serializer =
      <T extends (...args: never[]) => unknown>(fn: T) =>
      (...args: Parameters<T>) => {
        const value = fn(...args);
        state.afterSerialize?.();
        return value;
      };
    const component = load(
      "../components/RunExecutionSummary.tsx",
      ["RunExecutionSummary"],
      {
        ...childRuntime.hooks,
        element,
        fragment,
        DistributionBar: () => null,
        renderBoundedSpreadsheetCsv: serializer(renderBoundedSpreadsheetCsv),
        renderCurrentManualRunRecordJson: serializer(
          renderCurrentManualRunRecordJson,
        ),
        renderCurrentManualRunPortableHtml: serializer(
          renderCurrentManualRunPortableHtml,
        ),
        downloadFile: download,
      },
    );
    return childRuntime.render(() => component.RunExecutionSummary!(node.props))
      .tree;
  }
  return {
    state,
    push,
    refresh,
    mutate,
    download,
    confirm,
    render,
    row,
    summary,
    actual,
    types: {
      RunExecutionSummary,
      CaseRow: actual.CaseRow,
      StepExecutionPanel,
      ManualCaseResultHistory,
    },
  };
}
function component(tree: ViewNode, type: unknown) {
  const found = nodes(tree).find((node) => node.type === type);
  expect(found).toBeDefined();
  return found!;
}
function button(tree: ViewNode, title: string) {
  const found = nodes(tree).find(
    (node) => node.type === "button" && text(node.props.children) === title,
  );
  expect(found).toBeDefined();
  return found!;
}
function click(node: ViewNode) {
  (node.props.onClick as () => void)();
}

describe("actual manual page/CaseRow/summary synthetic boundaries; native/React DOM/SDK NOT proved", () => {
  it("current published rows use exact stable keys, private procedure text and full current scope", () => {
    const h = harness(),
      output = h.render();
    expect(output.passes).toBeLessThanOrEqual(4);
    const rows = nodes(output.tree).filter(
      (node) => node.type === h.types.CaseRow,
    );
    expect(rows.map((row) => row.key)).toEqual(["p:run:first", "p:run:second"]);
    const summary = component(output.tree, h.types.RunExecutionSummary);
    expect((summary.props.cases as unknown[]).length).toBe(2);
    expect(summary.props.plannedScope).toMatchObject({
      plannedCount: 2,
      availableCount: 2,
    });
    expect(text(h.row(rows[0]!).render().tree)).toContain(" exact \n action ");
  });
  it("missing private row stays keyed/mounted but is hidden and excluded from current summary", () => {
    const h = harness();
    const original = h.render().tree,
      oldRows = nodes(original).filter((node) => node.type === h.types.CaseRow),
      saved = (oldRows[0]!.props.testCase as { title: string }).title;
    h.state.candidate = syntheticSnapshot({
      missing: ["first"],
      title: "new current",
    });
    h.state.held = h.state.candidate;
    const output = h.render().tree,
      rows = nodes(output).filter((node) => node.type === h.types.CaseRow),
      absent = rows[0]!;
    expect(rows.map((row) => row.key)).toEqual(oldRows.map((row) => row.key));
    expect(absent.props.hidden).toBe(true);
    expect(absent.props.readable).toBe(false);
    expect((absent.props.parentCurrent as () => boolean)()).toBe(false);
    expect((absent.props.testCase as { title: string }).title).toBe(saved);
    expect(text(h.row(absent).render().tree)).not.toContain(saved);
    const summary = component(output, h.types.RunExecutionSummary);
    expect(
      (summary.props.cases as { testCaseId: string }[]).map(
        (row) => row.testCaseId,
      ),
    ).toEqual(["second"]);
    expect(summary.props.plannedScope).toMatchObject({
      plannedCount: 2,
      availableCount: 1,
      unavailableCaseIds: ["first"],
    });
    expect(
      button(h.summary(summary), "Export current outcomes · CSV").props
        .disabled,
    ).toBe(true);
  });
  it("denied native boundary preserves private row keys but exposes no current summary/facts", () => {
    const h = harness(),
      before = h.render().tree;
    h.state.candidate = null;
    h.state.held = null;
    const after = h.render().tree;
    expect(
      nodes(after)
        .filter((node) => node.type === h.types.CaseRow)
        .map((node) => node.key),
    ).toEqual(
      nodes(before)
        .filter((node) => node.type === h.types.CaseRow)
        .map((node) => node.key),
    );
    expect(
      nodes(after).some((node) => node.type === h.types.RunExecutionSummary),
    ).toBe(false);
    for (const row of nodes(after).filter(
      (node) => node.type === h.types.CaseRow,
    ))
      expect(row.props).toMatchObject({
        hidden: true,
        readable: false,
        disabled: true,
      });
  });
  it("retained actual CaseRow intent and pending flags survive denied props and restore with the same key", () => {
    const h = harness(),
      originalPage = h.render().tree,
      originalNode = component(originalPage, h.types.CaseRow),
      row = h.row(originalNode);
    click(button(row.render().tree, "Pass"));
    let rowTree = row.render().tree;
    const history = component(rowTree, h.types.ManualCaseResultHistory),
      seed = history.props.reviewIntent;
    expect(seed).toMatchObject({ status: "PASS", note: null });
    (history.props.onUnconfirmedChange as (pending: boolean) => void)(true);
    rowTree = row.render().tree;
    expect(component(rowTree, h.types.StepExecutionPanel).props.disabled).toBe(
      true,
    );
    h.state.candidate = null;
    h.state.held = null;
    const deniedNode = component(h.render().tree, h.types.CaseRow);
    expect(deniedNode.key).toBe(originalNode.key);
    const denied = row.render(deniedNode.props).tree;
    expect(
      component(denied, h.types.ManualCaseResultHistory).props.reviewIntent,
    ).toBe(seed);
    expect(
      component(denied, h.types.ManualCaseResultHistory).props.active,
    ).toBe(false);
    h.state.candidate = syntheticSnapshot({
      untested: true,
      title: "restored",
    });
    h.state.held = h.state.candidate;
    const restoredNode = component(h.render().tree, h.types.CaseRow);
    expect(restoredNode.key).toBe(originalNode.key);
    const restored = row.render(restoredNode.props).tree;
    expect(
      component(restored, h.types.ManualCaseResultHistory).props.reviewIntent,
    ).toBe(seed);
    expect(component(restored, h.types.StepExecutionPanel).props.disabled).toBe(
      true,
    );
    expect(h.mutate).not.toHaveBeenCalled();
  });
  it("native remap refusal preserves hidden original keys instead of publishing replacement facts", () => {
    const h = harness(),
      before = h.render().tree;
    h.state.candidate = syntheticSnapshot({
      nativeActorId: "replacement",
      title: "replacement private title",
    });
    h.state.held = h.state.candidate;
    const after = h.render().tree;
    expect(
      nodes(after)
        .filter((node) => node.type === h.types.CaseRow)
        .map((node) => node.key),
    ).toEqual(
      nodes(before)
        .filter((node) => node.type === h.types.CaseRow)
        .map((node) => node.key),
    );
    expect(
      nodes(after).some((node) => node.type === h.types.RunExecutionSummary),
    ).toBe(false);
    expect(text(after)).not.toContain("replacement private title");
  });
  it("modeled cache A-B-A remains withheld until a fresh native boundary snapshot, not raw cache restoration", () => {
    const h = harness(),
      before = h.render().tree,
      original = h.state.candidate;
    h.state.held = null;
    const oldExport = component(before, h.types.RunExecutionSummary).props
      .canExport as () => boolean;
    expect(oldExport()).toBe(false);
    h.state.candidate = null;
    h.render();
    h.state.candidate = original;
    h.render();
    expect(oldExport()).toBe(false);
    h.state.candidate = syntheticSnapshot({ untested: true });
    h.state.held = h.state.candidate;
    expect(
      (
        component(h.render().tree, h.types.RunExecutionSummary).props
          .canExport as () => boolean
      )(),
    ).toBe(true);
  });
  it("synthetic readonly current view displays procedures but disables intent/completion without upgrading its authority", () => {
    const h = harness();
    h.state.candidate = syntheticSnapshot({ writable: false, untested: true });
    h.state.held = h.state.candidate;
    const tree = h.render().tree;
    expect(button(tree, "Complete run").props.disabled).toBe(true);
    const row = h.row(component(tree, h.types.CaseRow)),
      rendered = row.render().tree;
    expect(text(rendered)).toContain(" exact \n action ");
    expect(button(rendered, "Pass").props.disabled).toBe(true);
    click(button(rendered, "Pass"));
    expect(
      component(row.render().tree, h.types.ManualCaseResultHistory).props
        .reviewIntent,
    ).toBeNull();
    expect(h.mutate).not.toHaveBeenCalled();
  });
  it("speculative page render cannot publish navigation/export until layout posts its exact stamp", () => {
    const h = harness(),
      speculative = h.render(false).tree;
    expect(
      nodes(speculative).some(
        (node) => node.type === h.types.RunExecutionSummary,
      ),
    ).toBe(false);
    const current = h.render().tree;
    expect(
      (
        component(current, h.types.RunExecutionSummary).props
          .canExport as () => boolean
      )(),
    ).toBe(true);
  });
  it("old captured navigation/heading/outcome/export guard fail after exact native snapshot changes", () => {
    const h = harness(),
      firstTree = h.render().tree,
      summary = component(firstTree, h.types.RunExecutionSummary),
      rowNode = component(firstTree, h.types.CaseRow),
      row = h.row(rowNode),
      rowTree = row.render().tree;
    const oldNext = button(firstTree, "Next untested case"),
      oldPass = button(rowTree, "Pass"),
      heading = nodes(rowTree).find(
        (node) =>
          node.type === "button" && node.props["aria-expanded"] !== undefined,
      )!;
    h.state.candidate = syntheticSnapshot({
      untested: true,
      title: "replacement",
    });
    h.state.held = h.state.candidate;
    h.render();
    click(oldNext);
    click(heading);
    click(oldPass);
    expect((summary.props.canExport as () => boolean)()).toBe(false);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.mutate).not.toHaveBeenCalled();
    expect(
      component(row.render().tree, h.types.ManualCaseResultHistory).props
        .reviewIntent,
    ).toBeNull();
  });
  it("local page-frame change invalidates old captured handlers even for the same native snapshot", () => {
    const h = harness(),
      tree = h.render().tree,
      summary = component(tree, h.types.RunExecutionSummary),
      next = button(tree, "Next untested case");
    const input = nodes(tree).find(
      (node) =>
        node.type === "input" &&
        node.props.placeholder === "Search case ID or title",
    )!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "second" },
    });
    h.render();
    click(next);
    expect((summary.props.canExport as () => boolean)()).toBe(false);
  });
  it("Next untested advances from the verified history-selected second case and wraps inside the exact saved cohort", () => {
    const h = harness(); h.state.candidate = syntheticSnapshot({ untested: true, frozen: true }); h.state.held = h.state.candidate; h.state.historyCaseIds = ["second"];
    const before = h.render().tree, native = h.state.held, original = structuredClone(native!.data);
    const rows = nodes(before).filter(node => node.type === h.types.CaseRow);
    expect(rows.find(node => (node.props.testCase as { testCaseId: string }).testCaseId === "second")!.props.selectedFromHistory).toBe(true);
    expect(rows.every(node => !node.props.navigationTarget)).toBe(true);
    click(button(before, "Next untested case"));
    const after = h.render().tree, targets = nodes(after).filter(node => node.type === h.types.CaseRow && node.props.navigationTarget);
    expect(targets.map(node => (node.props.testCase as { testCaseId: string }).testCaseId)).toEqual(["first"]);
    expect(text(after)).toContain("Opened the next untested case");
    expect(h.state.held).toBe(native); expect(h.state.held!.data).toEqual(original);
    expect(h.mutate).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled(); expect(h.push).not.toHaveBeenCalled(); expect(h.download).not.toHaveBeenCalled();
  });
  it("an explicit navigation cursor takes priority over a verified history selection", () => {
    const h = harness(); h.state.candidate = syntheticSnapshot({ untested: true, frozen: true }); h.state.held = h.state.candidate; h.state.historyCaseIds = ["first"];
    const before = h.render().tree, second = nodes(before).find(node => node.type === h.types.CaseRow && (node.props.testCase as { testCaseId: string }).testCaseId === "second")!;
    (second.props.onOpenCase as (id: string) => void)("second");
    const explicit = h.render().tree;
    expect(nodes(explicit).filter(node => node.type === h.types.CaseRow && node.props.navigationTarget).map(node => (node.props.testCase as { testCaseId: string }).testCaseId)).toEqual(["second"]);
    click(button(explicit, "Next untested case"));
    expect(nodes(h.render().tree).filter(node => node.type === h.types.CaseRow && node.props.navigationTarget).map(node => (node.props.testCase as { testCaseId: string }).testCaseId)).toEqual(["first"]);
    expect(h.mutate).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled();
  });
  it.each([
    { label: "none", ids: [] },
    { label: "unavailable", ids: ["missing"] },
    { label: "duplicate", ids: ["second", "second"] },
    { label: "competing", ids: ["first", "second"] },
    { label: "unsupported", ids: ["bad\u0000identity"] },
  ])("$label history intent never becomes a navigation cursor or substitutes another procedure", ({ ids }) => {
    const h = harness(); h.state.candidate = syntheticSnapshot({ untested: true, frozen: true }); h.state.held = h.state.candidate; h.state.historyCaseIds = ids;
    const before = h.render().tree;
    expect(nodes(before).filter(node => node.type === h.types.CaseRow).every(node => node.props.selectedFromHistory === false)).toBe(true);
    if (ids.length) expect(text(before)).toContain("exact requested case is not uniquely present");
    click(button(before, "Next untested case"));
    const targets = nodes(h.render().tree).filter(node => node.type === h.types.CaseRow && node.props.navigationTarget);
    expect(targets.map(node => (node.props.testCase as { testCaseId: string }).testCaseId)).toEqual(["second"]);
    expect(h.mutate).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled(); expect(h.push).not.toHaveBeenCalled();
  });
  it("loss of current native scope retires an old history-based Next callback without changing retained rows", () => {
    const h = harness(); h.state.candidate = syntheticSnapshot({ untested: true, frozen: true }); h.state.held = h.state.candidate; h.state.historyCaseIds = ["second"];
    const before = h.render().tree, next = button(before, "Next untested case"), original = h.state.held;
    h.state.candidate = null; h.state.held = null; const denied = h.render().tree;
    click(next); const retained = h.render().tree;
    expect(nodes(denied).filter(node => node.type === h.types.CaseRow).every(node => node.props.hidden === true)).toBe(true);
    expect(nodes(retained).filter(node => node.type === h.types.CaseRow && node.props.navigationTarget)).toEqual([]);
    expect(h.state.retained?.rows.map(row => row.testCaseId)).toEqual(original!.data.view.cases.map(row => row.testCaseId));
    expect(h.mutate).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled(); expect(h.push).not.toHaveBeenCalled(); expect(h.download).not.toHaveBeenCalled();
  });
  it("repeated identical step pending membership does not churn page activation or loop", () => {
    const h = harness(),
      first = h.render().tree,
      row = component(first, h.types.CaseRow),
      summary = component(first, h.types.RunExecutionSummary),
      activation = row.props.parentActivation;
    (row.props.onUnconfirmedStep as (pending: boolean) => void)(false);
    const same = h.render();
    expect(same.passes).toBe(1);
    expect(component(same.tree, h.types.CaseRow).props.parentActivation).toBe(
      activation,
    );
    expect((summary.props.canExport as () => boolean)()).toBe(true);
    (
      component(same.tree, h.types.CaseRow).props.onUnconfirmedStep as (
        pending: boolean,
      ) => void
    )(true);
    // A pending notification blocks completion synchronously, but must not
    // revoke its own native presentation/submit authority before an RPC/ACK.
    click(button(first, "Complete run"));
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.mutate).not.toHaveBeenCalled();
    expect((summary.props.canExport as () => boolean)()).toBe(true);
    const pending = h.render().tree,
      pendingRow = component(pending, h.types.CaseRow),
      pendingActivation = pendingRow.props.parentActivation,
      pendingSummary = component(pending, h.types.RunExecutionSummary);
    (pendingRow.props.onUnconfirmedStep as (value: boolean) => void)(true);
    const repeated = h.render();
    expect(repeated.passes).toBe(1);
    expect(
      component(repeated.tree, h.types.CaseRow).props.parentActivation,
    ).toBe(pendingActivation);
    expect((pendingSummary.props.canExport as () => boolean)()).toBe(true);
    expect(pendingActivation).toBe(activation);
    expect((summary.props.canExport as () => boolean)()).toBe(true);
  });
  it("actual step completion controller dispatches one exact request and settles ACK through real page pending callbacks without self-revocation", async () => {
    const h = harness(),
      tree = h.render().tree,
      row = component(tree, h.types.CaseRow);
    const parentCurrent = row.props.parentCurrent as () => boolean,
      parentActivation = row.props.parentActivation as string;
    const onPending = row.props.onUnconfirmedStep as (value: boolean) => void;
    const scope = {
      projectId: "p",
      organizationId: "o",
      actorId: "n",
      actorClerkUserId: "cl",
    };
    const fresh = decodeStepReviewWire({
      projectId: "p",
      testRunId: "run",
      testCaseId: "first",
      stepIndex: 0,
      readRequestId: randomUUID(),
      scope,
      canRecover: true,
      canRecord: true,
      supported: true,
      blockedReason: null,
      frozenDefinition: {
        testCaseId: "first",
        steps: (row.props.testCase as { steps: unknown[] }).steps,
      },
      current: null,
      rawCurrent: null,
      procedureHash: "a".repeat(64),
      currentFingerprint: "b".repeat(64),
      provenance: "CURRENT_AUTHORITY_LEGACY_ORIGINAL_TENANCY_UNRECORDED",
    });
    const controller = new StepReviewCompletionController(
      { projectId: "p", testRunId: "run", testCaseId: "first" },
      () => undefined,
      () => ({ userId: "cl", sessionId: "session-A" }),
    );
    controller.attach();
    controller.bindFrame({
      visible: true,
      readOnly: false,
      activation: fresh.readRequestId,
      observedSessionId: "session-A",
      observedSdkGeneration: controller.sessionGeneration(),
      fresh,
      parentCurrent,
      parentActivation,
    });
    const buffer: StepReviewBuffer = {
      status: "PASS",
      note: " exact \n step ",
      context: {
        specimen: "",
        hardwareRevision: "",
        firmwareVersion: "",
        environment: "",
      },
      readings: [
        {
          name: "Voltage",
          value: "0",
          unit: "V",
          lowerLimit: "",
          upperLimit: "",
          instrument: "Meter\n retained",
        },
      ],
      evidenceAttachmentIds: [],
      correctionReason: null,
    };
    let view = controller.snapshot();
    expect(controller.change(buffer, view.epoch, null)).toBe(true);
    view = controller.snapshot();
    expect(controller.reviewCurrent(view.epoch, view.draft!.identity)).toBe(
      true,
    );
    const record = vi.fn(async (input: Readonly<ReviewedStepWriteInput>) => {
      expect(parentCurrent()).toBe(true);
      return {
        projectId: input.projectId,
        testRunId: input.testRunId,
        testCaseId: input.testCaseId,
        stepIndex: input.stepIndex,
        scope,
        idempotencyKey: input.idempotencyKey,
        requestHash: await stepReviewRequestHash(input),
        revisionId: "step-revision",
        caseStatus: null,
        recovered: false,
        provenance: "REVIEWED_REQUEST_BOUND_AT_WRITE",
      };
    });
    const acknowledged = vi.fn(),
      notifications: boolean[] = [];
    await controller.submit(
      controller.snapshot().epoch,
      record,
      acknowledged,
      (pending) => {
        notifications.push(pending);
        onPending(pending);
        if (pending) {
          click(button(tree, "Complete run"));
          expect(h.mutate).not.toHaveBeenCalled();
          expect(h.confirm).not.toHaveBeenCalled();
        }
        expect(parentCurrent()).toBe(true);
        const rerender = h.render().tree;
        expect(
          component(rerender, h.types.CaseRow).props.parentActivation,
        ).toBe(parentActivation);
        expect(parentCurrent()).toBe(true);
      },
    );
    expect(record).toHaveBeenCalledOnce();
    expect(acknowledged).toHaveBeenCalledOnce();
    expect(notifications).toEqual([true, false]);
    const sent = record.mock.calls[0]![0];
    expect(sent.note).toBe(" exact \n step ");
    expect(sent.observations.measurements[0]).toMatchObject({
      value: 0,
      instrument: "Meter\n retained",
    });
    expect(controller.snapshot()).toMatchObject({
      busy: false,
      hasPending: false,
      acknowledgement: {
        idempotencyKey: sent.idempotencyKey,
        requestHash: await stepReviewRequestHash(sent),
        revisionId: "step-revision",
      },
    });
    expect(h.mutate).not.toHaveBeenCalled();
  });
  it("SDK/cache revocation is modeled ONLY at current-reader boundary and blocks captured actions synchronously", () => {
    const h = harness(),
      tree = h.render().tree,
      summary = component(tree, h.types.RunExecutionSummary);
    h.state.held = null;
    click(button(tree, "Open first match"));
    expect((summary.props.canExport as () => boolean)()).toBe(false);
    click(button(tree, "Complete run"));
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
  });
  it("confirm-time current-reader change prevents completion mutation after consent prompt", () => {
    const h = harness(),
      tree = h.render().tree;
    h.state.beforeConfirm = () => {
      h.state.held = null;
    };
    click(button(tree, "Complete run"));
    expect(h.confirm).toHaveBeenCalledOnce();
    expect(h.mutate).not.toHaveBeenCalled();
  });
  it("late legacy completion reply after native read changes cannot navigate or publish raw errors", () => {
    const h = harness(),
      tree = h.render().tree;
    click(button(tree, "Complete run"));
    expect(h.mutate).toHaveBeenCalledOnce();
    const callbacks = h.mutate.mock.calls[0]![1] as {
      onSuccess: () => void;
      onError: (error?: unknown) => void;
    };
    h.state.candidate = syntheticSnapshot({ title: "other current" });
    h.state.held = h.state.candidate;
    h.render();
    callbacks.onSuccess();
    callbacks.onError(Error("private error"));
    expect(h.push).not.toHaveBeenCalled();
    expect(text(h.render().tree)).not.toContain("private error");
  });
  it.each([
    "Export current outcomes · CSV",
    "Export procedures and current record · JSON",
    "Export printable report · HTML",
  ])(
    "old captured %s action cannot serialize/download after revocation",
    (label) => {
      const h = harness(),
        tree = h.render().tree,
        summaryTree = h.summary(component(tree, h.types.RunExecutionSummary)),
        action = button(summaryTree, label);
      h.state.held = null;
      click(action);
      expect(h.download).not.toHaveBeenCalled();
    },
  );
  it.each([
    "Export current outcomes · CSV",
    "Export procedures and current record · JSON",
    "Export printable report · HTML",
  ])(
    "actual summary %s checks current parent frame again after real serialization",
    (label) => {
      const h = harness(),
        tree = h.render().tree,
        summary = h.summary(component(tree, h.types.RunExecutionSummary));
      h.state.afterSerialize = () => {
        h.state.held = null;
      };
      click(button(summary, label));
      expect(h.download).not.toHaveBeenCalled();
    },
  );
  it("current authorized CSV supplies full cases and final scope guard to mocked download boundary", () => {
    const h = harness(),
      initial = syntheticSnapshot({ untested: true }),
      raw = structuredClone(initial.data);
    raw.view.cases[0]!.title = "First fixture case";
    raw.view.cases[1]!.title = "Second fixture case";
    raw.view.cases[1]!.prerequisiteIds = ["first"];
    const input = JSON.parse(
        raw.readContext.requestedKey,
      ) as ManualRunCurrentInput,
      admitted = admitManualRunCurrent(raw, input, initial.origin)!;
    expect(admitted).not.toBeNull();
    h.state.candidate = Object.freeze({
      ...initial,
      origin: admitted.origin,
      data: admitted.data,
    });
    h.state.held = h.state.candidate;
    const first = h.render().tree,
      search = nodes(first).find(
        (node) =>
          node.type === "input" &&
          node.props.placeholder === "Search case ID or title",
      )!;
    (search.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "Second" },
    });
    const tree = h.render().tree,
      summary = h.summary(component(tree, h.types.RunExecutionSummary));
    click(button(summary, "Export current outcomes · CSV"));
    expect(h.download).toHaveBeenCalledOnce();
    expect(h.download.mock.calls[0]![0]).toBe("vaettir-run-run.csv");
    expect(typeof h.download.mock.calls[0]![3]).toBe("function");
    const content = h.download.mock.calls[0]![1] as string;
    expect(content).toContain("Case record ID");
    expect(content).toContain("First fixture case");
    expect(content).toContain("Second fixture case");
    expect(content).not.toContain("Unavailable");
    const records = content.trim().split(/\r?\n/).slice(1);
    expect(records).toHaveLength(2);
    expect(records[0]).toBe(
      '"run","first","first","First fixture case","SOFTWARE","UNTESTED","1",""',
    );
    expect(records[1]).toBe(
      '"run","second","second","Second fixture case","SOFTWARE","UNTESTED","1","first"',
    );
    expect(
      nodes(tree)
        .filter((node) => node.type === h.types.CaseRow)
        .find(
          (node) =>
            (node.props.testCase as { testCaseId: string }).testCaseId ===
            "first",
        )!.props.hidden,
    ).toBe(true);
  });
  it("source mounts real native reader/retention hook and stable retained cases without effect-driven retirement", () => {
    const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
    expect(source).toContain("useManualRunCurrentReader(");
    expect(source).toContain("useRetainedManualRunRows(reader.snapshot)");
    expect(source).toContain("rows.retained?.rows");
    expect(source).not.toContain("manualExecution.getForExecution.useQuery");
    expect(source).toContain("postedStamp.current === stamp");
    expect(source).toContain("reader.current() === snapshot");
  });
});
