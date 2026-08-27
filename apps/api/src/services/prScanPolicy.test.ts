import { describe, it, expect } from "vitest";
import { severityForPath, parsePathSeverityRules, type PathSeverityRule } from "./prScanPolicy.js";

describe("severityForPath", () => {
  it("falls back to the flat default HIGH with no rules", () => {
    expect(severityForPath("src/anything.ts", [])).toBe("HIGH");
  });

  it("matches the first rule in array order (narrow-before-broad ordering)", () => {
    const rules: PathSeverityRule[] = [
      { pattern: "src/payments/**", severity: "CRITICAL" },
      { pattern: "src/**", severity: "MEDIUM" },
    ];
    expect(severityForPath("src/payments/checkout.ts", rules)).toBe("CRITICAL");
    expect(severityForPath("src/other/file.ts", rules)).toBe("MEDIUM");
  });

  it("falls back to HIGH when nothing matches", () => {
    const rules: PathSeverityRule[] = [{ pattern: "src/payments/**", severity: "CRITICAL" }];
    expect(severityForPath("docs/readme.md", rules)).toBe("HIGH");
  });
});

describe("parsePathSeverityRules", () => {
  it("parses a valid array of rules", () => {
    const raw = [
      { pattern: "src/auth/**", severity: "CRITICAL" },
      { pattern: "src/**", severity: "LOW" },
    ];
    expect(parsePathSeverityRules(raw)).toEqual(raw);
  });

  it("returns an empty array for non-array input", () => {
    expect(parsePathSeverityRules(null)).toEqual([]);
    expect(parsePathSeverityRules({})).toEqual([]);
    expect(parsePathSeverityRules("not an array")).toEqual([]);
  });

  it("drops malformed entries rather than throwing", () => {
    const raw = [
      { pattern: "src/**", severity: "HIGH" },
      { pattern: "src/**" }, // missing severity
      { severity: "LOW" }, // missing pattern
      { pattern: "src/**", severity: "NOT_A_REAL_SEVERITY" },
      "garbage",
      null,
    ];
    expect(parsePathSeverityRules(raw)).toEqual([{ pattern: "src/**", severity: "HIGH" }]);
  });
});
