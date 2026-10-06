import { z } from "zod";
import { createHash } from "node:crypto";

// tRPC uses plain JSON: browser Dates arrive as ISO strings, not Date objects.
// Do not coerce null, booleans, numbers or blank strings into real dates.
export const releaseTargetDateSchema = z
  .union([
    z.date(),
    z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
  ])
  .pipe(z.date());

const inlinePlanName = z.string().trim().min(1).max(200);
// Absence preserves the original parser, output property order and UUID hash.
// New clients opt into exact prose; old receipts are never reinterpreted.
const inlinePlanSchema = z.union([
  z.object({
    name: inlinePlanName,
    criteria: z.array(z.string().trim().min(1).max(2000)).min(1).max(50),
    wordingMode: z.never().optional(),
  }).strict().transform(({ wordingMode: _omitted, ...plan }) => plan),
  z.object({
    name: inlinePlanName,
    criteria: z.array(z.string().min(1).max(2000)
      .refine(value => value.trim().length > 0, "Criterion wording cannot be blank.")
      .refine(value => !value.includes("\0") && Array.from(value).every(character => {
        const point = character.codePointAt(0)!;
        return point < 0xd800 || point > 0xdfff;
      }), "Criterion wording must be valid native text.")).min(1).max(50),
    wordingMode: z.literal("EXACT"),
  }).strict(),
]);

export const releaseCreationSchema = z
  .object({
    requestId: z.string().uuid(),
    originalOrganizationId: z.string().min(1).max(200),
    expectedClerkActorId: z.string().min(1).max(200),
    projectId: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    targetDate: releaseTargetDateSchema.optional(),
    testPlanIds: z.array(z.string().min(1).max(200)).max(200).default([]),
    goals: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    newPlan: inlinePlanSchema.optional(),
  })
  .strict();

export const releaseCreationOutput = z.object({
  id: z.string(),
  name: z.string(),
  requestId: z.string().uuid(),
  projectId: z.string(),
  originalOrganizationId: z.string(),
  expectedClerkActorId: z.string(),
});

export function releaseCreationIdentity(
  input: z.input<typeof releaseCreationSchema>,
  actorId: string,
) {
  const parsed = releaseCreationSchema.parse(input);
  return {
    input: parsed,
    requestHash: createHash("sha256")
      .update(JSON.stringify(parsed))
      .digest("hex"),
    releaseId: `release_${createHash("sha256")
      .update(
        JSON.stringify([
          parsed.originalOrganizationId,
          parsed.projectId,
          actorId,
          parsed.requestId,
        ]),
      )
      .digest("hex")}`,
  };
}
