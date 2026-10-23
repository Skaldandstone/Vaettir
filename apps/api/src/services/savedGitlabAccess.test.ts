import {beforeEach,describe,expect,it,vi} from "vitest";
import type {Prisma} from "@vaettir/db";
import type {Context} from "../trpc.js";
import {ensureSavedGitlabAccess} from "./savedGitlabAccess.js";
import {lockCaseFieldProject} from "./caseFields.js";
import {lockCurrentCaseFieldActor} from "./caseFieldReadScope.js";
import {refreshGitlabAuthorization,revokeGitlabAuthorization,repositoryOAuthRedirect} from "./gitlabRepositoryOAuth.js";
import {repositoryProviderJson} from "./repositoryProviderHttp.js";
import {decryptToken} from "./tokenEncryption.js";

vi.mock("./caseFields.js",()=>({lockCaseFieldProject:vi.fn()}));
vi.mock("./caseFieldReadScope.js",()=>({lockCurrentCaseFieldActor:vi.fn()}));
vi.mock("./tokenEncryption.js",()=>({encryptToken:(token:string)=>({ciphertext:token,iv:"synthetic",authTag:"synthetic"}),decryptToken:vi.fn((value:{ciphertext:string})=>value.ciphertext)}));
vi.mock("./repositoryProviderHttp.js",async original=>({...await original<typeof import("./repositoryProviderHttp.js")>(),repositoryProviderJson:vi.fn()}));
vi.mock("./gitlabRepositoryOAuth.js",async original=>({...await original<typeof import("./gitlabRepositoryOAuth.js")>(),refreshGitlabAuthorization:vi.fn(),revokeGitlabAuthorization:vi.fn(),repositoryOAuthRedirect:vi.fn()}));
const origin="https://gitlab.synthetic.example",redirect="https://vaettir.synthetic.example/connections/gitlab/callback";
const input={projectId:"project-a",repositoryId:"repo-a",originalOrganizationId:"org-a",expectedNativeActorId:"native-a",expectedClerkActorId:"clerk-a"};
const encrypt=(ciphertext:string)=>({ciphertext,iv:"synthetic",authTag:"synthetic"});
const marker={accessMethod:"gitlab-token/v1",requestHash:"a".repeat(64)};
const renewal={version:"gitlab-refresh/v1",refreshToken:"old-refresh",accountId:"17",redirectUri:redirect};

function fixture(pat=false,fresh=false){
  const row={id:"connection-a",provider:"gitlab",projectId:"project-a",organizationId:"org-a",actorId:"native-a",origin,configurationId:pat?null:"config-a",status:"VERIFIED",verifiedAt:new Date(1),tokenExpiresAt:new Date(fresh?Date.now()+3600000:1),encryptedToken:encrypt("old-access") as Prisma.JsonValue,encryptedVerifier:(pat?marker:encrypt(JSON.stringify(renewal))) as Prisma.JsonValue};
  const repo={id:"repo-a",projectId:"project-a",provider:"gitlab",connectionId:row.id,url:origin+"/team/repo",externalId:"47"};
  const config={id:"config-a",organizationId:"org-a",provider:"gitlab",origin,clientId:"original-client",encryptedSecret:encrypt("original-secret")};
  const updates:unknown[]=[];
  const tx={
    $queryRaw:vi.fn(async()=>[]),project:{findUniqueOrThrow:vi.fn(async()=>({organizationId:"org-a"}))},
    projectRepository:{findFirst:vi.fn(async({where}:{where:{id:string;projectId:string}})=>where.id===repo.id&&where.projectId===repo.projectId?structuredClone({...repo,connection:row}):null)},
    repositoryProviderConfiguration:{findFirst:vi.fn(async()=>structuredClone(config))},
    repositoryConnection:{update:vi.fn(async({data}:{data:Record<string,unknown>})=>{updates.push(data);Object.assign(row,data);}),
      updateMany:vi.fn(async({where,data}:{where:Record<string,unknown>;data:Record<string,unknown>})=>{
        const matches=Object.entries(where).every(([key,value])=>{
          const actual=(row as Record<string,unknown>)[key];
          if(value&&typeof value==="object"&&"equals"in value)return JSON.stringify(actual)===JSON.stringify(value.equals);
          return value instanceof Date?actual instanceof Date&&actual.getTime()===value.getTime():actual===value;
        });
        if(!matches)return{count:0};updates.push(data);Object.assign(row,data);return{count:1};
      })},
  };
  const ctx={prisma:{$transaction:async(body:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>body(tx as unknown as Prisma.TransactionClient),repositoryConnection:tx.repositoryConnection},user:{id:"native-a",clerkUserId:"clerk-a"},authenticatedClerkSubject:"clerk-a"} as unknown as Context&{user:NonNullable<Context["user"]>};
  return{row,repo,config,tx,updates,ctx,ensure:(value=input)=>ensureSavedGitlabAccess(ctx,value)};
}
beforeEach(()=>{
  vi.resetAllMocks();vi.mocked(decryptToken).mockImplementation(value=>value.ciphertext);
  vi.mocked(repositoryOAuthRedirect).mockReturnValue(redirect);
  vi.mocked(refreshGitlabAuthorization).mockResolvedValue({token:"next-access",expiresAt:new Date(Date.now()+3600000),accountLabel:"synthetic",renewal:{refreshToken:"next-refresh",accountId:"17",redirectUri:redirect}});
  vi.mocked(repositoryProviderJson).mockImplementation(async(_origin,path)=>path==="/api/v4/user"?{id:17,username:"synthetic"}:{id:47,web_url:origin+"/team/repo",path_with_namespace:"team/repo"});
});
describe("saved GitLab grant continuity",()=>{
  it("reuses a current grant without decryption, provider I/O or registration writes",async()=>{
    const f=fixture(false,true),repo=structuredClone(f.repo);expect(await f.ensure()).toMatchObject({connectionId:"connection-a",renewed:false,reused:true});
    expect(decryptToken).not.toHaveBeenCalled();expect(refreshGitlabAuthorization).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();expect(f.updates).toHaveLength(0);expect(f.repo).toEqual(repo);
  });
  it("renews SAME OAuth connection once then reuses it across later workflows",async()=>{
    const f=fixture(),repo=structuredClone(f.repo);expect(await f.ensure()).toMatchObject({renewed:true,...input});expect(await f.ensure()).toMatchObject({renewed:false});
    expect(refreshGitlabAuthorization).toHaveBeenCalledOnce();expect(f.row.status).toBe("VERIFIED");expect(f.repo).toEqual(repo);expect(JSON.stringify(await f.ensure())).not.toMatch(/next-access|next-refresh|original-secret|ciphertext/);
  });
  it("does not start a duplicate rotating exchange while original claim is in flight",async()=>{
    const f=fixture();let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});let started!:()=>void;const entered=new Promise<void>(resolve=>{started=resolve;});
    vi.mocked(refreshGitlabAuthorization).mockImplementationOnce(async()=>{started();await barrier;return{token:"next",expiresAt:new Date(Date.now()+3600000),accountLabel:"synthetic",renewal:{refreshToken:"next-refresh",accountId:"17",redirectUri:redirect}};});
    const first=f.ensure();try{await entered;await expect(f.ensure()).rejects.toThrow("in progress or unconfirmed");expect(refreshGitlabAuthorization).toHaveBeenCalledOnce();}finally{release();}await first;
  });
  it("rechecks SAME stored PAT bytes with user/native metadata and renews only LOCAL eight-hour window",async()=>{
    const f=fixture(true),secret=structuredClone(f.row.encryptedToken),repo=structuredClone(f.repo);expect(await f.ensure()).toMatchObject({accessMethod:"token",renewed:true});
    expect(vi.mocked(repositoryProviderJson).mock.calls.map(call=>call[1])).toEqual(["/api/v4/user","/api/v4/projects/47"]);expect(refreshGitlabAuthorization).not.toHaveBeenCalled();expect(f.row.encryptedToken).toEqual(secret);expect(f.row.encryptedVerifier).toEqual(marker);expect(f.repo).toEqual(repo);
    expect(f.row.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now()+28799000);expect(f.row.tokenExpiresAt.getTime()).toBeLessThanOrEqual(Date.now()+28800000);
  });
  it.each([null,{accessMethod:"unknown"}])("refuses missing refresh or malformed mechanism before provider I/O: %o",async verifier=>{
    const f=fixture();f.row.encryptedVerifier=verifier;await expect(f.ensure()).rejects.toThrow();expect(refreshGitlabAuthorization).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();expect(f.updates).toHaveLength(0);
  });
  it.each(["projectId","repositoryId","originalOrganizationId","expectedNativeActorId","expectedClerkActorId"] as const)("refuses changed original %s before provider I/O",async field=>{
    const f=fixture();await expect(f.ensure({...input,[field]:"other"})).rejects.toThrow();expect(refreshGitlabAuthorization).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("sanitizes malformed decrypted refresh JSON without secret excerpts or cause",async()=>{
    const f=fixture();f.row.encryptedVerifier=encrypt('{"refreshToken":"PRIVATE-SYNTHETIC-REFRESH');
    const error=await f.ensure().catch((value:unknown)=>value);expect(error).toMatchObject({code:"PRECONDITION_FAILED",message:"Saved GitLab renewal information is unavailable. Review the original grant before reconnecting."});expect(error).toHaveProperty("cause",undefined);expect(String(error)).not.toContain("PRIVATE-SYNTHETIC");expect(refreshGitlabAuthorization).not.toHaveBeenCalled();expect(f.updates).toHaveLength(0);
  });
  it("quarantines refused PAT metadata without extending expiry or automatically retrying",async()=>{
    const f=fixture(true);vi.mocked(repositoryProviderJson).mockResolvedValue({id:48,username:"synthetic",web_url:f.repo.url,path_with_namespace:"team/repo"});await expect(f.ensure()).rejects.toThrow("could not be confirmed");expect(f.row.status).toBe("REFRESH_UNKNOWN");expect(f.row.tokenExpiresAt.getTime()).toBe(1);const calls=vi.mocked(repositoryProviderJson).mock.calls.length;await expect(f.ensure()).rejects.toThrow();expect(repositoryProviderJson).toHaveBeenCalledTimes(calls);expect(revokeGitlabAuthorization).not.toHaveBeenCalled();
  });
  it("revokes an issued OAuth token after current authorization loss without publishing ACK",async()=>{
    const f=fixture();vi.mocked(refreshGitlabAuthorization).mockImplementationOnce(async()=>{vi.mocked(lockCaseFieldProject).mockRejectedValue(new Error("synthetic revoked"));return{token:"next-access",expiresAt:new Date(Date.now()+3600000),accountLabel:"synthetic",renewal:{refreshToken:"next-refresh",accountId:"17",redirectUri:redirect}};});
    await expect(f.ensure()).rejects.toThrow();expect(revokeGitlabAuthorization).toHaveBeenCalledWith({origin,clientId:"original-client",clientSecret:"original-secret",token:"next-access"});expect(f.row.status).toBe("FAILED");
  });
  it("preserves a replacement credential during provider I/O instead of stale save/quarantine",async()=>{
    const f=fixture();vi.mocked(refreshGitlabAuthorization).mockImplementationOnce(async()=>{f.row.encryptedToken=encrypt("replacement");return{token:"next-access",expiresAt:new Date(Date.now()+3600000),accountLabel:"synthetic",renewal:{refreshToken:"next-refresh",accountId:"17",redirectUri:redirect}};});
    await expect(f.ensure()).rejects.toThrow();expect(f.row.encryptedToken).toEqual(encrypt("replacement"));expect(f.row.status).toBe("REFRESHING");expect(revokeGitlabAuthorization).toHaveBeenCalledOnce();
  });
  it("independently checks current actor mapping in each native transaction",async()=>{
    const f=fixture();vi.mocked(lockCurrentCaseFieldActor).mockRejectedValue(new Error("synthetic mapping changed"));await expect(f.ensure()).rejects.toThrow();expect(refreshGitlabAuthorization).not.toHaveBeenCalled();
  });
  it("refuses a captured client connection pin after replacement without provider I/O",async()=>{
    const f=fixture();await expect(ensureSavedGitlabAccess(f.ctx,{...input,expectedConnectionId:"other-connection"})).rejects.toMatchObject({code:"CONFLICT"});expect(refreshGitlabAuthorization).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("refuses unavailable original application even for a locally fresh grant",async()=>{
    const f=fixture(false,true);f.tx.repositoryProviderConfiguration.findFirst.mockResolvedValue(null as unknown as typeof f.config);
    await expect(f.ensure()).rejects.toThrow("original GitLab application is unavailable");expect(decryptToken).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();expect(refreshGitlabAuthorization).not.toHaveBeenCalled();
  });
});
