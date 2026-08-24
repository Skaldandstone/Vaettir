import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { isLikelyTestFile } from "@tci/core";

const execFileAsync = promisify(execFile);

// Repo scanning needs to fetch source from an arbitrary org-supplied URL, so
// it's deliberately restrictive: only https:// (no file://, no ssh so we
// don't have to worry about this box's own SSH keys being used against an
// unintended host), and git itself is invoked with an explicit argv array
// (execFile, not a shell string) so nothing in repoUrl/ref can be
// interpreted as a shell command.
export function assertScannableRepoUrl(repoUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    throw new Error("repoUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only https:// repo URLs are supported for scanning");
  }
}

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "vendor", "venv", ".venv"]);
const MAX_FILES = 25;
const MAX_FILE_BYTES = 100 * 1024;

async function walkTestFiles(rootDir: string, dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walkTestFiles(rootDir, join(dir, entry.name), out);
    } else if (entry.isFile() && isLikelyTestFile(entry.name)) {
      out.push(relative(rootDir, join(dir, entry.name)));
    }
  }
}

export interface ScannedTestFile {
  relativePath: string;
  content: string;
}

// Shallow-clones repoUrl@ref into a temp dir, collects up to MAX_FILES test
// files under MAX_FILE_BYTES each (skipping larger ones -- generated
// fixtures/snapshots occasionally masquerade as test files and blow up an
// LLM call for no benefit), and always cleans the clone up afterward even
// if reading files throws partway through.
export async function scanRepoForTestFiles(repoUrl: string, ref: string): Promise<ScannedTestFile[]> {
  assertScannableRepoUrl(repoUrl);
  const dir = await mkdtemp(join(tmpdir(), "tci-repo-scan-"));
  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--branch", ref, "--single-branch", repoUrl, dir]);

    const relativePaths: string[] = [];
    await walkTestFiles(dir, dir, relativePaths);

    const files: ScannedTestFile[] = [];
    for (const relativePath of relativePaths) {
      const absolutePath = join(dir, relativePath);
      const st = await stat(absolutePath);
      if (st.size > MAX_FILE_BYTES) continue;
      const content = await readFile(absolutePath, "utf-8");
      files.push({ relativePath: relativePath.split("\\").join("/"), content });
    }
    return files;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
