"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { DialogFrame } from "./ui/DialogFrame";
import { trpcReact } from "@/lib/trpcReact";
import type { CaseQuery } from "@vaettir/api/src/services/caseQuerySchema";

export function CaseQueryExport({
  projectId,
  organizationId,
  query,
  columns,
  requestKey,
  enabled,
}: {
  projectId: string;
  organizationId: string;
  query: CaseQuery;
  columns: string[];
  requestKey: string;
  enabled: boolean;
}) {
  // Exact applied definition/column or project changes discard an old review.
  return (
    <Export
      key={JSON.stringify([
        organizationId,
        projectId,
        query,
        columns,
        requestKey,
      ])}
      projectId={projectId}
      organizationId={organizationId}
      query={query}
      columns={columns}
      enabled={enabled}
    />
  );
}
function Export({
  projectId,
  organizationId,
  query,
  columns,
  enabled,
}: {
  projectId: string;
  organizationId: string;
  query: CaseQuery;
  columns: string[];
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [requestId, setRequestId] = useState<string | null>(null),
    [format, setFormat] = useState<"METADATA" | "AGGREGATES">("METADATA"),
    [message, setMessage] = useState("");
  const input = {
    projectId,
    query,
    columns,
    format,
    requestId: requestId ?? "00000000-0000-4000-8000-000000000000",
  };
  const review = trpcReact.caseQueryExport.review.useQuery(input, {
    enabled: enabled && open && !!requestId,
    retry: false,
    staleTime: 0,
  });
  const approval = trpcReact.caseQueryExport.confirm.useMutation();
  type ReviewData = NonNullable<typeof review.data>;
  const [checkedReview, setCheckedReview] = useState<{
    data: ReviewData;
    epoch: number;
  } | null>(null);
  const fresh =
    enabled &&
    open &&
    requestId &&
    !approval.error &&
    !approval.isPaused &&
    !review.error &&
    !review.isFetching &&
    !review.isPaused &&
    review.data?.projectId === projectId &&
    review.data.organizationId === organizationId &&
    review.data.requestId === requestId &&
    review.data.format === format &&
    JSON.stringify(review.data.columns) === JSON.stringify(columns)
      ? review.data
      : null;
  const [invalidation, setInvalidation] = useState(0);
  const live = useRef<{
    scope: string;
    epoch: number;
    data: ReviewData;
  } | null>(null);
  const scope = fresh
    ? JSON.stringify([
        organizationId,
        projectId,
        requestId,
        format,
        fresh.fingerprint,
      ])
    : "";
  // Every observed unavailable interval is a new epoch, even if the same
  // request/fingerprint/data object returns later via structural sharing.
  const [previous, setPrevious] = useState({
    scope,
    data: fresh,
    invalidation,
    epoch: 0,
  });
  const changed =
    previous.scope !== scope ||
    previous.data !== fresh ||
    previous.invalidation !== invalidation;
  const epoch = changed ? previous.epoch + 1 : previous.epoch;
  if (changed) setPrevious({ scope, data: fresh, invalidation, epoch });
  useLayoutEffect(() => {
    live.current = fresh ? { scope, epoch, data: fresh } : null;
    return () => {
      live.current = null;
    };
  }, [fresh, scope, epoch]);
  const confirmed =
    !!fresh &&
    !!checkedReview &&
    checkedReview.data === fresh &&
    checkedReview.epoch === epoch;
  function invalidateReview() {
    setInvalidation((value) => value + 1);
    live.current = null;
    setCheckedReview(null);
  }
  function resetReview() {
    invalidateReview();
    setRequestId(crypto.randomUUID());
    setMessage("");
    approval.reset();
  }
  function close() {
    invalidateReview();
    setOpen(false);
    setRequestId(null);
  }
  async function download() {
    if (!fresh || !confirmed || approval.isPending || approval.isPaused) return;
    const launch = live.current;
    if (
      !launch ||
      launch.data !== fresh ||
      checkedReview?.epoch !== launch.epoch
    )
      return;
    setMessage("");
    try {
      const result = await approval.mutateAsync({
        ...input,
        organizationId,
        expectedFingerprint: fresh.fingerprint,
        confirmed: true,
      });
      if (
        !live.current ||
        live.current.epoch !== launch.epoch ||
        live.current.scope !== launch.scope ||
        live.current.data !== launch.data ||
        result.projectId !== projectId ||
        result.requestId !== requestId ||
        result.organizationId !== organizationId ||
        result.fingerprint !== fresh.fingerprint
      )
        return;
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      try {
        document.body.append(link);
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage(
        `CSV prepared for the complete ${result.total}-case query. Check your browser downloads. This is current inventory, not execution approval.`,
      );
    } catch (error) {
      if (
        !live.current ||
        live.current.epoch !== launch.epoch ||
        live.current.data !== launch.data
      )
        return;
      invalidateReview();
      setMessage(
        error instanceof Error
          ? error.message
          : "Export could not be confirmed. Review the complete query again.",
      );
    }
  }
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={!enabled}
        onClick={() => {
          setOpen(true);
          resetReview();
        }}
      >
        Export whole query
      </button>
      <DialogFrame
        open={open}
        onClose={close}
        label="Review whole-query CSV export"
        className="modal-panel"
        style={{
          width: "min(900px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 32px)",
          overflow: "auto",
        }}
      >
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
          }}
        >
          <h2 style={{ flex: 1, margin: 0 }}>Export whole applied query</h2>
          <button
            type="button"
            className="btn-secondary"
            onClick={close}
            aria-label="Close query export"
          >
            Close
          </button>
        </header>
        <p>
          Review every matching case, not only the visible 50-row page. No
          credits are used.
        </p>
        <label>
          Export format
          <select
            value={format}
            disabled={approval.isPending}
            onChange={(event) => {
              setFormat(event.target.value as "METADATA" | "AGGREGATES");
              resetReview();
            }}
          >
            <option value="METADATA">Selected case metadata</option>
            <option value="AGGREGATES">Inventory count summary</option>
          </select>
        </label>
        <details>
          <summary>Exact applied criteria and selected columns</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify({ query, columns }, null, 2)}
          </pre>
        </details>
        {!enabled && (
          <p role="alert">
            Refresh current project access and applied query results before
            reviewing or downloading.
          </p>
        )}
        {enabled && (review.isFetching || review.isPaused) && (
          <p role="status">
            {review.isPaused
              ? "Export review is paused. Reconnect and review again."
              : "Reading the complete bounded query population…"}
          </p>
        )}
        {enabled && review.error && <p role="alert">{review.error.message}</p>}
        {enabled && approval.error && (
          <p role="alert">
            {approval.error.message} Review the whole current query again before
            another download.
          </p>
        )}
        {fresh && (
          <>
            <p>
              <strong>{fresh.projectName}</strong> · Project key:{" "}
              {fresh.caseKey ?? "Unavailable"}
            </p>
            <p>
              <strong>{fresh.total} matching cases</strong> ·{" "}
              {fresh.byteLength.toLocaleString()} UTF-8 bytes · Read at{" "}
              {fresh.asOf}
            </p>
            <p>
              This confirmation rechecks the entire current population. A
              changed case, identity, project, field definition or scope
              requires a new review.
            </p>
            <details>
              <summary>Evidence fingerprint</summary>
              <p style={{ overflowWrap: "anywhere" }}>{fresh.fingerprint}</p>
            </details>
            {format === "METADATA" && (
              <div
                tabIndex={0}
                aria-label="Sample of selected export metadata"
                style={{ overflowX: "auto" }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Case ID</th>
                      <th>Archived</th>
                      {fresh.headers.map((header, index) => (
                        <th key={index}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fresh.sample.map((row, index) => (
                      <tr key={index}>
                        {row.map((cell, column) => (
                          <td
                            key={column}
                            style={{ maxWidth: 240, overflowWrap: "anywhere" }}
                          >
                            {cell === "" ? "Empty text" : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  Sample only: up to five rows. The CSV includes all{" "}
                  {fresh.total} cases, or refuses without producing a partial
                  file.
                </p>
              </div>
            )}
            {format === "AGGREGATES" && (
              <div tabIndex={0} style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Inventory field</th>
                      <th>Value</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fresh.aggregates.map((row, index) => (
                      <tr key={index}>
                        <td>{row.field}</td>
                        <td>{row.value}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  Only selected type, priority, automation and review
                  distributions plus archived state. Custom values and titles
                  are not grouped or exported in count summary mode.
                </p>
              </div>
            )}
            <details open>
              <summary>Export boundaries and recipient review</summary>
              <ul>
                {fresh.limitations.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>
            <label style={{ display: "flex", gap: 8, alignItems: "start" }}>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={approval.isPending}
                onChange={(event) =>
                  setCheckedReview(
                    event.target.checked && fresh && live.current
                      ? { data: fresh, epoch: live.current.epoch }
                      : null,
                  )
                }
              />
              I reviewed the complete scope, selected current metadata and
              recipient risks. This is not a full-fidelity backup or a release
              verdict.
            </label>
          </>
        )}
        {message && <p role={approval.error ? "alert" : "status"}>{message}</p>}
        <footer
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}
        >
          <button
            type="button"
            className="btn-secondary"
            disabled={!enabled || approval.isPending}
            onClick={resetReview}
          >
            Review current whole query again
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={
              !fresh || !confirmed || approval.isPending || approval.isPaused
            }
            onClick={() => void download()}
          >
            {approval.isPending
              ? "Rechecking whole query…"
              : "Confirm and download CSV"}
          </button>
        </footer>
      </DialogFrame>
    </>
  );
}
