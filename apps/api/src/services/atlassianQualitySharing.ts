import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@vaettir/db";
import type { ForgeIdentity } from "./forgeInvocation.js";
import { forgeReleaseLink } from "./forgeReleaseSchema.js";
import { buildQualityVisualReport } from "@vaettir/core";

export const forgeQualityBinding = z
  .object({
    appId: z.string().regex(/^ari:cloud:ecosystem::app\/[a-f0-9-]{36}$/),
    installationId: z
      .string()
      .regex(/^ari:cloud:ecosystem::installation\/[a-f0-9-]{36}$/),
    environmentId: z
      .string()
      // Forge's canonical ARI includes both app and environment UUIDs. Keep
      // historical short records readable, but never equate them to a signed
      // canonical identity or silently move an existing approval.
      .regex(
        /^ari:cloud:ecosystem::environment\/(?:[a-f0-9-]{36}\/)?[a-f0-9-]{36}$/,
      ),
    cloudId: z.string().uuid(),
    siteOrigin: z.string().regex(/^https:\/\/[a-zA-Z0-9-]+\.atlassian\.net$/),
    product: z.enum(["jira", "confluence"]),
    targetId: z.string().regex(/^\d{1,40}$/),
  })
  .strict()
  .superRefine((binding, context) => {
    const parts = binding.environmentId
      .slice("ari:cloud:ecosystem::environment/".length)
      .split("/");
    if (
      parts.length === 2 &&
      binding.appId !== `ari:cloud:ecosystem::app/${parts[0]}`
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["environmentId"],
        message: "The environment must belong to the selected Forge app.",
      });
  });
export const forgeSharingRecord = z.object({
  connectionId: z.string().uuid(),
  version: z.number().int().positive(),
  state: z.enum(["APPROVED", "REVOKED"]),
  binding: forgeQualityBinding,
  snapshotIds: z.array(z.string().length(64)).max(50),
  shareTicketTests: z.boolean().default(false),
  shareApprovedProjectQuality: z.boolean().default(false),
  releaseLinks: z.array(forgeReleaseLink).max(50).default([]),
  closureSnapshotIds: z.array(z.string().length(64)).max(50).default([]),
});
export const forgeSharingEntityType = "ForgeQualitySharing";
export const forgeSharingKey = (connectionId: string) =>
  "forge-sharing-" + createHash("sha256").update(connectionId).digest("hex");
export function latestForgeSharing(rows: Array<{ metadata: unknown }>) {
  const versions = rows
    .map((r) => forgeSharingRecord.parse(r.metadata))
    .sort((a, b) => b.version - a.version);
  if (new Set(versions.map((v) => v.version)).size !== versions.length)
    throw new Error("Sharing revisions conflict");
  return versions[0] ?? null;
}
const count = z.number().int().nonnegative();
export const sharedQualitySnapshot = z.object({
  state: z.literal("approved"),
  title: z.string().max(1000),
  projectName: z.string().max(1000),
  asOf: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime().optional(),
  scope: z
    .object({
      kind: z.enum(["project", "recorded-execution"]),
      releaseName: z.string().optional(),
      cohortBasis: z.string(),
    })
    .optional(),
  execution: z.object({
    runs: count,
    results: count,
    outcomes: z.array(z.object({ key: z.string().max(100), count })).max(100),
    distinctCases: count,
    plannedCaseRunPairs: count.optional(),
    notRecordedCaseRunPairs: count.optional(),
    unmatchedResults: count.optional(),
  }),
  inventory: z.object({ active: count }),
  limitations: z.array(z.string()).max(100),
  evidence: z
    .object({
      runs: z
        .array(
          z.object({
            id: z.string(),
            startedAt: z.string(),
            provider: z.string(),
            outcomes: z.array(z.object({ key: z.string(), count })),
            plannedCases: count,
            notRecordedCases: count,
          }),
        )
        .max(20000),
    })
    .optional(),
});
// Only compiled visual rows leave this extra projection. Unselected sections,
// authored notes, case identities and architecture are never forwarded here.
const sharedVisualSource = sharedQualitySnapshot.extend({
  definition: z
    .object({
      sections: z.array(
        z.enum([
          "inventory",
          "execution",
          "traceability",
          "defects",
          "automation",
        ]),
      ),
    })
    .optional(),
  inventory: z.object({
    active: count,
    automation: z
      .array(z.object({ key: z.string().max(100), count }))
      .max(100)
      .optional(),
    priority: z
      .array(z.object({ key: z.string().max(100), count }))
      .max(100)
      .optional(),
  }),
  traceability: z
    .object({ requirements: count, coveredRequirements: count })
    .optional(),
});
export function sameForgeBinding(
  binding: z.infer<typeof forgeQualityBinding>,
  identity: ForgeIdentity,
) {
  return (Object.keys(binding) as Array<keyof typeof binding>).every(
    (key) => binding[key] === identity[key],
  );
}

/** Aggregate approved snapshots only. No case bodies, raw reports, screenshots,
 * videos, architecture sources or architecture mappings cross this boundary. */
export async function authorizeForgeSharing(
  tx: Prisma.TransactionClient,
  connectionKey: string,
  identity: ForgeIdentity,
) {
  const rows = await tx.auditLog.findMany({
    where: { entityType: forgeSharingEntityType, entityId: connectionKey },
    take: 501,
  });
  if (!rows.length || rows.length > 500) throw new Error("Sharing unavailable");
  const orgId = rows[0]!.organizationId,
    projectId = rows[0]!.projectId;
  if (
    !projectId ||
    rows.some((r) => r.organizationId !== orgId || r.projectId !== projectId)
  )
    throw new Error("Sharing scope conflict");
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${orgId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${projectId} FOR SHARE`;
  const org = await tx.organization.findUnique({
    where: { id: orgId },
    select: { suspendedAt: true },
  });
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });
  if (!org || org.suspendedAt || project?.organizationId !== orgId)
    throw new Error("Sharing unavailable");
  // Read again after acquiring the same parent lock used by revocation.
  const live = await tx.auditLog.findMany({
    where: {
      entityType: forgeSharingEntityType,
      entityId: connectionKey,
      organizationId: orgId,
      projectId,
    },
    take: 501,
  });
  if (live.length > 500) throw new Error("Sharing retention bound exceeded");
  const sharing = latestForgeSharing(live);
  if (
    !sharing ||
    sharing.state !== "APPROVED" ||
    !sameForgeBinding(sharing.binding, identity)
  )
    throw new Error("Sharing unavailable");
  return { sharing, orgId, projectId };
}
export async function readSharedQuality(
  tx: Prisma.TransactionClient,
  connectionKey: string,
  identity: ForgeIdentity,
  snapshotId?: string,
) {
  const { sharing, orgId, projectId } = await authorizeForgeSharing(
    tx,
    connectionKey,
    identity,
  );
  if (
    snapshotId &&
    !sharing.shareApprovedProjectQuality &&
    !sharing.snapshotIds.includes(snapshotId)
  )
    throw new Error("Snapshot not approved for this target");
  const snapshots = await tx.projectReportSnapshot.findMany({
    where: {
      projectId,
      organizationId: orgId,
      ...(sharing.shareApprovedProjectQuality
        ? {
            payload: { path: ["state"], equals: "approved" },
            ...(snapshotId ? { id: snapshotId } : {}),
          }
        : { id: { in: snapshotId ? [snapshotId] : sharing.snapshotIds } }),
    },
    orderBy: [{ asOf: "desc" }, { id: "desc" }],
    take: 50,
  });
  const available = snapshots.map((s) => ({
    id: s.id,
    ...sharedQualitySnapshot.parse(s.payload),
  }));
  if (snapshotId && !available.length)
    throw new Error("No approved shared snapshot available");
  if (!available.length && sharing.shareApprovedProjectQuality)
    return {
      protocol: "vaettir-quality-empty/v1" as const,
      projectId,
      reportUrl: `https://vaettir.skaldandstone.com/projects/${encodeURIComponent(projectId)}/reports`,
      notice:
        "Connected. This project has no approved quality captures yet. Create and approve a report in Vaettir; it will appear here without reconnecting.",
    };
  if (!available.length)
    throw new Error("No approved shared snapshot available");
  return {
    protocol: "vaettir-quality/v1" as const,
    mode: snapshotId ? ("FROZEN" as const) : ("LATEST_APPROVED" as const),
    projectId,
    snapshot: available[0]!,
    visuals: buildQualityVisualReport(
      sharedVisualSource.parse(snapshots[0]!.payload),
    ),
    available: available.map((s) => ({
      id: s.id,
      title: s.title,
      asOf: s.asOf,
    })),
    reportUrl: `https://vaettir.skaldandstone.com/projects/${encodeURIComponent(projectId)}/reports`,
    runLinks: (available[0]!.evidence?.runs ?? []).map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      href:
        run.provider === "manual"
          ? `https://vaettir.skaldandstone.com/projects/${encodeURIComponent(projectId)}/test-runs/manual/${encodeURIComponent(run.id)}`
          : `https://vaettir.skaldandstone.com/projects/${encodeURIComponent(projectId)}/test-runs#run-${encodeURIComponent(run.id)}`,
    })),
    notice:
      "Approved project/release summary, not issue-specific execution proof. Private evidence requires Vaettir access. Latest approved is not a real-time run feed.",
  };
}

export async function listForgeSharing(
  tx: Prisma.TransactionClient,
  identity: ForgeIdentity,
) {
  const {
    appId,
    installationId,
    environmentId,
    cloudId,
    siteOrigin,
    product,
    targetId,
  } = identity;
  const fields = {
    appId,
    installationId,
    environmentId,
    cloudId,
    siteOrigin,
    product,
    targetId,
  };
  const rows = await tx.auditLog.findMany({
    where: {
      entityType: forgeSharingEntityType,
      AND: Object.entries(fields).map(([key, value]) => ({
        metadata: { path: ["binding", key], equals: value },
      })),
    },
    take: 5001,
  });
  if (rows.length > 5000) throw new Error("Sharing catalog exceeds capacity");
  const groups = new Map<string, typeof rows>();
  for (const row of rows)
    groups.set(row.entityId, [...(groups.get(row.entityId) ?? []), row]);
  const connections: Array<{
    key: string;
    projectName: string;
    shareTicketTests: boolean;
    hasSnapshots: boolean;
    hasReleases: boolean;
    hasClosures: boolean;
  }> = [];
  for (const [key, versions] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (latestForgeSharing(versions)?.state !== "APPROVED") continue;
    const { projectId, sharing } = await authorizeForgeSharing(
      tx,
      key,
      identity,
    );
    if (
      identity.moduleKey === "vaettir-issue-quality"
        ? !sharing.shareTicketTests
        : !sharing.shareApprovedProjectQuality &&
          !sharing.snapshotIds.length &&
          !sharing.releaseLinks.length &&
          !sharing.closureSnapshotIds.length
    )
      continue;
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { name: true },
    });
    connections.push({
      key,
      projectName: project.name,
      shareTicketTests: sharing.shareTicketTests,
      hasSnapshots:
        sharing.shareApprovedProjectQuality || !!sharing.snapshotIds.length,
      hasReleases: !!sharing.releaseLinks.length,
      hasClosures: !!sharing.closureSnapshotIds.length,
    });
  }
  return { connections };
}
