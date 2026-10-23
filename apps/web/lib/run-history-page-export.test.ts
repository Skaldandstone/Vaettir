import { expect, it, vi } from "vitest";
import { runHistoryReadKey } from "@vaettir/api/src/services/runHistoryReadSchema";
import type { RunHistoryReadSnapshot } from "./run-history-reader";
function runFixtureSnapshot(): RunHistoryReadSnapshot {
  const input = {
    projectId: "p",
    originalOrganizationId: "o",
    expectedClerkActorId: "cl",
    expectedNativeActorId: "n",
    requestId: "fd4f8aaf-a6ec-4d25-a193-b9413ec13c25",
    limit: 1,
    asOf: "2026-09-02T00:00:00.000Z",
  };
  return {
    origin: {
      projectId: "p",
      organizationId: "o",
      clerkActorId: "cl",
      nativeActorId: "n",
    },
    observedSessionId: "A",
    epoch: 1,
    revision: 1,
    receivedAt: "2026-09-02T00:00:01.000Z",
    page: {
      readContext: {
        requestId: input.requestId,
        requestedKey: runHistoryReadKey(input),
        projection: "PAGE",
        scope: {
          projectId: "p",
          organizationId: "o",
          actorId: "n",
          actorClerkUserId: "cl",
        },
        asOf: input.asOf,
      },
      rows: [
        {
          id: "run-b",
          ciProvider: "manual",
          ciRunUrl: "https://example.invalid/private",
          commitSha: "manual",
          branch: "manual",
          status: "RUNNING",
          startedAt: "2026-09-01T00:00:00.000Z",
          finishedAt: null,
          resultCount: 1,
          startedByEmail: "private@example.invalid",
          progress: {
            total: 2,
            recorded: 1,
            remaining: 1,
            percentComplete: 50,
            pass: 1,
            fail: 0,
            blocked: 0,
            skip: 0,
            flaky: 0,
            other: 0,
          },
          progressUnavailableReason: null,
          progressBasis: "PLANNED_IDENTITIES_CURRENT_RESULTS",
        },
      ],
      limit: 1,
      hasMore: true,
      nextBefore: { id: "run-b", startedAt: "2026-09-01T00:00:00.000Z" },
      limitations: ["Current bounded page, not globally frozen."],
    },
  };
}
import {
  reviewRunHistoryPage,
  renderRunHistoryPageCsv,
  matchesRunHistoryPageReview,
  downloadReviewedRunHistoryPage,
} from "./run-history-page-export";
it("CURRENT PAGE CSV explicitly reviews whole visible metadata, omits private columns and preserves unavailable vs zero", () => {
  const snapshot = runFixtureSnapshot();
  snapshot.page.rows[0]!.progress = null;
  snapshot.page.rows[0]!.progressUnavailableReason = "Head mismatch, not zero.";
  const review = reviewRunHistoryPage(snapshot),
    csv = renderRunHistoryPageCsv(review);
  for (const text of [
    "CURRENT_PAGE_METADATA",
    "Current displayed page only",
    "lookahead",
    "Response received UTC (client)",
    "Run-start anchor UTC",
    "Unavailable",
    "Head mismatch, not zero.",
    "run-b",
    "2026-09-01T00:00:00.000Z",
  ])
    expect(csv).toContain(text);
  expect(csv).not.toContain("private@example.invalid");
  expect(csv).not.toContain("https://example.invalid/private");
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv.endsWith("\r\n")).toBe(true);
});
it("raw textual run/provider/status cells escape formulas/newlines/quotes; current-page scope not reimport/backup", () => {
  const snapshot = runFixtureSnapshot();
  snapshot.page.rows[0]!.ciProvider = '=HYPERLINK("unsafe")\n raw ';
  snapshot.page.rows[0]!.progressBasis = "CI_INGESTED_RESULTS";
  snapshot.page.rows[0]!.progress = null;
  snapshot.page.rows[0]!.progressUnavailableReason =
    "CI current projection unsupported";
  const csv = renderRunHistoryPageCsv(reviewRunHistoryPage(snapshot));
  expect(csv).toContain('"\'=HYPERLINK(""unsafe"")\n raw "');
  expect(csv).toContain("Planned CI scope unavailable");
  expect(csv).toContain("not full backup");
});
it("review deeply freezes clone; draft/source mutation does not rewrite reviewed body and current mismatch denies callback", () => {
  const snapshot = runFixtureSnapshot(),
    review = reviewRunHistoryPage(snapshot),
    download = vi.fn();
  snapshot.page.rows[0]!.status = "FAILED";
  expect(review.snapshot.page.rows[0]!.status).toBe("RUNNING");
  expect(Object.isFrozen(review.snapshot.page.rows[0]!.progress)).toBe(true);
  expect(matchesRunHistoryPageReview(review, snapshot)).toBe(false);
  expect(downloadReviewedRunHistoryPage(review, () => snapshot, download)).toBe(
    false,
  );
  expect(download).not.toHaveBeenCalled();
});
it("action-time native/session/epoch/request frame is checked twice; SDK revocation between encoding and callback prevents download", () => {
  const snapshot = runFixtureSnapshot(),
    review = reviewRunHistoryPage(snapshot),
    download = vi.fn();
  let reads = 0;
  expect(
    downloadReviewedRunHistoryPage(
      review,
      () => (++reads === 1 ? snapshot : null),
      download,
    ),
  ).toBe(false);
  expect(download).not.toHaveBeenCalled();
  expect(downloadReviewedRunHistoryPage(review, () => snapshot, download)).toBe(
    true,
  );
  expect(download).toHaveBeenCalledOnce();
});
it("empty current page exports scoped metadata only, not invented run row/project zero; malformed unsupported review refuses", () => {
  const snapshot = runFixtureSnapshot();
  snapshot.page.rows = [];
  snapshot.page.hasMore = false;
  snapshot.page.nextBefore = null;
  const csv = renderRunHistoryPageCsv(reviewRunHistoryPage(snapshot));
  expect(csv).toContain("0 native run rows on this page");
  expect(csv).not.toContain('"RUN",');
  const malformed = structuredClone(snapshot);
  malformed.page.hasMore = true;
  expect(() => reviewRunHistoryPage(malformed)).toThrow();
});
