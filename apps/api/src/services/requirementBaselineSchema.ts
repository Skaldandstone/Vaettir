import { z } from "zod";
const id = z.string().min(1).max(120), offset = z.number().int().min(0);
export const requirementBaselineExpectedScope = z.object({ organizationId: id, clerkActorId: z.string().min(1).max(200) }).strict();
export const requirementBaselineSnapshot = z.object({ version: z.literal(1),
  requirement: z.object({ title: z.string().min(1).max(300), description: z.string().max(10000).nullable(),
    externalRef: z.string().max(1500).nullable(), externalRefWithheld: z.boolean(),
    linearIssueId: z.string().max(120).nullable(), jiraIssueKey: z.string().max(120).nullable(),
    issueIdentifiersWithheld: z.boolean() }).strict(),
  links: z.array(z.object({ id, caseId: id, displayId: z.string().max(160), title: z.string().max(120), titleIsExcerpt: z.boolean(), archived: z.boolean() }).strict()).max(40),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value, null, 1)).length <= 48000,
  "The reviewed baseline exceeds the bounded 48,000-byte capture; nothing has been silently truncated");
export const requirementBaselineListInput = z.object({ projectId: id, expectedScope: requirementBaselineExpectedScope.optional(), offset: offset.max(980).default(0), search: z.string().trim().max(80).default("") }).strict();
export const requirementBaselineDetailInput = z.object({ projectId: id, requirementId: id.optional(), baselineId: id.optional(),
  expectedScope: requirementBaselineExpectedScope.optional(),
  historyOffset: offset.max(90).default(0), affectedOffset: offset.max(60).default(0) }).strict()
  .refine(value => !!value.requirementId || !!value.baselineId, "Select a requirement or retained baseline");
export const requirementBaselineCaptureInput = z.object({ projectId: id, requirementId: id, requestId: z.string().uuid(),
  expectedScope: requirementBaselineExpectedScope.optional(),
  expectedLatestVersion: z.number().int().min(0).max(99), currentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  rationale: z.string().trim().min(1).max(600), acknowledgeNotVerifiedCoverage: z.literal(true) }).strict();
export const requirementBaselineReceipt = z.object({ requestId: z.string().uuid(), baselineId: id,
  displayId: z.string().max(160), version: z.number().int().min(1).max(100) }).strict();
export type RequirementBaselineCapture = z.infer<typeof requirementBaselineCaptureInput>;
export type RequirementBaselineSnapshot = z.infer<typeof requirementBaselineSnapshot>;
// Response-only identity. The persisted four-field legacy receipt stays exact.
export const requirementBaselineAcknowledgement = requirementBaselineReceipt.extend({
  projectId: id, organizationId: id, clerkActorId: z.string().min(1).max(200),
  requirementId: id, capturedFingerprint: z.string().regex(/^[a-f0-9]{64}$/), acknowledgementKey: z.string().max(2000),
}).strict();
export function requirementBaselineAcknowledgementKey(input: RequirementBaselineCapture): string {
  return JSON.stringify([input.projectId, input.requirementId, input.requestId, input.expectedLatestVersion, input.currentFingerprint,
    ...(input.expectedScope ? [input.expectedScope.organizationId, input.expectedScope.clerkActorId] : [])]);
}
