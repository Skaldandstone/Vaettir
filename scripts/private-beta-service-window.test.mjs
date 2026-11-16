import assert from "node:assert/strict";
import test from "node:test";
import {
  compareActualSchedules,
  loadServiceWindow,
  renderDesiredSchedules,
  validateServiceWindow,
} from "./private-beta-service-window.mjs";

test("production availability disables all six retained start and stop schedules", () => {
  const window = validateServiceWindow(loadServiceWindow());
  const schedules = renderDesiredSchedules(window);

  assert.equal(window.publicCopy, "Available 24/7");
  assert.ok(schedules.every((item) => item.state === "DISABLED"));
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
    State: item.state,
    ScheduleExpression: item.name.includes("-start-")
      ? "cron(0 9 * * ? *)"
      : "cron(0 0 * * ? *)",
  }));
  assert.deepEqual(
    compareActualSchedules(window, actual),
    actual.map((item) => ({ name: item.Name, issue: "scheduleExpression" })),
  );
});

test("enabled shutdown, duplicate schedules and other project targets refuse production acceptance", () => {
  const window = loadServiceWindow();
  const actual = renderDesiredSchedules(window);
  assert.deepEqual(compareActualSchedules(window, actual), []);
  const enabled = actual.map((item) => ({ ...item }));
  enabled.find((item) => item.name === "rds-stop-vaettir-postgres").state = "ENABLED";
  assert.deepEqual(compareActualSchedules(window, enabled), [
    { name: "rds-stop-vaettir-postgres", issue: "state" },
  ]);
  assert.notDeepEqual(compareActualSchedules(window, [...actual, actual[0]]), []);
  assert.throws(() => validateServiceWindow({ ...window, targets: [...window.targets.slice(1), "ecs-stop-kall-api"] }));
  assert.throws(() => validateServiceWindow({ ...window, mode: "unknown" }));
});

test("scheduled rollback remains explicit and preserves its original window", () => {
  const window = { ...loadServiceWindow(), mode: "scheduled", publicCopy: "Awake 8:00am – 1:00am Pacific" };
  assert.ok(renderDesiredSchedules(window).every((item) => item.state === "ENABLED"));
});
