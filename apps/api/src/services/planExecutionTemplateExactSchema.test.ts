import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  qualityProfileHash,
  runConfigurationSchema,
  testPlanExecutionTemplateSchema,
} from "./qualityExperienceProfile.js";
import {
  PLAN_EXECUTION_CONTEXT_EXACT_FIELDS,
  PLAN_EXECUTION_TEMPLATE_EXACT_BOUNDS,
  inspectExactPlanExecutionJson,
  planExecutionContextExactSchema,
  planExecutionTemplateExactSchema,
  type PlanExecutionContextExact,
} from "./planExecutionTemplateExactSchema.js";
const uuid = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
function context(): PlanExecutionContextExact {
  return {
    configuration: "  First line\nsecond line  ",
    platform: "",
    build: "0",
    hardwareRevision: " rev A ",
    firmwareVersion: " \tfirmware\r\n",
    rig: "Bench | 🧪 ",
    batchOrLot: "lot",
    environment: "\n lab\n",
    calibrationReference: "cal",
    protocolReference: "proto",
  };
}
function template() {
  return {
    version: 2 as const,
    testCaseIds: ["case-z", "case-a"],
    configurations: [
      { id: uuid(2), name: "  authored name\nretained  ", context: context() },
      { id: uuid(1), name: "second", context: context() },
    ],
  };
}
it("literal context/template returns the exact original objects, field-key order and values without trimming or defaults", () => {
  const input = template(),
    raw = JSON.stringify(input),
    keys = Object.keys(input.configurations[0]!.context);
  const parsed = planExecutionTemplateExactSchema.parse(input);
  expect(parsed).toBe(input);
  expect(JSON.stringify(parsed)).toBe(raw);
  expect(Object.keys(parsed.configurations[0]!.context)).toEqual(keys);
  expect(parsed.testCaseIds).toEqual(["case-z", "case-a"]);
  expect(parsed.configurations.map((value) => value.id)).toEqual([
    uuid(2),
    uuid(1),
  ]);
  expect(parsed.configurations[0]!.name).toBe("  authored name\nretained  ");
});
it.each([
  "",
  "0",
  "  ",
  "\t\r\n",
  "First\nsecond",
  " leading",
  "trailing ",
  "emoji 🎮 / Ω / 字",
  'quotes " \\ retained',
])("every context field preserves exact text %j", (value) => {
  const input = Object.fromEntries(
    PLAN_EXECUTION_CONTEXT_EXACT_FIELDS.map((key) => [key, value]),
  );
  expect(planExecutionContextExactSchema.parse(input)).toBe(input);
  expect(JSON.stringify(planExecutionContextExactSchema.parse(input))).toBe(
    JSON.stringify(input),
  );
});
it.each(PLAN_EXECUTION_CONTEXT_EXACT_FIELDS)(
  "missing context %s is rejected and never filled",
  (field) => {
    const input: Record<string, unknown> = { ...context() };
    delete input[field];
    expect(planExecutionContextExactSchema.safeParse(input).success).toBe(
      false,
    );
    expect(Object.hasOwn(input, field)).toBe(false);
  },
);
it.each([null, undefined, false, 0, NaN, Infinity, {}, []])(
  "non-string context values %j are never coerced or treated as empty text",
  (value) => {
    expect(
      planExecutionContextExactSchema.safeParse({ ...context(), build: value })
        .success,
    ).toBe(false);
  },
);
it.each(["", " ", "\n\t\r", "x".repeat(121)])(
  "blank/oversized raw name %j is rejected without altering the caller's text",
  (name) => {
    const input = template();
    input.configurations[0]!.name = name;
    expect(planExecutionTemplateExactSchema.safeParse(input).success).toBe(
      false,
    );
    expect(input.configurations[0]!.name).toBe(name);
  },
);
it("unknown keys at each level and absent root/configuration fields refuse, rather than stripping or inventing values", () => {
  for (const input of [
    { ...template(), extra: true },
    {
      ...template(),
      configurations: [{ ...template().configurations[0]!, extra: true }],
    },
    {
      ...template(),
      configurations: [
        {
          ...template().configurations[0]!,
          context: { ...context(), extra: true },
        },
      ],
    },
    { version: 2, configurations: [] },
    { version: 2, testCaseIds: [] },
    { ...template(), configurations: [{ id: uuid(1), context: context() }] },
  ])
    expect(planExecutionTemplateExactSchema.safeParse(input).success).toBe(
      false,
    );
});
it("500 cases and20 configurations are supported,501/21 and duplicate identities refuse atomically without sorting", () => {
  const input = {
      version: 2,
      testCaseIds: Array.from(
        { length: 500 },
        (_, index) => `case-${500 - index}`,
      ),
      configurations: Array.from({ length: 20 }, (_, index) => ({
        id: uuid(index + 1),
        name: `raw ${index}`,
        context: context(),
      })),
    },
    raw = JSON.stringify(input);
  expect(planExecutionTemplateExactSchema.parse(input)).toBe(input);
  expect(JSON.stringify(input)).toBe(raw);
  expect(
    planExecutionTemplateExactSchema.safeParse({
      ...input,
      testCaseIds: [...input.testCaseIds, "overflow"],
    }).success,
  ).toBe(false);
  expect(
    planExecutionTemplateExactSchema.safeParse({
      ...input,
      configurations: [
        ...input.configurations,
        { id: uuid(21), name: "overflow", context: context() },
      ],
    }).success,
  ).toBe(false);
  expect(
    planExecutionTemplateExactSchema.safeParse({
      ...input,
      testCaseIds: ["case-a", "case-a"],
    }).success,
  ).toBe(false);
  expect(
    planExecutionTemplateExactSchema.safeParse({
      ...input,
      configurations: [input.configurations[0], input.configurations[0]],
    }).success,
  ).toBe(false);
});
it("literal field bounds apply to raw text, not its smaller trimmed interpretation", () => {
  expect(
    planExecutionContextExactSchema.safeParse({
      ...context(),
      configuration: "x".repeat(2000),
      environment: "x".repeat(2000),
      platform: "x".repeat(300),
    }).success,
  ).toBe(true);
  expect(
    planExecutionContextExactSchema.safeParse({
      ...context(),
      configuration: " " + "x".repeat(2000),
    }).success,
  ).toBe(false);
  expect(
    planExecutionContextExactSchema.safeParse({
      ...context(),
      build: "x".repeat(300) + " ",
    }).success,
  ).toBe(false);
  expect(
    runConfigurationSchema.parse({ build: "x".repeat(300) + " " }).build,
  ).toBe("x".repeat(300));
});
it.each(["a\0b", "a\ud800b", "a\udfffb"])(
  "unsafe literal JSON/native text %j is refused without escaping or replacement",
  (value) => {
    expect(
      planExecutionContextExactSchema.safeParse({
        ...context(),
        configuration: value,
      }).success,
    ).toBe(false);
    expect(() => inspectExactPlanExecutionJson(value)).toThrow("unsupported");
  },
);
it("getters/undefined/non-enumerable/symbol/cycle/class/sparse array are refused before value materialization", () => {
  let reads = 0;
  const getter = Object.defineProperty({ ...context() }, "build", {
    enumerable: true,
    get() {
      reads++;
      throw Error("PRIVATE");
    },
  });
  expect(planExecutionContextExactSchema.safeParse(getter).success).toBe(false);
  expect(reads).toBe(0);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const value of [
    undefined,
    Symbol("unknown"),
    new Date(),
    cycle,
    Array(1),
    { extra: undefined },
    Object.defineProperty({}, "hidden", { value: 1 }),
    { [Symbol("unknown")]: 1 },
  ])
    expect(() => inspectExactPlanExecutionJson(value)).toThrow("unsupported");
});
it("descriptor byte count is complete JSON UTF8 length and preserves null/false/0 representation without claiming template validity", () => {
  const value = { literal: "Ω🎮\n", null: null, false: false, zero: 0 };
  expect(inspectExactPlanExecutionJson(value).bytes).toBe(
    new TextEncoder().encode(JSON.stringify(value)).length,
  );
  expect(planExecutionTemplateExactSchema.safeParse(value).success).toBe(false);
  expect(() =>
    inspectExactPlanExecutionJson(
      "x".repeat(PLAN_EXECUTION_TEMPLATE_EXACT_BOUNDS.templateBytes),
    ),
  ).toThrow("unsupported");
});
it("untouched v1 parser still trims/defaults its original input, with the same canonical parsed hash; v2 is not adopted", () => {
  const legacy = {
    version: 1,
    testCaseIds: ["case-z", "case-a"],
    configurations: [
      {
        id: uuid(2),
        name: "  legacy name  ",
        context: { build: " 0 ", configuration: " line one\nline two " },
      },
    ],
  };
  const expected = {
    version: 1,
    testCaseIds: ["case-z", "case-a"],
    configurations: [
      {
        id: uuid(2),
        name: "legacy name",
        context: {
          configuration: "line one\nline two",
          platform: "",
          build: "0",
          hardwareRevision: "",
          firmwareVersion: "",
          rig: "",
          batchOrLot: "",
          environment: "",
          calibrationReference: "",
          protocolReference: "",
        },
      },
    ],
  };
  expect(testPlanExecutionTemplateSchema.parse(legacy)).toEqual(expected);
  expect(
    qualityProfileHash(testPlanExecutionTemplateSchema.parse(legacy)),
  ).toBe(qualityProfileHash(expected));
  expect(planExecutionTemplateExactSchema.safeParse(legacy).success).toBe(
    false,
  );
  expect(testPlanExecutionTemplateSchema.safeParse(template()).success).toBe(
    false,
  );
});
it("runtime codec imports only browser-pure zod and never calls v1/default/coerce/transform logic", () => {
  const source = readFileSync(
    new URL("./planExecutionTemplateExactSchema.ts", import.meta.url),
    "utf8",
  );
  expect(source.match(/^import .* from /gm)).toEqual(["import { z } from "]);
  expect(source).not.toMatch(
    /\.default\(|\.transform\(|\.preprocess\(|\.coerce|node:|@vaettir\/db|readPlanExecutionTemplate|runConfigurationSchema/,
  );
});
it.each(["bad\0key", "bad\ud800key", "bad\udfffkey"])(
  "unsafe root/nested JSON key %j refuses before visiting its value",
  (key) => {
    for (const input of [{ [key]: 0 }, { nested: { [key]: 0 } }])
      expect(() => inspectExactPlanExecutionJson(input)).toThrow("unsupported");
    let reads = 0;
    const input = Object.defineProperty({}, key, {
      enumerable: true,
      get() {
        reads++;
        return "PRIVATE";
      },
    });
    expect(() => inspectExactPlanExecutionJson(input)).toThrow("unsupported");
    expect(reads).toBe(0);
  },
);
it("exact1MiB JSON bytes accept and one additional byte refuses without clipping", () => {
  const input = "x".repeat(
    PLAN_EXECUTION_TEMPLATE_EXACT_BOUNDS.templateBytes - 2,
  );
  expect(inspectExactPlanExecutionJson(input).bytes).toBe(
    PLAN_EXECUTION_TEMPLATE_EXACT_BOUNDS.templateBytes,
  );
  expect(() => inspectExactPlanExecutionJson(input + "x")).toThrow(
    "unsupported",
  );
});
it("depth64 and100000nodes accept; depth65/100001nodes refuse complete representations", () => {
  let depth: unknown = null;
  for (let index = 0; index < 64; index++) depth = [depth];
  expect(inspectExactPlanExecutionJson(depth).nodes).toBe(65);
  expect(() => inspectExactPlanExecutionJson([depth])).toThrow("unsupported");
  const nodes = [
    ...Array.from({ length: 199 }, () => Array(500).fill(0)),
    Array(299).fill(0),
  ];
  expect(inspectExactPlanExecutionJson(nodes).nodes).toBe(100000);
  nodes[nodes.length - 1]!.push(0);
  expect(() => inspectExactPlanExecutionJson(nodes)).toThrow("unsupported");
});
it.each([-0, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
  "unsupported numeric representation %j is not silently encoded",
  (value) => {
    expect(() => inspectExactPlanExecutionJson({ value })).toThrow(
      "unsupported",
    );
  },
);
