"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { DialogFrame } from "./ui/DialogFrame";
import {
  recordedExecutionTrendInput,
  recordedExecutionTrendKey,
  type RecordedExecutionTrendInput,
} from "@vaettir/api/src/services/recordedExecutionTrendSchema";
import {
  defaultExecutionTrendDates,
  EXECUTION_OUTCOMES,
  EXECUTION_OUTCOME_COLORS,
  renderRecordedExecutionTrendCsv,
  executionTrendPeriods,
  type ExecutionTrendGrouping,
  type ExecutionTrendPeriod,
} from "@/lib/recorded-execution-trend";
type Trend = RouterOutputs["recordedExecutionTrends"]["summary"];
const fieldStyle = { width: "100%", boxSizing: "border-box" as const };
export function RecordedExecutionTrend({ projectId }: { projectId: string }) {
  return <ExecutionTrend key={projectId} projectId={projectId} />;
}
function ExecutionTrend({ projectId }: { projectId: string }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    { retry: false, staleTime: 0 },
  );
  const organizations = trpcReact.organization.mine.useQuery(undefined, {
    retry: false,
    staleTime: 0,
  });
  const organizationId =
    project.data?.id === projectId ? project.data.organizationId : undefined;
  const accessReady =
    isLoaded &&
    !!isSignedIn &&
    !!userId &&
    !!organizationId &&
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    !organizations.error &&
    !organizations.isFetching &&
    !organizations.isPaused &&
    !!organizations.data?.some((row) => row.id === organizationId);
  const [origin, setOrigin] = useState<{
    organizationId: string;
    actorId: string;
  } | null>(null);
  useEffect(() => {
    if (!origin && accessReady)
      setOrigin({ organizationId: organizationId!, actorId: userId! });
  }, [origin, accessReady, organizationId, userId]);
  const sameOrigin =
    accessReady &&
    origin?.organizationId === organizationId &&
    origin?.actorId === userId;
  const [dates, setDates] = useState(() => defaultExecutionTrendDates());
  const [filters, setFilters] = useState({
    platform: "",
    environment: "",
    build: "",
  });
  const [applied, setApplied] = useState<RecordedExecutionTrendInput | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [reviewed, setReviewed] = useState<Trend | null>(null);
  const [grouping, setGrouping] = useState<ExecutionTrendGrouping>("DAY");
  const [reviewedGrouping, setReviewedGrouping] =
    useState<ExecutionTrendGrouping | null>(null);
  const [includeRecordedDuration, setIncludeRecordedDuration] = useState(false);
  const [reviewedDuration, setReviewedDuration] = useState<boolean | null>(
    null,
  );
  const query = trpcReact.recordedExecutionTrends.summary.useQuery(
    applied ?? {
      projectId,
      originalOrganizationId: organizationId ?? "unavailable",
      ...dates,
    },
    { enabled: !!applied && sameOrigin, retry: false, staleTime: 0 },
  );
  const availableData =
    sameOrigin &&
    applied &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.organizationId === origin?.organizationId &&
    query.data.clerkActorId === userId &&
    query.data.requestKey === recordedExecutionTrendKey(applied)
      ? query.data
      : null;
  let periods: ExecutionTrendPeriod[] = [];
  let periodError = "";
  if (availableData) {
    try {
      periods = executionTrendPeriods(availableData, grouping);
    } catch (error) {
      periodError =
        error instanceof Error
          ? error.message
          : "Complete recorded periods are unavailable.";
    }
  }
  const data = periodError ? null : availableData;
  useEffect(() => {
    setReviewed(null);
    setReviewedGrouping(null);
    setReviewedDuration(null);
  }, [
    query.dataUpdatedAt,
    query.isFetching,
    query.isPaused,
    query.error,
    sameOrigin,
    applied,
    exportOpen,
    grouping,
    includeRecordedDuration,
  ]);
  const latest = useRef({
    data,
    exportOpen,
    grouping,
    includeRecordedDuration,
  });
  latest.current = { data, exportOpen, grouping, includeRecordedDuration };
  function applyScope(event: FormEvent) {
    event.preventDefault();
    if (!sameOrigin) return;
    const parsed = recordedExecutionTrendInput.safeParse({
      projectId,
      originalOrganizationId: origin!.organizationId,
      ...dates,
      ...Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value.length > 0),
      ),
    });
    if (!parsed.success) {
      setMessage(
        "Choose valid inclusive UTC dates up to 90 days, with no future dates. Exact recorded filters must fit their supported bounds.",
      );
      return;
    }
    setApplied(parsed.data);
    setSelectedDay("");
    setReviewed(null);
    setMessage("");
  }
  function download() {
    if (
      !exportOpen ||
      !data ||
      reviewed !== data ||
      reviewedGrouping !== grouping ||
      reviewedDuration !== includeRecordedDuration
    )
      return;
    try {
      const csv = renderRecordedExecutionTrendCsv(
        data,
        grouping,
        includeRecordedDuration,
      );
      if (
        latest.current.data !== data ||
        !latest.current.exportOpen ||
        latest.current.grouping !== grouping ||
        latest.current.includeRecordedDuration !== includeRecordedDuration
      )
        return;
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `vaettir-recorded-outcomes-${grouping.toLowerCase()}${includeRecordedDuration ? "-duration" : ""}-${data.scope.start}-${data.scope.end}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        "CSV prepared from the reviewed read-time data. Check your browser downloads.",
      );
      setExportOpen(false);
      setReviewed(null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "CSV could not be prepared. Nothing was replaced.",
      );
    }
  }
  return (
    <section
      style={{ display: "grid", gap: 18, minWidth: 0 }}
      aria-label="Daily recorded execution outcomes"
    >
      <header>
        <p className="eyebrow">Quality intelligence · recorded evidence</p>
        <h1>Execution over time</h1>
        <p>
          See recorded outcomes by UTC run-start day, then inspect the runs
          behind a day. These are result observations, not unique attempts, a
          flake rate or a release verdict.
        </p>
        <Link href={`/projects/${projectId}/reports`}>
          Create or browse approved stakeholder report snapshots
        </Link>
      </header>
      {!sameOrigin && (
        <p role="status">
          {origin &&
          (origin.organizationId !== organizationId ||
            origin.actorId !== userId)
            ? "The account or workspace changed. Previous evidence and retained filters are hidden; return to the original scope or open a separate view."
            : "Verifying current workspace access. Cached evidence is hidden."}
        </p>
      )}
      {sameOrigin && (
        <form
          onSubmit={applyScope}
          style={{
            display: "grid",
            gap: 12,
            border: "1px solid var(--line)",
            padding: 16,
            borderRadius: 10,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(min(100%,200px),1fr))",
              gap: 12,
            }}
          >
            <label>
              Start date (UTC, inclusive)
              <input
                style={fieldStyle}
                type="date"
                required
                value={dates.start}
                onChange={(event) =>
                  setDates({ ...dates, start: event.target.value })
                }
              />
            </label>
            <label>
              End date (UTC, inclusive)
              <input
                style={fieldStyle}
                type="date"
                required
                max={new Date().toISOString().slice(0, 10)}
                value={dates.end}
                onChange={(event) =>
                  setDates({ ...dates, end: event.target.value })
                }
              />
            </label>
          </div>
          <details>
            <summary>Recorded configuration filters (optional)</summary>
            <p>
              Exact recorded values combine with AND. No inferred platform or
              repository label; missing/unsupported configuration does not
              match. Applying different criteria replaces this view, not any
              stored report.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit,minmax(min(100%,180px),1fr))",
                gap: 12,
              }}
            >
              {(["platform", "environment", "build"] as const).map((key) => (
                <label key={key}>
                  {key[0]!.toUpperCase() + key.slice(1)}
                  <input
                    style={fieldStyle}
                    maxLength={key === "environment" ? 2000 : 300}
                    value={filters[key]}
                    onChange={(event) =>
                      setFilters({ ...filters, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="submit"
              className="btn-primary"
              disabled={query.isFetching}
            >
              Show recorded outcomes
            </button>
            {applied && (
              <button
                type="button"
                className="btn-secondary"
                disabled={query.isFetching || query.isPaused}
                onClick={() => void query.refetch()}
              >
                Refresh applied scope
              </button>
            )}
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      {sameOrigin && applied && (
        <label>
          Group recorded outcomes
          <select
            value={grouping}
            onChange={(event) => {
              setGrouping(event.target.value === "WEEK" ? "WEEK" : "DAY");
              setReviewed(null);
              setReviewedGrouping(null);
              setSelectedDay("");
            }}
          >
            <option value="DAY">UTC days</option>
            <option value="WEEK">UTC weeks (Monday start)</option>
          </select>
        </label>
      )}
      {periodError && (
        <p role="alert">
          {periodError} Incomplete evidence is not displayed or exported.
        </p>
      )}
      {sameOrigin && applied && query.error && (
        <p role="alert">
          Evidence could not be loaded: {query.error.message}. No empty or
          zero-count report is substituted.
        </p>
      )}
      {sameOrigin && applied && (query.isFetching || query.isPaused) && (
        <p role="status">
          {query.isPaused
            ? "Waiting for connectivity; cached evidence is hidden."
            : "Reading complete bounded scope; previous counts are hidden."}
        </p>
      )}
      {data && (
        <>
          <section
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns:
                "repeat(auto-fit,minmax(min(100%,155px),1fr))",
            }}
            aria-label="Recorded scope totals"
          >
            {[
              ["Runs", data.totals.runs],
              ["Result observations", data.totals.results],
              ["Same-project mapped", data.totals.mapped],
              ["Unmatched", data.totals.unmatched],
              ["Unavailable mapping", data.totals.unavailableMapping],
              ["In-progress runs", data.totals.inProgressRuns],
            ].map(([label, count]) => (
              <div key={label} className="metric-card">
                <span className="metric-top">{label}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </section>
          <p>
            Applied UTC window: {data.windowStart} through {data.windowEnd}.
            Read at {data.asOf}.{" "}
            {(["platform", "environment", "build"] as const)
              .filter((key) => data.scope[key])
              .map((key) => (
                <span key={key}>
                  {" "}
                  {key}: {data.scope[key]}.
                </span>
              ))}
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              justifyContent: "space-between",
            }}
          >
            <h2 style={{ margin: 0 }}>
              {grouping === "DAY" ? "Daily" : "Weekly"} outcomes
            </h2>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setExportOpen(true);
                setReviewed(null);
              }}
            >
              Review aggregate CSV
            </button>
          </div>
          {grouping === "WEEK" && (
            <p>
              Weeks start Monday UTC. Partial weeks are labeled and not
              normalized; different lengths cannot establish a velocity change.
              Expand a period to inspect its recorded days.
            </p>
          )}
          <div className="table-scroll">
            <table className="workspace-table">
              <caption>
                Zero days are shown only after the complete scope was
                successfully read. Bar lengths share the largest displayed
                period result count; numeric counts remain authoritative.
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    UTC run-start {grouping === "DAY" ? "day" : "period"}
                  </th>
                  <th scope="col">Runs</th>
                  <th scope="col">Result observations</th>
                  <th scope="col">Recorded distribution</th>
                  {EXECUTION_OUTCOMES.map((status) => (
                    <th scope="col" key={status}>
                      {status === "FLAKY" ? "FLAKY (reported)" : status}
                    </th>
                  ))}
                  <th scope="col">Inspect</th>
                </tr>
              </thead>
              <tbody>
                {[...periods].reverse().map((day) => (
                  <tr key={day.key}>
                    <th scope="row">
                      {day.start}
                      {grouping === "WEEK" && (
                        <>
                          {" "}
                          through {day.end}
                          {day.partialWeek && <small> · partial week</small>}
                        </>
                      )}
                    </th>
                    <td>
                      {day.runs}
                      {day.inProgressRuns > 0 && (
                        <small> · {day.inProgressRuns} in progress</small>
                      )}
                    </td>
                    <td>{day.results}</td>
                    <td>
                      <div
                        aria-hidden="true"
                        style={{ width: 160, height: 10 }}
                      >
                        <div
                          style={{
                            display: "flex",
                            height: 10,
                            width: `${(100 * day.results) / Math.max(1, ...periods.map((row) => row.results))}%`,
                            borderRadius: 6,
                            overflow: "hidden",
                          }}
                        >
                          {EXECUTION_OUTCOMES.map((status) => (
                            <span
                              key={status}
                              style={{
                                flex: day.outcomes[status],
                                background: EXECUTION_OUTCOME_COLORS[status],
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </td>
                    {EXECUTION_OUTCOMES.map((status) => (
                      <td key={status}>{day.outcomes[status]}</td>
                    ))}
                    <td>
                      {grouping === "DAY" ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={day.runs === 0}
                          onClick={() => setSelectedDay(day.start)}
                        >
                          View runs
                          <span className="sr-only"> on {day.start}</span>
                        </button>
                      ) : (
                        <details>
                          <summary>Inspect days ({day.days.length})</summary>
                          <ul>
                            {day.days.map((recordedDay) => (
                              <li key={recordedDay.day}>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  disabled={recordedDay.runs === 0}
                                  onClick={() =>
                                    setSelectedDay(recordedDay.day)
                                  }
                                >
                                  {recordedDay.day}: {recordedDay.runs} runs,{" "}
                                  {recordedDay.results} observations
                                </button>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Recorded duration and completion evidence</summary>
            <p>
              {data.totals.timedResults} observations have a valid recorded
              duration, totaling {data.totals.sumDurationMs.toLocaleString()}{" "}
              ms. {data.totals.missingDurations} observations have missing
              durations; {data.totals.invalidDurations} have invalid negative
              durations. These sums include repeated observations and
              in-progress runs, not elapsed wall-clock time, human effort, cost
              or comparable performance.
            </p>
            <p>
              {data.totals.finishedRecordedRuns} runs have a recorded
              completion; {data.totals.completionUnavailableRuns} have
              unavailable completion evidence. {data.totals.inProgressResults}{" "}
              observations belong to in-progress runs. Stored run status alone
              cannot certify completion evidence.
            </p>
            <div className="table-scroll">
              <table className="workspace-table">
                <caption>
                  Exact recorded duration coverage by included UTC period.
                  Unknown duration is not zero.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Included UTC dates</th>
                    <th scope="col">Timed observations</th>
                    <th scope="col">Valid duration sum (ms)</th>
                    <th scope="col">Missing duration</th>
                    <th scope="col">Invalid duration</th>
                    <th scope="col">Recorded completed runs</th>
                    <th scope="col">Completion unavailable</th>
                    <th scope="col">In-progress observations</th>
                  </tr>
                </thead>
                <tbody>
                  {[...periods].reverse().map((period) => (
                    <tr key={period.key}>
                      <th scope="row">
                        {period.start}
                        {period.end !== period.start && (
                          <> through {period.end}</>
                        )}
                        {period.partialWeek && <small> · partial week</small>}
                      </th>
                      <td>{period.timedResults}</td>
                      <td>{period.sumDurationMs}</td>
                      <td>{period.missingDurations}</td>
                      <td>{period.invalidDurations}</td>
                      <td>{period.finishedRecordedRuns}</td>
                      <td>{period.completionUnavailableRuns}</td>
                      <td>{period.inProgressResults}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>Evidence boundaries</summary>
            <ul>
              {data.limitations.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
          {selectedDay && applied && (
            <TrendRunDrilldown
              key={selectedDay + recordedExecutionTrendKey(applied)}
              projectId={projectId}
              scope={applied}
              day={selectedDay}
              organizationId={origin!.organizationId}
              actorId={userId!}
              onClose={() => setSelectedDay("")}
            />
          )}
        </>
      )}
      <DialogFrame
        open={exportOpen}
        onClose={() => {
          setExportOpen(false);
          setReviewed(null);
        }}
        className="modal-dialog"
        label="Review recorded outcome CSV"
      >
        <h2>Review aggregate CSV</h2>
        {!data ? (
          <p role="status">
            Current scoped evidence is unavailable. Previous review is invalid;
            nothing can be exported.
          </p>
        ) : (
          <>
            <p>
              {data.days.length} UTC days, {data.totals.runs} runs and{" "}
              {data.totals.results} result observations. Window:{" "}
              {data.windowStart} through {data.windowEnd}.
            </p>
            <p>
              Export grouping:{" "}
              {grouping === "DAY"
                ? "UTC days"
                : "Monday-start UTC weeks with actual included dates and partial-week labels"}
              . {periods.length} displayed periods; no normalized velocity is
              inferred.
            </p>
            <p>
              This is a read-time CSV, not an immutable approved stakeholder
              snapshot. It includes exact selected configuration labels and
              evidence limits, but no raw run/case identities, source, notes or
              errors. Review its recipients; it grants no access.
            </p>
            <label
              style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
            >
              <input
                type="checkbox"
                checked={includeRecordedDuration}
                onChange={(event) => {
                  setIncludeRecordedDuration(event.target.checked);
                  setReviewed(null);
                  setReviewedDuration(null);
                }}
              />{" "}
              Include recorded duration and completion evidence (seven
              additional columns)
            </label>
            {includeRecordedDuration && (
              <p>
                The CSV preserves valid duration sums in milliseconds,
                missing/invalid counts and incomplete completion evidence. It
                does not estimate human effort, normalize throughput, compare
                performance or certify completed tests.
              </p>
            )}
            <label
              style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
            >
              <input
                type="checkbox"
                checked={
                  reviewed === data &&
                  reviewedGrouping === grouping &&
                  reviewedDuration === includeRecordedDuration
                }
                onChange={(event) => {
                  setReviewed(event.target.checked ? data : null);
                  setReviewedGrouping(event.target.checked ? grouping : null);
                  setReviewedDuration(
                    event.target.checked ? includeRecordedDuration : null,
                  );
                }}
              />{" "}
              I reviewed these exact current counts, grouping, optional duration
              columns, scope labels and sharing boundaries.
            </label>
          </>
        )}
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}
        >
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setExportOpen(false);
              setReviewed(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={
              !data ||
              reviewed !== data ||
              reviewedGrouping !== grouping ||
              reviewedDuration !== includeRecordedDuration
            }
            onClick={download}
          >
            Prepare CSV
          </button>
        </div>
      </DialogFrame>
    </section>
  );
}
function TrendRunDrilldown({
  projectId,
  scope,
  day,
  organizationId,
  actorId,
  onClose,
}: {
  projectId: string;
  scope: RecordedExecutionTrendInput;
  day: string;
  organizationId: string;
  actorId: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const query = trpcReact.recordedExecutionTrends.runs.useQuery(
    { ...scope, day, page },
    { retry: false, staleTime: 0 },
  );
  const data =
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.organizationId === organizationId &&
    query.data.clerkActorId === actorId &&
    query.data.requestKey === recordedExecutionTrendKey(scope) &&
    query.data.day === day &&
    query.data.page === page
      ? query.data
      : null;
  return (
    <DialogFrame
      open
      onClose={onClose}
      className="modal-dialog"
      label={`Recorded runs on ${day}`}
    >
      <h2>Runs on {day} UTC</h2>
      <p>
        Fresh metadata drill-down using the same applied filters. Counts may
        have changed since the daily view; this is not a frozen report or
        equivalent-run certification. Labels are recorded, not provider/device
        verification.
      </p>
      {query.error && (
        <p role="alert">
          Runs could not be read: {query.error.message}. No empty result is
          substituted.
        </p>
      )}
      {(query.isFetching || query.isPaused) && (
        <p role="status">
          Current runs are unavailable while reading or offline; cached rows are
          hidden.
        </p>
      )}
      {data && (
        <>
          <p>
            {data.total} matching runs · page {page + 1}
          </p>
          <ul
            style={{ display: "grid", gap: 12, padding: 0, listStyle: "none" }}
          >
            {data.runs.map((run) => (
              <li
                key={run.id}
                style={{
                  border: "1px solid var(--line)",
                  padding: 12,
                  borderRadius: 8,
                }}
              >
                <Link href={`/projects/${projectId}/test-runs#run-${run.id}`}>
                  {run.startedAt} · {run.status}
                </Link>
                <p>
                  {run.provider}
                  {run.providerExcerpt ? " (excerpt)" : ""}
                </p>
                <dl>
                  {(["build", "platform", "environment"] as const).map(
                    (key) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd
                          style={{
                            overflowWrap: "anywhere",
                            marginInlineStart: 0,
                          }}
                        >
                          {run[key] ?? "Not recorded in supported context"}
                          {run[
                            key === "build"
                              ? "buildExcerpt"
                              : key === "platform"
                                ? "platformExcerpt"
                                : "environmentExcerpt"
                          ]
                            ? " (excerpt)"
                            : ""}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </li>
            ))}
          </ul>
          {data.total === 0 && (
            <p>
              No matching runs currently recorded for this day and applied
              scope.
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!data.hasMore}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void query.refetch()}
        >
          Refresh this page
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </DialogFrame>
  );
}
