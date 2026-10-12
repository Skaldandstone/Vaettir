import {randomUUID} from "node:crypto";
import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {prisma,Prisma} from "@vaettir/db";
import type {Context} from "./trpc.js";
import {assertOwnedTestDatabase} from "./testOnlyDatabaseSafety.js";
import {repositoryIntelligenceRouter} from "./routers/repositoryIntelligence.js";
import {repositoryCoverageChecksRouter} from "./routers/repositoryCoverageChecks.js";
import {repositoryProcessingPreview,beginRepositoryProcessing,assertRepositoryProcessingApproval} from "./services/repositoryProcessingApproval.js";
import {ensureSavedGitlabAccess} from "./services/savedGitlabAccess.js";
import {hardDeleteOrganization} from "./services/orgHardDelete.js";
import {encryptToken,decryptToken,type EncryptedToken} from "./services/tokenEncryption.js";
import {refreshGitlabAuthorization,revokeGitlabAuthorization} from "./services/gitlabRepositoryOAuth.js";
import {repositoryProviderJson} from "./services/repositoryProviderHttp.js";

vi.mock("./services/gitlabRepositoryOAuth.js",async original=>({...await original<typeof import("./services/gitlabRepositoryOAuth.js")>(),refreshGitlabAuthorization:vi.fn(),revokeGitlabAuthorization:vi.fn()}));
vi.mock("./services/repositoryProviderHttp.js",async original=>({...await original<typeof import("./services/repositoryProviderHttp.js")>(),repositoryProviderJson:vi.fn()}));
const isolated=(()=>{try{assertOwnedTestDatabase(process.env.DATABASE_URL);return true;}catch{return false;}})();
const origin="https://gitlab.synthetic.example",redirectUri="https://vaettir.synthetic.example/connections/gitlab/callback";
describe.skipIf(!isolated&&process.env.GITHUB_ACTIONS!=="true")("saved GitLab metadata grant continuity (owned synthetic PostgreSQL only)",()=>{
  let orgId:string,projectId:string,actorId:string,subject:string,connectionId:string,configId:string,ctx:Context&{user:NonNullable<Context["user"]>};
  let repoIds:string[];
  const cleanup=new Map<string,{slug:string;actorId:string}>();
  const request=(index=0)=>({projectId,repositoryId:repoIds[index]!,originalOrganizationId:orgId,expectedNativeActorId:actorId,expectedClerkActorId:subject,expectedConnectionId:connectionId});
  const current=()=>prisma.repositoryConnection.findUniqueOrThrow({where:{id:connectionId}});
  const caller=()=>repositoryIntelligenceRouter.createCaller(ctx);
  const refreshed=()=>({token:"next-synthetic-access",expiresAt:new Date(Date.now()+3600000),accountLabel:"synthetic-user",renewal:{refreshToken:"next-synthetic-refresh",accountId:"17",redirectUri}});
  beforeEach(async()=>{
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    vi.resetAllMocks();vi.stubEnv("WEB_APP_URL","https://vaettir.synthetic.example");vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,7).toString("base64"));
    const key="saved-gitlab-"+randomUUID(),tier=await prisma.planTier.findUniqueOrThrow({where:{key:"free"}});
    const org=await prisma.organization.create({data:{name:key,slug:key,planTierId:tier.id}});orgId=org.id;
    subject=key;const user=await prisma.user.create({data:{clerkUserId:subject,email:key+"@example.com",memberships:{create:{organizationId:orgId,role:"OWNER",seatType:"FULL"}}},include:{memberships:true}});actorId=user.id;
    cleanup.set(orgId,{slug:key,actorId});
    ctx={prisma,user,authenticatedClerkSubject:subject,staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}};
    projectId=(await prisma.project.create({data:{organizationId:orgId,name:key,slug:key,caseKey:"continuity"}})).id;
    configId=(await prisma.repositoryProviderConfiguration.create({data:{organizationId:orgId,provider:"gitlab",origin,clientId:"synthetic-client",encryptedSecret:{...encryptToken("synthetic-secret")},createdById:actorId}})).id;
    connectionId=(await prisma.repositoryConnection.create({data:{organizationId:orgId,projectId,actorId,configurationId:configId,provider:"gitlab",origin,stateHash:randomUUID(),status:"VERIFIED",verifiedAt:new Date(),authorizationExpiresAt:new Date(0),tokenExpiresAt:new Date(0),
      encryptedToken:{...encryptToken("old-synthetic-access")},encryptedVerifier:{...encryptToken(JSON.stringify({version:"gitlab-refresh/v1",refreshToken:"old-synthetic-refresh",accountId:"17",redirectUri}))}}})).id;
    repoIds=[];for(let i=0;i<14;i++)repoIds.push((await prisma.projectRepository.create({data:{projectId,provider:"gitlab",url:`${origin}/team/repo-${47+i}`,externalId:String(47+i),connectionId,verifiedAt:new Date(),revision:"original-revision"}})).id);
    vi.mocked(refreshGitlabAuthorization).mockResolvedValue(refreshed());
    vi.mocked(repositoryProviderJson).mockImplementation(async(_origin,path)=>{
      if(path==="/api/v4/user")return{id:17,username:"synthetic-user"};
      const id=/^\/api\/v4\/projects\/([0-9]+)$/.exec(path)?.[1];if(id)return{id:Number(id),web_url:`${origin}/team/repo-${id}`,path_with_namespace:`team/repo-${id}`};
      if(path.includes("/releases?"))return[];
      throw Error("Unexpected synthetic metadata request");
    });
  });
  afterEach(()=>vi.unstubAllEnvs());
  afterAll(async()=>{
    // Exact fresh owned tenants only; retain permanent deletion receipts and
    // their dedicated actor. Never prune foreign metadata or disable guards.
    for(const[id,owned]of cleanup){const org=await prisma.organization.findUnique({where:{id}});if(!org)continue;expect(org.slug).toBe(owned.slug);await hardDeleteOrganization(prisma,id,owned.actorId,"Owned synthetic saved GitLab continuity fixture cleanup");}
  },60000);
  it("one simultaneous14-repository exchange owns the saved grant; all later reads reuse SAME rows",async()=>{
    const before=await prisma.projectRepository.findMany({where:{projectId},orderBy:{id:"asc"}});
    let release!:()=>void,entered!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    vi.mocked(refreshGitlabAuthorization).mockImplementationOnce(async()=>{entered();await barrier;return refreshed();});
    const first=caller().savedAccess(request());try{await started;
      const competing=await Promise.allSettled(repoIds.slice(1).map((_id,index)=>caller().savedAccess(request(index+1))));
      expect(competing).toHaveLength(13);for(const result of competing){expect(result.status).toBe("rejected");if(result.status==="rejected")expect(result.reason).toMatchObject({code:"PRECONDITION_FAILED",message:"Saved GitLab renewal is in progress or unconfirmed. No token exchange will be repeated."});}expect(refreshGitlabAuthorization).toHaveBeenCalledOnce();expect((await current()).status).toBe("REFRESHING");
    }finally{release();}const {expectedConnectionId,...pins}=request();expect(await first).toMatchObject({...pins,connectionId:expectedConnectionId,status:"VERIFIED",reused:true,renewed:true});
    const later=await Promise.all(repoIds.map((_id,index)=>caller().savedAccess(request(index))));expect(later.every(result=>result.connectionId===connectionId&&!result.renewed)).toBe(true);expect(refreshGitlabAuthorization).toHaveBeenCalledOnce();
    expect(await prisma.projectRepository.findMany({where:{projectId},orderBy:{id:"asc"}})).toEqual(before);
    expect(decryptToken((await current()).encryptedToken as unknown as EncryptedToken)).toBe("next-synthetic-access");expect(JSON.stringify(later)).not.toMatch(/synthetic-access|synthetic-refresh|ciphertext/);
  },30000);
  it("project release reads automatically renew before expiry refusal without re-registering repositories",async()=>{
    const before=await prisma.projectRepository.findMany({where:{projectId},orderBy:{id:"asc"}});
    for(const repositoryId of repoIds)expect(await caller().releases({projectId,repositoryId,page:1})).toMatchObject({projectId,repositoryId,releases:[]});
    expect(refreshGitlabAuthorization).toHaveBeenCalledOnce();expect(await prisma.projectRepository.findMany({where:{projectId},orderBy:{id:"asc"}})).toEqual(before);expect(await prisma.release.count({where:{projectId}})).toBe(0);
    expect(vi.mocked(repositoryProviderJson).mock.calls.every(call=>!call[1].includes("/blobs")&&!call[1].includes("/tree"))).toBe(true);
  },30000);
  it("revalidates stored explicit PAT bytes, preserves all14 registrations and only the LOCAL window",async()=>{
    const marker={accessMethod:"gitlab-token/v1",requestHash:"a".repeat(64)};await prisma.repositoryConnection.update({where:{id:connectionId},data:{configurationId:null,encryptedVerifier:marker}});
    const before=await current(),repos=await prisma.projectRepository.findMany({where:{projectId},orderBy:{id:"asc"}});
    expect(await caller().savedAccess(request())).toMatchObject({accessMethod:"token",renewed:true});const after=await current();
    expect(after.encryptedToken).toEqual(before.encryptedToken);expect(after.encryptedVerifier).toEqual(before.encryptedVerifier);expect(after.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now()+28799000);expect(after.tokenExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now()+28800000);
    expect(refreshGitlabAuthorization).not.toHaveBeenCalled();expect(vi.mocked(repositoryProviderJson).mock.calls.map(call=>call[1])).toEqual(["/api/v4/user","/api/v4/projects/47"]);expect(await prisma.projectRepository.findMany({where:{projectId},orderBy:{id:"asc"}})).toEqual(repos);
  });
  it("retains unknown OAuth exchange and never rotates again across any of the14 repositories",async()=>{
    vi.mocked(refreshGitlabAuthorization).mockRejectedValue(new Error("synthetic uncertain provider result"));await expect(caller().savedAccess(request())).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect((await current()).status).toBe("REFRESH_UNKNOWN");
    for(let i=0;i<14;i++)await expect(caller().savedAccess(request(i))).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect(refreshGitlabAuthorization).toHaveBeenCalledOnce();expect(decryptToken((await current()).encryptedToken as unknown as EncryptedToken)).toBe("old-synthetic-access");expect(await prisma.projectRepository.count({where:{connectionId}})).toBe(14);
  });
  it.each(["foreign-original-org","foreign-native-actor","stale-clerk","read-only","suspended","missing-refresh","malformed-refresh","revoked"])("refuses %s before provider use",async mode=>{
    const input=request();if(mode==="foreign-original-org")input.originalOrganizationId="foreign";if(mode==="foreign-native-actor")input.expectedNativeActorId="foreign";if(mode==="stale-clerk")await prisma.user.update({where:{id:actorId},data:{clerkUserId:randomUUID()}});
    if(mode==="read-only")await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:actorId}},data:{seatType:"READ_ONLY"}});if(mode==="suspended")await prisma.organization.update({where:{id:orgId},data:{suspendedAt:new Date()}});
    if(mode==="missing-refresh")await prisma.repositoryConnection.update({where:{id:connectionId},data:{encryptedVerifier:Prisma.DbNull}});if(mode==="malformed-refresh")await prisma.repositoryConnection.update({where:{id:connectionId},data:{encryptedVerifier:{...encryptToken('{"refreshToken":"PRIVATE-SYNTHETIC')}}});if(mode==="revoked")await prisma.repositoryConnection.update({where:{id:connectionId},data:{status:"DISCONNECTED"}});
    const error=await caller().savedAccess(input).catch((value:unknown)=>value);expect(error).toBeInstanceOf(Error);expect(String(error)).not.toContain("PRIVATE-SYNTHETIC");expect(refreshGitlabAuthorization).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("rechecks current membership after provider IO and revokes the newly issued OAuth credential",async()=>{
    vi.mocked(refreshGitlabAuthorization).mockImplementationOnce(async()=>{await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:actorId}},data:{seatType:"READ_ONLY"}});return refreshed();});await expect(caller().savedAccess(request())).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect((await current()).status).toBe("FAILED");expect(revokeGitlabAuthorization).toHaveBeenCalledWith(expect.objectContaining({token:"next-synthetic-access"}));expect(await prisma.projectRepository.count({where:{connectionId}})).toBe(14);
  });
  it("preserves a replacement credential on postIO CAS refusal rather than overwriting it",async()=>{
    const replacement={...encryptToken("replacement-synthetic")};vi.mocked(refreshGitlabAuthorization).mockImplementationOnce(async()=>{await prisma.repositoryConnection.update({where:{id:connectionId},data:{encryptedToken:replacement}});return refreshed();});await expect(ensureSavedGitlabAccess(ctx,request())).rejects.toThrow();expect((await current()).encryptedToken).toEqual(replacement);expect((await current()).status).toBe("REFRESHING");expect(revokeGitlabAuthorization).toHaveBeenCalledOnce();
  });
  it("does not publish new credentials after current project tenant moves during provider IO",async()=>{
    const key="saved-gitlab-foreign-"+randomUUID(),tier=await prisma.planTier.findUniqueOrThrow({where:{key:"free"}}),org=await prisma.organization.create({data:{name:key,slug:key,planTierId:tier.id}});cleanup.set(org.id,{slug:key,actorId});await prisma.membership.create({data:{organizationId:org.id,userId:actorId,role:"OWNER",seatType:"FULL"}});
    vi.mocked(refreshGitlabAuthorization).mockImplementationOnce(async()=>{await prisma.project.update({where:{id:projectId},data:{organizationId:org.id}});return refreshed();});await expect(caller().savedAccess(request())).rejects.toThrow();expect(revokeGitlabAuthorization).toHaveBeenCalledOnce();expect((await current()).status).toBe("FAILED");expect((await current()).encryptedToken).toBeNull();
  });
  it("refuses a locally fresh OAuth grant after its original configuration scope changes",async()=>{
    await prisma.repositoryConnection.update({where:{id:connectionId},data:{tokenExpiresAt:new Date(Date.now()+3600000)}});
    await prisma.repositoryProviderConfiguration.update({where:{id:configId},data:{origin:"https://changed.synthetic.example"}});
    await expect(caller().savedAccess(request())).rejects.toThrow("original GitLab application is unavailable");expect(refreshGitlabAuthorization).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("explicit Check refuses absent/replaced connection pins before provider IO",async()=>{
    const {expectedConnectionId:omitted,...missing}=request();expect(omitted).toBe(connectionId);
    await expect(caller().savedAccess(missing as Parameters<ReturnType<typeof caller>["savedAccess"]>[0])).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(caller().savedAccess({...request(),expectedConnectionId:"other-synthetic"})).rejects.toMatchObject({code:"CONFLICT"});expect(refreshGitlabAuthorization).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("NEW source preview renews metadata only; original approved UUID/body/binding stays unchanged and invalid",async()=>{
    await prisma.aiCreditTransaction.create({data:{organizationId:orgId,type:"GRANT",amount:1000,description:"Owned synthetic preview test"}});
    await prisma.repositoryConnection.update({where:{id:connectionId},data:{tokenExpiresAt:new Date(Date.now()+3600000)}});
    const scope={repositoryId:repoIds[0]!,repoUrl:origin+"/team/repo-47",ref:"main",pathPrefixes:["tests"],maxItems:1};
    const oldPreview=await repositoryProcessingPreview(ctx,projectId,"TEST_CASES",scope);
    const consent={requestId:randomUUID(),expectedScopeHash:oldPreview.scopeHash,approveSourceRead:true as const,approveAiProcessing:true as const,approveVariableCredits:true as const};
    const started=await beginRepositoryProcessing(ctx,projectId,"TEST_CASES",scope,consent),before=await prisma.repositoryProcessingApproval.findUniqueOrThrow({where:{id:started.approval.id}});
    await prisma.repositoryConnection.update({where:{id:connectionId},data:{tokenExpiresAt:new Date(0)}});
    const fresh=await repositoryProcessingPreview(ctx,projectId,"TEST_CASES",scope);expect(fresh.scopeHash).not.toBe(oldPreview.scopeHash);expect(refreshGitlabAuthorization).toHaveBeenCalledOnce();expect(repositoryProviderJson).not.toHaveBeenCalled();
    await expect(beginRepositoryProcessing(ctx,projectId,"TEST_CASES",scope,consent)).rejects.toMatchObject({code:"CONFLICT"});
    await expect(prisma.$transaction(tx=>assertRepositoryProcessingApproval(tx,before.id,projectId,"TEST_CASES"))).rejects.toThrow();
    expect(await prisma.repositoryProcessingApproval.findUniqueOrThrow({where:{id:before.id}})).toEqual(before);expect(refreshGitlabAuthorization).toHaveBeenCalledOnce();expect(await prisma.reverseEngineerJob.count({where:{projectId}})).toBe(0);expect(await prisma.aiCreditTransaction.count({where:{organizationId:orgId,type:"CONSUMPTION"}})).toBe(0);
  });
  it("NEW coverage preview renews only before fresh scope capture; old compare refusal never renews or reads files",async()=>{
    const coverage=repositoryCoverageChecksRouter.createCaller(ctx),scope={repositoryId:repoIds[0]!,ref:"main",pathPrefixes:["tests"],maxItems:1};
    await prisma.repositoryConnection.update({where:{id:connectionId},data:{tokenExpiresAt:new Date(Date.now()+3600000)}});const old=await coverage.preview({projectId,scope});
    await prisma.repositoryConnection.update({where:{id:connectionId},data:{tokenExpiresAt:new Date(0)}});const fresh=await coverage.preview({projectId,scope});
    expect(fresh.scopeHash).not.toBe(old.scopeHash);expect(refreshGitlabAuthorization).toHaveBeenCalledOnce();expect(repositoryProviderJson).not.toHaveBeenCalled();
    await expect(coverage.compare({projectId,scope,consent:{requestId:randomUUID(),expectedScopeHash:old.scopeHash,approveSourceRead:true}})).rejects.toMatchObject({code:"CONFLICT"});
    expect(repositoryProviderJson).not.toHaveBeenCalled();expect(refreshGitlabAuthorization).toHaveBeenCalledOnce();expect(await prisma.auditLog.count({where:{projectId,entityType:"RepositoryCoverageCheck"}})).toBe(0);
  });
  it("preserves READ_ONLY source-preview semantics without provider renewal or spending authority",async()=>{
    await prisma.repositoryConnection.update({where:{id:connectionId},data:{tokenExpiresAt:new Date(Date.now()+3600000)}});await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:actorId}},data:{seatType:"READ_ONLY"}});
    expect(await repositoryProcessingPreview(ctx,projectId,"TEST_CASES",{repositoryId:repoIds[0]!,repoUrl:origin+"/team/repo-47",ref:"main",pathPrefixes:["tests"],maxItems:1})).toMatchObject({canSpend:false});expect(refreshGitlabAuthorization).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
});
