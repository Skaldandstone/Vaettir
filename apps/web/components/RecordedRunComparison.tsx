"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import {
  trpcReact,
  type RouterOutputs,
  type RouterInputs,
} from "@/lib/trpcReact";
import { recordedResultStatuses } from "@vaettir/api/src/services/recordedRunComparisonSchema";
type Summary =
  RouterOutputs["recordedRunComparison"]["compare"]["baselineSummary"];
type CountSummary = Pick<
  Summary,
  | "counts"
  | "resultCount"
  | "timedResults"
  | "missingDurations"
  | "invalidDurations"
  | "minDurationMs"
  | "maxDurationMs"
  | "meanDurationMs"
>;
function StatusCounts({ summary }: { summary: CountSummary }) {
  return (
    <div>
      <p>
        {summary.resultCount === 0
          ? "No recorded result in this run"
          : `${summary.resultCount} recorded results`}
      </p>
      <dl style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {recordedResultStatuses.map((status) => (
          <div key={status}>
            <dt>{status === "FLAKY" ? "FLAKY (reported)" : status}</dt>
            <dd>{summary.counts[status]}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>Recorded duration availability</summary>
        <p>
          Timed {summary.timedResults}; missing {summary.missingDurations};
          invalid {summary.invalidDurations}.
        </p>
        <p>
          Min {summary.minDurationMs ?? "unavailable"} ms; max{" "}
          {summary.maxDurationMs ?? "unavailable"} ms; mean{" "}
          {summary.meanDurationMs === null
            ? "unavailable"
            : summary.meanDurationMs.toFixed(2)}{" "}
          ms. Not comparable performance evidence.
        </p>
      </details>
    </div>
  );
}
function RunSummary({ summary }: { summary: Summary }) {
  return (
    <>
      <StatusCounts summary={summary} />
      <dl>
        {(
          ["mappedResults", "unmatchedResults", "unavailableLinks"] as const
        ).map((key) => (
          <div key={key}>
            <dt>
              {key === "mappedResults"
                ? "Same-project mapped results"
                : key === "unmatchedResults"
                  ? "Unmatched results (no case link)"
                  : "Unavailable links (not a same-project case)"}
            </dt>
            <dd>
              {recordedResultStatuses
                .map((status) => `${status} ${summary[key][status]}`)
                .join(" · ")}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
export function RecordedRunComparison({ projectId }: { projectId: string }) {
  return <Comparison key={projectId} projectId={projectId} />;
}
function Comparison({ projectId }: { projectId: string }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [origin, setOrigin] = useState<{ organizationId: string; clerkActorId: string } | null>(null);
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { retry: false, staleTime: 0, refetchOnMount: "always" });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { retry: false, staleTime: 0, refetchOnMount: "always" });
  const actorReady = isLoaded && isSignedIn && !!userId;
  const projectReady = !project.error && project.isFetchedAfterMount && !project.isFetching && !project.isPaused && project.data?.id === projectId;
  const membersReady = !organizations.error && organizations.isFetchedAfterMount && !organizations.isFetching && !organizations.isPaused;
  const member = projectReady && membersReady ? organizations.data?.find(row => row.id === project.data?.organizationId &&
    ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(row.role) && ["FULL", "READ_ONLY"].includes(row.seatType)) : undefined;
  useEffect(() => {
    if (!origin && actorReady && projectReady && member) setOrigin({ organizationId: project.data!.organizationId, clerkActorId: userId! });
  }, [origin, actorReady, projectReady, member, project.data, userId]);
  const identityChanged = !!origin && ((actorReady && origin.clerkActorId !== userId) || (projectReady && origin.organizationId !== project.data?.organizationId));
  const ready = !!origin && actorReady && projectReady && !!member && !identityChanged;
  const [catalogInput, setCatalogInput] = useState<
    RouterInputs["recordedRunComparison"]["runs"]
  >(() => ({ projectId, requestId: crypto.randomUUID() }));
  const [baseline, setBaseline] = useState(""),
    [candidate, setCandidate] = useState(""),
    [message, setMessage] = useState("");
  const [applied, setApplied] = useState<
      RouterInputs["recordedRunComparison"]["compare"] | null
    >(null),
    [history, setHistory] = useState<
      Array<
        | NonNullable<
            RouterInputs["recordedRunComparison"]["compare"]["cursor"]
          >
        | undefined
      >
    >([]);
  const catalog = trpcReact.recordedRunComparison.runs.useQuery({ ...catalogInput, originalOrganizationId: origin?.organizationId, expectedClerkActorId: origin?.clerkActorId }, {
    enabled: ready,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const runs =
    ready &&
    !catalog.error &&
    catalog.isFetchedAfterMount &&
    !catalog.isFetching &&
    !catalog.isPaused &&
    catalog.data?.projectId === projectId &&
    catalog.data.organizationId === origin?.organizationId &&
    catalog.data.clerkActorId === userId &&
    catalog.data.requestId === catalogInput.requestId
      ? catalog.data
      : null;
  const query = trpcReact.recordedRunComparison.compare.useQuery(
    applied ? { ...applied, originalOrganizationId: origin?.organizationId, expectedClerkActorId: origin?.clerkActorId } : {
      projectId,
      baselineRunId: "unselected",
      candidateRunId: "unselected",
      requestId: "00000000-0000-4000-8000-000000000000",
    },
    { enabled: ready && !!applied, retry: false, staleTime: 0, refetchOnMount: "always" },
  );
  const result =
    applied &&
    runs &&
    !query.error &&
    query.isFetchedAfterMount &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.organizationId === origin?.organizationId &&
    query.data.clerkActorId === userId &&
    query.data.requestId === applied.requestId &&
    query.data.baseline.id === applied.baselineRunId &&
    query.data.candidate.id === applied.candidateRunId
      ? query.data
      : null;
  const retryAccess = () => Promise.all([project.refetch(), organizations.refetch()]).then(() => catalog.refetch());
  function change(kind: "baseline" | "candidate", id: string) {
    if (kind === "baseline") setBaseline(id);
    else setCandidate(id);
    setApplied(null);
    setHistory([]);
    setMessage("");
  }
  function compare() {
    if (!runs || !baseline || !candidate || baseline === candidate) {
      setMessage("Choose two different current same-project recorded runs.");
      return;
    }
    setApplied({
      projectId,
      baselineRunId: baseline,
      candidateRunId: candidate,
      requestId: crypto.randomUUID(),
    });
    setHistory([]);
    setMessage("");
  }
  return (
    <section style={{ minWidth: 0 }}>
      <h1>Recorded run comparison</h1>
      <p>
        Compare stored non-manual run observations. This is not a regression or
        flakiness classifier. Provider, branch and commit labels do not prove
        equivalent tests or configurations.
      </p>
      {!ready ? <div role="alert"><p>Current original-organization membership and signed-in actor must be verified before run choices or evidence can be shown. Your baseline, candidate and page selections remain retained, not rebound to another account.</p><button type="button" onClick={() => void retryAccess()}>Recheck original comparison access</button></div> : catalog.error ? (
        <p role="alert">
          Current run access could not be verified. Cached run choices and
          comparisons are withheld.{" "}
          <button type="button" onClick={() => void retryAccess()}>
            Retry recorded runs
          </button>
          <button
            type="button"
            onClick={() =>
              setCatalogInput({ projectId, requestId: crypto.randomUUID() })
            }
          >
            Restart current run catalog
          </button>
        </p>
      ) : !runs ? (
        <p role="status">
          {catalog.isPaused
            ? "Reconnect to verify current recorded-run access."
            : "Loading current recorded runs…"}
        </p>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(min(280px,100%),1fr))",
              gap: 16,
            }}
          >
            {(["baseline", "candidate"] as const).map((kind) => (
              <label key={kind}>
                {kind === "baseline"
                  ? "Earlier baseline run"
                  : "Later candidate run"}
                <select
                  style={{ width: "100%", minWidth: 0 }}
                  value={kind === "baseline" ? baseline : candidate}
                  onChange={(event) => change(kind, event.target.value)}
                >
                  <option value="">Choose recorded run…</option>
                  {(kind === "baseline" ? baseline : candidate) &&
                    !runs.items.some(
                      (run) =>
                        run.id === (kind === "baseline" ? baseline : candidate),
                    ) && (
                      <option
                        value={kind === "baseline" ? baseline : candidate}
                      >
                        Selected run from another catalog page
                      </option>
                    )}
                  {runs.items.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.provider} ·{" "}
                      {new Date(run.startedAt).toLocaleString()} · {run.status}{" "}
                      · {run.id}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBlock: 16,
            }}
          >
            <button
              type="button"
              disabled={!baseline || !candidate || baseline === candidate}
              onClick={compare}
            >
              Compare recorded results
            </button>
            {runs.nextCursor && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  setCatalogInput({
                    projectId,
                    requestId: crypto.randomUUID(),
                    cursor: runs.nextCursor!,
                  })
                }
              >
                Older recorded runs
              </button>
            )}
            {catalogInput.cursor && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  setCatalogInput({ projectId, requestId: crypto.randomUUID() })
                }
              >
                Newest recorded runs
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void retryAccess()}
            >
              Refresh run access
            </button>
          </div>
          {!runs.items.length && (
            <p>
              No non-manual runs on this catalog page. Manual execution remains
              in run history.
            </p>
          )}
        </>
      )}
      {ready && message && <p role="alert">{message}</p>}
      {applied &&
        (query.error ? (
          <p role="alert">
            Comparison unavailable, denied or changed. No cached comparison was
            substituted.{" "}
            <button type="button" disabled={!ready} onClick={() => void query.refetch()}>
              Retry same comparison page
            </button>
            <button type="button" onClick={compare} disabled={!runs}>
              Restart selected comparison
            </button>
          </p>
        ) : !result ? (
          <p role="status">
            {query.isPaused
              ? "Reconnect before reviewing recorded evidence."
              : "Verifying selected recorded evidence…"}
          </p>
        ) : (
          <>
            <p role="status">
              Comparable configuration/test-definition context unavailable.
              Displaying recorded counts only, not verified regressions or flaky
              classification.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit,minmax(min(300px,100%),1fr))",
                gap: 20,
              }}
            >
              {[
                {
                  label: "Baseline",
                  run: result.baseline,
                  summary: result.baselineSummary,
                },
                {
                  label: "Candidate",
                  run: result.candidate,
                  summary: result.candidateSummary,
                },
              ].map((side) => (
                <article key={side.label}>
                  <h2>{side.label}</h2>
                  <Link
                    className="chip"
                    href={`/projects/${encodeURIComponent(projectId)}/test-runs#run-${encodeURIComponent(side.run.id)}`}
                  >
                    {side.run.provider} · {side.run.id}
                  </Link>
                  <p>
                    Stored start {new Date(side.run.startedAt).toLocaleString()}
                    ; finish{" "}
                    {side.run.finishedAt
                      ? new Date(side.run.finishedAt).toLocaleString()
                      : "not recorded"}
                    ; overall run status {side.run.status}.
                  </p>
                  <p>
                    Commit {side.run.commit || "not recorded"}
                    {side.run.commitClipped ? " (clipped)" : ""}; branch{" "}
                    {side.run.branch || "not recorded"}
                    {side.run.branchClipped ? " (clipped)" : ""}
                    {side.run.providerClipped ? "; provider clipped" : ""}.
                  </p>
                  {side.run.status === "RUNNING" && (
                    <p role="alert">
                      Run in progress: recorded population is incomplete.
                    </p>
                  )}
                  <RunSummary summary={side.summary} />
                </article>
              ))}
            </div>
            <h2>Mapped case observations</h2>
            <p>
              {result.mappedCaseCount} current same-project case identities ·
              Page {history.length + 1} · Up to 50 rows. A case link opens the
              current case, not an inferred historical definition.
            </p>
            {!result.items.length ? (
              <p>
                No same-project mapped case results. Unmatched and unavailable
                links remain counted above, not discarded or treated as passing
                cases.
              </p>
            ) : (
              <div
                className="table-scroll"
                role="region"
                tabIndex={0}
                aria-label="Recorded case observations"
              >
                <table
                  className="workspace-table"
                  style={{ width: "100%", minWidth: 760 }}
                >
                  <thead>
                    <tr>
                      <th>Current case</th>
                      <th>Baseline recorded results</th>
                      <th>Candidate recorded results</th>
                      <th>Neutral observation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <tr key={item.caseId}>
                        <th scope="row">
                          <Link
                            className="chip"
                            href={`/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(item.caseId)}`}
                          >
                            {item.displayId}
                          </Link>
                          <p
                            style={{ maxWidth: 240, overflowWrap: "anywhere" }}
                          >
                            {item.title}
                            {item.titleClipped ? " (clipped)" : ""}
                            {item.archived ? " · Archived" : ""}
                          </p>
                        </th>
                        <td>
                          <StatusCounts summary={item.baseline} />
                        </td>
                        <td>
                          <StatusCounts summary={item.candidate} />
                        </td>
                        <td>
                          {item.difference === "BASELINE_ONLY"
                            ? "No candidate mapped result"
                            : item.difference === "CANDIDATE_ONLY"
                              ? "No baseline mapped result"
                              : item.difference === "SAME_COUNTS"
                                ? "Same recorded status counts"
                                : "Recorded status counts differ"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginBlock: 16,
              }}
            >
              <button
                type="button"
                disabled={!history.length}
                onClick={() => {
                  const previous = history.at(-1);
                  setHistory(history.slice(0, -1));
                  setApplied({
                    ...applied!,
                    cursor: previous,
                    expectedPairHash: result.pairHash,
                    requestId: crypto.randomUUID(),
                  });
                }}
              >
                Previous case page
              </button>
              <button
                type="button"
                disabled={!result.nextCursor}
                onClick={() => {
                  setHistory([...history, applied?.cursor]);
                  setApplied({
                    ...applied!,
                    cursor: result.nextCursor!,
                    expectedPairHash: result.pairHash,
                    requestId: crypto.randomUUID(),
                  });
                }}
              >
                Next case page
              </button>
              <button type="button" onClick={compare}>
                Restart selected comparison
              </button>
            </div>
            <details>
              <summary>Evidence boundaries and missing context</summary>
              {result.limitations.map((limitation) => (
                <p key={limitation}>{limitation}</p>
              ))}
            </details>
          </>
        ))}
    </section>
  );
}
