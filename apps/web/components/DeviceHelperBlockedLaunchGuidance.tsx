"use client";

import { useId, useState } from "react";

/** Public setup guidance only. No private setup/diagnostic input, transport,
 * download, file, clipboard, authorization or device operation is performed. */
export function DeviceHelperBlockedLaunchGuidance({ reportedBlocked }: { reportedBlocked: boolean }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="panel" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>
        {reportedBlocked ? "Windows refused launch (reported by you)" : "No paired helper response yet"}
      </h3>
      <p>
        {reportedBlocked
          ? "The blocking policy or product is unknown. Reporting this does not change protection or prove that a helper stopped."
          : "A missing response or timeout does not prove that Windows blocked the helper, that it launched, or that a device is ready."}
      </p>
      <ol>
        <li><strong>Keep the failed download.</strong> Record its exact filename, the displayed error and the time of the attempt. Keep pairing codes and private setup commands out of screenshots and support messages.</li>
        <li><strong>Ask the device&apos;s owner or security administrator to review policy history.</strong> An Internet download marker or installed security product alone does not identify the cause. Do not disable protection, unblock files, add exclusions, change ExecutionPolicy or run as administrator.</li>
        <li><strong>Use only a policy-permitted setup route.</strong> Current delivery is an unsigned script (.cmd on Windows, .command on macOS, .sh on Linux) and requires Node.js 22 or newer. No signed installer or Windows launch acceptance is guaranteed. The existing manual Node instructions are an alternative only when policy permits, not a bypass.</li>
      </ol>
      <button type="button" className="btn-secondary" aria-expanded={expanded} aria-controls={`${id}-checks`} onClick={() => setExpanded(current => !current)}>
        Which checks are still separate?
      </button>
      <div id={`${id}-checks`} hidden={!expanded}>
        <p>This guidance supplies none of the following approvals or verification:</p>
        <ul>
          <li><strong>OS launch acceptance:</strong> the reviewed helper must actually be allowed to start.</li>
          <li><strong>Paired liveness:</strong> a supported v2 health response reports liveness only, not device or app access.</li>
          <li><strong>Device and foreground target:</strong> the exact device and app need their own verification.</li>
          <li><strong>Capture-source consent:</strong> approve the selected source separately. Named controls can still contain sensitive text.</li>
          <li><strong>Paid AI processing:</strong> review and approve that processing separately; setup is not spending approval.</li>
        </ul>
      </div>
    </section>
  );
}
