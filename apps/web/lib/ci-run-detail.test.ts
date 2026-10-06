import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { useCiRunDetail } from "./use-ci-run-detail";
import type {
  CiRunDetailSnapshot,
  CiRunDetailPage,
} from "./ci-run-detail-reader";
import { ciRunDetailReadKey } from "@vaettir/api/src/services/ciRunDetailReadSchema";
const source = readFileSync(
  new URL("../components/CiRunDetail.tsx", import.meta.url),
  "utf8",
);
function compileFunctions(source: string) {
  const ast = ts.createSourceFile(
    "actual.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return ts
    .createPrinter()
    .printList(
      ts.ListFormat.MultiLine,
      ts.factory.createNodeArray(
        ast.statements.filter(ts.isFunctionDeclaration),
      ),
      ast,
    )
    .replaceAll(/\bexport\s+/g, "");
}
const visualSource = readFileSync(
    new URL("../components/MetricVisuals.tsx", import.meta.url),
    "utf8",
  ),
  code = ts.transpileModule(
    `${compileFunctions(visualSource)}\n${compileFunctions(source)}\nthis.component=CiRunDetail;this.badge=CiOutcomeBadge;this.card=CiResultCard;`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
        jsx: ts.JsxEmit.React,
      },
    },
  ).outputText;
function fixture(): CiRunDetailSnapshot {
  const input = {
      projectId: "p",
      testRunId: "run",
      originalOrganizationId: "o",
      expectedClerkActorId: "cl",
      expectedNativeActorId: "n",
      requestId: "6ee2ec04-4d34-40bf-b0e9-000000000001",
      throughResultId: "result-z",
      limit: 20,
    },
    linked: CiRunDetailPage["rows"][number] = {
      id: "result-a",
      testRunId: "run",
      testCaseId: "case",
      linkState: "LINKED_CURRENT_CASE",
      linkedCase: {
        id: "case",
        displayId: "CASE-42",
        title: "",
        archived: false,
        reviewStatus: "APPROVED",
        source: {
          id: "source",
          filePath: "current/path.ts",
          functionName: " exact function ",
          framework: "vitest",
          frameworkFamily: "VITEST",
          externalTestId: "current-source-id",
          lastSyncedCommitSha: " current commit ",
          lastSyncedAt: "2026-09-01T00:00:00.000Z",
        },
        provenance: "CURRENT_CASE_METADATA_NOT_FROZEN_EXECUTION_DEFINITION",
      },
      externalTestId: "captured-id",
      externalFilePath: " captured/path.ts ",
      status: "FAIL",
      durationMs: 0,
      errorMessage: "",
      note: "<script>private\n note</script>",
      artifacts: [
        {
          id: "artifact",
          type: "SCREENSHOT",
          capturedAt: "2026-09-01T00:01:00.000Z",
          durationMs: 0,
        },
      ],
      bodyProvenance: "CURRENT_STORED_RESULT_NOT_IMMUTABLE_HISTORY",
    },
    unmatched: CiRunDetailPage["rows"][number] = {
      ...linked,
      id: "result-z",
      testCaseId: null,
      linkedCase: null,
      linkState: "UNMATCHED",
      status: "PASS",
      durationMs: null,
      note: null,
      errorMessage: " exact\n error ",
      externalTestId: null,
      externalFilePath: "",
      artifacts: [],
    };
  return {
    origin: {
      projectId: "p",
      testRunId: "run",
      organizationId: "o",
      clerkActorId: "cl",
      nativeActorId: "n",
    },
    observedSessionId: "A",
    epoch: 1,
    revision: 1,
    receivedAt: "2026-09-01T00:02:00.000Z",
    page: {
      readContext: {
        requestId: input.requestId,
        requestedKey: ciRunDetailReadKey(input),
        projection: "PAGE",
        scope: {
          projectId: "p",
          testRunId: "run",
          organizationId: "o",
          actorId: "n",
          actorClerkUserId: "cl",
        },
      },
      header: {
        id: "run",
        projectId: "p",
        ciProvider: "github",
        branch: "",
        commitSha: " ",
        status: "FAILED",
        startedAt: "2026-09-01T00:00:00.000Z",
        finishedAt: null,
      },
      throughResultId: input.throughResultId,
      rows: [linked, unmatched],
      summary: {
        total: 2,
        pass: 1,
        fail: 1,
        blocked: 0,
        skip: 0,
        flaky: 0,
        other: 0,
      },
      limit: 20,
      hasMore: false,
      nextAfterId: null,
      limitations: [
        "Synthetic current ID-window fixture. Not native/runtime proof.",
      ],
    },
  };
}
type Reader = ReturnType<typeof useCiRunDetail>;
type Props = { children?: unknown; onClick?: () => void; disabled?: boolean };
function elements(node: unknown): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function harness() {
  let snapshot: CiRunDetailSnapshot | null = fixture(),
    tree: React.ReactElement;
  const refresh = vi.fn(() => true),
    first = vi.fn(() => true),
    next = vi.fn(() => true),
    previous = vi.fn(() => true),
    reader: Reader = {
      origin: snapshot.origin,
      observedSessionId: "A",
      snapshot,
      fresh: snapshot.page,
      readable: true,
      loading: false,
      error: null,
      canNext: false,
      canPrevious: false,
      refresh,
      first,
      next,
      previous,
      current: () => snapshot,
    },
    hook = vi.fn(() => reader),
    context = vm.createContext({ React, useCiRunDetail: hook });
  vm.runInContext(code, context);
  const component = context.component as (props: {
      projectId: string;
      testRunId: string;
      organizationId: string;
      active?: boolean;
    }) => React.ReactElement,
    badge = context.badge as (props: { status: string }) => React.ReactElement,
    card = context.card as (props: {
      row: CiRunDetailPage["rows"][number];
    }) => React.ReactElement;
  function render(active = true) {
    tree = component({
      projectId: "p",
      testRunId: "run",
      organizationId: "o",
      active,
    });
    return renderToStaticMarkup(tree);
  }
  render();
  return {
    reader,
    hook,
    refresh,
    first,
    next,
    previous,
    render,
    badge,
    card,
    setCurrent: (value: CiRunDetailSnapshot | null) => {
      snapshot = value;
      reader.snapshot = value;
      reader.fresh = value?.page ?? null;
      reader.readable = !!value;
    },
    button: (text: string) => {
      const node = elements(tree).find(
        (node) =>
          node.type === "button" && renderToStaticMarkup(node).includes(text),
      );
      if (!node) throw Error(`No actual button ${text}`);
      return node;
    },
  };
}
it("actual complete component renders honest current-ID-window outcomes with separate NULL/empty/zero note/error and captured/current source metadata", () => {
  const h = harness(),
    html = h.render();
  for (const text of [
    "raw ingested observations",
    "not unique cases",
    "planned work left",
    "CASE-42",
    "Linked case has an empty title",
    "Unmatched result",
    "Stored error message",
    "Stored note",
    "Recorded empty text",
    "Not recorded (NULL)",
    "Duration 0 ms",
    "captured-id",
    "captured/path.ts",
    "current-source-id",
    "current/path.ts",
    "not a frozen execution definition",
    "Started UTC",
    "Finished UTC",
    "artifact",
    "SCREENSHOT",
    "not immutable history",
    "not execution chronology",
  ])
    expect(html).toContain(text);
  expect(html).toContain("white-space:pre-wrap");
  expect(html).toContain("&lt;script&gt;private\n note&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("distribution-danger");
  expect(html).not.toContain("percent complete");
  expect(h.hook).toHaveBeenLastCalledWith("p", "run", "o", {
    active: true,
    limit: 20,
  });
});
it("private-reader loss removes all private rows/header/source/counts and keeps refresh reachable; arbitrary SDK/native error is not displayed by this hook contract", () => {
  const h = harness();
  h.setCurrent(null);
  const html = h.render();
  for (const privateText of [
    "CASE-42",
    "captured-id",
    "private\n note",
    "current/path.ts",
    "Raw observations",
  ])
    expect(html).not.toContain(privateText);
  expect(html).toContain("withheld");
  expect(html).toContain("Explicitly refresh");
  h.button("Refresh current native access").props.onClick!();
  expect(h.refresh).toHaveBeenCalledOnce();
});
it("inactive actual component withholds stale private snapshot bodies and sends active=false to its original mounted reader", () => {
  const h = harness(),
    html = h.render(false);
  expect(html).not.toContain("captured-id");
  expect(html).not.toContain("CASE-42");
  expect(h.hook).toHaveBeenLastCalledWith("p", "run", "o", {
    active: false,
    limit: 20,
  });
});
it("empty admitted page has only genuine scoped raw zero and no invented whole-project zero or manual completion", () => {
  const h = harness(),
    empty = fixture();
  empty.page.rows = [];
  empty.page.throughResultId = null;
  empty.page.summary = {
    total: 0,
    pass: 0,
    fail: 0,
    skip: 0,
    flaky: 0,
    blocked: 0,
    other: 0,
  };
  h.setCurrent(empty);
  const html = h.render();
  expect(html).toContain(
    "No whole-project zero or planned CI scope is inferred",
  );
  expect(html).toContain("Empty admitted window (NULL)");
  expect(html).not.toContain("Unmatched result");
});
it("actual pagination forwards only guarded reader actions and exposes current native paging availability, not an inferred global page count", () => {
  const h = harness();
  expect(h.button("Next ID page").props.disabled).toBe(true);
  h.reader.canNext = true;
  h.reader.canPrevious = true;
  h.render();
  h.button("Next ID page").props.onClick!();
  h.button("Previous ID page").props.onClick!();
  h.button("First anchored ID page").props.onClick!();
  expect(h.next).toHaveBeenCalledOnce();
  expect(h.previous).toHaveBeenCalledOnce();
  expect(h.first).toHaveBeenCalledOnce();
});
it("closed current-source and artifact disclosures contain readable full supported metadata without file links or hidden provider actions", () => {
  const h = harness(),
    html = h.render();
  expect(html).not.toMatch(
    /<details[^>]*\bopen|<a\b|storageUrl|ciRunUrl|HealingSuggestionPanel|LinkResultPicker/,
  );
  for (const label of [
    "Current stable display ID",
    "Current source record ID",
    "Current function name",
    "Current framework family",
    "Current source last-synced commit",
    "Current source last-synced UTC",
    "Files, availability, contents and immutable versions have not been verified",
  ])
    expect(html).toContain(label);
});
it("exact empty display ID and whitespace metadata are visible distinctions rather than a blank ID chip or normalized value", () => {
  const h = harness(),
    row = fixture().page.rows[0]!;
  row.linkedCase!.displayId = "";
  row.note = " \n ";
  const html = renderToStaticMarkup(h.card({ row }));
  expect(html).toContain("Recorded empty display ID");
  expect(html).toContain("Recorded whitespace text");
  expect(html).toContain(" \n ");
});
it.each([
  ["PASS", "frost"],
  ["FAIL", "ember"],
  ["BLOCKED", "warning"],
  ["FLAKY", "warning"],
  ["PARTIAL", "warning"],
  ["RUNNING", "info"],
  ["COMPLETED", "muted"],
  ["CANCELED", "muted"],
  ["FUTURE", "muted"],
])(
  "%s actual outcome badge uses accessible transparent text color plus exact label, no chart-fill token",
  (status, color) => {
    const html = renderToStaticMarkup(harness().badge({ status }));
    expect(html).toContain(`color:var(--${color})`);
    expect(html).toContain("background:transparent");
    expect(html).toContain(`>${status}</span>`);
    expect(html).not.toContain("distribution-");
  },
);
it("source scope is protected read-only CI detail; never auto-classifies/heals/links/retrieves files/downloads or uses legacy byId", () => {
  expect(source).toContain("useCiRunDetail(projectId");
  expect(source).toContain("active");
  expect(source).not.toMatch(
    /testRuns\.byId|HealingSuggestionPanel|LinkResultPicker|\.useMutation\(|downloadFile|location\.assign|createViewUrl|dangerouslySetInnerHTML|\.trim\(/,
  );
});
