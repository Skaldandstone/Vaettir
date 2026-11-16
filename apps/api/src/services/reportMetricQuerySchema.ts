import { z } from "@vaettir/core/dist/validation.js";
export const reportMetricQuerySchema = z
  .object({
    entity: z.enum(["cases", "results", "caseVersions"]),
    dimension: z.enum([
      "priority",
      "testType",
      "automationStatus",
      "status",
      "day",
      "week",
      "month",
    ]),
    operation: z.enum(["count", "durationMs"]),
    priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
    automationStatus: z
      .enum(["MANUAL", "AUTOMATED", "PARTIALLY_AUTOMATED", "NEEDS_AUTOMATION"])
      .optional(),
    status: z.enum(["PASS", "FAIL", "SKIP", "FLAKY", "BLOCKED"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const allowed =
      value.entity === "cases"
        ? ["priority", "testType", "automationStatus", "day", "week", "month"]
        : value.entity === "results"
          ? ["status", "day", "week", "month"]
          : ["priority", "testType", "day", "week", "month"];
    if (!allowed.includes(value.dimension))
      ctx.addIssue({
        code: "custom",
        message: "Choose a grouping supported by this data source",
        path: ["dimension"],
      });
    if (value.operation === "durationMs" && value.entity !== "results")
      ctx.addIssue({
        code: "custom",
        message: "Duration is available only for recorded results",
        path: ["operation"],
      });
    if (value.status && value.entity !== "results")
      ctx.addIssue({
        code: "custom",
        message: "Outcome filtering requires recorded results",
        path: ["status"],
      });
    if (value.automationStatus && value.entity === "caseVersions")
      ctx.addIssue({
        code: "custom",
        message: "Historical automation state is not recorded in case versions",
        path: ["automationStatus"],
      });
  });
export type ReportMetricQuery = z.infer<typeof reportMetricQuerySchema>;
