import { correlateAndroidNetwork } from "./androidNetworkCorrelation.js";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { testCaseContentRevision } from "./testCaseContentRevision.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";
import { observedNavigationJourney } from "./androidExplorationSchema.js";
import { admitAndroidNetworkEvidence } from "./androidNetworkEvidenceSchema.js";
import {
  androidReplayCase,
  androidReplayCaseInput,
  androidReplayPatchInput,
  androidReplayPatchReceipt,
  androidReplayScopeInput,
  androidReplayLocator,
  androidReplayPatchedAction,
} from "./androidCaseReplaySchema.js";
type Scope = z.infer<typeof androidReplayScopeInput>;
type Authority = { nativeActorId: string; clerkActorId: string };
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const refuse = (
  code: "FORBIDDEN" | "CONFLICT" | "PRECONDITION_FAILED" = "FORBIDDEN",
) =>
  new TRPCError({
    code,
    message:
      "The complete original editor scope, case revision or reviewed evidence is unavailable. No device command or case patch was replayed.",
  });
async function lockAuthority(
  tx: Prisma.TransactionClient,
  input: Scope,
  authority: Authority,
) {
  if (
    input.expectedClerkActorId !== authority.clerkActorId ||
    input.expectedNativeActorId !== authority.nativeActorId
  )
    throw refuse();
  await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
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
    throw refuse();
}
async function loadCase(
  tx: Prisma.TransactionClient,
  input: Scope,
  caseId: string,
) {
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM "TestCase" WHERE id=${caseId} AND "projectId"=${input.projectId} AND archived=false AND "sharedStepGroupId" IS NULL AND "validationDomain"::text='SOFTWARE' FOR UPDATE`;
  if (rows.length !== 1) throw refuse();
  await tx.$queryRaw`SELECT id FROM "TestCaseStep" WHERE "testCaseId"=${caseId} ORDER BY "order" LIMIT 13 FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "TestCaseSource" WHERE "testCaseId"=${caseId} FOR SHARE`;
  const [bounds] = await tx.$queryRaw<
    Array<{ bytes: bigint; count: bigint }>
  >`SELECT (octet_length(to_jsonb(c)::text)+coalesce((SELECT sum(octet_length(to_jsonb(s)::text)) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0)+coalesce((SELECT octet_length(to_jsonb(src)::text) FROM "TestCaseSource" src WHERE src."testCaseId"=c.id),0))::bigint AS bytes,(SELECT count(*) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id)::bigint AS count FROM "TestCase" c WHERE c.id=${caseId}`;
  if (
    !bounds ||
    bounds.bytes > 262144n ||
    bounds.count < 1n ||
    bounds.count > 12n
  )
    throw refuse("PRECONDITION_FAILED");
  const tc = await tx.testCase.findUniqueOrThrow({
    where: { id: caseId },
    include: { steps: { orderBy: { order: "asc" } }, source: true },
  });
  if (
    tc.steps.length < 1 ||
    tc.steps.length > 12 ||
    JSON.stringify(tc).length > 262144 ||
    tc.steps.some((s, i) => s.order !== i || !s.expectedResult)
  )
    throw refuse("PRECONDITION_FAILED");
  return tc;
}
type Case = Awaited<ReturnType<typeof loadCase>>;
// Include update identity and native step IDs as well as all authored content.
// A change-and-restore cannot revive a previously admitted replay or patch.
export function androidCaseReplayRevision(tc: Case) {
  return hash({
    content: testCaseContentRevision(tc),
    updatedAt: tc.updatedAt.toISOString(),
    stepIds: tc.steps.map((s) => s.id),
    source: tc.source,
  });
}
function projectCase(tc: Case) {
  const source = tc.source?.importSnapshot;
  const journey = observedNavigationJourney.safeParse(
    source && typeof source === "object" && !Array.isArray(source)
      ? source.journey
      : undefined,
  );
  return androidReplayCase.parse({
    id: tc.id,
    title: tc.title,
    revision: androidCaseReplayRevision(tc),
    packageName: journey.success ? journey.data.packageName : null,
    steps: tc.steps.map((s, i) => {
      const old = journey.success ? journey.data.steps[i] : null;
      const locator =
        old?.action.kind === "TAP"
          ? androidReplayLocator.safeParse({
              ...old.execution.target.selector,
              className: old.execution.target.className,
            })
          : null;
      return {
        id: s.id,
        order: s.order,
        action: s.action,
        expectedResult: s.expectedResult,
        locator: locator?.success ? locator.data : null,
        label: old?.action.kind === "TAP" ? old.action.label : null,
      };
    }),
  });
}
export async function listAndroidReplayCases(
  db: PrismaClient,
  raw: Scope,
  authority: Authority,
) {
  const input = androidReplayScopeInput.parse(raw);
  return db.$transaction(
    async (tx) => {
      await lockAuthority(tx, input, authority);
      const rows = await tx.$queryRaw<
        Array<{ id: string; title: string | null }>
      >`SELECT id,CASE WHEN octet_length(title)<=40000 THEN title ELSE NULL END AS title FROM "TestCase" WHERE "projectId"=${input.projectId} AND archived=false AND "sharedStepGroupId" IS NULL AND "validationDomain"::text='SOFTWARE' AND EXISTS(SELECT 1 FROM "TestCaseStep" s WHERE s."testCaseId"="TestCase".id) ORDER BY id LIMIT 100`;
      if (rows.some((r) => r.title === null))
        throw refuse("PRECONDITION_FAILED");
      return rows.map((r) => ({ id: r.id, title: r.title! }));
    },
    {
      timeout: 10000,
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  );
}
export async function readAndroidReplayCase(
  db: PrismaClient,
  raw: z.infer<typeof androidReplayCaseInput>,
  authority: Authority,
) {
  const input = androidReplayCaseInput.parse(raw);
  return db.$transaction(
    async (tx) => {
      await lockAuthority(tx, input, authority);
      const result = projectCase(await loadCase(tx, input, input.caseId));
      if (input.expectedRevision && result.revision !== input.expectedRevision)
        throw refuse("CONFLICT");
      return result;
    },
    {
      timeout: 10000,
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  );
}
export function validateAndroidReplayEvidence(
  input: z.infer<typeof androidReplayPatchInput>,
  tc: Case,
) {
  if (
    input.plan.revision !== androidCaseReplayRevision(tc) ||
    input.plan.caseId !== tc.id ||
    input.planHash !== hash(input.plan) ||
    input.plan.steps.length !== tc.steps.length ||
    input.receipts.length !== tc.steps.length
  )
    throw refuse("CONFLICT");
  const requestIds = new Set<string>();
  let lastSequence = 0,
    lastTime = 0;
  for (let i = 0; i < tc.steps.length; i++) {
    const s = tc.steps[i]!,
      p = input.plan.steps[i]!,
      r = input.receipts[i]!;
    if (
      p.stepId !== s.id ||
      p.expectedResult !== s.expectedResult ||
      r.stepId !== s.id ||
      r.expectedResult !== s.expectedResult ||
      r.target.packageName !== input.plan.packageName ||
      !r.assertion.passed ||
      r.assertion.matches !== 1 ||
      r.assertion.value !== p.assertion.value ||
      JSON.stringify(r.originalLocator) !== JSON.stringify(p.locator) ||
      r.sequence <= lastSequence ||
      r.observedAt < lastTime ||
      requestIds.has(r.requestId) ||
      (i > 0 && input.receipts[i - 1]!.to !== r.from)
    )
      throw refuse("PRECONDITION_FAILED");
    if (
      !r.repaired &&
      (r.target.selector.kind !== p.locator.kind ||
        r.target.selector.value !== p.locator.value ||
        (p.locator.kind === "TEXT_CLASS" &&
          r.target.className !== p.locator.className))
    )
      throw refuse("PRECONDITION_FAILED");
    requestIds.add(r.requestId);
    lastSequence = r.sequence;
    lastTime = r.observedAt;
  }
  if ((input.network === null) !== (input.networkSelection === null))
    throw refuse("PRECONDITION_FAILED");
  if (input.network && input.networkSelection) {
    admitAndroidNetworkEvidence(input.network, {
      ...input.networkSelection,
      packageName: input.plan.packageName,
      runId: input.runId,
    });
    if (
      input.network.version === 1 &&
      input.receipts.some(
        (r) =>
          r.observedAt < input.networkSelection!.startedAt ||
          r.observedAt > input.networkSelection!.endedAt,
      )
    )
      throw refuse("PRECONDITION_FAILED");
  }
}
export async function patchAndroidReplayCase(
  db: PrismaClient,
  raw: z.infer<typeof androidReplayPatchInput>,
  authority: Authority,
) {
  const input = androidReplayPatchInput.parse(raw),
    requestHash = hash({ input, actor: authority.nativeActorId });
  if (JSON.stringify(input).length > 262144)
    throw refuse("PRECONDITION_FAILED");
  return db.$transaction(
    async (tx) => {
      await lockAuthority(tx, input, authority);
      const prior = await tx.auditLog.findFirst({
        where: {
          organizationId: input.originalOrganizationId,
          projectId: input.projectId,
          actorId: authority.nativeActorId,
          entityType: "AndroidCaseReplayPatch",
          entityId: input.requestId,
        },
        select: { metadata: true },
      });
      if (prior) {
        const saved = androidReplayPatchReceipt.parse(
          (prior.metadata as Prisma.JsonObject).receipt,
        );
        if (saved.requestHash !== requestHash) throw refuse("CONFLICT");
        return saved;
      }
      const tc = await loadCase(tx, input, input.plan.caseId);
      validateAndroidReplayEvidence(input, tc);
      const networkCorrelation =
        input.network && input.networkSelection
          ? correlateAndroidNetwork(
              input.network,
              input.networkSelection,
              input.receipts,
            )
          : null;
      const steps = tc.steps.map((s, i) => {
        const r = input.receipts[i]!;
        return {
          ...s,
          action: androidReplayPatchedAction(
            s.action,
            input.runId,
            r,
            input.network,
            input.requestId,
            networkCorrelation,
          ),
        };
      });
      if (steps.some((s) => s.action.length > 20000))
        throw refuse("PRECONDITION_FAILED");
      for (const s of steps)
        await tx.testCaseStep.update({
          where: { id: s.id },
          data: { action: s.action },
        });
      const changed = await tx.testCase.update({
        where: { id: tc.id },
        data: {
          updatedById: authority.nativeActorId,
          reviewStatus: "PENDING_REVIEW",
          reviewedAt: null,
          reviewedById: null,
          reviewNote:
            "Reviewed technical enrichment added; ordinary case approval is pending.",
        },
        include: { steps: { orderBy: { order: "asc" } }, source: true },
      });
      await snapshotTestCaseVersion(tx, {
        testCaseId: tc.id,
        title: tc.title,
        background: tc.background,
        given: tc.given,
        when: tc.when,
        then: tc.then,
        steps,
        tags: tc.tags,
        priority: tc.priority,
        testType: tc.testType,
        actorId: authority.nativeActorId,
      });
      const version = await tx.testCaseVersion.findFirstOrThrow({
        where: { testCaseId: tc.id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      const receipt = androidReplayPatchReceipt.parse({
        requestId: input.requestId,
        requestHash,
        caseId: tc.id,
        priorRevision: input.plan.revision,
        newRevision: androidCaseReplayRevision(changed),
        versionNumber: version.versionNumber,
        runId: input.runId,
        nativeExecutionIndependentlyVerified: false,
      });
      await tx.auditLog.create({
        data: {
          organizationId: input.originalOrganizationId,
          projectId: input.projectId,
          actorId: authority.nativeActorId,
          entityType: "AndroidCaseReplayPatch",
          entityId: input.requestId,
          action: "UPDATE",
          summary:
            "Reviewed Android technical evidence saved as a new case version; ordinary approval pending",
          metadata: {
            receipt,
            evidence: input as unknown as Prisma.InputJsonObject,
            networkCorrelation:
              networkCorrelation as unknown as Prisma.InputJsonValue,
            automationSuggestion: {
              framework: "UI_AUTOMATOR",
              caseId: tc.id,
              caseVersion: version.versionNumber,
              paidGenerationPerformed: false,
            },
          },
        },
      });
      return receipt;
    },
    {
      timeout: 15000,
      maxWait: 5000,
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  );
}
