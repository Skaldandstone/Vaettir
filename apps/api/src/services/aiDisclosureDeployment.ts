import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const scopes = z
  .array(z.object({ organizationId: id, projectId: id }).strict())
  .min(1)
  .max(20);

// Operator rollout scope is independent of customer approval. Missing, malformed,
// duplicate or wildcard scope denies the whole pilot; there is no global fallback.
export function aiDisclosureDeployment(env: NodeJS.ProcessEnv = process.env) {
  let allowed: z.infer<typeof scopes> = [];
  if (env.VAETTIR_AI_DISCLOSURE_ENABLED === "1") {
    try {
      const parsed = scopes.parse(
        JSON.parse(env.VAETTIR_AI_DISCLOSURE_PROJECTS ?? ""),
      );
      const keys = new Set(
        parsed.map((s) => `${s.organizationId}:${s.projectId}`),
      );
      if (keys.size === parsed.length) allowed = parsed;
    } catch {
      /* Invalid deployment configuration must never broaden access. */
    }
  }
  return (organizationId: string, projectId: string) =>
    allowed.some(
      (scope) =>
        scope.organizationId === organizationId &&
        scope.projectId === projectId,
    );
}
