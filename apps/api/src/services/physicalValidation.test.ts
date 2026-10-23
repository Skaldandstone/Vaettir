import { describe, expect, it } from "vitest";
import {
  manualRunStatus,
  measurementSchema,
  measurementVerdict,
  observationsSchema,
} from "./physicalValidation.js";

describe("physical measurement evidence", () => {
  it("accepts legacy empty observations", () =>
    expect(observationsSchema.parse({}).measurements).toEqual([]));
  it("treats readings without limits as unassessed", () =>
    expect(
      measurementVerdict(
        measurementSchema.parse({ name: "Supply", unit: "V", value: 5 }),
      ),
    ).toBe("NO_LIMITS"));
  it("accepts inclusive bounds and rejects excursions", () => {
    const reading = measurementSchema.parse({
      name: "Supply",
      unit: "V",
      value: 5,
      lowerLimit: 4.8,
      upperLimit: 5,
    });
    expect(measurementVerdict(reading)).toBe("IN_RANGE");
    expect(measurementVerdict({ ...reading, value: 5.01 })).toBe(
      "OUT_OF_RANGE",
    );
    expect(measurementVerdict({ ...reading, value: 4.79 })).toBe(
      "OUT_OF_RANGE",
    );
  });
  it("rejects invalid numbers, missing units and reversed limits", () => {
    for (const input of [
      { value: Infinity, unit: "V" },
      { value: NaN, unit: "V" },
      { value: 5, unit: "" },
      { value: 5, unit: "V", lowerLimit: 6, upperLimit: 4 },
    ]) {
      expect(
        measurementSchema.safeParse({ name: "Supply", ...input }).success,
      ).toBe(false);
    }
  });
});
describe("manual run completion", () => {
  it("never passes an empty or incomplete run", () => {
    expect(manualRunStatus(0, [])).toBe("PARTIAL");
    expect(manualRunStatus(2, [])).toBe("PARTIAL");
    expect(manualRunStatus(2, ["PASS"])).toBe("PARTIAL");
  });
  it("requires every planned case to pass", () => {
    expect(manualRunStatus(2, ["PASS", "PASS"])).toBe("PASSED");
    expect(manualRunStatus(2, ["PASS", "SKIP"])).toBe("PARTIAL");
    expect(manualRunStatus(2, ["FAIL"])).toBe("FAILED");
    expect(manualRunStatus(2, ["BLOCKED"])).toBe("FAILED");
  });
});
