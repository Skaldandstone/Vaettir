import { createHash } from "node:crypto";
import { z } from "@vaettir/core/dist/validation.js";

export const AI_CASE_SCOPE = "approved_case_snapshot";
export const aiCaseFields = z.enum(["title", "given", "when", "then"]);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const aiCaseSelection = z.object({
  organizationId: id,
  projectId: id,
  caseIds: z.array(id).min(1).max(20),
  fields: z.array(aiCaseFields).min(1).max(4),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.caseIds).size !== v.caseIds.length || new Set(v.fields).size !== v.fields.length)
    ctx.addIssue({ code: "custom", message: "Choose each case and field once." });
});
const text = z.string().max(8_000);
export const aiCaseSnapshot = z.object({
  version: z.literal(1),
  organizationId: id,
  projectId: id,
  classificationVersion: z.number().int().positive(),
  fields: z.array(aiCaseFields).min(1).max(4),
  cases: z.array(z.object({
    id,
    title: text.optional(),
    given: z.array(text).max(100).optional(),
    when: z.array(text).max(100).optional(),
    then: z.array(text).max(100).optional(),
  }).strict()).min(1).max(20),
}).strict().superRefine((v, ctx) => {
  // Validate positive projection, including on values read back from storage.
  if (new Set(v.fields).size !== v.fields.length || new Set(v.cases.map(c => c.id)).size !== v.cases.length ||
      v.cases.some(c => aiCaseFields.options.some(f => v.fields.includes(f) !== (c[f] !== undefined))))
    ctx.addIssue({ code: "custom", message: "Snapshot fields do not match approval." });
  if (Buffer.byteLength(JSON.stringify(v), "utf8") > 128 * 1024)
    ctx.addIssue({ code: "custom", message: "Select fewer cases or fields." });
});
export type AiCaseSnapshot = z.infer<typeof aiCaseSnapshot>;
type CaseSource = { id: string; projectId: string; title: string; given: string[]; when: string[]; then: string[] };

/** No source objects, attachments, metadata, custom fields or extra keys escape. */
export function projectAiCases(selection: z.infer<typeof aiCaseSelection>, rows: CaseSource[], classificationVersion: number): AiCaseSnapshot {
  selection = aiCaseSelection.parse(selection);
  if (rows.length !== selection.caseIds.length || new Set(rows.map(r => r.id)).size !== rows.length ||
      rows.some(r => r.projectId !== selection.projectId || !selection.caseIds.includes(r.id)))
    throw new Error("The selected cases changed.");
  const fields = aiCaseFields.options.filter(f => selection.fields.includes(f));
  const cases = [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(row => {
    const out: AiCaseSnapshot["cases"][number] = { id: row.id };
    for (const field of fields) {
      if (field === "title") out.title = row.title;
      else out[field] = [...row[field]];
    }
    return out;
  });
  return aiCaseSnapshot.parse({ version: 1, organizationId: selection.organizationId, projectId: selection.projectId, classificationVersion, fields, cases });
}

export function aiCaseDigest(value: AiCaseSnapshot) {
  // Normalize ordering so hashes bind the exact positive projection, independent
  // of SQL row order or JSON-object key order. Duplicate selections are refused.
  const v = aiCaseSnapshot.parse(value);
  const canonical = projectAiCases({ organizationId: v.organizationId, projectId: v.projectId, caseIds: v.cases.map(c => c.id), fields: v.fields },
    v.cases.map(c => ({ id: c.id, projectId: v.projectId, title: c.title ?? "", given: c.given ?? [], when: c.when ?? [], then: c.then ?? [] })), v.classificationVersion);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function aiCaseClassificationAllowed(value: string) {
  return value === "SYNTHETIC" || value === "CUSTOMER_PROPRIETARY";
}
