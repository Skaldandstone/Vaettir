import { describe, it, expect } from "vitest";
import { minimatch } from "minimatch";
import { severityForPath, parsePathSeverityRules, validatePathSeverityPattern, type PathSeverityRule } from "./prScanPolicy.js";
import { compilePathGlob, matchCompiledPathGlob, PATH_GLOB_LIMITS } from "./boundedPathGlob.js";

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

  it.each([
    ["src/file.ts", "src/*.ts", true],
    ["src/nested/file.ts", "src/*.ts", false],
    ["file.ts", "**/*.ts", true],
    ["src/nested/file.ts", "**/*.ts", true],
    ["src", "src/**", false],
    ["src/", "src/**", true],
    ["src/file1.ts", "src/file?.ts", true],
    ["src/file12.ts", "src/file?.ts", false],
    ["src/file3.ts", "src/file[1-4].ts", true],
    ["src/file9.ts", "src/file[!1-4].ts", true],
    ["src/file3.ts", "src/file[!1-4].ts", false],
    ["src/auth.ts", "src/{auth,payments}.ts", true],
    ["src/payments.ts", "src/{auth,{payments,billing}}.ts", true],
    ["src/file02.ts", "src/file{01..03}.ts", true],
    ["src/fileb.ts", "src/file{a..c}.ts", true],
    ["src/file1.ts", "src/file{3..1}.ts", true],
    ["src/{name}.ts", "src/{name}.ts", true],
    ["src/{name}/auth.ts", "src/{name}/{auth,payments}.ts", true],
    ["src/.hidden.ts", "src/*.ts", false],
    ["src/.hidden.ts", "src/.*.ts", true],
    ["src/.hidden/file.ts", "src/**", false],
    ["src/file.ts", "!docs/**", true],
    ["src/file.ts", "#src/**", false],
  ])("matches ordinary path %s against bounded glob %s (%s)", (path, pattern, matches) => {
    // A small normal-use compatibility matrix only, never complex payloads.
    expect(minimatch(path, pattern)).toBe(matches);
    expect(severityForPath(path, [{ pattern, severity: "LOW" }])).toBe(matches ? "LOW" : "HIGH");
  });

  it("rejects unsupported or over-limit patterns without applying a later LOW catch-all", () => {
    for (const pattern of ["src/@(auth|payments).ts", "src/{1..33}.ts", "src/{{{{{a,b},c},d},e},f}.ts", "x".repeat(PATH_GLOB_LIMITS.patternLength + 1)]) {
      expect(validatePathSeverityPattern(pattern)).toBe(false);
      expect(severityForPath("src/file.ts", [{ pattern, severity: "LOW" }, { pattern: "**", severity: "LOW" }])).toBe("HIGH");
    }
  });

  it("accepts the configured literal boundary and refuses excess path/rule work", () => {
    const pattern = "x".repeat(PATH_GLOB_LIMITS.patternLength);
    expect(validatePathSeverityPattern(pattern)).toBe(true);
    expect(severityForPath(pattern, [{ pattern, severity: "LOW" }])).toBe("LOW");
    expect(severityForPath("x".repeat(PATH_GLOB_LIMITS.pathLength + 1), [{ pattern: "**", severity: "LOW" }])).toBe("HIGH");
    expect(severityForPath("file.ts", Array.from({ length: PATH_GLOB_LIMITS.rules + 1 }, () => ({ pattern: "**", severity: "LOW" as const })))).toBe("CRITICAL");
  });

  it("returns an explicit bounded failure when the shared operation budget is exhausted", () => {
    const glob = compilePathGlob("src/*.ts")!;
    expect(matchCompiledPathGlob("src/file.ts", glob, { remaining: 1 })).toBeUndefined();
  });

  it("never downgrades an explicit CRITICAL rule on invalid pattern or path evaluation", () => {
    const rules: PathSeverityRule[] = [{ pattern: "src/@(auth|payments)", severity: "CRITICAL" }, { pattern: "**", severity: "LOW" }];
    expect(severityForPath("src/file.ts", rules)).toBe("CRITICAL");
    expect(severityForPath("../outside.ts", [{ pattern: "**", severity: "CRITICAL" }])).toBe("CRITICAL");
    expect(severityForPath("src/file.ts", parsePathSeverityRules(rules))).toBe("CRITICAL");
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

  it("preserves unsupported stored patterns and bounds excess rules without losing conservative risk", () => {
    const raw = [{ pattern: "src/@(auth|payments)", severity: "CRITICAL" }, { pattern: "**", severity: "LOW" }];
    expect(parsePathSeverityRules(raw)).toEqual(raw);
    const excess = Array.from({ length: PATH_GLOB_LIMITS.rules + 1 }, () => ({ pattern: "**", severity: "LOW" }));
    const parsed = parsePathSeverityRules(excess);
    expect(parsed).toHaveLength(PATH_GLOB_LIMITS.rules);
    expect(severityForPath("file.ts", parsed)).toBe("CRITICAL");
    expect(excess).toHaveLength(PATH_GLOB_LIMITS.rules + 1);
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
