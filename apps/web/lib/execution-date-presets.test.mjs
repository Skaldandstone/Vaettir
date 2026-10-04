import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executionDatePresets,
  resolveExecutionDatePreset,
} from "./execution-date-presets.ts";

// SOURCE ONLY: authored 2026-10-04, NOT EXECUTED. Existing native web discovery.
test("UTC shortcuts include today and retain the complete 90-date bound", () => {
  const now = new Date("2026-10-04T01:00:00.000Z");
  const expected = {
    TODAY: "2026-10-04",
    LAST_7: "2026-09-28",
    LAST_14: "2026-09-21",
    LAST_30: "2026-09-05",
    LAST_90: "2026-07-07",
  };
  for (const [id, start] of Object.entries(expected))
    assert.deepEqual(resolveExecutionDatePreset(id, now), {
      start,
      end: "2026-10-04",
    });
});
test("UTC rather than local calendar is used without mutating the caller's clock", () => {
  const now = new Date("2026-10-03T18:00:00-07:00"),
    before = now.getTime();
  assert.equal(resolveExecutionDatePreset("TODAY", now).start, "2026-10-04");
  assert.equal(now.getTime(), before);
});
test("previous complete months retain leap, year and low-year boundaries", () => {
  for (const [clock, start, end] of [
    ["2024-03-01", "2024-02-01", "2024-02-29"],
    ["2025-03-01", "2025-02-01", "2025-02-28"],
    ["2026-01-01", "2025-12-01", "2025-12-31"],
    ["0099-01-01", "0098-12-01", "0098-12-31"],
  ])
    assert.deepEqual(
      resolveExecutionDatePreset(
        "PREVIOUS_MONTH",
        new Date(`${clock}T00:00:00Z`),
      ),
      { start, end },
    );
});
test("unsupported choices and calendars refuse without partial dates", () => {
  assert.throws(
    () => resolveExecutionDatePreset("unknown"),
    /supported UTC date shortcut/,
  );
  assert.throws(
    () => resolveExecutionDatePreset("LAST_7", new Date(NaN)),
    /valid current date/,
  );
  for (const id of ["LAST_90", "PREVIOUS_MONTH"])
    assert.throws(
      () => resolveExecutionDatePreset(id, new Date("0000-01-01T00:00:00Z")),
      /complete shortcut/,
    );
  assert.throws(
    () =>
      resolveExecutionDatePreset("TODAY", new Date("+010000-01-01T00:00:00Z")),
    /supported calendar range/,
  );
  assert.equal(
    new Set(executionDatePresets.map((item) => item.id)).size,
    executionDatePresets.length,
  );
});
