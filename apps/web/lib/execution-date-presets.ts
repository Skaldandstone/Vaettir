const dayMs = 86400000;
function supportedDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export const executionDatePresets = [
  { id: "TODAY", label: "Today (UTC, in progress)", days: 1 },
  { id: "LAST_7", label: "Last 7 UTC dates, including today", days: 7 },
  { id: "LAST_14", label: "Last 14 UTC dates, including today", days: 14 },
  { id: "LAST_30", label: "Last 30 UTC dates, including today", days: 30 },
  { id: "LAST_90", label: "Last 90 UTC dates, including today", days: 90 },
  {
    id: "PREVIOUS_MONTH",
    label: "Previous complete UTC calendar month",
    days: null,
  },
] as const;
export type ExecutionDatePresetId = (typeof executionDatePresets)[number]["id"];

/** Resolves a convenience selection once. Never persists a relative scope. */
export function resolveExecutionDatePreset(id: string, now = new Date()) {
  const preset = executionDatePresets.find((item) => item.id === id);
  if (!preset || !Number.isFinite(now.getTime()))
    throw new Error(
      "Choose a supported UTC date shortcut and a valid current date.",
    );
  const today = now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today))
    throw new Error(
      "The current UTC date is outside the supported calendar range.",
    );
  const midnight = Date.parse(`${today}T00:00:00.000Z`);
  let end = today;
  let start: string;
  if (preset.days === null) {
    // Parse the first of the current UTC month, avoiding Date.UTC's special
    // handling of years 0..99. The previous date identifies the prior month.
    end = new Date(Date.parse(`${today.slice(0, 7)}-01T00:00:00.000Z`) - dayMs)
      .toISOString()
      .slice(0, 10);
    start = `${end.slice(0, 7)}-01`;
  } else {
    start = new Date(midnight - (preset.days - 1) * dayMs)
      .toISOString()
      .slice(0, 10);
  }
  if (
    !supportedDay(start) ||
    !supportedDay(end) ||
    start > end ||
    Date.parse(end) - Date.parse(start) >= 90 * dayMs ||
    end > today
  )
    throw new Error(
      "The complete shortcut is outside the supported 90-date UTC range. Choose explicit dates.",
    );
  return { start, end };
}
