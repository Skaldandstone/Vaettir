import { z } from "zod";
import { reportMetricQuerySchema } from "./reportMetricQuerySchema.js";
import { reportDefinitionSchema } from "./reportDefinitionSchema.js";

export const reportWidgetSchema = z
  .object({
    id: z.enum([
      "outcomes",
      "coverage",
      "plan-progress",
      "priority",
      "automation",
      "requirements",
      "custom-1",
      "custom-2",
      "custom-3",
      "custom-4",
    ]),
    display: z.enum(["bars", "donut", "table"]),
    query: reportMetricQuerySchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.id.startsWith("custom-") !== !!value.query)
      ctx.addIssue({
        code: "custom",
        message:
          "Custom widgets require a metric query; standard charts use their recorded definition.",
      });
  });
export const dashboardConfigSchema = z
  .object({
    definition: reportDefinitionSchema,
    widgets: z
      .array(reportWidgetSchema)
      .min(1)
      .max(10)
      .refine(
        (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
        "Choose each chart once",
      ),
    columns: z.union([z.literal(1), z.literal(2)]),
    additionalProjectIds: z
      .array(z.string().min(1).max(120))
      .max(4)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Choose each project once",
      )
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.widgets.some((widget) => widget.query) ||
        !!value.additionalProjectIds?.length) &&
      (value.definition.executionScope || value.definition.dateInterval)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Custom metrics and portfolio dashboards use project-wide rolling windows. Remove the specific run/date scope or those widgets/projects.",
      });
  });
export const reportScheduleConfigSchema = z
  .object({
    definition: reportDefinitionSchema.refine(
      (value) => !value.dateInterval,
      "Recurring reports use a rolling window",
    ),
    cadence: z.enum(["daily", "weekly", "monthly"]),
    delivery: z.enum(["private", "slack"]).default("private"),
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, "Choose a supported time zone"),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    weekday: z.number().int().min(0).max(6),
    monthDay: z.number().int().min(1).max(28),
  })
  .strict();
export type ReportScheduleConfig = z.infer<typeof reportScheduleConfigSchema>;
const base = z
  .object({
    projectId: z.string().min(1).max(120),
    expectedClerkActorId: z.string().min(1).max(200),
  })
  .strict();
const write = base.extend({
  id: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
  requestId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
});
export const reportWorkflowListInput = base;
export const dashboardSaveInput = write.extend({
  config: dashboardConfigSchema,
  visibility: z.enum(["private", "project"]),
  archived: z.boolean(),
});
export const scheduleSaveInput = write.extend({
  config: reportScheduleConfigSchema,
  enabled: z.boolean(),
  approveRecurringCapture: z.literal(true),
  approveRecurringDelivery: z.literal(true).optional(),
});
export const dashboardReadInput = base.extend({ id: z.string().uuid() });
export const dashboardPreviewInput = base.extend({
  config: dashboardConfigSchema,
});

/** First eligible local wall-clock minute. Spring gaps advance to the first
 * available minute; fall folds run once per local date. Monthly days 1-28 are
 * explicit, avoiding silently skipped short months. No host timezone is used. */
export function nextReportOccurrence(
  config: ReportScheduleConfig,
  after: Date,
): Date {
  if (!Number.isFinite(after.getTime()))
    throw new Error("Invalid schedule clock");
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = (date: Date) =>
    Object.fromEntries(
      format.formatToParts(date).map((p) => [p.type, p.value]),
    );
  const start = parts(after),
    target = config.hour * 60 + config.minute;
  const dayKey = (p: Record<string, string>) => `${p.year}-${p.month}-${p.day}`;
  const startDay = dayKey(start),
    excludeStart = Number(start.hour) * 60 + Number(start.minute) >= target;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const first = Math.floor(after.getTime() / 60000) * 60000 + 60000;
  for (let minute = 0; minute < 32 * 24 * 60; minute++) {
    const candidate = new Date(first + minute * 60000),
      p = parts(candidate);
    if (excludeStart && dayKey(p) === startDay) continue;
    if (
      config.cadence === "weekly" &&
      weekdays.indexOf(p.weekday!) !== config.weekday
    )
      continue;
    if (config.cadence === "monthly" && Number(p.day) !== config.monthDay)
      continue;
    if (Number(p.hour) * 60 + Number(p.minute) >= target) return candidate;
  }
  throw new Error("No schedule occurrence within supported interval");
}
