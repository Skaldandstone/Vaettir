import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { router,protectedProcedure,requireProjectAccess,requireOrgRole,type Context } from "../trpc.js";
import { encryptToken,decryptToken,type EncryptedToken } from "../services/tokenEncryption.js";
import { repositoryProviderOrigin } from "../services/repositoryProviderHttp.js";
import { GitlabOAuthRevocationPendingError,createGitlabAuthorization,gitlabRepositoryScopeSchema,hashOAuthState,listGitlabGroups,listGitlabRepositories,repositoryOAuthRedirect,repositorySelectionSchema,revokeGitlabAuthorization,verifyGitlabAuthorization,verifyGitlabAccessToken } from "../services/gitlabRepositoryOAuth.js";
import { GITHUB_ORIGIN, GithubOAuthRevocationPendingError, createGithubAuthorization, listGithubRepositories, revokeGithubAuthorization, verifyGithubAuthorization } from "../services/githubRepositoryOAuth.js";
import { verifyBitbucketAuthorization, listBitbucketRepositories } from "../services/bitbucketRepositoryConnection.js";
import { azureOrganizationUrl, listAzureRepositories } from "../services/azureRepositoryConnection.js";
import {availablePlatformRepositoryConfigurations,platformRepositoryApplication,platformRepositoryProvider,platformGithubRepositoryApp,publicGithubAppConfiguration} from "../services/platformRepositoryOAuth.js";
import {githubInstallationIdSchema,githubRepositoryAppSecretSchema,githubRepositoryAppInstallationUrl,createGithubAppRepositoryAuthorization,verifyGithubAppRepositoryAuthorization,listGithubAppInstallations,listGithubAppInstallationRepositories} from "../services/githubAppRepositoryConnection.js";
import { lockCaseFieldProject } from "../services/caseFields.js";
import { lockCurrentCaseFieldActor } from "../services/caseFieldReadScope.js";

const projectInput=z.object({projectId:z.string()});
const jsonToken=(value:ReturnType<typeof encryptToken>)=>({...value});
const decrypt=(value:unknown)=>decryptToken(z.object({ciphertext:z.string(),iv:z.string(),authTag:z.string()}).parse(value) as EncryptedToken);
const configurationProvider=(provider:string)=>provider==="github"?{in:["github","github-app"]}:provider;
function applicationCredentials(config:{clientId:string;provider:string;encryptedSecret:unknown}){
  const secret=decrypt(config.encryptedSecret);
  return{clientId:config.clientId,clientSecret:config.provider==="github-app"?githubRepositoryAppSecretSchema.parse(JSON.parse(secret)).clientSecret:secret};
}
function repositoryApp(config:{provider:string;encryptedSecret:unknown}|null){
  return config?.provider==="github-app"?githubRepositoryAppSecretSchema.parse(JSON.parse(decrypt(config.encryptedSecret))):null;
}
async function connectionDescriptor(ctx:Context,row:{provider:string;configurationId:string|null;encryptedVerifier:unknown;organizationId:string}){
  const config=row.provider==="github"&&row.configurationId?await ctx.prisma.repositoryProviderConfiguration.findFirst({where:{id:row.configurationId,organizationId:row.organizationId,provider:configurationProvider(row.provider)}}):null;
  const app=repositoryApp(config);
  return{authorizationKind:app?"github-app" as const:connectionAccessMethod(row),installationUrl:app?githubRepositoryAppInstallationUrl(app):null};
}
type RevocableGrant={provider:string;origin:string;clientId:string;clientSecret:string;token:string};
async function revokeGrant(grant:RevocableGrant){
  const {clientId,clientSecret,token}=grant;
  if(grant.provider==="github")return revokeGithubAuthorization({clientId,clientSecret,token});
  if(grant.provider==="gitlab")return revokeGitlabAuthorization({origin:grant.origin,clientId,clientSecret,token});
  throw new Error("This provider has no revocation adapter");
}
const unavailable=()=>new TRPCError({code:"PRECONDITION_FAILED",message:"Repository authorization is not available on this Vaettir installation. Platform setup is required before a workspace can connect."});
function credentialStorageReady(){try{encryptToken("configuration-check");return true;}catch{return false;}}
function callbackReady(){try{repositoryOAuthRedirect();repositoryOAuthRedirect(process.env,"github");return true;}catch{return false;}}
function encryptionReady(){return credentialStorageReady() && callbackReady();}
function redirectUri(provider:"gitlab"|"github"="gitlab"){try{return repositoryOAuthRedirect(process.env,provider);}catch{return null;}}
// Same organization lock used by membership/seat changes. Never keep it across provider I/O.
async function liveEditor(tx:Prisma.TransactionClient,organizationId:string,userId:string,admin=false){
  const rows=await tx.$queryRaw<Array<{suspendedAt:Date|null}>>`SELECT "suspendedAt" FROM "Organization" WHERE "id"=${organizationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR UPDATE`;
  const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId,userId}}});
  if(!rows[0] || rows[0].suspendedAt || !member || member.seatType!=="FULL" || !(admin?["OWNER","ADMIN"]:["OWNER","ADMIN","EDITOR"]).includes(member.role))throw new TRPCError({code:"FORBIDDEN",message:"Your workspace permissions changed. Refresh and try again."});
}
/** New GitLab token writes use the existing project/actor lock order. The
 * project helper already checks current FULL-editor membership/suspension;
 * never upgrade its organization SHARE lock through liveEditor afterward. */
async function liveGitlabTokenEditor(tx:Prisma.TransactionClient,userId:string,projectId:string,organizationId:string,clerkActorId:string){
  await lockCaseFieldProject(tx,userId,projectId);
  await lockCurrentCaseFieldActor(tx,userId,{clerkActorId});
  const current=await tx.project.findUniqueOrThrow({where:{id:projectId},select:{organizationId:true}});
  if(current.organizationId!==organizationId)throw new TRPCError({code:"FORBIDDEN",message:"Restore the original workspace before verifying GitLab access. No credential was saved."});
}
async function liveRepositoryAppEditor(tx:Prisma.TransactionClient,ctx:Context,row:{projectId:string;organizationId:string;actorId:string}){
  const user=ctx.user;
  if(!user||!ctx.authenticatedClerkSubject||user.clerkUserId!==ctx.authenticatedClerkSubject||row.actorId!==user.id)
    throw new TRPCError({code:"FORBIDDEN",message:"Restore the original signed-in actor before using this repository connection."});
  await lockCaseFieldProject(tx,user.id,row.projectId);
  await lockCurrentCaseFieldActor(tx,user.id,{clerkActorId:ctx.authenticatedClerkSubject});
  const current=await tx.project.findUniqueOrThrow({where:{id:row.projectId},select:{organizationId:true}});
  if(current.organizationId!==row.organizationId)throw new TRPCError({code:"FORBIDDEN",message:"The project workspace changed. No repository access was admitted."});
}
const clearCredentials={encryptedToken:Prisma.DbNull,encryptedVerifier:Prisma.DbNull,catalog:Prisma.DbNull,catalogAt:null,tokenExpiresAt:null,verifiedAt:null};
const gitlabAccessTokenMarker=z.object({accessMethod:z.literal("gitlab-token/v1"),requestHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
function connectionAccessMethod(row:{provider:string;configurationId:string|null;encryptedVerifier:unknown}):"token"|"oauth"|"unavailable"{
  if(["bitbucket","azure-devops"].includes(row.provider))return "token";
  if(row.provider!=="gitlab")return row.provider==="github"&&!!row.configurationId?"oauth":"unavailable";
  if(gitlabAccessTokenMarker.safeParse(row.encryptedVerifier).success)return row.configurationId===null?"token":"unavailable";
  if(row.encryptedVerifier && typeof row.encryptedVerifier==="object" && Object.hasOwn(row.encryptedVerifier,"accessMethod"))return "unavailable";
  return row.configurationId?"oauth":"unavailable";
}
// PostgreSQL JSONB reorders object keys. Hash a canonical field tuple, not raw JSON.
const catalogVersion=(catalog:unknown,connectionId:string,catalogAt:Date)=>hashOAuthState(JSON.stringify([
  connectionId,catalogAt.toISOString(),z.array(repositorySelectionSchema).parse(catalog).map(repo=>[repo.id,repo.name,repo.url,repo.defaultBranch,...(repo.scopeKey||repo.projectId||repo.projectName?[repo.scopeKey??null,repo.projectId??null,repo.projectName??null]:[])]),
]));
async function editor(ctx:Context,projectId:string){
  if(!ctx.user)throw new TRPCError({code:"UNAUTHORIZED"});
  const access=await requireProjectAccess({...ctx,user:ctx.user},projectId,"EDITOR");
  if(access.membership.seatType!=="FULL")throw new TRPCError({code:"FORBIDDEN",message:"A full editor seat is required."});
  return access;
}
async function ownConnection(ctx:Context,id:string){
  const row=await ctx.prisma.repositoryConnection.findFirst({where:{id,actorId:ctx.user?.id}});
  if(!row)throw new TRPCError({code:"NOT_FOUND"});
  await editor(ctx,row.projectId);
  return row;
}
async function disconnectableConnection(ctx:Context,id:string){
  const row=await ctx.prisma.repositoryConnection.findUnique({where:{id}});
  if(!row)throw new TRPCError({code:"NOT_FOUND"});
  if(row.actorId===ctx.user!.id){await editor(ctx,row.projectId);return row;}
  try{
    const {project}=await editor(ctx,row.projectId);
    requireOrgRole({...ctx,user:ctx.user!},project.organizationId,"ADMIN");
  }catch{throw new TRPCError({code:"NOT_FOUND"});}
  return row;
}
function requireVerified(row:{status:string;tokenExpiresAt:Date|null;encryptedToken:unknown;provider:string;configurationId:string|null;encryptedVerifier:unknown}){
  if(row.status!=="VERIFIED" || !row.encryptedToken || !row.tokenExpiresAt || row.tokenExpiresAt.getTime()<=Date.now()+30000)
    throw new TRPCError({code:"PRECONDITION_FAILED",message:"Reconnect to verify current repository access."});
  if(row.provider==="gitlab" && connectionAccessMethod(row)==="unavailable")throw new TRPCError({code:"PRECONDITION_FAILED",message:"This GitLab access method is unavailable. No credential was used or removed."});
}
function publicStatus(row:{status:string;authorizationExpiresAt:Date;tokenExpiresAt:Date|null}){
  const expired=(row.status==="VERIFIED" && (!row.tokenExpiresAt || row.tokenExpiresAt.getTime()<=Date.now()+30000)) || (["PENDING","VERIFYING"].includes(row.status) && row.authorizationExpiresAt.getTime()<=Date.now());
  return expired?"EXPIRED":row.status;
}
const tokenCredentials=z.object({token:z.string().min(1).max(10000),email:z.string().max(320),workspace:z.string().max(100)});
async function tokenRepositories(provider:string,origin:string,credentials:z.infer<typeof tokenCredentials>,page:number,search:string){
  if(provider==="bitbucket")return listBitbucketRepositories({...credentials,page,search});
  if(provider==="azure-devops")return listAzureRepositories(origin,credentials.token,page,search);
  if(provider==="gitlab"){const repositories=await listGitlabRepositories(origin,credentials.token,page,search);return{repositories,hasMore:repositories.length===100};}
  throw new Error("This provider has no token adapter");
}
export const repositoryConnectionsRouter=router({
  connectToken:protectedProcedure.input(projectInput.extend({
    provider:z.enum(["bitbucket","azure-devops","gitlab"]),requestId:z.string().uuid(),
    token:z.string().min(1).max(10000),email:z.string().trim().max(320).default(""),
    workspace:z.string().trim().max(100).default(""),organizationUrl:z.string().max(300).default(""),
    instanceUrl:z.string().max(300).default(""),originalOrganizationId:z.string().min(1).max(200).optional(),expectedClerkActorId:z.string().min(1).max(200).optional(),
    approveMetadataAccess:z.literal(true),
  })).mutation(async({ctx,input})=>{
    const {project}=await editor(ctx,input.projectId);
    if(input.provider==="gitlab" && (input.originalOrganizationId!==project.organizationId || !ctx.authenticatedClerkSubject || input.expectedClerkActorId!==ctx.authenticatedClerkSubject || ctx.user.clerkUserId!==ctx.authenticatedClerkSubject))throw new TRPCError({code:"FORBIDDEN",message:"Restore the original workspace and signed-in actor before verifying GitLab access."});
    const acknowledge=(connection:{id:string;accountLabel:string|null})=>({id:connection.id,accountLabel:connection.accountLabel,...(input.provider==="gitlab"?{requestId:input.requestId,projectId:input.projectId,originalOrganizationId:project.organizationId,expectedClerkActorId:ctx.user.clerkUserId}:{})});
    if(!credentialStorageReady())throw unavailable();
    let origin:string;
    try{
      if(input.provider==="bitbucket"){
        z.string().email().parse(input.email);z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/).parse(input.workspace);
        origin="https://bitbucket.org";
      }else if(input.provider==="gitlab")origin=repositoryProviderOrigin(input.instanceUrl);
      else origin=azureOrganizationUrl(input.organizationUrl).url;
    }catch{throw new TRPCError({code:"BAD_REQUEST",message:"Check the workspace, account email or provider HTTPS instance URL."});}
    const requestHash=hashOAuthState(JSON.stringify([input.provider,origin,input.token,input.email,input.workspace,...(input.provider==="gitlab"?[input.originalOrganizationId,input.expectedClerkActorId]:[])]));
    const stateHash=hashOAuthState(JSON.stringify([ctx.user.id,input.projectId,input.requestId]));
    const row=await ctx.prisma.$transaction(async tx=>{
      if(input.provider==="gitlab")await liveGitlabTokenEditor(tx,ctx.user.id,input.projectId,input.originalOrganizationId!,ctx.authenticatedClerkSubject!);
      else await liveEditor(tx,project.organizationId,ctx.user.id);
      const prior=await tx.repositoryConnection.findUnique({where:{stateHash}});
      if(prior){
        if(z.object({requestHash:z.string()}).safeParse(prior.encryptedVerifier).data?.requestHash!==requestHash)
          throw new TRPCError({code:"CONFLICT",message:"This verification request changed. Start a new attempt."});
        if(input.provider==="gitlab" && (connectionAccessMethod(prior)!=="token" || prior.provider!=="gitlab" || prior.origin!==origin || prior.projectId!==input.projectId || prior.organizationId!==project.organizationId || prior.actorId!==ctx.user.id))throw new TRPCError({code:"CONFLICT",message:"This GitLab verification request has a different original scope or access method."});
        if(prior.status==="VERIFIED")return prior;
        throw new TRPCError({code:"PRECONDITION_FAILED",message:prior.status==="VERIFYING"?"Verification is still running. Retry this request shortly.":"Start a new verification attempt."});
      }
      const recent=await tx.repositoryConnection.count({where:{actorId:ctx.user.id,createdAt:{gt:new Date(Date.now()-3600000)}}});
      if(recent>=20)throw new TRPCError({code:"TOO_MANY_REQUESTS",message:"Too many connection attempts. Try again later."});
      const active=await tx.repositoryConnection.count({where:{projectId:input.projectId,actorId:ctx.user.id,provider:input.provider,origin,status:{in:["VERIFYING","VERIFIED"]},tokenExpiresAt:{gt:new Date()}}});
      if(active)throw new TRPCError({code:"CONFLICT",message:"Resume or remove your existing saved access before reconnecting."});
      return tx.repositoryConnection.create({data:{projectId:input.projectId,organizationId:project.organizationId,actorId:ctx.user.id,provider:input.provider,origin,stateHash,status:"VERIFYING",encryptedVerifier:input.provider==="gitlab"?{accessMethod:"gitlab-token/v1",requestHash}:{requestHash},authorizationExpiresAt:new Date(Date.now()+600000),tokenExpiresAt:new Date(Date.now()+28800000)}});
    });
    if(row.status==="VERIFIED")return acknowledge(row);
    try{
      const credentials={token:input.token,email:input.email,workspace:input.workspace};
      const accountLabel=input.provider==="bitbucket"?(await verifyBitbucketAuthorization(credentials)).accountLabel:input.provider==="gitlab"?(await verifyGitlabAccessToken({origin,token:input.token})).accountLabel:azureOrganizationUrl(origin).organization;
      const listing=await tokenRepositories(input.provider,origin,credentials,1,"");
      const catalog=z.array(repositorySelectionSchema).max(100).parse(listing.repositories);
      await ctx.prisma.$transaction(async tx=>{
        if(input.provider==="gitlab")await liveGitlabTokenEditor(tx,ctx.user.id,input.projectId,input.originalOrganizationId!,ctx.authenticatedClerkSubject!);
        else await liveEditor(tx,project.organizationId,ctx.user.id);
        const saved=await tx.repositoryConnection.updateMany({where:{id:row.id,status:"VERIFYING",authorizationExpiresAt:{gt:new Date()}},data:{status:"VERIFIED",encryptedToken:jsonToken(encryptToken(input.provider==="gitlab"?input.token:JSON.stringify(credentials))),accountLabel,verifiedAt:new Date(),catalog,catalogAt:new Date()}});
        if(saved.count!==1)throw new Error("Connection changed");
      });
      return acknowledge({id:row.id,accountLabel});
    }catch{
      await ctx.prisma.repositoryConnection.updateMany({where:{id:row.id,status:"VERIFYING"},data:{...clearCredentials,...(input.provider==="gitlab"?{encryptedVerifier:gitlabAccessTokenMarker.parse(row.encryptedVerifier)}:{}),status:"FAILED"}});
      throw new TRPCError({code:"BAD_REQUEST",message:"Provider access could not be verified. Check the read-only token, workspace and account permissions."});
    }
  }),
  forgetToken:protectedProcedure.input(z.object({id:z.string(),confirmed:z.literal(true)})).mutation(async({ctx,input})=>{
    const row=await disconnectableConnection(ctx,input.id);
    if(!["bitbucket","azure-devops"].includes(row.provider) && !(row.provider==="gitlab"&&connectionAccessMethod(row)==="token"))throw new TRPCError({code:"BAD_REQUEST",message:"Use provider revocation for this authorization. Unmarked GitLab access cannot be removed as a token."});
    await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,row.organizationId,ctx.user.id,row.actorId!==ctx.user.id);
      await tx.$queryRaw`SELECT id FROM "RepositoryConnection" WHERE id = ${row.id} FOR UPDATE`;
      const current=await tx.repositoryConnection.findUniqueOrThrow({where:{id:row.id}});
      if(row.provider==="gitlab" && (current.provider!=="gitlab" || connectionAccessMethod(current)!=="token"))throw new TRPCError({code:"CONFLICT",message:"The GitLab access method changed. No credential was removed."});
      if(current.status==="VERIFYING"&&current.authorizationExpiresAt.getTime()>Date.now())throw new TRPCError({code:"PRECONDITION_FAILED",message:"Wait for verification to finish before removing saved access."});
      await tx.repositoryConnection.update({where:{id:row.id},data:{...clearCredentials,...(row.provider==="gitlab"?{encryptedVerifier:gitlabAccessTokenMarker.parse(current.encryptedVerifier)}:{}),status:"DISCONNECTED"}});
      await tx.projectRepository.updateMany({where:{connectionId:row.id},data:{connectionId:null,verifiedAt:null}});
    });
    return{removed:true,providerRevocationRequired:true};
  }),
  mine:protectedProcedure.input(projectInput).query(async({ctx,input})=>{
    await editor(ctx,input.projectId);
    const rows=await ctx.prisma.repositoryConnection.findMany({where:{projectId:input.projectId,actorId:ctx.user.id,status:{in:["PENDING","VERIFYING","VERIFIED","REVOCATION_PENDING"]}},orderBy:{createdAt:"desc"},take:20,select:{id:true,provider:true,origin:true,status:true,accountLabel:true,authorizationExpiresAt:true,tokenExpiresAt:true,configurationId:true,encryptedVerifier:true,organizationId:true}});
    return Promise.all(rows.map(async row=>({id:row.id,provider:row.provider,origin:row.origin,status:publicStatus(row),accountLabel:row.accountLabel,accessMethod:connectionAccessMethod(row),...await connectionDescriptor(ctx,row)})));
  }),
  configurations:protectedProcedure.input(projectInput).query(async({ctx,input})=>{
    const {project,membership}=await requireProjectAccess(ctx,input.projectId);
    const configurations=await ctx.prisma.repositoryProviderConfiguration.findMany({where:{organizationId:project.organizationId},select:{id:true,provider:true,origin:true,encryptedSecret:true}});
    const storageReady=credentialStorageReady();
    const redirectReady=callbackReady();
    const visibleConfigurations=[...configurations.map(row=>row.provider==="github-app"?publicGithubAppConfiguration(row,JSON.parse(decrypt(row.encryptedSecret))):{id:row.id,provider:row.provider,origin:row.origin}),...availablePlatformRepositoryConfigurations(configurations,storageReady&&redirectReady)].map(row=>({...row,authorizationKind:"authorizationKind" in row&&row.authorizationKind==="github-app"?"github-app" as const:undefined,installationUrl:"installationUrl" in row&&typeof row.installationUrl==="string"?row.installationUrl:undefined}));
    return{organizationId:project.organizationId,configurations:visibleConfigurations,storageReady:storageReady && redirectReady,credentialStorageReady:storageReady,callbackReady:redirectReady,canConnect:membership.seatType==="FULL" && ["OWNER","ADMIN","EDITOR"].includes(membership.role),canConfigure:membership.seatType==="FULL" && ["OWNER","ADMIN"].includes(membership.role),redirectUri:redirectUri(),githubRedirectUri:redirectUri("github")};
  }),
  revocableGrants:protectedProcedure.input(projectInput.extend({provider:z.enum(["github","gitlab"])})).query(async({ctx,input})=>{
    const {project}=await editor(ctx,input.projectId);requireOrgRole(ctx,project.organizationId,"ADMIN");
    const rows=await ctx.prisma.repositoryConnection.findMany({where:{organizationId:project.organizationId,provider:input.provider,configurationId:{not:null},OR:[{encryptedToken:{not:Prisma.DbNull}},{status:{in:["PENDING","VERIFYING"]}}]},orderBy:{createdAt:"desc"},take:100,select:{id:true,projectId:true,project:{select:{name:true}},accountLabel:true,status:true,origin:true,provider:true,configurationId:true,encryptedVerifier:true}});
    return rows.filter(row=>connectionAccessMethod(row)==="oauth").map(row=>({id:row.id,projectId:row.projectId,projectName:row.project.name,accountLabel:row.accountLabel,status:row.status,origin:row.origin}));
  }),
  configureGitlab:protectedProcedure.input(projectInput.extend({origin:z.string().max(300),clientId:z.string().trim().min(1).max(300),clientSecret:z.string().min(1).max(2000)})).mutation(async({ctx,input})=>{
    const {project}=await editor(ctx,input.projectId);
    requireOrgRole(ctx,project.organizationId,"ADMIN");
    if(!encryptionReady())throw unavailable();
    let origin:string;try{origin=repositoryProviderOrigin(input.origin);}catch{throw new TRPCError({code:"BAD_REQUEST",message:"Use a public HTTPS provider hostname without a path."});}
    const encryptedSecret=jsonToken(encryptToken(input.clientSecret));
    // Existing credentials are never silently replaced. A new instance needs its own app.
    const existing=await ctx.prisma.repositoryProviderConfiguration.findUnique({where:{organizationId_provider_origin:{organizationId:project.organizationId,provider:"gitlab",origin}}});
    if(existing)throw new TRPCError({code:"CONFLICT",message:"This instance is already configured. Contact your admin to rotate its application credentials."});
    return ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,project.organizationId,ctx.user.id,true);
      return tx.repositoryProviderConfiguration.create({data:{organizationId:project.organizationId,provider:"gitlab",origin,clientId:input.clientId,encryptedSecret,createdById:ctx.user.id},select:{id:true,origin:true,provider:true}});
    });
  }),
  configureGithub:protectedProcedure.input(projectInput.extend({clientId:z.string().trim().min(1).max(300),clientSecret:z.string().min(1).max(2000)})).mutation(async({ctx,input})=>{
    const {project}=await editor(ctx,input.projectId);
    requireOrgRole(ctx,project.organizationId,"ADMIN");
    if(!encryptionReady())throw unavailable();
    const encryptedSecret=jsonToken(encryptToken(input.clientSecret));
    const existing=await ctx.prisma.repositoryProviderConfiguration.findUnique({where:{organizationId_provider_origin:{organizationId:project.organizationId,provider:"github",origin:GITHUB_ORIGIN}}});
    if(existing)throw new TRPCError({code:"CONFLICT",message:"GitHub is already configured. Contact your admin to rotate its application credentials."});
    return ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,project.organizationId,ctx.user.id,true);
      return tx.repositoryProviderConfiguration.create({data:{organizationId:project.organizationId,provider:"github",origin:GITHUB_ORIGIN,clientId:input.clientId,encryptedSecret,createdById:ctx.user.id},select:{id:true,origin:true,provider:true}});
    });
  }),
  removeConfiguration:protectedProcedure.input(projectInput.extend({configurationId:z.string(),confirmed:z.literal(true)})).mutation(async({ctx,input})=>{
    const {project}=await editor(ctx,input.projectId);requireOrgRole(ctx,project.organizationId,"ADMIN");
    await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,project.organizationId,ctx.user.id,true);
      const config=await tx.repositoryProviderConfiguration.findFirst({where:{id:input.configurationId,organizationId:project.organizationId}});
      if(!config)throw new TRPCError({code:"NOT_FOUND"});
      const authorizing=await tx.repositoryConnection.count({where:{configurationId:config.id,status:{in:["PENDING","VERIFYING"]}}});
      if(authorizing)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Finish or cancel in-progress authorizations before removing this application."});
      const outstanding=await tx.repositoryConnection.count({where:{configurationId:config.id,encryptedToken:{not:Prisma.DbNull}}});
      if(outstanding)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Revoke every provider grant before removing this application. No credentials were discarded."});
      await tx.projectRepository.updateMany({where:{connection:{configurationId:config.id}},data:{connectionId:null,verifiedAt:null}});
      await tx.repositoryProviderConfiguration.delete({where:{id:config.id}});
    });
    return{removed:true};
  }),
  begin:protectedProcedure.input(projectInput.extend({configurationId:z.string(),approveMetadataAccess:z.literal(true)})).mutation(async({ctx,input})=>{
    const {project}=await editor(ctx,input.projectId);
    if(!encryptionReady())throw unavailable();
    return ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,project.organizationId,ctx.user.id);
      // The hourly limit is actor-wide, including simultaneous attempts in
      // different workspaces. Serialize that count without provider I/O.
      const projects=await tx.$queryRaw<Array<{organizationId:string}>>`SELECT "organizationId" FROM "Project" WHERE id=${input.projectId} FOR UPDATE`;
      if(projects[0]?.organizationId!==project.organizationId)throw new TRPCError({code:"FORBIDDEN",message:"The project workspace changed. Refresh before authorizing."});
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ctx.user.id} FOR UPDATE`;
      const recent=await tx.repositoryConnection.count({where:{actorId:ctx.user.id,createdAt:{gt:new Date(Date.now()-3600000)}}});
      if(recent>=20)throw new TRPCError({code:"TOO_MANY_REQUESTS",message:"Too many authorization attempts. Try again later."});
      const platformProvider=platformRepositoryProvider(input.configurationId);
      let config;
      if(input.configurationId==="platform:github-app"){
        config=await tx.repositoryProviderConfiguration.findUnique({where:{organizationId_provider_origin:{organizationId:project.organizationId,provider:"github-app",origin:GITHUB_ORIGIN}}});
        if(!config){
          if(!encryptionReady())throw unavailable();
          const application=platformGithubRepositoryApp();if(!application)throw unavailable();
          config=await tx.repositoryProviderConfiguration.create({data:{organizationId:project.organizationId,provider:application.provider,origin:application.origin,clientId:application.clientId,encryptedSecret:jsonToken(encryptToken(application.clientSecret)),createdById:ctx.user.id}});
        }
      }else if(platformProvider){
        const origin=platformProvider==="github"?GITHUB_ORIGIN:"https://gitlab.com";
        config=await tx.repositoryProviderConfiguration.findUnique({where:{organizationId_provider_origin:{organizationId:project.organizationId,provider:platformProvider,origin}}});
        if(!config){
          if(!encryptionReady())throw unavailable();
          const application=platformRepositoryApplication(platformProvider);
          if(!application)throw unavailable();
          // Explicit approval creates a tenant-local immutable snapshot. Env
          // rotation never changes a pending finish or retained grant's secret.
          // WEB_APP_URL/callback identity must remain stable through callbacks.
          config=await tx.repositoryProviderConfiguration.create({data:{organizationId:project.organizationId,provider:application.provider,origin:application.origin,clientId:application.clientId,encryptedSecret:jsonToken(encryptToken(application.clientSecret)),createdById:ctx.user.id}});
        }
      }else config=await tx.repositoryProviderConfiguration.findFirst({where:{id:input.configurationId,organizationId:project.organizationId,provider:{in:["gitlab","github","github-app"]}}});
      if(!config)throw new TRPCError({code:"NOT_FOUND"});
      const app=repositoryApp(config);
      if(app){
        if(config.origin!==GITHUB_ORIGIN||!ctx.authenticatedClerkSubject||ctx.user.clerkUserId!==ctx.authenticatedClerkSubject)throw new TRPCError({code:"FORBIDDEN",message:"Current signed-in actor access is required before authorizing this application."});
        await lockCurrentCaseFieldActor(tx,ctx.user.id,{clerkActorId:ctx.authenticatedClerkSubject});
      }
      const auth=app?createGithubAppRepositoryAuthorization(config.clientId,repositoryOAuthRedirect(process.env,"github")):config.provider==="github"?createGithubAuthorization(config.clientId,repositoryOAuthRedirect(process.env,"github")):createGitlabAuthorization(config.origin,config.clientId,repositoryOAuthRedirect());
      // Local expiry does not revoke an upstream OAuth grant. Keep encrypted
      // credentials until explicit revocation succeeds.
      await tx.repositoryConnection.updateMany({where:{actorId:ctx.user.id,organizationId:project.organizationId,status:"PENDING",authorizationExpiresAt:{lte:new Date()}},data:{...clearCredentials,status:"EXPIRED"}});
      const existing=await tx.repositoryConnection.findFirst({where:{projectId:input.projectId,actorId:ctx.user.id,configurationId:config.id,
        OR:[{encryptedToken:{not:Prisma.DbNull}},{status:{in:["PENDING","VERIFYING"]},authorizationExpiresAt:{gt:new Date()}}]}});
      if(existing)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Revoke the previous provider grant or finish its authorization before reconnecting this project."});
      const row=await tx.repositoryConnection.create({data:{projectId:input.projectId,organizationId:project.organizationId,actorId:ctx.user.id,configurationId:config.id,provider:app?"github":config.provider,origin:config.origin,stateHash:hashOAuthState(auth.state),encryptedVerifier:jsonToken(encryptToken(auth.verifier)),authorizationExpiresAt:new Date(Date.now()+600000)}});
      return{id:row.id,url:auth.url};
    });
  }),
  finish:protectedProcedure.input(z.object({state:z.string().min(32).max(200),code:z.string().max(2000).optional(),denied:z.boolean().default(false)})).mutation(async({ctx,input})=>{
    const row=await ctx.prisma.repositoryConnection.findUnique({where:{stateHash:hashOAuthState(input.state)}});
    if(!row || row.actorId!==ctx.user.id)throw new TRPCError({code:"NOT_FOUND"});
    await editor(ctx,row.projectId);
    if(row.status!=="PENDING" || row.authorizationExpiresAt.getTime()<=Date.now())throw new TRPCError({code:"PRECONDITION_FAILED",message:"Authorization expired or was already used. Start again."});
    if(row.provider!=="gitlab" && row.provider!=="github")throw new TRPCError({code:"PRECONDITION_FAILED",message:"This provider does not support authorization."});
    const claim=await ctx.prisma.repositoryConnection.updateMany({where:{id:row.id,status:"PENDING",authorizationExpiresAt:{gt:new Date()}},data:{status:"VERIFYING",encryptedVerifier:Prisma.DbNull}});
    if(claim.count!==1)throw new TRPCError({code:"CONFLICT",message:"Authorization is already being verified."});
    let issuedGrant:RevocableGrant|null=null;
    try{
      if(input.denied || !input.code)throw new Error("Authorization canceled");
      if(!row.configurationId)throw unavailable();
      const config=await ctx.prisma.repositoryProviderConfiguration.findFirst({where:{id:row.configurationId,organizationId:row.organizationId,provider:configurationProvider(row.provider),origin:row.origin}});
      if(!config)throw unavailable();
      const app=repositoryApp(config);
      if(app)await ctx.prisma.$transaction(tx=>liveRepositoryAppEditor(tx,ctx,row));
      const providerCredentials=applicationCredentials(config);
      const verified=app?await verifyGithubAppRepositoryAuthorization({...providerCredentials,redirectUri:repositoryOAuthRedirect(process.env,"github"),code:input.code,verifier:decrypt(row.encryptedVerifier)}):row.provider==="github"
        ? await verifyGithubAuthorization({clientId:providerCredentials.clientId,clientSecret:providerCredentials.clientSecret,redirectUri:repositoryOAuthRedirect(process.env,"github"),code:input.code,verifier:decrypt(row.encryptedVerifier)})
        : await verifyGitlabAuthorization({origin:config.origin,clientId:providerCredentials.clientId,clientSecret:providerCredentials.clientSecret,redirectUri:repositoryOAuthRedirect(),code:input.code,verifier:decrypt(row.encryptedVerifier)});
      issuedGrant={provider:row.provider,origin:row.origin,...providerCredentials,token:verified.token};
      // Permissions may have changed while the provider was contacted.
      await ctx.prisma.$transaction(async tx=>{
        if(app)await liveRepositoryAppEditor(tx,ctx,row);else await liveEditor(tx,row.organizationId,ctx.user.id);
        const saved=await tx.repositoryConnection.updateMany({where:{id:row.id,status:"VERIFYING"},data:{status:"VERIFIED",encryptedToken:jsonToken(encryptToken(verified.token)),tokenExpiresAt:verified.expiresAt,accountLabel:verified.accountLabel,verifiedAt:new Date()}});
        if(saved.count!==1)throw new Error("Connection canceled");
      });
      return{id:row.id,status:"VERIFIED" as const};
    }catch(error){
      let unrevokedToken:string|null=error instanceof GithubOAuthRevocationPendingError || error instanceof GitlabOAuthRevocationPendingError?error.token:null;
      if(issuedGrant){
        try{await revokeGrant(issuedGrant);}catch{unrevokedToken=issuedGrant.token;}
      }
      if(unrevokedToken){
        const retained=await ctx.prisma.repositoryConnection.updateMany({where:{id:row.id,status:"VERIFYING"},data:{...clearCredentials,status:"REVOCATION_PENDING",encryptedToken:jsonToken(encryptToken(unrevokedToken))}});
        if(retained.count!==1)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Provider revocation could not be confirmed. The authorization needs administrator review before this application can be removed."});
        throw new TRPCError({code:"PRECONDITION_FAILED",message:"Provider revocation could not be confirmed. Disconnect this connection to retry before reconnecting."});
      }
      await ctx.prisma.repositoryConnection.updateMany({where:{id:row.id,status:"VERIFYING"},data:{...clearCredentials,status:input.denied?"CANCELED":"FAILED"}});
      throw new TRPCError({code:"BAD_REQUEST",message:input.denied?"Authorization canceled. Nothing was connected.":"Could not verify the provider connection. Start again or check the instance application settings."});
    }
  }),
  status:protectedProcedure.input(z.object({id:z.string()})).query(async({ctx,input})=>{
    const row=await ownConnection(ctx,input.id);
    return{id:row.id,status:publicStatus(row),accountLabel:row.accountLabel,origin:row.origin,...await connectionDescriptor(ctx,row)};
  }),
  disconnect:protectedProcedure.input(z.object({id:z.string()})).mutation(async({ctx,input})=>{
    const row=await disconnectableConnection(ctx,input.id);
    if(row.provider==="gitlab" && connectionAccessMethod(row)==="token")throw new TRPCError({code:"BAD_REQUEST",message:"Remove saved GitLab token access, then revoke the token in GitLab. Vaettir cannot confirm provider revocation for access tokens."});
    if(row.provider==="gitlab" && connectionAccessMethod(row)==="unavailable")throw new TRPCError({code:"PRECONDITION_FAILED",message:"This GitLab access method is unavailable. No credential was used or removed."});
    const adminDisconnect=row.actorId!==ctx.user.id;
    if(row.status==="VERIFYING")throw new TRPCError({code:"PRECONDITION_FAILED",message:"Authorization is still being verified. Retry disconnect after it finishes."});
    if(["bitbucket","azure-devops"].includes(row.provider))throw new TRPCError({code:"BAD_REQUEST",message:"Remove saved token access, then revoke the token in your provider."});
    if(row.encryptedToken){
      if(!row.configurationId)throw unavailable();
      const config=await ctx.prisma.repositoryProviderConfiguration.findFirst({where:{id:row.configurationId,organizationId:row.organizationId,provider:configurationProvider(row.provider),origin:row.origin}});
      if(!config)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Provider application settings are unavailable. The connection was not disconnected."});
      // Check live authorization before provider I/O. If access changes during
      // revocation, the confirmed token still needs to be cleared locally.
      await ctx.prisma.$transaction(tx=>liveEditor(tx,row.organizationId,ctx.user.id,adminDisconnect));
      try{
        await revokeGrant({provider:row.provider,origin:row.origin,...applicationCredentials(config),token:decrypt(row.encryptedToken)});
      }catch{
        throw new TRPCError({code:"PRECONDITION_FAILED",message:"The provider did not confirm token revocation. The encrypted connection remains in Vaettir for retry."});
      }
    }
    await ctx.prisma.$transaction(async tx=>{
      if(!row.encryptedToken)await liveEditor(tx,row.organizationId,ctx.user.id,adminDisconnect);
      await tx.$queryRaw`SELECT id FROM "RepositoryConnection" WHERE id = ${row.id} FOR UPDATE`;
      const current=await tx.repositoryConnection.findUnique({where:{id:row.id}});
      if(!current || current.status!==row.status || JSON.stringify(current.encryptedToken)!==JSON.stringify(row.encryptedToken))
        throw new TRPCError({code:"CONFLICT",message:"The connection changed while disconnecting. Refresh its status."});
      await tx.repositoryConnection.update({where:{id:row.id},data:{...clearCredentials,status:"DISCONNECTED"}});
      await tx.projectRepository.updateMany({where:{connectionId:row.id},data:{connectionId:null,verifiedAt:null}});
    });
    return{disconnected:true};
  }),
  installations:protectedProcedure.input(z.object({id:z.string(),page:z.number().int().min(1).max(100).default(1),search:z.string().trim().max(100).default("")})).query(async({ctx,input})=>{
    const row=await ownConnection(ctx,input.id);requireVerified(row);
    if(row.provider!=="github"||!row.configurationId)throw unavailable();
    const config=await ctx.prisma.repositoryProviderConfiguration.findFirst({where:{id:row.configurationId,organizationId:row.organizationId,provider:"github-app",origin:GITHUB_ORIGIN}});
    const app=repositoryApp(config);if(!app)throw unavailable();
    const check=()=>ctx.prisma.$transaction(async tx=>{await liveRepositoryAppEditor(tx,ctx,row);const current=await tx.repositoryConnection.findUniqueOrThrow({where:{id:row.id}});requireVerified(current);if(JSON.stringify(current.encryptedToken)!==JSON.stringify(row.encryptedToken)||current.configurationId!==row.configurationId||current.organizationId!==row.organizationId||current.projectId!==row.projectId||current.actorId!==row.actorId||current.provider!==row.provider||current.origin!==row.origin)throw new TRPCError({code:"CONFLICT",message:"Connection changed. Refresh before choosing an account."});});
    await check();
    let result;
    try{result=await listGithubAppInstallations(decrypt(row.encryptedToken),app,input.page,input.search);}
    catch{throw new TRPCError({code:"BAD_REQUEST",message:"Could not verify read-only GitHub App installations. Check installation permissions and refresh accounts."});}
    await check();return result;
  }),
  groups:protectedProcedure.input(z.object({id:z.string(),page:z.number().int().min(1).max(100).default(1),search:z.string().trim().max(100).default("")})).query(async({ctx,input})=>{
    const row=await ownConnection(ctx,input.id);requireVerified(row);
    if(row.provider!=="gitlab")throw new TRPCError({code:"BAD_REQUEST",message:"Groups are only available for GitLab."});
    await ctx.prisma.$transaction(async tx=>{await liveEditor(tx,row.organizationId,ctx.user.id);const current=await tx.repositoryConnection.findUniqueOrThrow({where:{id:row.id}});requireVerified(current);if(JSON.stringify(current.encryptedToken)!==JSON.stringify(row.encryptedToken))throw new TRPCError({code:"CONFLICT",message:"Connection changed. Refresh before listing groups."});});
    try{const groups=await listGitlabGroups(row.origin,decrypt(row.encryptedToken),input.page,input.search);await ctx.prisma.$transaction(async tx=>{await liveEditor(tx,row.organizationId,ctx.user.id);const current=await tx.repositoryConnection.findUniqueOrThrow({where:{id:row.id}});requireVerified(current);if(JSON.stringify(current.encryptedToken)!==JSON.stringify(row.encryptedToken))throw new TRPCError({code:"CONFLICT",message:"Connection changed. Refresh before listing groups."});});return{groups,hasMore:groups.length===100&&input.page<100,limitReached:groups.length===100&&input.page===100};}
    catch{throw new TRPCError({code:"BAD_REQUEST",message:"Could not list GitLab groups. Check access to the selected instance."});}
  }),
  list:protectedProcedure.input(z.object({id:z.string(),page:z.number().int().min(1).max(100).default(1),search:z.string().trim().max(100).default(""),restartCatalogue:z.boolean().default(false),gitlabScope:gitlabRepositoryScopeSchema.optional(),githubInstallationId:githubInstallationIdSchema.optional(),githubInstallationPage:z.number().int().min(1).max(100).optional()})).query(async({ctx,input})=>{
    const row=await ownConnection(ctx,input.id);requireVerified(row);
    await ctx.prisma.$transaction(async tx=>{await liveEditor(tx,row.organizationId,ctx.user.id);const current=await tx.repositoryConnection.findUniqueOrThrow({where:{id:row.id}});requireVerified(current);if(JSON.stringify(current.encryptedToken)!==JSON.stringify(row.encryptedToken))throw new TRPCError({code:"CONFLICT",message:"Connection changed. Refresh before listing."});});
    if(!["gitlab","github","bitbucket","azure-devops"].includes(row.provider))throw new TRPCError({code:"PRECONDITION_FAILED",message:"This provider does not support verified repository listing."});
    if(input.gitlabScope&&row.provider!=="gitlab")throw new TRPCError({code:"BAD_REQUEST",message:"Group scope is only available for GitLab."});
    const githubConfig=row.provider==="github"&&row.configurationId?await ctx.prisma.repositoryProviderConfiguration.findFirst({where:{id:row.configurationId,organizationId:row.organizationId,provider:configurationProvider(row.provider),origin:GITHUB_ORIGIN}}):null;
    const githubApp=repositoryApp(githubConfig);
    if(row.provider==="github"&&!githubConfig)throw unavailable();
    if(githubApp)await ctx.prisma.$transaction(tx=>liveRepositoryAppEditor(tx,ctx,row));
    if((input.githubInstallationId||input.githubInstallationPage)&&!githubApp)throw new TRPCError({code:"BAD_REQUEST",message:"Installation scope requires a GitHub App connection."});
    if(githubApp&&!input.githubInstallationId)return{repositories:[] as z.infer<typeof repositorySelectionSchema>[],hasMore:false,limitReached:false,listingStatus:"end-of-scope" as const,scopeKey:null,catalogVersion:hashOAuthState("github-installation-required"),catalogReset:false,githubInstallationRequired:true};
    let repositories;let hasMore;let limitReached:boolean;let groupNativeId:number|undefined;
    try{
      if(githubApp){
        const listing=await listGithubAppInstallationRepositories(decrypt(row.encryptedToken),githubApp,input.githubInstallationId!,input.page,input.githubInstallationPage??1);
        repositories=listing.repositories;hasMore=listing.hasMore;limitReached=listing.limitReached;
      }else if(["bitbucket","azure-devops"].includes(row.provider)){
        const listing=await tokenRepositories(row.provider,row.origin,tokenCredentials.parse(JSON.parse(decrypt(row.encryptedToken))),input.page,input.search);
        repositories=listing.repositories;hasMore=listing.hasMore;limitReached="limitReached" in listing&&listing.limitReached===true;
      }else{
        repositories=row.provider==="github"?await listGithubRepositories(decrypt(row.encryptedToken),input.page):input.gitlabScope?await listGitlabRepositories(row.origin,decrypt(row.encryptedToken),input.page,input.search,input.gitlabScope,id=>{groupNativeId=id;}):await listGitlabRepositories(row.origin,decrypt(row.encryptedToken),input.page,input.search);
        if(input.gitlabScope&&!groupNativeId)throw new Error("Missing verified group identity");
        hasMore=repositories.length===100;
        limitReached=hasMore&&input.page===100;
        if(limitReached)hasMore=false;
      }
    }catch{throw new TRPCError({code:"BAD_REQUEST",message:"Could not list repositories. Reconnect or check your access to this instance."});}
    const scopeKey=githubApp?JSON.stringify(["github-installation/v1",input.githubInstallationId]):row.provider==="gitlab"&&input.gitlabScope?JSON.stringify(["gitlab-group/v1",input.gitlabScope.groupPath,input.gitlabScope.includeSubgroups,input.gitlabScope.includeShared,String(groupNativeId)]):undefined;
    const visible=(row.provider==="github" && input.search?repositories.filter(repo=>repo.name.toLowerCase().includes(input.search.toLowerCase())):repositories).map(repo=>({...repo,...(scopeKey?{scopeKey}:{})}));
    // Keep a bounded, short-lived catalog of pages this actor actually visited.
    // This permits reviewed multi-selection across pages without treating an
    // unlisted repository ID as verified or retaining a stale catalog forever.
    const {catalog,catalogReset,catalogAt}=await ctx.prisma.$transaction(async tx=>{
      if(githubApp)await liveRepositoryAppEditor(tx,ctx,row);else await liveEditor(tx,row.organizationId,ctx.user.id);
      await tx.$queryRaw`SELECT id FROM "RepositoryConnection" WHERE id = ${row.id} FOR UPDATE`;
      const current=await tx.repositoryConnection.findUniqueOrThrow({where:{id:row.id}});
      requireVerified(current);
      if(JSON.stringify(current.encryptedToken)!==JSON.stringify(row.encryptedToken)||githubApp&&(current.configurationId!==row.configurationId||current.organizationId!==row.organizationId||current.projectId!==row.projectId||current.actorId!==row.actorId||current.origin!==row.origin||current.provider!==row.provider))
        throw new TRPCError({code:"CONFLICT",message:"Connection changed. Refresh before selecting repositories."});
      const stored=current.catalog?z.array(repositorySelectionSchema).parse(current.catalog):[];
      // An empty array cannot attest which installation was previously reviewed.
      const sameScope=(!githubApp||stored.length>0)&&stored.every(repo=>(repo.scopeKey??null)===(scopeKey??null));
      const fresh=!input.restartCatalogue && sameScope && current.catalogAt && current.catalogAt.getTime()>=Date.now()-600000;
      const previous=fresh && current.catalog ? z.array(repositorySelectionSchema).parse(current.catalog) : [];
      const combined=new Map(previous.map(repo=>[repo.id,repo]));
      for(const repo of visible)combined.set(repo.id,repo);
      if(combined.size>500)throw new TRPCError({code:"PRECONDITION_FAILED",message:"This batch includes too many listed repositories. Connect a reviewed batch or restart repository selection with your saved connection."});
      const catalog=[...combined.values()];
      const catalogAt=fresh?current.catalogAt!:new Date();
      if(input.restartCatalogue && current.catalogAt && catalogAt.getTime()<=current.catalogAt.getTime())throw new TRPCError({code:"CONFLICT",message:"The catalogue clock has not advanced. Retry the explicit fresh selection batch; no previous catalogue or approval was changed."});
      await tx.repositoryConnection.update({where:{id:row.id},data:{catalog,catalogAt}});
      return {catalog,catalogReset:!fresh,catalogAt};
    });
    return{repositories:visible,hasMore,limitReached,listingStatus:limitReached?"truncated" as const:hasMore?"more-pages" as const:"end-of-scope" as const,scopeKey:scopeKey??null,catalogVersion:catalogVersion(catalog,row.id,catalogAt),catalogReset,githubInstallationRequired:false};
  }),
  connectSelected:protectedProcedure.input(z.object({id:z.string(),repositoryIds:z.array(z.string()).min(1).max(100),catalogVersion:z.string().length(64),approved:z.literal(true)})).mutation(async({ctx,input})=>{
    const row=await ownConnection(ctx,input.id);requireVerified(row);
    if(!row.catalogAt || row.catalogAt.getTime()<Date.now()-600000)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Refresh the repository list before confirming."});
    const catalog=z.array(repositorySelectionSchema).parse(row.catalog);
    if(new Set(catalog.map(repo=>repo.scopeKey??null)).size>1)throw new TRPCError({code:"PRECONDITION_FAILED",message:"The catalogue contains different repository scopes. Refresh and review one scope before connecting."});
    if(catalogVersion(row.catalog,row.id,row.catalogAt)!==input.catalogVersion)throw new TRPCError({code:"CONFLICT",message:"Repository choices changed. Refresh the list and review again."});
    const ids=[...new Set(input.repositoryIds)];
    const selected=ids.map(id=>catalog.find(repo=>repo.id===id));
    if(selected.some(repo=>!repo))throw new TRPCError({code:"BAD_REQUEST",message:"Select repositories from the verified list."});
    const config=row.provider==="github"&&row.configurationId?await ctx.prisma.repositoryProviderConfiguration.findFirst({where:{id:row.configurationId,organizationId:row.organizationId,provider:configurationProvider(row.provider),origin:GITHUB_ORIGIN}}):null;
    const app=repositoryApp(config);
    if(row.provider==="github"&&!config)throw unavailable();
    if(app&&catalog.some(repo=>!repo.scopeKey||!/^\["github-installation\/v1","[1-9][0-9]{0,15}"\]$/.test(repo.scopeKey)))throw new TRPCError({code:"PRECONDITION_FAILED",message:"Refresh and review one installed account before connecting."});
    await ctx.prisma.$transaction(async tx=>{
      if(app)await liveRepositoryAppEditor(tx,ctx,row);else await liveEditor(tx,row.organizationId,ctx.user.id);
      await tx.$queryRaw`SELECT id FROM "RepositoryConnection" WHERE id = ${row.id} FOR UPDATE`;
      const current=await tx.repositoryConnection.findUniqueOrThrow({where:{id:row.id}});requireVerified(current);
      if(app&&(current.configurationId!==row.configurationId||current.organizationId!==row.organizationId||current.projectId!==row.projectId||current.actorId!==row.actorId||current.origin!==row.origin||current.provider!==row.provider||JSON.stringify(current.encryptedToken)!==JSON.stringify(row.encryptedToken)))throw new TRPCError({code:"CONFLICT",message:"Connection changed. Refresh before connecting repositories."});
      if(!current.catalogAt || current.catalogAt.getTime()<Date.now()-600000)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Refresh the repository list before confirming."});
      if(catalogVersion(current.catalog,current.id,current.catalogAt)!==input.catalogVersion)throw new TRPCError({code:"CONFLICT",message:"Repository choices changed. Refresh and review again."});
      for(const repo of selected){
        if(!repo)continue;
        const where={projectId_provider_url:{projectId:row.projectId,provider:row.provider,url:repo.url}};
        const urlMatch=await tx.projectRepository.findUnique({where,include:{connection:{select:{actorId:true,status:true,tokenExpiresAt:true}}}});
        const nativeMatches=await tx.projectRepository.findMany({where:{projectId:row.projectId,provider:row.provider,externalId:repo.id},take:2,include:{connection:{select:{actorId:true,status:true,tokenExpiresAt:true}}}});
        if(nativeMatches.length>1||nativeMatches[0]&&urlMatch&&nativeMatches[0].id!==urlMatch.id)throw new TRPCError({code:"CONFLICT",message:"This native repository identity conflicts with an existing reference. Review those references before connecting."});
        const existing=nativeMatches[0]??urlMatch;
        if(existing?.externalId&&existing.externalId!==repo.id)throw new TRPCError({code:"CONFLICT",message:"The repository at this URL changed identity. Review the existing reference first."});
        if(existing?.connectionId && existing.connectionId!==row.id && existing.connection?.actorId!==ctx.user.id)throw new TRPCError({code:"CONFLICT",message:"A selected repository already has another member's connection. Ask them to disconnect it first."});
        const data={url:repo.url,externalId:repo.id,connectionId:row.id,verifiedAt:row.verifiedAt};
        if(existing)await tx.projectRepository.update({where:{id:existing.id},data});
        else await tx.projectRepository.create({data:{projectId:row.projectId,provider:row.provider,...data}});
      }
    });
    return{connected:ids.length};
  }),
});
