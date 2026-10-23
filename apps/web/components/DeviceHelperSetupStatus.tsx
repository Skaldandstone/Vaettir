"use client";
import { DeviceHelperBlockedLaunchGuidance } from "./DeviceHelperBlockedLaunchGuidance";
import { useDeviceHelperSetup, type HelperSetupIntent } from "../lib/use-device-helper-setup";
import type { ReadPairedHealth } from "../lib/device-helper-setup";

/** Standalone setup metadata surface. No download, capture, discovery, source
 * generation, legacy draft adoption or private pairing details are exposed. */
export function DeviceHelperSetupStatus({ intent, health, onReportedBlocked }: { intent: HelperSetupIntent; health?: ReadPairedHealth; onReportedBlocked?: () => void }) {
  const workflow = useDeviceHelperSetup(intent, health), view = workflow.view;
  const metadata = Object.getOwnPropertyDescriptor(intent, "kind")?.value === "CURRENT_METADATA_ONLY";
  const reported = view.reportedBlocked === true || metadata && Object.getOwnPropertyDescriptor(intent, "reportedBlocked")?.value === true;
  return <section className="panel" aria-label="Current helper setup metadata">
    <h3>Helper setup checks</h3>
    <p role="status">{view.paired ? "Paired response reported v2 liveness only" : view.status === "PRIVATE" ? "Private setup retained" : view.status === "CURRENT_METADATA_REVIEWED" ? "Current workspace metadata reviewed only" : "Setup needs explicit review"}</p>
    <p>{view.description}</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="btn-secondary" disabled={!view.canReview} onClick={() => void workflow.review()}>{view.busy ? "Review in progress..." : "Review current setup access"}</button>
      {!metadata && <button type="button" className="btn-secondary" disabled={!view.canCheck || !workflow.healthAvailable} onClick={() => void workflow.checkPaired()}>Check paired response only</button>}
      <button type="button" className="btn-secondary" disabled={!metadata && (view.status === "PRIVATE" || !("platform" in intent) || intent.platform !== "windows")} onClick={() => workflow.reportBlocked(onReportedBlocked)}>Windows refused launch</button>
    </div>
    {!workflow.healthAvailable && <p className="text-muted">{metadata ? "This metadata-only review creates no pairing credential and never contacts a local helper." : "No local health transport is installed in this source-only surface. No helper request will be made."}</p>}
    <p className="text-muted">Reporting a launch refusal cancels pending setup checks. It does not identify the Windows policy or prove a capture/helper stopped. Any separate polling surface requires its own cancellation bridge.</p>
    <p className="text-muted">Setup does not approve downloads, device/app targeting, capture-source processing or paid AI. Existing legacy captures, paid drafts and uncertain operations are not attributed to this current identity.</p>
    {(reported || view.status === "BLOCKED") && <DeviceHelperBlockedLaunchGuidance reportedBlocked />}
  </section>;
}
