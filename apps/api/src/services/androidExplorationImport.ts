import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import {
  androidExplorationCommit,
  androidExplorationReceipt,
  navigationProposal,
  navigationTechnicalAction,
} from "./androidExplorationSchema.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";
import type { z } from "zod";

export async function importAndroidExploration(
  db: PrismaClient,
  raw: z.infer<typeof androidExplorationCommit>,
  authority: { nativeActorId: string; clerkActorId: string },
) {
  const input = androidExplorationCommit.parse(raw);
  const denied = () =>
    new TRPCError({
      code: "FORBIDDEN",
      message:
        "The original project, full editor seat and authenticated account must still match. Nothing was added.",
    });
  if (input.expectedClerkActorId !== authority.clerkActorId) throw denied();
  for (const journey of input.journeys) {
    if (
      createHash("sha256")
        .update(JSON.stringify(journey.steps))
        .digest("hex") !== journey.id
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "The exact reviewed journey changed. Review it again before adding cases.",
      });
  }
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ input, actorId: authority.nativeActorId }))
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
      // Lock original org/member/project/actor through the entire write. The
      // project lock serializes source identities, retries and case numbering.
      const [org] = await tx.$queryRaw<
        Array<{ suspendedAt: Date | null }>
      >`SELECT "suspendedAt" FROM "Organization" WHERE id=${input.originalOrganizationId} FOR SHARE`;
      const [member] = await tx.$queryRaw<
        Array<{ role: string; seatType: string }>
      >`SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership" WHERE "organizationId"=${input.originalOrganizationId} AND "userId"=${authority.nativeActorId} FOR SHARE`;
      const [project] = await tx.$queryRaw<
        Array<{ organizationId: string }>
      >`SELECT "organizationId" FROM "Project" WHERE id=${input.projectId} FOR UPDATE`;
      const [actor] = await tx.$queryRaw<
        Array<{ clerkUserId: string }>
      >`SELECT "clerkUserId" FROM "User" WHERE id=${authority.nativeActorId} FOR SHARE`;
      if (
        !org ||
        org.suspendedAt !== null ||
        member?.seatType !== "FULL" ||
        !["OWNER", "ADMIN", "EDITOR"].includes(member.role) ||
        project?.organizationId !== input.originalOrganizationId ||
        actor?.clerkUserId !== authority.clerkActorId
      )
        throw denied();
      const prior = await tx.auditLog.findFirst({
        where: {
          organizationId: input.originalOrganizationId,
          projectId: input.projectId,
          actorId: authority.nativeActorId,
          entityType: "AndroidExplorationImport",
          entityId: input.requestId,
        },
        select: { metadata: true },
      });
      if (prior) {
        const saved = androidExplorationReceipt.safeParse(prior.metadata);
        if (!saved.success || saved.data.requestHash !== requestHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This request already records a different selection. Its original receipt was retained.",
          });
        return saved.data;
      }
      const cases: { journeyId: string; caseId: string }[] = [];
      for (const journey of input.journeys) {
        const sourceId = `android-exploration:${journey.sessionId}:${journey.id}`;
        const existing = await tx.testCase.findMany({
          where: {
            projectId: input.projectId,
            source: {
              framework: "android-exploration",
              externalTestId: sourceId,
            },
          },
          select: { id: true },
          take: 2,
        });
        if (existing.length > 1)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This journey has ambiguous retained cases. No existing content was changed.",
          });
        if (existing[0]) {
          cases.push({ journeyId: journey.id, caseId: existing[0].id });
          continue;
        }
        const proposal = navigationProposal(journey);
        const steps = journey.steps.map((step, order) => ({
          order,
          action: `${proposal.when[order]!} ${navigationTechnicalAction(step)}`,
          expectedActionOrData:
            "App backend requests were not captured. Connect app network inspection before defining API expectations; connector/ADB calls are recorded in the action, not as app backend evidence.",
          expectedResult: `Review destination: ${step.to.label}`,
          expectedResponse: null,
        }));
        const created = await tx.testCase.create({
          data: {
            projectId: input.projectId,
            title: proposal.title,
            background: null,
            given: proposal.given,
            when: proposal.when,
            then: proposal.then,
            tags: ["navigation-proposal", "android"],
            testType: "FUNCTIONAL",
            priority: "MEDIUM",
            automationStatus: "MANUAL",
            origin: "IMPORTED",
            reviewStatus: "PENDING_REVIEW",
            reviewNote: proposal.reviewNote,
            createdById: authority.nativeActorId,
            updatedById: authority.nativeActorId,
            source: {
              create: {
                filePath: journey.packageName,
                framework: "android-exploration",
                externalTestId: sourceId,
                importSnapshot: {
                  kind: "LOCAL_REPORTED_NAVIGATION",
                  journey,
                  proposal,
                  nativeExecutionIndependentlyVerified: false,
                },
              },
            },
            steps: { create: steps },
          },
        });
        await snapshotTestCaseVersion(tx as unknown as PrismaClient, {
          testCaseId: created.id,
          title: created.title,
          background: null,
          given: created.given,
          when: created.when,
          then: created.then,
          steps,
          tags: created.tags,
          priority: created.priority,
          testType: created.testType,
          actorId: authority.nativeActorId,
        });
        cases.push({ journeyId: journey.id, caseId: created.id });
      }
      const receipt = androidExplorationReceipt.parse({
        projectId: input.projectId,
        organizationId: input.originalOrganizationId,
        actorClerkId: authority.clerkActorId,
        requestId: input.requestId,
        requestHash,
        cases,
      });
      await tx.auditLog.create({
        data: {
          organizationId: input.originalOrganizationId,
          projectId: input.projectId,
          actorId: authority.nativeActorId,
          entityType: "AndroidExplorationImport",
          entityId: input.requestId,
          action: "CREATE",
          summary: `Added or recovered ${cases.length} reviewed navigation proposals`,
          metadata: receipt,
        },
      });
      return receipt;
    },
    { maxWait: 10000, timeout: 30000 },
  );
}
