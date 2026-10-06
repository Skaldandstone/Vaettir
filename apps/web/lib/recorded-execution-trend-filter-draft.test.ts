import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import {
  recordedExecutionTrendInput,
  recordedExecutionTrendKey,
  type RecordedExecutionTrendInput,
  type RecordedExecutionTrend,
} from "@vaettir/api/src/services/recordedExecutionTrendSchema";
import {
  defaultExecutionTrendDates,
  executionTrendPeriods,
  EXECUTION_OUTCOMES,
  EXECUTION_OUTCOME_COLORS,
  renderRecordedExecutionTrendCsv,
  renderRecordedExecutionTrendHtml,
} from "./recorded-execution-trend";
import {
  executionDatePresets,
  resolveExecutionDatePreset,
} from "./execution-date-presets";

// Actual component functions + installed React SSR + actual input/key/export
// helpers. Hook state/lifecycle and metadata/query/DOM boundaries are synthetic;
// this is not installed React concurrency, native authorization or RPC proof.
const source = readFileSync(
    new URL("../components/RecordedExecutionTrend.tsx", import.meta.url),
    "utf8",
  ),
  ast = ts.createSourceFile(
    "trend.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  ),
  functions = ast.statements
    .filter(ts.isFunctionDeclaration)
    .map((node) =>
      ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, node, ast)
        .replace(/\bexport\s+/, ""),
    )
    .join("\n"),
  code = ts.transpileModule(`${functions}\nthis.component=ExecutionTrend;`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
type Props = {
  children?: React.ReactNode;
  onClick?: () => void;
  onChange?: (event: { target: { value: string; checked: boolean } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
  type?: string;
  open?: boolean;
  label?: string;
  disabled?: boolean;
};
function elements(node: unknown): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function result(input: RecordedExecutionTrendInput): RecordedExecutionTrend {
  const counts = {
    runs: 1,
    results: 2,
    mapped: 1,
    unmatched: 1,
    unavailableMapping: 0,
    inProgressRuns: 0,
    finishedRecordedRuns: 1,
    completionUnavailableRuns: 0,
    inProgressResults: 0,
    timedResults: 1,
    missingDurations: 1,
    invalidDurations: 0,
    sumDurationMs: 10,
    outcomes: { PASS: 1, FAIL: 1, FLAKY: 0, SKIP: 0, BLOCKED: 0 },
  };
  return {
    projectId: input.projectId,
    organizationId: input.originalOrganizationId,
    clerkActorId: "actor",
    requestKey: recordedExecutionTrendKey(input),
    asOf: "2026-10-02T00:00:00.000Z",
    windowStart: `${input.start}T00:00:00.000Z`,
    windowEnd: `${input.end}T23:59:59.999Z`,
    scope: {
      start: input.start,
      end: input.end,
      ...(input.platform === undefined ? {} : { platform: input.platform }),
      ...(input.environment === undefined
        ? {}
        : { environment: input.environment }),
      ...(input.build === undefined ? {} : { build: input.build }),
    },
    totals: counts,
    days: [{ day: input.start, ...counts }],
    limitations: [
      "Synthetic current response; observations are not unique executions.",
    ],
  };
}
function harness() {
  let cursor = 0,
    dirty = false,
    tree: React.ReactElement,
    currentReadLost = false,
    projectReadLost = false,
    latestInput: RecordedExecutionTrendInput | null = null;
  const slots: unknown[] = [],
    dependencies: Array<readonly unknown[] | undefined> = [],
    effects: Array<() => void> = [],
    layouts: Array<() => void> = [],
    cache = new Map<string, RecordedExecutionTrend>(),
    requests = vi.fn(),
    refetch = vi.fn(),
    blobs: Blob[] = [],
    click = vi.fn(),
    create = vi.fn(() => ({ href: "", download: "", click, remove: vi.fn() }));
  function effect(
    callback: () => void,
    deps: readonly unknown[] | undefined,
    queue: Array<() => void>,
  ) {
    const at = cursor++,
      prior = dependencies[at];
    if (
      !deps ||
      !prior ||
      deps.length !== prior.length ||
      deps.some((value, index) => value !== prior[index])
    ) {
      dependencies[at] = deps;
      queue.push(callback);
    }
  }
  const query = {
    data: undefined as RecordedExecutionTrend | undefined,
    dataUpdatedAt: 0,
    error: null as Error | null,
    isFetching: false,
    isPaused: false,
    refetch,
  };
  const context = vm.createContext({
    React,
    Date,
    Blob,
    Object,
    fieldStyle: { width: "100%", boxSizing: "border-box" },
    useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "actor" }),
    useState: (initial: unknown) => {
      const at = cursor++;
      if (at >= slots.length)
        slots[at] = typeof initial === "function" ? initial() : initial;
      return [
        slots[at],
        (next: unknown) => {
          const value = typeof next === "function" ? next(slots[at]) : next;
          if (!Object.is(value, slots[at])) {
            slots[at] = value;
            dirty = true;
          }
        },
      ];
    },
    useRef: (initial: unknown) => {
      const at = cursor++;
      if (at >= slots.length) slots[at] = { current: initial };
      return slots[at];
    },
    useEffect: (callback: () => void, deps: readonly unknown[] | undefined) =>
      effect(callback, deps, effects),
    useLayoutEffect: (
      callback: () => void,
      deps: readonly unknown[] | undefined,
    ) => effect(callback, deps, layouts),
    trpcReact: {
      project: {
        byId: {
          useQuery: () => ({
            data: { id: "p", organizationId: "o" },
            error: null,
            isFetching: projectReadLost,
            isPaused: false,
          }),
        },
      },
      organization: {
        mine: {
          useQuery: () => ({
            data: [{ id: "o" }],
            error: null,
            isFetching: false,
            isPaused: false,
          }),
        },
      },
      recordedExecutionTrends: {
        summary: {
          useQuery: (
            input: RecordedExecutionTrendInput,
            options: { enabled: boolean },
          ) => {
            latestInput = input;
            if (options.enabled) {
              const key = recordedExecutionTrendKey(input);
              if (!cache.has(key)) {
                requests(input);
                cache.set(key, result(input));
                query.dataUpdatedAt++;
              }
              query.data = cache.get(key);
            }
            query.isFetching = currentReadLost;
            return query;
          },
        },
      },
    },
    Link: ({ children, ...props }: Props) =>
      React.createElement("a", props, children),
    DialogFrame: ({ open, label, children }: Props) =>
      React.createElement(
        "section",
        { hidden: !open, "aria-label": label },
        children,
      ),
    ManualRunDashboardSummary: () => null,
    defaultExecutionTrendDates: () =>
      defaultExecutionTrendDates(new Date("2026-10-01T12:00:00Z")),
    recordedExecutionTrendInput,
    recordedExecutionTrendKey,
    executionTrendPeriods,
    EXECUTION_OUTCOMES,
    EXECUTION_OUTCOME_COLORS,
    executionDatePresets,
    resolveExecutionDatePreset,
    renderRecordedExecutionTrendCsv,
    renderRecordedExecutionTrendHtml,
    document: { createElement: create, body: { appendChild: vi.fn() } },
    URL: {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return "blob:synthetic";
      },
      revokeObjectURL: vi.fn(),
    },
    setTimeout: () => 0,
  });
  vm.runInContext(code, context);
  const component = context.component as (props: {
    projectId: string;
    active: boolean;
  }) => React.ReactElement;
  function render() {
    let turns = 0;
    do {
      if (++turns > 20) throw Error("Synthetic hook render did not settle");
      dirty = false;
      cursor = 0;
      tree = component({ projectId: "p", active: true });
      layouts.splice(0).forEach((callback) => callback());
      effects.splice(0).forEach((callback) => callback());
    } while (dirty);
    return renderToStaticMarkup(tree);
  }
  function input(label: string, value: string) {
    const wrapper = elements(tree).find(
        (node) =>
          node.type === "label" && renderToStaticMarkup(node).includes(label),
      ),
      node =
        wrapper &&
        elements(wrapper.props.children).find((node) => node.type === "input");
    if (!node?.props.onChange) throw Error(`Missing input ${label}`);
    node.props.onChange({ target: { value, checked: false } });
    return render();
  }
  function button(label: string) {
    const node = elements(tree).find(
      (node) =>
        node.type === "button" && renderToStaticMarkup(node).includes(label),
    );
    if (!node?.props.onClick) throw Error(`Missing button ${label}`);
    return node.props.onClick;
  }
  function apply() {
    const form = elements(tree).find((node) => node.type === "form");
    if (!form?.props.onSubmit) throw Error("Missing form");
    form.props.onSubmit({ preventDefault: vi.fn() });
    return render();
  }
  function review() {
    button("Export recorded outcome overview")();
    render();
    const label = elements(tree).find(
        (node) =>
          node.type === "label" &&
          renderToStaticMarkup(node).includes(
            "I reviewed these exact current counts",
          ),
      ),
      checkbox =
        label &&
        elements(label.props.children).find((node) => node.type === "input");
    if (!checkbox?.props.onChange) throw Error("Missing exact export review");
    checkbox.props.onChange({ target: { value: "", checked: true } });
    render();
  }
  render();
  input("Start date", "2026-10-01");
  input("End date", "2026-10-01");
  return {
    render,
    input,
    apply,
    button,
    review,
    requests,
    refetch,
    blobs,
    click,
    create,
    loseRead: () => {
      currentReadLost = true;
      return render();
    },
    loseProject: () => {
      projectReadLost = true;
      return render();
    },
    get inputScope() {
      return latestInput;
    },
    get data() {
      return query.data;
    },
  };
}
const dateNotice = "Date edits have not been applied.",
  filterNotice = "Configuration filter edits have not been applied.";
it("no applied scope or unchanged absent/empty filters has no unapplied notice or request", () => {
  const h = harness();
  expect(h.render()).not.toContain(filterNotice);
  expect(h.requests).not.toHaveBeenCalled();
  h.apply();
  expect(h.render()).not.toContain(filterNotice);
  expect(h.render()).not.toContain(dateNotice);
  expect(h.requests).toHaveBeenCalledOnce();
  expect(h.inputScope).not.toHaveProperty("platform");
});
it.each(["Platform", "Environment", "Build"])(
  "actual %s draft change discloses unapplied filters without applying/refreshing the owned scope",
  (label) => {
    const h = harness();
    h.apply();
    const original = h.inputScope,
      data = h.data;
    const html = h.input(label, "new-private-draft");
    expect(html).toContain(filterNotice);
    expect(html).not.toContain(dateNotice);
    expect(html).toContain(
      "view, refresh and export still use the last applied configuration",
    );
    expect(h.inputScope).toBe(original);
    expect(h.data).toBe(data);
    expect(h.requests).toHaveBeenCalledOnce();
    expect(h.refetch).not.toHaveBeenCalled();
    expect(h.click).not.toHaveBeenCalled();
    h.button("Refresh applied scope")();
    expect(h.refetch).toHaveBeenCalledOnce();
    expect(h.inputScope).toBe(original);
  },
);
it("date-only and combined draft notices are independent and never autoapply", () => {
  const h = harness();
  h.apply();
  const original = h.inputScope;
  let html = h.input("Start date", "2026-09-30");
  expect(html).toContain(dateNotice);
  expect(html).not.toContain(filterNotice);
  html = h.input("Build", "0");
  expect(html).toContain(dateNotice);
  expect(html).toContain(filterNotice);
  expect(h.inputScope).toBe(original);
  expect(h.requests).toHaveBeenCalledOnce();
});
it.each(["0", " leading/trailing ", "  "])(
  "exact literal draft %j differs from absent without trimming; returning to empty removes the notice",
  (value) => {
    const h = harness();
    h.apply();
    const original = h.inputScope;
    expect(h.input("Build", value)).toContain(filterNotice);
    expect(h.inputScope).toBe(original);
    expect(h.input("Build", "")).not.toContain(filterNotice);
    expect(h.requests).toHaveBeenCalledOnce();
  },
);
it("clearing an applied literal value is an unapplied removal until explicit Apply; exact whitespace and zero survive accepted submission", () => {
  const h = harness();
  h.input("Platform", "  platform  ");
  h.input("Build", "0");
  h.apply();
  expect(h.inputScope?.platform).toBe("  platform  ");
  expect(h.inputScope?.build).toBe("0");
  expect(h.render()).not.toContain(filterNotice);
  const original = h.inputScope;
  expect(h.input("Build", "")).toContain(filterNotice);
  expect(h.inputScope).toBe(original);
  h.apply();
  expect(h.inputScope).not.toHaveProperty("build");
  expect(h.inputScope?.platform).toBe("  platform  ");
  expect(h.render()).not.toContain(filterNotice);
  expect(h.requests).toHaveBeenCalledTimes(2);
});
it("trim-equivalent edits remain unapplied literal changes, not an inferred same filter", () => {
  const h = harness();
  h.input("Platform", " platform ");
  h.apply();
  const original = h.inputScope;
  expect(h.input("Platform", "platform")).toContain(filterNotice);
  expect(h.inputScope).toBe(original);
  expect(h.inputScope?.platform).toBe(" platform ");
  expect(h.input("Platform", " platform ")).not.toContain(filterNotice);
  expect(h.requests).toHaveBeenCalledOnce();
});
it("read loss withholds evidence and current workspace loss hides retained filters/notices rather than echoing private applied values", () => {
  const h = harness();
  h.input("Build", "PRIVATE_APPLIED_BUILD");
  h.apply();
  h.input("Build", "PRIVATE_DRAFT_BUILD");
  const html = h.loseRead();
  expect(html).toContain(filterNotice);
  expect(html).not.toContain('aria-label="Recorded scope totals"');
  const notice = html.match(
    /<p role="status">Configuration filter edits[\s\S]*?<\/p>/,
  )?.[0];
  expect(notice).toBeDefined();
  expect(notice).not.toContain("PRIVATE_APPLIED_BUILD");
  expect(notice).not.toContain("PRIVATE_DRAFT_BUILD");
  const generic = h.loseProject();
  expect(generic).not.toContain(filterNotice);
  expect(generic).not.toContain("PRIVATE_APPLIED_BUILD");
  expect(generic).not.toContain("PRIVATE_DRAFT_BUILD");
  expect(generic).toContain("Cached evidence is hidden");
  expect(h.requests).toHaveBeenCalledOnce();
  expect(h.click).not.toHaveBeenCalled();
});
it("retained reviewed export still serializes applied configuration, never newly edited filters, without implicit download", async () => {
  const h = harness();
  h.input("Build", "APPLIED_BUILD");
  h.apply();
  h.review();
  const original = h.inputScope;
  expect(h.input("Build", "DRAFT_ONLY_BUILD")).toContain(filterNotice);
  expect(h.click).not.toHaveBeenCalled();
  expect(h.inputScope).toBe(original);
  expect(h.requests).toHaveBeenCalledOnce();
  h.button("Prepare reviewed file")();
  expect(h.click).toHaveBeenCalledOnce();
  expect(h.blobs).toHaveLength(1);
  const csv = await h.blobs[0]!.text();
  expect(csv).toContain("APPLIED_BUILD");
  expect(csv).not.toContain("DRAFT_ONLY_BUILD");
});
