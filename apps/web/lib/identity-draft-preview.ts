import { IDENTITY_PERMISSIONS, identityConfigurationSchema, validateIdentityReferences, type IdentityPermission } from "@vaettir/core";

export type DraftRulePreview =
  | { status: "select" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; rules: { permission: IdentityPermission; sources: { groupId: string; groupName: string; roleId: string; roleName: string }[] }[] };

/** Display-only local draft inspection. Never use as server authorization,
 * directory evidence, current permissions or a seat/entitlement decision. */
export function previewIdentityDraft(input: {
  configuration: unknown; userId: string; projectId: string;
  memberIds: string[]; projectIds: string[];
}): DraftRulePreview {
  if (!input.userId || !input.projectId) return { status: "select" };
  if (!input.memberIds.includes(input.userId) || !input.projectIds.includes(input.projectId))
    return { status: "unavailable", message: "That member or project is no longer available. Reload and choose again." };
  const parsed = identityConfigurationSchema.safeParse(input.configuration);
  if (!parsed.success) return { status: "unavailable", message: "This draft needs review before it can be previewed." };
  try { validateIdentityReferences(parsed.data, { userIds: input.memberIds, projectIds: input.projectIds }); }
  catch { return { status: "unavailable", message: "A draft group references an unavailable member or project. Review its selections." }; }
  const { groups, roles } = parsed.data;
  const matching = groups.filter(group => group.userIds.includes(input.userId)
    && (group.scope.kind === "workspace" || group.scope.projectIds.includes(input.projectId)));
  const rules = IDENTITY_PERMISSIONS.flatMap(permission => {
    const sources = matching.flatMap(group => roles.filter(role => group.roleIds.includes(role.id) && role.permissions.includes(permission))
      .map(role => ({ groupId: group.id, groupName: group.name, roleId: role.id, roleName: role.name })));
    return sources.length ? [{ permission, sources }] : [];
  });
  return { status: "ready", rules };
}
