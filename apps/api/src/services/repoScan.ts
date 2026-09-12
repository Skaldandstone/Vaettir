import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { isLikelyTestFile } from "@vaettir/core";
import { cloneFullRepo, resolveRef } from "./changeImpact.js";

const execFileAsync = promisify(execFile);

export function hashFileContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

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
// P2-09: this used to be the sole guard against an oversized file blowing up
// a single LLM call -- now reverseEngineerTestFile itself chunks large files
// by evaluator-extracted test block, so this only needs to guard against a
// genuinely pathological file (a generated fixture/snapshot masquerading as
// a test file, per the comment below), not ordinary "large but real" files.
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ScannedTestFile {
  relativePath: string;
  content: string;
  contentHash: string;
}

// `knownHashes` maps an already-tracked file's path (as stored on its
// TestCaseSource) to the content hash it was last scanned at. A file whose
// current hash matches is skipped entirely -- unchanged since last scan,
// nothing for the LLM to redo -- and critically that skip happens *during*
// the walk, before it can count against MAX_FILES, so a repo full of
// already-up-to-date tracked files doesn't starve out newly added or
// genuinely changed ones (the bug this replaced: a purely path-based
// exclude-forever meant a changed file was never caught either).
async function walkTestFiles(
  rootDir: string,
  dir: string,
  out: ScannedTestFile[],
  knownHashes: Map<string, string>,
): Promise<void> {
  if (out.length >= MAX_FILES) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walkTestFiles(rootDir, join(dir, entry.name), out, knownHashes);
    } else if (entry.isFile() && isLikelyTestFile(entry.name)) {
      const absolutePath = join(dir, entry.name);
      const relativePath = relative(rootDir, absolutePath).split("\\").join("/");
      const st = await stat(absolutePath);
      // Generated fixtures/snapshots occasionally masquerade as test files
      // and blow up an LLM call for no benefit -- skip, don't count against
      // MAX_FILES either, same reasoning as the hash-match skip above.
      if (st.size > MAX_FILE_BYTES) continue;
      const content = await readFile(absolutePath, "utf-8");
      const contentHash = hashFileContent(content);
      if (knownHashes.get(relativePath) === contentHash) continue;
      out.push({ relativePath, content, contentHash });
    }
  }
}

// Shallow-clones repoUrl@ref into a temp dir and collects up to MAX_FILES
// test files that are either new or have changed since they were last
// scanned, always cleaning the clone up afterward even if reading files
// throws partway through. Full-tree walk + hash: correct on any repo state,
// but reads and hashes every test file even when almost nothing changed --
// the only option for a project's first scan, since there's no earlier
// commit yet to diff from. See scanChangedTestFiles below for the faster
// path once a project has a checkpoint.
export interface ChangedFileScanResult {
  files: ScannedTestFile[];
  headSha: string;
}

export async function scanRepoForTestFiles(
  repoUrl: string,
  ref: string,
  knownHashes: Map<string, string> = new Map(),
): Promise<ChangedFileScanResult> {
  assertScannableRepoUrl(repoUrl);
  const dir = await mkdtemp(join(tmpdir(), "tci-repo-scan-"));
  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--branch", ref, "--single-branch", repoUrl, dir]);
    const files: ScannedTestFile[] = [];
    await walkTestFiles(dir, dir, files, knownHashes);
    const { stdout: headShaOut } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir });
    return { files, headSha: headShaOut.trim() };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// P2-05: once a project has been scanned before (`sinceCommitSha` set from
// the prior scan's resolved HEAD), a re-scan only needs to look at what
// `git diff` says actually changed between then and now -- one diff call
// against a handful of paths, instead of walking and hashing every test
// file in the repo again. Non-test-file changes (the vast majority of most
// diffs) are filtered out before anything is read. `knownHashes` still
// applies on top: a file can appear in the diff (e.g. a formatting-only
// commit touched it) without its content actually differing from what's
// already tracked, so the same skip-without-reading-if-possible reasoning
// from the full-walk path still holds for entries where a stat/read is
// unavoidable to know for sure.
export async function scanChangedTestFiles(
  repoUrl: string,
  sinceCommitSha: string,
  ref: string,
  knownHashes: Map<string, string> = new Map(),
): Promise<ChangedFileScanResult> {
  assertScannableRepoUrl(repoUrl);
  const { dir, cleanup } = await cloneFullRepo(repoUrl);
  try {
    const resolvedHead = await resolveRef(dir, ref);
    const { stdout: headShaOut } = await execFileAsync("git", ["rev-parse", resolvedHead], { cwd: dir });
    const headSha = headShaOut.trim();

    const { stdout: diffOut } = await execFileAsync(
      "git",
      ["diff", "--name-only", `${sinceCommitSha}...${resolvedHead}`],
      { cwd: dir },
    );
    const changedPaths = diffOut
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((p) => isLikelyTestFile(p));

    const files: ScannedTestFile[] = [];
    for (const relativePath of changedPaths) {
      if (files.length >= MAX_FILES) break;
      const absolutePath = join(dir, relativePath);
      let st;
      try {
        st = await stat(absolutePath);
      } catch {
        continue; // file was deleted in this range -- nothing to scan
      }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      const content = await readFile(absolutePath, "utf-8");
      const contentHash = hashFileContent(content);
      if (knownHashes.get(relativePath) === contentHash) continue;
      files.push({ relativePath, content, contentHash });
    }
    return { files, headSha };
  } finally {
    await cleanup();
  }
}
