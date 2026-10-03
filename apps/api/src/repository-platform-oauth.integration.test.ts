import {randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {prisma,type OrgRole,type SeatType} from "@vaettir/db";
import {repositoryConnectionsRouter} from "./routers/repositoryConnections.js";
import {verifyGitlabAuthorization,revokeGitlabAuthorization} from "./services/gitlabRepositoryOAuth.js";
import {verifyGithubAuthorization,revokeGithubAuthorization} from "./services/githubRepositoryOAuth.js";
import {decryptToken,type EncryptedToken} from "./services/tokenEncryption.js";
import type {Context} from "./trpc.js";
vi.mock("./services/gitlabRepositoryOAuth.js",async original=>({...await original<typeof import("./services/gitlabRepositoryOAuth.js")>(),verifyGitlabAuthorization:vi.fn(),revokeGitlabAuthorization:vi.fn().mockResolvedValue(undefined)}));
vi.mock("./services/githubRepositoryOAuth.js",async original=>({...await original<typeof import("./services/githubRepositoryOAuth.js")>(),verifyGithubAuthorization:vi.fn(),revokeGithubAuthorization:vi.fn().mockResolvedValue(undefined)}));
const database=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
const isolated=database&&["localhost","127.0.0.1"].includes(database.hostname)&&/test/i.test(database.pathname)&&!database.searchParams.has("host");
const original={gitlab:{clientId:"synthetic-gitlab-app",clientSecret:"synthetic-gitlab-secret-not-live"},github:{clientId:"synthetic-github-app",clientSecret:"synthetic-github-secret-not-live"}};
describe.skipIf(!isolated)("tenant-local hosted application snapshots (synthetic disposable DB)",()=>{
  let organizationId:string,projectId:string;
  const organizations:string[]=[];const actors:string[]=[];
  // Distinct stable project keys allow a synthetic cross-tenant reparent to
  // exercise live authorization checks rather than stop at key uniqueness.
  async function organization(){const key=randomUUID();const tier=await prisma.planTier.findUniqueOrThrow({where:{key:"free"}});const org=await prisma.organization.create({data:{name:key,slug:`platform-${key}`,planTierId:tier.id}});organizations.push(org.id);const project=await prisma.project.create({data:{organizationId:org.id,name:"Synthetic hosted OAuth",slug:"platform",caseKey:`oauth-${organizations.length}`}});return{organizationId:org.id,projectId:project.id};}
  async function actor(role:OrgRole="OWNER",seatType:SeatType="FULL",orgId=organizationId){const key=randomUUID();const user=await prisma.user.create({data:{clerkUserId:key,email:`platform-${key}@example.com`,memberships:{create:{organizationId:orgId,role,seatType}}},include:{memberships:true}});actors.push(user.id);const ctx:Context&{user:typeof user}={prisma,user,staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}};return{ctx,user,caller:repositoryConnectionsRouter.createCaller(ctx)};}
  let owner:Awaited<ReturnType<typeof actor>>,editor:typeof owner,viewer:typeof owner,readOnly:typeof owner;
  beforeEach(async()=>{
    vi.clearAllMocks();for(const provider of ["gitlab","github"] as const){vi.stubEnv(`${provider.toUpperCase()}_OAUTH_CLIENT_ID`,original[provider].clientId);vi.stubEnv(`${provider.toUpperCase()}_OAUTH_CLIENT_SECRET`,original[provider].clientSecret);}
    vi.stubEnv("WEB_APP_URL","https://vaettir.synthetic.example");vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,8).toString("base64"));
    ({organizationId,projectId}=await organization());owner=await actor();editor=await actor("EDITOR");viewer=await actor("VIEWER");readOnly=await actor("ADMIN","READ_ONLY");
    const verified={token:"synthetic-access-token-not-live",expiresAt:new Date(Date.now()+3600000),accountLabel:"synthetic-account"};vi.mocked(verifyGitlabAuthorization).mockResolvedValue(verified);vi.mocked(verifyGithubAuthorization).mockResolvedValue(verified);
  });
  afterEach(async()=>{
    await prisma.repositoryConnection.deleteMany({where:{organizationId:{in:organizations}}});await prisma.repositoryProviderConfiguration.deleteMany({where:{organizationId:{in:organizations}}});await prisma.project.deleteMany({where:{organizationId:{in:organizations}}});await prisma.membership.deleteMany({where:{organizationId:{in:organizations}}});await prisma.organization.deleteMany({where:{id:{in:organizations}}});await prisma.user.deleteMany({where:{id:{in:actors}}});organizations.length=0;actors.length=0;vi.unstubAllEnvs();
  });
  const request=(provider:"gitlab"|"github"="gitlab",project=projectId)=>({projectId:project,configurationId:`platform:${provider}`,approveMetadataAccess:true as const});
  it("reports ready descriptors without query writes or credential disclosure",async()=>{
    const result=await owner.caller.configurations({projectId});expect(result.configurations).toEqual([{id:"platform:gitlab",provider:"gitlab",origin:"https://gitlab.com"},{id:"platform:github",provider:"github",origin:"https://github.com"}]);expect(JSON.stringify(result)).not.toContain("synthetic-gitlab");expect(JSON.stringify(result)).not.toContain("synthetic-github");expect(await prisma.repositoryProviderConfiguration.count({where:{organizationId}})).toBe(0);expect(await prisma.repositoryConnection.count({where:{organizationId}})).toBe(0);expect(verifyGitlabAuthorization).not.toHaveBeenCalled();expect(verifyGithubAuthorization).not.toHaveBeenCalled();
  });
  it("hides incomplete env or unavailable encryption/callback readiness without writes",async()=>{
    vi.stubEnv("GITLAB_OAUTH_CLIENT_SECRET","");expect((await owner.caller.configurations({projectId})).configurations.map(row=>row.id)).toEqual(["platform:github"]);await expect(editor.caller.begin(request())).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    vi.stubEnv("GITHUB_OAUTH_CLIENT_ID","");expect((await owner.caller.configurations({projectId})).configurations).toEqual([]);vi.stubEnv("GITLAB_OAUTH_CLIENT_SECRET",original.gitlab.clientSecret);vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY","");expect((await owner.caller.configurations({projectId})).configurations).toEqual([]);await expect(editor.caller.begin(request())).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,8).toString("base64"));vi.stubEnv("WEB_APP_URL","");expect((await owner.caller.configurations({projectId})).configurations).toEqual([]);expect(await prisma.repositoryProviderConfiguration.count({where:{organizationId}})).toBe(0);
  });
  it("creates encrypted immutable tenant snapshot only on full editor explicit approval",async()=>{
    for(const denied of [viewer,readOnly])await expect(denied.caller.begin(request())).rejects.toMatchObject({code:"FORBIDDEN"});await expect(editor.caller.begin({...request(),approveMetadataAccess:false as never})).rejects.toMatchObject({code:"BAD_REQUEST"});expect(await prisma.repositoryProviderConfiguration.count({where:{organizationId}})).toBe(0);
    const begun=await editor.caller.begin(request());const connection=await prisma.repositoryConnection.findUniqueOrThrow({where:{id:begun.id}});const snapshot=await prisma.repositoryProviderConfiguration.findUniqueOrThrow({where:{id:connection.configurationId!}});expect(snapshot).toMatchObject({organizationId,provider:"gitlab",origin:"https://gitlab.com",clientId:original.gitlab.clientId,createdById:editor.user.id});expect(JSON.stringify(snapshot.encryptedSecret)).not.toContain(original.gitlab.clientSecret);expect(decryptToken(snapshot.encryptedSecret as unknown as EncryptedToken)).toBe(original.gitlab.clientSecret);expect(new URL(begun.url).searchParams.get("scope")).toBe("read_api");expect(new URL(begun.url).searchParams.get("code_challenge_method")).toBe("S256");expect(await prisma.repositoryProviderConfiguration.count({where:{organizationId}})).toBe(1);
  });
  it("blocks cached-context role downgrade or project tenant change before snapshots",async()=>{
    await prisma.membership.update({where:{organizationId_userId:{organizationId,userId:editor.user.id}},data:{role:"VIEWER"}});await expect(editor.caller.begin(request())).rejects.toMatchObject({code:"FORBIDDEN"});expect(await prisma.repositoryProviderConfiguration.count({where:{organizationId}})).toBe(0);
    const other=await organization();await prisma.project.update({where:{id:projectId},data:{organizationId:other.organizationId,slug:"reparented-platform"}});await expect(owner.caller.begin(request())).rejects.toMatchObject({code:"FORBIDDEN"});expect(await prisma.repositoryProviderConfiguration.count({where:{organizationId:{in:organizations}}})).toBe(0);
  });
  it("serializes repeated authorization and shares one tenant config across distinct editors",async()=>{
    const repeated=await Promise.allSettled(Array.from({length:5},()=>editor.caller.begin(request())));expect(repeated.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(await prisma.repositoryProviderConfiguration.count({where:{organizationId}})).toBe(1);expect(await prisma.repositoryConnection.count({where:{organizationId}})).toBe(1);
    await owner.caller.begin(request());expect(await prisma.repositoryProviderConfiguration.count({where:{organizationId}})).toBe(1);const connections=await prisma.repositoryConnection.findMany({where:{organizationId}});expect(new Set(connections.map(row=>row.configurationId)).size).toBe(1);
  });
  it("creates independent tenant snapshots and never accepts another tenant config ID",async()=>{
    const first=await owner.caller.begin(request("github"));const other=await organization();const otherOwner=await actor("OWNER","FULL",other.organizationId);const second=await otherOwner.caller.begin(request("github",other.projectId));const rows=await prisma.repositoryConnection.findMany({where:{id:{in:[first.id,second.id]}}});expect(new Set(rows.map(row=>row.configurationId)).size).toBe(2);const firstConfig=rows.find(row=>row.id===first.id)!.configurationId!;await expect(otherOwner.caller.begin({projectId:other.projectId,configurationId:firstConfig,approveMetadataAccess:true})).rejects.toMatchObject({code:"NOT_FOUND"});
  });
  it("preserves manual hosted and self-hosted application configuration preferentially",async()=>{
    const manual=await owner.caller.configureGitlab({projectId,origin:"https://gitlab.com",clientId:"manual-hosted-client",clientSecret:"manual-hosted-secret"});const selfHosted=await owner.caller.configureGitlab({projectId,origin:"https://gitlab.synthetic.example",clientId:"manual-private-client",clientSecret:"manual-private-secret"});const before=await prisma.repositoryProviderConfiguration.findMany({where:{organizationId},orderBy:{id:"asc"}});expect((await editor.caller.configurations({projectId})).configurations.some(row=>row.id==="platform:gitlab")).toBe(false);
    const begun=await editor.caller.begin(request());expect(new URL(begun.url).searchParams.get("client_id")).toBe("manual-hosted-client");expect((await prisma.repositoryConnection.findUniqueOrThrow({where:{id:begun.id}})).configurationId).toBe(manual.id);const privateBegin=await editor.caller.begin({projectId,configurationId:selfHosted.id,approveMetadataAccess:true});expect(new URL(privateBegin.url).origin).toBe("https://gitlab.synthetic.example");expect(await prisma.repositoryProviderConfiguration.findMany({where:{organizationId},orderBy:{id:"asc"}})).toEqual(before);
  });
  for(const provider of ["gitlab","github"] as const)it(`keeps original ${provider} credentials for pending finish and disconnect after env rotation`,async()=>{
    const begun=await editor.caller.begin(request(provider));const state=new URL(begun.url).searchParams.get("state")!;vi.stubEnv(`${provider.toUpperCase()}_OAUTH_CLIENT_ID`,"rotated-client-id");vi.stubEnv(`${provider.toUpperCase()}_OAUTH_CLIENT_SECRET`,"rotated-client-secret");await editor.caller.finish({state,code:"synthetic-code"});const verifier=provider==="gitlab"?verifyGitlabAuthorization:verifyGithubAuthorization;expect(verifier).toHaveBeenCalledWith(expect.objectContaining(original[provider]));await editor.caller.disconnect({id:begun.id});const revoke=provider==="gitlab"?revokeGitlabAuthorization:revokeGithubAuthorization;expect(revoke).toHaveBeenCalledWith(expect.objectContaining(original[provider]));expect((await prisma.repositoryProviderConfiguration.findFirstOrThrow({where:{organizationId,provider}})).clientId).toBe(original[provider].clientId);
  });
  it("prevents application removal while an authorization is pending and rolls back missing config begin",async()=>{
    const begun=await editor.caller.begin(request());const row=await prisma.repositoryConnection.findUniqueOrThrow({where:{id:begun.id}});await expect(owner.caller.removeConfiguration({projectId,configurationId:row.configurationId!,confirmed:true})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect(await prisma.repositoryProviderConfiguration.count({where:{organizationId}})).toBe(1);await expect(editor.caller.begin({projectId,configurationId:"missing-config",approveMetadataAccess:true})).rejects.toMatchObject({code:"NOT_FOUND"});
  });
  it("serializes configuration removal against begin without orphaned authorizations",async()=>{
    const manual=await owner.caller.configureGithub({projectId,clientId:"manual-race-client",clientSecret:"manual-race-secret"});
    const [authorization,removal]=await Promise.allSettled([
      editor.caller.begin({projectId,configurationId:manual.id,approveMetadataAccess:true}),
      owner.caller.removeConfiguration({projectId,configurationId:manual.id,confirmed:true}),
    ]);
    const config=await prisma.repositoryProviderConfiguration.findUnique({where:{id:manual.id}});
    const connections=await prisma.repositoryConnection.findMany({where:{organizationId}});
    if(authorization.status==="fulfilled"){
      expect(removal).toMatchObject({status:"rejected",reason:{code:"PRECONDITION_FAILED"}});expect(config).not.toBeNull();expect(connections).toHaveLength(1);expect(connections[0]!.configurationId).toBe(manual.id);
    }else{
      expect(authorization.reason).toMatchObject({code:"NOT_FOUND"});expect(removal.status).toBe("fulfilled");expect(config).toBeNull();expect(connections).toEqual([]);
    }
  });
  it("does not snapshot application credentials after a locked live seat downgrade",async()=>{
    let signalLocked!:()=>void;let releaseLock!:()=>void;
    const locked=new Promise<void>(resolve=>{signalLocked=resolve;});const release=new Promise<void>(resolve=>{releaseLock=resolve;});
    const changing=prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
      await tx.membership.update({where:{organizationId_userId:{organizationId,userId:editor.user.id}},data:{seatType:"READ_ONLY"}});signalLocked();await release;
    });
    await locked;const begun=editor.caller.begin(request());releaseLock();await changing;
    await expect(begun).rejects.toMatchObject({code:"FORBIDDEN"});expect(await prisma.repositoryProviderConfiguration.count({where:{organizationId}})).toBe(0);expect(await prisma.repositoryConnection.count({where:{organizationId}})).toBe(0);
  });
  it("enforces the actor attempt limit before a new tenant credential snapshot",async()=>{
    await prisma.repositoryConnection.createMany({data:Array.from({length:20},()=>({projectId,organizationId,actorId:editor.user.id,provider:"gitlab",origin:"https://gitlab.com",stateHash:randomUUID(),status:"FAILED",authorizationExpiresAt:new Date(Date.now()-1000)}))});
    await expect(editor.caller.begin(request())).rejects.toMatchObject({code:"TOO_MANY_REQUESTS"});expect(await prisma.repositoryProviderConfiguration.count({where:{organizationId}})).toBe(0);expect(await prisma.repositoryConnection.count({where:{organizationId}})).toBe(20);
  });
});
