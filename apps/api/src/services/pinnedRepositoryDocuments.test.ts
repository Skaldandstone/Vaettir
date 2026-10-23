import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readPinnedRepositoryDocuments } from "./pinnedRepositoryDocuments.js";

const commit = "a".repeat(40);
const treeSha = "b".repeat(40);
const content = "# Device specification\nThe controller shall report temperature.\n";
const bytes = Buffer.from(content);
const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const scope = { provider: "github" as const, repository: "example/device", commit, paths: ["README.md"], processingPermission: true as const };
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
function github() {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(json({sha:commit,tree:{sha:treeSha}}))
    .mockResolvedValueOnce(json({truncated:false,tree:[{path:"README.md",mode:"100644",type:"blob",sha:blob}]}))
    .mockResolvedValueOnce(json({size:bytes.length,encoding:"base64",content:bytes.toString("base64")}));
}
describe("pinned repository document reader", () => {
  it("reads only pinned GitHub blobs and returns content hash and commit citation", async () => {
    const fetcher = github();
    const result = await readPinnedRepositoryDocuments(scope, {fetcher,token:"synthetic-token"});
    expect(result.status).toBe("complete");
    expect(result.results[0]).toMatchObject({path:"README.md",status:"read",content,contentHash:createHash("sha256").update(bytes).digest("hex")});
    expect(result.results[0]!.locator).toContain(`/blob/${commit}/README.md`);
    expect(fetcher.mock.calls.map(call=>call[0])).toEqual([
      `https://api.github.com/repos/example/device/git/commits/${commit}`,
      `https://api.github.com/repos/example/device/git/trees/${treeSha}`,
      `https://api.github.com/repos/example/device/git/blobs/${blob}`,
    ]);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({redirect:"error",headers:{Authorization:"Bearer synthetic-token"}});
  });
  it("reads GitLab namespace paths at pinned revisions and validates hashes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({file_path:"README.md",commit_id:commit,content_sha256:createHash("sha256").update(bytes).digest("hex"),size:bytes.length,encoding:"base64",content:bytes.toString("base64")}));
    const result = await readPinnedRepositoryDocuments({...scope,provider:"gitlab",repository:"group/sub/device"},{fetcher});
    expect(result.status).toBe("complete");
    expect(fetcher.mock.calls[0]![0]).toBe(`https://gitlab.com/api/v4/projects/group%2Fsub%2Fdevice/repository/files/README.md?ref=${commit}`);
  });
  it("rejects missing permission, mutable revisions and unsafe scope before network", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const invalid of [
      {...scope,processingPermission:false}, {...scope,commit:"main"}, {...scope,repository:"https://127.0.0.1/repo"},
      {...scope,paths:["../README.md"]}, {...scope,paths:["node_modules/pkg/README.md"]}, {...scope,paths:[".env"]},
      {...scope,paths:["secrets/README.md"]}, {...scope,paths:["README.md","README.md"]}, {...scope,paths:["docs%2FREADME.md"]},
    ]) await expect(readPinnedRepositoryDocuments(invalid as typeof scope,{fetcher})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never dereferences symlinks or submodules", async () => {
    for (const mode of ["120000","160000"]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({sha:commit,tree:{sha:treeSha}}))
        .mockResolvedValueOnce(json({truncated:false,tree:[{path:"README.md",mode,type:"blob",sha:blob}]}));
      const result = await readPinnedRepositoryDocuments(scope,{fetcher});
      expect(result.status).toBe("partial");
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(result.results[0]).toEqual({path:"README.md",status:"unavailable"});
    }
  });
  it("does not convert inaccessible paths into deletion and redacts provider failures", async () => {
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive provider diagnostic",{status:403}));
    const result=await readPinnedRepositoryDocuments(scope,{fetcher});
    expect(result.status).toBe("partial");
    expect(JSON.stringify(result)).not.toContain("sensitive");
    expect(result.results[0]!.status).toBe("unavailable");
  });
  it("rejects mismatched file bytes, malformed base64 and oversized streamed responses", async () => {
    for (const body of ["x".repeat(500001), JSON.stringify({sha: "c".repeat(40),tree:{sha:treeSha}})]) {
      const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
      expect((await readPinnedRepositoryDocuments(scope,{fetcher})).status).toBe("partial");
    }
    const fetcher=github();
    fetcher.mockReset().mockResolvedValueOnce(json({sha:commit,tree:{sha:treeSha}}))
      .mockResolvedValueOnce(json({truncated:false,tree:[{path:"README.md",mode:"100644",type:"blob",sha:blob}]}))
      .mockResolvedValueOnce(json({size:3,encoding:"base64",content:"@@@"}));
    expect((await readPinnedRepositoryDocuments(scope,{fetcher})).status).toBe("partial");
  });
  it("honors cancellation before any read", async () => {
    const controller=new AbortController(); controller.abort();
    const fetcher=vi.fn<typeof fetch>();
    await expect(readPinnedRepositoryDocuments(scope,{fetcher,signal:controller.signal})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects truncated trees, mismatched hashes and sensitive documents", async () => {
    const truncated = vi.fn<typeof fetch>().mockResolvedValueOnce(json({sha:commit,tree:{sha:treeSha}}))
      .mockResolvedValueOnce(json({truncated:true,tree:[]}));
    expect((await readPinnedRepositoryDocuments(scope,{fetcher:truncated})).status).toBe("partial");
    for (const text of [content, "-----BEGIN PRIVATE KEY-----\nsynthetic fixture only"]) {
      const data=Buffer.from(text);
      const fetcher=vi.fn<typeof fetch>().mockResolvedValue(json({file_path:"README.md",commit_id:commit,content_sha256:text===content ? "invalid-hash" : createHash("sha256").update(data).digest("hex"),size:data.length,encoding:"base64",content:data.toString("base64")}));
      const result=await readPinnedRepositoryDocuments({...scope,provider:"gitlab"},{fetcher});
      expect(result.status).toBe("partial");
      expect(result.results[0]).toEqual({path:"README.md",status:"unavailable"});
    }
  });
});
