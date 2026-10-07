import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient, type RepositoryConnection } from "@vaettir/db";
import { repositoryConnectionsRouter } from "../routers/repositoryConnections.js";
import type { Context } from "../trpc.js";
import { encryptToken, decryptToken, type EncryptedToken } from "./tokenEncryption.js";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";
import { hashOAuthState } from "./gitlabRepositoryOAuth.js";
vi.mock("./repositoryProviderHttp.js", async importOriginal => ({
  ...await importOriginal<typeof import("./repositoryProviderHttp.js")>(), repositoryProviderJson: vi.fn(),
}));
const origin="https://gitlab.synthetic.example",token="synthetic-catalogue-access-token",now=new Date("2026-10-07T03:00:00.000Z");
const selection=(index:number)=>({id:String(index+1),name:`synthetic/team/repo-${index+1}`,url:`${origin}/synthetic/team/repo-${index+1}`,defaultBranch:"main"});
const native=(index:number)=>({id:index+1,path_with_namespace:`synthetic/team/repo-${index+1}`,web_url:`${origin}/synthetic/team/repo-${index+1}`,default_branch:"main"});
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
  vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,8).toString("base64"));
  vi.mocked(repositoryProviderJson).mockImplementation(async (_origin,path)=>{
    const page=Number(new URL(path,origin).searchParams.get("page")??1);
    return Array.from({length:100},(_,index)=>native((page-1)*100+index));
  });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});

// Real registered list/connectSelected callbacks, auth helper and AES codec.
// Native selectors/provider responses are synthetic; no locks/DB/provider proof.
function fixture(initialCount=500){
  const row:RepositoryConnection={id:"connection",projectId:"project",organizationId:"organization",actorId:"actor",configurationId:null,provider:"gitlab",origin,
    stateHash:"a".repeat(64),encryptedVerifier:{accessMethod:"gitlab-token/v1",requestHash:"b".repeat(64)},encryptedToken:encryptToken(token) as unknown as Prisma.JsonValue,
    status:"VERIFIED",accountLabel:"synthetic-user",authorizationExpiresAt:new Date(now.getTime()+600000),tokenExpiresAt:new Date(now.getTime()+28800000),verifiedAt:new Date(now.getTime()-300000),
    catalog:Array.from({length:initialCount},(_,id)=>selection(id)),catalogAt:new Date(now.getTime()-300000),createdAt:new Date(now.getTime()-300000)};
  const member={id:"membership",organizationId:"organization",userId:"actor",role:"OWNER",seatType:"FULL"},organization={suspendedAt:null as Date|null};
  const writes=vi.fn(async ()=>({id:"synthetic-link"})),catalogueUpdate=vi.fn(async({data}:Prisma.RepositoryConnectionUpdateArgs)=>{
    Object.assign(row,data);return row;
  });
  const db={project:{findUnique:vi.fn(async()=>({id:"project",organizationId:"organization"}))},organization:{findUnique:vi.fn(async()=>organization)},membership:{findUnique:vi.fn(async()=>member)},
    $queryRaw:vi.fn(async(strings:TemplateStringsArray)=>strings.join("").includes('"Organization"')?[organization]:[]),
    repositoryConnection:{findFirst:vi.fn(async()=>row),findUniqueOrThrow:vi.fn(async()=>row),update:catalogueUpdate},
    projectRepository:{findUnique:vi.fn(async()=>null),findMany:vi.fn(async()=>[]),create:writes,update:writes},
    $transaction:async(callback:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>callback(db as unknown as Prisma.TransactionClient)};
  const user={id:"actor",clerkUserId:"clerk",email:"synthetic@example.invalid",memberships:[{...member}]};
  const ctx={prisma:db as unknown as PrismaClient,user,authenticatedClerkSubject:"clerk",staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}} as unknown as Context;
  return{caller:repositoryConnectionsRouter.createCaller(ctx),row,db,user,member,organization,writes,catalogueUpdate};
}

describe("explicit metadata-only repository catalogue restart",()=>{
  it("default request still accumulates visited pages and refuses a 501+ catalogue without altering it",async()=>{
    const f=fixture(),before=structuredClone(f.row);
    await expect(f.caller.list({id:f.row.id,page:6})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(f.row).toEqual(before);expect(f.catalogueUpdate).not.toHaveBeenCalled();expect(f.writes).not.toHaveBeenCalled();
    expect(repositoryProviderJson).toHaveBeenCalledExactlyOnceWith(origin,expect.stringContaining("page=6"),{token});
  });
  it("deliberate restart admits only the current verified page with new timestamp/version and unchanged saved access",async()=>{
    const f=fixture(),before=structuredClone(f.row),old=await f.caller.list({id:f.row.id,page:5}),previousAt=f.row.catalogAt;
    const restarted=await f.caller.list({id:f.row.id,page:6,restartCatalogue:true});
    expect(restarted.catalogReset).toBe(true);expect(restarted.catalogVersion).not.toBe(old.catalogVersion);expect(restarted.hasMore).toBe(true);
    expect(restarted.repositories.map(repo=>repo.id)).toEqual(Array.from({length:100},(_,index)=>String(501+index)));
    expect(f.row.catalog).toEqual(Array.from({length:100},(_,index)=>selection(500+index)));expect(f.row.catalogAt).toEqual(now);expect(f.row.catalogAt).not.toEqual(previousAt);
    expect(f.row.encryptedToken).toEqual(before.encryptedToken);expect(decryptToken(f.row.encryptedToken as unknown as EncryptedToken)).toBe(token);
    expect(f.row.encryptedVerifier).toEqual(before.encryptedVerifier);expect(f.row.tokenExpiresAt).toEqual(before.tokenExpiresAt);expect(f.row.status).toBe("VERIFIED");
    expect(f.writes).not.toHaveBeenCalled();expect(f.catalogueUpdate.mock.calls.at(-1)![0].data).toEqual({catalog:restarted.repositories,catalogAt:now});
  });
  it("default listing preserves prior anchor and combines exact IDs without duplicate inflation",async()=>{
    const f=fixture(100),anchor=f.row.catalogAt;
    const second=await f.caller.list({id:f.row.id,page:2});expect(second.catalogReset).toBe(false);expect((f.row.catalog as unknown[]).length).toBe(200);expect(f.row.catalogAt).toEqual(anchor);
    const duplicate=await f.caller.list({id:f.row.id,page:2,restartCatalogue:false});expect(duplicate.catalogReset).toBe(false);expect(duplicate.catalogVersion).toBe(second.catalogVersion);
    expect((f.row.catalog as unknown[]).length).toBe(200);expect(f.row.catalogAt).toEqual(anchor);expect(f.writes).not.toHaveBeenCalled();
  });
  it("new batch retains the 500 visited cap and refuses the next extra page unsliced",async()=>{
    const f=fixture();await f.caller.list({id:f.row.id,page:6,restartCatalogue:true});
    for(let page=7;page<=10;page++)await f.caller.list({id:f.row.id,page});
    expect((f.row.catalog as unknown[]).length).toBe(500);const before=structuredClone(f.row);
    await expect(f.caller.list({id:f.row.id,page:11})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect(f.row).toEqual(before);expect(f.writes).not.toHaveBeenCalled();
  });
  it("old catalogue approval and identities cannot link after restart; current selected-link cap remains 100",async()=>{
    const f=fixture(),old=await f.caller.list({id:f.row.id,page:1}),current=await f.caller.list({id:f.row.id,page:6,restartCatalogue:true});
    await expect(f.caller.connectSelected({id:f.row.id,repositoryIds:["1"],catalogVersion:old.catalogVersion,approved:true})).rejects.toMatchObject({code:"CONFLICT"});
    await expect(f.caller.connectSelected({id:f.row.id,repositoryIds:["1"],catalogVersion:current.catalogVersion,approved:true})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(f.caller.connectSelected({id:f.row.id,repositoryIds:Array.from({length:101},(_,id)=>String(501+id)),catalogVersion:current.catalogVersion,approved:true})).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(f.writes).not.toHaveBeenCalled();
    expect(await f.caller.connectSelected({id:f.row.id,repositoryIds:["501"],catalogVersion:current.catalogVersion,approved:true})).toEqual({connected:1});expect(f.writes).toHaveBeenCalledOnce();
  });
  it.each(["viewer","seat","suspension"])("restart rechecks current %s authority after metadata I/O and leaves previous catalogue unchanged",async mode=>{
    const f=fixture(),before=structuredClone(f.row);vi.mocked(repositoryProviderJson).mockImplementationOnce(async()=>{
      if(mode==="viewer")f.member.role="VIEWER";if(mode==="seat")f.member.seatType="READ_ONLY";if(mode==="suspension")f.organization.suspendedAt=new Date();
      return Array.from({length:100},(_,index)=>native(500+index));
    });
    await expect(f.caller.list({id:f.row.id,page:6,restartCatalogue:true})).rejects.toMatchObject({code:"FORBIDDEN"});expect(f.row).toEqual(before);expect(f.catalogueUpdate).not.toHaveBeenCalled();expect(f.writes).not.toHaveBeenCalled();
  });
  it("provider failure retains the previous catalogue/selection version without partial restart",async()=>{
    const f=fixture(),before=structuredClone(f.row);vi.mocked(repositoryProviderJson).mockRejectedValueOnce(Error("synthetic private provider response"));
    await expect(f.caller.list({id:f.row.id,page:6,restartCatalogue:true})).rejects.toMatchObject({code:"BAD_REQUEST"});expect(f.row).toEqual(before);expect(f.catalogueUpdate).not.toHaveBeenCalled();expect(f.writes).not.toHaveBeenCalled();
  });
  it("credential change during listing cannot restart the catalogue",async()=>{
    const f=fixture(),before=structuredClone(f.row);f.db.repositoryConnection.findUniqueOrThrow.mockImplementationOnce(async()=>f.row).mockImplementationOnce(async()=>({...f.row,encryptedToken:encryptToken("different-synthetic-token") as unknown as Prisma.JsonValue}));
    await expect(f.caller.list({id:f.row.id,page:6,restartCatalogue:true})).rejects.toMatchObject({code:"CONFLICT"});expect(f.row).toEqual(before);expect(f.catalogueUpdate).not.toHaveBeenCalled();expect(f.writes).not.toHaveBeenCalled();
  });
  it("restart does not authorize expired saved credentials or extend the ten-minute approval boundary",async()=>{
    const f=fixture();f.row.tokenExpiresAt=new Date(now.getTime()+10000);
    await expect(f.caller.list({id:f.row.id,page:6,restartCatalogue:true})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect(repositoryProviderJson).not.toHaveBeenCalled();
    f.row.tokenExpiresAt=new Date(now.getTime()+28800000);const page=await f.caller.list({id:f.row.id,page:6,restartCatalogue:true});
    vi.setSystemTime(new Date(now.getTime()+600001));
    await expect(f.caller.connectSelected({id:f.row.id,repositoryIds:["501"],catalogVersion:page.catalogVersion,approved:true})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect(f.writes).not.toHaveBeenCalled();
  });
  it.each([0,-1])("same or regressed catalogue clock (%s ms) fails closed with no future timestamp or old approval replacement",async shift=>{
    const f=fixture();f.row.catalogAt=new Date(now.getTime()-shift);const before=structuredClone(f.row);
    await expect(f.caller.list({id:f.row.id,page:6,restartCatalogue:true})).rejects.toMatchObject({code:"CONFLICT"});expect(f.row).toEqual(before);expect(f.catalogueUpdate).not.toHaveBeenCalled();expect(f.writes).not.toHaveBeenCalled();
  });
  it("malformed restart flag cannot invoke transport or alter the catalogue",async()=>{
    const f=fixture();await expect(f.caller.list({id:f.row.id,restartCatalogue:"true" as never})).rejects.toMatchObject({code:"BAD_REQUEST"});expect(repositoryProviderJson).not.toHaveBeenCalled();expect(f.catalogueUpdate).not.toHaveBeenCalled();
  });
  it("native catalogue version remains the existing exact field-tuple hash, not an authorization or new credential marker",async()=>{
    const f=fixture(),page=await f.caller.list({id:f.row.id,page:6,restartCatalogue:true});
    expect(page.catalogVersion).toBe(hashOAuthState(JSON.stringify([f.row.id,now.toISOString(),page.repositories.map(repo=>[repo.id,repo.name,repo.url,repo.defaultBranch])])));
    expect(page.catalogVersion).toMatch(/^[a-f0-9]{64}$/);expect(f.row.encryptedVerifier).toMatchObject({accessMethod:"gitlab-token/v1"});expect(f.writes).not.toHaveBeenCalled();
  });
});
