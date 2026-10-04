// Authored only. Morning validation required; no checks tonight.
import { describe, it, expect } from "vitest";
import {
  recordedExecutionTrendInput,
  recordedExecutionTrendKey,
  recordedExecutionTrendRunsInput,
} from "./recordedExecutionTrendSchema.js";
const base = {
  projectId: "project",
  originalOrganizationId: "original",
  start: "2020-01-01",
  end: "2020-01-03",
};
describe("bounded UTC recorded execution trend scope", () => {
  it("validates real UTC days inclusive90 limit and future rejection", () => {
    expect(
      recordedExecutionTrendInput.safeParse({ ...base, end: "2020-03-30" })
        .success,
    ).toBe(true);
    for (const change of [
      { start: "2020-02-30" },
      { end: "2019-12-31" },
      { end: "2020-03-31" },
      { end: new Date(Date.now() + 86400000).toISOString().slice(0, 10) },
    ])
      expect(
        recordedExecutionTrendInput.safeParse({ ...base, ...change }).success,
      ).toBe(false);
  });
  it("binds canonical original-org scope key without trimming recorded values or accepting release SQL or rates", () => {
    const original = recordedExecutionTrendInput.parse({
      ...base,
      platform: "PC ",
      build: "build-1",
    });
    expect(original.platform).toBe("PC ");
    expect(recordedExecutionTrendKey(original)).toBe(
      recordedExecutionTrendKey({ ...original }),
    );
    expect(recordedExecutionTrendKey(original)).not.toBe(
      recordedExecutionTrendKey({
        ...original,
        originalOrganizationId: "other",
      }),
    );
    for (const change of [
      { releaseId: "release" },
      { rawSql: "SELECT true" },
      { platform: " " },
      { environment: "x".repeat(2001) },
      { requestKey: "invented" },
    ])
      expect(
        recordedExecutionTrendInput.safeParse({ ...base, ...change }).success,
      ).toBe(false);
  });
  it("requires day within applied interval and bounded deterministic page with same base key", () => {
    const day = recordedExecutionTrendRunsInput.parse({
      ...base,
      day: "2020-01-02",
      page: 0,
    });
    expect(recordedExecutionTrendKey(day)).toBe(
      recordedExecutionTrendKey(base),
    );
    for (const change of [
      { day: "2020-01-04" },
      { day: "not-a-day" },
      { page: -1 },
      { page: 1000 },
    ])
      expect(
        recordedExecutionTrendRunsInput.safeParse({ ...day, ...change })
          .success,
      ).toBe(false);
  });
});
