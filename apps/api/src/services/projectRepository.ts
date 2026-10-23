import { z } from "zod";
export const RepositoryProvider = z.enum(["github", "gitlab", "bitbucket", "azure-devops", "git", "perforce", "svn"]);
export function validateRepositoryLocation(provider: string, value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Use an HTTPS repository URL without credentials, query parameters or fragments.");
  const hosts: Record<string, string> = {github:"github.com",gitlab:"gitlab.com",bitbucket:"bitbucket.org","azure-devops":"dev.azure.com"};
  if (hosts[provider] && url.hostname !== hosts[provider]) throw new Error("The repository host does not match the selected provider. Use Self-hosted Git for a private Git host.");
  if (url.pathname === "/") throw new Error("Include the repository path, not just the host.");
  return url.href.replace(/\/$/, "");
}
