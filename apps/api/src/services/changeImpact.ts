import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertScannableRepoUrl } from "./repoScan.js";

const execFileAsync = promisify(execFile);

// Unlike repoScan's shallow single-branch clone (which only needs one ref's
// file contents), diffing two refs needs both refs' history to actually be
// present locally. `git clone` without `--single-branch`/`--depth` fetches
// every branch, which is what lets `git diff base...head` work below.
export async function cloneFullRepo(repoUrl: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  assertScannableRepoUrl(repoUrl);
  const dir = await mkdtemp(join(tmpdir(), "tci-diff-"));
  await execFileAsync("git", ["clone", repoUrl, dir]);
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// A ref might be a branch name (only resolvable as origin/<name> after a
// clone -- only the checked-out default branch gets a bare local ref) or a
// raw commit SHA (resolvable directly; "origin/<sha>" isn't a valid ref
// pattern at all). Try the branch form first since that's the common case,
// fall back to the bare form for SHAs and anything already resolvable.
export async function resolveRef(dir: string, ref: string): Promise<string> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", `origin/${ref}`], { cwd: dir });
    return `origin/${ref}`;
  } catch {
    await execFileAsync("git", ["rev-parse", "--verify", ref], { cwd: dir });
    return ref;
  }
}

// P5-14: fetches one file's content as of a specific commit -- what
// continuousListening.ts needs to reverse-engineer a CI-reported test that
// arrived with no matching TestCaseSource. Returns null (not a thrown
// error) for any failure -- wrong/unreachable repo, commit not found,
// file not present at that commit -- since the caller's response to any
// of those is the same: fall back to manual linking rather than failing
// the ingestion that triggered this.
export async function fetchFileAtCommit(repoUrl: string, commitSha: string, filePath: string): Promise<string | null> {
  try {
    const { dir, cleanup } = await cloneFullRepo(repoUrl);
    try {
      const { stdout } = await execFileAsync("git", ["show", `${commitSha}:${filePath}`], { cwd: dir });
      return stdout;
    } finally {
      await cleanup();
    }
  } catch {
    return null;
  }
}

// `base...head` (triple-dot) diffs against the merge-base rather than
// head-to-head, matching what a PR/compare view shows: "what did this
// branch actually change relative to where it forked from", not
// contaminated by unrelated commits that landed on base afterward.
export async function getChangedFiles(repoUrl: string, baseRef: string, headRef: string): Promise<string[]> {
  const { dir, cleanup } = await cloneFullRepo(repoUrl);
  try {
    const resolvedBase = await resolveRef(dir, baseRef);
    const resolvedHead = await resolveRef(dir, headRef);
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", `${resolvedBase}...${resolvedHead}`], { cwd: dir });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } finally {
    await cleanup();
  }
}
