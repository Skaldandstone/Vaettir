import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { resolveStepFieldLabels } from "@vaettir/core";
import {
  boundedRunSnapshot,
  qualityProfileHash,
  readQualityExperience,
  readRunExperienceSnapshot,
  runCaseDefinitionSchema,
  runConfigurationSchema,
} from "./qualityExperienceProfile.js";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";
import { verificationProfileSchema } from "./physicalValidation.js";

const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_DATASET_BYTES = 256 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const datasetPreviewInputSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    testCaseId: z.string().min(1).max(200),
    executionContext: runConfigurationSchema,
  })
  .strict();
export const datasetStartInputSchema = datasetPreviewInputSchema.extend({
  expectedExpansionHash: hash,
  idempotencyKey: z.string().uuid(),
});
const parameter = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (value) =>
      value.trim() === value &&
      !/[<>]/.test(value) &&
      !["__proto__", "prototype", "constructor"].includes(value),
    "Use a distinct, non-reserved parameter name without angle brackets",
  );
export const executionDatasetSchema = z
  .object({
    parameterNames: z.array(parameter).min(1).max(50),
    rows: z
      .array(
        z
          .object({
            name: z.string().min(1).max(200),
            values: z.record(z.string().max(10000)),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.parameterNames).size !== value.parameterNames.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dataset parameter names must be unique",
      });
    value.rows.forEach((row, index) => {
      if (
        Object.keys(row.values).length !== value.parameterNames.length ||
        value.parameterNames.some((name) => !Object.hasOwn(row.values, name))
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Row ${index + 1} must supply exactly the declared parameters`,
          path: ["rows", index, "values"],
        });
    });
  });

function boundedDataset(value: unknown) {
  // The database JSON is not a trusted size promise. Fail before serializing
  // a large legacy dataset and never silently drop rows or values.
  const pending = [value];
  let bytes = 0;
  while (pending.length && bytes <= MAX_DATASET_BYTES) {
    const entry = pending.pop();
    if (typeof entry === "string") bytes += Buffer.byteLength(entry) + 2;
    else if (Array.isArray(entry)) {
      if (entry.length > 50)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Dataset execution supports at most 50 rows and 50 parameters per reviewed batch.",
        });
      bytes += entry.length + 2;
      pending.push(...entry);
    } else if (entry && typeof entry === "object") {
      const entries = Object.entries(entry);
      if (entries.length > 50)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Dataset execution supports at most 50 parameters per row.",
        });
      for (const [key, child] of entries) {
        bytes += Buffer.byteLength(key) + 4;
        pending.push(child);
      }
    } else bytes += 5;
  }
  if (bytes > MAX_DATASET_BYTES)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Dataset exceeds the 256 KiB execution limit. Reduce its saved scope before reviewing.",
    });
  const parsed = executionDatasetSchema.safeParse(value);
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Dataset needs repair before execution: ${parsed.error.issues[0]?.message ?? "invalid rows"}. Nothing was started.`,
    });
  return parsed.data;
}

/** Single-pass, own-property-only resolution; this never evaluates imported text. */
export function resolveDatasetText(
  text: string,
  values: Record<string, string>,
  location: string,
) {
  const resolved = text.replace(/<([^<>]+)>/g, (_match, name: string) => {
    const key = name.trim();
    if (!Object.hasOwn(values, key))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Missing dataset parameter <${key}> in ${location}. Nothing was started.`,
      });
    return values[key]!;
  });
  if (/<[^<>]+>/.test(resolved))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unresolved placeholder in ${location}. Parameter values must be concrete text; nothing was started.`,
    });
  return resolved;
}

export function resolveDatasetProcedure(
  definition: z.infer<typeof runCaseDefinitionSchema>,
  values: Record<string, string>,
) {
  const resolve = (text: string) =>
    resolveDatasetText(text, values, definition.title);
  const nullable = (text: string | null) =>
    text === null ? null : resolve(text);
  return checkedProcedure(
    {
      ...definition,
      title: resolve(definition.title),
      background: nullable(definition.background),
      given: definition.given.map(resolve),
      when: definition.when.map(resolve),
      then: definition.then.map(resolve),
      verificationProfile: Object.fromEntries(
        Object.entries(definition.verificationProfile).map(([key, text]) => [
          key,
          resolve(text),
        ]),
      ),
      steps: definition.steps.map((step) => ({
        ...step,
        action: resolve(step.action),
        expectedActionOrData: nullable(step.expectedActionOrData),
        expectedResult: nullable(step.expectedResult),
        expectedResponse: nullable(step.expectedResponse),
      })),
    },
    "Resolved",
  );
}

function checkedProcedure(value: unknown, phase: string) {
  const parsed = runCaseDefinitionSchema.safeParse(value);
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${phase} procedure is invalid or exceeds a per-field limit. Review ${parsed.error.issues[0]?.path.join(".") || "the case"}; nothing was started.`,
    });
  return parsed.data;
}

export async function prepareDatasetExecution(
  db: Prisma.TransactionClient,
  actorId: string,
  input: z.infer<typeof datasetPreviewInputSchema>,
  lockSources = false,
) {
  await requireCurrentPlanAccess(db, actorId, input.projectId, true);
  const [datasetIdentity, links] = await Promise.all([
    db.testCaseDataset.findFirst({
      where: {
        testCaseId: input.testCaseId,
        testCase: { projectId: input.projectId, archived: false },
      },
      select: { id: true },
    }),
    db.testCasePrerequisite.findMany({
      where: { projectId: input.projectId },
      select: { dependentId: true, prerequisiteId: true },
      take: 10001,
    }),
  ]);
  if (!datasetIdentity)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No saved dataset is available for this project case.",
    });
  if (lockSources)
    await db.$queryRaw`SELECT id FROM "TestCase" WHERE id=${input.testCaseId} AND "projectId"=${input.projectId} FOR UPDATE`;
  if (lockSources)
    await db.$queryRaw`SELECT id FROM "TestCaseDataset" WHERE id=${datasetIdentity.id} FOR SHARE`;
  const [datasetSize] = await db.$queryRaw<
    Array<{ bytes: bigint; rowCount: number; parameterCount: number }>
  >`
    SELECT (octet_length(d.rows::text)+octet_length(d."parameterNames"::text))::bigint AS bytes,
      CASE WHEN jsonb_typeof(d.rows)='array' THEN jsonb_array_length(d.rows) ELSE 51 END AS "rowCount",
      cardinality(d."parameterNames") AS "parameterCount"
    FROM "TestCaseDataset" d JOIN "TestCase" c ON c.id=d."testCaseId"
    WHERE d.id=${datasetIdentity.id} AND c."projectId"=${input.projectId}`;
  if (
    !datasetSize ||
    datasetSize.rowCount > 50 ||
    datasetSize.parameterCount > 50
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Dataset execution supports at most 50 rows and 50 parameters per reviewed batch.",
    });
  if (datasetSize.bytes > BigInt(MAX_DATASET_BYTES))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Dataset exceeds the 256 KiB execution limit. Reduce its saved scope before reviewing.",
    });
  const [profileSize] = await db.$queryRaw<Array<{ bytes: bigint }>>`
    SELECT (octet_length(p."qualityProfile"::text)+coalesce(octet_length(o."stepFieldLabels"::text),0))::bigint AS bytes
    FROM "Project" p JOIN "Organization" o ON o.id=p."organizationId" WHERE p.id=${input.projectId}`;
  if (!profileSize || profileSize.bytes > BigInt(MAX_DATASET_BYTES))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Saved project context exceeds the 256 KiB execution limit. Nothing was started.",
    });
  const [project, dataset] = await Promise.all([
    db.project.findUniqueOrThrow({
      where: { id: input.projectId },
      select: {
        qualityProfile: true,
        organization: { select: { stepFieldLabels: true } },
      },
    }),
    db.testCaseDataset.findUniqueOrThrow({ where: { id: datasetIdentity.id } }),
  ]);
  if (links.length > 10000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Project has too many prerequisite links to expand safely.",
    });
  const saved = boundedDataset({
    parameterNames: dataset.parameterNames,
    rows: dataset.rows,
  });
  const graph = new Map<string, string[]>();
  for (const link of links)
    graph.set(link.dependentId, [
      ...(graph.get(link.dependentId) ?? []),
      link.prerequisiteId,
    ]);
  for (const ids of graph.values()) ids.sort();
  // A dataset row runs in its own session, including its prerequisite closure.
  const ordered: string[] = [],
    visiting = new Set<string>(),
    visited = new Set<string>();
  const stack = [{ id: input.testCaseId, next: 0 }];
  while (stack.length) {
    const current = stack[stack.length - 1]!;
    visiting.add(current.id);
    const next = (graph.get(current.id) ?? [])[current.next++];
    if (next) {
      if (visiting.has(next))
        throw new TRPCError({
          code: "CONFLICT",
          message: "Prerequisites contain a cycle. Nothing was started.",
        });
      if (!visited.has(next)) stack.push({ id: next, next: 0 });
      if (visited.size + stack.length > 500)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Expanded execution exceeds 500 planned case instances.",
        });
    } else {
      stack.pop();
      visiting.delete(current.id);
      visited.add(current.id);
      ordered.push(current.id);
    }
  }
  if (ordered.length * saved.rows.length > 500)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Expanded execution exceeds 500 planned case instances. Reduce rows or prerequisite scope.",
    });
  if (lockSources)
    await db.$queryRaw`SELECT id FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(ordered)}) ORDER BY id FOR UPDATE`;
  const identities = await db.testCase.findMany({
    where: { projectId: input.projectId, id: { in: ordered }, archived: false },
    select: {
      id: true,
      sharedStepGroupId: true,
      dataset: { select: { id: true } },
    },
  });
  if (identities.length !== ordered.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A selected case or prerequisite is missing, archived, or outside this project.",
    });
  const groupIds = [
    ...new Set(
      identities.flatMap((c) =>
        c.sharedStepGroupId ? [c.sharedStepGroupId] : [],
      ),
    ),
  ];
  const groupIdentities = groupIds.length
    ? await db.sharedStepGroup.findMany({
        where: { id: { in: groupIds }, projectId: input.projectId },
        select: { id: true },
      })
    : [];
  if (groupIdentities.length !== groupIds.length)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "A shared procedure does not belong to this project. No foreign procedure was read.",
    });
  if (identities.some((c) => c.id !== input.testCaseId && c.dataset))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A prerequisite has its own dataset. Explicit row pairing is not supported yet; no configuration was guessed and nothing was started.",
    });
  if (lockSources) {
    await db.$queryRaw`SELECT s.id FROM "TestCaseStep" s JOIN "TestCase" c ON c.id=s."testCaseId" WHERE c."projectId"=${input.projectId} AND c.id IN (${Prisma.join(ordered)}) ORDER BY s.id FOR SHARE OF s`;
    if (groupIds.length)
      await db.$queryRaw`SELECT id FROM "SharedStepGroup" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(groupIds)}) ORDER BY id FOR SHARE`;
  }
  const sizes = await db.$queryRaw<
    Array<{ bytes: bigint; stepCount: number; bddCount: number }>
  >`
    SELECT (octet_length(concat(c.title,c.background,c.given::text,c."when"::text,c."then"::text,c."verificationProfile"::text))
      + coalesce((SELECT sum(octet_length(concat(s.action,s."expectedActionOrData",s."expectedResult",s."expectedResponse",s."mediaAttachmentIds"::text))) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0)
      + coalesce((SELECT octet_length(g.steps::text) FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId" AND g."projectId"=c."projectId"),0))::bigint AS bytes,
      CASE WHEN c."sharedStepGroupId" IS NULL THEN (SELECT count(*)::int FROM "TestCaseStep" s WHERE s."testCaseId"=c.id)
        ELSE coalesce((SELECT CASE WHEN jsonb_typeof(g.steps)='array' THEN jsonb_array_length(g.steps) ELSE 501 END FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId" AND g."projectId"=c."projectId"),501) END AS "stepCount",
      greatest(cardinality(c.given),cardinality(c."when"),cardinality(c."then")) AS "bddCount"
    FROM "TestCase" c WHERE c."projectId"=${input.projectId} AND c.id IN (${Prisma.join(ordered)})`;
  if (
    sizes.length !== ordered.length ||
    sizes.some((size) => size.stepCount > 500 || size.bddCount > 500) ||
    sizes.reduce((sum, size) => sum + size.bytes, 0n) > 2n * 1024n * 1024n
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Saved procedures exceed the 2 MiB source or 500-step/phase limit. Nothing was read into an execution or started.",
    });
  const cases = await db.testCase.findMany({
    where: { projectId: input.projectId, id: { in: ordered }, archived: false },
    select: {
      id: true,
      displayId: true,
      title: true,
      validationDomain: true,
      reviewStatus: true,
      background: true,
      given: true,
      when: true,
      then: true,
      verificationProfile: true,
      steps: {
        orderBy: { order: "asc" },
        select: {
          order: true,
          action: true,
          expectedActionOrData: true,
          expectedResult: true,
          expectedResponse: true,
          mediaAttachmentIds: true,
        },
      },
      sharedStepGroup: { select: { projectId: true, steps: true } },
      dataset: { select: { id: true } },
    },
  });
  if (cases.length !== ordered.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A selected case or prerequisite is missing, archived, or outside this project.",
    });
  const byId = new Map(cases.map((c) => [c.id, c]));
  const definitions = ordered.map((id) => {
    const c = byId.get(id)!;
    if (c.sharedStepGroup && c.sharedStepGroup.projectId !== input.projectId)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "A shared procedure belongs to another project.",
      });
    if (id !== input.testCaseId && c.dataset)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "A prerequisite has its own dataset. Explicit row pairing is not supported yet; no configuration was guessed and nothing was started.",
      });
    const verification = verificationProfileSchema.safeParse(
      c.verificationProfile,
    );
    if (!verification.success)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Saved procedure metadata is unsupported or oversized. Review the case; nothing was started.",
      });
    return checkedProcedure(
      {
        testCaseId: c.id,
        title: c.title,
        validationDomain: c.validationDomain,
        reviewStatus: c.reviewStatus,
        background: c.background,
        given: c.given,
        when: c.when,
        then: c.then,
        verificationProfile: verification.data,
        steps: c.sharedStepGroup ? c.sharedStepGroup.steps : c.steps,
      },
      "Saved",
    );
  });
  const configuration = runConfigurationSchema.parse(input.executionContext);
  const experience = readQualityExperience(project.qualityProfile);
  const prerequisites = Object.fromEntries(
    ordered.map((id) => [id, graph.get(id) ?? []]),
  );
  const datasetHash = qualityProfileHash({
    id: dataset.id,
    updatedAt: dataset.updatedAt.toISOString(),
    ...saved,
  });
  const configurationHash = qualityProfileHash(configuration);
  let expandedBytes = 0;
  let frozenBytes = 0;
  const rows = saved.rows.map((row, rowIndex) => {
    const expanded = {
      rowIndex,
      rowName: row.name,
      values: row.values,
      snapshot: boundedRunSnapshot({
        version: 1,
        ...experience,
        configuration,
        stepFieldLabels: resolveStepFieldLabels(
          (project.organization.stepFieldLabels ?? {}) as never,
        ),
        caseDefinitions: definitions.map((definition) =>
          resolveDatasetProcedure(definition, row.values),
        ),
      }),
    };
    expandedBytes += Buffer.byteLength(JSON.stringify(expanded)) + 1;
    // Fingerprints/actor-bound batch IDs have fixed lengths. Check the exact
    // final metadata shape during preview, before approval or any writes.
    const placeholderHash = "0".repeat(64);
    const stored = boundedRunSnapshot({
      ...expanded.snapshot,
      startRequestHash: placeholderHash,
      datasetExecution: {
        version: 1,
        batchId: `dataset_${placeholderHash}`,
        expansionHash: placeholderHash,
        datasetId: dataset.id,
        datasetHash,
        testCaseId: input.testCaseId,
        sourceDisplayId: byId.get(input.testCaseId)!.displayId,
        rowIndex,
        rowName: row.name,
        values: row.values,
        configurationHash,
        rowCount: saved.rows.length,
      },
    });
    frozenBytes += Buffer.byteLength(JSON.stringify(stored));
    if (expandedBytes + 2 > MAX_BATCH_BYTES || frozenBytes > MAX_BATCH_BYTES)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Resolved procedures exceed the 4 MiB batch limit. Nothing was started.",
      });
    return expanded;
  });
  const expansionHash = qualityProfileHash({
    projectId: input.projectId,
    testCaseId: input.testCaseId,
    datasetHash,
    prerequisites,
    rows,
  });
  return {
    projectId: input.projectId,
    testCaseId: input.testCaseId,
    displayId: byId.get(input.testCaseId)!.displayId,
    datasetId: dataset.id,
    datasetHash,
    expansionHash,
    configurationHash,
    configuration,
    prerequisites,
    ordered,
    rows,
  };
}

export function datasetPreviewOutput(
  prepared: Awaited<ReturnType<typeof prepareDatasetExecution>>,
) {
  return {
    projectId: prepared.projectId,
    testCaseId: prepared.testCaseId,
    displayId: prepared.displayId,
    expansionHash: prepared.expansionHash,
    configuration: prepared.configuration,
    rowCount: prepared.rows.length,
    prerequisiteCount: prepared.ordered.length - 1,
    plannedCaseInstances: prepared.ordered.length * prepared.rows.length,
    credits: 0 as const,
    rows: prepared.rows.map((row) => ({
      rowIndex: row.rowIndex,
      rowName: row.rowName,
      values: row.values,
      caseDefinitions: row.snapshot.caseDefinitions,
    })),
  };
}

export async function startDatasetExecution(
  db: PrismaClient,
  actorId: string,
  input: z.infer<typeof datasetStartInputSchema>,
) {
  async function lockAuthority(tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${input.projectId} FOR UPDATE`;
    await tx.$queryRaw`SELECT o.id FROM "Organization" o JOIN "Project" p ON p."organizationId"=o.id WHERE p.id=${input.projectId} FOR SHARE OF o`;
    await tx.$queryRaw`SELECT m.id FROM "Membership" m JOIN "Project" p ON p."organizationId"=m."organizationId" WHERE p.id=${input.projectId} AND m."userId"=${actorId} FOR SHARE OF m`;
    await requireCurrentPlanAccess(tx, actorId, input.projectId, true);
  }
  const batchId = `dataset_${createHash("sha256")
    .update(JSON.stringify([input.projectId, actorId, input.idempotencyKey]))
    .digest("hex")}`;
  const requestHash = qualityProfileHash({
    projectId: input.projectId,
    testCaseId: input.testCaseId,
    executionContext: input.executionContext,
    expectedExpansionHash: input.expectedExpansionHash,
  });
  const runIds = Array.from(
    { length: 50 },
    (_, index) => `${batchId}_${index}`,
  );
  async function recover(tx: Prisma.TransactionClient) {
    const runs = await tx.testRun.findMany({
      where: { id: { in: runIds } },
      select: {
        id: true,
        projectId: true,
        startedById: true,
        executionContext: true,
      },
    });
    if (!runs.length) return null;
    const receipts = runs.map((run) => ({
      run,
      snapshot: readRunExperienceSnapshot(run.executionContext),
    }));
    const first = receipts[0]!.snapshot?.datasetExecution;
    if (
      !first ||
      runs.length !== first.rowCount ||
      receipts.some(
        ({ run, snapshot }) =>
          run.projectId !== input.projectId ||
          run.startedById !== actorId ||
          snapshot?.startRequestHash !== requestHash ||
          snapshot.datasetExecution?.batchId !== batchId ||
          snapshot.datasetExecution.expansionHash !==
            input.expectedExpansionHash ||
          snapshot.datasetExecution.rowCount !== first.rowCount,
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This batch-start key belongs to a different or incomplete request. Do not start duplicate executions; review its receipt.",
      });
    const sorted = receipts.sort(
      (a, b) =>
        a.snapshot!.datasetExecution!.rowIndex -
        b.snapshot!.datasetExecution!.rowIndex,
    );
    if (
      sorted.some(
        ({ run, snapshot }, index) =>
          run.id !== runIds[index] ||
          snapshot!.datasetExecution!.rowIndex !== index,
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Saved batch identities are inconsistent. Nothing was replaced.",
      });
    return {
      batchId,
      runs: sorted.map(({ run, snapshot }) => ({
        testRunId: run.id,
        rowIndex: snapshot!.datasetExecution!.rowIndex,
        rowName: snapshot!.datasetExecution!.rowName,
      })),
      recovered: true,
    };
  }
  const execute = () =>
    db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.projectId}))::text`;
        await lockAuthority(tx);
        const previous = await recover(tx);
        if (previous) return previous;
        const prepared = await prepareDatasetExecution(
          tx,
          actorId,
          input,
          true,
        );
        if (prepared.expansionHash !== input.expectedExpansionHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The dataset, procedure, prerequisites or project context changed. Refresh and review the expansion again; nothing was started.",
          });
        const runs = [];
        let storedBytes = 0;
        for (const row of prepared.rows) {
          const executionContext = boundedRunSnapshot({
            ...row.snapshot,
            startRequestHash: requestHash,
            datasetExecution: {
              version: 1,
              batchId,
              expansionHash: prepared.expansionHash,
              datasetId: prepared.datasetId,
              datasetHash: prepared.datasetHash,
              testCaseId: input.testCaseId,
              sourceDisplayId: prepared.displayId,
              rowIndex: row.rowIndex,
              rowName: row.rowName,
              values: row.values,
              configurationHash: prepared.configurationHash,
              rowCount: prepared.rows.length,
            },
          });
          storedBytes += Buffer.byteLength(JSON.stringify(executionContext));
          if (storedBytes > MAX_BATCH_BYTES)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Frozen row metadata exceeds the 4 MiB batch limit. Nothing was started.",
            });
          const run = await tx.testRun.create({
            data: {
              id: runIds[row.rowIndex],
              projectId: input.projectId,
              startedById: actorId,
              ciProvider: "manual",
              commitSha: "manual",
              branch: "manual",
              startedAt: new Date(),
              status: "RUNNING",
              manualTestCaseIds: prepared.ordered,
              manualPrerequisites: prepared.prerequisites,
              executionContext,
            },
            select: { id: true },
          });
          runs.push({
            testRunId: run.id,
            rowIndex: row.rowIndex,
            rowName: row.rowName,
          });
        }
        return { batchId, runs, recovered: false };
      },
      { timeout: 20000, isolationLevel: "RepeatableRead" },
    );
  try {
    return await execute();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(error.code)
    )
      return db.$transaction(async (tx) => {
        await lockAuthority(tx);
        const previous = await recover(tx);
        if (previous) return previous;
        throw error;
      });
    throw error;
  }
}
