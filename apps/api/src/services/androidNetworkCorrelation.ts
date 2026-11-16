import {
  androidNetworkEvidence,
  androidNetworkSelection,
  type AndroidNetworkEvidence,
  type AndroidNetworkSelection,
} from "./androidNetworkEvidenceSchema.js";

export type StepTiming = {
  clockId: string;
  startedAt: number;
  endedAt: number;
};
type Step = {
  stepId: string;
  requestId: string;
  observedAt: number;
  timing?: StepTiming;
};
type Reason =
  | "LEGACY_METADATA"
  | "NO_APPROVED_CLOCK"
  | "CLOCK_MISMATCH"
  | "CLOCK_INCONSISTENT"
  | "OUTSIDE_CALIBRATION"
  | "OUTSIDE_STEP"
  | "AMBIGUOUS_STEP";
export type AndroidNetworkCorrelation = {
  trust: "LOCAL_REPORTED_TEMPORAL_ONLY";
  sourceId: string;
  pendingRequests: number | null;
  catalog: { id: string; revision: number } | null;
  matched: Array<{
    eventIndex: number;
    stepId: string;
    requestId: string;
    routeKey: string;
    method: string;
    template: string;
    status: number | null;
    outcome: string;
  }>;
  unassigned: Array<{ eventIndex: number; reason: Reason }>;
};

/** No URL or event bodies enter this projection. Clock IDs identify local
 * capture instances; they never imply synchronization. Offsets are derived
 * only from reviewed callback observations, never from matching wall times. */
export function correlateAndroidNetwork(
  raw: AndroidNetworkEvidence,
  approval: AndroidNetworkSelection,
  steps: Step[],
): AndroidNetworkCorrelation {
  const network = androidNetworkEvidence.parse(raw),
    selected = androidNetworkSelection.parse(approval);
  if (
    selected.sourceId !== network.sourceId ||
    JSON.stringify(selected.approvedRouteKeys) !==
      JSON.stringify(network.approvedRouteKeys)
  )
    throw Error("Network source selection changed");
  const result: AndroidNetworkCorrelation = {
    trust: "LOCAL_REPORTED_TEMPORAL_ONLY",
    sourceId: network.sourceId,
    pendingRequests: network.version === 2 ? network.pendingRequests : null,
    catalog:
      network.version === 2
        ? { id: network.catalog.id, revision: network.catalog.revision }
        : null,
    matched: [],
    unassigned: [],
  };
  const all = (reason: Reason) => {
    result.unassigned = network.events.map((_, eventIndex) => ({
      eventIndex,
      reason,
    }));
    return result;
  };
  if (network.version === 1) return all("LEGACY_METADATA");
  if (
    !selected.correlation ||
    JSON.stringify(network.catalog) !==
      JSON.stringify(selected.correlation.catalog)
  )
    throw Error("Exact reviewed catalog required");
  if (selected.correlation.captureClock.clockId !== network.clockId)
    throw Error("Capture interval must retain its original app clock.");
  const calibration = selected.correlation.clockCalibration;
  if (!calibration) return all("NO_APPROVED_CLOCK");
  if (calibration.appClockId !== network.clockId) return all("CLOCK_MISMATCH");
  const first = calibration.samples[0]!,
    last = calibration.samples.at(-1)!;
  const lower = Math.max(
    ...calibration.samples.map((s) => s.sentAt - s.appObservedAt),
  );
  const upper = Math.min(
    ...calibration.samples.map((s) => s.receivedAt - s.appObservedAt),
  );
  if (lower > upper) return all("CLOCK_INCONSISTENT");
  // A receipt without a trustworthy clock cannot be silently removed from
  // overlap analysis: its unknown window could overlap any candidate step.
  if (steps.some((s) => !s.timing)) return all("NO_APPROVED_CLOCK");
  if (steps.some((s) => s.timing!.clockId !== calibration.connectorClockId))
    return all("CLOCK_MISMATCH");
  const validSteps = steps.filter(
    (s) =>
      s.timing &&
      s.timing.clockId === calibration.connectorClockId &&
      Number.isSafeInteger(s.timing.startedAt) &&
      Number.isSafeInteger(s.timing.endedAt) &&
      s.timing.startedAt <= s.timing.endedAt &&
      s.timing.endedAt === s.observedAt &&
      s.timing.startedAt >= first.sentAt &&
      s.timing.endedAt <= last.receivedAt,
  );
  if (validSteps.length !== steps.length) return all("OUTSIDE_CALIBRATION");
  network.events.forEach((event, eventIndex) => {
    const end = event.startedAt + event.durationMs;
    if (event.startedAt < first.appObservedAt || end > last.appObservedAt) {
      result.unassigned.push({ eventIndex, reason: "OUTSIDE_CALIBRATION" });
      return;
    }
    const earliest = event.startedAt + lower,
      latest = end + upper;
    // Require the entire reported uncertainty envelope inside exactly one
    // dispatch-to-observation window. Boundary and overlapping steps stay open.
    const overlapping = validSteps.filter(
      (s) => earliest <= s.timing!.endedAt && latest >= s.timing!.startedAt,
    );
    const contained = overlapping.filter(
      (s) => earliest > s.timing!.startedAt && latest < s.timing!.endedAt,
    );
    if (overlapping.length !== 1 || contained.length !== 1) {
      result.unassigned.push({
        eventIndex,
        reason: overlapping.length > 1 ? "AMBIGUOUS_STEP" : "OUTSIDE_STEP",
      });
      return;
    }
    const step = contained[0]!,
      route = network.catalog.routes.find(
        (r) => r.routeKey === event.routeKey && r.method === event.method,
      )!;
    result.matched.push({
      eventIndex,
      stepId: step.stepId,
      requestId: step.requestId,
      routeKey: route.routeKey,
      method: route.method,
      template: route.template,
      status: event.status,
      outcome: event.outcome,
    });
  });
  return result;
}

export function summarizeStepNetwork(
  correlation: AndroidNetworkCorrelation,
  stepId: string,
  requestId: string,
): string {
  const rows = correlation.matched.filter(
    (row) => row.stepId === stepId && row.requestId === requestId,
  );
  const shown = rows
    .slice(0, 8)
    .map(
      (row) =>
        `${row.routeKey}: ${row.method} ${row.template} ${row.status ?? "transport error"}`,
    )
    .join("; ");
  return (
    `Approved debug-app HTTP source=${correlation.sourceId}; ${correlation.catalog ? `catalog=${correlation.catalog.id}@${correlation.catalog.revision}; ` : ""}` +
    (rows.length
      ? `observed within reported timing bounds for this step: ${shown}${rows.length > 8 ? `; ${rows.length - 8} additional events retained in audit` : ""}. `
      : "No HTTP event correlated to this step. ") +
    `Run-level pending requests=${correlation.pendingRequests ?? "unknown"}; unassigned events=${correlation.unassigned.length}, retained separately in audit. Temporal correlation only; no causality, response-body or API correctness assertion.`
  );
}
