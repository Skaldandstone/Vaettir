import { describe, expect, it } from "vitest";
import {
  reportDateIntervalSchema,
  reportExecutionScopeSchema,
  reportRunWhere,
  reportWindow,
} from "./reportSnapshotScope.js";
describe("exact recorded report scope", () => {
  it("validates UTC calendar dates, inclusive order and bounded interval", () => {
    for (const interval of [
      { start: "2026-02-30", end: "2026-03-01" },
      { start: "2026-03-02", end: "2026-03-01" },
      { start: "2020-01-01", end: "2022-01-01" },
    ])
      expect(reportDateIntervalSchema.safeParse(interval).success).toBe(false);
    expect(
      reportDateIntervalSchema.parse({
        start: "2024-02-29",
        end: "2024-02-29",
      }),
    ).toEqual({ start: "2024-02-29", end: "2024-02-29" });
  });
  it("caps today at capture, retains historical end and rejects future dates", () => {
    const asOf = new Date("2026-10-03T12:00:00Z");
    expect(
      reportWindow(asOf, 30, { start: "2026-10-02", end: "2026-10-02" }),
    ).toEqual({
      start: new Date("2026-10-02T00:00:00Z"),
      end: new Date("2026-10-02T23:59:59.999Z"),
    });
    expect(
      reportWindow(asOf, 30, { start: "2026-10-03", end: "2026-10-03" }).end,
    ).toEqual(asOf);
    expect(() =>
      reportWindow(asOf, 30, { start: "2026-10-03", end: "2026-10-04" }),
    ).toThrow("future");
    expect(reportWindow(asOf, 7).start).toEqual(
      new Date("2026-09-26T12:00:00Z"),
    );
  });
  it("bounds exact filters and ANDs recorded references without guessing missing context", () => {
    expect(reportExecutionScopeSchema.safeParse({}).success).toBe(false);
    expect(
      reportExecutionScopeSchema.safeParse({ platform: " " }).success,
    ).toBe(false);
    expect(
      reportExecutionScopeSchema.safeParse({ inventedId: "invented" }).success,
    ).toBe(false);
    const where = reportRunWhere("project", new Date(0), new Date(100), {
      planId: "plan",
      runId: "run",
      platform: "PC",
      environment: "lab",
      build: "abc",
    });
    expect(where).toMatchObject({
      projectId: "project",
      AND: expect.arrayContaining([
        { id: "run" },
        { executionContext: { path: ["plan", "testPlanId"], equals: "plan" } },
        { executionContext: { path: ["version"], equals: 1 } },
        {
          executionContext: {
            path: ["configuration", "platform"],
            equals: "PC",
          },
        },
      ]),
    });
    expect(JSON.stringify(where)).toContain(
      '"ciProvider":{"not":"manual"},"commitSha":"abc"',
    );
  });
  it("requires resolved complete release membership and keeps empty membership empty", () => {
    const dates = [new Date(0), new Date(100)] as const;
    expect(() =>
      reportRunWhere("project", ...dates, { releaseId: "release" }),
    ).toThrow();
    const empty = reportRunWhere(
      "project",
      ...dates,
      { releaseId: "release" },
      [],
    );
    expect(empty.AND).toEqual(
      expect.arrayContaining([{ OR: [{ id: { in: [] } }] }]),
    );
    const selected = reportRunWhere(
      "project",
      ...dates,
      { releaseId: "release", planId: "plan" },
      ["plan", "other"],
    );
    expect(selected.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            {
              executionContext: {
                path: ["plan", "testPlanId"],
                equals: "plan",
              },
            },
            {
              executionContext: {
                path: ["plan", "testPlanId"],
                equals: "other",
              },
            },
          ],
        },
        { executionContext: { path: ["version"], equals: 1 } },
        { executionContext: { path: ["plan", "testPlanId"], equals: "plan" } },
      ]),
    );
  });
});
