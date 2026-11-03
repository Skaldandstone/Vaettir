// Run only inside the exact candidate API image on the owned synthetic PG16 network.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prisma,Prisma} from '@vaettir/db';
import {beginAtlassian,requireAtlassianVerified,publicAtlassian,eraseAtlassianPersonalData} from './dist/services/atlassianOAuthConnection.js';
const url=new URL(process.env.DATABASE_URL??'');
assert.equal(url.hostname,'vaettir-review110-images-bbd66d00-20261102-pg');assert.ok(['/vaettir_case_review110_runtime_normal','/vaettir_case_review110_runtime_disabled','/vaettir_case_review110_runtime_unknown'].includes(url.pathname));assert.equal(url.username,'oauth_test');
assert.ok(!process.env.ATLASSIAN_OAUTH_CLIENT_ID&&!process.env.ATLASSIAN_OAUTH_CLIENT_SECRET&&!process.env.CLERK_SECRET_KEY&&!process.env.DB_SECRET_ID);
let fetchCalls=0;globalThis.fetch=async()=>{fetchCalls++;throw Error('External provider calls prohibited in synthetic compiled-image proof');};
const fresh={status:'VERIFIED',tokenExpiresAt:new Date(Date.now()+3600000),encryptedToken:{synthetic:true},privacyCheckedAt:new Date(),privacyCycleDays:7};
assert.doesNotThrow(()=>requireAtlassianVerified(fresh));
for(const delta of [{privacyCheckedAt:null},{privacyCycleDays:null},{privacyCheckedAt:new Date(Date.now()-8*86400000)},{encryptedToken:null},{status:'DISCONNECTED'}])assert.throws(()=>requireAtlassianVerified({...fresh,...delta}),e=>e.code==='PRECONDITION_FAILED');
const fields=Prisma.dmmf.datamodel.models.find(m=>m.name==='AtlassianOAuthConnection').fields;
for(const name of ['privacyCheckedAt','privacyDueAt','privacyCycleDays','privacyAccountKey','privacyClaimId'])assert.ok(fields.some(f=>f.name===name));
const tag='compiled-privacy-'+randomUUID();let fixture;
const legacy=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{requestKey:'synthetic-upgrade-oauth'}});
assert.equal(legacy.accountId,'synthetic-provider-account');
await prisma.$transaction(tx=>eraseAtlassianPersonalData(tx,legacy.id));
try{
 fixture=await prisma.$transaction(async tx=>{
  const tier=await tx.planTier.findUniqueOrThrow({where:{key:'free'}});
  const org=await tx.organization.create({data:{name:tag,slug:tag,planTierId:tier.id}});
  const user=await tx.user.create({data:{clerkUserId:tag,email:tag+'@example.invalid',memberships:{create:{organizationId:org.id,role:'OWNER',seatType:'FULL'}}}});
  const project=await tx.project.create({data:{organizationId:org.id,name:tag,slug:tag}});
  const scope={projectId:project.id,organizationId:org.id,actorId:user.id};
  const row=await tx.atlassianOAuthConnection.create({data:{...scope,clerkActorId:tag,product:'jira',requestKey:tag,stateHash:tag,encryptedApplication:{syntheticPrivate:'application-marker'},encryptedState:{syntheticPrivate:'state-marker'},encryptedToken:{syntheticPrivate:'token-marker'},status:'DISCONNECTED',authorizationExpiresAt:new Date(Date.now()+300000),tokenExpiresAt:new Date(Date.now()+3600000),accountId:tag,accountName:'Synthetic compiled image account',catalog:{syntheticPrivate:'catalog-marker'},privacyAccountKey:tag,privacyClaimId:tag,privacyDueAt:new Date(Date.now()+86400000),privacyCheckedAt:new Date(),privacyCycleDays:7}});
  const linked=await tx.ticketSourceConnection.create({data:{...scope,oauthConnectionId:row.id,provider:'jira',providerOrigin:'https://synthetic.atlassian.net',requestKey:tag,requestHash:tag,status:'DISCONNECTED',encryptedToken:{syntheticPrivate:'linked-token-marker'},authorizationExpiresAt:new Date(Date.now()+300000),tokenExpiresAt:new Date(Date.now()+3600000),catalog:{syntheticPrivate:'linked-catalog-marker'},catalogAt:new Date()}});
  const publicRow=publicAtlassian(row);assert.ok(!/application-marker|state-marker|token-marker|catalog-marker|encrypted|ciphertext|accountId/.test(JSON.stringify(publicRow)));
  await eraseAtlassianPersonalData(tx,row.id);
  const erased=await tx.atlassianOAuthConnection.findUniqueOrThrow({where:{id:row.id}});
  assert.equal(erased.status,'DISCONNECTED');assert.deepEqual(erased.encryptedApplication,{});
  for(const key of ['operationId','encryptedState','encryptedToken','tokenExpiresAt','accountId','accountName','catalog','privacyDueAt','privacyAccountKey','privacyClaimId'])assert.equal(erased[key],null,key);
  const revoked=await tx.ticketSourceConnection.findUniqueOrThrow({where:{id:linked.id}});
  for(const key of ['encryptedToken','tokenExpiresAt','catalog','catalogAt'])assert.equal(revoked[key],null,key);
  assert.equal(revoked.status,'DISCONNECTED');
  return {projectId:project.id,userId:user.id,organizationId:org.id,connectionId:row.id};
 });
 await assert.rejects(()=>beginAtlassian({prisma,user:{id:fixture.userId,clerkUserId:tag},authenticatedClerkSubject:tag,authenticatedApiKeyId:null,workspaceOrganizationId:fixture.organizationId},{projectId:fixture.projectId,originalOrganizationId:fixture.organizationId,expectedClerkActorId:tag,product:'jira',requestId:randomUUID()}),e=>e.code==='PRECONDITION_FAILED'&&e.message==='Atlassian connection setup is required.');
 assert.equal(fetchCalls,0);
 console.log('VAETTIR_COMPILED_PRIVACY_PROOF '+JSON.stringify({passed:true,unboundCustomerOAuthDenied:true,missingOrStalePrivacyDenied:true,fiveGeneratedPrivacyFields:true,actualTransactionalErasureAndLinkedCredentialClear:true,publicStatusOmitsSecrets:true,externalProviderCalls:fetchCalls,onlySyntheticOwnedDatabase:true,retainedFixture:fixture}));
}finally{await prisma.$disconnect();}
