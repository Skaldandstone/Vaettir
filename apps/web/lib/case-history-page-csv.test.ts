// SOURCE ONLY: authored NOT RUN. No rendered/Clerk/QueryClient/file-save proof.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type {
  CaseExecutionHistoryItem,
  CaseExecutionHistoryPage,
} from "@vaettir/core";
import {
  caseHistoryRequestKey,
  caseHistoryFilterKey,
  type CaseExecutionHistoryInput,
} from "@vaettir/api/src/services/caseExecutionHistoryScopeSchema";
import {
  reviewCaseHistoryPageCsv,
  prepareCaseHistoryPageCsv,
} from "./case-history-page-csv";

function fixture() {
  const input: CaseExecutionHistoryInput = {
    projectId: "private-project",
    testCaseId: "private-case",
    originalOrganizationId: "private-org",
    expectedClerkActorId: "private-clerk",
    limit: 10,
  };
  const item: CaseExecutionHistoryItem = {
    runId: "native-run-01",
    source: "MANUAL",
    provider: "manual",
    startedAt: "2026-01-01T12:00:00.000Z",
    finishedAt: null,
    runStatus: "FAILED",
    planned: true,
    outcome: "PASS",
    outcomeCounts: [{ status: "PASS", count: 1 }],
    outcomeMode: "CASE_RESULT",
    platform: "",
    build: 'Build, "one"\nLine',
    environment: "Lab",
    reportedCommit: null,
    starter: {
      id: "private-starter",
      label: "private-profile@example.com",
      source: "CURRENT_PROFILE",
    },
    definition: {
      source: "FROZEN_MANUAL_SUMMARY",
      originalCaseId: input.testCaseId,
      titleAtRun: "Private saved title",
      stepCount: 2,
    },
    steps: { recordedCount: 0, correctionCount: 0, lastObservation: null },
    artifactCount: 2,
    wholeCase: {
      revisionCount: 2,
      correctionCount: 1,
      lastRecorderName: "Captured recorder",
      lastRecordedAt: "2026-01-01T13:00:00.000Z",
      lastStatus: "PASS",
    },
    limitations: ["Captured revision metadata is not another execution."],
  };
  const page: CaseExecutionHistoryPage = {
    testCase: {
      id: input.testCaseId,
      displayId: "DEMO-01",
      title: "Private current title",
      archived: false,
    },
    items: [item],
    nextCursor: null,
    projectId: input.projectId,
    organizationId: input.originalOrganizationId,
    actorClerkUserId: input.expectedClerkActorId,
    requested: caseHistoryRequestKey(input),
    observedAt: "2026-01-02T14:00:00.000Z",
    window: null,
    limits: ["Current stored evidence, not an as-of report."],
  };
  return { input, page, item };
}
function exportCurrent(
  page: CaseExecutionHistoryPage,
  input: CaseExecutionHistoryInput,
  number = 1,
) {
  return prepareCaseHistoryPageCsv(
    page,
    input,
    number,
    reviewCaseHistoryPageCsv(page, input, number),
  );
}
describe("reviewed current-page case history CSV (NOT RUN)", () => {
  it("exports only reviewed page with native identity and distinct overall/case status plus original correction metadata", () => {
    const { page, input } = fixture(),
      result = exportCurrent(page, input);
    expect(result.count).toBe(1);
    expect(result.filename).toBe("DEMO-01-history-page-1.csv");
    expect(result.bytes.startsWith("\ufeff")).toBe(true);
    expect(result.bytes.endsWith("\r\n")).toBe(true);
    for (const text of [
      "native-run-01",
      "DEMO-01",
      "Overall run status",
      "FAILED",
      "Recorded case outcome",
      "PASS",
      "Captured recorder",
      "Retained whole-case correction count",
      "Current page number",
      "Next cursor present",
      "ALL_RECORDED_DATES",
      "NOT_FILTERED",
    ])
      expect(result.bytes).toContain(text);
    for (const hidden of [
      "private-project",
      "private-case",
      "private-org",
      "private-clerk",
      "private-starter",
      "private-profile@example.com",
      "Private saved title",
      "Private current title",
      page.requested!,
    ])
      expect(result.bytes).not.toContain(hidden);
  });
  it("preserves empty/literal/newline configuration separately from missing and formula protects text without a hidden provider fetch", () => {
    const { page, input, item } = fixture();
    const csv = exportCurrent(page, input).bytes;
    expect(csv).toContain('"Recorded platform","EMPTY",""');
    expect(csv).toContain('"Build, ""one""\nLine"');
    item.build = '=HYPERLINK("danger")';
    item.environment = "@formula";
    const protectedCsv = exportCurrent(page, input).bytes;
    expect(protectedCsv).toContain("'=HYPERLINK");
    expect(protectedCsv).toContain("'@formula");
    item.definition = {
      source: "NOT_RECORDED",
      originalCaseId: input.testCaseId,
      titleAtRun: null,
      stepCount: null,
    };
    item.platform = null;
    item.build = null;
    item.environment = null;
    delete item.wholeCase;
    const legacy = exportCurrent(page, input).bytes;
    expect(legacy).toContain('"Recorded platform","NOT_RECORDED",""');
    expect(legacy).toContain("LEGACY_FIELD_ABSENT");
    expect(legacy).not.toContain("Captured recorder");
  });
  it("records individually applied date/source/run/configuration scope and bounded next-page presence without exporting keys or fetching whole history", () => {
    const { page, input } = fixture();
    input.filters = {
      recordedSource: "MANUAL",
      runStatus: "FAILED",
      platform: " PC ",
      build: "b",
      environment: "Lab",
      interval: { start: "2026-01-01", end: "2026-01-02" },
    };
    Object.assign(page.items[0]!, { platform: " PC ", build: "b" });
    page.requested = caseHistoryRequestKey(input);
    page.window = { start: "2026-01-01T00:00:00.000Z", end: page.observedAt! };
    page.nextCursor = {
      runId: page.items[0]!.runId,
      filterKey: caseHistoryFilterKey(input),
    };
    const csv = exportCurrent(page, input).bytes;
    for (const text of [
      "Applied recordedSource filter",
      "Applied runStatus filter",
      "Applied platform filter",
      " PC ",
      "Applied UTC start date",
      "2026-01-01",
      "Next cursor present",
    ])
      expect(csv).toContain(text);
    expect(csv).not.toContain(page.requested!);
    expect(csv).not.toContain(page.nextCursor.filterKey!);
    const next = {
      ...input,
      before: { runId: "prior-cursor", filterKey: caseHistoryFilterKey(input) },
    };
    page.requested = caseHistoryRequestKey(next);
    expect(exportCurrent(page, next, 2).filename).toContain("page-2");
  });
  it("withholds missing/changed original actor/org/project/case/request/observed/window and invalid page bounds", () => {
    const { page, input } = fixture();
    for (const changed of [
      { organizationId: "other" },
      { actorClerkUserId: "other" },
      { projectId: "other" },
      { requested: "other" },
      { observedAt: "invalid" },
      { observedAt: undefined },
      { window: undefined },
      { testCase: { ...page.testCase, id: "other" } },
    ])
      expect(() =>
        exportCurrent(
          { ...page, ...changed } as CaseExecutionHistoryPage,
          input,
        ),
      ).toThrow();
    for (const pageNumber of [0, -1, 1.5, 10001, NaN, Infinity])
      expect(() => exportCurrent(page, input, pageNumber)).toThrow();
    expect(() =>
      exportCurrent(page, { ...input, expectedClerkActorId: undefined }),
    ).toThrow();
    expect(() =>
      exportCurrent(page, { ...input, originalOrganizationId: undefined }),
    ).toThrow();
    expect(() => exportCurrent(page, input, 2)).toThrow();
    expect(() => reviewCaseHistoryPageCsv(null, input, 1)).toThrow();
  });
  it("requires original exact page reference/content/request/number and rejects a cached mutation or equivalent replacement", () => {
    const { page, input } = fixture(),
      review = reviewCaseHistoryPageCsv(page, input, 1);
    expect(() =>
      prepareCaseHistoryPageCsv({ ...page }, input, 1, review),
    ).toThrow();
    expect(() => prepareCaseHistoryPageCsv(null, input, 1, review)).toThrow();
    expect(() => prepareCaseHistoryPageCsv(page, input, 2, review)).toThrow();
    page.items[0]!.runStatus = "PARTIAL";
    expect(() => prepareCaseHistoryPageCsv(page, input, 1, review)).toThrow();
    page.items[0]!.runStatus = "FAILED";
    expect(() =>
      prepareCaseHistoryPageCsv(page, { ...input, limit: 11 }, 1, review),
    ).toThrow();
  });
  it("refuses accidental unknown private bodies at every shape level rather than silently stripping them", () => {
    const { page, input } = fixture();
    const changedPages = [
      { ...page, privateNotes: "never strip" },
      { ...page, testCase: { ...page.testCase, body: "private" } },
      {
        ...page,
        items: [{ ...page.items[0]!, artifactUrl: "https://private.invalid" }],
      },
      {
        ...page,
        items: [
          {
            ...page.items[0]!,
            steps: { ...page.items[0]!.steps, notes: "private" },
          },
        ],
      },
      {
        ...page,
        items: [
          {
            ...page.items[0]!,
            wholeCase: {
              ...page.items[0]!.wholeCase!,
              reason: "private correction",
            },
          },
        ],
      },
    ];
    for (const changed of changedPages)
      expect(() =>
        exportCurrent(changed as CaseExecutionHistoryPage, input),
      ).toThrow();
  });
  it("refuses duplicated runs/count statuses and contradictory source/outcome/mode/frozen evidence without a status substitution", () => {
    const { page, input, item } = fixture();
    expect(() =>
      exportCurrent({ ...page, items: [item, item] }, input),
    ).toThrow();
    for (const changed of [
      { source: "CI_IMPORT" },
      { outcome: "FAIL" },
      {
        outcomeCounts: [
          { status: "PASS", count: 1 },
          { status: "PASS", count: 1 },
        ],
      },
      { outcomeCounts: [{ status: "PASS", count: 0 }] },
      { outcomeMode: "PARTIAL_STEPS" },
      { outcomeMode: "MULTIPLE_REPORTED_RESULTS" },
      { steps: { ...item.steps, recordedCount: 1 } },
      { definition: { ...item.definition, stepCount: null } },
      { platform: null },
      { wholeCase: { ...item.wholeCase!, revisionCount: 0 } },
      { wholeCase: { ...item.wholeCase!, correctionCount: 3 } },
      { wholeCase: { ...item.wholeCase!, lastRecordedAt: "invalid" } },
      { wholeCase: { ...item.wholeCase!, lastStatus: "FAIL" } },
      {
        steps: {
          ...item.steps,
          lastObservation: {
            actorId: "hidden",
            recordedActorName: "captured",
            recordedAt: item.startedAt,
          },
        },
      },
    ])
      expect(() =>
        exportCurrent(
          {
            ...page,
            items: [{ ...item, ...changed }],
          } as CaseExecutionHistoryPage,
          input,
        ),
      ).toThrow();
    const base = { ...item, wholeCase: null };
    for (const changed of [
      {
        outcomeMode: "STEP_RESULTS",
        steps: { ...item.steps, recordedCount: 1 },
      },
      {
        outcomeMode: "PARTIAL_STEPS",
        outcome: "NOT_RECORDED",
        steps: { ...item.steps, recordedCount: 2 },
      },
      {
        outcomeMode: "NO_CASE_RESULT",
        outcome: "NOT_RECORDED",
        outcomeCounts: [],
      },
      {
        outcomeMode: "PLANNED_ONLY",
        planned: false,
        outcome: "NOT_RECORDED",
        outcomeCounts: [],
      },
    ])
      expect(() =>
        exportCurrent(
          {
            ...page,
            items: [{ ...base, ...changed }],
          } as CaseExecutionHistoryPage,
          input,
        ),
      ).toThrow();
    const complete = {
      ...base,
      outcomeMode: "STEP_RESULTS" as const,
      steps: { ...item.steps, recordedCount: 2 },
    };
    expect(
      exportCurrent({ ...page, items: [complete] }, input).bytes,
    ).toContain("STEP_RESULTS");
  });
  it("keeps partial observations/no-result/mixed/imported records honest without inventing retries or whole-case history", () => {
    const { page, input, item } = fixture();
    item.wholeCase = null;
    item.outcomeMode = "PARTIAL_STEPS";
    item.outcome = "NOT_RECORDED";
    item.steps.recordedCount = 1;
    const partial = exportCurrent(page, input).bytes;
    expect(partial).toContain("PARTIAL_STEPS");
    expect(partial).toContain("do not confirm a completed case");
    item.outcomeMode = "PLANNED_ONLY";
    item.outcomeCounts = [];
    item.steps.recordedCount = 0;
    item.wholeCase = null;
    expect(exportCurrent(page, input).bytes).toContain("UNTRACKED");
    item.outcomeMode = "MULTIPLE_REPORTED_RESULTS";
    item.outcomeCounts = [
      { status: "PASS", count: 2 },
      { status: "FAIL", count: 1 },
    ];
    item.outcome = "MIXED";
    expect(exportCurrent(page, input).bytes).toContain("PASS:2; FAIL:1");
    item.source = "CI_IMPORT";
    item.provider = "junit-import";
    item.definition = {
      source: "NOT_RECORDED",
      originalCaseId: input.testCaseId,
      titleAtRun: null,
      stepCount: null,
    };
    item.platform = null;
    item.build = null;
    item.environment = null;
    item.planned = false;
    expect(exportCurrent(page, input).bytes).toContain("CI_IMPORT");
  });
  it("fails applied filter/window/cursor mismatches and never treats zero matching export as complete history", () => {
    const { page, input, item } = fixture();
    for (const filters of [
      { recordedSource: "CI_IMPORT" as const },
      { runStatus: "PASSED" as const },
      { build: "other" },
    ]) {
      const requested = { ...input, filters };
      expect(() =>
        exportCurrent(
          { ...page, requested: caseHistoryRequestKey(requested) },
          requested,
        ),
      ).toThrow();
    }
    const request = {
      ...input,
      filters: { interval: { start: "2026-01-01", end: "2026-01-02" } },
    };
    expect(() =>
      exportCurrent(
        {
          ...page,
          requested: caseHistoryRequestKey(request),
          window: {
            start: "2026-01-01T00:00:00.000Z",
            end: "2026-01-02T23:59:59.999Z",
          },
        },
        request,
      ),
    ).toThrow();
    expect(() =>
      exportCurrent(
        {
          ...page,
          nextCursor: {
            runId: "wrong",
            filterKey: caseHistoryFilterKey(input),
          },
        },
        input,
      ),
    ).toThrow();
    expect(() =>
      exportCurrent(
        { ...page, nextCursor: { runId: item.runId, filterKey: "wrong" } },
        input,
      ),
    ).toThrow();
    const empty = exportCurrent({ ...page, items: [] }, input);
    expect(empty.count).toBe(0);
    expect(empty.limits.join(" ")).toContain("not whole history");
  });
  it("bounds raw/serialized page and CSV shape/text/Unicode instead of truncating; no download/query/server runtime import", () => {
    const { page, input, item } = fixture();
    expect(() =>
      exportCurrent(
        { ...page, items: Array.from({ length: 26 }, () => item) },
        input,
      ),
    ).toThrow();
    expect(() =>
      exportCurrent(
        {
          ...page,
          unexpected: "x".repeat(4 * 1024 * 1024 + 1),
        } as CaseExecutionHistoryPage,
        input,
      ),
    ).toThrow();
    const cyclic = { ...page } as CaseExecutionHistoryPage & {
      cycle?: unknown;
    };
    cyclic.cycle = cyclic;
    expect(() => exportCurrent(cyclic, input)).toThrow();
    const longItem = {
      ...item,
      limitations: Array.from({ length: 16 }, () => "x".repeat(4000)),
    };
    const large = {
      ...page,
      items: Array.from({ length: 25 }, (_, n) => ({
        ...longItem,
        runId: `owned-${n}`,
      })),
    };
    const largerInput = { ...input, limit: 25 };
    large.requested = caseHistoryRequestKey(largerInput);
    expect(() => exportCurrent(large, largerInput)).toThrow();
    item.environment = "bad\0text";
    expect(() => exportCurrent(page, input)).toThrow();
    item.environment = "bad\ud800";
    expect(() => exportCurrent(page, input)).toThrow();
    const source = readFileSync(
      new URL("./case-history-page-csv.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /@vaettir\/db|node:|trpcReact|fetch\(|downloadFile|navigator\.|useMutation/,
    );
    expect(source).toContain("renderBoundedSpreadsheetCsv");
  });
});
