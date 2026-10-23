export type StepReading = { name: string; value: string; unit: string; lowerLimit: string; upperLimit: string; instrument: string };
export type StepStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIP";
export function parseStepMeasurements(readings: StepReading[], status: StepStatus) {
  return readings.map(reading => {
    if (!reading.name.trim() || !reading.unit.trim() || !reading.value.trim() || !Number.isFinite(Number(reading.value))) throw new Error("Each measurement needs a name, unit and finite measured value.");
    const lowerLimit = reading.lowerLimit.trim() ? Number(reading.lowerLimit) : undefined;
    const upperLimit = reading.upperLimit.trim() ? Number(reading.upperLimit) : undefined;
    if ((lowerLimit !== undefined && !Number.isFinite(lowerLimit)) || (upperLimit !== undefined && !Number.isFinite(upperLimit))) throw new Error("Limits must be finite values when supplied.");
    if (lowerLimit !== undefined && upperLimit !== undefined && lowerLimit > upperLimit) throw new Error("Lower limit must not exceed upper limit.");
    const value = Number(reading.value);
    if (status === "PASS" && ((lowerLimit !== undefined && value < lowerLimit) || (upperLimit !== undefined && value > upperLimit))) throw new Error("A reading outside its entered limits cannot be recorded as Pass. Review the reading and approved criteria.");
    return { name: reading.name.trim(), unit: reading.unit.trim(), instrument: reading.instrument.trim(), value, lowerLimit, upperLimit };
  });
}
export function isDefinitiveStepRejection(code: unknown, everAmbiguous: boolean) {
  return !everAmbiguous && ["CONFLICT", "FORBIDDEN", "UNAUTHORIZED", "BAD_REQUEST", "NOT_FOUND", "PRECONDITION_FAILED"].includes(String(code));
}
