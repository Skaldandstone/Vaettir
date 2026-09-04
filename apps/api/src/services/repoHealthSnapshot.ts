import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { join, extname } from "node:path";
import { cloneFullRepo } from "./changeImpact.js";

// Ports quality_dashboard's github_data.py + metrics.py + git_risk.py
// (rescued 2026-09-02 from Skaldandstone/test-case-management-platform,
// itself never onboarded as a Vaettir customer) into a staff-only,
// on-demand admin tool -- deliberately NOT a persisted feature: no
// snapshot table, no scheduled job, just "point it at a repo and read the
// numbers", matching the original CLI's own scope. For repos that ARE full
// Vaettir customers, riskAnalysis.ts/coverage.ts/flakyDetection.ts already
// do a more precise, per-test-case version of this from real ingested
// data; this exists for repos with no Vaettir test-case data at all
// (used historically to generate the Ginnungagap/Kall demo dashboards).

const execFileAsync = promisify(execFile);

export class RepoHealthSnapshotError extends Error {}

function githubToken(): string {
  const token = process.env.STAFF_GITHUB_TOKEN;
  if (!token) {
    throw new RepoHealthSnapshotError("STAFF_GITHUB_TOKEN is not configured -- required to read GitHub Actions run history");
  }
  return token;
}

async function ghApi<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Authorization: `Bearer ${githubToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new RepoHealthSnapshotError(`GitHub API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export interface JobRun {
  runId: number;
  jobName: string;
  conclusion: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  headSha: string;
}

export function jobPassed(run: JobRun): boolean {
  return run.conclusion === "success";
}

// repo is "owner/name". Flattens the last `limit` completed runs of
// workflowFile (e.g. "ci.yml") into one JobRun per job per run, newest
// first -- mirrors fetch_workflow_runs in github_data.py.
export async function fetchWorkflowRuns(repo: string, workflowFile: string, limit = 50): Promise<JobRun[]> {
  const workflows = await ghApi<{ workflows: { id: number; path: string }[] }>(`repos/${repo}/actions/workflows`);
  const workflow = workflows.workflows.find((wf) => wf.path.endsWith(workflowFile));
  if (!workflow) {
    throw new RepoHealthSnapshotError(`No workflow matching "${workflowFile}" found in ${repo}`);
  }

  const runsPayload = await ghApi<{ workflow_runs: { id: number; head_sha: string }[] }>(
    `repos/${repo}/actions/workflows/${workflow.id}/runs?per_page=${limit}&status=completed`,
  );

  const jobRuns: JobRun[] = [];
  for (const run of runsPayload.workflow_runs) {
    const jobsPayload = await ghApi<{
      jobs: { name: string; conclusion: string | null; started_at?: string; completed_at?: string }[];
    }>(`repos/${repo}/actions/runs/${run.id}/jobs`);
    for (const job of jobsPayload.jobs) {
      jobRuns.push({
        runId: run.id,
        jobName: job.name,
        conclusion: job.conclusion,
        startedAt: job.started_at ? new Date(job.started_at) : null,
        completedAt: job.completed_at ? new Date(job.completed_at) : null,
        headSha: run.head_sha,
      });
    }
  }
  return jobRuns;
}

export interface JobMetrics {
  jobName: string;
  totalRuns: number;
  passRate: number;
  flakinessScore: number;
  lastConclusion: string | null;
  lastRunAt: Date | null;
  passRateDelta: number | null;
  runs: JobRun[];
}

const ROLLING_WINDOW = 20;

// Fraction of consecutive-run pairs (within the window) that disagree --
// a steady run of failures followed by a fix scores low, genuinely
// alternating results score high.
function flakiness(runsNewestFirst: JobRun[]): number {
  if (runsNewestFirst.length < 2) return 0;
  let flips = 0;
  for (let i = 0; i < runsNewestFirst.length - 1; i++) {
    if (jobPassed(runsNewestFirst[i]!) !== jobPassed(runsNewestFirst[i + 1]!)) flips++;
  }
  return flips / (runsNewestFirst.length - 1);
}

export function computeJobMetrics(jobRuns: JobRun[], window = ROLLING_WINDOW): JobMetrics[] {
  const byName = new Map<string, JobRun[]>();
  for (const run of jobRuns) {
    if (!byName.has(run.jobName)) byName.set(run.jobName, []);
    byName.get(run.jobName)!.push(run);
  }

  const results: JobMetrics[] = [];
  for (const [jobName, runs] of byName) {
    const sorted = [...runs].sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0));
    const windowed = sorted.slice(0, window);
    const previousWindow = sorted.slice(window, window * 2);
    const passed = windowed.filter(jobPassed).length;
    const previousPassRate = previousWindow.length > 0 ? previousWindow.filter(jobPassed).length / previousWindow.length : null;
    const passRate = windowed.length > 0 ? passed / windowed.length : 0;

    results.push({
      jobName,
      totalRuns: windowed.length,
      passRate,
      flakinessScore: flakiness(windowed),
      lastConclusion: windowed[0]?.conclusion ?? null,
      lastRunAt: windowed[0]?.startedAt ?? null,
      passRateDelta: previousPassRate !== null ? passRate - previousPassRate : null,
      runs: windowed,
    });
  }
  return results.sort((a, b) => a.jobName.localeCompare(b.jobName));
}

// Across all jobs, how many days since every job's latest run was green --
// looks back through each job's own window for its most recent success and
// reports the worst (largest) gap. Null if any job has zero green runs in
// its window at all.
export function daysSinceLastGreen(jobMetrics: JobMetrics[]): number | null {
  const now = Date.now();
  let worstGap: number | null = null;
  for (const jm of jobMetrics) {
    const lastGreen = jm.runs.find((r) => jobPassed(r) && r.startedAt !== null);
    if (!lastGreen?.startedAt) return null;
    const gapDays = (now - lastGreen.startedAt.getTime()) / 86_400_000;
    if (worstGap === null || gapDays > worstGap) worstGap = gapDays;
  }
  return worstGap;
}

// --- git-churn risk footprint --------------------------------------------

const SOURCE_EXTENSIONS = new Set([".py", ".ts", ".tsx", ".js", ".jsx"]);
const SKIP_DIR_PARTS = new Set(["tests", "test", "e2e", "__pycache__", "node_modules", "migrations"]);
const CHANGED_FILE_RE = /^\s*(?<path>[^\s|]+)\s*\|\s*\d+/;

async function runGit(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: dir });
  return stdout;
}

async function churnCounts(dir: string, sinceDays: number, untilDays = 0): Promise<Map<string, number>> {
  const args = ["log", `--since=${sinceDays}.days`];
  if (untilDays) args.push(`--until=${untilDays}.days`);
  args.push("--stat", "--pretty=format:COMMIT");
  const output = await runGit(dir, args);

  const counts = new Map<string, number>();
  for (const line of output.split("\n")) {
    if (line === "COMMIT" || !line.trim()) continue;
    const match = CHANGED_FILE_RE.exec(line);
    if (!match?.groups) continue;
    const path = match.groups.path!.trim();
    if (!SOURCE_EXTENSIONS.has(extname(path))) continue;
    const parts = path.split(/[/\\]/);
    if (parts.some((p) => SKIP_DIR_PARTS.has(p))) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

const NAME_PREFIXES = ["api_", "test_", "services_"];

function moduleName(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

// Strips common prefixes so api_growth.py and test_growth.py both
// normalize to "growth" -- source and test files rarely share an exact
// stem, so matching on the topic after the prefix is what actually
// reflects the target repo's naming convention.
function normalizedTopic(stem: string): string {
  const lowered = stem.toLowerCase();
  for (const prefix of NAME_PREFIXES) {
    if (lowered.startsWith(prefix)) return lowered.slice(prefix.length);
  }
  return lowered;
}

interface TestFile {
  relativePath: string;
  stem: string;
  fileName: string;
  content: string;
}

async function findTestFiles(dir: string): Promise<TestFile[]> {
  const patterns = ["tests/**/*.py", "**/*.spec.ts", "**/*.test.ts", "**/*.test.tsx"];
  const paths = new Set<string>();
  for (const pattern of patterns) {
    for await (const entry of glob(pattern, { cwd: dir })) {
      if (entry.split(/[/\\]/).includes("node_modules")) continue;
      paths.add(entry);
    }
  }

  const files: TestFile[] = [];
  for (const rawPath of paths) {
    // node:fs/promises glob returns OS-native separators (backslashes on
    // Windows) -- normalize to match git's own forward-slash paths, since
    // matchedTest is displayed alongside those.
    const relativePath = rawPath.replace(/\\/g, "/");
    try {
      const content = await readFile(join(dir, rawPath), "utf-8");
      const fileName = relativePath.split("/").pop() ?? relativePath;
      files.push({ relativePath, stem: moduleName(relativePath), fileName, content });
    } catch {
      // unreadable file (binary, permissions, race with deletion) -- skip
    }
  }
  return files;
}

export interface RiskEntry {
  path: string;
  changeCount: number;
  testConfidence: number;
  riskScore: number;
  matchedTest: string | null;
}

function scoreChurn(churn: Map<string, number>, testFiles: TestFile[]): Map<string, RiskEntry> {
  const entries = new Map<string, RiskEntry>();
  if (churn.size === 0) return entries;
  const maxChurn = Math.max(...churn.values());

  for (const [path, count] of churn) {
    const module = moduleName(path);
    const topic = normalizedTopic(module);
    let matchedTest: string | null = null;
    let confidence = 0;

    for (const tf of testFiles) {
      const testTopic = normalizedTopic(tf.stem);
      const nameHit = topic === testTopic || tf.fileName.toLowerCase().includes(module.toLowerCase());
      const contentHit = new RegExp(`\\b${module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(tf.content);
      if (nameHit && contentHit) {
        confidence = 1.0;
        matchedTest = tf.relativePath;
        break;
      }
      if (nameHit && confidence < 0.7) {
        confidence = 0.7;
        matchedTest = tf.relativePath;
      } else if (contentHit && confidence < 0.4) {
        confidence = 0.4;
        matchedTest = tf.relativePath;
      }
    }

    const changeFrequency = count / maxChurn;
    entries.set(path, {
      path,
      changeCount: count,
      testConfidence: confidence,
      riskScore: changeFrequency * (1 - confidence),
      matchedTest,
    });
  }
  return entries;
}

export async function computeRiskFootprint(dir: string, sinceDays = 90, topN = 15): Promise<RiskEntry[]> {
  const churn = await churnCounts(dir, sinceDays);
  const testFiles = await findTestFiles(dir);
  const entries = [...scoreChurn(churn, testFiles).values()];
  entries.sort((a, b) => b.riskScore - a.riskScore);
  return entries.slice(0, topN);
}

// --- top-level snapshot ----------------------------------------------------

export interface RepoHealthSnapshot {
  repo: string;
  jobs: JobMetrics[];
  daysSinceLastGreen: number | null;
  riskFootprint: RiskEntry[];
}

export async function computeRepoHealthSnapshot(
  repo: string,
  options: { workflowFile?: string; runs?: number; sinceDays?: number; topN?: number } = {},
): Promise<RepoHealthSnapshot> {
  const { workflowFile = "ci.yml", runs = 50, sinceDays = 90, topN = 15 } = options;

  const [jobRuns, riskFootprint] = await Promise.all([
    fetchWorkflowRuns(repo, workflowFile, runs),
    (async () => {
      const { dir, cleanup } = await cloneFullRepo(`https://github.com/${repo}.git`);
      try {
        return await computeRiskFootprint(dir, sinceDays, topN);
      } finally {
        await cleanup();
      }
    })(),
  ]);

  const jobs = computeJobMetrics(jobRuns);
  return { repo, jobs, daysSinceLastGreen: daysSinceLastGreen(jobs), riskFootprint };
}
