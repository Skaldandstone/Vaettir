// Paired validation builds only. No service rollout command.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {root,read,save,sha,aws,sourceGate,noOtherBuilds,noRollouts,service,schedules} from './execution-gates.mjs';
import {mixedStable} from './runtime-checks.mjs';
const mode=process.argv[2];assert.ok(['preflight','upload','start-both'].includes(mode));
const p=sourceGate();
function tagAbsent(){for(const kind of ['api','web']){const r=aws(['ecr','batch-get-image','--repository-name','vaettir-'+kind,'--image-ids','imageTag='+p.commit]);assert.deepEqual(r.images,[]);assert.equal(r.failures.length,1);assert.equal(r.failures[0].failureCode,'ImageNotFound');}}
function uploadChecks(){
  for(const name of ['source.zip','runtime-context.tar.gz','transport-inventory.json']){
    const checksum=Buffer.from(sha(readFileSync(join(root,name))),'hex').toString('base64');
    const h=aws(['s3api','head-object','--bucket',p.bucket,'--key',p.prefix+'/'+name,'--expected-bucket-owner','051722405355','--checksum-mode','ENABLED']);
    assert.equal(h.ChecksumSHA256,checksum);assert.equal(h.ServerSideEncryption,'AES256');assert.equal(h.ContentLength,readFileSync(join(root,name)).length);
  }
}
noOtherBuilds();noRollouts();tagAbsent();
if(mode==='preflight'){
  save('preflight-stable.json',await mixedStable(p.previous.web));
  for(const kind of ['api','web'])save(kind+'-baseline-definition.json',aws(['ecs','describe-task-definition','--task-definition',service(kind).taskDefinition]));
  save('schedule-baseline.json',schedules());
  save('preflight-passed.json',{source:p.commit,apiSource:p.apiSource,at:new Date().toISOString(),validationOnly:true,cloudMutation:false});
}else if(mode==='upload'){
  assert.equal(read('preflight-passed.json').source,p.commit);assert.ok(!existsSync(join(root,'upload-intent.json')));
  assert.deepEqual(schedules(),read('schedule-baseline.json'));save('upload-baseline-stable.json',await mixedStable(p.previous.web));
  // The exact prefix must still be empty. Partial/ambiguous prior attempts require reconciliation.
  const listed=aws(['s3api','list-objects-v2','--bucket',p.bucket,'--prefix',p.prefix+'/','--max-keys','1','--expected-bucket-owner','051722405355']);assert.equal(listed.KeyCount,0);assert.equal(listed.IsTruncated,false);
  save('upload-intent.json',{source:p.commit,prefix:p.prefix,at:new Date().toISOString(),once:true});
  for(const name of ['source.zip','runtime-context.tar.gz','transport-inventory.json']){
    const checksum=Buffer.from(sha(readFileSync(join(root,name))),'hex').toString('base64');
    const ack=aws(['s3api','put-object','--bucket',p.bucket,'--key',p.prefix+'/'+name,'--body',join(root,name),'--if-none-match','*','--expected-bucket-owner','051722405355','--server-side-encryption','AES256','--checksum-algorithm','SHA256','--checksum-sha256',checksum]);
    assert.equal(ack.ChecksumSHA256,checksum);save('uploaded-'+name+'.json',ack);
    const h=aws(['s3api','head-object','--bucket',p.bucket,'--key',p.prefix+'/'+name,'--expected-bucket-owner','051722405355','--checksum-mode','ENABLED']);assert.equal(h.ChecksumSHA256,checksum);assert.equal(h.ServerSideEncryption,'AES256');save('head-'+name+'.json',h);
  }
  uploadChecks();save('upload-verified.json',{source:p.commit,at:new Date().toISOString(),allThreeSha256ReadBack:true,servicesChanged:false});
}else{
  assert.equal(read('upload-verified.json').source,p.commit);assert.equal(read('upload-verified.json').allThreeSha256ReadBack,true);
  assert.ok(!existsSync(join(root,'paired-start-intent.json')));uploadChecks();assert.deepEqual(schedules(),read('schedule-baseline.json'));
  save('prebuild-stable.json',await mixedStable(p.previous.web));
  const requests=Object.fromEntries(['api','web'].map(kind=>[kind,read(kind+'-request.json')]));
  for(const [kind,request] of Object.entries(requests)){assert.equal(request.projectName,'vaettir-'+kind+'-build');assert.equal(request.autoRetryLimitOverride,0);assert.equal(request.sourceLocationOverride,p.bucket+'/'+p.prefix+'/source.zip');assert.ok(!existsSync(join(root,kind+'-start.json')));}
  save('paired-start-intent.json',{at:new Date().toISOString(),source:p.commit,once:true,requestHashes:Object.fromEntries(['api','web'].map(k=>[k,sha(readFileSync(join(root,k+'-request.json')))]))});
  for(const kind of ['api','web']){
    // Once the paired intent exists, an ambiguous acknowledgement stops the pair; no automatic retry.
    save(kind+'-start-intent.json',{source:p.commit,requestSha256:sha(readFileSync(join(root,kind+'-request.json'))),once:true});
    const ack=aws(['codebuild','start-build','--cli-input-json','file://'+join(root,kind+'-request.json'),'--query','build.{id:id,arn:arn,status:buildStatus,started:startTime,source:source.location}']);
    save(kind+'-start.json',ack);
  }
}
console.log(JSON.stringify({mode,source:p.commit,requestedBuildKinds:p.authorizedBuildKinds,servicesChanged:false}));
