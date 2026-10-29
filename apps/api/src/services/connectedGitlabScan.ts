import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { z } from "@vaettir/core/dist/validation.js";
import type { Context } from "../trpc.js";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";
import { admitConnectedGitlab, assertGitlabProjectIdentity, connectedSourceBinding } from "./connectedRepositoryAccess.js";
import { assertRepositoryProcessingApproval, type ProcessingPurpose } from "./repositoryProcessingApproval.js";
import { sourcePathInScope, safeRepositoryText } from "./repositorySourceSafety.js";
import { discoverRepositorySources, repositoryDocumentRank, repositoryTestCandidate } from "./repositoryDiscovery.js";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const entrySchema = z.object({id:sha,path:z.string().max(500),type:z.enum(["blob","tree","commit"]),mode:z.string()});
export type GitlabJsonRead = (path:string)=>Promise<unknown>;
export function requirementsDocument(path:string) {
  return repositoryDocumentRank(path) !== null;
}

/** Bounded native API read: no clone, credentials in Git, redirects, code
 * execution or submodule traversal. Every file belongs to one pinned tree. */
export async function scanConnectedGitlab(read:GitlabJsonRead, externalId:string, ref:string, purpose:ProcessingPurpose,
  pathPrefixes:readonly string[], maxItems:number, knownHashes:ReadonlyMap<string,string>=new Map(),knownBlobs:ReadonlyMap<string,string>=new Map()) {
  z.string().regex(/^[1-9][0-9]*$/).parse(externalId);
  z.string().min(1).max(200).refine(value=>!value.startsWith("-")&&!/\s/.test(value)).parse(ref);
  z.number().int().min(1).max(purpose==="REQUIREMENTS"?10:25).parse(maxItems);
  const base=`/api/v4/projects/${externalId}/repository`;
  const commit=z.object({id:sha}).parse(await read(`${base}/commits/${encodeURIComponent(ref)}`));
  const entries:Array<z.infer<typeof entrySchema>>=[];const seen=new Set<string>();let complete=false;
  // Exactly 1,000 inspected tree entries at most. A truncated traversal is a
  // failure, never an empty repo or a complete coverage denominator.
  for(let page=1;page<=10;page++) {
    const params=new URLSearchParams({ref:commit.id,recursive:"true",per_page:"100",page:String(page)});
    const batch=z.array(entrySchema).max(100).parse(await read(`${base}/tree?${params}`));
    for(const entry of batch){if(seen.has(entry.path))throw Error("Repository tree changed or repeated a path.");seen.add(entry.path);entries.push(entry);}
    if(batch.length<100){complete=true;break;}
  }
  if(!complete)throw Error("Repository tree exceeds this bounded scan. Choose a smaller repository or export selected files; no complete scan is claimed.");
  const candidates=entries.filter(entry=>entry.type==="blob"&&["100644","100755"].includes(entry.mode)&&sourcePathInScope(entry.path,pathPrefixes)&&
    (purpose==="REQUIREMENTS"?requirementsDocument(entry.path):repositoryTestCandidate(entry.path))).sort((a,b)=>
    a.path.toLowerCase()==="readme.md"?-1:b.path.toLowerCase()==="readme.md"?1:a.path.localeCompare(b.path));
  const files:Array<{relativePath:string;content:string;contentHash:string}>=[];
  const observedFiles:Array<{path:string;hash:string}>=[];
  let reads=0;
  for(const entry of candidates) {
    // Previously retained bytes establish both Git blob identity and the
    // application SHA256. Skip only that exact pair before consuming the
    // bounded file-read budget, so unchanged paid files cannot starve new work.
    const knownHash=knownHashes.get(entry.path);
    if(knownHash&&knownBlobs.get(entry.path)===entry.id){observedFiles.push({path:entry.path,hash:knownHash});continue;}
    if(reads>=maxItems)break;reads++;
    const blob=z.object({sha,encoding:z.literal("base64"),size:z.number().int().min(0).max(150*1024),content:z.string().max(205000)}).parse(await read(`${base}/blobs/${entry.id}`));
    if(blob.sha!==entry.id)throw Error("GitLab returned another blob identity.");
    const bytes=Buffer.from(blob.content,"base64");
    if(bytes.toString("base64")!==blob.content || bytes.length!==blob.size ||
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")!==blob.sha)
      throw Error("GitLab file bytes did not match the pinned blob.");
    // Preserve a UTF-8 BOM just as the existing file reader does. Stripping it
    // would change content hashes and falsely mark unchanged source links stale.
    let content:string;try{content=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);}catch{continue;}
    if(!content || !safeRepositoryText(content))continue;
    const contentHash=createHash("sha256").update(content).digest("hex");
    observedFiles.push({path:entry.path,hash:contentHash});
    if(knownHashes.get(entry.path)===contentHash)continue;
    files.push({relativePath:entry.path,content,contentHash});
  }
  return {files,observedFiles,headSha:commit.id,eligibleFileCount:candidates.length,inspectedFileCount:reads,truncated:reads<candidates.length};
}

/** New requirements intake; selector is not consent. Hosted caller below derives
 * it only from the exact durable approval, never from metadata access alone. */
export async function scanConnectedGitlabRequirementsSource(read: GitlabJsonRead, externalId: string, ref: string, pathPrefixes: readonly string[] = ["."], maxItems = 10, mode: "DOCUMENTS_ONLY" | "DOCUMENTS_THEN_CODE" = "DOCUMENTS_ONLY") {
  z.string().regex(/^[1-9][0-9]*$/).parse(externalId);
  z.string().min(1).max(200).refine(value => !value.startsWith("-") && !/\s/.test(value)).parse(ref);
  z.number().int().min(1).max(10).parse(maxItems);
  z.enum(["DOCUMENTS_ONLY", "DOCUMENTS_THEN_CODE"]).parse(mode);
  // Scope validation must happen before even the commit metadata read.
  discoverRepositorySources([], true, "REQUIREMENTS", pathPrefixes);
  const base = `/api/v4/projects/${externalId}/repository`, commit = z.object({ id: sha }).parse(await read(`${base}/commits/${encodeURIComponent(ref)}`));
  const entries: Array<z.infer<typeof entrySchema>> = []; let complete = false;
  for (let page = 1; page <= 10; page++) {
    const params = new URLSearchParams({ ref: commit.id, recursive: "true", per_page: "100", page: String(page) });
    const batch = z.array(entrySchema).max(100).parse(await read(`${base}/tree?${params}`));
    entries.push(...batch);
    if (batch.length < 100) { complete = true; break; }
  }
  const selected = discoverRepositorySources(entries, complete, "REQUIREMENTS", pathPrefixes);
  const code = selected.sourceMode === "CODE_INFERENCE";
  const discovery = { mode: code ? "code" as const : "docs" as const, inventoryComplete: true as const, inventoryEntryCount: entries.length, documentsDiscovered: selected.documentsDiscovered, eligibleFileCount: selected.candidates.length, maxItems, codeInferenceApproved: mode === "DOCUMENTS_THEN_CODE" };
  if (code && mode !== "DOCUMENTS_THEN_CODE") return { files: [], headSha: commit.id, eligibleFileCount: selected.candidates.length, inspectedFileCount: 0, truncated: selected.candidates.length > 0, discovery, sourceMode: "CODE_INFERENCE_REQUIRES_APPROVAL" as const };
  const files: Array<{ relativePath: string; content: string; contentHash: string }> = []; let inspectedFileCount = 0;
  for (const entry of selected.candidates.slice(0, maxItems)) {
    inspectedFileCount++;
    const blob = z.object({ sha, encoding: z.literal("base64"), size: z.number().int().min(0).max(150 * 1024), content: z.string().max(205000) }).parse(await read(`${base}/blobs/${entry.id}`));
    const bytes = Buffer.from(blob.content, "base64");
    if (blob.sha !== entry.id || bytes.toString("base64") !== blob.content || bytes.length !== blob.size || createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== entry.id) throw Error("Repository bytes do not match the pinned source.");
    let content: string; try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { continue; }
    if (!content || !safeRepositoryText(content)) continue;
    files.push({ relativePath: entry.path, content, contentHash: createHash("sha256").update(bytes).digest("hex") });
  }
  return { files, headSha: commit.id, eligibleFileCount: selected.candidates.length, inspectedFileCount, truncated: inspectedFileCount < selected.candidates.length, discovery, sourceMode: code ? "CODE_INFERENCE" as const : "DOCUMENTS" as const };
}

/** Same native current approval/binding gates as legacy intake; no renewal,
 * paid operation, repository mutation or current-actor adoption. */
export async function scanApprovedConnectedGitlabRequirementsSource(ctx: Pick<Context, "prisma">, approvalId: string, projectId: string) {
  const started = Date.now();
  async function access() { return ctx.prisma.$transaction(async tx => {
    const approval = await assertRepositoryProcessingApproval(tx, approvalId, projectId, "REQUIREMENTS");
    const binding = connectedSourceBinding(approval.results); if (!binding) throw Error("A durable connected-source approval is required.");
    return { approval, ...await admitConnectedGitlab(tx, binding, binding) };
  }); }
  const initial = await access();
  const approvedMode = (results: unknown) => results && typeof results === "object" && !Array.isArray(results) && (results as Record<string, unknown>).requirementsDiscovery === "DOCUMENTS_THEN_CODE" ? "DOCUMENTS_THEN_CODE" as const : "DOCUMENTS_ONLY" as const;
  const mode = approvedMode(initial.approval.results);
  const same = (current: Awaited<ReturnType<typeof access>>) => { if (JSON.stringify(current.binding) !== JSON.stringify(initial.binding) || approvedMode(current.approval.results) !== mode) throw Error("Connected source approval changed."); };
  const read: GitlabJsonRead = async path => {
    if (Date.now() - started > 120000) throw Error("Connected source scan exceeded its bounded time limit.");
    const current = await access();
    same(current);
    const response = await repositoryProviderJson(current.binding.origin, path, { token: current.token() });
    same(await access()); return response;
  };
  assertGitlabProjectIdentity(initial.binding, await read(`/api/v4/projects/${initial.binding.externalId}`));
  return scanConnectedGitlabRequirementsSource(read, initial.binding.externalId, initial.approval.ref, initial.approval.pathPrefixes, initial.approval.maxItems, mode);
}

export async function scanApprovedConnectedGitlab(ctx:Pick<Context,"prisma">, approvalId:string, projectId:string, purpose:ProcessingPurpose, knownHashes:ReadonlyMap<string,string>=new Map(),knownBlobs:ReadonlyMap<string,string>=new Map()) {
  const started=Date.now();
  async function access(){return ctx.prisma.$transaction(async tx=>{
    const approval=await assertRepositoryProcessingApproval(tx,approvalId,projectId,purpose);
    const binding=connectedSourceBinding(approval.results);if(!binding)throw Error("A durable connected-source approval is required.");
    return {approval,...await admitConnectedGitlab(tx,binding,binding)};
  });}
  const initial=await access();
  const read:GitlabJsonRead=async path=>{
    if(Date.now()-started>120000)throw Error("Connected source scan exceeded its bounded time limit.");
    const current=await access();
    if(JSON.stringify(current.binding)!==JSON.stringify(initial.binding))throw Error("Connected source identity changed.");
    const response=await repositoryProviderJson(current.binding.origin,path,{token:current.token()});
    await access();return response;
  };
  assertGitlabProjectIdentity(initial.binding,await read(`/api/v4/projects/${initial.binding.externalId}`));
  return scanConnectedGitlab(read,initial.binding.externalId,initial.approval.ref,purpose,initial.approval.pathPrefixes,initial.approval.maxItems,knownHashes,knownBlobs);
}
