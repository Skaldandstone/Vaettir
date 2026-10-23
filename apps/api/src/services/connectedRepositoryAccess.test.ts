import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
import { admitConnectedGitlab, assertGitlabProjectIdentity, connectedSourceBinding, sourceBindingReceipt } from "./connectedRepositoryAccess.js";
import { decryptToken } from "./tokenEncryption.js";
vi.mock("./tokenEncryption.js",()=>({decryptToken:vi.fn(()=>"synthetic-only-token")}));
const input={projectId:"project-a",organizationId:"org-a",actorId:"actor-a",clerkSubject:"clerk-a",repositoryId:"repo-a"};
function database(change:Record<string,unknown>={},repoChange:Record<string,unknown>={}) {
  const connection={id:"connection-a",configurationId:"configuration-a",projectId:input.projectId,organizationId:input.organizationId,actorId:input.actorId,provider:"gitlab",origin:"https://gitlab.synthetic.example",status:"VERIFIED",verifiedAt:new Date(),tokenExpiresAt:new Date(Date.now()+3600000),encryptedToken:{ciphertext:"encrypted",iv:"iv",authTag:"tag"},encryptedVerifier:null,...change};
  const repo={id:"repo-a",projectId:"project-a",connectionId:"connection-a",provider:"gitlab",externalId:"47",url:"https://gitlab.synthetic.example/team/service",connection,...repoChange};
  const tx={projectRepository:{findFirst:vi.fn(async()=>repo)},user:{findUnique:vi.fn(async()=>({clerkUserId:"clerk-a"}))},$queryRaw:vi.fn(async()=>[{id:"synthetic"}])};
  return {tx:tx as unknown as Prisma.TransactionClient,repo,connection,mocks:tx};
}
describe("actor-bound connected repository admission",()=>{
  it("returns only a receipt and defers decryption to the network call",async()=>{
    vi.mocked(decryptToken).mockClear();const db=database();const access=await admitConnectedGitlab(db.tx,input);
    expect(decryptToken).not.toHaveBeenCalled();expect(JSON.stringify(access.binding)).not.toMatch(/encrypted|synthetic-only-token|ciphertext/);
    expect(access.binding).toMatchObject({externalId:"47",repositoryId:"repo-a",actorId:"actor-a"});expect(access.token()).toBe("synthetic-only-token");
    expect(String(db.mocks.$queryRaw.mock.calls[0]![0])).toContain("RepositoryConnection");
    expect(String(db.mocks.$queryRaw.mock.calls[1]![0])).toContain("ProjectRepository");
  });
  it.each([{actorId:"other"},{organizationId:"other"},{projectId:"other"},{status:"DISCONNECTED"},{tokenExpiresAt:new Date(0)},{verifiedAt:null},{provider:"github"}])("refuses revoked, foreign or expired grants before decryption: %o",async patch=>{
    vi.mocked(decryptToken).mockClear();await expect(admitConnectedGitlab(database(patch).tx,input)).rejects.toThrow();expect(decryptToken).not.toHaveBeenCalled();
  });
  it("rejects a remapped transport actor and missing application/token mechanism",async()=>{
    await expect(admitConnectedGitlab(database().tx,{...input,clerkSubject:"another-clerk"})).rejects.toThrow();
    await expect(admitConnectedGitlab(database({configurationId:null}).tx,input)).rejects.toThrow("method");
    await expect(admitConnectedGitlab(database({encryptedVerifier:{accessMethod:"unknown"}}).tx,input)).rejects.toThrow("method");
  });
  it.each([{provider:"git"},{externalId:"not-native"},{url:"https://other.example/team/service"},{connectionId:null}])("refuses conflicting repository identity: %o",async patch=>{
    await expect(admitConnectedGitlab(database({},patch).tx,input)).rejects.toThrow();
  });
  it("refuses changed grant bytes, repository URL or native ID during a retained read",async()=>{
    const {binding}=await admitConnectedGitlab(database().tx,input);
    await expect(admitConnectedGitlab(database({encryptedToken:{ciphertext:"replaced",iv:"iv",authTag:"tag"}}).tx,input,binding)).rejects.toThrow("changed");
    await expect(admitConnectedGitlab(database({},{externalId:"48"}).tx,input,binding)).rejects.toThrow("changed");
  });
  it("does not silently erase malformed source-binding receipts",()=>{
    expect(sourceBindingReceipt(null)).toEqual({});expect(connectedSourceBinding({drafts:[]})).toBe(null);
    expect(()=>connectedSourceBinding({sourceBinding:{}})).toThrow();
  });
  it("checks provider native ID, exact path and origin rather than trusting a URL alone",async()=>{
    const {binding}=await admitConnectedGitlab(database().tx,input);
    const project={id:47,web_url:binding.repositoryUrl,path_with_namespace:"team/service"};
    expect(()=>assertGitlabProjectIdentity(binding,project)).not.toThrow();
    for(const change of [{id:48},{web_url:"https://gitlab.synthetic.example/team/replaced"},{path_with_namespace:"team/changed"},{web_url:"https://other.example/team/service"}])expect(()=>assertGitlabProjectIdentity(binding,{...project,...change})).toThrow();
  });
});
