"use client";
import { DeviceHelperBlockedLaunchGuidance } from "./DeviceHelperBlockedLaunchGuidance";
import { useDeviceHelperSetup, type HelperSetupIntent } from "../lib/use-device-helper-setup";
import type { ReadPairedHealth } from "../lib/device-helper-setup";

/** Standalone setup metadata surface. No download, capture, discovery, source
 * generation, legacy draft adoption or private pairing details are exposed. */
export function DeviceHelperSetupStatus({ intent, health }: { intent: HelperSetupIntent; health?: ReadPairedHealth }) {
  const workflow = useDeviceHelperSetup(intent, health), view = workflow.view;
  return <section className="panel" aria-label="Current helper setup metadata">
    <h3>Helper setup checks</h3>
    <p role="status">{view.paired ? "Paired response reported v2 liveness only" : view.status === "PRIVATE" ? "Private setup retained" : "Setup needs explicit review"}</p>
    <p>{view.description}</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="btn-secondary" disabled={!view.canReview} onClick={() => void workflow.review()}>{view.busy ? "Review in progress..." : "Review current setup access"}</button>
      <button type="button" className="btn-secondary" disabled={!view.canCheck || !workflow.healthAvailable} onClick={() => void workflow.checkPaired()}>Check paired response only</button>
      <button type="button" className="btn-secondary" disabled={view.status === "PRIVATE" || intent.platform !== "windows"} onClick={workflow.reportBlocked}>Windows refused launch</button>
    </div>
    {!workflow.healthAvailable && <p className="text-muted">No local health transport is installed in this source-only surface. No helper request will be made.</p>}
    <p className="text-muted">Setup does not approve downloads, device/app targeting, capture-source processing or paid AI. Existing legacy captures, paid drafts and uncertain operations are not attributed to this current identity.</p>
    {view.status === "BLOCKED" && <DeviceHelperBlockedLaunchGuidance reportedBlocked />}
  </section>;
}
