/** Customer addresses are one DNS label; display names remain independent. */
export const WORKSPACE_DOMAIN_SUFFIX = "vaettir.app";
export const RESERVED_WORKSPACE_NAMES = [
  "www", "app", "api", "auth", "login", "logout", "sign-in", "sign-up",
  "admin", "administrator", "support", "help", "status", "mail", "email",
  "smtp", "imap", "pop", "ftp", "cdn", "assets", "static", "media", "files",
  "billing", "payments", "checkout", "account", "accounts", "onboarding",
  "docs", "developer", "developers", "dev", "test", "staging", "preview",
  "demo", "sandbox", "internal", "localhost", "security", "abuse", "legal",
  "privacy", "terms", "vaettir", "skaldandstone-admin", "autodiscover",
] as const;
const reserved = new Set<string>(RESERVED_WORKSPACE_NAMES);
export function normalizeWorkspaceName(value: string): string {
  return value.trim().toLowerCase();
}
export function workspaceNameError(value: string): string | null {
  const name = normalizeWorkspaceName(value);
  if (!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(name) || name.includes("--"))
    return "Use 3–63 letters, numbers or single hyphens, starting with a letter and ending with a letter or number.";
  if (reserved.has(name)) return "This address is reserved. Choose another name.";
  return null;
}
export function workspaceHostname(name: string): string {
  return `${normalizeWorkspaceName(name)}.${WORKSPACE_DOMAIN_SUFFIX}`;
}
