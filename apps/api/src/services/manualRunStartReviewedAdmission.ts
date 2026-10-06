import { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";
import { testPlanExecutionTemplateSchema } from "./qualityExperienceProfile.js";
import type { ManualRunStartLegacyInput } from "./manualRunStartLegacySchema.js";

export const REVIEWED_START_BODY_BYTES = 2 * 1024 * 1024;
const id = z.string().min(1).max(200).refine(supportedManualExecutionIdentity);
const text = z.string().max(10000);
const step = z
  .object({
    order: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    action: text,
    expectedActionOrData: text.nullable().optional(),
    expectedResult: text.nullable().optional(),
    expectedResponse: text.nullable().optional(),
    mediaAttachmentIds: z.array(id).max(100).optional(),
  })
  .strict();
const verification = z
  .object({
    setup: text.optional(),
    safety: text.optional(),
    instruments: text.optional(),
    acceptanceCriteria: text.optional(),
  })
  .strict();
const selectedCase = z
  .object({
    id,
    title: text,
    validationDomain: z.enum([
      "SOFTWARE",
      "HARDWARE",
      "SYSTEM_INTEGRATION",
      "HIL",
      "MANUFACTURING",
      "MEDICAL_DEVICE",
      "PHARMA_LAB",
      "OTHER",
    ]),
    reviewStatus: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]),
    background: text.nullable(),
    given: z.array(text).max(500),
    when: z.array(text).max(500),
    then: z.array(text).max(500),
    verificationProfile: verification,
    steps: z.array(step).max(500),
    sharedStepGroup: z
      .object({ steps: z.array(step).max(500) })
      .strict()
      .nullable(),
    dataset: z.object({ id }).strict().nullable(),
  })
  .strict();
const selectedPlan = z
  .object({
    id,
    projectId: id,
    name: text,
    status: z.string().max(100),
    executionTemplate: z.record(z.unknown()),
  })
  .strict();
type Link = { dependentId: string; prerequisiteId: string };
const refused = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "The complete current run-start metadata cannot be admitted by the supported native codec. Nothing was clipped, repaired or started.",
  });

/** Exact native text is bounded BEFORE JSON.parse/canonical recursion. A native
 * equality probe subsequently detects unsupported JS numeric representation.
 * This is conservative refusal, not a lossless arbitrary-JSON codec. */
export function admitReviewedStartJson(textValue: unknown): {
  value: unknown;
  encoded: string;
} {
  if (
    typeof textValue !== "string" ||
    Buffer.byteLength(textValue, "utf8") > REVIEWED_START_BODY_BYTES
  )
    throw refused();
  let value: unknown;
  try {
    value = JSON.parse(textValue);
  } catch {
    throw refused();
  }
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const next = stack.pop()!;
    if (
      ++nodes > 100000 ||
      next.depth > 64 ||
      (typeof next.value === "number" && !Number.isFinite(next.value))
    )
      throw refused();
    if (next.value !== null && typeof next.value === "object") {
      for (const child of Object.values(next.value))
        stack.push({ value: child, depth: next.depth + 1 });
    }
  }
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > REVIEWED_START_BODY_BYTES)
    throw refused();
  return { value, encoded };
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw refused();
  return result.data;
}
function nativeValue<T>(schema: z.ZodType<T>, value: unknown): T {
  parse(schema, value);
  // Validation is not permission to replace the exact decoded native object.
  // z.record output may omit reserved own keys; preserve ALL raw siblings.
  return value as T;
}
function size(
  row: { count: bigint; bytes: bigint; invalid: boolean } | undefined,
  max: number,
  bytes = REVIEWED_START_BODY_BYTES,
) {
  if (
    !row ||
    typeof row.count !== "bigint" ||
    row.count < 0n ||
    row.count > BigInt(max) ||
    typeof row.bytes !== "bigint" ||
    row.bytes < 0n ||
    row.bytes > BigInt(bytes) ||
    row.invalid !== false
  )
    throw refused();
  return Number(row.count);
}

/** Already authorized under the original writer's held org/member/project/User
 * locks and TestRun SHARE lock. No profile/procedure/status body is necessary
 * for accepted-UUID recovery, and no JSON is projected or normalized here. */
export async function reviewedStartReceipt(
  tx: Prisma.TransactionClient,
  durableId: string,
  projectId: string,
  actorId: string,
  expectedHash: string,
) {
  const sizes = await tx.$queryRaw<
    Array<{ count: bigint; bytes: bigint; invalid: boolean }>
  >(Prisma.sql`
    /* reviewed-start-receipt-size */
    SELECT count(*)::bigint AS count,coalesce(sum(octet_length(concat(id,"projectId","startedById", "executionContext"->>'startRequestHash'))),0)::bigint AS bytes,
      coalesce(bool_or(length(id)>200 OR length("projectId")>200 OR "startedById" IS NULL OR length("startedById")>200
      OR jsonb_typeof("executionContext"->'startRequestHash') IS DISTINCT FROM 'string'
      OR NOT coalesce(("executionContext"->>'startRequestHash') ~ '^[a-f0-9]{64}$',false)),false) AS invalid
    FROM "TestRun" WHERE id=${durableId}`);
  if (sizes.length !== 1) throw refused();
  if (!size(sizes[0], 1, 2048)) return null;
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      projectId: string;
      startedById: string;
      startRequestHash: string;
    }>
  >(Prisma.sql`
    /* reviewed-start-receipt-scalars */
    SELECT id,"projectId","startedById","executionContext"->>'startRequestHash' AS "startRequestHash" FROM "TestRun" WHERE id=${durableId}`);
  if (rows.length !== 1) throw refused();
  const receipt = parse(
    z
      .object({
        id,
        projectId: id,
        startedById: id,
        startRequestHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    rows[0],
  );
  if (
    receipt.id !== durableId ||
    receipt.projectId !== projectId ||
    receipt.startedById !== actorId ||
    receipt.startRequestHash !== expectedHash
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This run-start key was used for a different request. Review the changed scope and start with a new key.",
    });
  return receipt.id;
}

function orderedScope(roots: string[], links: Link[]) {
  const graph = new Map<string, string[]>(),
    unique = new Set<string>();
  for (const link of links) {
    const key = JSON.stringify([link.dependentId, link.prerequisiteId]);
    if (unique.has(key) || link.dependentId === link.prerequisiteId)
      throw refused();
    unique.add(key);
    graph.set(link.dependentId, [
      ...(graph.get(link.dependentId) ?? []),
      link.prerequisiteId,
    ]);
  }
  const ordered: string[] = [],
    visited = new Set<string>(),
    visiting = new Set<string>();
  for (const root of roots) {
    if (visited.has(root)) continue;
    const stack = [{ id: root, index: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      visiting.add(frame.id);
      const next = (graph.get(frame.id) ?? [])[frame.index++];
      if (next) {
        if (visiting.has(next))
          throw new TRPCError({
            code: "CONFLICT",
            message: "Test case prerequisites contain a cycle.",
          });
        if (!visited.has(next)) stack.push({ id: next, index: 0 });
        if (visited.size + stack.length > 1000)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Run would include more than 1,000 cases with prerequisites. Split the reviewed scope into separate runs.",
          });
      } else {
        stack.pop();
        visiting.delete(frame.id);
        visited.add(frame.id);
        ordered.push(frame.id);
      }
      if (ordered.length > 1000) throw refused();
    }
  }
  return ordered;
}
function caseProjection() {
  return Prisma.sql`jsonb_build_object('id',c.id,'title',c.title,'validationDomain',c."validationDomain",'reviewStatus',c."reviewStatus",'background',c.background,
    'given',c.given,'when',c."when",'then',c."then",'verificationProfile',c."verificationProfile",
    'steps',coalesce((SELECT jsonb_agg(jsonb_build_object('order',s."order",'action',s.action,'expectedActionOrData',s."expectedActionOrData",'expectedResult',s."expectedResult",'expectedResponse',s."expectedResponse",'mediaAttachmentIds',s."mediaAttachmentIds") ORDER BY s."order") FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),'[]'::jsonb),
    'sharedStepGroup',CASE WHEN c."sharedStepGroupId" IS NULL THEN NULL ELSE jsonb_build_object('steps',g.steps) END,
    'dataset',CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('id',d.id) END)`;
}

/** Call ONLY after original locked write authorization, prerequisite advisory
 * lock and exact prior receipt. Multi-query admission is within the SAME fixed
 * RR transaction; it does not prove latest-native/all-writer serialization.
 * Known missing verification/step fields retain the LEGACY_SUPPORTED
 * interpretation ({} -> empty descriptors, omitted optional step values ->
 * NULL/[]). That is explicitly NOT a raw representation snapshot. Unknown
 * verification/step fields and authored template normalization refuse. */
export async function admitReviewedRunStart(
  tx: Prisma.TransactionClient,
  input: ManualRunStartLegacyInput,
) {
  parse(
    z.object({ projectId: id, testCaseIds: z.array(id).min(1).max(1000) }),
    input,
  );
  if (new Set(input.testCaseIds).size !== input.testCaseIds.length)
    throw refused();
  const graphSizes = await tx.$queryRaw<
    Array<{ count: bigint; bytes: bigint; invalid: boolean }>
  >(Prisma.sql`
    /* reviewed-start-graph-size */
    SELECT count(*)::bigint AS count,coalesce(sum(octet_length(jsonb_build_object('dependentId',p."dependentId",'prerequisiteId',p."prerequisiteId")::text)),0)::bigint AS bytes,
      coalesce(bool_or(length(p."dependentId")>200 OR length(p."prerequisiteId")>200 OR p."dependentId"=p."prerequisiteId" OR dep.id IS NULL OR req.id IS NULL),false) AS invalid
    FROM "TestCasePrerequisite" p LEFT JOIN "TestCase" dep ON dep.id=p."dependentId" AND dep."projectId"=p."projectId"
    LEFT JOIN "TestCase" req ON req.id=p."prerequisiteId" AND req."projectId"=p."projectId" WHERE p."projectId"=${input.projectId}`);
  if (graphSizes.length !== 1) throw refused();
  const graphCount = size(graphSizes[0], 10000);
  const links = graphCount
    ? await tx.testCasePrerequisite.findMany({
        where: { projectId: input.projectId },
        select: { dependentId: true, prerequisiteId: true },
      })
    : [];
  if (links.length !== graphCount) throw refused();
  parse(
    z
      .array(z.object({ dependentId: id, prerequisiteId: id }).strict())
      .max(10000),
    links,
  );
  const ordered = orderedScope(input.testCaseIds, links);
  const projection = caseProjection(),
    ids = Prisma.join(ordered);
  const cohortSizes = await tx.$queryRaw<
    Array<{ count: bigint; bytes: bigint; invalid: boolean }>
  >(Prisma.sql`
    /* reviewed-start-cases-size */
    SELECT count(*)::bigint AS count,coalesce(sum(octet_length((${projection})::text)),0)::bigint AS bytes,
      coalesce(bool_or((c."sharedStepGroupId" IS NOT NULL AND (g.id IS NULL OR g."projectId"<>c."projectId" OR g."archivedAt" IS NOT NULL))
      OR jsonb_typeof(c."verificationProfile") IS DISTINCT FROM 'object'
      OR cardinality(c.given)>500 OR cardinality(c."when")>500 OR cardinality(c."then")>500
      OR (SELECT count(*) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id)>500
      OR (c."sharedStepGroupId" IS NOT NULL AND (jsonb_typeof(g.steps) IS DISTINCT FROM 'array' OR CASE WHEN jsonb_typeof(g.steps)='array' THEN jsonb_array_length(g.steps)>500 ELSE true END))),false) AS invalid
    FROM "TestCase" c LEFT JOIN "SharedStepGroup" g ON g.id=c."sharedStepGroupId" LEFT JOIN "TestCaseDataset" d ON d."testCaseId"=c.id
    WHERE c.id IN (${ids}) AND c."projectId"=${input.projectId} AND c.archived=false`);
  if (cohortSizes.length !== 1) throw refused();
  const cohortCount = size(cohortSizes[0], 1000);
  if (cohortCount !== ordered.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A selected case or prerequisite is missing, archived, or outside this project.",
    });
  const projectSizes = await tx.$queryRaw<
    Array<{ count: bigint; bytes: bigint; invalid: boolean }>
  >(Prisma.sql`
    /* reviewed-start-project-size */
    SELECT count(*)::bigint AS count,coalesce(sum(octet_length(jsonb_build_object('qualityProfile',p."qualityProfile",'stepFieldLabels',o."stepFieldLabels")::text)),0)::bigint AS bytes,
      coalesce(bool_or(jsonb_typeof(p."qualityProfile") IS DISTINCT FROM 'object' OR o.id IS NULL),false) AS invalid
    FROM "Project" p LEFT JOIN "Organization" o ON o.id=p."organizationId" WHERE p.id=${input.projectId}`);
  if (projectSizes.length !== 1 || size(projectSizes[0], 1) !== 1)
    throw refused();
  let planBytes: bigint | null = null;
  if (input.planReference) {
    const planSizes = await tx.$queryRaw<
      Array<{ count: bigint; bytes: bigint; invalid: boolean }>
    >(Prisma.sql`
      /* reviewed-start-plan-size */
      SELECT count(*)::bigint AS count,coalesce(sum(octet_length(jsonb_build_object('id',id,'projectId',"projectId",'name',name,'status',status,'executionTemplate',"executionTemplate")::text)),0)::bigint AS bytes,
        coalesce(bool_or(jsonb_typeof("executionTemplate") IS DISTINCT FROM 'object'),false) AS invalid FROM "TestPlan" WHERE id=${input.planReference.testPlanId} AND "projectId"=${input.projectId}`);
    if (planSizes.length !== 1 || size(planSizes[0], 1) !== 1) throw refused();
    planBytes = planSizes[0]!.bytes;
  }
  // Every source cohort has passed scalar admission before ANY JSON body.
  const projectRows = await tx.$queryRaw<Array<{ body: string }>>(Prisma.sql`
    /* reviewed-start-project-body */ SELECT jsonb_build_object('qualityProfile',p."qualityProfile",'stepFieldLabels',o."stepFieldLabels")::text AS body
    FROM "Project" p JOIN "Organization" o ON o.id=p."organizationId" WHERE p.id=${input.projectId}`);
  if (projectRows.length !== 1) throw refused();
  if (
    typeof projectRows[0]?.body !== "string" ||
    BigInt(Buffer.byteLength(projectRows[0].body, "utf8")) !==
      projectSizes[0]!.bytes
  )
    throw refused();
  const projectJson = admitReviewedStartJson(projectRows[0]?.body);
  const projectExact = await tx.$queryRaw<Array<{ exact: boolean }>>(Prisma.sql`
    /* reviewed-start-project-exact */ SELECT jsonb_build_object('qualityProfile',p."qualityProfile",'stepFieldLabels',o."stepFieldLabels')=${projectJson.encoded}::jsonb AS exact
    FROM "Project" p JOIN "Organization" o ON o.id=p."organizationId" WHERE p.id=${input.projectId}`);
  if (projectExact.length !== 1 || projectExact[0]?.exact !== true)
    throw refused();
  const project = nativeValue(
    z
      .object({
        qualityProfile: z.record(z.unknown()),
        stepFieldLabels: z.record(z.string().max(200)).nullable(),
      })
      .strict(),
    projectJson.value,
  );
  let plan: z.infer<typeof selectedPlan> | null = null;
  if (input.planReference) {
    const rows = await tx.$queryRaw<Array<{ body: string }>>(Prisma.sql`
      /* reviewed-start-plan-body */ SELECT jsonb_build_object('id',id,'projectId',"projectId",'name',name,'status',status,'executionTemplate',"executionTemplate")::text AS body
      FROM "TestPlan" WHERE id=${input.planReference.testPlanId} AND "projectId"=${input.projectId}`);
    if (rows.length !== 1) throw refused();
    if (
      typeof rows[0]?.body !== "string" ||
      BigInt(Buffer.byteLength(rows[0].body, "utf8")) !== planBytes
    )
      throw refused();
    const json = admitReviewedStartJson(rows[0]?.body);
    const exact = await tx.$queryRaw<Array<{ exact: boolean }>>(Prisma.sql`
      /* reviewed-start-plan-exact */ SELECT jsonb_build_object('id',id,'projectId',"projectId",'name',name,'status',status,'executionTemplate',"executionTemplate")=${json.encoded}::jsonb AS exact
      FROM "TestPlan" WHERE id=${input.planReference.testPlanId} AND "projectId"=${input.projectId}`);
    if (exact.length !== 1 || exact[0]?.exact !== true) throw refused();
    plan = nativeValue(selectedPlan, json.value);
    if (
      plan.id !== input.planReference.testPlanId ||
      plan.projectId !== input.projectId
    )
      throw refused();
    if (Object.keys(plan.executionTemplate).length) {
      const interpreted = parse(
        testPlanExecutionTemplateSchema,
        plan.executionTemplate,
      );
      // Key order may differ, but no authored text/field/default may be lost.
      const normalized = await tx.$queryRaw<
        Array<{ exact: boolean }>
      >(Prisma.sql`
        /* reviewed-start-plan-interpretation */ SELECT "executionTemplate"=${JSON.stringify(interpreted)}::jsonb AS exact FROM "TestPlan" WHERE id=${plan.id} AND "projectId"=${input.projectId}`);
      if (normalized.length !== 1 || normalized[0]?.exact !== true)
        throw refused();
    }
  }
  const caseRows = await tx.$queryRaw<Array<{ body: string }>>(Prisma.sql`
    /* reviewed-start-cases-body */ SELECT (${projection})::text AS body FROM "TestCase" c LEFT JOIN "SharedStepGroup" g ON g.id=c."sharedStepGroupId"
    LEFT JOIN "TestCaseDataset" d ON d."testCaseId"=c.id WHERE c.id IN (${ids}) AND c."projectId"=${input.projectId} AND c.archived=false ORDER BY c.id`);
  if (caseRows.length !== cohortCount) throw refused();
  const cases: Array<z.infer<typeof selectedCase>> = [];
  const admittedCases: Array<{
    identity: string;
    value: unknown;
    encoded: string;
  }> = [];
  const seen = new Set<string>();
  let projectedBytes = 0;
  for (const row of caseRows) {
    if (typeof row.body !== "string") throw refused();
    projectedBytes += Buffer.byteLength(row.body, "utf8");
    if (projectedBytes > REVIEWED_START_BODY_BYTES) throw refused();
  }
  if (BigInt(projectedBytes) !== cohortSizes[0]!.bytes) throw refused();
  for (const row of caseRows) {
    const json = admitReviewedStartJson(row.body);
    // Admit only bounded scalar identity before using it in a scoped equality.
    const identity = parse(z.object({ id }).passthrough(), json.value).id;
    if (!ordered.includes(identity) || seen.has(identity)) throw refused();
    seen.add(identity);
    admittedCases.push({ identity, value: json.value, encoded: json.encoded });
  }
  // Bounded <=32 equality batches avoid a separate native round trip for every
  // case in a 1,000-case suite. This is not native performance acceptance.
  for (let offset = 0; offset < admittedCases.length; offset += 32) {
    const batch = admittedCases.slice(offset, offset + 32);
    const expected = Prisma.join(
      batch.map(
        (row) => Prisma.sql`(${row.identity}::text,${row.encoded}::jsonb)`,
      ),
    );
    const exact = await tx.$queryRaw<
      Array<{ count: bigint; exact: boolean }>
    >(Prisma.sql`
      /* reviewed-start-case-exact */ SELECT count(*)::bigint AS count,coalesce(bool_and((${projection})=e.body),false) AS exact
      FROM (VALUES ${expected}) e(id,body) JOIN "TestCase" c ON c.id=e.id AND c."projectId"=${input.projectId} AND c.archived=false
      LEFT JOIN "SharedStepGroup" g ON g.id=c."sharedStepGroupId" LEFT JOIN "TestCaseDataset" d ON d."testCaseId"=c.id`);
    if (
      exact.length !== 1 ||
      exact[0]?.count !== BigInt(batch.length) ||
      exact[0].exact !== true
    )
      throw refused();
  }
  for (const row of admittedCases) {
    const current = nativeValue(selectedCase, row.value);
    for (const steps of [current.steps, current.sharedStepGroup?.steps ?? []])
      if (new Set(steps.map((s) => s.order)).size !== steps.length)
        throw refused();
    cases.push(current);
  }
  // Literal known text is untouched. These missing fields are an explicit
  // legacy interpretation, NOT a fabricated raw/native snapshot guarantee.
  const interpretation =
    project.stepFieldLabels === null ||
    [
      "action",
      "expectedActionOrData",
      "expectedResult",
      "expectedResponse",
    ].some((key) => !Object.hasOwn(project.stepFieldLabels!, key)) ||
    cases.some(
      (c) =>
        Object.keys(c.verificationProfile).length !== 4 ||
        (c.sharedStepGroup?.steps ?? c.steps).some(
          (s) =>
            s.expectedActionOrData === undefined ||
            s.expectedResult === undefined ||
            s.expectedResponse === undefined ||
            s.mediaAttachmentIds === undefined,
        ),
    )
      ? ("LEGACY_SUPPORTED_MISSING_FIELD_INTERPRETATION" as const)
      : ("SUPPORTED_COMPLETE_DECLARED_FIELDS" as const);
  return {
    project: {
      qualityProfile: project.qualityProfile,
      organization: { stepFieldLabels: project.stepFieldLabels },
    },
    plan,
    links,
    cases,
    interpretation,
  };
}
