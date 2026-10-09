import { z } from "zod";
import type { ConnectedSourceBinding } from "./connectedRepositoryAccess.js";
import type { GitlabJsonRead } from "./connectedGitlabScan.js";

export async function gitlabRepositoryReleases(binding:ConnectedSourceBinding,page:number,read:GitlabJsonRead) {
  z.number().int().min(1).max(10).parse(page);
  const rows=z.array(z.object({tag_name:z.string().min(1).max(200),name:z.string().max(500),released_at:z.string().datetime({offset:true}),
    commit:z.object({id:z.string().regex(/^[a-f0-9]{40}$/)}),_links:z.object({self:z.string().url().max(2000)})})).max(20).parse(
      await read(`/api/v4/projects/${binding.externalId}/releases?per_page=20&page=${page}&order_by=released_at&sort=desc`));
  if(new Set(rows.map(row=>row.tag_name)).size!==rows.length)throw Error("GitLab returned duplicate release tags.");
  const releases=rows.map(row=>{
    const url=new URL(row._links.self);
    const repository=new URL(binding.repositoryUrl);
    if(url.origin!==binding.origin||url.username||url.password||url.search||url.hash||!url.pathname.startsWith(repository.pathname+"/-/releases/"))throw Error("GitLab returned a release outside the registered repository.");
    return {tag:row.tag_name,name:row.name,releasedAt:row.released_at,commitSha:row.commit.id,url:url.href};
  });
  return {releases,page,hasMore:rows.length===20,pageLimitReached:page===10&&rows.length===20};
}
