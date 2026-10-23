import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
import { importJobsRouter } from "./importJobs.js";
import { scanQTestProject } from "../services/qtestImport.js";
import { scanZephyrProject } from "../services/zephyrImport.js";
import { commitImportedTestCases } from "../services/importCommit.js";

vi.mock("../services/qtestImport.js", () => ({ scanQTestProject: vi.fn() }));
vi.mock("../services/zephyrImport.js", () => ({ scanZephyrProject: vi.fn() }));
vi.mock("../services/importCommit.js", () => ({ commitImportedTestCases: vi.fn() }));

type Manifest = { digest: string; caseCount: number };
type Scan = Awaited<ReturnType<typeof scanQTestProject>>;
function fixtureScan(): Scan {
  return { cases: Array.from({length:22}, (_,index) => ({
    rowNumber:index+1,key:`SYN-${index+1}`,title:`Synthetic case ${index+1}`,
    testType:"Manual",priority:"MEDIUM",tags:["synthetic"],suitePath:"Synthetic suite",
    background:null,given:["Synthetic precondition"],when:["Synthetic action"],then:["Synthetic result"],
    steps:[{action:"Synthetic action",expectedActionOrData:null,expectedResult:"Synthetic result"},{action:"Second synthetic action",expectedActionOrData:null,expectedResult:"Second result"}],
  })), skipped:[] };
}
function caller(role:"EDITOR"|"VIEWER"|"OUTSIDER"="EDITOR") {
  return importJobsRouter.createCaller({
    prisma:{project:{findUnique:vi.fn(async()=>({id:"project-1",organizationId:"org-1"}))},organization:{findUnique:vi.fn(async()=>({suspendedAt:null}))}},
    user:{id:"actor-1",email:"synthetic@example.com",memberships:role==="OUTSIDER"?[]:[{organizationId:"org-1",role,seatType:"FULL"}]},
    staff:null,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false},
  } as unknown as Context);
}
const qtestInput={projectId:"project-1",baseUrl:"https://qtest.synthetic.example",apiToken:"synthetic-not-live",qtestProjectId:1};
const zephyrInput={projectId:"project-1",apiToken:"synthetic-not-live",zephyrProjectKey:"SYN"};
const adapters=[
  {name:"qTest",scanner:vi.mocked(scanQTestProject),preview:(c:ReturnType<typeof caller>)=>c.previewQTest(qtestInput),commit:(c:ReturnType<typeof caller>,manifest:Manifest)=>c.commitQTest({...qtestInput,expectedManifest:manifest})},
  {name:"Zephyr",scanner:vi.mocked(scanZephyrProject),preview:(c:ReturnType<typeof caller>)=>c.previewZephyr(zephyrInput),commit:(c:ReturnType<typeof caller>,manifest:Manifest)=>c.commitZephyr({...zephyrInput,expectedManifest:manifest})},
];

beforeEach(()=>{
  vi.resetAllMocks();
  vi.mocked(scanQTestProject).mockResolvedValue(fixtureScan());
  vi.mocked(scanZephyrProject).mockResolvedValue(fixtureScan());
  vi.mocked(commitImportedTestCases).mockResolvedValue({importJobId:"synthetic-job",createdCount:22,updatedCount:0,skipped:[]});
});

for(const adapter of adapters)describe(`${adapter.name} reviewed full-source manifest`,()=>{
  it("binds all22 rows while returning sample20, commits unchanged input through existing reconciliation, and records provenance",async()=>{
    const c=caller();const preview=await adapter.preview(c);
    expect(preview.previewRows).toHaveLength(20);expect(preview.caseCount).toBe(22);
    expect(preview.sourceManifest).toMatchObject({caseCount:22,digest:expect.stringMatching(/^[a-f0-9]{64}$/)});
    await adapter.commit(c,preview.sourceManifest);
    expect(commitImportedTestCases).toHaveBeenCalledOnce();
    expect(vi.mocked(commitImportedTestCases).mock.calls[0]?.[1]).toMatchObject({
      projectId:"project-1",actorId:"actor-1",rows:expect.arrayContaining([expect.objectContaining({externalId:"SYN-22"})]),
      fieldMapping:{reviewedManifestDigest:preview.sourceManifest.digest,reviewedManifestCaseCount:"22"},
    });
  });

  for(const [name,change] of [
    ["changed title outside displayed sample",(s:Scan)=>{s.cases[21]!.title="Changed unpreviewed title";}],
    ["changed background outside displayed sample",(s:Scan)=>{s.cases[21]!.background="Changed background";}],
    ["changed structured step outside displayed sample",(s:Scan)=>{s.cases[21]!.steps[0]!.expectedResult="Changed expectation";}],
    ["reordered structured steps",(s:Scan)=>{s.cases[21]!.steps.reverse();}],
    ["added case",(s:Scan)=>{s.cases.push({...s.cases[21]!,rowNumber:23,key:"SYN-23"});}],
    ["deleted case",(s:Scan)=>{s.cases.pop();}],
    ["reordered cases",(s:Scan)=>{s.cases.reverse();}],
    ["changed skipped disposition",(s:Scan)=>{s.skipped.push({rowNumber:23,reason:"missing test case name"});}],
  ] as const)it(`rejects ${name} before any import write`,async()=>{
    const c=caller();const preview=await adapter.preview(c);const changed=fixtureScan();change(changed);adapter.scanner.mockResolvedValueOnce(changed);
    await expect(adapter.commit(c,preview.sourceManifest)).rejects.toMatchObject({code:"CONFLICT",message:expect.stringContaining("Source changed since preview")});
    expect(commitImportedTestCases).not.toHaveBeenCalled();
  });

  it("requires digest and exact reviewed count, and allows refreshed review after a source change",async()=>{
    const c=caller();const preview=await adapter.preview(c);
    await expect(adapter.commit(c,{...preview.sourceManifest,caseCount:21})).rejects.toMatchObject({code:"CONFLICT"});
    await expect(adapter.commit(c,undefined as never)).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(commitImportedTestCases).not.toHaveBeenCalled();
    const changed=fixtureScan();changed.cases[21]!.title="Changed source";adapter.scanner.mockResolvedValue(changed);
    const refreshed=await adapter.preview(c);expect(refreshed.sourceManifest.digest).not.toBe(preview.sourceManifest.digest);
    await adapter.commit(c,refreshed.sourceManifest);expect(commitImportedTestCases).toHaveBeenCalledOnce();
  });

  it("preserves project authorization and rejects a viewer before provider reads or writes",async()=>{
    const preview=await adapter.preview(caller());adapter.scanner.mockClear();
    for(const role of ["VIEWER","OUTSIDER"] as const)await expect(adapter.commit(caller(role),preview.sourceManifest)).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(adapter.scanner).not.toHaveBeenCalled();expect(commitImportedTestCases).not.toHaveBeenCalled();
  });
});

it("binds provider project identity without including one-shot tokens in the reviewed manifest",async()=>{
  const c=caller();const preview=await c.previewQTest(qtestInput);
  expect((await c.previewQTest({...qtestInput,apiToken:"different-synthetic-token"})).sourceManifest).toEqual(preview.sourceManifest);
  await expect(c.commitQTest({...qtestInput,qtestProjectId:2,expectedManifest:preview.sourceManifest})).rejects.toMatchObject({code:"CONFLICT"});
  const zephyr=await c.previewZephyr(zephyrInput);
  await expect(c.commitZephyr({...zephyrInput,zephyrProjectKey:"OTHER",expectedManifest:zephyr.sourceManifest})).rejects.toMatchObject({code:"CONFLICT"});
  expect(commitImportedTestCases).not.toHaveBeenCalled();
});
