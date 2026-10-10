import {randomUUID} from "node:crypto";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {prisma,Prisma} from "@vaettir/db";
import {repositoryConnectionsRouter} from "./routers/repositoryConnections.js";
import {encryptToken,decryptToken,type EncryptedToken} from "./services/tokenEncryption.js";
import {refreshGitlabAuthorization,revokeGitlabAuthorization} from "./services/gitlabRepositoryOAuth.js";
vi.mock("./services/gitlabRepositoryOAuth.js",async original=>({...await original<typeof import("./services/gitlabRepositoryOAuth.js")>(),refreshGitlabAuthorization:vi.fn(),revokeGitlabAuthorization:vi.fn()}));
const url=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
const isolated=!!url&&["localhost","127.0.0.1"].includes(url.hostname)&&/test/i.test(url.pathname)&&!url.searchParams.has("host");
describe.skipIf(!isolated)("durable GitLab grant renewal",()=>{
  let orgId:string,projectId:string,actorId:string,subject:string,connectionId:string,configId:string;
  let caller:ReturnType<typeof repositoryConnectionsRouter.createCaller>;
  const origin="https://gitlab.synthetic.example",redirectUri="https://vaettir.synthetic.example/connections/gitlab/callback";
  const request=()=>({id:connectionId,originalOrganizationId:orgId,expectedClerkActorId:subject});
  const row=()=>prisma.repositoryConnection.findUniqueOrThrow({where:{id:connectionId}});
  beforeEach(async()=>{
    vi.resetAllMocks();vi.stubEnv("WEB_APP_URL","https://vaettir.synthetic.example");vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,9).toString("base64"));
    const key=randomUUID();subject=key;
    const tier=await prisma.planTier.findUniqueOrThrow({where:{key:"free"}});
    orgId=(await prisma.organization.create({data:{name:key,slug:key,planTierId:tier.id}})).id;
    projectId=(await prisma.project.create({data:{name:key,slug:key,organizationId:orgId}})).id;
    const user=await prisma.user.create({data:{clerkUserId:subject,email:`${key}@example.com`,memberships:{create:{organizationId:orgId,role:"OWNER",seatType:"FULL"}}},include:{memberships:true}});actorId=user.id;
    caller=repositoryConnectionsRouter.createCaller({prisma,user,authenticatedClerkSubject:subject,staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}});
    configId=(await prisma.repositoryProviderConfiguration.create({data:{organizationId:orgId,provider:"gitlab",origin,clientId:"synthetic-client",encryptedSecret:{...encryptToken("synthetic-secret")},createdById:actorId}})).id;
    connectionId=(await prisma.repositoryConnection.create({data:{organizationId:orgId,projectId,actorId,configurationId:configId,provider:"gitlab",origin,stateHash:key,status:"VERIFIED",accountLabel:"synthetic-user",authorizationExpiresAt:new Date(0),tokenExpiresAt:new Date(0),verifiedAt:new Date(),encryptedToken:{...encryptToken("old-access")},encryptedVerifier:{...encryptToken(JSON.stringify({version:"gitlab-refresh/v1",refreshToken:"old-refresh",accountId:"17",redirectUri}))},catalog:[{id:"101",name:"team/repo",url:`${origin}/team/repo`,defaultBranch:"main"}],catalogAt:new Date()}})).id;
    await prisma.projectRepository.create({data:{projectId,provider:"gitlab",url:`${origin}/team/repo`,externalId:"101",connectionId,verifiedAt:new Date()}});
    vi.mocked(refreshGitlabAuthorization).mockResolvedValue({token:"next-access",expiresAt:new Date(Date.now()+7200000),accountLabel:"synthetic-user",renewal:{refreshToken:"next-refresh",accountId:"17",redirectUri}});
  });
  afterEach(()=>vi.unstubAllEnvs()); // Owned synthetic DB/failed evidence deliberately retained.
  it("rotates encrypted credentials atomically and preserves every registered repository",async()=>{
    expect(await caller.status({id:connectionId})).toMatchObject({status:"EXPIRED",canRenew:true});
    await expect(caller.renewGitlab(request())).resolves.toMatchObject({renewed:true,id:connectionId});
    const saved=await row();expect(saved.status).toBe("VERIFIED");expect(saved.catalog).toBeNull();
    expect(decryptToken(saved.encryptedToken as unknown as EncryptedToken)).toBe("next-access");
    expect(JSON.parse(decryptToken(saved.encryptedVerifier as unknown as EncryptedToken))).toMatchObject({refreshToken:"next-refresh",accountId:"17"});
    expect(JSON.stringify(saved)).not.toContain("next-refresh");expect(JSON.stringify(saved)).not.toContain("next-access");
    expect(await prisma.projectRepository.count({where:{connectionId}})).toBe(1);
    expect(await caller.status({id:connectionId})).toMatchObject({status:"VERIFIED",canRenew:true});
  });
  it("admits only one simultaneous exchange and blocks disconnect while rotation is in flight",async()=>{
    let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
    let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
    vi.mocked(refreshGitlabAuthorization).mockImplementationOnce(async()=>{entered();await barrier;return{token:"next-access",expiresAt:new Date(Date.now()+7200000),accountLabel:"synthetic-user",renewal:{refreshToken:"next-refresh",accountId:"17",redirectUri}};});
    const first=caller.renewGitlab(request());await started;
    await expect(caller.renewGitlab(request())).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    await expect(caller.disconnect({id:connectionId})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    release();await first;expect(refreshGitlabAuthorization).toHaveBeenCalledTimes(1);
  });
  it("retains an unknown exchange and refuses retries, false verification and old-token disconnect",async()=>{
    vi.mocked(refreshGitlabAuthorization).mockRejectedValue(new Error("ambiguous synthetic timeout"));
    await expect(caller.renewGitlab(request())).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect((await row()).status).toBe("REFRESH_UNKNOWN");expect(decryptToken((await row()).encryptedToken as unknown as EncryptedToken)).toBe("old-access");
    await expect(caller.renewGitlab(request())).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    await expect(caller.disconnect({id:connectionId})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(refreshGitlabAuthorization).toHaveBeenCalledTimes(1);expect(revokeGitlabAuthorization).not.toHaveBeenCalled();
    expect((await caller.mine({projectId})).some(connection=>connection.id===connectionId&&connection.status==="REFRESH_UNKNOWN")).toBe(true);
  });
  it.each(["missing-refresh","foreign-workspace","stale-clerk","suspended","read-only"])("refuses %s before any provider call",async mode=>{
    const input=request();
    if(mode==="missing-refresh")await prisma.repositoryConnection.update({where:{id:connectionId},data:{encryptedVerifier:Prisma.DbNull}});
    if(mode==="foreign-workspace")input.originalOrganizationId="foreign";
    if(mode==="stale-clerk")await prisma.user.update({where:{id:actorId},data:{clerkUserId:randomUUID()}});
    if(mode==="suspended")await prisma.organization.update({where:{id:orgId},data:{suspendedAt:new Date()}});
    if(mode==="read-only")await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:actorId}},data:{seatType:"READ_ONLY"}});
    await expect(caller.renewGitlab(input)).rejects.toThrow();expect(refreshGitlabAuthorization).not.toHaveBeenCalled();
  });
  it("revokes a rotated grant if the current actor loses access before saving",async()=>{
    vi.mocked(refreshGitlabAuthorization).mockImplementationOnce(async()=>{await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:actorId}},data:{seatType:"READ_ONLY"}});return{token:"next-access",expiresAt:new Date(Date.now()+7200000),accountLabel:"synthetic-user",renewal:{refreshToken:"next-refresh",accountId:"17",redirectUri}};});
    await expect(caller.renewGitlab(request())).rejects.toThrow();expect(revokeGitlabAuthorization).toHaveBeenCalledWith(expect.objectContaining({token:"next-access",clientId:"synthetic-client"}));
    expect((await row()).status).toBe("FAILED");expect((await row()).encryptedToken).toBeNull();
  });
});
