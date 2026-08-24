import { z } from "zod";

// The structured step-table authoring format: an alternative to BDD
// given/when/then for test cases where the technical layer (what API call
// fires, what it returns) matters separately from what the user sees. See
// TestCaseStep in packages/db/prisma/schema.prisma for the full rationale.

export const TestCaseStepInputSchema = z.object({
  action: z.string().min(1),
  expectedActionOrData: z.string().nullable().optional(),
  expectedResult: z.string().nullable().optional(),
  expectedResponse: z.string().nullable().optional(),
});

export type TestCaseStepInput = z.infer<typeof TestCaseStepInputSchema>;

// Display labels for the four TestCaseStep fields. These names are
// placeholders by design -- Organization.stepFieldLabels can override any
// subset of them per org without a schema change.
export const DEFAULT_STEP_FIELD_LABELS = {
  action: "Test Step",
  expectedActionOrData: "Expected Action / Data",
  expectedResult: "Expected Result",
  expectedResponse: "Expected Response",
} as const;

export type StepFieldKey = keyof typeof DEFAULT_STEP_FIELD_LABELS;

export function resolveStepFieldLabels(
  orgOverrides: Partial<Record<StepFieldKey, string>> | null | undefined,
): Record<StepFieldKey, string> {
  return { ...DEFAULT_STEP_FIELD_LABELS, ...(orgOverrides ?? {}) };
}
