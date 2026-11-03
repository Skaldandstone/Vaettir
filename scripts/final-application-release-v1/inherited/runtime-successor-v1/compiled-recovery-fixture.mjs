// Only executed inside exact immutable candidate image and owned internal synthetic fixture.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {prisma} from '@vaettir/db';
import {complianceRouter} from './dist/routers/compliance.js';
import {testPlansRouter} from './dist/routers/testPlans.js';
import {testCasesRouter} from './dist/routers/testCases.js';
const u=new URL(process.env.DATABASE_URL??'');assert.equal(u.hostname,'vaettir-review110-images-bbd66d00-20261102-pg');assert.ok(['/vaettir_case_review110_runtime_disabled','/vaettir_case_review110_runtime_unknown'].includes(u.pathname));assert.equal(u.username,'oauth_test');
const originalMode=process.env.VAETTIR_COMPLIANCE_RECOVERY_MODE;assert.ok(['disabled','invalid-nonempty-setting'].includes(originalMode));assert.ok(!process.env.DB_SECRET_ID&&!process.env.CLERK_SECRET_KEY&&!process.env.ATLASSIAN_OAUTH_CLIENT_ID&&!process.env.ATLASSIAN_OAUTH_CLIENT_SECRET);
let calls=0;globalThis.fetch=async()=>{calls++;throw Error('External calls forbidden')};
try{
 const user=await prisma.user.findUniqueOrThrow({where:{clerkUserId:'synthetic-upgrade-actor'},include:{memberships:true}});const originalOrg=await prisma.organization.findUniqueOrThrow({where:{slug:'synthetic-upgrade'}});const project=await prisma.project.findUniqueOrThrow({where:{organizationId_slug:{organizationId:originalOrg.id,slug:'synthetic-upgrade-project'}}});const key='recovery-'+randomUUID();
 const other=await prisma.organization.create({data:{name:key,slug:key,planTierId:(await prisma.planTier.findUniqueOrThrow({where:{key:'free'}})).id}});
 for(const [index,organizationId]of [project.organizationId,other.id].entries())await prisma.complianceFramework.create({data:{organizationId,key:key+'-'+index,name:'Synthetic private recovery reference '+index,controls:{create:{code:'RECOVERY',title:'Synthetic retained private criterion'}}}});
 const ctx={prisma,user,authenticatedClerkSubject:user.clerkUserId,workspaceOrganizationId:project.organizationId,staff:null};const caller=complianceRouter.createCaller(ctx);const routes=Object.keys(complianceRouter._def.procedures);assert.equal(routes.length,25);
 const snapshot=async()=>JSON.stringify({frameworks:await prisma.complianceFramework.findMany({orderBy:{id:'asc'}}),controls:await prisma.complianceControl.findMany({orderBy:{id:'asc'}}),drafts:await prisma.complianceReviewDraft.findMany({orderBy:{id:'asc'}}),cases:await prisma.testCase.findMany({orderBy:{id:'asc'}}),links:await prisma.testCaseComplianceControl.findMany({orderBy:[{testCaseId:'asc'},{controlId:'asc'}]})});const before=await snapshot();
 for(const value of ['disabled','invalid-nonempty-setting']){
  process.env.VAETTIR_COMPLIANCE_RECOVERY_MODE=value;
  for(const route of routes)await assert.rejects(caller[route](),e=>e.code==='PRECONDITION_FAILED',route);
  await assert.rejects(testPlansRouter.createCaller(ctx).suggestRiskAreas({projectId:project.id}),e=>e.code==='PRECONDITION_FAILED');
 }
 process.env.VAETTIR_COMPLIANCE_RECOVERY_MODE=originalMode;
 const cases=await testCasesRouter.createCaller(ctx).list({projectId:project.id});assert.ok(cases.some(c=>c.title==='Synthetic legacy case preservation'));
 assert.equal(await snapshot(),before);assert.equal(calls,0);
 console.log('VAETTIR_COMPILED_RECOVERY_PROOF '+JSON.stringify({passed:true,explicitDisabledEnvironment:true,all25ComplianceRoutesRefused:true,testPlanRiskRefused:true,unknownNonemptySettingFailsClosed:true,tenantOwnedDefinitionsRetained:true,allBeforeAndAfterRecordsExact:true,authorizedOrdinaryCasesStillReadable:true,recordsSha256:createHash('sha256').update(before).digest('hex'),externalCalls:calls}));
}finally{await prisma.$disconnect();}
