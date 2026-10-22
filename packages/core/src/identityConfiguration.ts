import { z } from "zod";
import { IDENTITY_PERMISSIONS } from "./identityPolicy.js";

const identifier = z.string().trim().min(1).max(512);
const ids = z.array(identifier).max(10000).refine(values => new Set(values).size === values.length, "Remove duplicate selections");
export const identityScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workspace") }).strict(),
  z.object({ kind: z.literal("projects"), projectIds: ids.refine(values => values.length > 0, "Choose a project") }).strict(),
]);
export const identityRoleDraftSchema = z.object({
  id: identifier, name: z.string().trim().min(1).max(100),
  permissions: z.array(z.enum(IDENTITY_PERMISSIONS)).min(1).max(IDENTITY_PERMISSIONS.length)
    .refine(values => new Set(values).size === values.length, "Remove duplicate permissions"),
}).strict();
export const identityGroupDraftSchema = z.object({
  id: identifier, name: z.string().trim().min(1).max(100),
  userIds: ids, roleIds: ids.refine(values => values.length > 0, "Choose a role"), scope: identityScopeSchema,
}).strict();

// Editable preparation document, NOT the active authorization policy.
// Only a verified activation transaction may copy it into runtime records.
export const identityConfigurationSchema = z.object({
  schemaVersion: z.literal(1),
  roles: z.array(identityRoleDraftSchema).max(100),
  groups: z.array(identityGroupDraftSchema).max(250),
}).strict().superRefine((value, ctx) => {
  for (const kind of ["roles", "groups"] as const) {
    const uniqueIds = new Set<string>(); const names = new Set<string>();
    value[kind].forEach((item, index) => {
      if (uniqueIds.has(item.id)) ctx.addIssue({ code: "custom", path: [kind, index, "id"], message: "Duplicate identifier" });
      if (names.has(item.name.toLowerCase())) ctx.addIssue({ code: "custom", path: [kind, index, "name"], message: "Choose a unique name" });
      uniqueIds.add(item.id); names.add(item.name.toLowerCase());
    });
  }
  const roleIds = new Set(value.roles.map(role => role.id));
  value.groups.forEach((group, index) => {
    if (group.roleIds.some(roleId => !roleIds.has(roleId))) ctx.addIssue({ code: "custom", path: ["groups", index, "roleIds"], message: "A selected role no longer exists" });
  });
});
export type IdentityConfiguration = z.infer<typeof identityConfigurationSchema>;
export const emptyIdentityConfiguration = (): IdentityConfiguration => ({ schemaVersion: 1, roles: [], groups: [] });

/** Validate references against fresh tenant-scoped rows inside the save transaction. */
export function validateIdentityReferences(configuration: IdentityConfiguration, reference: { userIds: string[]; projectIds: string[] }) {
  const users = new Set(reference.userIds); const projects = new Set(reference.projectIds);
  for (const group of configuration.groups) {
    if (group.userIds.some(id => !users.has(id))) throw new Error("A selected member no longer belongs to this workspace. Reload and review the group.");
    if (group.scope.kind === "projects" && group.scope.projectIds.some(id => !projects.has(id)))
      throw new Error("A selected project no longer belongs to this workspace. Reload and review the group.");
  }
}

export const IDENTITY_PERMISSION_LABELS: Record<typeof IDENTITY_PERMISSIONS[number], string> = {
  "project.read": "View projects", "cases.read": "View cases", "cases.write": "Edit cases",
  "plans.read": "View plans", "plans.write": "Edit plans", "runs.read": "View results", "runs.execute": "Execute tests",
  "requirements.read": "View requirements", "requirements.write": "Edit requirements", "architecture.read": "View architecture",
  "architecture.write": "Edit architecture", "reports.read": "View reports", "reports.create": "Create reports",
  "integrations.read": "View integrations", "integrations.manage": "Manage integrations", "audit.read": "View audit history",
};
