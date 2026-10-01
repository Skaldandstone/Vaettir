import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const commit = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const task = "arn:aws:ecs:us-east-2:051722405355:task-definition/vaettir-api:32";
const repo = "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api";

// Execute the real Bash release entrypoint with an exported AWS replacement.
// No AWS binary, authentication or network is invoked by these fixtures.
function run(mode) {
  const dir = mkdtempSync(join(tmpdir(), "vaettir-rollback-fixture-"));
  const mock = join(dir, "aws-fixture.mjs"); const calls = join(dir, "calls.jsonl");
  writeFileSync(mock, `
import {appendFileSync, readFileSync} from 'node:fs';
const args=process.argv.slice(2); appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify(args)+'\\n');
const option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const old=${JSON.stringify(task)}, next=old.replace(':32',':33'), repo=${JSON.stringify(repo)}, digest=${JSON.stringify(digest)};
const query=option('--query'), mode=process.env.FIXTURE_MODE;
const container={name:'vaettir-api',image:repo+'@'+digest,environment:[{name:'VAETTIR_RELEASE_COMMIT',value:${JSON.stringify(commit)}},{name:'VAETTIR_IMAGE_DIGEST',value:digest}]};
const service={serviceName:'vaettir-api',taskDefinition:old,deploymentController:{type:'ECS'},desiredCount:1,runningCount:1,pendingCount:0,deployments:[{taskDefinition:old,status:'PRIMARY',rolloutState:'COMPLETED',failedTasks:0}],deploymentConfiguration:{minimumHealthyPercent:100,maximumPercent:200,deploymentCircuitBreaker:{enable:false,rollback:false}}};
let result;
if(args[0]==='ecr'&&args[1]==='describe-repositories') result=repo;
else if(args[0]==='ecr'&&args[1]==='describe-images') {
  if(mode==='missing-recovery'&&option('--image-ids').startsWith('imageDigest=')) process.exit(9);
  result=query?digest:{imageDetails:[{imageDigest:digest}]};
} else if(args[0]==='ecs'&&args[1]==='describe-services') {
  const prior=readFileSync(process.env.FIXTURE_CALLS,'utf8');
  const after=prior.includes('"update-service"');
  if(after&&mode!=='rollback') {service.taskDefinition=next;service.deployments[0].taskDefinition=next;}
  if(!after&&mode==='in-flight') service.deployments[0].rolloutState='IN_PROGRESS';
  result=query?old:{services:[service]};
} else if(args[0]==='ecs'&&args[1]==='describe-task-definition') {
  result=query?(query.includes('environment')?digest:container.image):{taskDefinition:{taskDefinitionArn:old,status:'ACTIVE',family:'vaettir-api',containerDefinitions:[container]}};
} else if(args[0]==='ecs'&&args[1]==='register-task-definition') result=next;
else if(args[0]==='ecs'&&args[1]==='update-service') result={service};
else if(args[0]==='ecs'&&args[1]==='wait') process.exit(0);
else throw Error('Unexpected mocked AWS call '+JSON.stringify(args));
console.log(typeof result==='string'?result:JSON.stringify(result));
`);
  const envFile = join(dir, "bash-env.sh");
  writeFileSync(envFile, 'aws() { "$FIXTURE_NODE" "$FIXTURE_MOCK" "$@"; }\nexport -f aws\n');
  const result = spawnSync(bash, ["scripts/pin-ecs-release.sh", "vaettir-api", commit], {
    cwd: resolve("."), encoding: "utf8", timeout: 30000,
    env: {...process.env, BASH_ENV: envFile, FIXTURE_NODE: process.execPath, FIXTURE_MOCK: mock,
      FIXTURE_CALLS: calls, FIXTURE_MODE: mode, MSYS_NO_PATHCONV: "1"},
  });
  if (result.error) throw result.error;
  return {...result, calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse) : []};
}

test("real release script passes Bash syntax validation", () => {
  execFileSync(bash, ["-n", "scripts/pin-ecs-release.sh"]);
});
test("mocked successful release enables protection and pins the requested image", () => {
  const result = run("success"); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /is stable/);
  assert.ok(result.calls.some(args => args.includes(`imageTag=${commit}`)));
  const update = result.calls.find(args => args[1] === "update-service");
  const configPath = update[update.indexOf("--deployment-configuration") + 1].slice(7);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(config.deploymentCircuitBreaker, {enable: true, rollback: true});
  assert.equal(config.minimumHealthyPercent, 100); assert.equal(config.maximumPercent, 200);
});
test("mocked services-stable after automatic rollback fails the release", () => {
  const result = run("rollback"); assert.notEqual(result.status, 0);
  assert.match(result.stdout, /unexpected task definition/);
  assert.doesNotMatch(result.stdout, /is stable/);
});
test("missing recovery image and in-flight rollout fail before registration or update", () => {
  for (const mode of ["missing-recovery", "in-flight"]) {
    const result = run(mode); assert.notEqual(result.status, 0);
    if (mode === "missing-recovery") assert.ok(result.calls.some(args => args.includes(`imageDigest=${digest}`)));
    else assert.match(result.stderr, /Recovery deployment is not ready/);
    assert.ok(!result.calls.some(args => ["register-task-definition", "update-service"].includes(args[1])));
  }
});
