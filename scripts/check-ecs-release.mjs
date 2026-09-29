import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ECS can report COMPLETED while a scheduled service is scaled to zero.
// This checks runtime availability, not only deployment bookkeeping.
export function checkEcsRelease(service, expectedTask) {
  const issues = [];
  if (!expectedTask || service.taskDefinition !== expectedTask)
    issues.push("unexpected task definition");
  if (!Number.isInteger(service.desiredCount) || service.desiredCount < 1)
    issues.push("service has no desired running tasks");
  if (service.runningCount !== service.desiredCount || service.runningCount < 1)
    issues.push("running task count is not ready");
  if (service.pendingCount !== 0) issues.push("tasks are still pending");
  const deployments = service.deployments ?? [];
  if (deployments.length !== 1) issues.push("rollout has multiple or missing deployments");
  const deployment = deployments[0];
  if (deployment?.rolloutState !== "COMPLETED" || deployment?.status !== "PRIMARY")
    issues.push("primary rollout is not complete");
  if (deployment?.taskDefinition !== expectedTask)
    issues.push("deployment task identity differs");
  if (deployment?.failedTasks !== 0) issues.push("rollout has failed or unknown task attempts");
  return { ready: issues.length === 0, issues };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const response = JSON.parse(readFileSync(0, "utf8"));
  const expectedTask = process.argv[2];
  if (response.failures?.length || response.services?.length !== 1)
    throw new Error("Expected exactly one successfully described ECS service");
  const result = checkEcsRelease(response.services[0], expectedTask);
  console.log(JSON.stringify(result));
  if (!result.ready) process.exitCode = 1;
}
