import { it, expect, vi } from "vitest";
import { gitlabRepositoryReleases } from "./gitlabRepositoryReleases.js";
import type { ConnectedSourceBinding } from "./connectedRepositoryAccess.js";
const binding={externalId:"47",origin:"https://gitlab.synthetic.example",repositoryUrl:"https://gitlab.synthetic.example/team/service"} as ConnectedSourceBinding;
const release={tag_name:"v1",name:"Synthetic v1",released_at:"2026-10-09T12:00:00Z",commit:{id:"a".repeat(40)},_links:{self:binding.repositoryUrl+"/-/releases/v1"}};
it("reads release metadata with explicit page and never assets or descriptions",async()=>{
  const read=vi.fn(async()=>[release]);expect(await gitlabRepositoryReleases(binding,1,read)).toMatchObject({releases:[{tag:"v1",commitSha:"a".repeat(40)}],hasMore:false});
  expect(read).toHaveBeenCalledWith("/api/v4/projects/47/releases?per_page=20&page=1&order_by=released_at&sort=desc");
});
it("rejects external or credential-bearing links and duplicate tags",async()=>{
  for(const url of ["https://other.example/release","https://user:pass@gitlab.synthetic.example/team/service/-/releases/v1","https://gitlab.synthetic.example/other/service/-/releases/v1"])
    await expect(gitlabRepositoryReleases(binding,1,async()=>[{...release,_links:{self:url}}])).rejects.toThrow();
  await expect(gitlabRepositoryReleases(binding,1,async()=>[release,release])).rejects.toThrow("duplicate");
});
it("bounded release pages are never declared complete at the page cap",async()=>{
  const rows=Array.from({length:20},(_,i)=>({...release,tag_name:`v${i}`}));
  expect(await gitlabRepositoryReleases(binding,10,async()=>rows)).toMatchObject({hasMore:true,pageLimitReached:true});
  await expect(gitlabRepositoryReleases(binding,11,async()=>[])).rejects.toThrow();
});
