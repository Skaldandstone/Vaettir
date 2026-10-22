"use client";
import { useProjectPermissions } from "./use-project-permissions";
import { useProjectCustomActions } from "./use-project-custom-actions";

/** Only manual case create/edit pages. Never reuse for imports, bulk actions,
 * schema administration, integrations or provider/AI execution. */
export function useManualCasePermissions(projectId: string) {
  const native = useProjectPermissions(projectId), custom = useProjectCustomActions(projectId);
  return {
    canEdit: !native.accessError && (native.canEdit || custom.allows("cases.write", native.organizationId)),
    loaded: native.loaded && (native.canEdit || custom.ready || !!custom.error),
    accessError: native.accessError ?? (native.canEdit ? null : custom.error),
    retryAccess: () => { native.retryAccess(); void custom.retry(); },
  };
}
