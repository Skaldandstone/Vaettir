import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
const gates = vi.hoisted(() => ({ approval: vi.fn(), admit: vi.fn(), http: vi.fn() }));
vi.mock("./repositoryProcessingApproval.js", () => ({ assertRepositoryProcessingApproval: gates.approval }));
vi.mock("./connectedRepositoryAccess.js", () => ({ connectedSourceBinding: (value: { sourceBinding?: unknown }) => value.sourceBinding, admitConnectedGitlab: gates.admit, assertGitlabProjectIdentity: vi.fn() }));
vi.mock("./repositoryProviderHttp.js", () => ({ repositoryProviderJson: gates.http }));
import { discoverRepositorySources, repositoryDocumentRank, repositoryTestCandidate } from "./repositoryDiscovery.js";
import { scanConnectedGitlabRequirementsSource, scanApprovedConnectedGitlabRequirementsSource } from "./connectedGitlabScan.js";
const commit = "a".repeat(40);
function file(path: string, content = "export function synthetic() {}", mode = "100644") {
  const bytes = Buffer.from(content), id = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  return { entry: { id, path, type: "blob" as const, mode }, blob: { sha: id, encoding: "base64", content: bytes.toString("base64"), size: bytes.length } };
}
function reader(files: ReturnType<typeof file>[]) { return vi.fn(async (path: string) => path.includes("/commits/") ? { id: commit } : path.includes("/tree?") ? files.map(item => item.entry) : files.find(item => path.endsWith(`/blobs/${item.entry.id}`))?.blob); }
describe("repository discovery and requirements intake (synthetic; no provider/native execution)", () => {
  it("prioritizes actual requirement/PRD/spec candidates without treating a generic README as requirements", () => {
    const result = discoverRepositorySources([file("README.md").entry, file("docs/design.md").entry, file("requirements.md").entry, file("PRD.txt").entry], true, "REQUIREMENTS");
    expect(result.candidates.map(entry => entry.path)).toEqual(["PRD.txt", "requirements.md", "docs/design.md"]);
    expect(repositoryDocumentRank("CHANGELOG.md")).toBeNull(); expect(repositoryDocumentRank("src/ordinary.md")).toBeNull();
  });
  it("uses the explicitly approved code fallback when only a generic README and implementation exist", async()=>{
    const code=file("src/login.ts","export function login() { return true; }"),read=reader([file("README.md","Installation instructions only."),code]);
    const result=await scanConnectedGitlabRequirementsSource(read,"47","HEAD",["."],10,"DOCUMENTS_THEN_CODE");
    expect(result.sourceMode).toBe("CODE_INFERENCE");expect(result.discovery.documentsDiscovered).toBe(0);
    expect(result.files.map(item=>item.relativePath)).toEqual(["src/login.ts"]);
    expect(read.mock.calls.filter(([path])=>path.includes("/blobs/"))).toEqual([[expect.stringContaining(code.entry.id)]]);
  });
  it("discovers test-directory candidates without treating helpers/dependencies/secrets as tests", () => {
    expect(repositoryTestCandidate("tests/login.ts")).toBe(true); expect(repositoryTestCandidate("e2e/login.py")).toBe(true);
    const result = discoverRepositorySources(["tests/login.ts", "tests/helpers/seed.ts", "node_modules/a.test.ts", "tests/.env.test.ts", "src/main.ts"].map(path => file(path).entry), true, "TEST_CASES");
    expect(result.candidates.map(item => item.path)).toEqual(["tests/login.ts"]);
  });
  it("rejects partial inventories, repeats and unsafe scopes without claiming missing docs", () => {
    expect(() => discoverRepositorySources([], false, "REQUIREMENTS")).toThrow("Complete");
    expect(() => discoverRepositorySources([file("src/a.ts").entry, file("src/a.ts").entry], true, "REQUIREMENTS")).toThrow("Repeated");
    expect(() => discoverRepositorySources([], true, "REQUIREMENTS", ["../secret"])).toThrow("scope");
  });
  it("withholds assistant histories/instructions and refuses malformed Unicode paths", () => {
    const result = discoverRepositorySources([".local/requirements.md", "docs/AGENTS.md", "docs/transcript.md", "docs/spec.md"].map(path => file(path).entry), true, "REQUIREMENTS");
    expect(result.candidates.map(item => item.path)).toEqual(["docs/spec.md"]);
    expect(() => discoverRepositorySources([file("src/\uD800.ts").entry], true, "REQUIREMENTS")).toThrow();
  });
  it("excludes symlinks/submodules, traversals and generated/secret paths before blob reads", async () => {
    const read = reader([file("requirements.md", "must work"), file("docs/link.md", "x", "120000"), file(".env/requirements.md"), file("../requirements.md"), file("node_modules/docs/spec.md")]);
    const value = await scanConnectedGitlabRequirementsSource(read, "47", "main");
    expect(value.files.map(item => item.relativePath)).toEqual(["requirements.md"]); expect(read.mock.calls.filter(call => call[0].includes("/blobs/"))).toHaveLength(1);
  });
  it("requires explicit inference mode before any code blob read", async () => {
    const read = reader([file("src/a.ts")]); const value = await scanConnectedGitlabRequirementsSource(read, "47", "main");
    expect(value.sourceMode).toBe("CODE_INFERENCE_REQUIRES_APPROVAL"); expect(value.files).toEqual([]); expect(read.mock.calls).toHaveLength(2);
  });
  it("uses exact pinned code bytes only after complete zero-doc discovery", async () => {
    const content = "\uFEFFexport function synthetic() {}", read = reader([file("src/a.ts", content)]);
    const value = await scanConnectedGitlabRequirementsSource(read, "47", "main", ["."], 10, "DOCUMENTS_THEN_CODE");
    expect(value.sourceMode).toBe("CODE_INFERENCE"); expect(value.discovery).toMatchObject({ inventoryComplete: true, documentsDiscovered: 0 });
    expect(value.files[0]!.content).toBe(content); expect(value.files[0]!.contentHash).toBe(createHash("sha256").update(Buffer.from(content)).digest("hex")); expect(read.mock.calls[1]![0]).toContain(`ref=${commit}`);
  });
  it("never falls back when discovered docs are empty or screened", async () => {
    const read = reader([file("requirements.md", ""), file("src/a.ts")]); const value = await scanConnectedGitlabRequirementsSource(read, "47", "main", ["."], 10, "DOCUMENTS_THEN_CODE");
    expect(value.sourceMode).toBe("DOCUMENTS"); expect(value.files).toEqual([]); expect(read.mock.calls.filter(call => call[0].includes("/blobs/"))).toHaveLength(1);
  });
  it("reports bounded partial file intake and refuses ten full tree pages", async () => {
    const value = await scanConnectedGitlabRequirementsSource(reader([file("docs/a.md"), file("docs/b.md")]), "47", "main", ["."], 1);
    expect(value).toMatchObject({ eligibleFileCount: 2, inspectedFileCount: 1, truncated: true });
    const read = vi.fn(async (path: string) => path.includes("/commits/") ? { id: commit } : Array.from({ length: 100 }, (_, index) => file(`src/${read.mock.calls.length}-${index}.ts`).entry));
    await expect(scanConnectedGitlabRequirementsSource(read, "47", "main", ["."], 1, "DOCUMENTS_THEN_CODE")).rejects.toThrow("Complete"); expect(read).toHaveBeenCalledTimes(11);
  });
  it("refuses replaced/oversized blobs before content publication", async () => {
    const sample = file("requirements.md", "must work");
    for (const patch of [{ sha: "b".repeat(40) }, { size: 999999 }, { content: "!!" }]) await expect(scanConnectedGitlabRequirementsSource(reader([{ ...sample, blob: { ...sample.blob, ...patch } }]), "47", "main")).rejects.toThrow();
  });
  it("uses saved inference mode only after current approval and connected binding gates", async () => {
    gates.approval.mockReset(); gates.admit.mockReset(); gates.http.mockReset();
    const binding = { externalId: "47", origin: "https://gitlab.com", actorId: "original-actor" }, sample = file("src/a.ts");
    const approval = { results: { sourceBinding: binding, requirementsDiscovery: "DOCUMENTS_THEN_CODE" }, ref: "main", pathPrefixes: ["."], maxItems: 1 };
    gates.approval.mockResolvedValue(approval); gates.admit.mockResolvedValue({ binding, token: () => "synthetic-not-live" });
    gates.http.mockImplementation(async (_origin: string, path: string) => path === "/api/v4/projects/47" ? {} : reader([sample])(path));
    const db = { $transaction: async (action: (tx: unknown) => unknown) => action({}) };
    const value = await scanApprovedConnectedGitlabRequirementsSource({ prisma: db } as never, "approval", "project");
    expect(value.sourceMode).toBe("CODE_INFERENCE"); expect(gates.approval).toHaveBeenCalledWith({}, "approval", "project", "REQUIREMENTS"); expect(gates.admit.mock.calls.every(call => call[1] === binding && call[2] === binding)).toBe(true);
    gates.http.mockClear(); gates.approval.mockRejectedValueOnce(Error("Current original actor refused"));
    await expect(scanApprovedConnectedGitlabRequirementsSource({ prisma: db } as never, "approval", "project")).rejects.toThrow("refused"); expect(gates.http).not.toHaveBeenCalled();
  });
  it("refuses scope mutation after provider completion and never publishes its body", async () => {
    gates.approval.mockReset(); gates.admit.mockReset(); gates.http.mockReset();
    const binding = { externalId: "47", origin: "https://gitlab.com", actorId: "original-actor" };
    const approval = { results: { sourceBinding: binding, requirementsDiscovery: "DOCUMENTS_THEN_CODE" }, ref: "main", pathPrefixes: ["."], maxItems: 1 };
    gates.approval.mockResolvedValueOnce(approval).mockResolvedValueOnce(approval).mockResolvedValue({ ...approval, results: { sourceBinding: binding } });
    gates.admit.mockResolvedValue({ binding, token: () => "synthetic-not-live" }); gates.http.mockResolvedValue({});
    const db = { $transaction: async (action: (tx: unknown) => unknown) => action({}) };
    await expect(scanApprovedConnectedGitlabRequirementsSource({ prisma: db } as never, "approval", "project")).rejects.toThrow("approval changed"); expect(gates.http).toHaveBeenCalledTimes(1);
  });
});
