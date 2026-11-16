import { it, expect } from "vitest";
import { admitAndroidNetworkEvidence } from "./androidNetworkEvidenceSchema.js";
const selected = {
  packageName: "com.example.qa",
  runId: "a".repeat(48),
  sourceId: "qa",
  approvedRouteKeys: ["catalog"],
  startedAt: 1000,
  endedAt: 2000,
};
const sample = () => ({
  version: 1,
  capability: "DEBUG_APP_HTTP_CALLBACKS",
  debugBuild: true,
  metadataOnly: true,
  packageName: selected.packageName,
  runId: selected.runId,
  sourceId: selected.sourceId,
  approvedRouteKeys: ["catalog"],
  events: [
    {
      routeKey: "catalog",
      method: "GET",
      status: 200,
      startedAt: 1100,
      durationMs: 50,
      outcome: "RESPONSE",
    },
  ],
});
it("admits exact approved debug app/run metadata without upgrading trust", () => {
  expect(admitAndroidNetworkEvidence(sample(), selected)).toEqual(sample());
});
it.each([
  "url",
  "headers",
  "body",
  "authorization",
  "responseBody",
  "deviceLogs",
])("refuses %s rather than silently uploading it", (key) => {
  const v = sample();
  Object.assign(v.events[0]!, { [key]: "private" });
  expect(() => admitAndroidNetworkEvidence(v, selected)).toThrow();
});
it.each([
  "app",
  "run",
  "source",
  "route",
  "time",
  "capability",
  "debug",
  "outcome",
])("refuses mismatched %s", (key) => {
  const v = sample();
  if (key === "app") v.packageName = "com.other.app";
  if (key === "run") v.runId = "b".repeat(48);
  if (key === "source") v.sourceId = "other";
  if (key === "route") v.events[0]!.routeKey = "unapproved";
  if (key === "time") v.events[0]!.startedAt = 999;
  if (key === "capability") v.capability = "ADB";
  if (key === "debug") v.debugBuild = false;
  if (key === "outcome") v.events[0]!.outcome = "TRANSPORT_ERROR";
  expect(() => admitAndroidNetworkEvidence(v, selected)).toThrow();
});
it("refuses unbounded intervals, excessive events and route keys containing identifiers", () => {
  expect(() =>
    admitAndroidNetworkEvidence(sample(), { ...selected, endedAt: 999999 }),
  ).toThrow();
  const v = sample();
  v.events = Array.from({ length: 101 }, () => v.events[0]!);
  expect(() => admitAndroidNetworkEvidence(v, selected)).toThrow();
  expect(() =>
    admitAndroidNetworkEvidence(
      { ...sample(), approvedRouteKeys: ["/users/private@example.test"] },
      selected,
    ),
  ).toThrow();
});
