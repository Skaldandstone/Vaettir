import { z } from "zod";

export const MAX_CASE_FOLDERS = 500;
export const MAX_FOLDER_CASES = 1000;
export const folderPathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((path) => {
    const parts = path.split("/");
    return (
      parts.length <= 8 &&
      parts.every(
        (part) =>
          part.length > 0 &&
          part.length <= 80 &&
          part.trim() === part &&
          ![".", "..", "__unassigned__"].includes(part) &&
          !Array.from(part).some((character) => {
            const code = character.charCodeAt(0);
            return character === "\\" || code < 32 || code === 127;
          }),
      )
    );
  }, "Use up to eight named levels, without empty, reserved or relative segments.");
export const folderRecordSchema = z
  .object({ id: z.string().min(1).max(100), path: folderPathSchema })
  .strict();
export const folderStateSchema = z
  .array(folderRecordSchema)
  .max(MAX_CASE_FOLDERS)
  .superRefine((rows, ctx) => {
    if (
      new Set(rows.map((r) => r.id)).size !== rows.length ||
      new Set(rows.map((r) => r.path)).size !== rows.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Folder identities and paths must be unique.",
      });
  });
const folderChangeFields = {
  projectId: z.string().min(1).max(200),
  action: z.enum(["CREATE", "RENAME", "MOVE"]),
  fromPath: folderPathSchema.optional(),
  toPath: folderPathSchema,
};
function validateAction(
  input: { action: string; fromPath?: string },
  ctx: z.RefinementCtx,
) {
  if ((input.action === "CREATE") === !!input.fromPath)
    ctx.addIssue({
      code: "custom",
      message: "Choose a source only for rename or move.",
    });
}
export const folderChangeSchema = z
  .object(folderChangeFields)
  .strict()
  .superRefine(validateAction);
export const approvedFolderChangeSchema = z
  .object({
    ...folderChangeFields,
    expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.string().uuid(),
    // Absence preserves legacy receipt hashes; new UI binds its review identity.
    expectedScope: z
      .object({
        organizationId: z.string().min(1).max(200),
        clerkActorId: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    confirmed: z.literal(true),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict()
  .superRefine(validateAction);

export function pathWithin(path: string, root: string) {
  return path === root || path.startsWith(`${root}/`);
}
export function folderAncestors(path: string) {
  return path.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"));
}
export function parentPath(path: string) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
}
export function leafPath(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}
