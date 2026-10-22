import { identityScopeSchema } from "@vaettir/core";
import { z } from "zod";
export const directoryMappingsSchema = z.array(z.object({
  externalGroupId: z.string().min(1).max(512), roleId: z.string().min(1).max(512), scope: identityScopeSchema,
}).strict()).max(250).superRefine((items, ctx) => {
  const pairs = items.map(item => `${item.externalGroupId.length}:${item.externalGroupId}${item.roleId}`);
  if (new Set(pairs).size !== pairs.length) ctx.addIssue({ code: "custom", message: "Map each group and role once." });
});
export type DirectoryMapping = z.infer<typeof directoryMappingsSchema>[number];
