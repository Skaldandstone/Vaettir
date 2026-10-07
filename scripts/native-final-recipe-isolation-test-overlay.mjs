// TEST ONLY: exact reviewed transport-stage delta, not native acceptance.
// Frozen historical recipe, source9, adapter, verifier and prior fixtures stay exact.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
const sha=b=>createHash("sha256").update(b).digest("hex");
const changes=[
  [
    "assert.ok(stage === \"pre\" || stage === \"image\");",
    "assert.ok(stage === \"recipe\" || stage === \"pre\" || stage === \"image\");"
  ],
  [
    "if (stage === \"pre\") {\n    assert.equal(fs.existsSync(logPath), false);",
    "if (stage === \"recipe\") {\n    assert.equal(fs.existsSync(logPath), false);"
  ],
  [
    "  checkMembers();\n  diagnosticStage = \"runtime-module-import\";",
    "  checkMembers();\n  const handoffPath = dir + \"/recipe-handoff.json\";\n  const handoff = {\n    stage: \"recipe-unverified\",\n    planSha256: control.planSha256,\n    controlSha256: process.env.VAETTIR_FINAL_CONTROL_SHA,\n    deadlineNs: control.deadlineNs,\n    finalLogSha256: hash(rawLog),\n    finalReceiptSha256: hash(finalRaw),\n    runtimeAcceptance: false,\n    authenticatedAcceptance: false,\n    deploymentAcceptance: false,\n  };\n  if (stage === \"recipe\") {\n    assert.ok(remaining() >= control.verificationReserveSeconds * 1000);\n    assert.equal(fs.existsSync(\"/build/llvm-phase-active.json\"), false);\n    assert.equal(fs.existsSync(handoffPath), false);\n    fs.writeFileSync(handoffPath, JSON.stringify(handoff) + \"\\n\", {\n      flag: \"wx\", mode: 0o400,\n    });\n    // This is a transport boundary only. No adapter/verifier review, accepted\n    // donor, runtime candidate or registry publication may follow this alone.\n    return;\n  }\n  assert.deepEqual(JSON.parse(read(handoffPath, 4096)), handoff);\n  diagnosticStage = \"runtime-module-import\";"
  ],
  [
    "if('${stage}'==='pre'){assert.equal(fs.existsSync(dir),false);",
    "if('${stage}'==='recipe'){assert.equal(fs.existsSync(dir),false);"
  ],
  [
    "  const containerGuard = (stage) =>",
    "  const containerGuard = (stage, stopped = false) =>"
  ],
  [
    "assert.equal(i.Config.Labels['vaettir.final-owner'],'${planSha256}');assert.equal(i.HostConfig.NetworkMode",
    "assert.equal(i.Config.Labels['vaettir.final-owner'],'${planSha256}');assert.deepEqual(i.Config.Env.filter(x=>x.startsWith('VAETTIR_FINAL_CONTROL_SHA=')),['VAETTIR_FINAL_CONTROL_SHA='+bounded('${prefix}control-sha',64)]);${stopped ? \"assert.equal(i.State.Running,false);assert.equal(i.State.Status,'exited');assert.equal(i.State.ExitCode,0);\" : \"\"}assert.equal(i.HostConfig.NetworkMode"
  ],
  [
    "stage === \"pre\" ? JSON.stringify(identity.expectedParent.imageConfigDigest) :",
    "stage === \"recipe\" ? JSON.stringify(identity.expectedParent.imageConfigDigest) : stage === \"pre\" ? `bounded('${prefix}recipe-image-id',80).toString().trim()` :"
  ],
  [
    "  const admission = `${common}const clock=JSON.parse(bounded('${prefix}clock.json',512));assert.ok(BigInt(clock.deadlineNs)-process.hrtime.bigint()>=${(identity.resources.recipeSeconds + identity.resources.verificationReserveSeconds) * 1000000000}n,'Global remaining budget cannot admit final');`;",
    "  const admission = `${common}const clock=JSON.parse(bounded('${prefix}clock.json',512));assert.ok(BigInt(clock.deadlineNs)-process.hrtime.bigint()>=${(identity.resources.recipeSeconds + identity.resources.verificationReserveSeconds) * 1000000000}n,'Global remaining budget cannot admit final');`;\n  const verificationAdmission = `${common}const clock=JSON.parse(bounded('${prefix}clock.json',512));assert.ok(BigInt(clock.deadlineNs)-process.hrtime.bigint()>=${identity.resources.verificationReserveSeconds * 1000000000}n,'Global remaining budget cannot admit fresh verification');`;"
  ],
  [
    "  const imageGuard = `${common}const a=JSON.parse(bounded('${prefix}parent-inspect.json',2097152));assert.equal(a.length,1);const[i]=a;assert.equal(i.Id,'${identity.expectedParent.imageConfigDigest}');assert.equal(i.Os,'linux');assert.equal(i.Architecture,'amd64');assert.ok(i.RepoDigests.includes('${parent}'));assert.ok(i.Size>0&&i.Size<64*1024**3);const l=i.Config.Labels;for(const[k,v]of Object.entries(${JSON.stringify({ \"vaettir.source-commit\": identity.sourceCommit, \"vaettir.source-sha256\": identity.sourceSha256, \"vaettir.prepare-plan\": identity.preparePlanSha256, \"vaettir.continuation-plan\": identity.expectedParent.planSha256, \"vaettir.continuation-phase\": \"assertion-compile-3\", \"vaettir.runtime-eligible\": \"false\", \"vaettir.artifact-purpose\": \"llvm-builder-checkpoint\" })}))assert.equal(l[k],v);`;",
    "  const imageGuard = `${common}const a=JSON.parse(bounded('${prefix}parent-inspect.json',2097152));assert.equal(a.length,1);const[i]=a;assert.equal(i.Id,'${identity.expectedParent.imageConfigDigest}');assert.equal(i.Os,'linux');assert.equal(i.Architecture,'amd64');assert.ok(i.RepoDigests.includes('${parent}'));assert.ok(i.Size>0&&i.Size<64*1024**3);const l=i.Config.Labels;for(const[k,v]of Object.entries(${JSON.stringify({ \"vaettir.source-commit\": identity.sourceCommit, \"vaettir.source-sha256\": identity.sourceSha256, \"vaettir.prepare-plan\": identity.preparePlanSha256, \"vaettir.continuation-plan\": identity.expectedParent.planSha256, \"vaettir.continuation-phase\": \"assertion-compile-3\", \"vaettir.runtime-eligible\": \"false\", \"vaettir.artifact-purpose\": \"llvm-builder-checkpoint\" })}))assert.equal(l[k],v);`;\n  // Unverified local snapshot only, never tagged/pushed or admitted as a donor.\n  const recipeImageGuard = `${common}const id=bounded('${prefix}recipe-image-id',80).toString().trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);const a=JSON.parse(bounded('${prefix}recipe-image-inspect.json',2097152)),p=JSON.parse(bounded('${prefix}parent-inspect.json',2097152));assert.equal(a.length,1);assert.equal(p.length,1);const[i]=a;assert.equal(i.Id,id);assert.equal(i.Os,'linux');assert.equal(i.Architecture,'amd64');assert.ok(i.Size>0&&i.Size<64*1024**3);assert.equal(i.RootFS.Type,'layers');assert.equal(p[0].Id,'${identity.expectedParent.imageConfigDigest}');assert.equal(i.RootFS.Layers.length,p[0].RootFS.Layers.length+1);assert.deepEqual(i.RootFS.Layers.slice(0,-1),p[0].RootFS.Layers);assert.ok(i.RootFS.Layers.every(x=>/^sha256:[a-f0-9]{64}$/.test(x)));for(const[k,v]of Object.entries(${JSON.stringify({ \"vaettir.source-commit\": identity.sourceCommit, \"vaettir.source-sha256\": identity.sourceSha256, \"vaettir.prepare-plan\": identity.preparePlanSha256, \"vaettir.continuation-plan\": planSha256, \"vaettir.continuation-phase\": \"final-recipe-unverified\", \"vaettir.runtime-eligible\": \"false\", \"vaettir.artifact-purpose\": \"llvm-builder-checkpoint\", \"vaettir.final-owner\": planSha256 })}))assert.equal(i.Config.Labels[k],v);assert.deepEqual(i.Config.Env.filter(x=>x.startsWith('PYTHONDONTWRITEBYTECODE=')),['PYTHONDONTWRITEBYTECODE=1']);assert.deepEqual(i.Config.Env.filter(x=>x.startsWith('VAETTIR_FINAL_CONTROL_SHA=')),['VAETTIR_FINAL_CONTROL_SHA='+bounded('${prefix}control-sha',64)]);const h=JSON.parse(bounded('${prefix}recipe-handoff.json',4096)),c=JSON.parse(bounded('${prefix}capsule/control.json',131072));assert.deepEqual(Object.keys(h).sort(),['stage','planSha256','controlSha256','deadlineNs','finalLogSha256','finalReceiptSha256','runtimeAcceptance','authenticatedAcceptance','deploymentAcceptance'].sort());assert.equal(h.stage,'recipe-unverified');assert.equal(h.planSha256,'${planSha256}');assert.equal(h.controlSha256,bounded('${prefix}control-sha',64).toString());assert.equal(h.deadlineNs,c.deadlineNs);assert.match(h.finalLogSha256,/^[a-f0-9]{64}$/);assert.match(h.finalReceiptSha256,/^[a-f0-9]{64}$/);for(const k of ['runtimeAcceptance','authenticatedAcceptance','deploymentAcceptance'])assert.equal(h[k],false);`;"
  ],
  [
    "for(const name of ['image','pre'])",
    "for(const name of ['image','pre','recipe'])"
  ],
  [
    "assert.ok(i.Image==='${identity.expectedParent.imageConfigDigest}'||i.Image===bounded('${prefix}commit-id',80).toString().trim());",
    "const recipe=bounded('${prefix}recipe-cid',64).toString();if(i.Id===recipe){assert.equal(i.Image,'${identity.expectedParent.imageConfigDigest}');}else if(fs.existsSync('${prefix}pre-cid')&&i.Id===bounded('${prefix}pre-cid',64).toString()){assert.equal(i.Image,bounded('${prefix}recipe-image-id',80).toString().trim());}else{assert.equal(i.Id,bounded('${prefix}image-cid',64).toString());assert.equal(i.Image,bounded('${prefix}commit-id',80).toString().trim());}"
  ],
  [
    "//10+20+10+20<=60s for BOTH containers, inside the shared75s grace.",
    "//10+20+10+20<=60s batch cleanup inside the shared75s grace. Recipe\n    // is removed before pre exists, so at most TWO unresolved owned IDs remain."
  ],
  [
    "    `timeout 30s docker create --interactive --cidfile ${prefix}pre-cid --label vaettir.final-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 2048 --memory 14g --cpus 8 --env PYTHONDONTWRITEBYTECODE=1 --env VAETTIR_FINAL_CONTROL_SHA=\"$native_final_control\" --entrypoint node ${parent} -e ${quote(bootstrap(\"pre\"))}`,\n    `native_final_pre=$(timeout 20s node -e ${quote(`${common}process.stdout.write(bounded('${prefix}pre-cid',64).toString());`)})`,\n    `timeout 20s docker inspect \"$native_final_pre\" >${prefix}pre-inspect.json`,\n    `timeout 20s node -e ${quote(containerGuard(\"pre\"))}`,\n    `timeout 20s node -e ${quote(admission)}`,\n    `docker start --attach --interactive \"$native_final_pre\" <${prefix}stdin.json`,\n    'test \"$(timeout 20s docker inspect --format \\'{{.State.ExitCode}}\\' \"$native_final_pre\")\" = 0',\n    `timeout 20s docker cp \"$native_final_pre:${dir}/pre-review.json\" ${prefix}pre-review.json`,",
    "    `timeout 30s docker create --interactive --cidfile ${prefix}recipe-cid --label vaettir.final-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 2048 --memory 14g --cpus 8 --env PYTHONDONTWRITEBYTECODE=1 --env VAETTIR_FINAL_CONTROL_SHA=\"$native_final_control\" --entrypoint node ${parent} -e ${quote(bootstrap(\"recipe\"))}`,\n    `native_final_recipe=$(timeout 20s node -e ${quote(`${common}process.stdout.write(bounded('${prefix}recipe-cid',64).toString());`)})`,\n    `timeout 20s docker inspect \"$native_final_recipe\" >${prefix}recipe-inspect.json`,\n    `timeout 20s node -e ${quote(containerGuard(\"recipe\"))}`,\n    `timeout 20s node -e ${quote(admission)}`,\n    `docker start --attach --interactive \"$native_final_recipe\" <${prefix}stdin.json`,\n    `timeout 20s docker inspect \"$native_final_recipe\" >${prefix}recipe-inspect.json`,\n    `timeout 20s node -e ${quote(containerGuard(\"recipe\", true))}`,\n    `timeout 20s docker cp \"$native_final_recipe:${dir}/recipe-handoff.json\" ${prefix}recipe-handoff.json`,\n    `timeout 60s docker commit --change ${quote(\"LABEL vaettir.continuation-plan=\" + planSha256 + \" vaettir.continuation-phase=final-recipe-unverified\")} \"$native_final_recipe\" >${prefix}recipe-image-id`,\n    `native_final_recipe_image=$(timeout 20s node -e ${quote(`${common}const id=bounded('${prefix}recipe-image-id',80).toString().trim();assert.match(id,/^sha256:[a-f0-9]{64}$/);process.stdout.write(id);`)})`,\n    `timeout 20s docker image inspect \"$native_final_recipe_image\" >${prefix}recipe-image-inspect.json`,\n    `timeout 20s node -e ${quote(recipeImageGuard)}`,\n    \"cleanup_native_validation\",\n    `timeout 20s node -e ${quote(verificationAdmission)}`,\n    `timeout 30s docker create --cidfile ${prefix}pre-cid --label vaettir.final-owner=${planSha256} --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 2048 --memory 14g --cpus 8 --env PYTHONDONTWRITEBYTECODE=1 --env VAETTIR_FINAL_CONTROL_SHA=\"$native_final_control\" --entrypoint node \"$native_final_recipe_image\" -e ${quote(bootstrap(\"pre\"))}`,\n    `native_final_pre=$(timeout 20s node -e ${quote(`${common}process.stdout.write(bounded('${prefix}pre-cid',64).toString());`)})`,\n    `timeout 20s docker inspect \"$native_final_pre\" >${prefix}pre-inspect.json`,\n    `timeout 20s node -e ${quote(containerGuard(\"pre\"))}`,\n    'docker start -a \"$native_final_pre\"',\n    `timeout 20s docker inspect \"$native_final_pre\" >${prefix}pre-inspect.json`,\n    `timeout 20s node -e ${quote(containerGuard(\"pre\", true))}`,\n    `timeout 20s docker cp \"$native_final_pre:${dir}/pre-review.json\" ${prefix}pre-review.json`,"
  ],
  [
    "      writeControl,\n      bootstrapPre:",
    "      writeControl,\n      bootstrapRecipe: bootstrap(\"recipe\"),\n      bootstrapPre:"
  ],
  [
    "      containerGuardPre:",
    "      containerGuardRecipe: containerGuard(\"recipe\"),\n      stoppedContainerGuardRecipe: containerGuard(\"recipe\", true),\n      stoppedContainerGuardPre: containerGuard(\"pre\", true),\n      containerGuardPre:"
  ],
  [
    "      admission,\n      imageGuard,",
    "      admission,\n      verificationAdmission,\n      imageGuard,\n      recipeImageGuard,"
  ]
];
export function reviewedRecipeIsolationTestOverlay(original){
  assert.equal(arguments.length,1);
  assert.ok(Buffer.isBuffer(original));
  assert.equal(sha(original),"3071479df0917cb68829480039e574a72c77bee82ccda2098dde390e1f9ca018");
  let text=original.toString();
  for(const[before,after]of changes){assert.equal(text.split(before).length,2);text=text.replace(before,after);}
  const bytes=Buffer.from(text);
  assert.equal(sha(bytes),"50b83126cb75f29ae5269052e3719eb4ac3a2fef25e3304e3ea283e3acdd389f");
  for(const[before,after]of [...changes].reverse()){assert.equal(text.split(after).length,2);text=text.replace(after,before);}
  assert.equal(text,original.toString());
  return bytes;
}
