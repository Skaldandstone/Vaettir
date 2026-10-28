/**
 * Provider-independent enterprise access policy. No network or database effects.
 * Inputs must come from persisted, tenant-bound configuration and an authenticated
 * directory adapter, never from a browser's roles/groups or user-editable metadata.
 * This module is deliberately not wired into the legacy role hierarchy yet.
 */
export const IDENTITY_PERMISSIONS = [
  "project.read", "cases.read", "cases.write", "plans.read", "plans.write",
  "runs.read", "runs.execute", "requirements.read", "requirements.write",
  "architecture.read", "architecture.write", "reports.read", "reports.create",
  "integrations.read", "integrations.manage", "audit.read",
] as const;
export type IdentityPermission = typeof IDENTITY_PERMISSIONS[number];
export type IdentityScope = { kind: "workspace" } | { kind: "projects"; projectIds: string[] };
export type IdentityRole = {
  id: string; organizationId: string; name: string; permissions: IdentityPermission[];
};
export type IdentityConnection = {
  id: string; organizationId: string; enabled: boolean;
  // Verified by the adapter against the configured Clerk enterprise connection.
  providerConnectionId: string;
};
export type IdentityGroupMapping = {
  id: string; organizationId: string; connectionId: string;
  externalGroupId: string; roleId: string; scope: IdentityScope;
};
export type IdentityGroup = {
  id: string; organizationId: string; name: string; userIds: string[];
  roleIds: string[]; scope: IdentityScope;
};
export type IdentityGrant = {
  organizationId: string; userId: string; roleId: string; scope: IdentityScope;
  source: { kind: "local-group"; groupId: string } | {
    kind: "directory"; connectionId: string; externalSubjectId: string;
    mappingId: string; externalGroupId: string; expiresAt: number;
  };
};
export type DirectorySubjectSnapshot = {
  organizationId: string; connectionId: string; externalSubjectId: string;
  userId: string; active: boolean; externalGroupIds: string[];
  // All pages must be fetched before complete=true. Absence in a partial page
  // must never revoke a user, nor may it grant incomplete/ambiguous privileges.
  complete: boolean;
  // A local monotonic reconciliation generation, NOT a provider timestamp.
  // The adapter reserves it before fetching and CAS-commits it with the grants.
  generation: number; observedAt: number; expiresAt: number;
};
export type DirectoryBinding = {
  organizationId: string; connectionId: string; externalSubjectId: string;
  userId: string; generation: number;
};
export type IdentityCatalog = {
  organizationId: string; projectIds: string[]; roles: IdentityRole[];
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function id(value: unknown): asserts value is string {
  invariant(typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 512,
    "Invalid identity identifier");
}
function unique(values: string[], description: string) {
  values.forEach(id);
  invariant(new Set(values).size === values.length, `Duplicate ${description}`);
}
function validateScope(scope: IdentityScope, projectIds: string[]) {
  invariant(scope && (scope.kind === "workspace" || scope.kind === "projects"), "Invalid access scope");
  if (scope.kind === "projects") {
    invariant(Array.isArray(scope.projectIds) && scope.projectIds.length > 0, "Select at least one project");
    unique(scope.projectIds, "project");
    invariant(scope.projectIds.every(project => projectIds.includes(project)), "Project outside workspace");
  }
}
export function validateIdentityRole(role: IdentityRole, organizationId: string) {
  id(role.id); id(role.organizationId);
  invariant(role.organizationId === organizationId, "Role outside workspace");
  invariant(typeof role.name === "string" && role.name.trim().length > 0 && role.name.length <= 100, "Invalid role name");
  invariant(Array.isArray(role.permissions) && role.permissions.length > 0, "Select at least one permission");
  unique(role.permissions, "permission");
  invariant(role.permissions.every(permission => (IDENTITY_PERMISSIONS as readonly string[]).includes(permission)),
    "Unknown or reserved permission");
}
function validateCatalog(catalog: IdentityCatalog) {
  id(catalog.organizationId);
  unique(catalog.projectIds, "project");
  unique(catalog.roles.map(role => role.id), "role");
  catalog.roles.forEach(role => validateIdentityRole(role, catalog.organizationId));
}
export function validateIdentityMapping(mapping: IdentityGroupMapping, connection: IdentityConnection, catalog: IdentityCatalog) {
  validateCatalog(catalog);
  [mapping.id, mapping.connectionId, mapping.externalGroupId, mapping.roleId, connection.id, connection.providerConnectionId].forEach(id);
  invariant(mapping.organizationId === catalog.organizationId && connection.organizationId === catalog.organizationId,
    "Connection or mapping outside workspace");
  invariant(mapping.connectionId === connection.id, "Mapping belongs to a different connection");
  invariant(catalog.roles.some(role => role.id === mapping.roleId), "Unknown mapped role");
  validateScope(mapping.scope, catalog.projectIds);
}
function copyScope(scope: IdentityScope): IdentityScope {
  return scope.kind === "workspace" ? { kind: "workspace" } : { kind: "projects", projectIds: [...scope.projectIds].sort() };
}

/** Recompute local-group grants from current data; no stale membership cache. */
export function localGroupGrants(catalog: IdentityCatalog, groups: IdentityGroup[], userId: string): IdentityGrant[] {
  validateCatalog(catalog); id(userId);
  unique(groups.map(group => group.id), "group");
  return groups.flatMap(group => {
    invariant(group.organizationId === catalog.organizationId, "Group outside workspace");
    invariant(typeof group.name === "string" && group.name.trim().length > 0 && group.name.length <= 100, "Invalid group name");
    unique(group.userIds, "group member"); unique(group.roleIds, "group role");
    validateScope(group.scope, catalog.projectIds);
    invariant(group.roleIds.every(roleId => catalog.roles.some(role => role.id === roleId)), "Unknown group role");
    if (!group.userIds.includes(userId)) return [];
    return group.roleIds.map(roleId => ({ organizationId: catalog.organizationId, userId, roleId,
      scope: copyScope(group.scope), source: { kind: "local-group" as const, groupId: group.id } }));
  });
}

export type DirectoryReconciliation = {
  expectedGeneration: number;
  generation: number;
  replace: { organizationId: string; userId: string; connectionId: string; externalSubjectId: string };
  grants: IdentityGrant[];
  reason: "mapped" | "unmapped" | "deprovisioned" | "connection-disabled";
};

/**
 * Produces an atomic replacement plan for ONE directory subject. The repository
 * must lock/CAS the binding generation, replace only this provenance tuple, and
 * record the audit event in the same transaction. Independent grants survive.
 * Replays/out-of-order snapshots fail, so they cannot resurrect revoked access.
 */
export function planDirectoryReconciliation(input: {
  catalog: IdentityCatalog; connection: IdentityConnection; binding: DirectoryBinding;
  snapshot: DirectorySubjectSnapshot; mappings: IdentityGroupMapping[]; now: number;
}): DirectoryReconciliation {
  const { catalog, connection, binding, snapshot, mappings, now } = input;
  validateCatalog(catalog);
  [connection.id, connection.providerConnectionId, binding.externalSubjectId, binding.userId].forEach(id);
  invariant(connection.organizationId === catalog.organizationId && binding.organizationId === catalog.organizationId &&
    snapshot.organizationId === catalog.organizationId, "Directory subject outside workspace");
  invariant(binding.connectionId === connection.id && snapshot.connectionId === connection.id, "Directory connection mismatch");
  invariant(binding.userId === snapshot.userId && binding.externalSubjectId === snapshot.externalSubjectId,
    "Directory subject binding mismatch");
  invariant(typeof connection.enabled === "boolean" && typeof snapshot.active === "boolean", "Invalid directory state");
  invariant(snapshot.complete === true, "Directory snapshot is incomplete");
  invariant(Number.isSafeInteger(binding.generation) && binding.generation >= 0 &&
    Number.isSafeInteger(snapshot.generation) && snapshot.generation > binding.generation, "Stale directory generation");
  invariant(Number.isSafeInteger(now) && Number.isSafeInteger(snapshot.observedAt) &&
    Number.isSafeInteger(snapshot.expiresAt) && snapshot.observedAt <= now && snapshot.expiresAt > now &&
    snapshot.observedAt >= 0, "Directory snapshot is stale or invalid");
  unique(snapshot.externalGroupIds, "external group"); unique(mappings.map(mapping => mapping.id), "mapping");
  mappings.forEach(mapping => validateIdentityMapping(mapping, connection, catalog));
  const matching = snapshot.active && connection.enabled
    ? mappings.filter(mapping => snapshot.externalGroupIds.includes(mapping.externalGroupId)) : [];
  return {
    expectedGeneration: binding.generation, generation: snapshot.generation,
    replace: { organizationId: catalog.organizationId, userId: binding.userId,
      connectionId: connection.id, externalSubjectId: binding.externalSubjectId },
    grants: matching.map(mapping => ({ organizationId: catalog.organizationId, userId: binding.userId,
      roleId: mapping.roleId, scope: copyScope(mapping.scope), source: {
        kind: "directory", connectionId: connection.id, externalSubjectId: binding.externalSubjectId,
        mappingId: mapping.id, externalGroupId: mapping.externalGroupId, expiresAt: snapshot.expiresAt,
      } })),
    reason: !connection.enabled ? "connection-disabled" : !snapshot.active ? "deprovisioned" : matching.length ? "mapped" : "unmapped",
  };
}

/** No rank conversion: a custom case editor does not become a general EDITOR. */
export function resolveIdentityPermissions(input: {
  catalog: IdentityCatalog; userId: string; projectId: string; now: number;
  suspended: boolean; directoryGrants: IdentityGrant[]; groups: IdentityGroup[];
  connections: IdentityConnection[]; mappings: IdentityGroupMapping[];
}): IdentityPermission[] {
  const { catalog, userId, projectId, now, suspended, directoryGrants, groups, connections, mappings } = input;
  validateCatalog(catalog); id(userId); id(projectId);
  invariant(Number.isSafeInteger(now) && now >= 0, "Invalid permission evaluation time");
  if (suspended !== false || !catalog.projectIds.includes(projectId)) return [];
  unique(connections.map(connection => connection.id), "connection");
  unique(mappings.map(mapping => mapping.id), "mapping");
  // Local group membership and external mapping edits take effect on the next
  // request, without waiting for another provider sync or cached session refresh.
  const grants = [...localGroupGrants(catalog, groups, userId),
    ...directoryGrants.filter(grant => grant.source.kind === "directory")];
  const permissions = new Set<IdentityPermission>();
  for (const grant of grants) {
    if (grant.organizationId !== catalog.organizationId || grant.userId !== userId) continue;
    if (grant.scope.kind !== "workspace" &&
      (grant.scope.kind !== "projects" || !grant.scope.projectIds.includes(projectId))) continue;
    if (grant.source.kind === "directory") {
      const source = grant.source;
      const connection = connections.find(candidate => candidate.id === source.connectionId &&
        candidate.organizationId === catalog.organizationId && candidate.enabled === true);
      const mapping = mappings.find(candidate => candidate.id === source.mappingId &&
        candidate.organizationId === catalog.organizationId && candidate.connectionId === source.connectionId &&
        candidate.externalGroupId === source.externalGroupId && candidate.roleId === grant.roleId);
      if (!connection || !mapping ||
        !Number.isSafeInteger(grant.source.expiresAt) || grant.source.expiresAt <= now) continue;
      // An edited mapping may shrink its scope immediately, but expanding it
      // must not expand an old grant before reconciliation authorizes the change.
      if (mapping.scope.kind !== "workspace" &&
        (mapping.scope.kind !== "projects" || !mapping.scope.projectIds.includes(projectId))) continue;
    } else if (grant.source.kind !== "local-group") continue;
    const role = catalog.roles.find(candidate => candidate.id === grant.roleId);
    role?.permissions.forEach(permission => permissions.add(permission));
  }
  return IDENTITY_PERMISSIONS.filter(permission => permissions.has(permission));
}

export type EnterpriseSessionEvidence = {
  sessionId: string; userId: string; organizationId: string; providerConnectionId: string;
  // Evidence must describe this session's authentication, not the user's list
  // of linked enterprise accounts. Adapter verifies it server-side.
  authenticatedAt: number; expiresAt: number;
};
function validSessionId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    !/[\s\p{Cc}\p{Cf}]/u.test(value);
}
export function satisfiesEnterpriseSignIn(input: {
  userId: string; organizationId: string; required: boolean; suspended: boolean;
  // Independently verified current server session, null without a verified human
  // session. Matching caller-supplied IDs alone do not authenticate either input.
  sessionId: string | null;
  connections: IdentityConnection[]; session: EnterpriseSessionEvidence | null; now: number;
}): boolean {
  if (input.suspended !== false || !Number.isSafeInteger(input.now) || input.now < 0) return false;
  if (input.required === false) return true;
  if (input.required !== true) return false;
  const session = input.session;
  return !!session && validSessionId(input.sessionId) && validSessionId(session.sessionId) &&
    session.sessionId === input.sessionId &&
    session.userId === input.userId && session.organizationId === input.organizationId &&
    Number.isSafeInteger(session.authenticatedAt) && session.authenticatedAt >= 0 && session.authenticatedAt <= input.now &&
    Number.isSafeInteger(session.expiresAt) && session.expiresAt > input.now &&
    input.connections.some(connection => connection.enabled === true && connection.organizationId === input.organizationId &&
      connection.providerConnectionId === session.providerConnectionId);
}
