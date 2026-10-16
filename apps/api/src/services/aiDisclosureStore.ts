import { Prisma, type PrismaClient } from "@vaettir/db";
import type {
  AiReadGrant,
  AiReadStore,
  AiReadTransaction,
} from "./aiDisclosureGateway.js";
import { aiTransactionOptions } from "./aiDisclosureAdmin.js";

// Persistent policy store: no general API user or session is created for a
// connection. The grant itself is a dedicated VIEWER-only principal.
export function createAiDisclosureStore(prisma: PrismaClient): AiReadStore {
  return {
    transaction: (work) =>
      prisma.$transaction(
        async (tx) => {
          let current: {
            grant: AiReadGrant;
            actorId: string;
            classificationVersion: number;
          } | null = null;
          const api: AiReadTransaction = {
            async resolveGrant(tokenHash) {
              const hint = await tx.aiDisclosureGrant.findUnique({
                where: { tokenHash },
                select: {
                  id: true,
                  organizationId: true,
                  projectId: true,
                  approvedByUserId: true,
                },
              });
              if (!hint) return null;
              // Admin writes take the organization exclusively; reads share it and
              // lock the dedicated grant exclusively for the persistent rate window.
              const org = await tx.$queryRaw<
                Array<{ suspendedAt: Date | null }>
              >`SELECT "suspendedAt" FROM "Organization" WHERE id=${hint.organizationId} FOR SHARE`;
              const users = await tx.$queryRaw<
                Array<{ clerkUserId: string }>
              >`SELECT "clerkUserId" FROM "User" WHERE id=${hint.approvedByUserId} FOR SHARE`;
              const members = await tx.$queryRaw<
                Array<{ role: string; seatType: string }>
              >`SELECT role,"seatType" FROM "Membership" WHERE "organizationId"=${hint.organizationId} AND "userId"=${hint.approvedByUserId} FOR SHARE`;
              const projects = await tx.$queryRaw<
                Array<{ organizationId: string }>
              >`SELECT "organizationId" FROM "Project" WHERE id=${hint.projectId} FOR SHARE`;
              await tx.$queryRaw`SELECT "projectId" FROM "AiDisclosurePolicy" WHERE "projectId"=${hint.projectId} AND "organizationId"=${hint.organizationId} FOR SHARE`;
              await tx.$queryRaw`SELECT id FROM "AiDisclosureGrant" WHERE id=${hint.id} FOR UPDATE`;
              const grant = await tx.aiDisclosureGrant.findUnique({
                where: { id: hint.id },
                include: { policy: true },
              });
              // A rotated credential may have matched the initial lookup before its
              // owner obtained the organization lock. Recheck every immutable binding.
              if (
                !grant ||
                grant.tokenHash !== tokenHash ||
                grant.organizationId !== hint.organizationId ||
                grant.projectId !== hint.projectId ||
                grant.approvedByUserId !== hint.approvedByUserId
              )
                return null;
              const now = new Date();
              const windowStart = grant.readWindowStartedAt;
              const sameWindow =
                windowStart !== null &&
                now.getTime() - windowStart.getTime() < 60_000;
              const throttled = sameWindow && grant.readWindowCount >= 30;
              await tx.aiDisclosureGrant.update({
                where: { id: grant.id },
                data: {
                  readWindowStartedAt: sameWindow ? windowStart : now,
                  readWindowCount: throttled
                    ? grant.readWindowCount
                    : sameWindow
                      ? grant.readWindowCount + 1
                      : 1,
                },
              });
              const projected: AiReadGrant = {
                id: grant.id,
                organizationId: grant.organizationId,
                projectId: grant.projectId,
                principalId: grant.id,
                recipient: grant.recipient as "codex",
                scope: grant.scope as "aggregate_counts",
                policyVersion: grant.policyVersion,
                classificationVersion: grant.classificationVersion,
                expiresAt: grant.expiresAt,
                revoked: grant.revokedAt !== null,
                enabled: grant.enabled && !throttled,
                organizationActive: !!org[0] && !org[0].suspendedAt,
                principalActive: grant.enabled && grant.revokedAt === null,
                currentRole: grant.role,
                projectOrganizationId: projects[0]?.organizationId ?? "",
                projectClassification: grant.policy
                  .classification as AiReadGrant["projectClassification"],
                projectClassificationVersion: grant.policy.version,
                approvingAdminActive:
                  users[0]?.clerkUserId === grant.approvedClerkSubject &&
                  members[0]?.seatType === "FULL" &&
                  ["OWNER", "ADMIN"].includes(members[0]?.role ?? ""),
              };
              current = {
                grant: projected,
                actorId: grant.approvedByUserId,
                classificationVersion: grant.policy.version,
              };
              return projected;
            },
            async countProject(organizationId, projectId) {
              if (
                !current ||
                current.grant.organizationId !== organizationId ||
                current.grant.projectId !== projectId
              )
                throw new Error("AI count scope mismatch");
              const rows = await tx.$queryRaw<
                Array<{
                  testCases: bigint;
                  testPlans: bigint;
                  testRuns: bigint;
                }>
              >`
          SELECT
            (SELECT COUNT(*) FROM "TestCase" c JOIN "Project" p ON p.id=c."projectId" WHERE p.id=${projectId} AND p."organizationId"=${organizationId} AND c.archived=false) AS "testCases",
            (SELECT COUNT(*) FROM "TestPlan" t JOIN "Project" p ON p.id=t."projectId" WHERE p.id=${projectId} AND p."organizationId"=${organizationId}) AS "testPlans",
            (SELECT COUNT(*) FROM "TestRun" r JOIN "Project" p ON p.id=r."projectId" WHERE p.id=${projectId} AND p."organizationId"=${organizationId}) AS "testRuns"`;
              const totals = rows[0];
              if (!totals) throw new Error("AI counts unavailable");
              return {
                testCases: Number(totals.testCases),
                testPlans: Number(totals.testPlans),
                testRuns: Number(totals.testRuns),
              };
            },
            async audit(event) {
              if (!current || current.grant.id !== event.grantId)
                throw new Error("AI audit scope mismatch");
              await tx.aiDisclosureAudit.create({
                data: {
                  organizationId: event.organizationId,
                  projectId: event.projectId,
                  grantId: event.grantId,
                  actorId: current.actorId,
                  event: event.decision,
                  reason: event.reason,
                  policyVersion: event.policyVersion,
                  classificationVersion: current.classificationVersion,
                },
              });
              if (event.decision !== "DENY")
                await tx.aiDisclosureGrant.update({
                  where: { id: event.grantId },
                  data: { lastUsedAt: new Date() },
                });
            },
          };
          // Commit (including the denial audit) before the result reaches the route.
          return work(api);
        },
        {
          ...aiTransactionOptions,
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      ),
  };
}
