import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  reviewRunHistoryPage,
  matchesRunHistoryPageReview,
  downloadReviewedRunHistoryPage,
} from "./run-history-page-export";
import {
  runHistoryPageFingerprint,
  type RunHistoryReadSnapshot,
  type RunHistoryPageData,
} from "./run-history-reader";
import { runHistoryReadKey } from "@vaettir/api/src/services/runHistoryReadSchema";
import type { useRunHistory } from "./use-run-history";
const source = readFileSync(
    new URL("../components/RunHistoryDashboard.tsx", import.meta.url),
    "utf8",
  ),
  ast = ts.createSourceFile(
    "component.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  ),
  functions = ast.statements
    .filter(
      (node) => ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node),
    )
    .map((node) =>
      ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, node, ast)
        .replace(/\bexport\s+/, ""),
    )
    .join("\n"),
  code = ts.transpileModule(
    `${functions}\nthis.dashboard=RunHistoryDashboard;this.card=RunHistoryCard;`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
        jsx: ts.JsxEmit.React,
      },
    },
  ).outputText;
type Reader = ReturnType<typeof useRunHistory>;
const visualSource = readFileSync(
    new URL("../components/MetricVisuals.tsx", import.meta.url),
    "utf8",
  ),
  visualAst = ts.createSourceFile(
    "visuals.tsx",
    visualSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  ),
  visualCode = ts.transpileModule(
    visualAst.statements
      .filter(ts.isFunctionDeclaration)
      .map((node) =>
        ts
          .createPrinter()
          .printNode(ts.EmitHint.Unspecified, node, visualAst)
          .replace(/\bexport\s+/, ""),
      )
      .join("\n"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
        jsx: ts.JsxEmit.React,
      },
    },
  ).outputText;
type Run = RunHistoryPageData["rows"][number];
function snapshot(): RunHistoryReadSnapshot {
  const input = {
    projectId: "p",
    originalOrganizationId: "o",
    expectedClerkActorId: "cl",
    expectedNativeActorId: "n",
    requestId: "6ee2ec04-4d34-40bf-b0e9-000000000001",
    asOf: "2026-09-02T00:00:00.000Z",
    limit: 20,
  };
  const manual: Run = {
    id: "manual",
    ciProvider: "manual",
    ciRunUrl: null,
    commitSha: "manual",
    branch: "manual",
    status: "RUNNING",
    startedAt: "2026-09-01T00:00:00.000Z",
    finishedAt: null,
    resultCount: 1,
    startedByEmail: "private@example.invalid",
    progress: {
      total: 4,
      recorded: 1,
      remaining: 3,
      percentComplete: 25,
      pass: 1,
      fail: 0,
      blocked: 0,
      skip: 0,
      flaky: 0,
      other: 0,
    },
    progressUnavailableReason: null,
    progressBasis: "PLANNED_IDENTITIES_CURRENT_RESULTS",
  };
  const ci: Run = {
    ...manual,
    id: "ci",
    ciProvider: "github",
    branch: "feat/private",
    commitSha: "012345",
    status: "FAILED",
    startedAt: "2026-08-31T00:00:00.000Z",
    finishedAt: "2026-09-01T00:01:00.000Z",
    resultCount: 2,
    progress: {
      total: 2,
      recorded: 2,
      remaining: 0,
      percentComplete: 100,
      pass: 1,
      fail: 1,
      blocked: 0,
      skip: 0,
      flaky: 0,
      other: 0,
    },
    progressBasis: "CI_INGESTED_RESULTS",
  };
  const unsupported: Run = {
    ...manual,
    id: "retained",
    startedAt: "2026-08-30T00:00:00.000Z",
    progress: null,
    progressUnavailableReason: "Retained current-head mismatch",
  };
  return {
    origin: {
      projectId: "p",
      organizationId: "o",
      clerkActorId: "cl",
      nativeActorId: "n",
    },
    epoch: 1,
    revision: 1,
    observedSessionId: "A",
    receivedAt: "2026-09-02T00:00:01.000Z",
    page: {
      readContext: {
        scope: {
          projectId: "p",
          organizationId: "o",
          actorId: "n",
          actorClerkUserId: "cl",
        },
        requestId: input.requestId,
        requestedKey: runHistoryReadKey(input),
        projection: "PAGE",
        asOf: input.asOf,
      },
      rows: [manual, ci, unsupported],
      limit: 20,
      hasMore: false,
      nextBefore: null,
      limitations: ["Bounded anchored page, not globally frozen"],
    },
  };
}
type ElementProps = {
  children?: unknown;
  onClick?: () => void;
  disabled?: boolean;
  open?: boolean;
  keepMounted?: boolean;
  title?: string;
  run?: Run;
  onView?: (id: string) => void;
};
function elements(node: unknown): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function harness() {
  let current: RunHistoryReadSnapshot | null = snapshot(),
    cursor = 0,
    tree: React.ReactElement;
  const slots: unknown[] = [];
  const download = vi.fn(),
    navigate = vi.fn(),
    onView = vi.fn(),
    refresh = vi.fn(() => true),
    first = vi.fn(() => true),
    older = vi.fn(() => true),
    newer = vi.fn(() => true);
  const reader: Reader = {
    origin: current.origin,
    observedSessionId: "A",
    fresh: current.page,
    snapshot: current,
    readable: true,
    loading: false,
    error: null,
    canOlder: false,
    canNewer: false,
    refresh,
    first,
    older,
    newer,
    current: () => current,
  };
  const Modal = ({ open, title, children }: ElementProps) =>
    React.createElement(
      "section",
      { "aria-label": title, hidden: !open },
      children as React.ReactNode,
    );
  const context = vm.createContext({
    React,
    Modal,
    useRunHistory: () => reader,
    useRouter: () => ({ push: navigate }),
    reviewRunHistoryPage,
    matchesRunHistoryPageReview,
    downloadReviewedRunHistoryPage,
    runHistoryPageFingerprint,
    downloadFile: download,
    window: { location: { assign: navigate } },
    useState: (initial: unknown) => {
      const at = cursor++;
      if (at >= slots.length)
        slots[at] = typeof initial === "function" ? initial() : initial;
      return [
        slots[at],
        (next: unknown) => {
          slots[at] = typeof next === "function" ? next(slots[at]) : next;
        },
      ];
    },
  });
  vm.runInContext(visualCode, context);
  vm.runInContext(code, context);
  const dashboard = context.dashboard as (props: {
      projectId: string;
      organizationId: string;
      onView: (id: string) => void;
    }) => React.ReactElement,
    card = context.card as (props: {
      run: Run;
      onView: (id: string) => void;
    }) => React.ReactElement;
  function render() {
    cursor = 0;
    tree = dashboard({ projectId: "p", organizationId: "o", onView });
    return renderToStaticMarkup(tree);
  }
  function button(text: string) {
    const node = elements(tree).find(
      (node) =>
        node.type === "button" && renderToStaticMarkup(node).includes(text),
    );
    if (!node) throw Error(`Missing button ${text}`);
    return node.props.onClick!;
  }
  function setCurrent(next: RunHistoryReadSnapshot | null) {
    current = next;
    reader.snapshot = next;
    reader.fresh = next?.page ?? null;
    reader.readable = !!next;
    reader.observedSessionId = next?.observedSessionId ?? null;
  }
  render();
  return {
    reader,
    download,
    navigate,
    onView,
    refresh,
    first,
    older,
    newer,
    render,
    button,
    setCurrent,
    card,
    get tree() {
      return tree;
    },
  };
}
it("actual dashboard SSR separates supported manual run-case completion from CI ingestion and untrusted unavailable progress", () => {
  const h = harness(),
    html = h.render();
  for (const label of [
    "3",
    "Runs on this page",
    "1 / 4",
    "25% recorded",
    "3 left to test",
    "2 ingested observations",
    "Planned CI completion unavailable",
    "Retained current-head mismatch",
    "excluded, not treated as zero",
    "Started UTC",
    "Finished UTC",
    "2026-09-01T00:00:00.000Z",
    "Not recorded",
    "Passed",
    "Failed",
    "Blocked",
    "Untested",
  ])
    expect(html).toContain(label);
  expect(html).not.toContain("100% recorded");
  expect(html).not.toContain("private@example.invalid");
  expect(html).toContain("distribution-danger");
  expect(html).toContain('aria-label="Current run-history page"');
  expect(h.download).not.toHaveBeenCalled();
});
it("current reader loss removes private cards/portal children without resetting retained CSV review", () => {
  const h = harness();
  h.button("Review current page CSV")();
  h.render();
  const oldDownload = h.button("Download reviewed current page CSV");
  h.setCurrent(null);
  const html = h.render();
  expect(html).not.toContain("feat/private");
  expect(html).not.toContain("Retained current-head mismatch");
  expect(html).not.toContain("Export exactly");
  expect(html).toContain("retained privately");
  expect(html).toContain("Private export contents are withheld");
  oldDownload();
  expect(h.download).not.toHaveBeenCalled();
  const refreshed = snapshot();
  refreshed.page.readContext.requestId = "6ee2ec04-4d34-40bf-b0e9-000000000003";
  refreshed.page.readContext.requestedKey = runHistoryReadKey({
    projectId: "p",
    originalOrganizationId: "o",
    expectedClerkActorId: "cl",
    expectedNativeActorId: "n",
    requestId: refreshed.page.readContext.requestId,
    asOf: refreshed.page.readContext.asOf,
    limit: refreshed.page.limit,
  });
  h.setCurrent(refreshed);
  expect(h.render()).not.toContain("Export exactly");
  h.button("Review current page CSV")();
  expect(h.render()).toContain("Export exactly");
});
it("empty anchored page is not whole-project zero and unavailable current access has no old page metrics", () => {
  const h = harness(),
    empty = snapshot();
  empty.page.rows = [];
  h.setCurrent(empty);
  expect(h.render()).toContain("No whole-project zero is inferred");
  h.setCurrent(null);
  const html = h.render();
  expect(html).not.toContain("Runs on this page");
  expect(html).not.toContain("1 / 4");
  expect(html).toContain("Cached rows and export review are withheld");
  h.button("Refresh current native access")();
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("explicit immutable current-page review is required before one CSV callback; duplicate clicks do not download twice", () => {
  const h = harness();
  h.button("Review current page CSV")();
  const html = h.render();
  expect(html).toContain("plus one scope-metadata row");
  expect(html).toContain("branch/commit");
  expect(h.download).not.toHaveBeenCalled();
  const download = h.button("Download reviewed current page CSV");
  download();
  download();
  expect(h.download).toHaveBeenCalledOnce();
  const [filename, csv, mime] = h.download.mock.calls[0]!;
  expect(filename).toMatch(/current-run-page/);
  expect(mime).toBe("text/csv");
  expect(csv).toContain("CURRENT_PAGE_METADATA");
  expect(csv).not.toContain("private@example.invalid");
  expect(csv).not.toContain("feat/private");
  expect(h.render()).toContain("handed to your browser");
});
it("new nonce/data cannot inherit previous CSV review or stale rendered handlers", () => {
  const h = harness();
  const oldReview = h.button("Review current page CSV");
  h.button("Review current page CSV")();
  h.render();
  const oldDownload = h.button("Download reviewed current page CSV"),
    changed = snapshot();
  changed.page.readContext.requestId = "6ee2ec04-4d34-40bf-b0e9-000000000002";
  h.setCurrent(changed);
  oldReview();
  oldDownload();
  expect(h.download).not.toHaveBeenCalled();
  const html = h.render();
  expect(html).toContain("no longer current");
  expect(html).not.toContain("Export exactly");
  h.button("Review current page CSV")();
  expect(h.render()).toContain("Export exactly");
});
it("stale Close cannot dismiss a newer explicit review; close preserves a current review for reopening", () => {
  const h = harness();
  h.button("Review current page CSV")();
  h.render();
  const oldClose = h.button("Keep review and close");
  h.button("Review current page CSV")();
  h.render();
  oldClose();
  expect(h.render()).not.toContain("Reopen reviewed current-page CSV");
  h.button("Keep review and close")();
  h.render();
  h.button("Reopen reviewed current-page CSV")();
  expect(h.render()).toContain("Download reviewed current page CSV");
});
it("old Download cannot authorize a replaced or explicitly closed review even when page contents remain identical", () => {
  const h = harness();
  h.button("Review current page CSV")();
  h.render();
  const oldDownload = h.button("Download reviewed current page CSV");
  h.button("Review current page CSV")();
  h.render();
  oldDownload();
  expect(h.download).not.toHaveBeenCalled();
  const currentDownload = h.button("Download reviewed current page CSV");
  h.button("Keep review and close")();
  currentDownload();
  expect(h.download).not.toHaveBeenCalled();
  h.render();
  h.button("Reopen reviewed current-page CSV")();
  h.render();
  h.button("Download reviewed current page CSV")();
  expect(h.download).toHaveBeenCalledOnce();
});
it("all unsupported page cohorts show unavailable aggregate metrics rather than invented zeros", () => {
  const h = harness(),
    held = snapshot();
  for (const run of held.page.rows) {
    run.progress = null;
    run.progressUnavailableReason = "Unsupported retained evidence";
  }
  h.setCurrent(held);
  const html = h.render();
  expect(html.match(/<strong>Unavailable<\/strong>/g)).toHaveLength(3);
  expect(html).not.toContain("0 / 0");
  expect(html).toContain("0 of 2 manual runs supported");
  expect(html).toContain("Bounded anchored page, not globally frozen");
});
it("view/paging callbacks rely on synchronous current page, not stale rendered rows", () => {
  const h = harness(),
    run = snapshot().page.rows[0]!,
    ci = snapshot().page.rows[1]!;
  const components = elements(h.tree).filter(
    (node) => typeof node.type === "function" && node.props.run,
  );
  const manualHandler = components.find(
      (node) => node.props.run!.id === run.id,
    )!.props.onView!,
    ciHandler = components.find((node) => node.props.run!.id === ci.id)!.props
      .onView!;
  h.setCurrent(null);
  manualHandler(run.id);
  ciHandler(ci.id);
  expect(h.navigate).not.toHaveBeenCalled();
  expect(h.onView).not.toHaveBeenCalled();
  h.setCurrent(snapshot());
  h.render();
  const fresh = elements(h.tree).filter(
    (node) => typeof node.type === "function" && node.props.run,
  );
  fresh.find((node) => node.props.run!.id === run.id)!.props.onView!(run.id);
  fresh.find((node) => node.props.run!.id === ci.id)!.props.onView!(ci.id);
  expect(h.navigate).toHaveBeenCalledWith(
    "/projects/p/test-runs/manual/manual",
  );
  expect(h.onView).toHaveBeenCalledWith("ci");
  h.button("First anchored page")();
  expect(h.first).toHaveBeenCalledOnce();
});
it("download errors never echo arbitrary/private error text and a possibly handed-off review cannot auto-retry", () => {
  const h = harness();
  h.download.mockImplementation(() => {
    throw Error("private SQL or SDK details");
  });
  h.button("Review current page CSV")();
  h.render();
  const download = h.button("Download reviewed current page CSV");
  download();
  download();
  expect(h.download).toHaveBeenCalledOnce();
  const html = h.render();
  expect(html).toContain("check downloads");
  expect(html).not.toContain("private SQL or SDK details");
});
it("late SDK/native loss inside download callback suppresses notices and private portal bodies", () => {
  const h = harness();
  h.button("Review current page CSV")();
  h.render();
  h.download.mockImplementation(() => h.setCurrent(null));
  h.button("Download reviewed current page CSV")();
  expect(h.download).toHaveBeenCalledOnce();
  const html = h.render();
  expect(html).not.toContain("handed to your browser");
  expect(html).not.toContain("Export exactly");
});
it("source uses protected reader/current-page reviewed download and retained modal; no old list or aggregate/readiness exporter", () => {
  expect(source).toContain("useRunHistory(projectId");
  expect(source).toContain("downloadReviewedRunHistoryPage(");
  expect(source).toContain("reader.current");
  expect(source).toContain("keepMounted");
  expect(source).not.toMatch(
    /testRuns\.list|RunOverview|renderBoundedSpreadsheetCsv|parseInt|\.trim\(/,
  );
});
it.each([
  ["RUNNING", "info"],
  ["PASSED", "frost"],
  ["FAILED", "ember"],
  ["PARTIAL", "warning"],
  ["COMPLETED", "muted"],
  ["CANCELED", "muted"],
  ["UNKNOWN_FUTURE", "muted"],
])(
  "actual %s badge uses transparent panel-safe text color, exact label and no filled chart token",
  (status, color) => {
    const h = harness(),
      run = { ...snapshot().page.rows[0]!, status },
      html = renderToStaticMarkup(h.card({ run, onView: () => undefined })),
      badge = html.match(/<span class="run-status"[^>]*>[^<]*<\/span>/)?.[0];
    expect(badge).toContain(`color:var(--${color})`);
    expect(badge).toContain("background:transparent");
    expect(badge).toContain(`>${status}</span>`);
    expect(badge).not.toContain("distribution-");
  },
);
