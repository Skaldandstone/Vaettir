import {describe,it,expect} from "vitest";
import {safeSourcePath,sourcePathInScope,safeRepositoryText} from "./repositorySourceSafety.js";
import {repositoryProcessingConsent,repositoryProcessingScope,processingScopeHash} from "./repositoryProcessingApproval.js";
describe("literal repository scope and conservative intake exclusions",()=>{
  it("requires all three explicit approvals, a new request identity and bound scope",()=>{
    expect(repositoryProcessingConsent.safeParse({approveMetadataAccess:true}).success).toBe(false);
    expect(repositoryProcessingConsent.safeParse({requestId:"00000000-0000-4000-8000-000000000000",expectedScopeHash:"a".repeat(64),approveSourceRead:true,approveAiProcessing:true,approveVariableCredits:false}).success).toBe(false);
  });
  it("rejects traversal, absolute paths, controls and missing selected paths",()=>{
    for(const path of ["../tests","tests/../secret","/tests","C:/tests","tests\\login.test.ts","tests//file","tests/./file","tests/\u007f"]){expect(safeSourcePath(path)).toBe(false);expect(sourcePathInScope(path,["."])).toBe(false);}
    expect(repositoryProcessingScope.safeParse({repoUrl:"https://github.com/org/repo",ref:"main",pathPrefixes:[],maxItems:1}).success).toBe(false);
    expect(sourcePathInScope("tests/login.test.ts",["tests"])).toBe(true);expect(sourcePathInScope("tests-other/login.test.ts",["tests"])).toBe(false);
  });
  it("never admits secret-like files, generated dependencies or binaries",()=>{
    for(const path of ["tests/.env.test.ts","tests/secrets/key.test.ts","node_modules/login.test.ts","dist/login.test.ts","coverage/login.test.ts","tests/key.pem","tests/id_rsa"]){expect(sourcePathInScope(path,["."])).toBe(false);}
    for(const text of ["hello\u0000world","-----BEGIN PRIVATE KEY-----\nsynthetic-only",`ghp_${"x".repeat(25)}`,`glpat-${"x".repeat(25)}`,`AKIA${"X".repeat(16)}`,"api_key = 'synthetic-not-a-live-secret'","access_token: synthetic-not-a-live-token"]){expect(safeRepositoryText(text)).toBe(false);}
    expect(safeRepositoryText("describe('login', () => { expect(user).toBeDefined(); });\n")).toBe(true);
  });
  it("binds purpose, project, repository, revision, paths and item limit into the estimate",()=>{
    const scope={repoUrl:"https://github.com/org/repo",ref:"main",pathPrefixes:["tests"],maxItems:2};
    const hash=processingScopeHash("project","TEST_CASES",scope);
    for(const changed of [{...scope,repoUrl:"https://github.com/org/other"},{...scope,ref:"release"},{...scope,pathPrefixes:["src"]},{...scope,maxItems:3}])expect(processingScopeHash("project","TEST_CASES",changed)).not.toBe(hash);
    expect(processingScopeHash("other","TEST_CASES",scope)).not.toBe(hash);expect(processingScopeHash("project","REQUIREMENTS",scope)).not.toBe(hash);
    expect(processingScopeHash("project","TEST_CASES",{...scope,repoUrl:"https://github.com/ORG/REPO.git/"})).toBe(hash);
  });
});
