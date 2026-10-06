import { z } from "zod";
import { manualRetestExpectedScopeSchema } from "./manualRetestScopeSchema.js";

// Authoritative legacy constructors extracted without changing field order,
// optional omission, strictness, defaults or parser identity across exports.
// Browser-pure: no native service, database or Node hashing dependency.
const identity = z.string().min(1).max(200);
export const retestPreviewInputSchema = z
  .object({
    projectId: identity,
    sourceRunId: identity,
    testCaseId: identity,
    expectedScope: manualRetestExpectedScopeSchema.optional(),
  })
  .strict();
export const retestStartInputSchema = retestPreviewInputSchema.extend({
  expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().uuid(),
});
