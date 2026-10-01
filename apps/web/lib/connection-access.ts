type CapabilityQuery = {
  isSuccess: boolean;
  error: unknown;
  data?: { canConnect: boolean };
};
type SavedAccessQuery = { isSuccess: boolean; error: unknown };

export type ConnectionAccessState =
  | "checking-permissions" | "permission-error" | "denied"
  | "checking-connections" | "connection-error" | "ready";

/** Cached positive responses are not permission or connection proof after a failed refresh. */
export function connectionAccessState(capabilities: CapabilityQuery, savedAccess: SavedAccessQuery): ConnectionAccessState {
  if (!capabilities.isSuccess) return capabilities.error ? "permission-error" : "checking-permissions";
  if (capabilities.data?.canConnect !== true) return "denied";
  if (!savedAccess.isSuccess) return savedAccess.error ? "connection-error" : "checking-connections";
  return "ready";
}
