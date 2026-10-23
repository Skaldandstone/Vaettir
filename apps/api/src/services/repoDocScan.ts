import { mkdtemp, readFile, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { assertScannableRepoUrl, cloneRepository } from "./repositoryTransport.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sourcePathInScope,safeRepositoryText } from "./repositorySourceSafety.js";
const execFileAsync = promisify(execFile);

// Requirements-from-repo (2026-08-28): the same shallow-clone-and-walk
// shape repoScan.ts already uses for test files, but looking for
// requirements/spec docs instead. Deliberately narrower than "every
// markdown file in the repo" - a real repo's markdown is mostly
// CHANGELOGs, CONTRIBUTING guides, and license text, none of which are
// requirements; scanning those would just waste AI credits on noise.
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "vendor", "venv", ".venv"]);
const NOISE_FILENAMES = new Set([
  "changelog.md",
  "contributing.md",
  "license.md",
  "code_of_conduct.md",
  "security.md",
  "support.md",
  "governance.md",
  "authors.md",
  "codeowners.md",
]);
const REQUIREMENTS_DIR_HINTS = ["docs", "doc", "spec", "specs", "requirements", "rfcs", "adr", "design"];
const MAX_FILES = 10;
const MAX_FILE_BYTES = 150 * 1024;

export interface ScannedDoc {
  relativePath: string;
  content: string;
}

function isLikelyRequirementsDoc(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  if (!lower.endsWith(".md") && !lower.endsWith(".mdx")) return false;
  const filename = lower.split("/").pop()!;
  if (NOISE_FILENAMES.has(filename)) return false;
  // Root README is always a real candidate; anything else needs to live
  // under a directory that actually suggests requirements/spec content.
  if (relativePath.toLowerCase() === "readme.md") return true;
  const segments = lower.split("/");
  return segments.slice(0, -1).some((seg) => REQUIREMENTS_DIR_HINTS.includes(seg));
}

async function walkDocs(rootDir: string, dir: string, out: ScannedDoc[], pathPrefixes: readonly string[], maxFiles: number): Promise<void> {
  if (out.length >= maxFiles) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= maxFiles) return;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walkDocs(rootDir, join(dir, entry.name), out, pathPrefixes, maxFiles);
    } else if (entry.isFile()) {
      const absolutePath = join(dir, entry.name);
      const relativePath = relative(rootDir, absolutePath).split("\\").join("/");
      if (!sourcePathInScope(relativePath, pathPrefixes) || !isLikelyRequirementsDoc(relativePath)) continue;
      const st = await stat(absolutePath);
      if (st.size > MAX_FILE_BYTES || st.size === 0) continue;
      const content = await readFile(absolutePath, "utf-8");
      if (!safeRepositoryText(content)) continue;
      out.push({ relativePath, content });
    }
  }
}

// Shallow-clones repoUrl@ref into a temp dir, collects up to MAX_FILES
// likely-requirements markdown docs (README always first if present),
// always cleaning up the clone afterward even if reading throws partway
// through.
export async function scanRepoForRequirementDocs(repoUrl: string, ref: string, pathPrefixes: readonly string[] = ["."], maxFiles = MAX_FILES): Promise<{files:ScannedDoc[];headSha:string}> {
  assertScannableRepoUrl(repoUrl);
  const dir = await mkdtemp(join(tmpdir(), "vaettir-doc-scan-"));
  try {
    await cloneRepository(repoUrl, dir, ref);
    const files: ScannedDoc[] = [];
    await walkDocs(dir, dir, files, pathPrefixes, Math.min(MAX_FILES,maxFiles));
    // README first, if it made the cut - the most likely single source
    // of real requirements in a typical repo, worth prioritizing when
    // MAX_FILES would otherwise cut it off in a doc-heavy repo.
    files.sort((a, b) => (a.relativePath.toLowerCase() === "readme.md" ? -1 : b.relativePath.toLowerCase() === "readme.md" ? 1 : 0));
    const {stdout} = await execFileAsync("git",["rev-parse","HEAD"],{cwd:dir});
    return {files,headSha:stdout.trim()};
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
