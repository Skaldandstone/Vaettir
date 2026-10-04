// SOURCE ONLY. These assertions are authored, not executed tonight.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  supportedCopyDataset,
  validateDatasetCopyClosure,
  validatedDatasetReplay,
} from "./caseFolderCopyDatasets.js";
import {
  folderCopyApprovalSchema,
  folderCopyReviewSchema,
} from "./caseFolderCopySchema.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";

const data = {
  parameterNames: ["account", "unused"],
  rows: [
    { name: "Same row name", values: { account: "", unused: "keep me" } },
    {
      name: "Same row name",
      values: { account: "premium", unused: "literal" },
    },
  ],
};
const caseFixture = (id: string, title = "Case <account>") =>
  ({
    row: { id, displayId: `synthetic-${id}` },
    state: {
      source: { verificationProfile: {} },
      preview: {
        definition: {
          title,
          background: null,
          given: ["Given <account>"],
          when: ["Act"],
          then: ["Observe"],
          validationDomain: "SOFTWARE",
          steps: [
            {
              order: 0,
              action: "Use <account>",
              expectedResult: "<unused>",
              expectedActionOrData: null,
              expectedResponse: null,
              mediaAttachmentIds: [],
            },
          ],
        },
      },
    },
  }) as unknown as Parameters<typeof validateDatasetCopyClosure>[1][number];
const source = {
  sourceCaseId: "source-a",
  sourceDatasetId: "dataset-old",
  sourceRevisionHash: "a".repeat(64),
  contentHash: qualityProfileHash(data),
  parameterCount: 2,
  rowCount: 2,
  rows: data.rows.map((r, rowIndex) => ({ rowIndex, name: r.name })),
};
describe("strict supported dataset copy and unchanged absent branches (not run)", () => {
  it("preserves concrete blanks, unused variables, duplicate names and complete ordered values without mutation", () => {
    const original = structuredClone(data);
    expect(supportedCopyDataset(data)).toEqual(original);
    expect(
      validateDatasetCopyClosure(
        [{ caseId: "a", data }],
        [caseFixture("a")],
        [],
      ).resolvedBytes,
    ).toBeGreaterThan(0);
    expect(data).toEqual(original);
  });
  it("refuses unsupported overrides/correlations/row IDs, variable mismatch, reserved/duplicate/normalized parameters and oversized values", () => {
    for (const bad of [
      { ...data, correlations: [] },
      { ...data, rows: [{ ...data.rows[0], id: "invented" }] },
      { ...data, rows: [{ ...data.rows[0], overrides: { account: "x" } }] },
      { ...data, rows: [{ name: "Missing", values: { account: "x" } }] },
      {
        ...data,
        rows: [
          {
            name: "Extra",
            values: { account: "x", unused: "y", foreign: "z" },
          },
        ],
      },
      {
        parameterNames: ["__proto__"],
        rows: [{ name: "Reserved", values: JSON.parse('{"__proto__":"x"}') }],
      },
      {
        parameterNames: ["account", "account"],
        rows: [{ name: "Duplicate", values: { account: "x" } }],
      },
      {
        parameterNames: [" account "],
        rows: [{ name: "Normalized", values: { account: "x" } }],
      },
      {
        parameterNames: ["account"],
        rows: [{ name: "Too long", values: { account: "x".repeat(10001) } }],
      },
      { ...data, rows: Array.from({ length: 51 }, () => data.rows[0]) },
    ])
      expect(() => supportedCopyDataset(bad)).toThrow();
    const params = Array.from({ length: 30 }, (_, i) => `p${i}`),
      values = Object.fromEntries(params.map((p) => [p, "x".repeat(10000)]));
    expect(() =>
      supportedCopyDataset({
        parameterNames: params,
        rows: [{ name: "Huge", values }],
      }),
    ).toThrow("256 KiB");
  });
  it("validates complete selected nondataset prerequisite closure using the actual one-pass resolver; refuses dataset pairing or unresolved variables", () => {
    const cases = [caseFixture("dependent"), caseFixture("precondition")],
      edges = [{ dependentId: "dependent", prerequisiteId: "precondition" }];
    expect(
      validateDatasetCopyClosure([{ caseId: "dependent", data }], cases, edges)
        .resolvedBytes,
    ).toBeGreaterThan(0);
    expect(() =>
      validateDatasetCopyClosure(
        [{ caseId: "precondition", data }],
        cases,
        edges,
      ),
    ).toThrow("row pairing");
    expect(() =>
      validateDatasetCopyClosure(
        [{ caseId: "dependent", data }],
        [cases[0]!],
        edges,
      ),
    ).toThrow("wholly selected");
    expect(() =>
      validateDatasetCopyClosure(
        [{ caseId: "dependent", data }],
        [caseFixture("dependent", "Missing <notDeclared>")],
        [],
      ),
    ).toThrow();
    expect(() =>
      validateDatasetCopyClosure(
        [
          {
            caseId: "dependent",
            data: {
              parameterNames: ["account", "unused"],
              rows: [
                {
                  name: "Recursive",
                  values: { account: "<unused>", unused: "x" },
                },
              ],
            },
          },
        ],
        [cases[0]!],
        [],
      ),
    ).toThrow();
  });
  it("retains exact v3/v4 input shape/hash when dataset option is absent, requires complete opt-in approval and rejects extra evidence", () => {
    const base = {
      projectId: "project",
      fromPath: "Source",
      toPath: "Copy",
      expectedHash: "a".repeat(64),
      requestId: randomUUID(),
      reason: "Reviewed",
      confirmed: true as const,
    };
    for (const legacy of [
      base,
      {
        ...base,
        copyInternalPrerequisites: true as const,
        expectedPrerequisiteHash: "b".repeat(64),
        expectedInternalPrerequisites: [],
      },
    ]) {
      const parsed = folderCopyApprovalSchema.parse(legacy);
      expect(parsed).toEqual(legacy);
      expect(qualityProfileHash(parsed)).toBe(qualityProfileHash(legacy));
      expect(parsed).not.toHaveProperty("copyParameterDatasets");
    }
    expect(
      folderCopyReviewSchema.parse({
        projectId: "project",
        fromPath: "Source",
        toPath: "Copy",
      }),
    ).not.toHaveProperty("copyParameterDatasets");
    const opted = {
      ...base,
      copyParameterDatasets: true,
      expectedDatasetHash: "c".repeat(64),
      expectedDatasets: [source],
    };
    expect(folderCopyApprovalSchema.safeParse(opted).success).toBe(true);
    for (const bad of [
      { ...base, copyParameterDatasets: false },
      { ...base, copyParameterDatasets: true },
      { ...base, expectedDatasets: [] },
      { ...opted, expectedDatasetHash: undefined },
      { ...opted, expectedDatasets: [{ ...source, rows: [] }] },
      { ...opted, expectedDatasets: [source, source] },
    ])
      expect(folderCopyApprovalSchema.safeParse(bad).success).toBe(false);
  });
  it("retains only fresh complete historical mappings and refuses duplicate/source-pointing identities, reordered rows or content hashes", () => {
    const copies = [
        { sourceId: "source-a", caseId: "copy-a", displayId: "synthetic-02" },
      ],
      saved = [{ ...source, ...copies[0], datasetId: "dataset-new" }].map(
        ({ sourceId: _id, ...d }) => d,
      );
    const hash = qualityProfileHash({
      projectId: "project",
      datasets: [source],
    });
    expect(
      validatedDatasetReplay("project", [source], saved, copies, hash),
    ).toEqual(saved);
    for (const wrong of [
      [{ ...saved[0]!, datasetId: "dataset-old" }],
      [{ ...saved[0]!, caseId: "source-a" }],
      [
        {
          ...saved[0]!,
          rows: [
            { rowIndex: 1, name: "Same row name" },
            { rowIndex: 0, name: "Same row name" },
          ],
        },
      ],
      [{ ...saved[0]!, contentHash: "b".repeat(64) }],
      [saved[0]!, saved[0]!],
    ])
      expect(() =>
        validatedDatasetReplay("project", [source], wrong, copies, hash),
      ).toThrow("Nothing was recreated");
    expect(() =>
      validatedDatasetReplay(
        "project",
        [source],
        saved,
        [copies[0]!, copies[0]!],
        hash,
      ),
    ).toThrow();
    expect(() =>
      validatedDatasetReplay("foreign", [source], saved, copies, hash),
    ).toThrow();
  });
  it("refuses a complete selected dataset prerequisite expansion over 500 instances, not a truncated prefix", () => {
    const cases = Array.from({ length: 11 }, (_, i) => caseFixture(String(i))),
      edges = cases
        .slice(1)
        .map((c) => ({ dependentId: "0", prerequisiteId: c.row.id }));
    const rows = Array.from({ length: 50 }, (_, i) => ({
      name: `Row ${i}`,
      values: { account: "x", unused: "y" },
    }));
    expect(() =>
      validateDatasetCopyClosure(
        [{ caseId: "0", data: { parameterNames: data.parameterNames, rows } }],
        cases,
        edges,
      ),
    ).toThrow("500-instance");
  });
  it("refuses full resolved procedure expansion above 4 MiB while preserving the source definition", () => {
    const c = caseFixture("a");
    c.state.preview.definition.given = Array.from({ length: 50 }, () =>
      "x".repeat(10000),
    );
    const original = structuredClone(c.state.preview.definition);
    const rows = Array.from({ length: 10 }, (_, i) => ({
      name: `Row ${i}`,
      values: { account: "x", unused: "y" },
    }));
    expect(() =>
      validateDatasetCopyClosure(
        [{ caseId: "a", data: { parameterNames: data.parameterNames, rows } }],
        [c],
        [],
      ),
    ).toThrow("4 MiB");
    expect(c.state.preview.definition).toEqual(original);
  });
});
