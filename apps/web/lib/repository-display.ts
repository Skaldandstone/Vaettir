/** Labels only: never changes a saved URL, repository ID or access decision. */
export function repositoryDisplayName(value: string): string {
  if (!value || value.length > 1000) return "Repository reference";
  try {
    const url = new URL(value);
    const path = url.pathname.split("/").filter(Boolean).join("/").replace(/\.git$/, "");
    return path || url.hostname || "Repository reference";
  } catch {
    const scp = /^[^@\s/:]+@[^:\s]+:([^\s?#]+)$/.exec(value);
    return scp?.[1]?.replace(/\.git$/, "") || "Repository reference";
  }
}
