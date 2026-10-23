// SOURCE ONLY: authored, NOT RUN tonight.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cloneInputSchema, cloneScopeSchema } from "./caseClone.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
const base = {
  projectId: "project",
  caseId: "original",
  expectedSourceRevision: "a".repeat(64),
  title: "Independent duplicate",
  suitePath: null,
  reason: "Reviewed",
  confirmed: true as const,
  requestId: randomUUID(),
};
const source = {
  sourceCaseId: "original",
  sourceDatasetId: "dataset-original",
  sourceRevisionHash: "b".repeat(64),
  contentHash: "c".repeat(64),
  parameterCount: 1,
  rowCount: 2,
  rows: [
    { rowIndex: 0, name: "Same label" },
    { rowIndex: 1, name: "Same label" },
  ],
};
const opted = {
  ...base,
  copyParameterDataset: true as const,
  expectedScope: { organizationId: "org", clerkActorId: "clerk-actor" },
  expectedDatasetHash: "d".repeat(64),
  expectedDataset: source,
};
describe("independent dataset opt-in schema (NOT RUN)", () => {
  it("preserves exact omitted legacy input/preview shape/hash without defaults", () => {
    expect(cloneInputSchema.parse(base)).toEqual(base);
    expect(qualityProfileHash(cloneInputSchema.parse(base))).toBe(
      qualityProfileHash(base),
    );
    expect(
      cloneScopeSchema.parse({
        projectId: base.projectId,
        caseId: base.caseId,
      }),
    ).toEqual({ projectId: base.projectId, caseId: base.caseId });
    expect(cloneInputSchema.parse(base)).not.toHaveProperty(
      "copyParameterDataset",
    );
    expect(cloneInputSchema.parse(base)).not.toHaveProperty("expectedScope");
  });
  it("requires complete original scope/hash/every ordered row before opted writes", () => {
    expect(cloneInputSchema.parse(opted)).toEqual(opted);
    for (const bad of [
      { ...opted, expectedScope: undefined },
      { ...opted, expectedDatasetHash: undefined },
      { ...opted, expectedDataset: undefined },
      {
        ...opted,
        expectedDataset: { ...source, rows: source.rows.slice(0, 1) },
      },
      {
        ...opted,
        expectedDataset: { ...source, rows: [...source.rows].reverse() },
      },
    ])
      expect(cloneInputSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects false/default flags, unapproved dataset evidence and unsupported extra fields", () => {
    for (const bad of [
      { ...base, copyParameterDataset: false },
      { ...base, expectedDataset: source },
      { ...base, expectedDatasetHash: "a".repeat(64) },
      { ...opted, importOriginalRunHistory: true },
      {
        ...opted,
        expectedDataset: {
          ...source,
          rows: [{ ...source.rows[0], rowId: "invented" }, source.rows[1]],
        },
      },
    ])
      expect(cloneInputSchema.safeParse(bad).success).toBe(false);
  });
  it("bounds original identity, scope and row evidence; duplicate labels retain distinct row indexes", () => {
    expect(cloneInputSchema.safeParse(opted).success).toBe(true);
    for (const bad of [
      { ...opted, expectedScope: { organizationId: "org", clerkActorId: "" } },
      { ...opted, expectedDataset: { ...source, parameterCount: 51 } },
      { ...opted, expectedDataset: { ...source, rowCount: 51 } },
      {
        ...opted,
        expectedDataset: { ...source, sourceDatasetId: "x".repeat(201) },
      },
    ])
      expect(cloneInputSchema.safeParse(bad).success).toBe(false);
  });
});
