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
    refresh: () => Promise.all([native.refresh(), custom.retry()]),
  };
}
