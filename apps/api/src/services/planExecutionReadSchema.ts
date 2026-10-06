import { z } from "zod";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";
import { planExecutionTemplateExactSchema } from "./planExecutionTemplateExactSchema.js";

// Read DTOs only. Do not import the legacy template service/Node hash/Prisma
// graph here: fixtures and future clients can inspect this exact wire contract.
export const PLAN_EXECUTION_READ_BOUNDS = Object.freeze({
  templateBytes: 1024 * 1024,
  selectedBytes: 1024 * 1024,
  candidateBytes: 512 * 1024,
  responseBytes: 2 * 1024 * 1024,
  cases: 500,
  configurations: 20,
  page: 50,
  depth: 64,
  nodes: 100000,
});
const id = z.string().min(1).max(200).refine(supportedManualExecutionIdentity);
export const planExecutionReadSubject = id;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const search = z.string().max(200).refine(value => ![...value].some(character => character === "\0" || (character.codePointAt(0)! >= 0xd800 && character.codePointAt(0)! <= 0xdfff)), "Literal search contains unsupported transport characters.");
const base = {
  projectId: id,
  testPlanId: id,
  originalOrganizationId: id,
  expectedClerkActorId: id,
  requestId: z.string().uuid(),
};
export const planExecutionAccessInput = z.object({ ...base, expectedNativeActorId: id.optional() }).strict();
export const planExecutionPageInput = z.object({
  ...base,
  expectedNativeActorId: id,
  search,
  limit: z.number().int().min(1).max(PLAN_EXECUTION_READ_BOUNDS.page),
  cursor: z.object({ scopeKey: z.string().max(8192), lastId: id }).strict().optional(),
}).strict();
export type PlanExecutionAccessInput = z.infer<typeof planExecutionAccessInput>;
export type PlanExecutionPageInput = z.infer<typeof planExecutionPageInput>;
export function planExecutionCandidateScopeKey(input: PlanExecutionPageInput) {
  return JSON.stringify(["PlanExecutionCandidates/v1", input.projectId, input.testPlanId, input.originalOrganizationId, input.expectedClerkActorId, input.expectedNativeActorId, input.search, input.limit]);
}
export function planExecutionReadKey(input: PlanExecutionAccessInput | PlanExecutionPageInput, projection: "ACCESS" | "PAGE") {
  return JSON.stringify([projection, input.projectId, input.testPlanId, input.originalOrganizationId, input.expectedClerkActorId, input.expectedNativeActorId ?? null, input.requestId, ...("search" in input ? [input.search, input.limit, input.cursor ? [input.cursor.scopeKey, input.cursor.lastId] : null] : [])]);
}
export const planExecutionReadScope = z.object({ projectId: id, testPlanId: id, organizationId: id, actorId: id, actorClerkUserId: id }).strict();
const context = (projection: "ACCESS" | "PAGE") => z.object({ requestId: z.string().uuid(), requestedKey: z.string().max(16384), projection: z.literal(projection), scope: planExecutionReadScope }).strict();
export const planExecutionAccessOutput = z.object({ readContext: context("ACCESS"), hasFullEditorAccess: z.boolean() }).strict();
const configuration = z.object({
  configuration: z.string().max(2000),
  platform: z.string().max(300), build: z.string().max(300),
  hardwareRevision: z.string().max(300), firmwareVersion: z.string().max(300),
  rig: z.string().max(300), batchOrLot: z.string().max(300),
  environment: z.string().max(2000), calibrationReference: z.string().max(300),
  protocolReference: z.string().max(300),
}).strict();
// This is the complete legacy INTERPRETED output, without new trim/default
// transforms. Exact native JSONB text is returned separately and hash-bound.
const template = z.object({
  version: z.literal(1),
  testCaseIds: z.array(id).max(PLAN_EXECUTION_READ_BOUNDS.cases),
  configurations: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(120), context: configuration }).strict()).max(PLAN_EXECUTION_READ_BOUNDS.configurations),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.testCaseIds).size !== value.testCaseIds.length || new Set(value.configurations.map(item => item.id)).size !== value.configurations.length) ctx.addIssue({ code: "custom", message: "Template identities must remain unique." });
});
const review = z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]);
export const planExecutionCaseMetadata = z.object({ id, title: z.string().max(10000), displayId: z.string().max(200), reviewStatus: review, archived: z.boolean() }).strict();
const selected = z.object({
  testCaseId: id,
  state: z.enum(["AVAILABLE", "ARCHIVED", "MISSING"]),
  metadata: planExecutionCaseMetadata.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.state === "MISSING" ? value.metadata !== null : !value.metadata || value.metadata.id !== value.testCaseId || value.metadata.archived !== (value.state === "ARCHIVED")) ctx.addIssue({ code: "custom", message: "Saved selection availability must match its exact native identity." });
});
export const planExecutionPageOutput = z.object({
  readContext: context("PAGE"),
  hasFullEditorAccess: z.boolean(),
  plan: z.object({ id, projectId: id, name: z.string().max(10000), status: z.enum(["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED", "ARCHIVED"]) }).strict(),
  rawTemplate: z.object({ sqlNull: z.literal(false), jsonText: z.string().max(PLAN_EXECUTION_READ_BOUNDS.templateBytes) }).strict(),
  template: z.union([template, planExecutionTemplateExactSchema]).nullable(),
  templateHash: hash,
  interpretation: z.enum(["UNCONFIGURED_EMPTY_OBJECT", "EXACT_SUPPORTED", "LEGACY_NORMALIZED", "EXACT_LITERAL_V2_READ_ONLY"]),
  selected: z.array(selected).max(PLAN_EXECUTION_READ_BOUNDS.cases),
  candidates: z.array(planExecutionCaseMetadata).max(PLAN_EXECUTION_READ_BOUNDS.page),
  search,
  limit: z.number().int().min(1).max(PLAN_EXECUTION_READ_BOUNDS.page),
  candidateScopeKey: z.string().max(8192),
  nextCursor: z.object({ scopeKey: z.string().max(8192), lastId: id }).strict().nullable(),
  limitations: z.array(z.string().max(1000)).max(8),
}).strict().superRefine((value, ctx) => {
  const ids = value.template?.testCaseIds ?? [];
  if ((value.template?.version === 2) !== (value.interpretation === "EXACT_LITERAL_V2_READ_ONLY")) ctx.addIssue({ code: "custom", message: "Literal version-2 templates are read-only and cannot adopt a legacy interpretation." });
  if (value.plan.projectId !== value.readContext.scope.projectId || value.plan.id !== value.readContext.scope.testPlanId || ids.length !== value.selected.length || ids.some((item, index) => item !== value.selected[index]?.testCaseId) || value.candidates.length > value.limit || new Set(value.candidates.map(item => item.id)).size !== value.candidates.length || value.candidates.some(item => item.archived) || (value.template === null) !== (value.interpretation === "UNCONFIGURED_EMPTY_OBJECT") || value.nextCursor && (value.nextCursor.scopeKey !== value.candidateScopeKey || value.nextCursor.lastId !== value.candidates.at(-1)?.id)) ctx.addIssue({ code: "custom", message: "The complete template, saved selection and current candidate page must reconcile." });
});
