import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { processingScopeHash, repositoryProcessingScope } from "./repositoryProcessingApproval.js";
import { AI_OPERATION_COSTS } from "./aiCredits.js";
const scope={repoUrl:"https://github.com/synthetic/project",ref:"main",pathPrefixes:["."],maxItems:10};
describe("explicit requirements discovery scope",()=>{
  it("keeps legacy documents-only hash bytes unchanged",()=>{
    const original=createHash("sha256").update(JSON.stringify(["p","REQUIREMENTS",scope.repoUrl,scope.ref,scope.pathPrefixes,10,AI_OPERATION_COSTS.extractRequirementsFromMarkdown])).digest("hex");
    expect(processingScopeHash("p","REQUIREMENTS",scope)).toBe(original);
  });
  it("binds new code fallback to the reviewed hash independently of repository metadata",()=>{
    const next={...scope,requirementsDiscovery:"DOCUMENTS_THEN_CODE" as const};
    expect(repositoryProcessingScope.parse(next)).toMatchObject({requirementsDiscovery:"DOCUMENTS_THEN_CODE"});
    expect(processingScopeHash("p","REQUIREMENTS",next)).not.toBe(processingScopeHash("p","REQUIREMENTS",scope));
  });
  it("refuses unsupported intake modes",()=>{
    expect(()=>repositoryProcessingScope.parse({...scope,requirementsDiscovery:"JUST_READ_EVERYTHING"})).toThrow();
  });
});
