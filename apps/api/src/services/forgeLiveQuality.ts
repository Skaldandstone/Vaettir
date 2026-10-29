import { z } from "zod";
import { type Prisma } from "@vaettir/db";
import { buildQualityVisualReport } from "@vaettir/core";
import {
  authorizeForgeSharing,
  forgeWorkspaceOrigin,
} from "./atlassianQualitySharing.js";
import type { ForgeIdentity } from "./forgeInvocation.js";

const count = z.number().int().nonnegative();
const buckets = z.array(z.object({ key: z.string(), count }));
const liveSchema = z.object({
  projectName: z.string(),
  asOf: z.string(),
  active: count,
  runs: count,
  results: count,
  distinctCases: count,
  outcomes: buckets,
  priority: buckets,
  automation: buckets,
});
/** Existing FIT/viewer/target authorization, plus a new explicit live grant.
 * One SQL statement supplies a consistent aggregate snapshot, never raw cases. */
export async function readForgeLiveQuality(
  tx: Prisma.TransactionClient,
  connectionKey: string,
  identity: ForgeIdentity,
) {
  const { sharing, orgId, projectId } = await authorizeForgeSharing(
    tx,
    connectionKey,
    identity,
  );
  if (
    identity.product !== "confluence" ||
    identity.moduleKey !== "vaettir-release-quality" ||
    !sharing.shareLiveProjectQuality
  )
    throw new Error("Live sharing is not approved for this target");
  await tx.$executeRaw`SET LOCAL statement_timeout='8000ms'`;
  const rows = await tx.$queryRaw<Array<{ payload: unknown }>>`
    WITH cases AS (SELECT id,priority,"automationStatus" FROM "TestCase" WHERE "projectId"=${projectId} AND archived=false),
    runs AS (SELECT id FROM "TestRun" WHERE "projectId"=${projectId} AND "startedAt">=statement_timestamp()-interval '30 days' AND "startedAt"<=statement_timestamp()),
    results AS (SELECT r.status,r."testCaseId" FROM "TestResult" r JOIN runs ON runs.id=r."testRunId")
    SELECT jsonb_build_object(
      'projectName',p.name,'asOf',statement_timestamp(),
      'active',(SELECT count(*) FROM cases),'runs',(SELECT count(*) FROM runs),
      'results',(SELECT count(*) FROM results),
      'distinctCases',(SELECT count(DISTINCT r."testCaseId") FROM results r JOIN cases c ON c.id=r."testCaseId" WHERE r.status IN ('PASS','FAIL','FLAKY')),
      'outcomes',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',key,'count',total) ORDER BY key) FROM (SELECT status::text key,count(*) total FROM results GROUP BY status) b),'[]'::jsonb),
      'priority',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',key,'count',total) ORDER BY key) FROM (SELECT priority::text key,count(*) total FROM cases GROUP BY priority) b),'[]'::jsonb),
      'automation',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',key,'count',total) ORDER BY key) FROM (SELECT "automationStatus"::text key,count(*) total FROM cases GROUP BY "automationStatus") b),'[]'::jsonb)
    ) payload FROM "Project" p WHERE p.id=${projectId} AND p."organizationId"=${orgId}`;
  const data = liveSchema.parse(rows[0]?.payload);
  const origin = await forgeWorkspaceOrigin(tx, orgId);
  const execution = {
    runs: data.runs,
    results: data.results,
    outcomes: data.outcomes,
    distinctCases: data.distinctCases,
  };
  return {
    protocol: "vaettir-quality-live/v1" as const,
    mode: "LIVE" as const,
    projectId,
    available: [],
    runLinks: [],
    snapshot: {
      id: "live",
      title: "Live quality dashboard",
      projectName: data.projectName,
      asOf: data.asOf,
      execution,
      limitations: [
        "Rolling 30-day run window; inventory reflects current active cases. Repeated observations count separately.",
        "No result is not a pass. This view is not an approved historical report.",
      ],
    },
    visuals: buildQualityVisualReport({
      definition: { sections: ["inventory", "execution", "automation"] },
      inventory: {
        active: data.active,
        priority: data.priority,
        automation: data.automation,
      },
      execution,
    }),
    reportUrl: `${origin}/projects/${encodeURIComponent(projectId)}/reports`,
    notice:
      "Live aggregates refreshed on request. Every refresh checks current Confluence access and Vaettir sharing. No case content, identities, notes or attachments are exposed.",
  };
}
