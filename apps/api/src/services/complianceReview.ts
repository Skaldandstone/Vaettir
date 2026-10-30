import {
  caseFieldSchema,
  caseFieldValues,
  type CaseFieldValues,
} from "./caseFieldSchema.js";
import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "@vaettir/core/dist/validation.js";
import {
  COMPLIANCE_STARTERS,
  COMPLIANCE_REFERENCE_VERSION,
} from "@vaettir/core/dist/complianceReferences.js";
import {
  assertCaseFieldAuthoring,
  readCaseFieldState,
  lockCaseFieldProject,
} from "./caseFields.js";
import { lockCurrentCaseFieldActor } from "./caseFieldReadScope.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";

const id = z.string().min(1).max(200),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const complianceScope = z
  .object({
    projectId: id,
    originalOrganizationId: id,
    expectedClerkActorId: id,
  })
  .strict();
export const compliancePreview = complianceScope
  .extend({
    requestId: z.string().uuid(),
    frameworkIds: z.array(id).min(1).max(20),
  })
  .strict();
export const complianceDraftInput = complianceScope
  .extend({ draftId: z.string().uuid() })
  .strict();
const newCase = z
  .object({
    title: z.string().trim().min(1).max(500),
    prerequisite: z.string().trim().min(1).max(4000),
    action: z.string().trim().min(1).max(4000),
    expectedResult: z.string().trim().min(1).max(4000),
    customFields: caseFieldValues.optional(),
  })
  .strict();
export const complianceSelection = z
  .array(
    z
      .object({
        controlId: id,
        caseIds: z.array(id).max(100),
        newCase: newCase.nullable(),
      })
      .strict(),
  )
  .max(100);
export const complianceSave = complianceDraftInput
  .extend({ expectedDigest: hash, selection: complianceSelection })
  .strict();
export const complianceApply = complianceDraftInput
  .extend({
    expectedDigest: hash,
    requestId: z.string().uuid(),
    confirmed: z.literal(true),
  })
  .strict();
type Actor = {
  id: string;
  clerkActorId: string;
  workspaceOrganizationId?: string | null;
};
type Scope = z.infer<typeof complianceScope>;
type Tx = Prisma.TransactionClient;
const fail = (
  message: string,
  code: "FORBIDDEN" | "CONFLICT" | "BAD_REQUEST" = "CONFLICT",
) => new TRPCError({ code, message });
export const complianceHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const options = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 30_000,
};

async function authorize(tx: Tx, actor: Actor, scope: Scope) {
  if (
    !actor.clerkActorId ||
    actor.clerkActorId !== scope.expectedClerkActorId ||
    (actor.workspaceOrganizationId &&
      actor.workspaceOrganizationId !== scope.originalOrganizationId)
  )
    throw fail("Restore the original account and workspace.", "FORBIDDEN");
  await lockCaseFieldProject(tx, actor.id, scope.projectId);
  await lockCurrentCaseFieldActor(tx, actor.id, {
    clerkActorId: actor.clerkActorId,
  });
  const project = await tx.project.findUniqueOrThrow({
    where: { id: scope.projectId },
  });
  if (project.organizationId !== scope.originalOrganizationId)
    throw fail("Project workspace changed.", "FORBIDDEN");
  return project;
}

export async function ownedComplianceFramework(
  tx: Tx,
  organizationId: string,
  frameworkId: string,
  editable = false,
) {
  const f = await tx.complianceFramework.findFirst({
    where: { id: frameworkId, organizationId },
  });
  if (!f || (editable && f.catalogKey))
    throw fail(
      "Select a workspace-owned custom framework. Public references and legacy unowned definitions cannot be edited.",
      "FORBIDDEN",
    );
  await tx.$queryRaw`SELECT id FROM "ComplianceFramework" WHERE id=${f.id} FOR UPDATE`;
  return f;
}

export const publicComplianceCatalog = () => [
  ...COMPLIANCE_STARTERS.map((s) => ({
    id: s.key,
    name: s.name,
    version: s.version,
    category: s.category,
    summary: s.summary,
    sourceUrl: s.sourceUrl,
    controls: s.controls.length,
    catalogVersion: COMPLIANCE_REFERENCE_VERSION,
  })),
  {
    id: "soc2",
    name: "SOC 2",
    version: "Applicable Trust Services Criteria",
    category: "Security & privacy",
    summary:
      "Reference only. Add licensed applicable criteria as a workspace custom framework; no control text is bundled.",
    sourceUrl: "https://www.aicpa-cima.com/",
    controls: 0,
    catalogVersion: COMPLIANCE_REFERENCE_VERSION,
  },
];

export async function loadComplianceReference(
  db: PrismaClient,
  actor: Actor,
  scope: Scope,
  key: string,
) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, scope);
    const starter = COMPLIANCE_STARTERS.find((s) => s.key === key);
    if (!starter)
      throw fail(
        "This reference has no bundled controls. Add a reviewed custom definition.",
        "BAD_REQUEST",
      );
    // Serialize across projects in the same workspace. Never adopt a global row by name.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.originalOrganizationId + ":compliance:" + key}))::text`;
    const catalogKey = `${COMPLIANCE_REFERENCE_VERSION}:${key}`;
    const prior = await tx.complianceFramework.findFirst({
      where: { organizationId: scope.originalOrganizationId, catalogKey },
    });
    if (prior) return prior;
    const f = await tx.complianceFramework.create({
      data: {
        key: `workspace:${randomUUID()}:${key}`,
        organizationId: scope.originalOrganizationId,
        catalogKey,
        name: starter.name,
        version: starter.version,
        description: `${starter.summary} Source: ${starter.sourceUrl}`,
        controls: { create: starter.controls },
      },
    });
    await audit(
      tx,
      actor.id,
      scope,
      f.id,
      "Loaded versioned public review prompts into this workspace",
      { catalogKey },
    );
    return f;
  }, options);
}

async function audit(
  tx: Tx,
  actorId: string,
  scope: Scope,
  entityId: string,
  summary: string,
  detail: unknown,
) {
  await tx.auditLog.create({
    data: {
      organizationId: scope.originalOrganizationId,
      projectId: scope.projectId,
      actorId,
      entityType: "ComplianceReview",
      entityId,
      action: "UPDATE",
      summary,
      metadata: json(detail),
    },
  });
}

const stop = new Set(
  "the and for with from that this test tests testing verify check review control controls requirement should must into case cases have will then when given".split(
    " ",
  ),
);
function terms(s: string) {
  return [
    ...new Set(
      (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
        (w) => w.length > 2 && !stop.has(w),
      ),
    ),
  ];
}
export function explainComplianceMatch(
  control: { title: string; description: string | null },
  candidate: { title: string; body: string },
) {
  const wanted = new Set(
    terms(`${control.title} ${control.description ?? ""}`),
  );
  const titleTerms = terms(candidate.title).filter((w) => wanted.has(w));
  const procedureTerms = terms(candidate.body).filter((w) => wanted.has(w));
  return {
    titleTerms,
    procedureTerms,
    score: titleTerms.length * 2 + procedureTerms.length,
    explanation:
      "Shared terms suggest relevance only; review the procedure and expected results. This is not verified coverage or legal clearance.",
  };
}

const caseSelection = {
  id: true,
  title: true,
  background: true,
  given: true,
  when: true,
  then: true,
  tags: true,
  complianceRevision: true,
  reviewStatus: true,
  steps: {
    orderBy: { order: "asc" },
    select: {
      order: true,
      action: true,
      expectedActionOrData: true,
      expectedResult: true,
      expectedResponse: true,
    },
  },
  sharedStepGroup: {
    select: { id: true, steps: true, updatedAt: true, revision: true },
  },
  complianceControls: {
    select: { controlId: true },
    orderBy: { controlId: "asc" },
  },
} satisfies Prisma.TestCaseSelect;
type ScannedCase = Prisma.TestCaseGetPayload<{ select: typeof caseSelection }>;
async function sourceSnapshot(tx: Tx, scope: Scope, frameworkIds: string[]) {
  const projectFields = await tx.project.findUniqueOrThrow({
    where: { id: scope.projectId },
    select: { caseFieldSchema: true, caseFieldSchemaVersion: true },
  });
  const fields = {
    schema: caseFieldSchema.parse(projectFields.caseFieldSchema),
    version: projectFields.caseFieldSchemaVersion,
  };
  const frameworks = [];
  for (const frameworkId of [...new Set(frameworkIds)].sort())
    frameworks.push(
      await ownedComplianceFramework(
        tx,
        scope.originalOrganizationId,
        frameworkId,
      ),
    );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "ComplianceControl" WHERE "frameworkId" IN (${Prisma.join(frameworkIds)}) ORDER BY id FOR SHARE`,
  );
  const controls = await tx.complianceControl.findMany({
    where: { frameworkId: { in: frameworkIds } },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (controls.length > 100)
    throw fail(
      "Review at most 100 controls at a time. Select fewer frameworks.",
      "BAD_REQUEST",
    );
  const total = await tx.testCase.count({
    where: { projectId: scope.projectId, archived: false },
  });
  const archived = await tx.testCase.count({
    where: { projectId: scope.projectId, archived: true },
  });
  // Keyset traversal, stable ordering, explicit cap/omissions. Project UPDATE lock
  // blocks new case FK admission while existing case rows and libraries are pinned.
  const [sourceSize] = await tx.$queryRaw<Array<{ bytes: bigint }>>`
    WITH selected AS (SELECT * FROM "TestCase" WHERE "projectId"=${scope.projectId} AND NOT archived ORDER BY id LIMIT 2000)
    SELECT (COALESCE((SELECT SUM(pg_column_size(s)) FROM selected s),0)
      + COALESCE((SELECT SUM(pg_column_size(t)) FROM "TestCaseStep" t JOIN selected s ON s.id=t."testCaseId"),0)
      + COALESCE((SELECT SUM(pg_column_size(g)) FROM "SharedStepGroup" g JOIN selected s ON s."sharedStepGroupId"=g.id),0))::bigint AS bytes`;
  if (sourceSize && sourceSize.bytes > 6n * 1024n * 1024n)
    throw fail(
      "Review source exceeds the bounded 6 MiB preview limit. Narrow the project before analysis.",
      "BAD_REQUEST",
    );
  const cases: ScannedCase[] = [];
  let cursor: string | undefined;
  while (cases.length < Math.min(total, 2000)) {
    const page: ScannedCase[] = await tx.testCase.findMany({
      where: {
        projectId: scope.projectId,
        archived: false,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: Math.min(200, 2000 - cases.length),
      select: caseSelection,
    });
    if (!page.length) break;
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "TestCase" WHERE id IN (${Prisma.join(page.map((c) => c.id))}) ORDER BY id FOR SHARE`,
    );
    const groups = [
      ...new Set(
        page.flatMap((c) => (c.sharedStepGroup ? [c.sharedStepGroup.id] : [])),
      ),
    ];
    if (groups.length)
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "SharedStepGroup" WHERE id IN (${Prisma.join(groups)}) ORDER BY id FOR SHARE`,
      );
    cases.push(...page);
    cursor = page.at(-1)!.id;
  }
  const snapshot = {
    catalogVersion: COMPLIANCE_REFERENCE_VERSION,
    fields,
    frameworks,
    controls,
    cases,
    scope: {
      scanned: cases.length,
      total,
      archived,
      omitted: total - cases.length,
      limit: 2000,
      fields:
        "Titles, background, Given/When/Then, tags, structured actions and expected results/responses, shared steps and existing mappings. Attachments, executions and private license documents are not analyzed.",
    },
  };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 6 * 1024 * 1024)
    throw fail(
      "Review source exceeds the bounded 6 MiB preview limit. Narrow the project before analysis.",
      "BAD_REQUEST",
    );
  return snapshot;
}
type Snapshot = Awaited<ReturnType<typeof sourceSnapshot>>;
function proposals(s: Snapshot) {
  return s.controls.map((control) => {
    const existing = s.cases
      .filter((c) =>
        c.complianceControls.some((m) => m.controlId === control.id),
      )
      .map((c) => c.id);
    const matches = s.cases
      .filter((c) => !existing.includes(c.id))
      .map((c) => ({
        caseId: c.id,
        title: c.title,
        ...explainComplianceMatch(control, {
          title: c.title,
          body: JSON.stringify([
            c.background,
            c.given,
            c.when,
            c.then,
            c.tags,
            c.steps,
            c.sharedStepGroup?.steps,
          ]),
        }),
      }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || a.caseId.localeCompare(b.caseId))
      .slice(0, 5);
    return {
      controlId: control.id,
      code: control.code,
      title: control.title,
      description: control.description,
      existing,
      matches,
      kind: existing.length
        ? "EXISTING"
        : matches.length
          ? "UNCERTAIN"
          : s.scope.omitted
            ? "INCOMPLETE_SCAN"
            : "MISSING_CHECK_PROPOSAL",
      outline: {
        title: `Review ${control.title}`,
        customFields: {} as CaseFieldValues,
        prerequisite:
          "Confirm the applicable use, jurisdiction, authoritative criteria and permitted evidence with the responsible reviewer.",
        action: `Evaluate ${control.title.toLowerCase()}. ${control.description ?? "Record the reviewed requirement and procedure."}`,
        expectedResult:
          "Compare actual evidence or observed behavior with the reviewed criteria. Record unresolved applicability, missing permission or evidence for review; do not infer a pass.",
      },
    };
  });
}
const receiptSchema = z.object({
  requestId: z.string(),
  draftId: z.string(),
  reviewedDigest: z.string(),
  sourceDigest: z.string(),
  createdIds: z.array(z.string()),
  mappedCount: z.number(),
  ordinaryCaseApproval: z.literal("PENDING_REVIEW"),
  legalClearance: z.literal(false),
});
const view = (draft: {
  id: string;
  digest: string;
  state: string;
  snapshot: Prisma.JsonValue;
  selection: Prisma.JsonValue;
  receipt: Prisma.JsonValue | null;
  authorityGeneration: number;
}) => {
  const s = draft.snapshot as unknown as Snapshot;
  return {
    id: draft.id,
    digest: draft.digest,
    state: draft.state,
    authorityGeneration: draft.authorityGeneration,
    scope: s.scope,
    fields: s.fields,
    proposals: proposals(s),
    cases: s.cases.map((c) => ({
      id: c.id,
      title: c.title,
      given: c.given,
      when: c.when,
      then: c.then,
      steps: c.steps,
      sharedSteps: c.sharedStepGroup
        ? JSON.stringify(c.sharedStepGroup.steps)
        : null,
      reviewStatus: c.reviewStatus,
    })),
    selection: complianceSelection.parse(draft.selection),
    receipt: draft.receipt ? receiptSchema.parse(draft.receipt) : null,
  };
};
async function ownedDraft(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof complianceDraftInput>,
) {
  await authorize(tx, actor, input);
  const d = await tx.complianceReviewDraft.findUnique({
    where: { id: input.draftId },
  });
  if (
    !d ||
    d.projectId !== input.projectId ||
    d.organizationId !== input.originalOrganizationId ||
    d.actorId !== actor.id ||
    d.clerkActorId !== actor.clerkActorId ||
    d.revokedAt
  )
    throw fail(
      "This review is unavailable or its authority changed. Start a fresh review.",
      "FORBIDDEN",
    );
  return d;
}
export async function previewCompliance(
  db: PrismaClient,
  actor: Actor,
  input: z.infer<typeof compliancePreview>,
) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, input);
    const requestHash = complianceHash({ actor, input });
    const prior = await tx.complianceReviewDraft.findUnique({
      where: { id: input.requestId },
    });
    if (prior) {
      const d = await ownedDraft(tx, actor, { ...input, draftId: prior.id });
      if (d.requestHash !== requestHash)
        throw fail("Request ID belongs to a different analysis.");
      return view(d);
    }
    const snapshot = await sourceSnapshot(tx, input, input.frameworkIds),
      sourceDigest = complianceHash(snapshot);
    const digest = complianceHash({
      sourceDigest,
      actor,
      projectId: input.projectId,
      selection: [],
      authorityGeneration: 0,
    });
    const d = await tx.complianceReviewDraft.create({
      data: {
        id: input.requestId,
        projectId: input.projectId,
        organizationId: input.originalOrganizationId,
        actorId: actor.id,
        clerkActorId: actor.clerkActorId,
        requestHash,
        sourceDigest,
        snapshot: json(snapshot),
        selection: [],
        digest,
      },
    });
    await audit(
      tx,
      actor.id,
      input,
      d.id,
      "Prepared compliance mapping review; no cases changed",
      { sourceDigest, scope: snapshot.scope },
    );
    return view(d);
  }, options);
}
export async function readComplianceDraft(
  db: PrismaClient,
  actor: Actor,
  input: z.infer<typeof complianceDraftInput>,
) {
  return db.$transaction(
    async (tx) => view(await ownedDraft(tx, actor, input)),
    options,
  );
}
export async function listComplianceDrafts(
  db: PrismaClient,
  actor: Actor,
  scope: Scope,
) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor, scope);
    return tx.complianceReviewDraft.findMany({
      where: {
        projectId: scope.projectId,
        organizationId: scope.originalOrganizationId,
        actorId: actor.id,
        clerkActorId: actor.clerkActorId,
        revokedAt: null,
      },
      select: { id: true, state: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }, options);
}
function validateSelection(
  s: Snapshot,
  selection: z.infer<typeof complianceSelection>,
) {
  if (new Set(selection.map((r) => r.controlId)).size !== selection.length)
    throw fail("Duplicate selected control.", "BAD_REQUEST");
  for (const row of selection) {
    if (
      !s.controls.some((c) => c.id === row.controlId) ||
      new Set(row.caseIds).size !== row.caseIds.length ||
      row.caseIds.some((id) => !s.cases.some((c) => c.id === id))
    )
      throw fail("Selection is outside the reviewed source.", "BAD_REQUEST");
    if (row.newCase && s.scope.omitted)
      throw fail(
        "Finish the candidate scan before proposing missing cases.",
        "BAD_REQUEST",
      );
  }
}
export async function saveComplianceSelection(
  db: PrismaClient,
  actor: Actor,
  input: z.infer<typeof complianceSave>,
) {
  return db.$transaction(async (tx) => {
    const d = await ownedDraft(tx, actor, input);
    if (d.state !== "DRAFT") throw fail("This review was already applied.");
    const digest = complianceHash({
      sourceDigest: d.sourceDigest,
      actor,
      projectId: d.projectId,
      selection: input.selection,
      authorityGeneration: d.authorityGeneration,
    });
    if (d.digest === digest) return view(d); // exact lost-response reconciliation
    if (d.digest !== input.expectedDigest)
      throw fail("Review changed. Reload its saved selection.");
    validateSelection(d.snapshot as unknown as Snapshot, input.selection);
    const saved = await tx.complianceReviewDraft.update({
      where: { id: d.id },
      data: { selection: json(input.selection), digest },
    });
    await audit(
      tx,
      actor.id,
      input,
      d.id,
      "Saved compliance selection for review",
      { digest },
    );
    return view(saved);
  }, options);
}
export async function applyComplianceReview(
  db: PrismaClient,
  actor: Actor,
  input: z.infer<typeof complianceApply>,
) {
  return db.$transaction(async (tx) => {
    const d = await ownedDraft(tx, actor, input),
      applyHash = complianceHash(input);
    if (d.state === "APPLIED") {
      if (d.applyRequestId !== input.requestId || d.applyHash !== applyHash)
        throw fail(
          "Already applied. Read the recorded outcome; do not submit a new request.",
        );
      return view(d);
    }
    if (d.digest !== input.expectedDigest)
      throw fail("Review changed. Reload before applying.");
    const s = d.snapshot as unknown as Snapshot;
    const current = await sourceSnapshot(
      tx,
      input,
      s.frameworks.map((f) => f.id),
    );
    if (complianceHash(current) !== d.sourceDigest)
      throw fail(
        "Controls, candidate cases or mappings changed. Start a fresh review.",
      );
    const selection = complianceSelection.parse(d.selection);
    validateSelection(s, selection);
    if (!selection.some((r) => r.caseIds.length || r.newCase))
      throw fail(
        "Select at least one mapping or proposed case.",
        "BAD_REQUEST",
      );
    const createdIds: string[] = [];
    let mappedCount = 0;
    for (const row of selection) {
      const caseIds = [...row.caseIds];
      if (row.newCase) {
        const n = row.newCase;
        const fieldState = await readCaseFieldState(
          tx,
          actor.id,
          input.projectId,
          undefined,
          actor.clerkActorId,
        );
        const customFields = await assertCaseFieldAuthoring(
          tx,
          actor.id,
          input.projectId,
          {
            values: n.customFields ?? {},
            expectedSchemaHash: fieldState.expectedSchemaHash,
          },
          { clerkActorId: actor.clerkActorId },
        );
        const created = await tx.testCase.create({
          data: {
            projectId: input.projectId,
            title: n.title,
            customFields: json(customFields),
            background: n.prerequisite,
            given: [n.prerequisite],
            when: [n.action],
            then: [n.expectedResult],
            tags: ["compliance-review"],
            testType: "COMPLIANCE",
            origin: "AUTHORED",
            reviewStatus: "PENDING_REVIEW",
            createdById: actor.id,
            steps: {
              create: {
                order: 0,
                action: n.action,
                expectedResult: n.expectedResult,
              },
            },
          },
          include: { steps: true },
        });
        await snapshotTestCaseVersion(tx, {
          ...created,
          actorId: actor.id,
          testCaseId: created.id,
        });
        createdIds.push(created.id);
        caseIds.push(created.id);
      }
      for (const caseId of caseIds) {
        mappedCount += (
          await tx.testCaseComplianceControl.createMany({
            data: [{ testCaseId: caseId, controlId: row.controlId }],
            skipDuplicates: true,
          })
        ).count;
      }
    }
    const receipt = {
      requestId: input.requestId,
      draftId: d.id,
      reviewedDigest: d.digest,
      sourceDigest: d.sourceDigest,
      createdIds,
      mappedCount,
      ordinaryCaseApproval: "PENDING_REVIEW",
      legalClearance: false,
    };
    const saved = await tx.complianceReviewDraft.update({
      where: { id: d.id },
      data: {
        state: "APPLIED",
        applyRequestId: input.requestId,
        applyHash,
        receipt: json(receipt),
      },
    });
    await audit(
      tx,
      actor.id,
      input,
      d.id,
      "Applied reviewed compliance mappings and pending-review case proposals",
      receipt,
    );
    return view(saved);
  }, options);
}
