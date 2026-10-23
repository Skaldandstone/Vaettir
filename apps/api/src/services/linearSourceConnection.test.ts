import {randomUUID} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {linearProviderGraphql} from "./repositoryProviderHttp.js";
import {listLinearProjects} from "./linearSourceConnection.js";
vi.mock("./repositoryProviderHttp.js",()=>({linearProviderGraphql:vi.fn()}));
const project={id:randomUUID(),name:"Synthetic project",url:"https://linear.app/synthetic/project/example"};
const data=()=>({viewer:{id:randomUUID(),name:"Synthetic account"},organization:{id:randomUUID(),name:"Synthetic workspace"},projects:{nodes:[project],pageInfo:{hasNextPage:false,endCursor:null}}});
beforeEach(()=>vi.resetAllMocks());
describe("Linear metadata-only adapter",()=>{
  it("verifies account/workspace and requests only bounded project metadata",async()=>{
    const body=data();vi.mocked(linearProviderGraphql).mockResolvedValue({data:body});
    await expect(listLinearProjects("synthetic-key","opaque-cursor")).resolves.toMatchObject({workspace:body.organization,account:body.viewer,projects:[project],hasMore:false});
    const [key,query,variables]=vi.mocked(linearProviderGraphql).mock.calls[0]!;
    expect(key).toBe("synthetic-key");expect(variables).toEqual({after:"opaque-cursor"});expect(query).toContain("projects(first: 50");expect(query).not.toMatch(/\b(issues|description|email|mutation)\b/);
  });
  it("fails closed on GraphQL errors with otherwise valid partial HTTP200 data",async()=>{
    vi.mocked(linearProviderGraphql).mockResolvedValue({data:data(),errors:[{message:"provider-sensitive-detail"}]});
    await expect(listLinearProjects("synthetic-key")).rejects.toThrow("did not verify");
  });
  it("rejects missing identity, oversized metadata, and duplicate native IDs",async()=>{
    for(const body of [{data:{...data(),organization:null}},{data:{...data(),projects:{nodes:Array.from({length:51},()=>({...project,id:randomUUID()})),pageInfo:{hasNextPage:false,endCursor:null}}}},{data:{...data(),projects:{nodes:[project,project],pageInfo:{hasNextPage:false,endCursor:null}}}}]){
      vi.mocked(linearProviderGraphql).mockResolvedValue(body);await expect(listLinearProjects("synthetic-key")).rejects.toThrow();
    }
  });
  it.each(["http://linear.app/project/x","https://linear.app.evil.example/x","https://evil.example/x","https://user:pass@linear.app/x","https://linear.app:444/x","javascript:alert(1)"])("rejects unsafe returned links %s",async url=>{
    vi.mocked(linearProviderGraphql).mockResolvedValue({data:{...data(),projects:{nodes:[{...project,url}],pageInfo:{hasNextPage:false,endCursor:null}}}});
    await expect(listLinearProjects("synthetic-key")).rejects.toThrow();
  });
  it("requires a continuation cursor when provider reports more pages",async()=>{
    vi.mocked(linearProviderGraphql).mockResolvedValue({data:{...data(),projects:{nodes:[project],pageInfo:{hasNextPage:true,endCursor:null}}}});
    await expect(listLinearProjects("synthetic-key")).rejects.toThrow("pagination");
  });
});
