import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
vi.mock("../services/repositoryProcessingApproval.js",async original=>({...await original<typeof import("../services/repositoryProcessingApproval.js")>(),beginRepositoryProcessing:vi.fn(),assertRepositoryProcessingApproval:vi.fn()}));
vi.mock("../services/connectedRepositoryAccess.js",async original=>({...await original<typeof import("../services/connectedRepositoryAccess.js")>(),connectedSourceBinding:vi.fn(()=>({synthetic:true})),sourceBindingReceipt:vi.fn(()=>({sourceBinding:{synthetic:true}}))}));
vi.mock("../services/connectedGitlabScan.js",()=>({scanApprovedConnectedGitlab:vi.fn(),scanApprovedConnectedGitlabRequirementsSource:vi.fn()}));
vi.mock("../services/aiCredits.js",async original=>({...await original<typeof import("../services/aiCredits.js")>(),chargeAiCredits:vi.fn(async()=>({synthetic:true})),meterAiCall:vi.fn(async(_db,_charge,fn:()=>Promise<unknown>)=>fn())}));
vi.mock("@vaettir/ai-agent",async original=>({...await original<typeof import("@vaettir/ai-agent")>(),extractRequirementsFromMarkdown:vi.fn()}));
import { beginRepositoryProcessing, assertRepositoryProcessingApproval, processingScopeHash } from "../services/repositoryProcessingApproval.js";
import { scanApprovedConnectedGitlab, scanApprovedConnectedGitlabRequirementsSource } from "../services/connectedGitlabScan.js";
import { chargeAiCredits } from "../services/aiCredits.js";
import { extractRequirementsFromMarkdown } from "@vaettir/ai-agent";
import { requirementsRouter } from "./requirements.js";
const headSha="a".repeat(40), content="export function login() { return true; }";
const file={relativePath:"src/login.ts",content,contentHash:createHash("sha256").update(content).digest("hex")};
const scope={repositoryId:"repository",repoUrl:"https://gitlab.synthetic.example/group/service",ref:"HEAD",pathPrefixes:["."],maxItems:10,requirementsDiscovery:"DOCUMENTS_THEN_CODE" as const};
const consent={requestId:"134d61a8-11b4-4436-9142-177f485f9c02",expectedScopeHash:processingScopeHash("project","REQUIREMENTS",scope),approveSourceRead:true as const,approveAiProcessing:true as const,approveVariableCredits:true as const};
function fixture(){
  const receipts:Array<Record<string,unknown>>=[];
  const db={
    repositoryProcessingApproval:{findFirst:vi.fn(async()=>null),update:vi.fn(async({data})=>{receipts.push(data);return data;}),updateMany:vi.fn(async()=>({count:1}))},
    $transaction:vi.fn(async(fn:(tx:unknown)=>unknown)=>fn(db)),
  };
  const ctx={prisma:db,user:{id:"actor",clerkUserId:"synthetic-clerk",memberships:[]},staff:null} as unknown as Context;
  return {db,receipts,api:requirementsRouter.createCaller(ctx)};
}
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(beginRepositoryProcessing).mockResolvedValue({approval:{id:"approval",organizationId:"org",results:{requirementsDiscovery:"DOCUMENTS_THEN_CODE"}} as never,replayed:false});
  vi.mocked(assertRepositoryProcessingApproval).mockResolvedValue({} as never);
  vi.mocked(scanApprovedConnectedGitlabRequirementsSource).mockResolvedValue({files:[file],headSha,sourceMode:"CODE_INFERENCE",eligibleFileCount:1,inspectedFileCount:1,truncated:false,discovery:{mode:"code",inventoryComplete:true,inventoryEntryCount:1,documentsDiscovered:0,eligibleFileCount:1,maxItems:10,codeInferenceApproved:true}});
  vi.mocked(extractRequirementsFromMarkdown).mockResolvedValue([{title:"Synthetic login candidate",description:"Confirm expected authentication behavior."}]);
});
describe("repository requirement discovery route (mock admission/provider/AI/database, not live acceptance)",()=>{
  it("uses only the exact newly approved mode, labels inferred rows and saves requirements.md draft custody",async()=>{
    const f=fixture(), result=await f.api.extractFromRepo({projectId:"project",scope,consent});
    expect(scanApprovedConnectedGitlabRequirementsSource).toHaveBeenCalledOnce();
    expect(scanApprovedConnectedGitlab).not.toHaveBeenCalled();
    expect(extractRequirementsFromMarkdown).toHaveBeenCalledWith(expect.stringContaining("untrusted source evidence"),file.relativePath);
    expect(result[0]?.description).toContain("Code-inferred candidate, not confirmed product intent");
    const last=f.receipts.at(-1)!;
    expect(last).toMatchObject({status:"COMPLETED",results:{requirementsDiscovery:"DOCUMENTS_THEN_CODE",requirementsDocument:{fileName:"requirements.md",classification:"INFERRED_FROM_CODE",confirmed:false,headSha,sourceReferences:[{path:file.relativePath,contentHash:file.contentHash,commit:headSha}]}}});
    expect(chargeAiCredits).toHaveBeenCalledOnce();
  });
  it("extracts discovered documents without claiming code inference",async()=>{
    vi.mocked(scanApprovedConnectedGitlabRequirementsSource).mockResolvedValue({files:[{...file,relativePath:"requirements.md"}],headSha,sourceMode:"DOCUMENTS",eligibleFileCount:1,inspectedFileCount:1,truncated:false,discovery:{mode:"docs",inventoryComplete:true,inventoryEntryCount:1,documentsDiscovered:1,eligibleFileCount:1,maxItems:10,codeInferenceApproved:true}});
    const f=fixture(), result=await f.api.extractFromRepo({projectId:"project",scope,consent});
    expect(extractRequirementsFromMarkdown).toHaveBeenCalledWith(content,"requirements.md");
    expect(result[0]?.description).not.toContain("Code-inferred");
    expect(f.receipts.at(-1)).toMatchObject({results:{requirementsDocument:{classification:"DOCUMENT_DERIVED",confirmed:false}}});
  });
  it("does not adopt a new input mode for retained historical approvals",async()=>{
    vi.mocked(beginRepositoryProcessing).mockResolvedValue({approval:{id:"approval",organizationId:"org",results:{}} as never,replayed:false});
    vi.mocked(scanApprovedConnectedGitlab).mockResolvedValue({files:[],observedFiles:[],headSha,eligibleFileCount:0,inspectedFileCount:0,truncated:false});
    const f=fixture();await f.api.extractFromRepo({projectId:"project",scope,consent});
    expect(scanApprovedConnectedGitlabRequirementsSource).not.toHaveBeenCalled();
    expect(chargeAiCredits).not.toHaveBeenCalled();
  });
  it("returns retained paid outputs without discovery, source reread or repeat charge",async()=>{
    vi.mocked(beginRepositoryProcessing).mockResolvedValue({approval:{id:"approval",results:{drafts:[{title:"Retained",description:"Original",sourceFile:null}],inFlightPath:null,inFlightHash:null,processedPaths:[],processedFiles:[]}} as never,replayed:true});
    const f=fixture();expect(await f.api.extractFromRepo({projectId:"project",scope,consent})).toEqual([{title:"Retained",description:"Original",sourceFile:null}]);
    expect(scanApprovedConnectedGitlabRequirementsSource).not.toHaveBeenCalled();expect(chargeAiCredits).not.toHaveBeenCalled();expect(f.receipts).toEqual([]);
  });
  it("preserves failed discovery without AI/charges or a fabricated requirements artifact",async()=>{
    vi.mocked(scanApprovedConnectedGitlabRequirementsSource).mockRejectedValueOnce(Error("Incomplete tree"));
    const f=fixture();await expect(f.api.extractFromRepo({projectId:"project",scope,consent})).rejects.toThrow();
    expect(chargeAiCredits).not.toHaveBeenCalled();expect(f.receipts).toEqual([]);expect(f.db.repositoryProcessingApproval.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{status:"FAILED"}}));
  });
});
