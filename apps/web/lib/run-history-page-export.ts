import { renderBoundedSpreadsheetCsv } from "@vaettir/core";
import {
  freezeRunHistory,
  runHistoryPageFingerprint,
  sameRunHistoryOrigin,
  validateRunHistorySnapshot,
  type RunHistoryReadSnapshot,
} from "./run-history-reader";
export type RunHistoryPageReview = Readonly<{
  kind: "RunHistoryPageCsv/v1";
  snapshot: RunHistoryReadSnapshot;
  fingerprint: string;
}>;
export function reviewRunHistoryPage(
  current: RunHistoryReadSnapshot,
): RunHistoryPageReview {
  validateRunHistorySnapshot(current);
  const snapshot = freezeRunHistory(structuredClone(current));
  return Object.freeze({
    kind: "RunHistoryPageCsv/v1",
    snapshot,
    fingerprint: runHistoryPageFingerprint(snapshot),
  });
}
export function matchesRunHistoryPageReview(
  review: RunHistoryPageReview | null,
  current: RunHistoryReadSnapshot | null,
) {
  return (
    !!review &&
    !!current &&
    sameRunHistoryOrigin(review.snapshot.origin, current.origin) &&
    review.snapshot.observedSessionId === current.observedSessionId &&
    review.fingerprint === runHistoryPageFingerprint(current)
  );
}
export function renderRunHistoryPageCsv(review: RunHistoryPageReview) {
  const { snapshot } = review;
  validateRunHistorySnapshot(snapshot);
  const page = snapshot.page;
  if (
    page.rows.length > 21 ||
    page.rows.length > page.limit ||
    review.fingerprint !== runHistoryPageFingerprint(snapshot)
  )
    throw Error(
      "The reviewed current page is unsupported or changed; no partial CSV was prepared.",
    );
  const headers = [
      "Row kind",
      "Project ID",
      "Scope / exclusions",
      "Run-start anchor UTC",
      "Response received UTC (client)",
      "Page limit",
      "More history not included",
      "Run ID",
      "Source",
      "Status",
      "Started UTC",
      "Finished UTC",
      "Planned / ingested",
      "Recorded",
      "Remaining (manual only)",
      "Recorded % (manual only)",
      "Pass",
      "Fail",
      "Blocked",
      "Skip",
      "Flaky",
      "Other",
      "Progress basis / unavailable reason",
    ],
    scope =
      "Current displayed page only. Excludes hidden pages/lookahead, private email, CI URL, notes, procedures, media and histories. Spreadsheet summary, not full backup, frozen stakeholder approval or release readiness.",
    prefix = [
      snapshot.origin.projectId,
      scope,
      page.readContext.asOf,
      snapshot.receivedAt,
      page.limit,
      page.hasMore ? "Yes" : "No current lookahead",
    ];
  const rows: Array<Array<string | number>> = [
    [
      "CURRENT_PAGE_METADATA",
      ...prefix,
      ...Array(headers.length - prefix.length - 2).fill(""),
      `${page.rows.length} native run rows on this page; no whole-project count is inferred.`,
    ],
    ...page.rows.map((row) => [
      "RUN",
      ...prefix,
      row.id,
      row.ciProvider,
      row.status,
      row.startedAt,
      row.finishedAt ?? "Not recorded",
      row.progress?.total ?? "Unavailable",
      row.progress?.recorded ?? "Unavailable",
      row.ciProvider === "manual"
        ? (row.progress?.remaining ?? "Unavailable")
        : "Planned CI scope unavailable",
      row.ciProvider === "manual"
        ? (row.progress?.percentComplete ?? "Unavailable")
        : "Planned CI scope unavailable",
      row.progress?.pass ?? "Unavailable",
      row.progress?.fail ?? "Unavailable",
      row.progress?.blocked ?? "Unavailable",
      row.progress?.skip ?? "Unavailable",
      row.progress?.flaky ?? "Unavailable",
      row.progress?.other ?? "Unavailable",
      row.progressUnavailableReason ??
        (row.progressBasis === "CI_INGESTED_RESULTS"
          ? "Ingested observations, not planned CI coverage"
          : "Unique planned native identities/current result verdicts, not pass rate or trusted frozen all-pages completion"),
    ]),
  ];
  return renderBoundedSpreadsheetCsv(headers, rows, 22);
}
/** Only the actual reader's synchronous current() can supply fresh SDK/native
 * authority. Check again after pure encoding, immediately before parent callback. */
export function downloadReviewedRunHistoryPage(
  review: RunHistoryPageReview,
  current: () => RunHistoryReadSnapshot | null,
  download: (filename: string, content: string, mime: string) => void,
) {
  if (!matchesRunHistoryPageReview(review, current())) return false;
  const csv = renderRunHistoryPageCsv(review);
  if (!matchesRunHistoryPageReview(review, current())) return false;
  download(
    `vaettir-current-run-page-${review.snapshot.page.readContext.asOf.slice(0, 10)}.csv`,
    csv,
    "text/csv",
  );
  return true;
}
