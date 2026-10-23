import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkEcsRelease } from "./check-ecs-release.mjs";

// A completed, immutable predecessor is required before enabling rollback.
// Preserve alarms, bake time and failure thresholds rather than replacing them.
export function renderRollbackConfiguration(response, recovery, containerName, repositoryUri) {
  if (response.failures?.length || response.services?.length !== 1)
    throw new Error("Expected exactly one successfully described ECS service");
  const service = response.services[0];
  if (service.serviceName !== containerName || service.deploymentController?.type !== "ECS" ||
      (service.deploymentConfiguration?.strategy ?? "ROLLING") !== "ROLLING")
    throw new Error("Rollback requires the requested ECS rolling service");
  const state = checkEcsRelease(service, service.taskDefinition);
  if (!state.ready) throw new Error(`Recovery deployment is not ready: ${state.issues.join(", ")}`);
  const task = recovery.taskDefinition;
  if (task?.status !== "ACTIVE" || task.taskDefinitionArn !== service.taskDefinition)
    throw new Error("Recovery task definition must be active and match the completed deployment");
  const container = task.containerDefinitions?.find(item => item.name === containerName);
  const digest = container?.environment?.find(item => item.name === "VAETTIR_IMAGE_DIGEST")?.value;
  const commit = container?.environment?.find(item => item.name === "VAETTIR_RELEASE_COMMIT")?.value;
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? "") || !/^[a-f0-9]{40}$/.test(commit ?? "") ||
      container?.image !== `${repositoryUri}@${digest}`)
    throw new Error("Recovery image must have matching immutable digest and commit identity");
  const config = structuredClone(service.deploymentConfiguration ?? {});
  return {
    ...config,
    minimumHealthyPercent: 100,
    maximumPercent: 200,
    deploymentCircuitBreaker: { ...config.deploymentCircuitBreaker, enable: true, rollback: true },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , serviceFile, taskFile, containerName, repositoryUri] = process.argv;
  if (!serviceFile || !taskFile || !containerName || !repositoryUri)
    throw new Error("Usage: service.json task.json container repository");
  console.log(JSON.stringify(renderRollbackConfiguration(
    JSON.parse(readFileSync(serviceFile, "utf8")),
    JSON.parse(readFileSync(taskFile, "utf8")), containerName, repositoryUri,
  )));
}
