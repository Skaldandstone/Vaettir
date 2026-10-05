import { TRPCError } from "@trpc/server";
import {
  Prisma,
  TestCaseType,
  ValidationDomain,
  type PrismaClient,
} from "@vaettir/db";
import {
  decodeCaseProcedureExport,
  type CaseProcedureExport,
} from "@vaettir/core";
import { z } from "zod";
import { captureCaseProcedureExport } from "./caseProcedureExport.js";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";
import { verificationProfileSchema } from "./physicalValidation.js";
import { readCaseFieldState, lockCaseFieldProject } from "./caseFields.js";
import { lockCurrentCaseFieldActor, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CASES = 50;
const identity = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const procedureReimportScope = z.object({
  organizationId: identity,
  clerkActorId: identity,
}).strict();
export const procedureReimportInput = z
  .object({ projectId: identity, serialized: z.string().max(MAX_BYTES), expectedScope: procedureReimportScope.optional() })
  .strict();
export const procedureReimportApproval = procedureReimportInput
  .extend({
    expectedReviewHash: hash,
    actorId: identity,
    selections: z
      .array(
        z
          .object({
            caseId: identity,
            reason: z.string().trim().min(1).max(1000),
            overwriteConfirmed: z.literal(true),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_CASES)
      .refine(
        (rows) => new Set(rows.map((r) => r.caseId)).size === rows.length,
        "Choose each case once",
      ),
    confirmed: z.literal(true),
    requestId: z.string().uuid(),
  })
  .strict();
const field = z.object({
  label: z.string(),
  current: z.string(),
  incoming: z.string(),
});
export const procedureReimportPreviewOutput = z.object({
  projectId: identity,
  organizationId: identity,
  actorClerkUserId: identity,
  actorId: identity,
  expectedReviewHash: hash,
  bundleHash: hash,
  entries: z.array(
    z.object({
      caseId: identity,
      displayId: identity,
      title: z.string(),
      status: z.enum([
        "UNCHANGED",
        "CONFLICT",
        "UNAVAILABLE",
        "NEW_UNAVAILABLE",
      ]),
      expectedCaseHash: hash.nullable(),
      fields: z.array(field),
      warnings: z.array(z.string()),
      missingRelationships: z.array(z.string()),
    }),
  ),
  warnings: z.array(z.string()),
});
export const procedureReimportResult = z.object({
  requestId: z.string().uuid(),
  restored: z.array(z.object({ caseId: identity, displayId: identity })),
  replayed: z.boolean(),
  freshnessNotice: z.string(),
  // Optional when decoding old immutable receipts; current responses add echoes.
  projectId: identity.optional(),
  organizationId: identity.optional(),
  actorClerkUserId: identity.optional(),
});
async function lockedScope(
  tx: Prisma.TransactionClient,
  userId: string,
  input: z.infer<typeof procedureReimportInput>,
  authorized?: CaseFieldReadAuthorization,
) {
  await lockCaseFieldProject(tx, userId, input.projectId);
  // Request authentication is independent of optional retained review scope.
  // Pin it before private comparisons, new writes or accepted receipt replay.
  const actorClerkUserId = await lockCurrentCaseFieldActor(tx, userId, authorized);
  const project = await tx.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { organizationId: true } });
  if (input.expectedScope && (input.expectedScope.organizationId !== project.organizationId || input.expectedScope.clerkActorId !== actorClerkUserId))
    throw new TRPCError({ code: "FORBIDDEN", message: "This procedure request belongs to a different original organization or signed-in actor." });
  return { projectId: input.projectId, organizationId: project.organizationId, actorClerkUserId };
}
type Procedure = CaseProcedureExport["cases"][number];
const keys = [
  "title",
  "background",
  "given",
  "when",
  "then",
  "authoredSteps",
  "tags",
  "testType",
  "validationDomain",
  "verificationProfile",
] as const;
const preserved = [
  "suitePath",
  "priority",
  "automationStatus",
  "origin",
  "reviewStatus",
  "archived",
] as const;
const freshnessNotice =
  "Original versions, approvals, risk/design assessments, paid drafts and run records are retained, not recertified for restored content. Review derived outputs before use.";
function valueLabel(value: unknown): string {
  return typeof value === "string"
    ? value
    : value == null
      ? "Not set"
      : JSON.stringify(value, null, 2);
}
function stableProcedure(p: Procedure): Procedure {
  return {
    ...p,
    prerequisites: [...p.prerequisites].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    mediaReferences: [...p.mediaReferences].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  };
}
function readBundle(input: z.infer<typeof procedureReimportInput>) {
  try {
    if (Buffer.byteLength(input.serialized, "utf8") > MAX_BYTES)
      throw Error("size");
    const bundle = decodeCaseProcedureExport(input.serialized);
    if (
      bundle.project.id !== input.projectId ||
      !bundle.cases.length ||
      bundle.cases.length > MAX_CASES
    )
      throw Error("scope");
    if (
      bundle.cases.some(
        (p) =>
          p.authoredSteps.length > 500 ||
          p.resolvedSteps.length > 500 ||
          p.given.length + p.when.length + p.then.length > 500,
      ) ||
      bundle.cases.reduce(
        (n, p) => n + p.prerequisites.length + p.mediaReferences.length,
        0,
      ) > 500
    )
      throw Error("relationship bound");
    return bundle;
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Choose valid version 1 procedure JSON from this same project: 1–50 cases, at most 2 MiB, 500 steps/BDD lines per case and 500 total media/prerequisite references. Nothing was restored.",
    });
  }
}
function authoredData(p: Procedure) {
  return {
    title: z.string().min(1).max(100000).parse(p.title),
    background: p.background,
    given: p.given,
    when: p.when,
    then: p.then,
    tags: p.tags,
    testType: z.nativeEnum(TestCaseType).parse(p.testType),
    validationDomain: z.nativeEnum(ValidationDomain).parse(p.validationDomain),
    verificationProfile: verificationProfileSchema
      .strict()
      .parse(p.verificationProfile),
  };
}
async function review(
  tx: Prisma.TransactionClient,
  userId: string,
  input: z.infer<typeof procedureReimportInput>,
  bundle: CaseProcedureExport,
  capturedClerkActorId: string,
) {
  await requireCurrentPlanAccess(tx, userId, input.projectId, true);
  const project = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: {
      caseKey: true,
      organizationId: true,
      caseFieldSchema: true,
      caseFieldSchemaVersion: true,
    },
  });
  if (project.caseKey !== bundle.project.caseKey)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The file's project key does not match this project's stable identity.",
    });
  const entries: z.infer<typeof procedureReimportPreviewOutput>["entries"] = [];
  const current = new Map<string, Procedure>();
  let currentBytes = 0;
  for (const incoming of bundle.cases) {
    const entry: (typeof entries)[number] = {
      caseId: incoming.id,
      displayId: incoming.displayId,
      title: incoming.title,
      status: "NEW_UNAVAILABLE",
      expectedCaseHash: null,
      fields: [],
      warnings: [],
      missingRelationships: [],
    };
    entries.push(entry);
    const identityRow = await tx.testCase.findFirst({
      where: { id: incoming.id, projectId: input.projectId },
      select: {
        displayId: true,
        caseNumber: true,
        archived: true,
        updatedAt: true,
        testPlanId: true,
        sortPosition: true,
      },
    });
    if (!identityRow) {
      entry.warnings.push(
        "This original case identity is unavailable. New or deleted IDs are not recreated, reassigned or duplicated by snapshot restore.",
      );
      continue;
    }
    if (
      identityRow.displayId !== incoming.displayId ||
      identityRow.caseNumber !== incoming.caseNumber ||
      identityRow.archived
    ) {
      entry.status = "UNAVAILABLE";
      entry.warnings.push(
        "The stable identity differs or the case is archived. Nothing can overwrite this record.",
      );
      continue;
    }
    const [size] = await tx.$queryRaw<
      Array<{ bytes: bigint }>
    >`SELECT (octet_length(row_to_json(c)::text)::bigint + coalesce((SELECT sum(octet_length(row_to_json(s)::text)) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0) + coalesce((SELECT octet_length(g.steps::text) FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId" AND g."projectId"=c."projectId"),0)) AS bytes FROM "TestCase" c WHERE c.id=${incoming.id} AND c."projectId"=${input.projectId}`;
    if (!size || size.bytes > BigInt(512 * 1024)) {
      entry.status = "UNAVAILABLE";
      entry.warnings.push(
        "Current case exceeds the 512 KiB review bound; choose focused manual editing.",
      );
      continue;
    }
    currentBytes += Number(size.bytes);
    if (currentBytes > MAX_BYTES)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "The current comparison scope exceeds 2 MiB. Choose fewer cases; nothing was restored.",
      });
    let live: Procedure;
    try {
      live = stableProcedure(
        (
          await captureCaseProcedureExport(tx, {
            projectId: input.projectId,
            ids: [incoming.id],
            scope: "selected",
            includeArchived: true,
          })
        ).cases[0]!,
      );
      authoredData(incoming);
    } catch {
      entry.status = "UNAVAILABLE";
      entry.warnings.push(
        "The current or incoming procedure has unsupported fields or unavailable references. Repair it before restoration.",
      );
      continue;
    }
    current.set(incoming.id, live);
    const metadata = await readCaseFieldState(
      tx,
      userId,
      input.projectId,
      incoming.id,
      capturedClerkActorId,
    );
    if (metadata.problems.length) {
      entry.status = "UNAVAILABLE";
      entry.missingRelationships.push(
        `Complete current required case metadata before restoration: ${metadata.problems.join(" ")}`,
      );
      continue;
    }
    entry.expectedCaseHash = qualityProfileHash({
      live,
      updatedAt: identityRow.updatedAt.toISOString(),
      testPlanId: identityRow.testPlanId,
      sortPosition: identityRow.sortPosition,
    });
    for (const key of keys)
      if (qualityProfileHash(live[key]) !== qualityProfileHash(incoming[key]))
        entry.fields.push({
          label: key,
          current: valueLabel(live[key]),
          incoming: valueLabel(incoming[key]),
        });
    for (const key of preserved)
      if (qualityProfileHash(live[key]) !== qualityProfileHash(incoming[key]))
        entry.warnings.push(
          `${key} differs in the file and will be preserved from the current case, not restored.`,
        );
    if (
      qualityProfileHash(live.sharedStepGroup) !==
        qualityProfileHash(incoming.sharedStepGroup) ||
      (incoming.sharedStepGroup &&
        qualityProfileHash(live.resolvedSteps) !==
          qualityProfileHash(incoming.resolvedSteps))
    )
      entry.missingRelationships.push(
        "The shared-library relationship or live resolved definition differs. Use the library's independent reviewed history, not snapshot overwrite.",
      );
    for (const reference of incoming.prerequisites) {
      const available = await tx.testCase.findFirst({
        where: {
          id: reference.id,
          projectId: input.projectId,
          displayId: reference.displayId,
          archived: false,
        },
        select: { id: true },
      });
      if (!available)
        entry.missingRelationships.push(
          `Prerequisite ${reference.displayId} is unavailable in this project.`,
        );
    }
    if (
      qualityProfileHash(live.prerequisites.map((p) => p.id).sort()) !==
      qualityProfileHash(incoming.prerequisites.map((p) => p.id).sort())
    )
      entry.warnings.push(
        "Prerequisite relationships differ. All current conditions are preserved; v1 restore does not add or remove links.",
      );
    for (const ref of incoming.mediaReferences) {
      const actual = await tx.testCaseAttachment.findFirst({
        where: {
          id: ref.id,
          testCaseId: incoming.id,
          testCase: { projectId: input.projectId },
          uploadCompletedAt: { not: null },
          fileName: ref.fileName,
          contentType: ref.contentType,
          sizeBytes: ref.sizeBytes,
        },
        select: { id: true },
      });
      if (!actual || !ref.uploadMetadataVerified)
        entry.missingRelationships.push(
          `Media ${ref.fileName} has no verified same-case upload. No file is fetched or reattached.`,
        );
    }
    if (
      !incoming.sharedStepGroup &&
      qualityProfileHash(incoming.resolvedSteps) !==
        qualityProfileHash(incoming.authoredSteps)
    )
      entry.missingRelationships.push(
        "Resolved and authored steps differ without a shared-library reference.",
      );
    entry.status = entry.missingRelationships.length
      ? "UNAVAILABLE"
      : entry.fields.length
        ? "CONFLICT"
        : "UNCHANGED";
    if (entry.status === "CONFLICT")
      entry.warnings.push(
        "Version 1 contains no trustworthy edit baseline. Current manual edits remain authoritative unless you explicitly approve replacing this case's supported fields.",
      );
  }
  const bundleHash = qualityProfileHash(bundle);
  return {
    current,
    preview: {
      projectId: input.projectId,
      actorId: userId,
      bundleHash,
      expectedReviewHash: qualityProfileHash({
        projectId: input.projectId,
        organizationId: project.organizationId,
        caseFieldSchema: project.caseFieldSchema,
        caseFieldSchemaVersion: project.caseFieldSchemaVersion,
        actorId: userId,
        bundleHash,
        entries,
      }),
      entries,
      warnings: [
        "Existing same-project snapshot restoration only, not new-project import or complete archival round trip. Missing cases are never deleted or recreated.",
        "Suite/order, priority rationale, approvals, automation status, source provenance, prerequisite links, datasets and paid outputs remain unchanged. Shared libraries are never rewritten.",
        freshnessNotice,
      ],
    },
  };
}
export async function previewProcedureReimport(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof procedureReimportInput>,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const scope = await lockedScope(tx, userId, input, authorized);
      const bundle = readBundle(input);
      return {
        ...(await review(tx, userId, input, bundle, scope.actorClerkUserId)).preview,
        ...scope,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 30000,
    },
  );
}
export async function approveProcedureReimport(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof procedureReimportApproval>,
  authorized?: CaseFieldReadAuthorization,
) {
  if (input.actorId !== userId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This review belongs to a different signed-in actor.",
    });
  const requestHash = qualityProfileHash(input);
  return db.$transaction(
    async (tx) => {
      const scope = await lockedScope(tx, userId, input, authorized);
      const bundle = readBundle(input);
      const receipt = await tx.auditLog.findFirst({
        where: {
          projectId: input.projectId,
          actorId: userId,
          entityType: "TestCaseProcedureReimport",
          metadata: { path: ["requestId"], equals: input.requestId },
        },
        select: { metadata: true, organizationId: true },
      });
      if (receipt) {
        // Legacy payloads do not carry expectedScope, but the immutable receipt
        // still belongs to its original tenant, never a reparented project.
        if (receipt.organizationId !== scope.organizationId)
          throw new TRPCError({ code: "FORBIDDEN", message: "The original restoration receipt belongs to a different organization." });
        const saved = z
          .object({ requestHash: hash, result: procedureReimportResult })
          .parse(receipt.metadata);
        if (saved.requestHash !== requestHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This request ID already belongs to a different restoration approval.",
          });
        return { ...saved.result, replayed: true, ...scope };
      }
      const ids = bundle.cases.map((c) => c.id);
      await tx.$queryRaw`SELECT id FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT s.id FROM "TestCaseStep" s JOIN "TestCase" c ON c.id=s."testCaseId" WHERE c."projectId"=${input.projectId} AND c.id IN (${Prisma.join(ids)}) FOR UPDATE OF s`;
      await tx.$queryRaw`SELECT g.id FROM "SharedStepGroup" g JOIN "TestCase" c ON c."sharedStepGroupId"=g.id WHERE c."projectId"=${input.projectId} AND g."projectId"=${input.projectId} AND c.id IN (${Prisma.join(ids)}) FOR SHARE OF g`;
      await tx.$queryRaw`SELECT a.id FROM "TestCaseAttachment" a JOIN "TestCase" c ON c.id=a."testCaseId" WHERE c."projectId"=${input.projectId} AND c.id IN (${Prisma.join(ids)}) FOR SHARE OF a`;
      await tx.$queryRaw`SELECT p."dependentId" FROM "TestCasePrerequisite" p WHERE p."projectId"=${input.projectId} AND p."dependentId" IN (${Prisma.join(ids)}) FOR SHARE OF p`;
      const prerequisiteIds = [
        ...new Set(
          bundle.cases.flatMap((c) => c.prerequisites.map((p) => p.id)),
        ),
      ];
      if (prerequisiteIds.length)
        await tx.$queryRaw`SELECT id FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(prerequisiteIds)}) ORDER BY id FOR SHARE`;
      const state = await review(tx, userId, input, bundle, scope.actorClerkUserId);
      if (state.preview.expectedReviewHash !== input.expectedReviewHash)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Case content, access or relationships changed after review. Refresh and review again; nothing was restored.",
        });
      const selected = input.selections.map((selection) => {
        const incoming = bundle.cases.find((c) => c.id === selection.caseId),
          live = state.current.get(selection.caseId),
          entry = state.preview.entries.find(
            (c) => c.caseId === selection.caseId,
          );
        if (!incoming || !live || entry?.status !== "CONFLICT")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Only explicitly reviewed available changed cases may be restored.",
          });
        return { selection, incoming, live };
      });
      for (const { incoming, live, selection } of selected) {
        await snapshotTestCaseVersion(tx, {
          testCaseId: live.id,
          title: live.title,
          background: live.background,
          given: live.given,
          when: live.when,
          then: live.then,
          steps: live.authoredSteps,
          tags: live.tags,
          priority: z
            .enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"])
            .parse(live.priority),
          testType: z.nativeEnum(TestCaseType).parse(live.testType),
          actorId: userId,
        });
        await tx.testCase.update({
          where: { id: live.id },
          data: {
            ...authoredData(incoming),
            verificationProfile:
              incoming.verificationProfile as Prisma.InputJsonValue,
            updatedById: userId,
          },
        });
        // Replaces only explicitly reviewed authored rows, preserving inactive rows
        // beneath unchanged shared-library references as well as both BDD formats.
        await tx.testCaseStep.deleteMany({ where: { testCaseId: live.id } });
        if (incoming.authoredSteps.length)
          await tx.testCaseStep.createMany({
            data: incoming.authoredSteps.map((step) => ({
              ...step,
              testCaseId: live.id,
            })),
          });
        await snapshotTestCaseVersion(tx, {
          testCaseId: live.id,
          title: incoming.title,
          background: incoming.background,
          given: incoming.given,
          when: incoming.when,
          then: incoming.then,
          steps: incoming.authoredSteps,
          tags: incoming.tags,
          priority: z
            .enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"])
            .parse(live.priority),
          testType: z.nativeEnum(TestCaseType).parse(incoming.testType),
          actorId: userId,
        });
        const organization = await tx.project.findUniqueOrThrow({
          where: { id: input.projectId },
          select: { organizationId: true },
        });
        await tx.auditLog.create({
          data: {
            organizationId: organization.organizationId,
            projectId: input.projectId,
            actorId: userId,
            entityType: "TestCaseProcedureRestore",
            entityId: live.id,
            action: "UPDATE",
            summary: `Restored reviewed procedure fields for ${live.displayId}`,
            metadata: {
              requestId: input.requestId,
              reason: selection.reason,
              previousCaseHash: qualityProfileHash(live),
              incomingHash: qualityProfileHash(incoming),
              freshnessNotice,
            },
          },
        });
      }
      const result = {
        requestId: input.requestId,
        restored: selected.map(({ live }) => ({
          caseId: live.id,
          displayId: live.displayId,
        })),
        replayed: false,
        freshnessNotice,
      };
      const project = await tx.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { organizationId: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: project.organizationId,
          projectId: input.projectId,
          actorId: userId,
          entityType: "TestCaseProcedureReimport",
          entityId: input.requestId,
          action: "UPDATE",
          summary: `Restored ${result.restored.length} reviewed case procedures`,
          metadata: {
            requestId: input.requestId,
            requestHash,
            bundleHash: state.preview.bundleHash,
            result,
          },
        },
      });
      return { ...result, ...scope };
    },
    { timeout: 30000 },
  );
}
