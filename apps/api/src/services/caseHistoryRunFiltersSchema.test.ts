// SOURCE ONLY: authored NOT RUN. Parent owns full-scope/service/UI integration.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  caseHistoryRecordedSourceSchema,
  caseHistoryRunStatusSchema,
  caseHistoryRunFiltersShape,
  caseHistoryRunFiltersSchema,
  caseHistoryRunFiltersKeyFields,
} from "./caseHistoryRunFiltersSchema.js";

describe("recorded source and overall run-status filters (NOT RUN)", () => {
  it("keeps legacy absence and empty optional fragment without default values", () => {
    expect(caseHistoryRunFiltersSchema.parse({})).toEqual({});
    expect(caseHistoryRunFiltersKeyFields({})).toEqual({});
    expect(
      caseHistoryRunFiltersKeyFields({
        recordedSource: undefined,
        runStatus: undefined,
      }),
    ).toEqual({});
    const parent = z
      .object({ filters: caseHistoryRunFiltersSchema.optional() })
      .strict();
    expect(parent.parse({})).toEqual({});
    expect(parent.parse({ filters: {} })).toEqual({ filters: {} });
  });

  it("accepts only existing source and run-status enums, independently", () => {
    for (const recordedSource of ["MANUAL", "CI_IMPORT"] as const)
      expect(caseHistoryRunFiltersSchema.parse({ recordedSource })).toEqual({
        recordedSource,
      });
    for (const runStatus of ["RUNNING", "PASSED", "FAILED", "PARTIAL"] as const)
      expect(caseHistoryRunFiltersSchema.parse({ runStatus })).toEqual({
        runStatus,
      });
    for (const recordedSource of ["MANUAL", "CI_IMPORT"] as const)
      for (const runStatus of [
        "RUNNING",
        "PASSED",
        "FAILED",
        "PARTIAL",
      ] as const)
        expect(
          caseHistoryRunFiltersSchema.parse({ recordedSource, runStatus }),
        ).toEqual({ recordedSource, runStatus });
    for (const value of ["", "manual", "GitLab", "CI", " MANUAL ", null, 1])
      expect(caseHistoryRecordedSourceSchema.safeParse(value).success).toBe(
        false,
      );
    // PASS/FAIL/BLOCKED/SKIP/FLAKY are case/result vocabulary, not run statuses.
    for (const value of [
      "PASS",
      "FAIL",
      "BLOCKED",
      "SKIP",
      "FLAKY",
      "Not run",
      "running",
      null,
      1,
    ])
      expect(caseHistoryRunStatusSchema.safeParse(value).success).toBe(false);
  });

  it("strict standalone and composed schemas refuse unknown fields without relaxing full scope", () => {
    for (const input of [
      { outcome: "PASS" },
      { provider: "gitlab" },
      { recordedSource: "MANUAL", all: true },
    ])
      expect(caseHistoryRunFiltersSchema.safeParse(input).success).toBe(false);
    const composed = z
      .object({
        platform: z.string().optional(),
        ...caseHistoryRunFiltersShape,
      })
      .strict();
    expect(
      composed.parse({
        platform: " PC ",
        recordedSource: "MANUAL",
        runStatus: "FAILED",
      }),
    ).toEqual({
      platform: " PC ",
      recordedSource: "MANUAL",
      runStatus: "FAILED",
    });
    expect(
      composed.safeParse({ platform: "PC", caseOutcome: "FAIL" }).success,
    ).toBe(false);
  });

  it("key fragment has deterministic insertion order and binds every selected owned value", () => {
    const a = caseHistoryRunFiltersKeyFields({
      recordedSource: "MANUAL",
      runStatus: "FAILED",
    });
    const b = caseHistoryRunFiltersKeyFields({
      runStatus: "FAILED",
      recordedSource: "MANUAL",
    });
    expect(JSON.stringify(a)).toBe(
      '{"recordedSource":"MANUAL","runStatus":"FAILED"}',
    );
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(
      JSON.stringify(
        caseHistoryRunFiltersKeyFields({
          recordedSource: "CI_IMPORT",
          runStatus: "FAILED",
        }),
      ),
    ).not.toBe(JSON.stringify(a));
    expect(
      JSON.stringify(
        caseHistoryRunFiltersKeyFields({
          recordedSource: "MANUAL",
          runStatus: "PASSED",
        }),
      ),
    ).not.toBe(JSON.stringify(a));
    expect(
      JSON.stringify(
        caseHistoryRunFiltersKeyFields({ recordedSource: "MANUAL" }),
      ),
    ).toBe('{"recordedSource":"MANUAL"}');
    expect(
      JSON.stringify(caseHistoryRunFiltersKeyFields({ runStatus: "RUNNING" })),
    ).toBe('{"runStatus":"RUNNING"}');
    const complete = {
      platform: "PC",
      recordedSource: "MANUAL" as const,
      runStatus: "FAILED" as const,
    };
    expect(caseHistoryRunFiltersKeyFields(complete)).toEqual(a);
  });

  it("stays browser-pure and retains stored provider / overall-run rather than case-outcome meanings", () => {
    const schema = readFileSync(
      new URL("./caseHistoryRunFiltersSchema.ts", import.meta.url),
      "utf8",
    );
    expect(schema).not.toMatch(
      /@vaettir\/db|node:|process\.|Prisma|\.default\(/,
    );
    expect(schema).toContain('ciProvider === literal "manual"');
    expect(schema).toContain("NOT the selected case outcome");
    const service = readFileSync(
      new URL("./caseExecutionHistory.ts", import.meta.url),
      "utf8",
    );
    expect(service).toMatch(
      /const manual\s*=\s*run\.ciProvider\s*===\s*"manual"/,
    );
    expect(service).toMatch(
      /source:\s*manual\s*\?\s*"MANUAL"\s*:\s*"CI_IMPORT"/,
    );
    expect(service).toMatch(/runStatus:\s*run\.status/);
  });
});
