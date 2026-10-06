import { DistributionBar } from "./MetricVisuals";
import { MANUAL_SUMMARY_EXCLUSIONS, MANUAL_SUMMARY_EXCLUSION_LABELS, MANUAL_SUMMARY_OUTCOMES, validateManualRunSummary, type ManualRunSummary } from "@/lib/manual-run-summary";
/** Pure status-only visual. The caller must establish fresh original read scope. */
export function ManualRunSummaryVisual({ value }: { value: ManualRunSummary }) {
  validateManualRunSummary(value);
  const total = value.totals, percent = total.plannedInstances ? Math.round(total.recordedInstances / total.plannedInstances * 10000) / 100 : null;
  return <section aria-label="Trusted manual case-instance summary" style={{ minWidth: 0 }}>
    <h2>Manual run progress</h2>
    <p>Read at <time dateTime={value.asOf}>{value.asOf}</time>. Inclusive UTC run-start dates: {value.scope.start} through {value.scope.end}.</p>
    <dl style={{ display: "flex", flexWrap: "wrap", gap: 16, whiteSpace: "pre-wrap", overflowWrap: "anywhere", minWidth: 0 }}><div><dt>Recorded platform</dt><dd>{value.scope.platform ?? "No platform filter"}</dd></div><div><dt>Recorded environment</dt><dd>{value.scope.environment ?? "No environment filter"}</dd></div><div><dt>Recorded build</dt><dd>{value.scope.build ?? "No build filter"}</dd></div></dl>
    <div className="run-card-grid">
      {[["Planned tests", total.plannedInstances], ["Recorded tests", total.recordedInstances], ["Remaining tests", total.remainingInstances], ["Partially tested", total.partialStepInstances], ["Included runs", total.trustedRuns], ["Excluded runs", total.excludedRuns]].map(([label, count]) => <article className="panel" key={label}><h3>{label}</h3><strong style={{ fontSize: "1.8rem" }}>{count}</strong></article>)}
    </div>
    <p><strong>{percent === null ? "No planned tests in included runs" : `${percent}% recorded (${total.recordedInstances} of ${total.plannedInstances} planned tests)`}</strong>. {total.inProgressTrustedRuns} included {total.inProgressTrustedRuns === 1 ? "run is" : "runs are"} still in progress. {total.ignoredOutsideScopeResultRows} unmatched/outside-scope result rows do not advance planned work.</p>
    <progress max={total.plannedInstances || 1} value={total.recordedInstances} aria-label="Trusted planned instances with recorded whole-case verdicts" />
    <DistributionBar label="Trusted manual case-instance outcomes" segments={[{ label: "Passed", value: total.outcomes.PASS, tone: "success" }, { label: "Failed", value: total.outcomes.FAIL, tone: "danger" }, { label: "Blocked", value: total.outcomes.BLOCKED, tone: "warning" }, { label: "Skipped", value: total.outcomes.SKIP, tone: "neutral" }, { label: "Flaky", value: total.outcomes.FLAKY, tone: "info" }, { label: "Remaining", value: total.remainingInstances, tone: "neutral" }]} />
    <p className="text-muted">These are case instances within each trusted saved manual run, not globally unique cases or raw result rows. The same case in two runs counts twice. Remaining includes partial steps; it does not prove nobody attempted a case. Blocked and skipped are recorded, not passed. This is not release readiness.</p>
    <div style={{ overflowX: "auto", minWidth: 0 }}><table className="workspace-table"><caption>Complete applied UTC run-start days, including zero days</caption><thead><tr><th>UTC day</th><th>Runs</th><th>Included</th><th>Excluded</th><th>Planned</th><th>Recorded</th><th>Remaining</th><th>Partial steps</th>{MANUAL_SUMMARY_OUTCOMES.map(status => <th key={status}>{status}</th>)}</tr></thead><tbody>{value.days.map(day => <tr key={day.day}><th scope="row">{day.day}</th><td>{day.runs}</td><td>{day.trustedRuns}</td><td>{day.excludedRuns}</td><td>{day.plannedInstances}</td><td>{day.recordedInstances}</td><td>{day.remainingInstances}</td><td>{day.partialStepInstances}</td>{MANUAL_SUMMARY_OUTCOMES.map(status => <td key={status}>{day.outcomes[status]}</td>)}</tr>)}</tbody></table></div>
    <h3>Runs excluded from the trusted denominator</h3>
    <p>{total.runs} selected manual runs: {total.trustedRuns} trusted and {total.excludedRuns} excluded. No completion is inferred for excluded runs or the whole project.</p>
    <dl>{MANUAL_SUMMARY_EXCLUSIONS.map(reason => <div key={reason}><dt>{MANUAL_SUMMARY_EXCLUSION_LABELS[reason]}</dt><dd>{total.exclusions[reason]}</dd></div>)}</dl>
    <details><summary>Scope, exclusions and interpretation limits</summary><ul>{value.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details>
  </section>;
}
