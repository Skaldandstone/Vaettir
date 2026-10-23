import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  executionTemplateHash,
  readPlanExecutionTemplate,
  reviewPlanExecution,
  testPlanExecutionTemplateSchema,
} from "./testPlanExecution.js";

describe("bounded reusable plan configurations", () => {
  const preset = { id: randomUUID(), name: "Synthetic rig", context: {} };
  it("distinguishes legacy unconfigured data from unsupported versions", () => {
    expect(readPlanExecutionTemplate({})).toBeNull();
    for (const value of [
      null,
      [],
      { version: 999 },
      { version: 1, future: true },
    ])
      expect(() => readPlanExecutionTemplate(value)).toThrow("unsupported");
  });
  it("bounds scope/configuration identities without deduplicating or truncating", () => {
    for (const value of [
      { version: 1, testCaseIds: ["a", "a"], configurations: [] },
      { version: 1, testCaseIds: [], configurations: [preset, preset] },
      {
        version: 1,
        testCaseIds: Array.from({ length: 501 }, (_, i) => String(i)),
        configurations: [],
      },
      {
        version: 1,
        testCaseIds: [],
        configurations: Array.from({ length: 21 }, () => ({
          ...preset,
          id: randomUUID(),
        })),
      },
      {
        version: 1,
        testCaseIds: [],
        configurations: [{ ...preset, context: { safeTemperature: 75 } }],
      },
    ])
      expect(testPlanExecutionTemplateSchema.safeParse(value).success).toBe(
        false,
      );
  });
  it("requires the exact reviewed order, template identity and configuration", () => {
    const template = testPlanExecutionTemplateSchema.parse({
      version: 1,
      testCaseIds: ["a", "b"],
      configurations: [preset],
    });
    const plan = {
      id: "plan",
      projectId: "project",
      name: "Synthetic plan",
      executionTemplate: template,
    };
    const reference = {
      testPlanId: "plan",
      configurationId: preset.id,
      expectedTemplateHash: executionTemplateHash(template),
    };
    expect(
      reviewPlanExecution(
        plan,
        "project",
        reference,
        ["a", "b"],
        template.configurations[0]!.context,
      ).template,
    ).toEqual(template);
    expect(() =>
      reviewPlanExecution(
        plan,
        "other",
        reference,
        ["a", "b"],
        template.configurations[0]!.context,
      ),
    ).toThrow("selected project");
    expect(() =>
      reviewPlanExecution(
        plan,
        "project",
        reference,
        ["b", "a"],
        template.configurations[0]!.context,
      ),
    ).toThrow("scope or context");
    expect(() =>
      reviewPlanExecution(
        plan,
        "project",
        { ...reference, expectedTemplateHash: "0".repeat(64) },
        ["a", "b"],
        template.configurations[0]!.context,
      ),
    ).toThrow("changed");
    expect(() =>
      reviewPlanExecution(plan, "project", reference, ["a", "b"], {
        ...template.configurations[0]!.context,
        rig: "Different",
      }),
    ).toThrow("scope or context");
  });
});
