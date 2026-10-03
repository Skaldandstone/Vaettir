import { describe, expect, it } from "vitest";
import {
  executionDatasetSchema,
  resolveDatasetText,
  resolveDatasetProcedure,
} from "./datasetExecution.js";
import {
  boundedRunSnapshot,
  qualityProfileHash,
  readRunExperienceSnapshot,
  runCaseDefinitionSchema,
  runConfigurationSchema,
} from "./qualityExperienceProfile.js";

const procedure = runCaseDefinitionSchema.parse({
  testCaseId: "case",
  title: "Synthetic <variant>",
  validationDomain: "SOFTWARE",
  reviewStatus: "APPROVED",
  background: "Ready <user>",
  given: ["Signed in <user>"],
  when: ["Select <variant>"],
  then: ["See <result>"],
  verificationProfile: {
    setup: "Setup <variant>",
    safety: "Limit <result>",
    instruments: "Rig <variant>",
    acceptanceCriteria: "Exact <result>",
  },
  steps: [
    {
      order: 0,
      action: "Choose <variant>",
      expectedActionOrData: "<user>",
      expectedResult: "<result>",
      expectedResponse: null,
      mediaAttachmentIds: ["synthetic-media"],
    },
  ],
});
describe("strict dataset execution resolution", () => {
  it("resolves every procedure field once without rewriting the source or media identities", () => {
    const copy = structuredClone(procedure);
    const expanded = resolveDatasetProcedure(procedure, {
      variant: "Mobile",
      user: "Synthetic user",
      result: "Ready",
    });
    expect(procedure).toEqual(copy);
    expect(expanded.title).toBe("Synthetic Mobile");
    expect(expanded.background).toBe("Ready Synthetic user");
    expect(expanded.given).toEqual(["Signed in Synthetic user"]);
    expect(expanded.when).toEqual(["Select Mobile"]);
    expect(expanded.then).toEqual(["See Ready"]);
    expect(expanded.verificationProfile).toEqual({
      setup: "Setup Mobile",
      safety: "Limit Ready",
      instruments: "Rig Mobile",
      acceptanceCriteria: "Exact Ready",
    });
    expect(expanded.steps[0]).toEqual({
      order: 0,
      action: "Choose Mobile",
      expectedActionOrData: "Synthetic user",
      expectedResult: "Ready",
      expectedResponse: null,
      mediaAttachmentIds: ["synthetic-media"],
    });
  });
  it("rejects missing, inherited and recursively unresolved values rather than executing a template", () => {
    expect(() => resolveDatasetText("<missing>", {}, "Given")).toThrow(
      "Missing dataset parameter",
    );
    expect(() => resolveDatasetText("<toString>", {}, "Step")).toThrow(
      "Missing dataset parameter",
    );
    expect(() =>
      resolveDatasetText(
        "<value>",
        Object.create({ value: "inherited" }) as Record<string, string>,
        "Step",
      ),
    ).toThrow("Missing dataset parameter");
    expect(() =>
      resolveDatasetText(
        "<value>",
        { value: "<other>", other: "hidden" },
        "Step",
      ),
    ).toThrow("Unresolved placeholder");
    expect(resolveDatasetText("<value>", { value: "" }, "Boundary")).toBe("");
    expect(
      resolveDatasetText("Literal $& and <value>", { value: "$&" }, "Text"),
    ).toBe("Literal $& and $&");
  });
  it("fails visibly if substitution makes a field oversized", () => {
    const source = {
      ...procedure,
      steps: [{ ...procedure.steps[0]!, action: "<value>".repeat(1000) }],
    };
    expect(() =>
      resolveDatasetProcedure(source, {
        variant: "Synthetic",
        user: "Synthetic",
        result: "Synthetic",
        value: "x".repeat(11),
      }),
    ).toThrow("Resolved procedure is invalid or exceeds a per-field limit");
  });
  it("rejects incomplete/extra rows, ambiguous keys, oversized rows and excess expansion without truncation", () => {
    const valid = {
      parameterNames: ["value"],
      rows: [{ name: "Empty boundary", values: { value: "" } }],
    };
    expect(executionDatasetSchema.parse(valid)).toEqual(valid);
    for (const input of [
      { ...valid, parameterNames: ["value", "value"] },
      { ...valid, parameterNames: [" value"] },
      { ...valid, parameterNames: ["__proto__"] },
      { ...valid, rows: [{ name: "missing", values: {} }] },
      { ...valid, rows: [{ name: "extra", values: { value: "", other: "" } }] },
      { ...valid, rows: Array.from({ length: 51 }, () => valid.rows[0]) },
      {
        ...valid,
        rows: [{ name: "oversized", values: { value: "x".repeat(10001) } }],
      },
    ])
      expect(executionDatasetSchema.safeParse(input).success).toBe(false);
  });
  it("accepts unchanged legacy snapshots and preserves optional independently scoped row metadata", () => {
    const baseline = {
      version: 1,
      experience: null,
      profileHash: qualityProfileHash({}),
      configuration: runConfigurationSchema.parse({}),
      stepFieldLabels: {},
      caseDefinitions: [procedure],
    };
    const legacy = boundedRunSnapshot(baseline);
    expect(readRunExperienceSnapshot(legacy)).toEqual(legacy);
    expect(legacy.datasetExecution).toBeUndefined();
    const metadata = {
      version: 1,
      batchId: `dataset_${"a".repeat(64)}`,
      expansionHash: "b".repeat(64),
      datasetId: "dataset",
      datasetHash: "c".repeat(64),
      testCaseId: "case",
      sourceDisplayId: "synthetic-01",
      rowIndex: 0,
      rowName: "Mobile",
      values: { variant: "Mobile" },
      configurationHash: "d".repeat(64),
      rowCount: 1,
    };
    expect(
      boundedRunSnapshot({ ...baseline, datasetExecution: metadata })
        .datasetExecution,
    ).toEqual(metadata);
    expect(() =>
      boundedRunSnapshot({
        ...baseline,
        datasetExecution: { ...metadata, rowIndex: 50 },
      }),
    ).toThrow("bounded run snapshot");
  });
});
