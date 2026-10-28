import { describe, expect, it } from "vitest";
import {
  dashboardConfigSchema,
  nextReportOccurrence,
  reportScheduleConfigSchema,
} from "./services/reportWorkflowSchema.js";

const definition = {
  audience: "stakeholders" as const,
  windowDays: 30 as const,
  sections: ["inventory" as const],
  summary: "",
  risks: "",
  nextActions: "",
};
const daily = reportScheduleConfigSchema.parse({
  definition,
  cadence: "daily",
  timeZone: "America/Los_Angeles",
  hour: 9,
  minute: 0,
  weekday: 1,
  monthDay: 1,
});
describe("report recurrence in the selected time zone", () => {
  it("uses the chosen zone regardless of the process zone", () => {
    expect(
      nextReportOccurrence(
        daily,
        new Date("2026-10-28T15:59:00Z"),
      ).toISOString(),
    ).toBe("2026-10-28T16:00:00.000Z");
    expect(
      nextReportOccurrence(
        daily,
        new Date("2026-10-28T16:00:00Z"),
      ).toISOString(),
    ).toBe("2026-10-29T16:00:00.000Z");
  });
  it("advances a spring gap and never repeats a fall occurrence", () => {
    expect(
      nextReportOccurrence(
        { ...daily, hour: 2, minute: 30 },
        new Date("2026-03-08T09:59:00Z"),
      ).toISOString(),
    ).toBe("2026-03-08T10:00:00.000Z");
    expect(
      nextReportOccurrence(
        { ...daily, hour: 1, minute: 30 },
        new Date("2026-11-01T08:30:00Z"),
      ).toISOString(),
    ).toBe("2026-11-02T09:30:00.000Z");
  });
  it("supports weekly and short-month schedules", () => {
    expect(
      nextReportOccurrence(
        { ...daily, cadence: "weekly" },
        new Date("2026-10-28T16:00:00Z"),
      ).toISOString(),
    ).toBe("2026-11-02T17:00:00.000Z");
    expect(
      nextReportOccurrence(
        { ...daily, cadence: "monthly", monthDay: 28 },
        new Date("2027-01-28T17:00:00Z"),
      ).toISOString(),
    ).toBe("2027-02-28T17:00:00.000Z");
  });
  it("rejects unsupported time zones, dates and duplicate widgets", () => {
    expect(
      reportScheduleConfigSchema.safeParse({
        ...daily,
        timeZone: "Mars/Olympus",
      }).success,
    ).toBe(false);
    expect(
      reportScheduleConfigSchema.safeParse({ ...daily, monthDay: 31 }).success,
    ).toBe(false);
    expect(() => nextReportOccurrence(daily, new Date(NaN))).toThrow();
    expect(
      dashboardConfigSchema.safeParse({
        definition,
        columns: 2,
        widgets: [
          { id: "outcomes", display: "donut" },
          { id: "outcomes", display: "bars" },
        ],
      }).success,
    ).toBe(false);
  });
});
