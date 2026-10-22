"use client";
import { useManualExecutionAccess } from "./use-manual-execution-access";
import { useProjectCustomActions } from "./use-project-custom-actions";

/** Only reviewed manual start/results/completion, not releases, retests,
 * datasets, imports, CI, or generic project editing. Server gates remain final. */
export function useScopedManualExecutionAccess(projectId: string) {
  const native = useManualExecutionAccess(projectId), custom = useProjectCustomActions(projectId);
  return { ...native,
    nativeCanWrite: native.canWrite,
    canWrite: native.ready && (native.canWrite || custom.allows("runs.execute", native.origin?.organizationId)),
    permissionState: !native.ready || native.canWrite ? null : custom.error ? "unavailable" as const : !custom.ready ? "checking" as const : null,
    retryPermissions: () => custom.retry(),
    refresh: () => Promise.all([native.refresh(), custom.retry()]),
  };
}
