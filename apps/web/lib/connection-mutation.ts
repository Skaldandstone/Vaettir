const connectionRoutes = new Set([
  "repositoryConnections", "linearConnections", "jiraConnections", "driveConnections",
  "populationDocuments", "importJobs", "signalRouting",
]);

/** Unrelated AI/case edits must not trap users inside a connection dialog. */
export function isConnectionMutation(key: readonly unknown[] | undefined): boolean {
  const route = key?.[0];
  return Array.isArray(route) && typeof route[0] === "string" && connectionRoutes.has(route[0]);
}
