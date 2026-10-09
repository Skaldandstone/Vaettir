import { createHash } from "node:crypto";
import { z } from "zod";
import { safeSourcePath } from "./repositorySourceSafety.js";

export const repositoryFileCoverageScope=z.object({repositoryId:z.string().min(1).max(100),ref:z.string().trim().min(1).max(200).refine(value=>!value.startsWith("-")&&!/\s/.test(value)&&!Array.from(value).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)),
  pathPrefixes:z.array(z.string().trim().min(1).max(500).refine(safeSourcePath)).min(1).max(20).refine(paths=>new Set(paths).size===paths.length),maxItems:z.number().int().min(1).max(25)}).strict();
export type RepositoryFileCoverageScope=z.infer<typeof repositoryFileCoverageScope>;
export const repositoryFileCoverageConsent=z.object({requestId:z.string().uuid(),expectedScopeHash:z.string().length(64),approveSourceRead:z.literal(true)}).strict();
export function repositoryFileCoverageHash(projectId:string,actorId:string,scope:RepositoryFileCoverageScope,binding:unknown) {
  return createHash("sha256").update(JSON.stringify(["repository-file-coverage/v1",projectId,actorId,scope.repositoryId,scope.ref,[...scope.pathPrefixes].sort(),scope.maxItems,binding])).digest("hex");
}
export const repositoryFileCoverageResult=z.object({
  commitSha:z.string().regex(/^[a-f0-9]{40}$/),observedAt:z.string().datetime(),eligibleFileCount:z.number().int().nonnegative(),inspectedFileCount:z.number().int().nonnegative(),truncated:z.boolean(),
  files:z.array(z.object({path:z.string(),hash:z.string().length(64),state:z.enum(["CURRENT_SOURCE_LINKS","STALE_SOURCE_LINKS","UNKNOWN_SOURCE_HASH","NO_SOURCE_LINKS"]),
    cases:z.array(z.object({id:z.string(),title:z.string(),currentHash:z.boolean()}))})).max(25),
});
export function compareRepositoryFiles(observed:readonly {path:string;hash:string}[],sources:readonly {filePath:string;contentHash:string|null;testCase:{id:string;title:string}}[]) {
  return observed.map(file=>{
    const linked=sources.filter(source=>source.filePath===file.path);
    const cases=linked.map(source=>({id:source.testCase.id,title:source.testCase.title,currentHash:source.contentHash===file.hash}));
    const state=cases.some(row=>row.currentHash)?"CURRENT_SOURCE_LINKS":linked.some(source=>source.contentHash!==null)?"STALE_SOURCE_LINKS":linked.length?"UNKNOWN_SOURCE_HASH":"NO_SOURCE_LINKS";
    return {...file,state,cases};
  });
}
