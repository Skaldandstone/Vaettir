import { z } from "zod";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Choose a valid calendar date");
/** Pure date contract for API and browser; no database or server runtime imports. */
export const reportDateIntervalSchema = z
  .object({ start: day, end: day })
  .strict()
  .refine((value) => value.start <= value.end, "Start must be on or before end")
  .refine(
    (value) => Date.parse(value.end) - Date.parse(value.start) < 366 * 86400000,
    "Keep the interval within 366 days",
  );
