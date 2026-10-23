"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "@/lib/trpcReact";
import { recordedExecutionTrendKey, type RecordedExecutionTrendInput } from "@vaettir/api/src/services/recordedExecutionTrendSchema";
import { downloadFile } from "@/lib/download";
import { manualSummaryReadActivation, manualSummaryScopeMatches, renderManualRunSummaryCsv, sameManualSummaryExport, validateManualRunSummary, type ManualSummaryReadState, type ManualSummaryExportSnapshot, type ManualRunSummary } from "@/lib/manual-run-summary";
import { ManualRunSummaryVisual } from "./ManualRunSummaryVisual";
/** Parent active means freshly verified original actor/org plus explicit Apply. */
export function ManualRunDashboardSummary({ active, scope, clerkActorId }: { active: boolean; scope: RecordedExecutionTrendInput | null; clerkActorId: string | null }) {
  const auth = useAuth(), [originalSession, setOriginalSession] = useState<string | null>(null);
  const currentActor = active && !!scope && auth.isLoaded && !!auth.isSignedIn && !!clerkActorId && auth.userId === clerkActorId && !!auth.sessionId;
  useEffect(() => { if (!originalSession && currentActor) setOriginalSession(auth.sessionId!); }, [originalSession, currentActor, auth.sessionId]);
  const ready = currentActor && originalSession === auth.sessionId;
  const input = scope ?? { projectId: "inactive", originalOrganizationId: "inactive", start: "2000-01-01", end: "2000-01-01" };
  const query = trpcReact.recordedExecutionTrends.manualSummary.useQuery(input, { enabled: ready, retry: false, staleTime: 0 });
  const expectedKey = `manual-case-heads:${recordedExecutionTrendKey(input)}`;
  const [readState, setReadState] = useState<ManualSummaryReadState>({ ready: false, key: "", sessionId: null, baseline: 0, epoch: 0 });
  const activation = manualSummaryReadActivation(readState, { ready, key: expectedKey, sessionId: auth.sessionId ?? null, revision: query.dataUpdatedAt });
  if (activation.changed) setReadState(activation.state);
  useEffect(() => { if (ready) void query.refetch({ cancelRefetch: false }); }, [ready, activation.state.epoch]);
  let value: ManualRunSummary | null = null, validationError = "";
  if (ready && activation.fresh && scope && clerkActorId && !query.error && !query.isFetching && !query.isPaused && query.isFetchedAfterMount && query.data && manualSummaryScopeMatches(query.data, scope, clerkActorId, expectedKey)) {
    try { value = validateManualRunSummary(query.data); } catch (error) { validationError = error instanceof Error ? error.message : "The complete manual summary is unavailable."; }
  }
  const [message, setMessage] = useState(""), [reviewed, setReviewed] = useState<ManualSummaryExportSnapshot | null>(null);
  const [previous, setPrevious] = useState({ value, revision: query.dataUpdatedAt, key: expectedKey, ready, epoch: 0 });
  const changed = previous.value !== value || previous.revision !== query.dataUpdatedAt || previous.key !== expectedKey || previous.ready !== ready;
  const epoch = changed ? previous.epoch + 1 : previous.epoch;
  if (changed) setPrevious({ value, revision: query.dataUpdatedAt, key: expectedKey, ready, epoch });
  const snapshot: ManualSummaryExportSnapshot = { ready: !!value && ready, value, epoch, revision: query.dataUpdatedAt };
  const latest = useRef<ManualSummaryExportSnapshot>({ ready: false, value: null, epoch: -1, revision: -1 });
  useLayoutEffect(() => { latest.current = snapshot; return () => { latest.current = { ready: false, value: null, epoch: -1, revision: -1 }; }; }, [value, ready, epoch, query.dataUpdatedAt]);
  useEffect(() => { setReviewed(null); }, [epoch]);
  function reviewCsv() { setMessage(""); if (latest.current.ready && latest.current.value) setReviewed({ ...latest.current }); }
  function exportCsv() {
    setMessage("");
    if (!sameManualSummaryExport(reviewed, latest.current)) { setMessage("Review the exact fresh manual summary again. Nothing was exported."); return; }
    const original = reviewed!;
    try {
      const csv = renderManualRunSummaryCsv(original.value!);
      if (!sameManualSummaryExport(original, latest.current)) throw Error("Manual summary access or applied scope changed. Nothing was exported.");
      downloadFile(`vaettir-manual-summary-${original.value!.scope.start}-${original.value!.scope.end}.csv`, csv, "text/csv");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Manual summary export was refused."); }
  }
  if (!active || !scope) return null;
  return <section className="panel" style={{ marginTop: 16, minWidth: 0 }}>
    {!ready ? <p role="status">Restore the original signed-in session and freshly verified applied scope before viewing this private manual summary.</p> : <>
      {query.isFetching && <p role="status">Checking current manual case heads for the exact applied scope…</p>}
      {query.isPaused && <p role="status">Connection paused. Cached counts cannot authorize an export.</p>}
      {(query.error || validationError) && <p role="alert">{query.error?.message ?? validationError} No partial manual aggregate was shown. <button type="button" disabled={query.isFetching || query.isPaused} onClick={() => void query.refetch({ cancelRefetch: false })}>Retry this exact manual summary</button></p>}
      {!value && !query.isFetching && !query.isPaused && !query.error && !validationError && <p role="status">Awaiting a fresh response matching the original actor, organization and exact scope.</p>}
      {value && <><ManualRunSummaryVisual value={value} /><button type="button" className="btn-secondary" onClick={reviewCsv}>Review manual summary CSV</button>
        {sameManualSummaryExport(reviewed, snapshot) && <div role="status"><p>Reviewed summary only: {value.scope.start} through {value.scope.end} UTC, as of {value.asOf}; {value.totals.plannedInstances} trusted planned instances, {value.totals.remainingInstances} without whole-case verdicts, {value.totals.excludedRuns} excluded runs. Includes exact recorded configuration filters, all daily counts, exclusions and limits. No raw case bodies, notes, media or full history.</p><button type="button" className="btn-primary" onClick={exportCsv}>Download reviewed manual summary CSV</button></div>}
      </>}
      {message && <p role="alert">{message}</p>}
    </>}
  </section>;
}
