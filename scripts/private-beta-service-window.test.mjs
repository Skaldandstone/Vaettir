import assert from "node:assert/strict";
import test from "node:test";
import {
  compareActualSchedules,
  loadServiceWindow,
  renderDesiredSchedules,
  validateServiceWindow,
} from "./private-beta-service-window.mjs";

test("canonical private-beta window drives public copy and all AWS schedules", () => {
  const window = validateServiceWindow(loadServiceWindow());
  const schedules = renderDesiredSchedules(window);

  assert.equal(window.publicCopy, "Awake 8:00am – 1:00am Pacific");
  assert.equal(schedules.length, 6);
  assert.deepEqual(
    new Set(schedules.map((item) => item.timezone)),
    new Set(["America/Los_Angeles"]),
  );
  assert.deepEqual(
    new Set(
      schedules
        .filter((item) => item.name.includes("-start-"))
        .map((item) => item.scheduleExpression),
    ),
    new Set(["cron(0 8 * * ? *)"]),
  );
  assert.deepEqual(
    new Set(
      schedules
        .filter((item) => item.name.includes("-stop-"))
        .map((item) => item.scheduleExpression),
    ),
    new Set(["cron(0 1 * * ? *)"]),
  );
});

test("drift between the advertised window and scheduler expressions is rejected", () => {
  const window = loadServiceWindow();
  assert.throws(
    () =>
      validateServiceWindow({
        ...window,
        startExpression: "cron(0 9 * * ? *)",
      }),
    /drifted/,
  );
  assert.throws(
    () =>
      validateServiceWindow({
        ...window,
        publicCopy: "Awake 9:00am – midnight Pacific",
      }),
    /copy drifted/,
  );
});

test("read-only AWS schedule evidence reports exact production drift", () => {
  const window = loadServiceWindow();
  const actual = renderDesiredSchedules(window).map((item) => ({
    Name: item.name,
    GroupName: item.groupName,
    ScheduleExpressionTimezone: item.timezone,
    ScheduleExpression: item.name.includes("-start-")
      ? "cron(0 9 * * ? *)"
      : "cron(0 0 * * ? *)",
  }));
  assert.deepEqual(
    compareActualSchedules(window, actual),
    actual.map((item) => ({ name: item.Name, issue: "scheduleExpression" })),
  );
});
