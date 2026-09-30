import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { router,protectedProcedure,requireProjectAccess,requireOrgRole,type Context } from "../trpc.js";
import { encryptToken,decryptToken,type EncryptedToken } from "../services/tokenEncryption.js";
import { repositoryProviderOrigin } from "../services/repositoryProviderHttp.js";
import { createGitlabAuthorization,hashOAuthState,listGitlabRepositories,repositoryOAuthRedirect,repositorySelectionSchema,verifyGitlabAuthorization } from "../services/gitlabRepositoryOAuth.js";
import { GITHUB_ORIGIN, createGithubAuthorization, listGithubRepositories, revokeGithubAuthorization, verifyGithubAuthorization } from "../services/githubRepositoryOAuth.js";

const projectInput=z.object({projectId:z.string()});
const jsonToken=(value:ReturnType<typeof encryptToken>)=>({...value});
const decrypt=(value:unknown)=>decryptToken(z.object({ciphertext:z.string(),iv:z.string(),authTag:z.string()}).parse(value) as EncryptedToken);
const unavailable=()=>new TRPCError({code:"PRECONDITION_FAILED",message:"Repository authorization is not configured. An organization admin must finish provider setup."});
function encryptionReady(){try{encryptToken("configuration-check");repositoryOAuthRedirect();repositoryOAuthRedirect(process.env,"github");return true;}catch{return false;}}
function redirectUri(provider:"gitlab"|"github"="gitlab"){try{return repositoryOAuthRedirect(process.env,provider);}catch{return null;}}
// Same organization lock used by membership/seat changes. Never keep it across provider I/O.
async function liveEditor(tx:Prisma.TransactionClient,organizationId:string,userId:string,admin=false){
  const rows=await tx.$queryRaw<Array<{suspendedAt:Date|null}>>`SELECT "suspendedAt" FROM "Organization" WHERE "id"=${organizationId} FOR UPDATE`;
  const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId,userId}}});
  if(!rows[0] || rows[0].suspendedAt || !member || member.seatType!=="FULL" || !(admin?["OWNER","ADMIN"]:["OWNER","ADMIN","EDITOR"]).includes(member.role))throw new TRPCError({code:"FORBIDDEN",message:"Your workspace permissions changed. Refresh and try again."});
}
const clearCredentials={encryptedToken:Prisma.DbNull,encryptedVerifier:Prisma.DbNull,catalog:Prisma.DbNull,catalogAt:null,tokenExpiresAt:null,verifiedAt:null};
// PostgreSQL JSONB reorders object keys. Hash a canonical field tuple, not raw JSON.
const catalogVersion=(catalog:unknown)=>hashOAuthState(JSON.stringify(z.array(repositorySelectionSchema).parse(catalog).map(repo=>[repo.id,repo.name,repo.url,repo.defaultBranch])));
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
function requireVerified(row:{status:string;tokenExpiresAt:Date|null;encryptedToken:unknown}){
  if(row.status!=="VERIFIED" || !row.encryptedToken || !row.tokenExpiresAt || row.tokenExpiresAt.getTime()<=Date.now()+30000)
    throw new TRPCError({code:"PRECONDITION_FAILED",message:"Reconnect to verify current repository access."});
}
function publicStatus(row:{status:string;authorizationExpiresAt:Date;tokenExpiresAt:Date|null}){
  const expired=(row.status==="VERIFIED" && (!row.tokenExpiresAt || row.tokenExpiresAt.getTime()<=Date.now()+30000)) || (["PENDING","VERIFYING"].includes(row.status) && row.authorizationExpiresAt.getTime()<=Date.now());
  return expired?"EXPIRED":row.status;
}
export const repositoryConnectionsRouter=router({
  mine:protectedProcedure.input(projectInput).query(async({ctx,input})=>{
    await editor(ctx,input.projectId);
    const rows=await ctx.prisma.repositoryConnection.findMany({where:{projectId:input.projectId,actorId:ctx.user.id,status:{in:["PENDING","VERIFYING","VERIFIED"]}},orderBy:{createdAt:"desc"},take:20,select:{id:true,provider:true,origin:true,status:true,accountLabel:true,authorizationExpiresAt:true,tokenExpiresAt:true}});
    return rows.map(row=>({id:row.id,provider:row.provider,origin:row.origin,status:publicStatus(row),accountLabel:row.accountLabel}));
  }),
  configurations:protectedProcedure.input(projectInput).query(async({ctx,input})=>{
    const {project,membership}=await requireProjectAccess(ctx,input.projectId);
    const configurations=await ctx.prisma.repositoryProviderConfiguration.findMany({where:{organizationId:project.organizationId},select:{id:true,provider:true,origin:true}});
    return{configurations,storageReady:encryptionReady(),canConfigure:membership.seatType==="FULL" && ["OWNER","ADMIN"].includes(membership.role),redirectUri:redirectUri(),githubRedirectUri:redirectUri("github")};
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
      await tx.projectRepository.updateMany({where:{connection:{configurationId:config.id}},data:{connectionId:null,verifiedAt:null}});
      await tx.repositoryProviderConfiguration.delete({where:{id:config.id}});
    });
    return{removed:true};
  }),
  begin:protectedProcedure.input(projectInput.extend({configurationId:z.string(),approveMetadataAccess:z.literal(true)})).mutation(async({ctx,input})=>{
    const {project}=await editor(ctx,input.projectId);
    if(!encryptionReady())throw unavailable();
    const config=await ctx.prisma.repositoryProviderConfiguration.findFirst({where:{id:input.configurationId,organizationId:project.organizationId,provider:{in:["gitlab","github"]}}});
    if(!config)throw new TRPCError({code:"NOT_FOUND"});
    const recent=await ctx.prisma.repositoryConnection.count({where:{actorId:ctx.user.id,createdAt:{gt:new Date(Date.now()-3600000)}}});
    if(recent>=20)throw new TRPCError({code:"TOO_MANY_REQUESTS",message:"Too many authorization attempts. Try again later."});
    const auth=config.provider==="github"?createGithubAuthorization(config.clientId,repositoryOAuthRedirect(process.env,"github")):createGitlabAuthorization(config.origin,config.clientId,repositoryOAuthRedirect());
    const row=await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,project.organizationId,ctx.user.id);
      // Opportunistically erase expired credentials for this actor without deleting provenance.
      await tx.repositoryConnection.updateMany({where:{actorId:ctx.user.id,organizationId:project.organizationId,OR:[{status:"PENDING",authorizationExpiresAt:{lte:new Date()}},{status:"VERIFIED",tokenExpiresAt:{lte:new Date()}}]},data:{...clearCredentials,status:"EXPIRED"}});
      return tx.repositoryConnection.create({data:{projectId:input.projectId,organizationId:project.organizationId,actorId:ctx.user.id,configurationId:config.id,provider:config.provider,origin:config.origin,stateHash:hashOAuthState(auth.state),encryptedVerifier:jsonToken(encryptToken(auth.verifier)),authorizationExpiresAt:new Date(Date.now()+600000)}});
    });
    return{id:row.id,url:auth.url};
  }),
  finish:protectedProcedure.input(z.object({state:z.string().min(32).max(200),code:z.string().max(2000).optional(),denied:z.boolean().default(false)})).mutation(async({ctx,input})=>{
    const row=await ctx.prisma.repositoryConnection.findUnique({where:{stateHash:hashOAuthState(input.state)}});
    if(!row || row.actorId!==ctx.user.id)throw new TRPCError({code:"NOT_FOUND"});
    await editor(ctx,row.projectId);
    if(row.status!=="PENDING" || row.authorizationExpiresAt.getTime()<=Date.now())throw new TRPCError({code:"PRECONDITION_FAILED",message:"Authorization expired or was already used. Start again."});
    if(row.provider!=="gitlab" && row.provider!=="github")throw new TRPCError({code:"PRECONDITION_FAILED",message:"This provider does not support authorization."});
    const claim=await ctx.prisma.repositoryConnection.updateMany({where:{id:row.id,status:"PENDING",authorizationExpiresAt:{gt:new Date()}},data:{status:"VERIFYING",encryptedVerifier:Prisma.DbNull}});
    if(claim.count!==1)throw new TRPCError({code:"CONFLICT",message:"Authorization is already being verified."});
    try{
      if(input.denied || !input.code)throw new Error("Authorization canceled");
      const config=await ctx.prisma.repositoryProviderConfiguration.findFirst({where:{id:row.configurationId,organizationId:row.organizationId,provider:row.provider}});
      if(!config)throw unavailable();
      const verified=row.provider==="github"
        ? await verifyGithubAuthorization({clientId:config.clientId,clientSecret:decrypt(config.encryptedSecret),redirectUri:repositoryOAuthRedirect(process.env,"github"),code:input.code,verifier:decrypt(row.encryptedVerifier)})
        : await verifyGitlabAuthorization({origin:config.origin,clientId:config.clientId,clientSecret:decrypt(config.encryptedSecret),redirectUri:repositoryOAuthRedirect(),code:input.code,verifier:decrypt(row.encryptedVerifier)});
      // Permissions may have changed while the provider was contacted.
      await ctx.prisma.$transaction(async tx=>{
        await liveEditor(tx,row.organizationId,ctx.user.id);
        const saved=await tx.repositoryConnection.updateMany({where:{id:row.id,status:"VERIFYING"},data:{status:"VERIFIED",encryptedToken:jsonToken(encryptToken(verified.token)),tokenExpiresAt:verified.expiresAt,accountLabel:verified.accountLabel,verifiedAt:new Date()}});
        if(saved.count!==1)throw new Error("Connection canceled");
      });
      return{id:row.id,status:"VERIFIED" as const};
    }catch{
      await ctx.prisma.repositoryConnection.updateMany({where:{id:row.id,status:"VERIFYING"},data:{...clearCredentials,status:input.denied?"CANCELED":"FAILED"}});
      throw new TRPCError({code:"BAD_REQUEST",message:input.denied?"Authorization canceled. Nothing was connected.":"Could not verify the provider connection. Start again or check the instance application settings."});
    }
  }),
  status:protectedProcedure.input(z.object({id:z.string()})).query(async({ctx,input})=>{
    const row=await ownConnection(ctx,input.id);
    return{id:row.id,status:publicStatus(row),accountLabel:row.accountLabel,origin:row.origin};
  }),
  disconnect:protectedProcedure.input(z.object({id:z.string()})).mutation(async({ctx,input})=>{
    const row=await ownConnection(ctx,input.id);
    if(row.provider==="github" && row.encryptedToken){
      const config=await ctx.prisma.repositoryProviderConfiguration.findFirst({where:{id:row.configurationId,organizationId:row.organizationId,provider:"github",origin:GITHUB_ORIGIN}});
      if(!config)throw new TRPCError({code:"PRECONDITION_FAILED",message:"GitHub application settings are unavailable. The connection was not disconnected."});
      // Check live authorization before provider I/O. If access changes during
      // revocation, the confirmed token still needs to be cleared locally.
      await ctx.prisma.$transaction(tx=>liveEditor(tx,row.organizationId,ctx.user.id));
      try{
        await revokeGithubAuthorization({clientId:config.clientId,clientSecret:decrypt(config.encryptedSecret),token:decrypt(row.encryptedToken)});
      }catch{
        throw new TRPCError({code:"PRECONDITION_FAILED",message:"GitHub did not confirm token revocation. The connection remains in Vaettir. Retry, or revoke the app in GitHub's Authorized OAuth Apps settings."});
      }
    }
    await ctx.prisma.$transaction(async tx=>{
      if(row.provider!=="github")await liveEditor(tx,row.organizationId,ctx.user.id);
      await tx.$queryRaw`SELECT id FROM "RepositoryConnection" WHERE id = ${row.id} FOR UPDATE`;
      const current=await tx.repositoryConnection.findUnique({where:{id:row.id}});
      if(!current || current.status!==row.status || JSON.stringify(current.encryptedToken)!==JSON.stringify(row.encryptedToken))
        throw new TRPCError({code:"CONFLICT",message:"The connection changed while disconnecting. Refresh its status."});
      await tx.repositoryConnection.update({where:{id:row.id},data:{...clearCredentials,status:"DISCONNECTED"}});
      await tx.projectRepository.updateMany({where:{connectionId:row.id},data:{connectionId:null,verifiedAt:null}});
    });
    return{disconnected:true};
  }),
  list:protectedProcedure.input(z.object({id:z.string(),page:z.number().int().min(1).max(100).default(1),search:z.string().trim().max(100).default("")})).query(async({ctx,input})=>{
    const row=await ownConnection(ctx,input.id);requireVerified(row);
    if(row.provider!=="gitlab" && row.provider!=="github")throw new TRPCError({code:"PRECONDITION_FAILED",message:"This provider does not support verified repository listing."});
    let repositories;try{repositories=row.provider==="github"?await listGithubRepositories(decrypt(row.encryptedToken),input.page):await listGitlabRepositories(row.origin,decrypt(row.encryptedToken),input.page,input.search);}catch{throw new TRPCError({code:"BAD_REQUEST",message:"Could not list repositories. Reconnect or check your access to this instance."});}
    const visible=row.provider==="github" && input.search?repositories.filter(repo=>repo.name.toLowerCase().includes(input.search.toLowerCase())):repositories;
    // Keep a bounded, short-lived catalog of pages this actor actually visited.
    // This permits reviewed multi-selection across pages without treating an
    // unlisted repository ID as verified or retaining a stale catalog forever.
    const {catalog,catalogReset}=await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,row.organizationId,ctx.user.id);
      await tx.$queryRaw`SELECT id FROM "RepositoryConnection" WHERE id = ${row.id} FOR UPDATE`;
      const current=await tx.repositoryConnection.findUniqueOrThrow({where:{id:row.id}});
      requireVerified(current);
      if(JSON.stringify(current.encryptedToken)!==JSON.stringify(row.encryptedToken))
        throw new TRPCError({code:"CONFLICT",message:"Connection changed. Refresh before selecting repositories."});
      const fresh=current.catalogAt && current.catalogAt.getTime()>=Date.now()-600000;
      const previous=fresh && current.catalog ? z.array(repositorySelectionSchema).parse(current.catalog) : [];
      const combined=new Map(previous.map(repo=>[repo.id,repo]));
      for(const repo of visible)combined.set(repo.id,repo);
      if(combined.size>500)throw new TRPCError({code:"PRECONDITION_FAILED",message:"This selection includes too many listed repositories. Connect a reviewed batch, then start a new authorization to continue."});
      const catalog=[...combined.values()];
      await tx.repositoryConnection.update({where:{id:row.id},data:{catalog,catalogAt:fresh?current.catalogAt:new Date()}});
      return {catalog,catalogReset:!fresh};
    });
    return{repositories:visible,hasMore:repositories.length===100,catalogVersion:catalogVersion(catalog),catalogReset};
  }),
  connectSelected:protectedProcedure.input(z.object({id:z.string(),repositoryIds:z.array(z.string()).min(1).max(100),catalogVersion:z.string().length(64),approved:z.literal(true)})).mutation(async({ctx,input})=>{
    const row=await ownConnection(ctx,input.id);requireVerified(row);
    if(!row.catalogAt || row.catalogAt.getTime()<Date.now()-600000)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Refresh the repository list before confirming."});
    const catalog=z.array(repositorySelectionSchema).parse(row.catalog);
    if(catalogVersion(row.catalog)!==input.catalogVersion)throw new TRPCError({code:"CONFLICT",message:"Repository choices changed. Refresh the list and review again."});
    const ids=[...new Set(input.repositoryIds)];
    const selected=ids.map(id=>catalog.find(repo=>repo.id===id));
    if(selected.some(repo=>!repo))throw new TRPCError({code:"BAD_REQUEST",message:"Select repositories from the verified list."});
    await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,row.organizationId,ctx.user.id);
      await tx.$queryRaw`SELECT id FROM "RepositoryConnection" WHERE id = ${row.id} FOR UPDATE`;
      const current=await tx.repositoryConnection.findUniqueOrThrow({where:{id:row.id}});requireVerified(current);
      if(!current.catalogAt || current.catalogAt.getTime()<Date.now()-600000)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Refresh the repository list before confirming."});
      if(catalogVersion(current.catalog)!==input.catalogVersion)throw new TRPCError({code:"CONFLICT",message:"Repository choices changed. Refresh and review again."});
      for(const repo of selected){
        if(!repo)continue;
        const where={projectId_provider_url:{projectId:row.projectId,provider:row.provider,url:repo.url}};
        const existing=await tx.projectRepository.findUnique({where,include:{connection:{select:{actorId:true,status:true,tokenExpiresAt:true}}}});
        if(existing?.connectionId && existing.connectionId!==row.id && existing.connection?.actorId!==ctx.user.id)throw new TRPCError({code:"CONFLICT",message:"A selected repository already has another member's connection. Ask them to disconnect it first."});
        await tx.projectRepository.upsert({where,create:{projectId:row.projectId,provider:row.provider,url:repo.url,externalId:repo.id,connectionId:row.id,verifiedAt:row.verifiedAt},update:{externalId:repo.id,connectionId:row.id,verifiedAt:row.verifiedAt}});
      }
    });
    return{connected:ids.length};
  }),
});
