import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { z } from "zod";
import { resolveStepFieldLabels } from "@vaettir/core";
import { requireProjectAccess, type Context } from "../trpc.js";
import {
  requireCurrentPlanAccess,
  reviewPlanExecution,
} from "./testPlanExecution.js";
import {
  boundedRunSnapshot,
  qualityProfileHash,
  readQualityExperience,
  readRunExperienceSnapshot,
  runConfigurationSchema,
} from "./qualityExperienceProfile.js";
import { verificationProfileSchema } from "./physicalValidation.js";
import {
  manualRunStartLegacyInputSchema,
  type ManualRunStartLegacyRawInput,
} from "./manualRunStartLegacySchema.js";
import { manualRunStartReviewedAuthenticatedSubject as identity } from "./manualRunStartReviewedWireSchema.js";

export type ManualRunStartContext = Context & {
  user: NonNullable<Context["user"]>;
};
const reviewedAuthorizationSchema = z
  .object({
    mode: z.enum(["REVIEWED_START", "LEGACY_RECOVERY"]),
    projectId: identity,
    originalOrganizationId: identity,
    expectedClerkActorId: identity,
    expectedNativeActorId: identity,
    authenticatedClerkSubject: identity,
  })
  .strict();
export type ManualRunStartReviewedAuthorization = z.infer<
  typeof reviewedAuthorizationSchema
>;
/** Unmounted extraction. Optional reviewed scope is independently supplied, never
 * merged into an accepted legacy request or used to impersonate ctx.user. Native
 * precision/new-writer envelope/caller/transport acceptance remain separate.
 * LEGACY_RECOVERY returns only the original ACK. An unpinned old request has
 * no recorded original-tenant/native-reader provenance; recovery must never be
 * presented as proof that the original creation used this reviewed scope. */
export async function startManualRun(
  ctx: ManualRunStartContext,
  raw: ManualRunStartLegacyRawInput,
  rawReviewed?: ManualRunStartReviewedAuthorization,
) {
  const input = manualRunStartLegacyInputSchema.parse(raw);
  const parsedReviewed =
    rawReviewed === undefined
      ? null
      : reviewedAuthorizationSchema.safeParse(rawReviewed);
  if (parsedReviewed && !parsedReviewed.success)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Independent original reviewed run-start authorization is required.",
    });
  const reviewed = parsedReviewed?.success ? parsedReviewed.data : undefined;

  if (!reviewed) {
    const { membership } = await requireProjectAccess(
      ctx,
      input.projectId,
      "EDITOR",
    );
    if (membership.seatType !== "FULL")
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "A full editor seat is required.",
      });
    await requireCurrentPlanAccess(
      ctx.prisma,
      ctx.user.id,
      input.projectId,
      true,
    );
  }
  if (new Set(input.testCaseIds).size !== input.testCaseIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose each test case only once.",
    });
  }
  const configuration = runConfigurationSchema.parse(
    input.executionContext ?? {},
  );
  const startRequestHash = qualityProfileHash({
    testCaseIds: input.planReference
      ? input.testCaseIds
      : [...input.testCaseIds].sort(),
    expectedProfileHash: input.expectedProfileHash ?? null,
    configuration,
    ...(input.planReference ? { planReference: input.planReference } : {}),
    ...(input.originalOrganizationId
      ? {
          originalOrganizationId: input.originalOrganizationId,
          expectedClerkActorId: input.expectedClerkActorId,
        }
      : {}),
  });
  function acknowledgeRun(testRunId: string) {
    return {
      testRunId,
      ...(input.originalOrganizationId
        ? {
            originalOrganizationId: input.originalOrganizationId,
            expectedClerkActorId: input.expectedClerkActorId,
            idempotencyKey: input.idempotencyKey,
          }
        : {}),
    };
  }
  if (
    input.planReference &&
    (!input.idempotencyKey ||
      !input.expectedProfileHash ||
      !input.executionContext)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Review project context and the saved plan configuration with a durable run-start key before starting.",
    });
  }
  const durableId = input.idempotencyKey
    ? `manual_${createHash("sha256")
        .update(
          JSON.stringify([input.projectId, ctx.user.id, input.idempotencyKey]),
        )
        .digest("hex")}`
    : undefined;
  async function lockCurrentStartAccess(tx: Prisma.TransactionClient) {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
    const found = await tx.project.findUnique({
      where: { id: input.projectId },
      select: { organizationId: true },
    });
    if (!found)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    // Same organization-first order as the manual read boundary. Do not
    // acquire the prerequisite advisory lock before tenant/actor locks.
    const [org] = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`
          SELECT "suspendedAt" FROM "Organization" WHERE id=${found.organizationId} FOR SHARE`;
    const [member] = await tx.$queryRaw<
      Array<{ role: string; seatType: string }>
    >`
          SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership"
          WHERE "organizationId"=${found.organizationId} AND "userId"=${ctx.user.id} FOR SHARE`;
    const [project] = await tx.$queryRaw<Array<{ organizationId: string }>>`
          SELECT "organizationId" FROM "Project" WHERE id=${input.projectId} FOR SHARE`;
    const [actor] = await tx.$queryRaw<Array<{ clerkUserId: string | null }>>`
          SELECT "clerkUserId" FROM "User" WHERE id=${ctx.user.id} FOR SHARE`;
    if (
      !org ||
      org.suspendedAt ||
      !member ||
      member.seatType !== "FULL" ||
      !["OWNER", "ADMIN", "EDITOR"].includes(member.role) ||
      project?.organizationId !== found.organizationId ||
      !actor?.clerkUserId ||
      actor.clerkUserId !==
        (reviewed?.authenticatedClerkSubject ?? ctx.user.clerkUserId) ||
      (reviewed !== undefined &&
        (reviewed.projectId !== input.projectId ||
          reviewed.originalOrganizationId !== found.organizationId ||
          reviewed.expectedNativeActorId !== ctx.user.id ||
          reviewed.expectedClerkActorId !== actor.clerkUserId)) ||
      (input.originalOrganizationId !== undefined &&
        input.originalOrganizationId !== found.organizationId) ||
      (input.expectedClerkActorId !== undefined &&
        input.expectedClerkActorId !== actor.clerkUserId)
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "A current signed-in full editor seat in this project is required.",
      });
    await requireCurrentPlanAccess(tx, ctx.user.id, input.projectId, true);
  }
  async function previousRunInTransaction(tx: Prisma.TransactionClient) {
    if (!durableId) return null;
    await tx.$queryRaw`SELECT id FROM "TestRun" WHERE id=${durableId} FOR SHARE`;
    const existing = await tx.testRun.findUnique({
      where: { id: durableId },
      select: {
        id: true,
        projectId: true,
        startedById: true,
        executionContext: true,
      },
    });
    if (!existing) return null;
    const frozen = readRunExperienceSnapshot(existing.executionContext);
    if (
      existing.projectId !== input.projectId ||
      existing.startedById !== ctx.user.id ||
      frozen?.startRequestHash !== startRequestHash
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This run-start key was used for a different request. Review the changed scope and start with a new key.",
      });
    }
    return acknowledgeRun(existing.id);
  }
  async function previousRun() {
    if (!durableId) return null;
    return ctx.prisma.$transaction(
      async (tx) => {
        await lockCurrentStartAccess(tx);
        return previousRunInTransaction(tx);
      },
      { timeout: 20000, isolationLevel: "RepeatableRead" },
    );
  }
  // A lost response must not produce another execution or replace the
  // original baseline with newer project/case data on retry.
  const previous = await previousRun();
  if (previous) return previous;
  if (reviewed?.mode === "LEGACY_RECOVERY")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "No accepted exact legacy run-start receipt is available. The retained request was not rewritten or submitted as a new run.",
    });
  try {
    return await ctx.prisma.$transaction(
      async (tx) => {
        await lockCurrentStartAccess(tx);
        // Serialize with prerequisite edits, then freeze the graph for this
        // run. Historical runs never change when a case's graph is edited.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.projectId}))::text`;
        const replay = await previousRunInTransaction(tx);
        if (replay) return replay;
        const project = await tx.project.findUnique({
          where: { id: input.projectId },
          select: {
            qualityProfile: true,
            organization: { select: { stepFieldLabels: true } },
          },
        });
        if (!project)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        const experience = readQualityExperience(project.qualityProfile);
        if (
          input.expectedProfileHash !== undefined &&
          input.expectedProfileHash !== experience.profileHash
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Project context changed. Refresh and review the run configuration before starting.",
          });
        }
        const plan = input.planReference
          ? await tx.testPlan.findUnique({
              where: { id: input.planReference.testPlanId },
            })
          : null;
        if (input.planReference && !plan)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Test plan not found",
          });
        const planSnapshot =
          input.planReference && plan
            ? reviewPlanExecution(
                plan,
                input.projectId,
                input.planReference,
                input.testCaseIds,
                configuration,
              )
            : undefined;
        const links = await tx.testCasePrerequisite.findMany({
          where: { projectId: input.projectId },
          select: { dependentId: true, prerequisiteId: true },
          take: 10001,
        });
        if (links.length > 10000)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Project has too many prerequisite links to start safely.",
          });
        const graph = new Map<string, string[]>();
        for (const link of links)
          graph.set(link.dependentId, [
            ...(graph.get(link.dependentId) ?? []),
            link.prerequisiteId,
          ]);
        const ordered: string[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();
        for (const rootId of input.testCaseIds) {
          if (visited.has(rootId)) continue;
          const stack = [{ id: rootId, nextIndex: 0 }];
          while (stack.length) {
            const frame = stack[stack.length - 1]!;
            visiting.add(frame.id);
            const next = (graph.get(frame.id) ?? [])[frame.nextIndex++];
            if (next) {
              if (visiting.has(next))
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "Test case prerequisites contain a cycle.",
                });
              if (!visited.has(next)) stack.push({ id: next, nextIndex: 0 });
              if (visited.size + stack.length > 1000)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message:
                    "Run would include more than 1,000 cases with prerequisites. Split the reviewed scope into separate runs.",
                });
              continue;
            }
            stack.pop();
            visiting.delete(frame.id);
            visited.add(frame.id);
            ordered.push(frame.id);
            if (ordered.length > 1000)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "Run would include more than 1,000 cases with prerequisites. Split the reviewed scope into separate runs.",
              });
          }
        }
        const cases = await tx.testCase.findMany({
          where: {
            id: { in: ordered },
            projectId: input.projectId,
            archived: false,
          },
          include: {
            steps: { orderBy: { order: "asc" } },
            sharedStepGroup: true,
            dataset: { select: { id: true } },
          },
        });
        if (cases.length !== ordered.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "A selected case or prerequisite is missing, archived, or outside this project.",
          });
        }
        if (cases.some((c) => c.reviewStatus !== "APPROVED"))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "A selected case or prerequisite has not been approved. Review and approve the complete dependency scope before starting; nothing was started.",
          });
        if (cases.some((c) => c.dataset))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "A selected case or prerequisite has a dataset. Use Run dataset rows to review concrete procedures and create independently recorded row runs; nothing was started.",
          });
        const snapshot = Object.fromEntries(
          ordered.map((id) => [id, graph.get(id) ?? []]),
        );
        const casesById = new Map(cases.map((c) => [c.id, c]));
        const executionContext = boundedRunSnapshot({
          version: 1,
          ...experience,
          startRequestHash,
          configuration,
          ...(planSnapshot ? { plan: planSnapshot } : {}),
          stepFieldLabels: resolveStepFieldLabels(
            (project.organization.stepFieldLabels ?? {}) as never,
          ),
          caseDefinitions: ordered.map((id) => {
            const c = casesById.get(id)!;
            const verification = verificationProfileSchema.safeParse(
              c.verificationProfile,
            );
            if (!verification.success)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "A selected case has invalid procedure metadata. Review the case before starting a run; nothing was started.",
              });
            return {
              testCaseId: c.id,
              title: c.title,
              validationDomain: c.validationDomain,
              reviewStatus: c.reviewStatus,
              background: c.background,
              given: c.given,
              when: c.when,
              then: c.then,
              verificationProfile: verification.data,
              steps: c.sharedStepGroup
                ? c.sharedStepGroup.steps
                : c.steps.map((s) => ({
                    order: s.order,
                    action: s.action,
                    expectedActionOrData: s.expectedActionOrData,
                    expectedResult: s.expectedResult,
                    expectedResponse: s.expectedResponse,
                    mediaAttachmentIds: s.mediaAttachmentIds,
                  })),
            };
          }),
        });
        const run = await tx.testRun.create({
          data: {
            id: durableId,
            projectId: input.projectId,
            ciProvider: "manual",
            commitSha: "manual",
            branch: "manual",
            startedAt: new Date(),
            status: "RUNNING",
            manualTestCaseIds: ordered,
            manualPrerequisites: snapshot,
            executionContext,
            startedById: ctx.user.id,
          },
          select: { id: true },
        });
        return acknowledgeRun(run.id);
      },
      { timeout: 20000, isolationLevel: "RepeatableRead" },
    );
  } catch (error) {
    if (
      durableId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const recovered = await previousRun();
      if (recovered) return recovered;
    }
    throw error;
  }
}
