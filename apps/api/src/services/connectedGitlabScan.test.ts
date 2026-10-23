import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { scanConnectedGitlab, requirementsDocument } from "./connectedGitlabScan.js";

const commit="a".repeat(40);
function fixture(path:string,content:string,mode="100644") {
  const bytes=Buffer.from(content);const id=createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  return {entry:{path,id,type:"blob",mode},blob:{sha:id,size:bytes.length,encoding:"base64",content:bytes.toString("base64")}};
}
function reader(files:ReturnType<typeof fixture>[]) {
  return vi.fn(async(path:string)=>{
    if(path.includes("/commits/"))return{id:commit};
    if(path.includes("/tree?"))return files.map(file=>file.entry);
    const file=files.find(file=>path.endsWith(`/blobs/${file.entry.id}`));if(!file)throw Error("Unexpected synthetic endpoint");return file.blob;
  });
}
describe("connected GitLab pinned reads (synthetic only)",()=>{
  it("uses numeric repository identity and a pinned commit, never a credential URL",async()=>{
    const read=reader([fixture("tests/login.test.ts","describe('login',()=>{});")]);
    const value=await scanConnectedGitlab(read,"47","feature/scoped","TEST_CASES",["tests"],2);
    expect(value.headSha).toBe(commit);expect(value.files).toHaveLength(1);expect(read.mock.calls[0]![0]).toBe("/api/v4/projects/47/repository/commits/feature%2Fscoped");
    expect(read.mock.calls[1]![0]).toContain(`ref=${commit}`);expect(value.truncated).toBe(false);
  });
  it("excludes symlinks, secrets, dependencies, out-of-scope files and non-tests before reading blobs",async()=>{
    const files=[fixture("tests/a.test.ts","it('safe',()=>{});"),fixture("tests/link.test.ts","/outside","120000"),fixture("node_modules/a.test.ts","hidden"),fixture("tests/.env.secret.test.ts","hidden"),fixture("other/a.test.ts","hidden"),fixture("tests/index.ts","hidden")];
    const read=reader(files);const value=await scanConnectedGitlab(read,"47","main","TEST_CASES",["tests"],25);
    expect(value.files.map(file=>file.relativePath)).toEqual(["tests/a.test.ts"]);expect(read.mock.calls.filter(call=>call[0].includes("/blobs/"))).toHaveLength(1);
  });
  it("refuses replaced blobs, invalid base64, oversized payloads and altered hashes",async()=>{
    const file=fixture("tests/a.test.ts","it('safe',()=>{});");
    for(const patch of [{sha:"b".repeat(40)},{content:"!!"},{size:999999},{content:Buffer.from("replaced").toString("base64"),size:8}]){
      const read=reader([{...file,blob:{...file.blob,...patch}}]);await expect(scanConnectedGitlab(read,"47","main","TEST_CASES",["tests"],1)).rejects.toThrow();
    }
  });
  it("does not return secret-like text or duplicate paid unchanged files",async()=>{
    const safe=fixture("tests/a.test.ts","it('safe',()=>{});");const secret=fixture("tests/b.test.ts","const token='glpat-123456789012345678901234';");
    const hash=createHash("sha256").update("it('safe',()=>{});").digest("hex");
    const result=await scanConnectedGitlab(reader([safe,secret]),"47","main","TEST_CASES",["tests"],2,new Map([[safe.entry.path,hash]]));expect(result.files).toEqual([]);
  });
  it("keeps candidate and inspected counts distinct at the file bound",async()=>{
    const result=await scanConnectedGitlab(reader([fixture("tests/a.test.ts","a"),fixture("tests/b.test.ts","b")]),"47","main","TEST_CASES",["tests"],1);
    expect(result.eligibleFileCount).toBe(2);expect(result.inspectedFileCount).toBe(1);expect(result.truncated).toBe(true);
  });
  it("preserves UTF-8 BOM bytes in content hashes and unchanged paid blob identities",async()=>{
    const content="\uFEFFit('safe',()=>{});",file=fixture("tests/bom.test.ts",content),hash=createHash("sha256").update(Buffer.from(content)).digest("hex");
    const result=await scanConnectedGitlab(reader([file]),"47","main","TEST_CASES",["tests"],1);
    expect(result.files[0]!.content).toBe(content);expect(result.observedFiles[0]!.hash).toBe(hash);
    const read=reader([file]);const unchanged=await scanConnectedGitlab(read,"47","main","TEST_CASES",["tests"],1,new Map([[file.entry.path,hash]]),new Map([[file.entry.path,file.entry.id]]));
    expect(unchanged.files).toEqual([]);expect(unchanged.observedFiles).toEqual([{path:file.entry.path,hash}]);expect(read.mock.calls.filter(call=>call[0].includes("/blobs/"))).toHaveLength(0);
  });
  it("unchanged paid blob identities do not consume the bounded read limit or starve a new test",async()=>{
    const previous=fixture("tests/a.test.ts","paid exact bytes");const changed=fixture("tests/b.test.ts","new exact bytes");const read=reader([previous,changed]);
    const result=await scanConnectedGitlab(read,"47","main","TEST_CASES",["tests"],1,new Map([[previous.entry.path,createHash("sha256").update("paid exact bytes").digest("hex")]]),new Map([[previous.entry.path,previous.entry.id]]));
    expect(result.files.map(file=>file.relativePath)).toEqual([changed.entry.path]);expect(read.mock.calls.filter(call=>call[0].includes("/blobs/"))).toHaveLength(1);expect(result.observedFiles).toHaveLength(2);
  });
  it("never calls a ten-page partial tree complete or allows a repeated tree path",async()=>{
    const read=vi.fn(async(path:string)=>path.includes("/commits/")?{id:commit}:Array.from({length:100},(_,i)=>({id:commit,path:`tests/${read.mock.calls.length}-${i}.test.ts`,type:"blob",mode:"100644"})));
    await expect(scanConnectedGitlab(read,"47","main","TEST_CASES",["tests"],1)).rejects.toThrow("exceeds");expect(read).toHaveBeenCalledTimes(11);
    const duplicate=fixture("tests/a.test.ts","a");await expect(scanConnectedGitlab(reader([duplicate,duplicate]),"47","main","TEST_CASES",["tests"],1)).rejects.toThrow("repeated");
  });
  it("requirements scan prefers README and retains narrow document heuristics",async()=>{
    const read=reader([fixture("docs/spec.md","shall work"),fixture("README.md","must work"),fixture("docs/changelog.md","noise"),fixture("src/index.ts","noise")]);
    const result=await scanConnectedGitlab(read,"47","main","REQUIREMENTS",["."],1);expect(result.files[0]!.relativePath).toBe("README.md");expect(result.eligibleFileCount).toBe(2);
    expect(requirementsDocument("src/example.md")).toBe(false);expect(requirementsDocument("nested/docs/design.mdx")).toBe(true);
  });
});
