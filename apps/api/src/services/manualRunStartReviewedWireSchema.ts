import { z } from "zod";
import { experienceProfileSchema } from "@vaettir/core";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";

// Browser-safe read DTOs only. No native authorization, Prisma or Node imports.
const id = z.string().min(1).max(200).refine(supportedManualExecutionIdentity);
export const manualRunStartReviewedAuthenticatedSubject = id;
const base = z
  .object({
    projectId: id,
    originalOrganizationId: id,
    expectedClerkActorId: id,
    expectedNativeActorId: id.optional(),
    requestId: z.string().uuid(),
  })
  .strict();
export const manualRunStartReviewedAccessInput = base;
export const manualRunStartReviewedPreviewInput = base
  .extend({ expectedNativeActorId: id })
  .strict();
export const manualRunStartReviewedReadScope = z
  .object({
    projectId: id,
    organizationId: id,
    actorId: id,
    actorClerkUserId: id,
  })
  .strict();
export function manualRunStartReviewedReadKey(
  input: z.infer<typeof base>,
  projection: "ACCESS" | "PREVIEW",
) {
  return JSON.stringify([
    projection,
    input.projectId,
    input.originalOrganizationId,
    input.expectedClerkActorId,
    input.expectedNativeActorId ?? null,
    input.requestId,
  ]);
}
const context = z
  .object({
    requestId: z.string().uuid(),
    requestedKey: z.string().min(1).max(8192),
    scope: manualRunStartReviewedReadScope,
  })
  .strict();
const capabilities = { canConfigure: z.boolean(), canRecover: z.boolean() };
export const manualRunStartReviewedAccessOutput = z
  .object({
    readContext: context.extend({ projection: z.literal("ACCESS") }).strict(),
    ...capabilities,
  })
  .strict()
  .refine(
    (value) => value.canConfigure === value.canRecover,
    "Current full-editor capabilities must agree.",
  );
export const manualRunStartReviewedProfile = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("SUPPORTED"),
      experience: experienceProfileSchema.nullable(),
      profileHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("UNSUPPORTED"),
      reason: z.literal("PROFILE_UNAVAILABLE"),
    })
    .strict(),
]);
export const manualRunStartReviewedPreviewOutput = z
  .object({
    readContext: context.extend({ projection: z.literal("PREVIEW") }).strict(),
    ...capabilities,
    canStart: z.boolean(),
    profile: manualRunStartReviewedProfile,
    limitations: z.array(z.string().max(1000)).max(8),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.canConfigure !== value.canRecover ||
      value.canStart !==
        (value.canConfigure && value.profile.kind === "SUPPORTED")
    )
      ctx.addIssue({
        code: "custom",
        message: "Current capabilities and profile admission must reconcile.",
      });
  });
export type ManualRunStartReviewedAccessInput = z.infer<
  typeof manualRunStartReviewedAccessInput
>;
export type ManualRunStartReviewedPreviewInput = z.infer<
  typeof manualRunStartReviewedPreviewInput
>;
