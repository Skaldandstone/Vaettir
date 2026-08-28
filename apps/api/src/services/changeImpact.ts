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

// 2026-08-28: "what's actually shipping in this build/release" - a
// direct, real-data-grounded alternative to a free-text prompt for QA
// strategy generation (P4-02). A plain `git log` between two refs rather
// than hitting a provider-specific PR API: for the common GitHub-flow
// case (squash-merge on PR merge) each commit subject already IS the PR
// title, and this works identically for any git host, not just GitHub -
// no installation/API-token dependency the way P6-01's PR scanning has.
// Capped at a reasonable count so an enormous range (e.g. base
// accidentally left at the very first commit) doesn't blow past a
// reasonable prompt size.
const MAX_COMMITS = 200;

export interface CommitLogEntry {
  sha: string;
  subject: string;
}

export async function getCommitLog(repoUrl: string, baseRef: string, headRef: string): Promise<CommitLogEntry[]> {
  const { dir, cleanup } = await cloneFullRepo(repoUrl);
  try {
    const resolvedBase = await resolveRef(dir, baseRef);
    const resolvedHead = await resolveRef(dir, headRef);
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--no-merges", `--max-count=${MAX_COMMITS}`, "--pretty=format:%h%x09%s", `${resolvedBase}..${resolvedHead}`],
      { cwd: dir },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, ...rest] = line.split("\t");
        return { sha: sha ?? "", subject: rest.join("\t") };
      });
  } finally {
    await cleanup();
  }
}

// P6-04: the actual patch content (not just file names) -- what "AI-
// assisted test plan recommendation" needs, since deciding whether a
// change is behaviorally significant enough to warrant a new test case
// requires reading what actually changed, not just which files did.
// `--unified=3` keeps context tight since this text goes straight into an
// LLM prompt; a hard character cap below guards against a huge PR blowing
// past a reasonable prompt size rather than silently truncating mid-hunk
// with no indication.
const MAX_DIFF_CHARS = 40_000;

export async function getDiffContent(repoUrl: string, baseRef: string, headRef: string): Promise<string> {
  const { dir, cleanup } = await cloneFullRepo(repoUrl);
  try {
    const resolvedBase = await resolveRef(dir, baseRef);
    const resolvedHead = await resolveRef(dir, headRef);
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--unified=3", `${resolvedBase}...${resolvedHead}`],
      { cwd: dir, maxBuffer: 10 * 1024 * 1024 },
    );
    if (stdout.length > MAX_DIFF_CHARS) {
      return `${stdout.slice(0, MAX_DIFF_CHARS)}\n\n[... diff truncated at ${MAX_DIFF_CHARS} characters ...]`;
    }
    return stdout;
  } finally {
    await cleanup();
  }
}
