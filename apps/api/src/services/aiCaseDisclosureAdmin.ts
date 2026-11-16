import { TRPCError } from "@trpc/server";
import { z } from "@vaettir/core/dist/validation.js";
import type { Context } from "../trpc.js";
import { AI_CASE_SCOPE, aiCaseClassificationAllowed, aiCaseSelection, aiCaseDigest, projectAiCases } from "./aiCaseDisclosure.js";
import { aiAdminScope, aiTransactionOptions, lockAiAdmin, lockAiPolicy, auditAiAdmin, replayAiCommand, saveAiCommandReceipt, createAiCredential, type AiCommandResult } from "./aiDisclosureAdmin.js";
import { aiDisclosureDeployment } from "./aiDisclosureDeployment.js";

export const aiCasePreviewInput = aiCaseSelection.safeExtend({ expectedPolicyVersion: z.number().int().positive() });
export const aiCaseIssueInput = aiCasePreviewInput.safeExtend({
  requestId: z.string().uuid(),
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  lifetimeDays: z.number().int().min(1).max(7),
  approveDisclosure: z.literal(true),
  attestNoRegulatedData: z.literal(true),
});
export const aiCasePickerInput = aiAdminScope.extend({ search: z.string().max(80).default("") }).strict();
type Actor = Pick<Context, "prisma" | "user" | "authenticatedClerkSubject" | "workspaceOrganizationId">;
type Tx = Parameters<typeof lockAiAdmin>[0];

export async function listAiCaseChoices(actor: Actor, value: z.infer<typeof aiCasePickerInput>) {
  const input = aiCasePickerInput.parse(value);
  return actor.prisma.$transaction(async tx => {
    const admin = await lockAiAdmin(tx, actor, input);
    const cases = await tx.testCase.findMany({
      where: { projectId: input.projectId, project: { organizationId: input.organizationId }, archived: false, title: { contains: input.search, mode: "insensitive" } },
      select: { id: true, title: true }, orderBy: { id: "asc" }, take: 21,
    });
    return { organizationId: input.organizationId, projectId: input.projectId, actorClerkUserId: admin.subject, cases: cases.slice(0, 20), more: cases.length > 20 };
  }, aiTransactionOptions);
}

async function snapshot(tx: Tx, input: z.infer<typeof aiCasePreviewInput>) {
  const scope = aiAdminScope.parse({ organizationId: input.organizationId, projectId: input.projectId });
  if (process.env.VAETTIR_AI_CASE_DISCLOSURE_ENABLED !== "1" || !aiDisclosureDeployment()(scope.organizationId, scope.projectId))
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Case sharing is unavailable." });
  const policy = await lockAiPolicy(tx, scope);
  if (!policy || policy.version !== input.expectedPolicyVersion || !aiCaseClassificationAllowed(policy.classification))
    throw new TRPCError({ code: "CONFLICT", message: "Review project classification first." });
  const rows = await tx.testCase.findMany({
    where: { id: { in: input.caseIds }, projectId: scope.projectId, project: { organizationId: scope.organizationId }, archived: false },
    select: { id: true, projectId: true, title: true, given: true, when: true, then: true },
    take: 20,
  });
  const payload = projectAiCases(aiCaseSelection.parse({ ...scope, caseIds: input.caseIds, fields: input.fields }), rows, policy.version);
  return { scope, payload, digest: aiCaseDigest(payload), policy };
}

export async function previewAiCases(actor: Actor, value: z.infer<typeof aiCasePreviewInput>) {
  const input = aiCasePreviewInput.parse(value);
  return actor.prisma.$transaction(async tx => {
    const admin = await lockAiAdmin(tx, actor, input);
    const s = await snapshot(tx, input);
    return { ...s.scope, actorClerkUserId: admin.subject, snapshot: s.payload, digest: s.digest };
  }, aiTransactionOptions);
}

export async function issueAiCaseGrant(actor: Actor, value: z.infer<typeof aiCaseIssueInput>): Promise<AiCommandResult> {
  const input = aiCaseIssueInput.parse(value);
  return actor.prisma.$transaction(async tx => {
    const admin = await lockAiAdmin(tx, actor, input);
    const scope = aiAdminScope.parse({ organizationId: input.organizationId, projectId: input.projectId });
    const command = await replayAiCommand(tx, admin.id, scope, input, "ISSUE");
    if (command.prior) return command.prior;
    const s = await snapshot(tx, input);
    if (s.digest !== input.previewDigest)
      throw new TRPCError({ code: "CONFLICT", message: "Cases changed. Preview them again." });
    const now = new Date();
    if (await tx.aiDisclosureGrant.count({ where: { ...scope, enabled: true, revokedAt: null, expiresAt: { gt: now } } }) >= 20)
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Revoke an unused connection first." });
    const { token, ...key } = createAiCredential();
    const grant = await tx.aiDisclosureGrant.create({ data: {
      ...scope, ...key, recipient: "codex", scope: AI_CASE_SCOPE,
      classificationVersion: s.policy.version, approvedByUserId: admin.id, approvedClerkSubject: admin.subject,
      expiresAt: new Date(now.getTime() + input.lifetimeDays * 86_400_000),
      caseSnapshot: { create: { digest: s.digest, selection: { ...scope, caseIds: s.payload.cases.map(c => c.id), fields: s.payload.fields } } },
    } });
    await auditAiAdmin(tx, scope, admin.id, "GRANT_ISSUED", s.policy.version, grant.id);
    const result = { operation: "ISSUE" as const, policyVersion: s.policy.version, grantId: grant.id, grantVersion: grant.version };
    await saveAiCommandReceipt(tx, scope, command, result);
    return { ...result, token, replayed: false };
  }, aiTransactionOptions);
}
