import {
  caseExecutionHistoryItemSchema,
  caseExecutionHistoryPageSchema,
  renderBoundedSpreadsheetCsv,
  summarizeCaseOutcomes,
  type CaseExecutionHistoryPage,
  type SpreadsheetCsvCell,
} from "@vaettir/core";
import {
  caseExecutionHistoryInputSchema,
  caseHistoryFilterKey,
  caseHistoryRequestKey,
  type CaseExecutionHistoryInput,
} from "@vaettir/api/src/services/caseExecutionHistoryScopeSchema";

import { hasIdentityControl } from "./control-characters";
const encoder = new TextEncoder();
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
function refuse(): never {
  throw Error(
    "This exact current history page or its review is unavailable, unsupported or changed. No partial CSV was prepared.",
  );
}
const itemShape = caseExecutionHistoryItemSchema.shape;
// Reuse public core schemas rather than importing an undeclared web runtime
// dependency. The same Zod schema methods retain strict validation throughout.
const identity = caseExecutionHistoryPageSchema.shape.testCase.shape.id
  .min(1)
  .max(200)
  .refine((value) => {
    if (hasIdentityControl(value, true)) return false;
    for (const character of value) {
      const code = character.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff) return false;
    }
    return true;
  });
const text = (max: number) => itemShape.provider.max(max);
const count = itemShape.steps.shape.recordedCount.max(Number.MAX_SAFE_INTEGER);
const instant = itemShape.startedAt.refine(
  (value) =>
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value,
);
const wholeCase = itemShape.wholeCase
  .unwrap()
  .unwrap()
  .refine((value) => instant.safeParse(value.lastRecordedAt).success);
const strictItem = caseExecutionHistoryItemSchema.strict().extend({
  runId: identity,
  provider: text(2000),
  startedAt: instant,
  finishedAt: instant.nullable(),
  outcomeCounts: itemShape.outcomeCounts.element
    .strict()
    .extend({ count: count.positive() })
    .array()
    .max(5),
  platform: text(300).nullable(),
  build: text(300).nullable(),
  environment: text(2000).nullable(),
  reportedCommit: text(2000).nullable(),
  starter: itemShape.starter
    .unwrap()
    .strict()
    .extend({ id: identity, label: text(2000) })
    .nullable(),
  definition: itemShape.definition.strict().extend({
    originalCaseId: identity,
    titleAtRun: text(10000).nullable(),
    stepCount: count.max(500).nullable(),
  }),
  steps: itemShape.steps.strict().extend({
    recordedCount: count,
    correctionCount: count,
    lastObservation: itemShape.steps.shape.lastObservation
      .unwrap()
      .strict()
      .extend({
        actorId: identity,
        recordedActorName: text(300),
        recordedAt: instant,
      })
      .nullable(),
  }),
  artifactCount: count,
  wholeCase: wholeCase.nullable().optional(),
  limitations: text(4000).array().max(16),
});
const strictPage = caseExecutionHistoryPageSchema.strict().extend({
  testCase: caseExecutionHistoryPageSchema.shape.testCase
    .strict()
    .extend({ id: identity, displayId: identity, title: text(10000) }),
  items: strictItem.array().max(25),
  projectId: identity,
  organizationId: identity,
  actorClerkUserId: identity,
  requested: caseExecutionHistoryPageSchema.shape.requested
    .unwrap()
    .min(1)
    .max(65536),
  observedAt: instant,
  window: caseExecutionHistoryPageSchema.shape.window
    .unwrap()
    .unwrap()
    .strict()
    .extend({ start: instant, end: instant })
    .nullable(),
  limits: text(4000).array().max(8),
  nextCursor: caseExecutionHistoryPageSchema.shape.nextCursor
    .unwrap()
    .strict()
    .extend({ runId: identity })
    .nullable(),
});

/** Reject oversized/cyclic/unrepresentable raw objects before building a whole
 * serialization or letting a non-strict parser discard unknown private fields. */
function boundedSerialization(value: unknown): string {
  let bytes = 0,
    nodes = 0;
  const seen = new WeakSet<object>();
  const add = (amount: number) => {
    bytes += amount;
    if (bytes > MAX_PAGE_BYTES) refuse();
  };
  function visit(part: unknown, depth: number): void {
    if (++nodes > 20000 || depth > 12) refuse();
    if (part === null) {
      add(4);
      return;
    }
    if (typeof part === "string") {
      if (part.length > MAX_PAGE_BYTES) refuse();
      add(encoder.encode(JSON.stringify(part)).length);
      return;
    }
    if (typeof part === "boolean") {
      add(part ? 4 : 5);
      return;
    }
    if (typeof part === "number" && Number.isFinite(part)) {
      add(String(part).length);
      return;
    }
    if (!part || typeof part !== "object" || seen.has(part)) refuse();
    seen.add(part);
    if (Array.isArray(part)) {
      if (part.length > 20000) refuse();
      add(2 + Math.max(0, part.length - 1));
      for (const element of part) visit(element, depth + 1);
    } else {
      if (
        Object.getPrototypeOf(part) !== Object.prototype &&
        Object.getPrototypeOf(part) !== null
      )
        refuse();
      const keys = Object.keys(part);
      if (keys.length > 1000) refuse();
      add(2);
      let actual = 0;
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(part, key);
        if (!descriptor || descriptor.get || descriptor.set) refuse();
        if (part && (part as Record<string, unknown>)[key] === undefined)
          continue;
        if (key.length > MAX_PAGE_BYTES) refuse();
        add(
          encoder.encode(JSON.stringify(key)).length + 1 + (actual++ ? 1 : 0),
        );
        visit((part as Record<string, unknown>)[key], depth + 1);
      }
    }
    seen.delete(part);
  }
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (encoder.encode(serialized).length > MAX_PAGE_BYTES) refuse();
  return serialized;
}

function validated(
  page: CaseExecutionHistoryPage | null,
  rawInput: CaseExecutionHistoryInput,
  pageNumber: number,
) {
  if (
    !page ||
    !Number.isSafeInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > 10000
  )
    refuse();
  const serialized = boundedSerialization(page);
  const parsed = strictPage.safeParse(page),
    request = caseExecutionHistoryInputSchema.safeParse(rawInput);
  if (!parsed.success || !request.success) refuse();
  const value = parsed.data,
    input = request.data;
  const org = identity.safeParse(input.originalOrganizationId),
    actor = identity.safeParse(input.expectedClerkActorId);
  if (
    !org.success ||
    !actor.success ||
    value.organizationId !== org.data ||
    value.actorClerkUserId !== actor.data ||
    value.projectId !== input.projectId ||
    value.testCase.id !== input.testCaseId ||
    value.requested !== caseHistoryRequestKey(input) ||
    value.items.length > input.limit
  )
    refuse();
  if ((pageNumber === 1) !== (input.before === undefined)) refuse();
  if (input.filters?.interval) {
    const start = `${input.filters.interval.start}T00:00:00.000Z`;
    const end = new Date(
      Math.min(
        Date.parse(`${input.filters.interval.end}T00:00:00.000Z`) +
          86400000 -
          1,
        Date.parse(value.observedAt),
      ),
    ).toISOString();
    if (
      !value.window ||
      value.window.start !== start ||
      value.window.end !== end ||
      start > end
    )
      refuse();
  } else if (value.window !== null) refuse();
  if (
    value.nextCursor &&
    (!value.items.length ||
      value.nextCursor.runId !== value.items[value.items.length - 1]!.runId ||
      value.nextCursor.filterKey !== caseHistoryFilterKey(input))
  )
    refuse();
  const ids = new Set<string>();
  let previous = Infinity;
  for (const item of value.items) {
    const timestamp = Date.parse(item.startedAt);
    if (
      ids.has(item.runId) ||
      timestamp > previous ||
      item.definition.originalCaseId !== input.testCaseId ||
      (item.source === "MANUAL") !== (item.provider === "manual") ||
      (input.filters?.recordedSource !== undefined &&
        item.source !== input.filters.recordedSource) ||
      (input.filters?.runStatus !== undefined &&
        item.runStatus !== input.filters.runStatus) ||
      (value.window &&
        (item.startedAt < value.window.start ||
          item.startedAt > value.window.end))
    )
      refuse();
    ids.add(item.runId);
    previous = timestamp;
    for (const key of ["platform", "build", "environment"] as const)
      if (
        input.filters?.[key] !== undefined &&
        (item.definition.source !== "FROZEN_MANUAL_SUMMARY" ||
          item[key] !== input.filters[key])
      )
        refuse();
    const statuses = new Set(item.outcomeCounts.map((row) => row.status));
    const resultCount = item.outcomeCounts.reduce(
      (sum, row) => sum + row.count,
      0,
    );
    if (
      statuses.size !== item.outcomeCounts.length ||
      !Number.isSafeInteger(resultCount) ||
      (item.outcomeMode === "PARTIAL_STEPS"
        ? item.outcome !== "NOT_RECORDED"
        : item.outcome !== summarizeCaseOutcomes(item.outcomeCounts)) ||
      (item.outcomeMode === "MULTIPLE_REPORTED_RESULTS" && resultCount <= 1) ||
      (item.outcomeMode === "CASE_RESULT" &&
        (resultCount !== 1 || item.steps.recordedCount !== 0)) ||
      (["STEP_RESULTS", "PARTIAL_STEPS"].includes(item.outcomeMode) &&
        item.steps.recordedCount === 0) ||
      (item.outcomeMode === "STEP_RESULTS" &&
        (item.definition.source !== "FROZEN_MANUAL_SUMMARY" ||
          item.definition.stepCount !== item.steps.recordedCount ||
          resultCount > 1)) ||
      (item.outcomeMode === "PARTIAL_STEPS" &&
        item.definition.source === "FROZEN_MANUAL_SUMMARY" &&
        item.definition.stepCount === item.steps.recordedCount) ||
      (["PLANNED_ONLY", "NO_CASE_RESULT"].includes(item.outcomeMode) &&
        resultCount !== 0) ||
      (["PLANNED_ONLY", "NO_CASE_RESULT"].includes(item.outcomeMode) &&
        item.steps.recordedCount !== 0) ||
      (item.outcomeMode === "PLANNED_ONLY" && !item.planned) ||
      (item.outcomeMode === "NO_CASE_RESULT" && item.planned) ||
      (item.wholeCase != null &&
        (item.source !== "MANUAL" ||
          !item.planned ||
          item.outcomeMode !== "CASE_RESULT" ||
          resultCount !== 1 ||
          item.steps.recordedCount !== 0 ||
          item.steps.correctionCount !== 0 ||
          item.steps.lastObservation !== null ||
          item.wholeCase.lastStatus !== item.outcome)) ||
      (item.definition.source === "FROZEN_MANUAL_SUMMARY" &&
        (item.definition.titleAtRun === null ||
          item.definition.stepCount === null ||
          item.platform === null ||
          item.build === null ||
          item.environment === null)) ||
      (item.definition.source !== "FROZEN_MANUAL_SUMMARY" &&
        (item.definition.titleAtRun !== null ||
          item.definition.stepCount !== null ||
          item.platform !== null ||
          item.build !== null ||
          item.environment !== null))
    )
      refuse();
  }
  return { page: value, input, serialized };
}

export const caseHistoryPageCsvLimits = [
  "Current reviewed page only, not whole history, an approved frozen stakeholder report, archival backup or external recipient grant. Next-page presence is disclosed; no additional page was fetched.",
  "Native run identities and current case key are included for internal traceability. Project/organization/actor IDs, source procedures, titles, private notes, artifacts/URLs, reported commits and current-profile starter names/emails are not exported.",
  "Stored provider source is manual versus imported, not verified original automation. Overall run status is separate from case outcome and partial steps do not confirm a completed case.",
  "Configuration is literal recorded metadata; missing is distinct from empty. Run start/import timestamps are not invented original execution times. This read is not an as-of reconstruction.",
  "Captured immutable recorder labels/timestamps, when present, are retained evidence metadata, not current-profile names or independently verified identity. Review labels, configuration text and recipients before sharing.",
  "Correction counts remain inside the same native execution, not unique retries, parameter runs, defect resolution, regressions, flakiness or qualified approval. Earlier unrecorded history is not reconstructed.",
  "Spreadsheet text protection prefixes dangerous leading text with an apostrophe; RFC quoting preserves comma, quote and newline text. Re-save/import settings may remove protection. File preparation is not proof of saving or sharing.",
  "At most 25 entries from a supported page of at most 4 MiB; CSV at most 1 MiB and 1100 rows. Unsupported/oversized evidence refuses, never truncates. Page number is retained UI position, not an independently counted full-history rank.",
] as const;

/** The original exact page reference and content are both retained locally for
 * review, never serialized into the CSV. This binding does not reauthorize; the
 * caller must pass null during lost/current-error/fetching/paused access and
 * invalidate review on close, identity/request/page change or unmount. */
export type CaseHistoryPageCsvReviewBinding = {
  readonly page: CaseExecutionHistoryPage;
  readonly serializedPage: string;
  readonly requestKey: string;
  readonly pageNumber: number;
};
export function reviewCaseHistoryPageCsv(
  page: CaseExecutionHistoryPage | null,
  input: CaseExecutionHistoryInput,
  pageNumber: number,
): CaseHistoryPageCsvReviewBinding {
  const current = validated(page, input, pageNumber);
  return Object.freeze({
    page: page!,
    serializedPage: current.serialized,
    requestKey: caseHistoryRequestKey(current.input),
    pageNumber,
  });
}

export function prepareCaseHistoryPageCsv(
  page: CaseExecutionHistoryPage | null,
  rawInput: CaseExecutionHistoryInput,
  pageNumber: number,
  review: CaseHistoryPageCsvReviewBinding,
) {
  const current = validated(page, rawInput, pageNumber);
  if (
    !review ||
    review.page !== page ||
    review.serializedPage !== current.serialized ||
    review.pageNumber !== pageNumber ||
    review.requestKey !== caseHistoryRequestKey(current.input)
  )
    refuse();
  const value = current.page,
    input = current.input;
  const rows: SpreadsheetCsvCell[][] = [];
  const row = (
    type: string,
    runId: string,
    label: string,
    field: string | number | null,
    note = "",
  ) =>
    rows.push([
      type,
      value.testCase.displayId,
      runId,
      label,
      field === null ? "NOT_RECORDED" : field === "" ? "EMPTY" : "VALUE",
      field ?? "",
      note,
    ]);
  const meta = (label: string, field: string | number | null, note = "") =>
    row("Metadata", "", label, field, note);
  meta("Export format", "Vaettir current case history page CSV v1");
  meta("Current page number", pageNumber);
  meta("Entries on this page", value.items.length);
  meta(
    "Next cursor present",
    value.nextCursor ? "Yes" : "No",
    "This does not fetch or export the next page; no whole-history completion is inferred.",
  );
  meta("Observed at UTC", value.observedAt);
  meta("Current case archived", value.testCase.archived ? "Yes" : "No");
  meta(
    "Access scope",
    "Exact original request project, workspace, signed-in actor and case matched",
    "Client read echoes only; not historical tenancy, external access or independent reauthorization.",
  );
  meta("Window start UTC", value.window?.start ?? "ALL_RECORDED_DATES");
  meta(
    "Window end UTC",
    value.window?.end ?? "ALL_RECORDED_DATES",
    "Inclusive stored run-start window when selected; end is capped at this read's observation time. No interval means all recorded dates, not absent timestamp evidence.",
  );
  meta("Requested page size", input.limit);
  meta("Prior cursor selected", input.before ? "Yes" : "No");
  for (const key of [
    "recordedSource",
    "runStatus",
    "platform",
    "build",
    "environment",
  ] as const)
    if (input.filters?.[key] === undefined)
      meta(
        `Applied ${key} filter`,
        "NOT_FILTERED",
        "No default value was invented.",
      );
    else meta(`Applied ${key} filter`, input.filters[key]!);
  meta(
    "Applied UTC start date",
    input.filters?.interval?.start ?? "NOT_FILTERED",
  );
  meta("Applied UTC end date", input.filters?.interval?.end ?? "NOT_FILTERED");
  for (const limitation of value.limits)
    row("Retained page boundary", "", "Server evidence boundary", limitation);
  for (const limitation of caseHistoryPageCsvLimits)
    row("Export boundary", "", "Current-page limitation", limitation);
  for (const item of value.items) {
    const add = (label: string, field: string | number | null, note = "") =>
      row("Run", item.runId, label, field, note);
    add("Recorded source", item.source);
    add("Stored provider", item.provider);
    add("Stored run start UTC", item.startedAt);
    add("Stored run finish UTC", item.finishedAt);
    add("Overall run status", item.runStatus, "Not this case's outcome.");
    add("Case included/planned", item.planned ? "Yes" : "No");
    add(
      "Recorded case outcome",
      item.outcome,
      item.outcomeMode === "PARTIAL_STEPS"
        ? "Partial steps do not confirm a completed case."
        : "Current stored case observations, not a reconstructed historical verdict.",
    );
    add("Outcome evidence mode", item.outcomeMode);
    add(
      "Stored result-row counts",
      item.outcomeCounts.length
        ? item.outcomeCounts
            .map((entry) => `${entry.status}:${entry.count}`)
            .join("; ")
        : null,
      "No unique retries or parameter execution identities are inferred.",
    );
    for (const key of ["platform", "build", "environment"] as const)
      add(`Recorded ${key}`, item[key]);
    add("Saved definition metadata source", item.definition.source);
    add("Saved procedure step count", item.definition.stepCount);
    add("Step observation count", item.steps.recordedCount);
    add(
      "Step correction count",
      item.steps.correctionCount,
      "Within this same run, not a new execution.",
    );
    add(
      "Last immutable step recorder label",
      item.steps.lastObservation?.recordedActorName ?? null,
      "Captured record label, not current-profile attribution or verified identity.",
    );
    add(
      "Last step observation UTC",
      item.steps.lastObservation?.recordedAt ?? null,
    );
    add(
      "Recorded artifact count",
      item.artifactCount,
      "No artifact content, identity or URL included.",
    );
    add(
      "Whole-case revision availability",
      item.wholeCase === undefined
        ? "LEGACY_FIELD_ABSENT"
        : item.wholeCase === null
          ? "UNTRACKED"
          : "RETAINED_METADATA",
      "Missing history is not reconstructed.",
    );
    add(
      "Retained whole-case revision count",
      item.wholeCase?.revisionCount ?? null,
    );
    add(
      "Retained whole-case correction count",
      item.wholeCase?.correctionCount ?? null,
      "Within this same run, not a new execution.",
    );
    add(
      "Last immutable whole-case recorder label",
      item.wholeCase?.lastRecorderName ?? null,
      "Captured record label, not current-profile attribution or verified identity.",
    );
    add(
      "Last whole-case observation UTC",
      item.wholeCase?.lastRecordedAt ?? null,
    );
    add(
      "Last retained whole-case status",
      item.wholeCase?.lastStatus ?? null,
      "Retained revision metadata is distinct from current aggregate outcome.",
    );
    for (const limitation of item.limitations)
      row(
        "Retained run boundary",
        item.runId,
        "Server evidence boundary",
        limitation,
      );
  }
  const bytes = renderBoundedSpreadsheetCsv(
    [
      "Row type",
      "Current case key",
      "Native run identity",
      "Recorded field",
      "Value state",
      "Recorded value",
      "Evidence boundary",
    ],
    rows,
    1100,
  );
  const safeKey =
    value.testCase.displayId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) ||
    "case";
  return {
    bytes,
    count: value.items.length,
    filename: `${safeKey}-history-page-${pageNumber}.csv`,
    limits: caseHistoryPageCsvLimits,
  };
}
