"use client";
import { useEffect, useRef, useState } from "react";
import { renderBoundedSpreadsheetCsv } from "@vaettir/core";
import { trpcReact } from "@/lib/trpcReact";
import { Modal } from "./Modal";
import { requirementCoverageRequestKey } from "@vaettir/api/src/services/requirementCoverageSchema";
import {
  requirementCoverageExportInput,
  requirementCoverageExportOutput,
  type RequirementCoverageExportInput,
  type RequirementCoverageExport as Coverage,
} from "@vaettir/api/src/services/requirementCoverageExportSchema";
import {
  coverageExportBoundaries,
  requirementCoverageExportPlan,
  renderRequirementCoverageHtml,
} from "@/lib/requirement-coverage-export";

/** Explicit full-population read and exact reviewed file; never concatenates matrix browse pages. */
export function RequirementCoverageExport({
  projectId,
  input,
  available,
  organizationId,
  clerkActorId,
  revision,
}: {
  projectId: string;
  input: RequirementCoverageExportInput;
  available: boolean;
  organizationId?: string;
  clerkActorId?: string;
  revision: number;
}) {
  const [open, setOpen] = useState(false),
    [format, setFormat] = useState<"CSV" | "HTML">("CSV"),
    [reviewed, setReviewed] = useState<Coverage | null>(null),
    [reviewedEpoch, setReviewedEpoch] = useState(-1),
    [message, setMessage] = useState("");
  const checkedInput = requirementCoverageExportInput.safeParse(input);
  const request = checkedInput.success ? checkedInput.data : input;
  const requestKey = requirementCoverageRequestKey(request);
  const ready =
    available &&
    checkedInput.success &&
    !!organizationId &&
    !!clerkActorId &&
    input.projectId === projectId &&
    input.originalOrganizationId === organizationId &&
    input.expectedClerkActorId === clerkActorId &&
    Number.isFinite(revision) &&
    revision > 0;
  const query = trpcReact.requirementCoverage.exportMatrix.useQuery(request, {
    enabled: open && ready,
    staleTime: 0,
    retry: false,
  });
  // Retain the exact query object for review identity; parsing below must not create a fresh identity each render.
  const current =
    open &&
    ready &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.organizationId === organizationId &&
    query.data.actorClerkUserId === clerkActorId &&
    query.data.requested === requestKey
      ? query.data
      : null;
  let validationMessage = "";
  if (current) {
    try {
      requirementCoverageExportOutput.parse(current);
      requirementCoverageExportPlan(current);
    } catch {
      validationMessage =
        "The complete matrix or evidence scope could not be verified. No partial or zero-substitute report is available.";
    }
  }
  const active = validationMessage ? null : current;
  const epoch = useRef(0),
    previous = useRef({
      active,
      requestKey,
      format,
      open,
      revision,
      queryRevision: query.dataUpdatedAt,
    });
  if (
    previous.current.active !== active ||
    previous.current.requestKey !== requestKey ||
    previous.current.format !== format ||
    previous.current.open !== open ||
    previous.current.revision !== revision ||
    previous.current.queryRevision !== query.dataUpdatedAt
  ) {
    epoch.current++;
    previous.current = {
      active,
      requestKey,
      format,
      open,
      revision,
      queryRevision: query.dataUpdatedAt,
    };
  }
  const live = useRef({
    active,
    requestKey,
    format,
    open,
    epoch: epoch.current,
  });
  live.current = { active, requestKey, format, open, epoch: epoch.current };
  useEffect(() => {
    setReviewed(null);
    setReviewedEpoch(-1);
  }, [active, requestKey, format, open, revision, query.dataUpdatedAt]);
  useEffect(
    () => () => {
      live.current = {
        active: null,
        requestKey: "",
        format: "CSV",
        open: false,
        epoch: -1,
      };
    },
    [],
  );
  function close() {
    live.current.open = false;
    setOpen(false);
    setReviewed(null);
    setReviewedEpoch(-1);
  }
  const canDownload =
    !!active && reviewed === active && reviewedEpoch === epoch.current && open;
  function download() {
    if (!canDownload || !active) return;
    try {
      const plan = requirementCoverageExportPlan(active);
      const encoded =
        format === "CSV"
          ? renderBoundedSpreadsheetCsv(plan.headers, plan.rows, 1100)
          : renderRequirementCoverageHtml(active);
      if (
        live.current.active !== active ||
        live.current.requestKey !== requestKey ||
        live.current.format !== format ||
        !live.current.open ||
        live.current.epoch !== reviewedEpoch
      )
        return;
      // Consume this exact review before any side effect, without claiming browser file-save proof.
      live.current.open = false;
      setReviewed(null);
      setReviewedEpoch(-1);
      const anchor = document.createElement("a");
      const url = URL.createObjectURL(
        new Blob([encoded], {
          type:
            format === "CSV"
              ? "text/csv;charset=utf-8"
              : "text/html;charset=utf-8",
        }),
      );
      try {
        anchor.href = url;
        anchor.download = `vaettir-current-requirement-matrix-${active.observedAt.slice(0, 10)}.${format === "CSV" ? "csv" : "html"}`;
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      close();
      setMessage(
        "Complete selected matrix file prepared. Check browser downloads and recipient suitability; no approval, external access or delivery was created.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The complete report could not be prepared. No partial file was substituted.",
      );
    }
  }
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={!ready}
        onClick={() => {
          setMessage("");
          setReviewed(null);
          setReviewedEpoch(-1);
          setOpen(true);
        }}
      >
        Export requirement matrix
      </button>
      {ready && message && <p role="status">{message}</p>}
      <Modal
        open={open}
        onClose={close}
        title="Review complete requirement matrix report"
        size="wide"
      >
        {!ready ? (
          <p role="alert">
            Current signed-in actor and original organization access must be
            reverified. Retained report content is hidden.
          </p>
        ) : query.error ? (
          <div role="alert">
            <p>
              The complete selected population could not be loaded. Oversized or
              unsupported populations are refused as a whole, not exported as a
              partial page. {query.error.message}
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void query.refetch()}
            >
              Retry complete matrix
            </button>
          </div>
        ) : query.isPaused ? (
          <p role="status">
            Waiting for a connection to verify the full current population.
            Retained report content is hidden.
          </p>
        ) : validationMessage ? (
          <p role="alert">{validationMessage}</p>
        ) : !active ? (
          <p role="status">
            Verifying the complete selected matrix in one fresh transaction…
          </p>
        ) : (
          <>
            <p>
              {active.population.requirements} selected current requirements;{" "}
              {active.population.unlinkedRequirements} without explicit case
              links; {active.population.directPairs} direct relationships;{" "}
              {active.population.distinctCases} distinct cases (
              {active.population.archivedCases} currently archived).
            </p>
            <p>
              Observed UTC {active.observedAt}. Run-start window{" "}
              {active.window.start} through {active.window.end}. This is the
              complete selected population, not the visible twenty-row browse
              page.
            </p>
            <p>
              {active.population.distinctCaseResultRecords} recorded result rows
              across distinct linked cases. Case rows repeated across
              requirements repeat those outcomes; do not sum matrix rows into a
              unique result denominator.
            </p>
            <label style={{ display: "grid", gap: 6, marginBlock: 12 }}>
              File format
              <select
                style={{ width: "100%", minWidth: 0 }}
                value={format}
                onChange={(event) => {
                  if (
                    event.target.value === "CSV" ||
                    event.target.value === "HTML"
                  )
                    setFormat(event.target.value);
                }}
              >
                <option value="CSV">CSV for spreadsheets</option>
                <option value="HTML">
                  Portable HTML for stakeholder review and printing
                </option>
              </select>
            </label>
            {format === "HTML" && (
              <p>
                Text-only offline report. Open the downloaded file and use
                browser Print if needed. Vaettir does not generate a PDF,
                approve a snapshot or deliver this file.
              </p>
            )}
            <details>
              <summary>Applied selections and sharing boundaries</summary>
              <p>
                Requirement title search:{" "}
                {active.searchPresence
                  ? "Applied; literal search is omitted from the file"
                  : "Not applied"}
                .
              </p>
              <dl>
                {Object.entries(active.appliedScope ?? {}).map(
                  ([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd style={{ overflowWrap: "anywhere" }}>{value}</dd>
                    </div>
                  ),
                )}
              </dl>
              <ul>
                {[...coverageExportBoundaries, ...active.limits].map(
                  (limit, index) => (
                    <li key={index}>{limit}</li>
                  ),
                )}
              </ul>
            </details>
            <details>
              <summary>Preview complete selected report rows</summary>
              <p>
                Title excerpts and archived cases are labelled. Requirement
                numbers are local to this report, not permanent requirement IDs.
                No case procedures or private result notes are included.
              </p>
              <div
                className="table-scroll"
                role="region"
                aria-label="Complete requirement report preview"
                tabIndex={0}
              >
                <table
                  className="workspace-table"
                  style={{ width: "100%", minWidth: 720 }}
                >
                  <thead>
                    <tr>
                      <th scope="col">Requirement</th>
                      <th scope="col">Case</th>
                      <th scope="col">Recorded outcomes</th>
                      <th scope="col">Planned without result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.rows.map((row, index) => (
                      <tr key={index}>
                        <td>
                          {row.requirementOrdinal} · {row.requirementTitle}
                          {row.titleIsExcerpt && " · Title excerpt"}
                        </td>
                        <td>
                          {row.case ? (
                            <>
                              {row.case.displayId} · {row.case.title}
                              {row.case.titleIsExcerpt && " · Title excerpt"}
                              {row.case.archived && (
                                <strong> · Currently archived</strong>
                              )}
                            </>
                          ) : (
                            "No explicit case links"
                          )}
                        </td>
                        <td>
                          {row.outcomes.state.replaceAll("_", " ")}
                          <div>
                            Pass {row.outcomes.PASS} · Fail {row.outcomes.FAIL}{" "}
                            · Flaky {row.outcomes.FLAKY} · Skip{" "}
                            {row.outcomes.SKIP} · Blocked {row.outcomes.BLOCKED}
                          </div>
                        </td>
                        <td>{row.plannedWithoutResult}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "start",
                marginBlock: 16,
              }}
            >
              <input
                type="checkbox"
                checked={canDownload}
                onChange={(event) => {
                  setReviewed(event.target.checked ? active : null);
                  setReviewedEpoch(event.target.checked ? epoch.current : -1);
                }}
              />
              I reviewed this exact complete population, applied scope,
              repeated-case counts, title excerpts and recipient suitability for
              this file format.
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={!canDownload}
              onClick={download}
            >
              Prepare reviewed file
            </button>
          </>
        )}
        <button
          type="button"
          className="btn-secondary"
          style={{ marginLeft: 8 }}
          onClick={close}
        >
          Cancel
        </button>
      </Modal>
    </>
  );
}
