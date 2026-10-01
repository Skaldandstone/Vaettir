import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "@vaettir/db";
import {
  qualityProfileHash,
  testPlanExecutionTemplateSchema,
  runConfigurationSchema,
} from "./qualityExperienceProfile.js";

export { testPlanExecutionTemplateSchema };
export type TestPlanExecutionTemplate = z.infer<
  typeof testPlanExecutionTemplateSchema
>;

export const planReferenceSchema = z
  .object({
    testPlanId: z.string().min(1).max(200),
    expectedTemplateHash: z.string().regex(/^[a-f0-9]{64}$/),
    configurationId: z.string().uuid(),
  })
  .strict();

export function readPlanExecutionTemplate(
  value: unknown,
): TestPlanExecutionTemplate | null {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  )
    return null;
  const parsed = testPlanExecutionTemplateSchema.safeParse(value);
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This plan's saved execution template is unsupported or invalid. Review it before changing or running it.",
    });
  return parsed.data;
}

export const executionTemplateHash = qualityProfileHash;

/** Recheck live authorization, not the request's earlier membership snapshot. */
export async function requireCurrentPlanAccess(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  projectId: string,
  editor = false,
) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      organizationId: true,
      organization: { select: { suspendedAt: true } },
    },
  });
  if (!project)
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  const membership = await db.membership.findUnique({
    where: {
      organizationId_userId: { organizationId: project.organizationId, userId },
    },
  });
  if (
    project.organization.suspendedAt ||
    !membership ||
    (editor &&
      (membership.seatType !== "FULL" ||
        !["OWNER", "ADMIN", "EDITOR"].includes(membership.role)))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: editor
        ? "A current full editor seat is required."
        : "Current project access is required.",
    });
  }
}

export function reviewPlanExecution(
  plan: {
    id: string;
    projectId: string;
    name: string;
    status?: string;
    executionTemplate: unknown;
  },
  projectId: string,
  reference: z.infer<typeof planReferenceSchema>,
  caseIds: string[],
  configuration: z.infer<typeof runConfigurationSchema>,
) {
  if (plan.projectId !== projectId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This plan does not belong to the selected project.",
    });
  if (plan.status === "ARCHIVED")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Archived plans cannot start new runs. Previous run receipts remain available.",
    });
  const templateHash = executionTemplateHash(plan.executionTemplate);
  if (templateHash !== reference.expectedTemplateHash)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The plan configuration changed. Refresh and review before starting a new run.",
    });
  const template = readPlanExecutionTemplate(plan.executionTemplate);
  const preset = template?.configurations.find(
    (c) => c.id === reference.configurationId,
  );
  if (!template || !preset || !template.testCaseIds.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a saved plan configuration with at least one case.",
    });
  if (
    qualityProfileHash(caseIds) !== qualityProfileHash(template.testCaseIds) ||
    qualityProfileHash(configuration) !== qualityProfileHash(preset.context)
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The reviewed run scope or context does not match this saved plan configuration.",
    });
  }
  return {
    testPlanId: plan.id,
    name: plan.name,
    templateHash,
    configurationId: preset.id,
    template,
  };
}
