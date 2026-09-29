import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { devNull } from "node:os";

const execFileAsync = promisify(execFile);
const hosts = new Set(["github.com", "gitlab.com", "bitbucket.org", "dev.azure.com"]);

export function assertScannableRepoUrl(repoUrl: string): void {
  let url: URL;
  try { url = new URL(repoUrl); } catch { throw new Error("repoUrl must be a valid URL"); }
  if (url.protocol !== "https:" || !hosts.has(url.hostname) || url.username || url.password ||
      url.port || url.search || url.hash || /[\\\s%]/.test(repoUrl) ||
      url.pathname.split("/").filter(Boolean).length < 2) {
    throw new Error("Scanning supports credential-free HTTPS repository URLs on GitHub, GitLab, Bitbucket or Azure DevOps hosted services. Self-hosted sources require a scoped connector.");
  }
}

// Do not inherit credential helpers, URL rewrites, proxy settings or Git config
// injection from the API process. Private repositories require a scoped adapter.
export function cloneInvocation(repoUrl: string, dir: string, ref?: string) {
  assertScannableRepoUrl(repoUrl);
  if (ref !== undefined && (!ref || ref.startsWith("-") || /\s/.test(ref) || Array.from(ref).some(char => char.charCodeAt(0) < 32)))
    throw new Error("Invalid repository branch");
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  for (const [key, value] of Object.entries(process.env)) {
    if (["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG"].includes(key.toUpperCase())) env[key] = value;
  }
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_SYSTEM: devNull, GIT_TERMINAL_PROMPT: "0", GIT_ALLOW_PROTOCOL: "https",
    GIT_LFS_SKIP_SMUDGE: "1" });
  const args = ["-c", "http.followRedirects=false", "-c", "credential.helper=",
    "-c", `core.hooksPath=${devNull}`, "-c", "protocol.allow=never", "-c", "protocol.https.allow=always",
    "clone", "--template=", "--no-recurse-submodules",
    ...(ref === undefined ? [] : ["--depth", "1", "--branch", ref, "--single-branch"]), "--", repoUrl, dir];
  return { args, options: { cwd: dir, env, timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true } };
}

export async function cloneRepository(repoUrl: string, dir: string, ref?: string) {
  const { args, options } = cloneInvocation(repoUrl, dir, ref);
  try { await execFileAsync("git", args, options); }
  catch { throw new Error("Repository clone failed or timed out. Verify the hosted URL and access; redirects and implicit credentials are not supported."); }
}
