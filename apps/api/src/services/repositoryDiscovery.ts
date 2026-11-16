import { z } from "@vaettir/core/dist/validation.js";
import { isLikelyTestFile } from "@vaettir/core";
import { safeSourcePath, sourcePathInScope } from "./repositorySourceSafety.js";

export const repositoryDiscoveryEntry = z.object({ id: z.string().regex(/^[a-f0-9]{40}$/), path: z.string().min(1).max(500).refine(value => Buffer.from(value).toString("utf8") === value), type: z.enum(["blob", "tree", "commit"]), mode: z.string().max(12) }).strict();
export type RepositoryDiscoveryEntry = z.infer<typeof repositoryDiscoveryEntry>;
const noise = /^(?:changelog|contributing|license|code_of_conduct|security|support|governance|authors|codeowners)(?:\.[^.]+)?$/i;
const docDirectories = new Set(["docs", "doc", "spec", "specs", "requirements", "rfcs", "adr", "design"]);
const explicitDocument = /^(?:requirements?|(?:functional|software|business)[-_]requirements?|prd|specification|spec|acceptance[-_]criteria)(?:[-_].*)?\.(?:md|mdx|txt)$/i;

/** Candidate discovery only. A filename is not evidence of approved requirements. */
export function repositoryDocumentRank(path: string): number | null {
  const parts = path.toLowerCase().split("/"), name = parts.at(-1)!;
  if (noise.test(name) || ["agents.md", "claude.md", "skill.md"].includes(name) || /(?:transcript|chat[-_]export|conversation[-_]history)/.test(name)) return null;
  if (explicitDocument.test(name)) return 0;
  if (!/\.(md|mdx)$/.test(name)) return null;
  if (parts.slice(0, -1).some(part => docDirectories.has(part))) return 1;
  return path.toLowerCase() === "readme.md" ? 2 : null;
}
export function repositoryCodeCandidate(path: string): boolean {
  return /\.(?:[cm]?[jt]sx?|py|java|kt|cs|cpp|cc|c|h|hpp|go|rb|rs|swift|php)$/i.test(path) && !/(?:\.min\.[jt]s|\.d\.[cm]?ts|\.(?:generated|g)\.[^.]+)$/i.test(path);
}
export function repositoryTestCandidate(path: string): boolean {
  if(!sourcePathInScope(path,["."])||path.toLowerCase().split("/").some(part=>[".local",".codex",".claude",".cache","assistant-history"].includes(part)))return false;
  if (isLikelyTestFile(path)) return true;
  const parts = path.toLowerCase().split("/"), name = parts.at(-1)!;
  return parts.slice(0, -1).some(part => ["tests", "test", "__tests__", "e2e"].includes(part)) &&
    repositoryCodeCandidate(path) && !parts.some(part => ["fixtures", "__fixtures__", "helpers", "support", "snapshots", "__snapshots__"].includes(part)) && !/^(?:index|conftest|setup|teardown|config)(?:[.-]|$)/.test(name);
}

/** Caller proves COMPLETE pinned inventory. Never infer no docs from a page. */
export function discoverRepositorySources(raw: readonly RepositoryDiscoveryEntry[], complete: boolean, purpose: "TEST_CASES" | "REQUIREMENTS", pathPrefixes: readonly string[] = ["."]) {
  if (complete !== true || raw.length > 1000) throw Error("Complete bounded repository discovery is required.");
  if (!pathPrefixes.length || pathPrefixes.length > 20 || pathPrefixes.some(path => !safeSourcePath(path)) || new Set(pathPrefixes).size !== pathPrefixes.length) throw Error("Invalid repository discovery scope.");
  const entries = z.array(repositoryDiscoveryEntry).max(1000).parse(raw), seen = new Set<string>();
  for (const entry of entries) { if (seen.has(entry.path)) throw Error("Repeated repository discovery path."); seen.add(entry.path); }
  const eligible = entries.filter(entry => entry.type === "blob" && ["100644", "100755"].includes(entry.mode) && sourcePathInScope(entry.path, pathPrefixes) && !entry.path.toLowerCase().split("/").some(part => [".local", ".codex", ".claude", ".cache", "assistant-history"].includes(part)));
  const order = (a: RepositoryDiscoveryEntry, b: RepositoryDiscoveryEntry) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  // A generic root README is project context, not an actual requirements file.
  // Keep it eligible in the legacy docs-only reader, but it must not suppress
  // the explicitly approved code fallback in this new requirements workflow.
  const documents = eligible.filter(entry => {const rank=repositoryDocumentRank(entry.path);return rank!==null&&rank<2;}).sort((a, b) => repositoryDocumentRank(a.path)! - repositoryDocumentRank(b.path)! || order(a, b));
  const candidates = purpose === "TEST_CASES" ? eligible.filter(entry => repositoryTestCandidate(entry.path)).sort(order) : documents.length ? documents : eligible.filter(entry => repositoryCodeCandidate(entry.path)).sort(order);
  return { sourceMode: purpose === "TEST_CASES" ? "TEST_CANDIDATES" as const : documents.length ? "DOCUMENTS" as const : "CODE_INFERENCE" as const, documentsDiscovered: documents.length, candidates };
}
