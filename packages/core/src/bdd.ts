import { z } from "zod";

// The canonical shape the AI agent must emit when reverse-engineering an
// automated test into a human-readable BDD test case, and the shape the
// web/mobile authoring UI edits directly. Keeping this in @qi/core means
// the agent, the API, and both frontends validate against one definition.

export const BddStepSchema = z.string().min(1);

export const ReverseEngineeredTestCaseSchema = z.object({
  title: z.string().min(1),
  background: z.string().nullable().optional(),
  given: z.array(BddStepSchema).min(1),
  when: z.array(BddStepSchema).min(1),
  then: z.array(BddStepSchema).min(1),
  tags: z.array(z.string()).default([]),
  testType: z.enum([
    "UNIT",
    "FUNCTIONAL",
    "CONTRACT",
    "INSTRUMENTATION",
    "SMOKE",
    "SANITY",
    "REGRESSION",
    "E2E",
    "PERFORMANCE",
    "SECURITY",
    "ACCESSIBILITY",
    "EXPLORATORY",
    "COMPLIANCE",
    "OTHER",
  ]),
  confidence: z.number().min(0).max(1),
  sourceFunctionName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type ReverseEngineeredTestCase = z.infer<typeof ReverseEngineeredTestCaseSchema>;

// A single reverse-engineering pass can produce multiple test cases from one
// source file (e.g. a test file with several `it(...)` blocks).
export const ReverseEngineerResultSchema = z.object({
  detectedFramework: z.string(),
  detectedFrameworkFamily: z.string(),
  testCases: z.array(ReverseEngineeredTestCaseSchema),
});

export type ReverseEngineerResult = z.infer<typeof ReverseEngineerResultSchema>;

export function formatBddAsGherkin(tc: ReverseEngineeredTestCase): string {
  const lines: string[] = [`Feature: ${tc.title}`];
  if (tc.background) lines.push(`  Background: ${tc.background}`);
  lines.push("  Scenario:");
  for (const step of tc.given) lines.push(`    Given ${step}`);
  for (const step of tc.when) lines.push(`    When ${step}`);
  for (const step of tc.then) lines.push(`    Then ${step}`);
  return lines.join("\n");
}
