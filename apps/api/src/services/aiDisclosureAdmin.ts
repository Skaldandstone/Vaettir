import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { z } from "@vaettir/core/dist/validation.js";
import type { Context } from "../trpc.js";
import { AI_READ_POLICY_VERSION } from "./aiDisclosureGateway.js";
import { aiDisclosureDeployment } from "./aiDisclosureDeployment.js";

export const aiClassification = z.enum([
  "UNCLASSIFIED",
  "SYNTHETIC",
  "CUSTOMER_PROPRIETARY",
  "REGULATED",
]);
export const aiAdminScope = z
  .object({
    organizationId: z.string().min(1).max(100),
    projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  })
  .strict();
const command = aiAdminScope.extend({ requestId: z.string().uuid() });
export const aiClassificationInput = command
  .extend({
    expectedVersion: z.number().int().nonnegative(),
    classification: aiClassification,
    attestSynthetic: z.boolean().default(false),
  })
  .strict();
export const aiIssueInput = command
  .extend({
    expectedPolicyVersion: z.number().int().positive(),
    recipient: z.literal("codex"),
    scope: z.literal("aggregate_counts"),
    lifetimeDays: z.number().int().min(1).max(30),
    approveDisclosure: z.literal(true),
  })
  .strict();
export const aiGrantChangeInput = command
  .extend({
    grantId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const aiRotateInput = aiGrantChangeInput
  .extend({
    expectedPolicyVersion: z.number().int().positive(),
    lifetimeDays: z.number().int().min(1).max(30),
    approveDisclosure: z.literal(true),
  })
  .strict();

type Actor = Pick<
  Context,
  "prisma" | "user" | "authenticatedClerkSubject" | "workspaceOrganizationId"
>;
type Scope = z.infer<typeof aiAdminScope>;
export type AiCommandReceipt = {
  operation: "CLASSIFY" | "ISSUE" | "ROTATE" | "REVOKE";
  policyVersion: number;
  grantId: string | null;
  grantVersion: number | null;
};
export type AiCommandResult = AiCommandReceipt & {
  token: string | null;
  replayed: boolean;
};
const receiptSchema = z
  .object({
    operation: z.enum(["CLASSIFY", "ISSUE", "ROTATE", "REVOKE"]),
    policyVersion: z.number().int(),
    grantId: z.string().nullable(),
    grantVersion: z.number().int().nullable(),
  })
  .strict();
export const aiTransactionOptions = {
  timeout: 10_000,
  maxWait: 5_000,
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
};

// Order shared with disclosure reads: organization -> user -> membership ->
// project -> policy -> grant. Holding rows prevents role/identity/tenant changes
// from racing a write. Never trust the caller's membership snapshot.
export async function lockAiAdmin(
  tx: Prisma.TransactionClient,
  actor: Actor,
  scope: Scope,
) {
  if (
    actor.workspaceOrganizationId &&
    actor.workspaceOrganizationId !== scope.organizationId
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  if (!actor.user || !actor.authenticatedClerkSubject)
    throw new TRPCError({ code: "UNAUTHORIZED" });
  const org = await tx.$queryRaw<
    Array<{ suspendedAt: Date | null }>
  >`SELECT "suspendedAt" FROM "Organization" WHERE id=${scope.organizationId} FOR UPDATE`;
  const user = await tx.$queryRaw<
    Array<{ clerkUserId: string }>
  >`SELECT "clerkUserId" FROM "User" WHERE id=${actor.user.id} FOR SHARE`;
  const member = await tx.$queryRaw<
    Array<{ role: string; seatType: string }>
  >`SELECT role,"seatType" FROM "Membership" WHERE "organizationId"=${scope.organizationId} AND "userId"=${actor.user.id} FOR UPDATE`;
  const project = await tx.$queryRaw<
    Array<{ organizationId: string }>
  >`SELECT "organizationId" FROM "Project" WHERE id=${scope.projectId} FOR UPDATE`;
  if (
    !org[0] ||
    org[0].suspendedAt ||
    user[0]?.clerkUserId !== actor.authenticatedClerkSubject ||
    !member[0] ||
    member[0].seatType !== "FULL" ||
    !["OWNER", "ADMIN"].includes(member[0].role) ||
    project[0]?.organizationId !== scope.organizationId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Current signed-in workspace administrator access is required.",
    });
  return { id: actor.user.id, subject: actor.authenticatedClerkSubject };
}

async function policy(tx: Prisma.TransactionClient, scope: Scope) {
  await tx.$queryRaw`SELECT "projectId" FROM "AiDisclosurePolicy" WHERE "projectId"=${scope.projectId} AND "organizationId"=${scope.organizationId} FOR UPDATE`;
  return tx.aiDisclosurePolicy.findUnique({
    where: { projectId: scope.projectId },
  });
}
export async function auditAiAdmin(
  tx: Prisma.TransactionClient,
  scope: Scope,
  actorId: string,
  event: string,
  version: number,
  grantId: string | null = null,
) {
  await tx.aiDisclosureAudit.create({
    data: {
      ...scope,
      actorId,
      event,
      reason: "CUSTOMER_ADMIN_ACTION",
      policyVersion: AI_READ_POLICY_VERSION,
      classificationVersion: version,
      grantId,
    },
  });
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function replay(
  tx: Prisma.TransactionClient,
  actorId: string,
  scope: Scope,
  input: { requestId: string },
  operation: AiCommandReceipt["operation"],
) {
  const id = hash([
    scope.organizationId,
    scope.projectId,
    actorId,
    input.requestId,
  ]);
  const requestHash = hash([operation, input]);
  const prior = await tx.aiDisclosureCommand.findUnique({ where: { id } });
  if (prior) {
    if (prior.requestHash !== requestHash)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This request was already used for a different action.",
      });
    return {
      id,
      requestHash,
      prior: {
        ...receiptSchema.parse(prior.receipt),
        token: null,
        replayed: true,
      } as AiCommandResult,
    };
  }
  return { id, requestHash, prior: null };
}
async function receipt(
  tx: Prisma.TransactionClient,
  scope: Scope,
  command: { id: string; requestHash: string },
  value: AiCommandReceipt,
) {
  await tx.aiDisclosureCommand.create({
    data: {
      ...scope,
      id: command.id,
      requestHash: command.requestHash,
      receipt: value,
    },
  });
}
function credential() {
  const token = "vai_" + randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    keyHint: token.slice(0, 12),
  };
}
function mustBeSynthetic(
  row: { version: number; classification: string } | null,
  version: number,
) {
  if (!row || row.version !== version || row.classification !== "SYNTHETIC")
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Review the current synthetic-project classification before approving access.",
    });
}

export async function readAiSettings(actor: Actor, input: Scope) {
  const scope = aiAdminScope.parse(input);
  return actor.prisma.$transaction(async (tx) => {
    const admin = await lockAiAdmin(tx, actor, scope);
    const row = await policy(tx, scope);
    const grants = await tx.aiDisclosureGrant.findMany({
      where: scope,
      // Keep all live grants visible ahead of bounded historical entries.
      orderBy: [
        { enabled: "desc" },
        { revokedAt: { sort: "asc", nulls: "first" } },
        { expiresAt: "desc" },
        { createdAt: "desc" },
      ],
      take: 101,
      select: {
        id: true,
        recipient: true,
        scope: true,
        keyHint: true,
        version: true,
        classificationVersion: true,
        approvedByUserId: true,
        enabled: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    const audit = await tx.aiDisclosureAudit.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        event: true,
        reason: true,
        grantId: true,
        createdAt: true,
      },
    });
    return {
      observedAt: new Date().toISOString(),
      ...scope,
      actorClerkUserId: admin.subject,
      classification: aiClassification.parse(
        row?.classification ?? "UNCLASSIFIED",
      ),
      version: row?.version ?? 0,
      enabled: aiDisclosureDeployment()(scope.organizationId, scope.projectId),
      grants: grants.slice(0, 100),
      grantLimitReached:
        grants.filter(
          (grant) =>
            grant.enabled && !grant.revokedAt && grant.expiresAt > new Date(),
        ).length >= 20,
      historyLimited: grants.length > 100,
      audit,
    };
  }, aiTransactionOptions);
}

export async function classifyAiProject(
  actor: Actor,
  value: z.infer<typeof aiClassificationInput>,
): Promise<AiCommandResult> {
  const input = aiClassificationInput.parse(value),
    scope = aiAdminScope.parse({
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
  if (input.classification === "SYNTHETIC" && !input.attestSynthetic)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Confirm this project contains only synthetic data.",
    });
  return actor.prisma.$transaction(async (tx) => {
    const admin = await lockAiAdmin(tx, actor, scope),
      command = await replay(tx, admin.id, scope, input, "CLASSIFY");
    if (command.prior) return command.prior;
    const prior = await policy(tx, scope);
    if ((prior?.version ?? 0) !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Classification changed. Review it again.",
      });
    const row = await tx.aiDisclosurePolicy.upsert({
      where: { projectId: scope.projectId },
      create: {
        ...scope,
        classification: input.classification,
        updatedByUserId: admin.id,
      },
      update: {
        classification: input.classification,
        version: { increment: 1 },
        updatedByUserId: admin.id,
      },
    });
    // Even saving the same classification invalidates every old approval.
    await tx.aiDisclosureGrant.updateMany({
      where: { ...scope, revokedAt: null },
      data: {
        revokedAt: new Date(),
        enabled: false,
        version: { increment: 1 },
      },
    });
    await auditAiAdmin(
      tx,
      scope,
      admin.id,
      "CLASSIFICATION_UPDATED",
      row.version,
    );
    const result: AiCommandReceipt = {
      operation: "CLASSIFY",
      policyVersion: row.version,
      grantId: null,
      grantVersion: null,
    };
    await receipt(tx, scope, command, result);
    return { ...result, token: null, replayed: false };
  }, aiTransactionOptions);
}

export async function issueAiGrant(
  actor: Actor,
  value: z.infer<typeof aiIssueInput>,
): Promise<AiCommandResult> {
  const input = aiIssueInput.parse(value),
    scope = aiAdminScope.parse({
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
  return actor.prisma.$transaction(async (tx) => {
    const admin = await lockAiAdmin(tx, actor, scope),
      command = await replay(tx, admin.id, scope, input, "ISSUE");
    if (command.prior) return command.prior;
    const row = await policy(tx, scope);
    mustBeSynthetic(row, input.expectedPolicyVersion);
    const now = new Date();
    const active = await tx.aiDisclosureGrant.count({
      where: {
        ...scope,
        revokedAt: null,
        enabled: true,
        expiresAt: { gt: now },
      },
    });
    if (active >= 20)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Revoke unused project connections before adding another.",
      });
    const { token, ...key } = credential();
    const grant = await tx.aiDisclosureGrant.create({
      data: {
        ...scope,
        ...key,
        classificationVersion: row!.version,
        approvedByUserId: admin.id,
        approvedClerkSubject: admin.subject,
        recipient: input.recipient,
        scope: input.scope,
        expiresAt: new Date(now.getTime() + input.lifetimeDays * 86400000),
      },
    });
    await auditAiAdmin(
      tx,
      scope,
      admin.id,
      "GRANT_ISSUED",
      row!.version,
      grant.id,
    );
    const result: AiCommandReceipt = {
      operation: "ISSUE",
      policyVersion: row!.version,
      grantId: grant.id,
      grantVersion: grant.version,
    };
    await receipt(tx, scope, command, result);
    return { ...result, token, replayed: false };
  }, aiTransactionOptions);
}

export async function changeAiGrant(
  actor: Actor,
  value: z.infer<typeof aiGrantChangeInput> | z.infer<typeof aiRotateInput>,
  rotate: boolean,
): Promise<AiCommandResult> {
  const input = rotate
      ? aiRotateInput.parse(value)
      : aiGrantChangeInput.parse(value),
    scope = aiAdminScope.parse({
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
  return actor.prisma.$transaction(async (tx) => {
    const admin = await lockAiAdmin(tx, actor, scope),
      command = await replay(
        tx,
        admin.id,
        scope,
        input,
        rotate ? "ROTATE" : "REVOKE",
      );
    if (command.prior) return command.prior;
    const row = await policy(tx, scope);
    await tx.$queryRaw`SELECT id FROM "AiDisclosureGrant" WHERE id=${input.grantId} AND "projectId"=${scope.projectId} AND "organizationId"=${scope.organizationId} FOR UPDATE`;
    const grant = await tx.aiDisclosureGrant.findFirst({
      where: { ...scope, id: input.grantId },
    });
    if (!grant || grant.version !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Connection changed. Review its current state.",
      });
    const now = new Date();
    let token: string | null = null;
    if (rotate) {
      const approved = aiRotateInput.parse(input);
      mustBeSynthetic(row, approved.expectedPolicyVersion);
      if (
        !grant.enabled ||
        grant.revokedAt ||
        grant.classificationVersion !== row!.version
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "Create a new approval for this connection.",
        });
      const fresh = credential();
      token = fresh.token;
      await tx.aiDisclosureGrant.update({
        where: { id: grant.id },
        data: {
          tokenHash: fresh.tokenHash,
          keyHint: fresh.keyHint,
          approvedByUserId: admin.id,
          approvedClerkSubject: admin.subject,
          expiresAt: new Date(now.getTime() + approved.lifetimeDays * 86400000),
          version: { increment: 1 },
          readWindowCount: 0,
          readWindowStartedAt: null,
        },
      });
    } else {
      await tx.aiDisclosureGrant.update({
        where: { id: grant.id },
        data: {
          revokedAt: grant.revokedAt ?? now,
          enabled: false,
          version: { increment: 1 },
        },
      });
    }
    await auditAiAdmin(
      tx,
      scope,
      admin.id,
      rotate ? "GRANT_ROTATED" : "GRANT_REVOKED",
      row!.version,
      grant.id,
    );
    const result: AiCommandReceipt = {
      operation: rotate ? "ROTATE" : "REVOKE",
      policyVersion: row!.version,
      grantId: grant.id,
      grantVersion: grant.version + 1,
    };
    await receipt(tx, scope, command, result);
    return { ...result, token, replayed: false };
  }, aiTransactionOptions);
}
