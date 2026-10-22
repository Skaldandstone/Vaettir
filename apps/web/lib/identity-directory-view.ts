import type { IdentityScope } from "@vaettir/core";

type Mapping = { externalGroupId: string; roleId: string; scope: IdentityScope };

// Array/project ordering is not an access change. Never mutate a saved snapshot.
export function sameDirectoryMappings(left: readonly Mapping[], right: readonly Mapping[]) {
  const key = (items: readonly Mapping[]) => JSON.stringify(items.map(item => JSON.stringify([
    item.externalGroupId, item.roleId, item.scope.kind,
    item.scope.kind === "projects" ? [...item.scope.projectIds].sort() : [],
  ])).sort());
  return key(left) === key(right);
}

export function directoryObservationLabel(connection: {
  enabled: boolean; staleMembers: number; observedMembers: number; lastObservedAt: string | null;
}) {
  if (!connection.enabled) return "Disabled";
  if (!connection.lastObservedAt) return "Not yet synced";
  if (connection.staleMembers) return "Sync needed";
  if (!connection.observedMembers) return "No members observed";
  return "Observations current";
}
