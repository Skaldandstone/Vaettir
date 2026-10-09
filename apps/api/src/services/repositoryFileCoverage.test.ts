import { expect, it } from "vitest";
import { compareRepositoryFiles,repositoryFileCoverageScope,repositoryFileCoverageConsent,repositoryFileCoverageHash } from "./repositoryFileCoverage.js";
const scope={repositoryId:"repo-a",ref:"main",pathPrefixes:["tests","docs"],maxItems:25};
it("distinguishes current, changed, unknown and unmapped file provenance without inferred behavior coverage",()=>{
  const files=[{path:"tests/current.ts",hash:"a".repeat(64)},{path:"tests/changed.ts",hash:"b".repeat(64)},{path:"tests/unknown.ts",hash:"c".repeat(64)},{path:"tests/manual.ts",hash:"d".repeat(64)}];
  const source=(filePath:string,contentHash:string|null,id:string)=>({filePath,contentHash,testCase:{id,title:"Synthetic case"}});
  const rows=compareRepositoryFiles(files,[source(files[0]!.path,files[0]!.hash,"case-a"),source(files[1]!.path,"old","case-b"),source(files[2]!.path,null,"case-c")]);
  expect(rows.map(row=>row.state)).toEqual(["CURRENT_SOURCE_LINKS","STALE_SOURCE_LINKS","UNKNOWN_SOURCE_HASH","NO_SOURCE_LINKS"]);expect(rows[0]!.cases[0]!.currentHash).toBe(true);
});
it("does not count a title match or other file as a source link",()=>{
  const value=compareRepositoryFiles([{path:"tests/login.ts",hash:"a".repeat(64)}],[{filePath:"other/login.ts",contentHash:"a".repeat(64),testCase:{id:"case-a",title:"tests/login.ts"}}]);expect(value[0]!.state).toBe("NO_SOURCE_LINKS");
});
it("scope hash binds actor, project, repository, ref, exact limits and grant fingerprint",()=>{
  const first=repositoryFileCoverageHash("project-a","actor-a",scope,{credentialHash:"original"});
  expect(repositoryFileCoverageHash("project-a","actor-a",{...scope,pathPrefixes:["docs","tests"]},{credentialHash:"original"})).toBe(first);
  for(const value of [repositoryFileCoverageHash("other","actor-a",scope,{credentialHash:"original"}),repositoryFileCoverageHash("project-a","other",scope,{credentialHash:"original"}),repositoryFileCoverageHash("project-a","actor-a",{...scope,maxItems:1},{credentialHash:"original"}),repositoryFileCoverageHash("project-a","actor-a",scope,{credentialHash:"replaced"})])expect(value).not.toBe(first);
});
it("requires source-only consent and refuses unsafe paths, empty/oversized scopes and AI fields",()=>{
  for(const bad of [{...scope,pathPrefixes:["../outside"]},{...scope,pathPrefixes:[]},{...scope,maxItems:26},{...scope,ref:"-option"},{...scope,pathPrefixes:["tests","tests"]}])expect(repositoryFileCoverageScope.safeParse(bad).success).toBe(false);
  const approved={requestId:"12345678-1234-4234-8234-123456789012",expectedScopeHash:"a".repeat(64),approveSourceRead:true};
  expect(repositoryFileCoverageConsent.safeParse(approved).success).toBe(true);expect(repositoryFileCoverageConsent.safeParse({...approved,approveAiProcessing:true}).success).toBe(false);expect(repositoryFileCoverageConsent.safeParse({...approved,approveSourceRead:false}).success).toBe(false);
});
