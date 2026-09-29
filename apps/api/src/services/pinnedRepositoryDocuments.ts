import { createHash } from "node:crypto";
import { z } from "zod";

const safeSegment = /^[a-zA-Z0-9_.-]+$/;
export const pinnedDocumentScope = z.object({
  provider: z.enum(["github", "gitlab"]),
  repository: z.string().min(3).max(300),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  paths: z.array(z.string().min(1).max(300)).min(1).max(5),
  processingPermission: z.literal(true),
}).strict();
type Scope = z.infer<typeof pinnedDocumentScope>;
type Result = { path: string; status: "read" | "unavailable"; content?: string; contentHash?: string; locator?: string };
const denied = new Set(["node_modules", "vendor", "dist", "build", "coverage", "secrets", "credentials"]);

function validateScope(scope: Scope) {
  const repo = scope.repository.split("/");
  if (repo.length < 2 || (scope.provider === "github" && repo.length !== 2) || repo.some(part => !safeSegment.test(part) || part.startsWith(".")))
    throw new Error("Use an owner/repository or GitLab namespace/project identity, not a URL.");
  if (new Set(scope.paths).size !== scope.paths.length) throw new Error("Duplicate selected paths");
  for (const path of scope.paths) {
    const segments = path.split("/");
    if (segments.some(part => !safeSegment.test(part) || part.startsWith(".") || denied.has(part.toLowerCase())) ||
      (!/\.(md|markdown|txt)$/i.test(path) && !/^readme$/i.test(path)))
      throw new Error("Select explicit plain-text document paths outside secrets, dependencies and generated directories.");
  }
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("Provider unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 500_000) throw new Error("Provider response exceeds limit");
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const encodedFile = z.object({ encoding: z.literal("base64"), content: z.string(), size: z.number().int().min(1).max(50_000) });
function decodeFile(input: unknown) {
  const file = encodedFile.parse(input);
  const encoded = file.content.replace(/[\r\n]/g, "");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || bytes.length !== file.size) throw new Error("Invalid file encoding");
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!content.trim() || Array.from(content).some(char => {
    const code = char.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  })) throw new Error("Not plain text");
  // Conservative screening, not a claim of comprehensive secret detection.
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\b(?:password|secret|api[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/i.test(content))
    throw new Error("Possible sensitive content");
  return { content, bytes };
}

/**
 * Hosted-provider document adapter. No arbitrary hosts, redirects, cloning,
 * imported-code execution, AI or writes. The caller must persist authorization,
 * exact selected scope and run provenance before exposing this in a user flow.
 * Credentials are ephemeral here and must come from an authorized connection.
 */
export async function readPinnedRepositoryDocuments(
  input: Scope,
  options: { token?: string; signal?: AbortSignal; fetcher?: typeof fetch } = {},
) {
  const scope = pinnedDocumentScope.parse(input);
  validateScope(scope);
  const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(options.signal ? [options.signal] : [])]);
  signal.throwIfAborted();
  const fetcher = options.fetcher ?? fetch;
  if (options.token && /[\r\n]/.test(options.token)) throw new Error("Invalid connection credential");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (scope.provider === "github") {
    headers["X-GitHub-Api-Version"] = "2022-11-28";
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
  } else if (options.token) headers["PRIVATE-TOKEN"] = options.token;
  const base = scope.provider === "github" ? "https://api.github.com" : "https://gitlab.com";
  let requests = 0;
  const cache = new Map<string, unknown>();
  async function get(path: string): Promise<unknown> {
    signal.throwIfAborted();
    if (cache.has(path)) return cache.get(path);
    if (++requests > 25) throw new Error("Read budget exceeded");
    const response = await fetcher(`${base}${path}`, { headers, redirect: "error", signal });
    const body = await boundedJson(response, signal);
    cache.set(path, body);
    return body;
  }
  const results: Result[] = [];
  for (const path of scope.paths) {
    if (signal.aborted) break;
    try {
      let decoded: ReturnType<typeof decodeFile>;
      if (scope.provider === "github") {
        const prefix = `/repos/${scope.repository}`;
        const commit = z.object({ sha, tree: z.object({ sha }) }).parse(await get(`${prefix}/git/commits/${scope.commit}`));
        if (commit.sha !== scope.commit) throw new Error("Revision mismatch");
        let treeSha = commit.tree.sha;
        const segments = path.split("/");
        let blobSha = "";
        for (let index = 0; index < segments.length; index++) {
          const tree = z.object({ truncated: z.literal(false), tree: z.array(z.object({ path: z.string(), mode: z.string(), type: z.string(), sha })) }).parse(await get(`${prefix}/git/trees/${treeSha}`));
          const entry = tree.tree.find(item => item.path === segments[index]);
          if (!entry) throw new Error("Path unavailable");
          if (index < segments.length - 1) {
            if (entry.type !== "tree" || entry.mode !== "040000") throw new Error("Not a directory");
            treeSha = entry.sha;
          } else {
            // Never dereference symlinks or submodules to unselected targets.
            if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) throw new Error("Unsupported file mode");
            blobSha = entry.sha;
          }
        }
        decoded = decodeFile(await get(`${prefix}/git/blobs/${blobSha}`));
        const actual = createHash("sha1").update(`blob ${decoded.bytes.length}\0`).update(decoded.bytes).digest("hex");
        if (actual !== blobSha) throw new Error("Blob identity mismatch");
      } else {
        const file = z.object({ file_path: z.string(), commit_id: sha, content_sha256: z.string() }).passthrough().parse(await get(`/api/v4/projects/${encodeURIComponent(scope.repository)}/repository/files/${encodeURIComponent(path)}?ref=${scope.commit}`));
        if (file.file_path !== path || file.commit_id !== scope.commit) throw new Error("Revision or path mismatch");
        decoded = decodeFile(file);
        if (createHash("sha256").update(decoded.bytes).digest("hex") !== file.content_sha256) throw new Error("Content identity mismatch");
      }
      results.push({ path, status: "read", content: decoded.content,
        contentHash: createHash("sha256").update(decoded.bytes).digest("hex"),
        locator: `https://${scope.provider === "github" ? "github.com" : "gitlab.com"}/${scope.repository}/${scope.provider === "github" ? "blob" : "-/blob"}/${scope.commit}/${path.split("/").map(encodeURIComponent).join("/")}` });
    } catch {
      // Never return tokens, provider error bodies, or classify denied access as deletion.
      results.push({ path, status: "unavailable" });
    }
  }
  return { provider: scope.provider, repository: scope.repository, commit: scope.commit,
    status: signal.aborted ? "cancelled" as const : results.every(result => result.status === "read") ? "complete" as const : "partial" as const,
    scope: "selected-documents-only" as const, requests, results };
}
