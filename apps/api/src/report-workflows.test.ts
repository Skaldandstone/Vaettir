import { describe, expect, it } from "vitest";
import {
  dashboardConfigSchema,
  dashboardSaveInput,
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
describe("reporting validation compatibility", () => {
  const config = {
    definition,
    columns: 1,
    widgets: [{ id: "outcomes", display: "bars" }],
  };
  const save = {
    projectId: "project",
    expectedOrganizationId: "workspace",
    expectedClerkActorId: "actor",
    id: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    expectedVersion: 0,
    name: "🧪".repeat(50),
    config,
    visibility: "private",
    archived: false,
  };
  it("rejects raw own prototype keys at request and nested configuration boundaries", () => {
    const ownKey = JSON.parse('{"__proto__":{"admin":true}}');
    expect(dashboardSaveInput.safeParse({ ...save, ...ownKey }).success).toBe(
      false,
    );
    expect(
      dashboardSaveInput.safeParse({
        ...save,
        config: { ...config, ...ownKey },
      }).success,
    ).toBe(false);
    expect(
      dashboardSaveInput.safeParse({
        ...save,
        config: { ...config, widgets: [{ ...config.widgets[0], ...ownKey }] },
      }).success,
    ).toBe(false);
  });
  it("preserves stored UTF-16 name, subject and narrative limits without truncation", () => {
    expect(dashboardSaveInput.parse(save).name).toBe(save.name);
    expect(
      dashboardSaveInput.safeParse({ ...save, name: "🧪".repeat(51) }).success,
    ).toBe(false);
    expect(
      dashboardSaveInput.safeParse({ ...save, projectId: "🧪".repeat(60) })
        .success,
    ).toBe(true);
    expect(
      dashboardSaveInput.safeParse({ ...save, projectId: "🧪".repeat(61) })
        .success,
    ).toBe(false);
    const narrative = "🧪".repeat(750);
    expect(
      dashboardConfigSchema.parse({
        ...config,
        definition: { ...definition, summary: narrative },
      }).definition.summary,
    ).toBe(narrative);
    expect(
      dashboardConfigSchema.safeParse({
        ...config,
        definition: { ...definition, summary: narrative + "🧪" },
      }).success,
    ).toBe(false);
  });
  it("rejects oversized widget lists before inspecting their elements", () => {
    let inspected = 0;
    const widget = {
      get id() {
        inspected++;
        return "outcomes";
      },
      display: "bars",
    };
    const parsed = dashboardConfigSchema.safeParse({
      ...config,
      widgets: Array(11).fill(widget),
    });
    expect(parsed.success).toBe(false);
    expect(inspected).toBe(0);
    if (!parsed.success)
      expect(parsed.error.issues).toEqual([
        expect.objectContaining({ code: "too_big", path: ["widgets"] }),
      ]);
  });
  it("retains private delivery defaults without inventing optional dashboard fields or consent", () => {
    const { delivery: _delivery, ...withoutDelivery } = daily;
    expect(_delivery).toBe("private");
    expect(reportScheduleConfigSchema.parse(withoutDelivery).delivery).toBe(
      "private",
    );
    const parsed = dashboardSaveInput.parse(save);
    expect(parsed.config).not.toHaveProperty("additionalProjectIds");
    expect(parsed.config.widgets[0]).not.toHaveProperty("query");
    expect(
      dashboardSaveInput.safeParse({
        ...save,
        expectedOrganizationId: undefined,
      }).success,
    ).toBe(false);
  });
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
