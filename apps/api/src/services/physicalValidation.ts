import { z } from "zod";

export const validationDomainSchema = z.enum([
  "SOFTWARE",
  "HARDWARE",
  "SYSTEM_INTEGRATION",
  "HIL",
  "MANUFACTURING",
  "MEDICAL_DEVICE",
  "PHARMA_LAB",
  "OTHER",
]);
export const verificationProfileSchema = z.object({
  setup: z.string().max(10000).default(""),
  safety: z.string().max(10000).default(""),
  instruments: z.string().max(10000).default(""),
  acceptanceCriteria: z.string().max(10000).default(""),
});

export const measurementSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    unit: z.string().trim().min(1).max(40),
    value: z.number().finite(),
    lowerLimit: z.number().finite().optional(),
    upperLimit: z.number().finite().optional(),
    instrument: z.string().trim().max(200).default(""),
  })
  .refine(
    (m) =>
      m.lowerLimit === undefined ||
      m.upperLimit === undefined ||
      m.lowerLimit <= m.upperLimit,
    {
      message: "Lower limit must not exceed upper limit",
    },
  );

export const observationsSchema = z.object({
  specimen: z.string().trim().max(300).default(""),
  hardwareRevision: z.string().trim().max(200).default(""),
  firmwareVersion: z.string().trim().max(200).default(""),
  environment: z.string().trim().max(1000).default(""),
  measurements: z.array(measurementSchema).max(100).default([]),
});

export function measurementVerdict(
  m: z.infer<typeof measurementSchema>,
): "IN_RANGE" | "OUT_OF_RANGE" | "NO_LIMITS" {
  if (m.lowerLimit === undefined && m.upperLimit === undefined)
    return "NO_LIMITS";
  return (m.lowerLimit !== undefined && m.value < m.lowerLimit) ||
    (m.upperLimit !== undefined && m.value > m.upperLimit)
    ? "OUT_OF_RANGE"
    : "IN_RANGE";
}

export function manualRunStatus(
  planned: number,
  statuses: string[],
): "FAILED" | "PARTIAL" | "PASSED" {
  if (statuses.some((s) => s === "FAIL" || s === "BLOCKED")) return "FAILED";
  if (
    !planned ||
    statuses.length !== planned ||
    statuses.some((s) => s !== "PASS")
  )
    return "PARTIAL";
  return "PASSED";
}
