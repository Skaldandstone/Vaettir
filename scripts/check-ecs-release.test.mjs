import test from "node:test";
import assert from "node:assert/strict";
import { checkEcsRelease } from "./check-ecs-release.mjs";

const task = "arn:aws:ecs:us-east-2:123456789012:task-definition/example:2";
function stable() {
  return { taskDefinition: task, desiredCount: 1, runningCount: 1, pendingCount: 0,
    deployments: [{ status: "PRIMARY", taskDefinition: task, rolloutState: "COMPLETED", failedTasks: 0 }] };
}
test("accepts one completed running requested task revision", () => {
  assert.equal(checkEcsRelease(stable(), task).ready, true);
});
test("COMPLETED scaled-to-zero is not deployment acceptance", () => {
  assert.equal(checkEcsRelease({ ...stable(), desiredCount: 0, runningCount: 0 }, task).ready, false);
});
test("rejects pending, missing and mismatched runtime counts", () => {
  for (const change of [{pendingCount: 1}, {runningCount: 0}, {desiredCount: undefined}])
    assert.equal(checkEcsRelease({ ...stable(), ...change }, task).ready, false);
});
test("rejects previous revision, rollback, multiple deployments and failed attempts", () => {
  assert.equal(checkEcsRelease(stable(), task + "0").ready, false);
  for (const change of [{rolloutState: "IN_PROGRESS"}, {status: "ACTIVE"}, {failedTasks: 1}, {taskDefinition: "old"}]) {
    const service = stable();
    Object.assign(service.deployments[0], change);
    assert.equal(checkEcsRelease(service, task).ready, false);
  }
  const service = stable();
  service.deployments.push({ ...service.deployments[0] });
  assert.equal(checkEcsRelease(service, task).ready, false);
  assert.equal(checkEcsRelease({ ...stable(), deployments: [] }, task).ready, false);
});
