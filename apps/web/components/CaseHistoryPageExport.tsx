"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { CaseExecutionHistoryPage } from "@vaettir/core";
import {
  caseHistoryRequestKey,
  type CaseExecutionHistoryInput,
} from "@vaettir/api/src/services/caseExecutionHistoryScopeSchema";
import {
  prepareCaseHistoryPageCsv,
  reviewCaseHistoryPageCsv,
  type CaseHistoryPageCsvReviewBinding,
} from "@/lib/case-history-page-csv";
import { Modal } from "./Modal";

type Props = {
  page: CaseExecutionHistoryPage | null;
  input: CaseExecutionHistoryInput;
  pageNumber: number;
};
type CheckedPage = {
  page: CaseExecutionHistoryPage;
  request: string;
  pageNumber: number;
  epoch: number;
  binding: CaseHistoryPageCsvReviewBinding;
};

/** Local read-time page export. This component grants no recipient or workspace access. */
export function CaseHistoryPageExport({ page, input, pageNumber }: Props) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<CheckedPage | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    page: CaseExecutionHistoryPage | null;
    request: string;
    epoch: number | undefined;
  } | null>(null);
  const [invalidation, setInvalidation] = useState(0);
  const live = useRef<{
    page: CaseExecutionHistoryPage;
    request: string;
    pageNumber: number;
    epoch: number;
  } | null>(null);
  const request = caseHistoryRequestKey(input);
  // Observe every fetching/paused/denied interval, including return of the same
  // structurally shared response object. An earlier review cannot resurrect.
  const [previous, setPrevious] = useState({
    page,
    request,
    pageNumber,
    invalidation,
    epoch: 0,
  });
  const changed =
    previous.page !== page ||
    previous.request !== request ||
    previous.pageNumber !== pageNumber ||
    previous.invalidation !== invalidation;
  const epoch = changed ? previous.epoch + 1 : previous.epoch;
  if (changed) setPrevious({ page, request, pageNumber, invalidation, epoch });
  useLayoutEffect(() => {
    live.current = page ? { page, request, pageNumber, epoch } : null;
    return () => {
      live.current = null;
    };
  }, [page, request, pageNumber, epoch]);
  const reviewed =
    !!page &&
    !!review &&
    review.page === page &&
    review.request === request &&
    review.pageNumber === pageNumber &&
    review.epoch === epoch;
  function reportMessage(text: string) {
    setMessage({ text, page, request, epoch: live.current?.epoch });
  }
  function close() {
    setInvalidation((value) => value + 1);
    live.current = null;
    setOpen(false);
    setReview(null);
    setConfirmed(false);
    setMessage(null);
  }
  function reviewPage() {
    setConfirmed(false);
    setReview(null);
    setMessage(null);
    const current = live.current;
    if (
      !page ||
      !current ||
      current.page !== page ||
      current.request !== request ||
      current.pageNumber !== pageNumber ||
      current.epoch !== epoch
    )
      return;
    try {
      const binding = reviewCaseHistoryPageCsv(page, input, pageNumber);
      setReview({ page, request, pageNumber, epoch: current.epoch, binding });
      setOpen(true);
    } catch (error) {
      setOpen(true);
      reportMessage(
        error instanceof Error
          ? error.message
          : "This exact history page cannot be exported. Nothing was downloaded.",
      );
    }
  }
  function download() {
    const current = live.current;
    if (
      !open ||
      !confirmed ||
      !reviewed ||
      !page ||
      !review ||
      !current ||
      current.epoch !== review.epoch
    )
      return;
    let url: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      // Revalidates exact immutable review bytes, scope echoes and bounded rows.
      // No historical body fetch or current-case procedure reconstruction occurs.
      const prepared = prepareCaseHistoryPageCsv(
        page,
        input,
        pageNumber,
        review.binding,
      );
      if (
        live.current !== current ||
        current.page !== page ||
        current.request !== request
      )
        return;
      url = URL.createObjectURL(
        new Blob([prepared.bytes], { type: "text/csv;charset=utf-8" }),
      );
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = prepared.filename;
      document.body.appendChild(anchor);
      anchor.click();
      reportMessage(
        `Prepared a CSV for ${prepared.count} entries on this page. Browser save completion is not verified.`,
      );
      setConfirmed(false);
    } catch (error) {
      setConfirmed(false);
      reportMessage(
        error instanceof Error
          ? error.message
          : "The complete reviewed page could not be prepared. No partial export was substituted.",
      );
    } finally {
      anchor?.remove();
      if (url) {
        const preparedUrl = url;
        setTimeout(() => URL.revokeObjectURL(preparedUrl), 0);
      }
    }
  }
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={!page}
        onClick={reviewPage}
      >
        Export this page
      </button>
      <Modal
        open={open}
        onClose={close}
        title="Review this case-history page export"
      >
        {!reviewed || !page ? (
          <>
            <p role="alert">
              This page changed or current access could not be verified. The
              earlier review is not valid. No cached export is available.
            </p>
            <button
              type="button"
              className="btn-secondary"
              disabled={!page}
              onClick={reviewPage}
            >
              Review current page again
            </button>
          </>
        ) : (
          <>
            <p>
              <strong>{page.testCase.displayId}</strong> · Page {pageNumber} ·{" "}
              {page.items.length} recorded run entries.
            </p>
            <p>
              Only this displayed page is included, not the full case history, a
              procedure backup or an approved stakeholder report.{" "}
              {page.nextCursor
                ? "Older entries remain outside this file."
                : "No older page cursor was returned; this does not include newer pages."}
            </p>
            <dl style={{ overflowWrap: "anywhere" }}>
              <dt>Read-time observation (UTC)</dt>
              <dd>{page.observedAt}</dd>
              <dt>Run-start window (UTC)</dt>
              <dd>
                {page.window
                  ? `${page.window.start} through ${page.window.end}, inclusive`
                  : "All recorded run-start dates"}
              </dd>
              <dt>Recorded source / overall run status</dt>
              <dd>
                {input.filters?.recordedSource ?? "All sources"} /{" "}
                {input.filters?.runStatus ?? "All overall statuses"}
              </dd>
              {(["platform", "build", "environment"] as const).map(
                (key) =>
                  input.filters?.[key] !== undefined && (
                    <div key={key}>
                      <dt>Exact recorded {key} filter</dt>
                      <dd style={{ whiteSpace: "pre-wrap" }}>
                        {input.filters?.[key]}
                      </dd>
                    </div>
                  ),
              )}
            </dl>
            <p>
              Includes native run identities, case label, recorded
              configuration, current outcomes and available original observation
              recorder names/times. Stored labels or configuration text may
              themselves contain identifying information; review them and
              recipients before sharing. No procedure text, private
              observations, artifact URL fields, current account/email fields or
              actor IDs are exported.
            </p>
            <p>
              Corrections are not new retests. Partial steps are not completed
              cases; imported results are not verified automation.
              Spreadsheet-leading text is protected, but re-saving or importing
              elsewhere can remove that protection.
            </p>
            <details>
              <summary>Retained page evidence limits</summary>
              <ul>
                {page.limits?.map((limit, index) => (
                  <li key={index}>{limit}</li>
                ))}
              </ul>
            </details>
            <label
              style={{
                display: "flex",
                alignItems: "start",
                gap: 8,
                marginBlock: 16,
              }}
            >
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I reviewed the current page scope, included identities and
                recorder names, and understand that this is a local read-time
                export, not an approval or access grant.
              </span>
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={!confirmed}
              onClick={download}
            >
              Prepare reviewed page CSV
            </button>
          </>
        )}
        {message &&
          !!page &&
          message.page === page &&
          message.request === request &&
          message.epoch === epoch && <p role="status">{message.text}</p>}
        <button
          type="button"
          className="btn-secondary"
          onClick={close}
          style={{ marginTop: 12 }}
        >
          Close
        </button>
      </Modal>
    </>
  );
}
