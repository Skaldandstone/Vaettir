import { it, expect } from "vitest";
import {
  androidNetworkEvidence,
  androidNetworkSelection,
  admitAndroidNetworkEvidence,
} from "./androidNetworkEvidenceSchema.js";
import {
  correlateAndroidNetwork,
  summarizeStepNetwork,
} from "./androidNetworkCorrelation.js";
function fixture() {
  const catalog = {
    id: "qa",
    revision: 1,
    routes: [
      { routeKey: "catalog", method: "GET", template: "/v1/catalog/{item_id}" },
    ],
  };
  const network = androidNetworkEvidence.parse({
    version: 2,
    capability: "DEBUG_APP_HTTP_CALLBACKS",
    debugBuild: true,
    metadataOnly: true,
    packageName: "com.example.qa",
    runId: "a".repeat(48),
    sourceId: "qa",
    approvedRouteKeys: ["catalog"],
    catalog,
    clockId: "b".repeat(48),
    pendingRequests: 1,
    events: [
      {
        routeKey: "catalog",
        method: "GET",
        status: 204,
        startedAt: 620,
        durationMs: 10,
        outcome: "RESPONSE",
      },
    ],
  });
  const selection = androidNetworkSelection.parse({
    sourceId: "qa",
    approvedRouteKeys: ["catalog"],
    startedAt: 500,
    endedAt: 1000,
    correlation: {
      captureClock: { domain: "APP_REPORTED", clockId: "b".repeat(48) },
      catalog,
      sourceReviewed: true,
      catalogReviewed: true,
      temporalOnlyReviewed: true,
      clockCalibration: {
        appClockId: "b".repeat(48),
        connectorClockId: "c".repeat(48),
        method: "REPORTED_ROUND_TRIP_CALLBACK",
        samples: [
          {
            challengeId: "d".repeat(48),
            sentAt: 999,
            appObservedAt: 500,
            receivedAt: 1001,
          },
          {
            challengeId: "e".repeat(48),
            sentAt: 1499,
            appObservedAt: 1000,
            receivedAt: 1501,
          },
        ],
      },
    },
  });
  const steps = [
    {
      stepId: "step",
      requestId: "request",
      observedAt: 1200,
      timing: { clockId: "c".repeat(48), startedAt: 1100, endedAt: 1200 },
    },
  ];
  return { network, selection, steps };
}
it("correlates actual reported offset bounds and projects safe operation/status per step", () => {
  const f = fixture(),
    r = correlateAndroidNetwork(f.network, f.selection, f.steps);
  expect(r.matched).toEqual([
    {
      eventIndex: 0,
      stepId: "step",
      requestId: "request",
      routeKey: "catalog",
      method: "GET",
      template: "/v1/catalog/{item_id}",
      status: 204,
      outcome: "RESPONSE",
    },
  ]);
  expect(r.pendingRequests).toBe(1);
  expect(r.unassigned).toEqual([]);
  const text = summarizeStepNetwork(r, "step", "request");
  expect(text).toContain("GET /v1/catalog/{item_id} 204");
  expect(text).toContain("no causality");
  expect(text).toContain("pending requests=1");
  expect(summarizeStepNetwork(r, "other", "other")).not.toContain("GET /v1");
});
it.each([
  "clock",
  "receipt-clock",
  "no-clock",
  "outside",
  "boundary",
  "overlap",
  "drift",
  "no-timing",
])("keeps %s unassigned", (kind) => {
  const f = fixture();
  const c = f.selection.correlation!.clockCalibration!;
  if (kind === "clock") c.appClockId = "f".repeat(48);
  if (kind === "receipt-clock") f.steps[0]!.timing.clockId = "f".repeat(48);
  if (kind === "no-clock") f.selection.correlation!.clockCalibration = null;
  if (kind === "outside") f.network.events[0]!.startedAt = 499;
  if (kind === "boundary") f.network.events[0]!.startedAt = 600;
  if (kind === "overlap") f.steps.push({ ...f.steps[0]!, stepId: "other" });
  if (kind === "drift") c.samples[1]!.appObservedAt = 1100;
  const result = correlateAndroidNetwork(
    f.network,
    f.selection,
    kind === "no-timing" ? f.steps.map(({ timing: _, ...s }) => s) : f.steps,
  );
  expect(result.matched).toEqual([]);
  expect(result.unassigned).toHaveLength(1);
});
it("an unknown second receipt cannot be dropped from overlap analysis", () => {
  const f = fixture();
  const unknown = { stepId: "other", requestId: "other", observedAt: 1200 };
  const result = correlateAndroidNetwork(f.network, f.selection, [
    ...f.steps,
    unknown,
  ]);
  expect(result.matched).toEqual([]);
  expect(result.unassigned[0]!.reason).toBe("NO_APPROVED_CLOCK");
});
it("requires the explicit app capture domain independently of the host calibration", () => {
  const f = fixture();
  f.selection.correlation!.captureClock.clockId = "f".repeat(48);
  expect(() =>
    admitAndroidNetworkEvidence(f.network, {
      ...f.selection,
      packageName: f.network.packageName,
      runId: f.network.runId,
    }),
  ).toThrow();
  expect(() =>
    correlateAndroidNetwork(f.network, f.selection, f.steps),
  ).toThrow();
});
it("legacy and transport errors retain honest independent semantics", () => {
  const f = fixture();
  const raw = structuredClone(f.network) as Record<string, unknown>;
  raw.version = 1;
  delete raw.catalog;
  delete raw.clockId;
  delete raw.pendingRequests;
  const selection = { ...f.selection };
  delete selection.correlation;
  expect(
    correlateAndroidNetwork(
      androidNetworkEvidence.parse(raw),
      selection,
      f.steps,
    ).unassigned[0]!.reason,
  ).toBe("LEGACY_METADATA");
  f.network.events[0]!.outcome = "TRANSPORT_ERROR";
  f.network.events[0]!.status = null;
  expect(
    summarizeStepNetwork(
      correlateAndroidNetwork(f.network, f.selection, f.steps),
      "step",
      "request",
    ),
  ).toContain("transport error");
});
it.each([
  "/users/123",
  "https://private.test/users",
  "/users/{id}?token=x",
  "/users/private@example.test",
  "/users/%31",
  "/users/ABC",
])("refuses non-symbolic template %s", (template) => {
  const f = fixture();
  f.selection.correlation!.catalog.routes[0]!.template = template;
  expect(() =>
    correlateAndroidNetwork(f.network, f.selection, f.steps),
  ).toThrow();
});
it("admission rejects catalog substitution and forbidden private data before correlation", () => {
  const f = fixture();
  expect(
    admitAndroidNetworkEvidence(f.network, {
      ...f.selection,
      packageName: f.network.packageName,
      runId: f.network.runId,
    }),
  ).toEqual(f.network);
  f.selection.correlation!.catalog.revision++;
  expect(() =>
    admitAndroidNetworkEvidence(f.network, {
      ...f.selection,
      packageName: f.network.packageName,
      runId: f.network.runId,
    }),
  ).toThrow();
  Object.assign(f.network.events[0]!, { body: "private" });
  expect(() =>
    correlateAndroidNetwork(f.network, f.selection, f.steps),
  ).toThrow();
});
it("calibration rejects duplicate/nonmonotonic/slow/unsafe samples rather than manufacturing time", () => {
  for (const change of ["duplicate", "order", "slow", "unsafe"]) {
    const f = fixture(),
      samples = f.selection.correlation!.clockCalibration!.samples;
    if (change === "duplicate")
      samples[1]!.challengeId = samples[0]!.challengeId;
    if (change === "order") samples[1]!.sentAt = 1000;
    if (change === "slow") samples[1]!.receivedAt = 3000;
    if (change === "unsafe") samples[1]!.receivedAt = Number.MAX_SAFE_INTEGER;
    expect(() =>
      correlateAndroidNetwork(f.network, f.selection, f.steps),
    ).toThrow();
  }
});
