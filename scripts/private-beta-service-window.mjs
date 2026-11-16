import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_CONFIG_URL = new URL(
  "../config/private-beta-service-window.json",
  import.meta.url,
);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const CRON_PATTERN = /^cron\(0 (\d|1\d|2[0-3]) \* \* \? \*\)$/;
const SCHEDULE_NAMES = [
  "rds-start-vaettir-postgres", "ecs-start-vaettir-api", "ecs-start-vaettir-web",
  "rds-stop-vaettir-postgres", "ecs-stop-vaettir-api", "ecs-stop-vaettir-web",
];

export function loadServiceWindow(path = fileURLToPath(DEFAULT_CONFIG_URL)) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateServiceWindow(window) {
  if (!["always-on", "scheduled"].includes(window.mode))
    throw new Error("availability mode must be explicit");
  if (window.timezone !== "America/Los_Angeles")
    throw new Error("private beta timezone must remain America/Los_Angeles");
  if (!TIME_PATTERN.test(window.start) || !TIME_PATTERN.test(window.stop))
    throw new Error("start and stop must be HH:MM");
  const startHour = Number(window.start.slice(0, 2));
  const stopHour = Number(window.stop.slice(0, 2));
  if (window.startExpression !== `cron(0 ${startHour} * * ? *)`)
    throw new Error("startExpression drifted from start");
  if (window.stopExpression !== `cron(0 ${stopHour} * * ? *)`)
    throw new Error("stopExpression drifted from stop");
  if (
    !CRON_PATTERN.test(window.startExpression) ||
    !CRON_PATTERN.test(window.stopExpression)
  )
    throw new Error("invalid scheduler expression");
  const expectedCopy = window.mode === "always-on"
    ? "Available 24/7" : "Awake 8:00am – 1:00am Pacific";
  if (window.publicCopy !== expectedCopy)
    throw new Error("public service-window copy drifted");
  if (
    !Array.isArray(window.targets) ||
    window.targets.length !== 6 ||
    new Set(window.targets).size !== 6 ||
    SCHEDULE_NAMES.some((name) => !window.targets.includes(name)) ||
    window.schedulerGroup !== "cost-audit-restop"
  )
    throw new Error("expected six unique Vaettir schedules");
  return window;
}

export function renderDesiredSchedules(window) {
  validateServiceWindow(window);
  return window.targets.map((name) => ({
    name,
    groupName: window.schedulerGroup,
    state: window.mode === "always-on" ? "DISABLED" : "ENABLED",
    timezone: window.timezone,
    scheduleExpression: name.includes("-start-")
      ? window.startExpression
      : window.stopExpression,
  }));
}

export function compareActualSchedules(window, actualSchedules) {
  const desired = renderDesiredSchedules(window);
  if (actualSchedules.length !== desired.length ||
      new Set(actualSchedules.map((item) => item.Name ?? item.name)).size !== desired.length)
    return [{ name: "inventory", issue: "expected exactly six unique Vaettir schedules" }];
  const actualByName = new Map(
    actualSchedules.map((item) => [item.Name ?? item.name, item]),
  );
  return desired.flatMap((expected) => {
    const actual = actualByName.get(expected.name);
    if (!actual) return [{ name: expected.name, issue: "missing" }];
    const issues = [];
    if ((actual.State ?? actual.state) !== expected.state) issues.push("state");
    if ((actual.GroupName ?? actual.groupName) !== expected.groupName)
      issues.push("groupName");
    if (
      (actual.ScheduleExpressionTimezone ?? actual.timezone) !==
      expected.timezone
    )
      issues.push("timezone");
    if (
      (actual.ScheduleExpression ?? actual.scheduleExpression) !==
      expected.scheduleExpression
    )
      issues.push("scheduleExpression");
    return issues.map((issue) => ({ name: expected.name, issue }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configFlag = process.argv.indexOf("--config");
  const configPath = configFlag >= 0 ? process.argv[configFlag + 1] : undefined;
  if (configFlag >= 0 && !configPath)
    throw new Error("--config requires a JSON file");
  const window = validateServiceWindow(loadServiceWindow(configPath));
  const actualFlag = process.argv.indexOf("--actual");
  if (actualFlag >= 0) {
    const actualPath = process.argv[actualFlag + 1];
    if (!actualPath) throw new Error("--actual requires a JSON file");
    const actual = JSON.parse(
      readFileSync(actualPath === "-" ? 0 : actualPath, "utf8"),
    );
    const drift = compareActualSchedules(window, actual.Schedules ?? actual);
    if (drift.length > 0) {
      process.stderr.write(`${JSON.stringify({ drift }, null, 2)}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(
        "service-window schedules match the canonical contract\n",
      );
    }
  } else {
    process.stdout.write(
      `${JSON.stringify({ publicCopy: window.publicCopy, schedules: renderDesiredSchedules(window) }, null, 2)}\n`,
    );
  }
}
