import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderRollbackConfiguration } from "./render-ecs-rollback-config.mjs";
import { checkEcsRelease } from "./check-ecs-release.mjs";

const repo = "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api";
const digest = `sha256:${"a".repeat(64)}`;
const taskArn = "arn:aws:ecs:us-east-2:051722405355:task-definition/vaettir-api:32";
function fixture() {
  return {
    response: { services: [{serviceName: "vaettir-api", taskDefinition: taskArn,
      deploymentController: {type: "ECS"}, desiredCount: 1, runningCount: 1, pendingCount: 0,
      deployments: [{status: "PRIMARY", taskDefinition: taskArn, rolloutState: "COMPLETED", failedTasks: 0}],
      deploymentConfiguration: {minimumHealthyPercent: 100, maximumPercent: 200, strategy: "ROLLING", bakeTimeInMinutes: 0,
        deploymentCircuitBreaker: {enable: false, rollback: false, resetOnHealthyTask: true, thresholdConfiguration: {type: "BOUNDED_PERCENT", value: 50}},
        alarms: {enable: true, rollback: true, alarmNames: ["synthetic-health"]}},
    }] },
    recovery: {taskDefinition: {status: "ACTIVE", taskDefinitionArn: taskArn,
      containerDefinitions: [{name: "vaettir-api", image: `${repo}@${digest}`, environment: [
        {name: "VAETTIR_RELEASE_COMMIT", value: "b".repeat(40)}, {name: "VAETTIR_IMAGE_DIGEST", value: digest},
      ]}],
    }},
  };
}
const render = f => renderRollbackConfiguration(f.response, f.recovery, "vaettir-api", repo);

test("enables safe rollback without mutating predecessor, alarms or failure thresholds", () => {
  const f = fixture(); const before = structuredClone(f); const config = render(f);
  assert.deepEqual(f, before);
  assert.deepEqual(config, {...before.response.services[0].deploymentConfiguration,
    deploymentCircuitBreaker: {...before.response.services[0].deploymentConfiguration.deploymentCircuitBreaker, enable: true, rollback: true}});
  assert.equal(config.minimumHealthyPercent, 100); assert.equal(config.maximumPercent, 200);
});
test("is idempotent for a service already protected", () => {
  const f = fixture(); f.response.services[0].deploymentConfiguration = render(f);
  assert.deepEqual(render(f), f.response.services[0].deploymentConfiguration);
});
test("rejects nonrolling, mismatched, missing and failed service responses", () => {
  for (const change of [s => s.deploymentController.type = "CODE_DEPLOY", s => s.deploymentConfiguration.strategy = "BLUE_GREEN",
    s => s.serviceName = "other", s => s.runningCount = 0, s => s.desiredCount = 0, s => s.pendingCount = 1,
    s => s.deployments[0].rolloutState = "IN_PROGRESS", s => s.deployments[0].failedTasks = 1,
    s => s.deployments.push(structuredClone(s.deployments[0]))]) {
    const f = fixture(); change(f.response.services[0]); assert.throws(() => render(f));
  }
  for (const response of [{services: []}, {services: fixture().response.services, failures: [{reason: "missing"}]}])
    assert.throws(() => render({...fixture(), response}));
});
test("rejects inactive, unrelated, mutable or unverifiable recovery task", () => {
  for (const change of [t => t.status = "INACTIVE", t => t.taskDefinitionArn = "other", t => t.containerDefinitions[0].name = "other",
    t => t.containerDefinitions[0].image = `${repo}:latest`, t => t.containerDefinitions[0].environment = [],
    t => t.containerDefinitions[0].environment[0].value = "main", t => t.containerDefinitions[0].environment[1].value = `sha256:${"c".repeat(64)}`]) {
    const f = fixture(); change(f.recovery.taskDefinition); assert.throws(() => render(f));
  }
});
test("a stable automatic rollback is not success for the requested candidate", () => {
  const f = fixture(); const candidate = taskArn.replace(":32", ":33");
  assert.equal(checkEcsRelease(f.response.services[0], candidate).ready, false);
  f.response.services[0].taskDefinition = candidate; f.response.services[0].deployments[0].taskDefinition = candidate;
  assert.equal(checkEcsRelease(f.response.services[0], candidate).ready, true);
});
test("release entrypoint selects commit image and preserves recovery before mutation", () => {
  const script = readFileSync(new URL("./pin-ecs-release.sh", import.meta.url), "utf8");
  assert.match(script, /--image-ids "imageTag=\$RELEASE_COMMIT"/);
  assert.doesNotMatch(script, /imageTag=latest/);
  for (const guard of ["render-ecs-rollback-config.mjs", "recovery-image.json"])
    assert.ok(script.indexOf(guard) < script.indexOf("aws ecs register-task-definition"));
  assert.match(script, /--deployment-configuration "file:\/\/\$AWS_CONFIG"/);
  assert.ok(script.indexOf("node scripts/check-ecs-release.mjs") > script.indexOf("aws ecs wait services-stable"));
  assert.doesNotMatch(script, /--force-new-deployment|--desired-count|trap 'rm/);
});
