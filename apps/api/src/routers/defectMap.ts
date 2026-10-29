import { createHash } from "node:crypto";
import { z } from "@vaettir/core/dist/validation.js";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import {
  defectBatchSchema,
  defectDocumentSchema,
  emptyDefectDocument,
  previewDefectImport,
  buildDefectMap,
  defectClusterId,
  defectRecordKey,
  defectLinkEvidence,
  type DefectDocument,
} from "@vaettir/core";
import {
  protectedProcedure,
  requireProjectAccess,
  router,
  type Context,
} from "../trpc.js";
import { liveEditor } from "./jiraConnections.js";
import { jiraDefectSnapshot } from "./jiraIssueIntake.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const projectInput = z
  .object({ projectId: z.string().min(1).max(120) })
  .strict();
const batchInput = projectInput.extend({
  batch: defectBatchSchema,
  approveMetadataRead: z.literal(true),
});
const jiraInput = projectInput.extend({
  runId: z.string().min(1).max(120),
  runVersion: z.number().int().min(1),
  issueIds: z.array(z.string().regex(/^[1-9]\d{0,31}$/)).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
  approveMetadataRead: z.literal(true),
}).strict();
const jiraCommitInput = jiraInput.extend({
  version: z.number().int().min(0),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().uuid(),
  approveImport: z.literal(true),
});
const boundedBatch = batchInput.refine(
  (input) => Buffer.byteLength(JSON.stringify(input.batch)) <= 150_000,
  "Keep a batch below 150 KB",
);
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "This defect map changed. Refresh and review before writing.",
  });
function stored(value: unknown): DefectDocument {
  return value ? defectDocumentSchema.parse(value) : emptyDefectDocument();
}
function preview(
  document: DefectDocument,
  batch: z.infer<typeof defectBatchSchema>,
) {
  try {
    const result = previewDefectImport(document, batch);
    if (Buffer.byteLength(JSON.stringify(result.document)) > 500_000)
      throw new Error("Map limit reached. Keep this review below 500 KB");
    return result;
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        error instanceof Error && !(error instanceof z.ZodError)
          ? error.message
          : "The retained map reached its safe metadata limit.",
    });
  }
}

async function jiraBatch(tx:Prisma.TransactionClient,actorId:string,organizationId:string,input:z.infer<typeof jiraInput>){
  const snapshot=await jiraDefectSnapshot(tx,actorId,{...input,organizationId});
  const oversized=snapshot.issues.find(issue=>issue.title.trim().length>180);
  if(oversized)throw new TRPCError({code:"BAD_REQUEST",message:`${oversized.key} exceeds the defect map's 180-character title capacity. Deselect it to review the other summaries; no title was truncated.`});
  const site=digest(snapshot.site).slice(0,24);
  const scope=(projectId:string)=>`jira-site-${site}:${projectId}`;
  return defectBatchSchema.parse({
    sources:[...new Set(snapshot.issues.map(issue=>issue.projectId))].sort().map(projectId=>({provider:"jira",scope:scope(projectId),status:"available",observedAt:snapshot.observedAt})),
    signals:[],
    tasks:snapshot.issues.map(issue=>({provider:"jira",scope:scope(issue.projectId),externalId:issue.id,title:issue.title,url:issue.url,status:"unknown",observedAt:snapshot.observedAt})),
  });
}
const jiraPreviewHash=(version:number,input:z.infer<typeof jiraInput>,batch:z.infer<typeof defectBatchSchema>)=>digest(JSON.stringify([version,input.runId,input.runVersion,[...input.issueIds].sort(),batch]));

async function access<T>(
  ctx: Context & { user: NonNullable<Context["user"]> },
  projectId: string,
  write: boolean,
  action: (tx: Prisma.TransactionClient, organizationId: string) => Promise<T>,
) {
  const { project } = await requireProjectAccess(
    ctx,
    projectId,
    write ? "EDITOR" : "VIEWER",
  );
  return ctx.prisma.$transaction(async (tx) => {
    if (write) await liveEditor(tx, project.organizationId, ctx.user.id);
    else {
      const member = await tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: project.organizationId,
            userId: ctx.user.id,
          },
        },
      });
      const org = await tx.organization.findUnique({
        where: { id: project.organizationId },
        select: { suspendedAt: true },
      });
      if (!member || !org || org.suspendedAt)
        throw new TRPCError({ code: "FORBIDDEN" });
    }
    const projects = await tx.$queryRaw<
      Array<{ organizationId: string }>
    >`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
    if (projects[0]?.organizationId !== project.organizationId)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Project workspace changed. Refresh access.",
      });
    return action(tx, project.organizationId);
  });
}
async function state(
  tx: Prisma.TransactionClient,
  projectId: string,
  organizationId: string,
) {
  const row = await tx.defectMapState.findUnique({ where: { projectId } });
  if (row && row.organizationId !== organizationId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Retained map belongs to the previous workspace; review migration before access.",
    });
  return { version: row?.version ?? 0, document: stored(row?.document) };
}
async function save(
  tx: Prisma.TransactionClient,
  projectId: string,
  organizationId: string,
  document: DefectDocument,
  version: number,
  actorId: string,
  requestId: string,
  operation: string,
  requestHash: string,
) {
  const key = digest(JSON.stringify([projectId, actorId, requestId]));
  const previous = await tx.defectMapWrite.findUnique({ where: { key } });
  if (previous) {
    if (
      previous.requestHash !== requestHash ||
      previous.operation !== operation
    )
      throw conflict();
    return { appliedVersion: previous.appliedVersion, retried: true };
  }
  const current = await state(tx, projectId, organizationId);
  if (current.version !== version) throw conflict();
  if ((await tx.defectMapWrite.count({ where: { projectId } })) >= 2000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This bounded map reached its durable-write limit. Existing evidence is retained.",
    });
  if (Buffer.byteLength(JSON.stringify(document)) > 500_000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Map metadata limit exceeded",
    });
  const changed = JSON.stringify(current.document) !== JSON.stringify(document);
  const appliedVersion = version + (changed ? 1 : 0);
  await tx.defectMapState.upsert({
    where: { projectId },
    create: {
      projectId,
      organizationId,
      document: document as unknown as Prisma.InputJsonValue,
      version: appliedVersion,
    },
    update: changed
      ? {
          document: document as unknown as Prisma.InputJsonValue,
          version: appliedVersion,
        }
      : {},
  });
  await tx.defectMapWrite.create({
    data: { key, projectId, actorId, requestHash, operation, appliedVersion },
  });
  return { appliedVersion, retried: false };
}
async function retry(
  tx: Prisma.TransactionClient,
  projectId: string,
  actorId: string,
  requestId: string,
  operation: string,
  requestHash: string,
) {
  const previous = await tx.defectMapWrite.findUnique({
    where: { key: digest(JSON.stringify([projectId, actorId, requestId])) },
  });
  if (!previous) return null;
  if (previous.operation !== operation || previous.requestHash !== requestHash)
    throw conflict();
  return { appliedVersion: previous.appliedVersion, retried: true };
}

export const defectMapRouter = router({
  get: protectedProcedure.input(projectInput).query(({ ctx, input }) =>
    access(ctx, input.projectId, false, async (tx, orgId) => {
      const current = await state(tx, input.projectId, orgId);
      return {
        ...current,
        map: buildDefectMap(current.document, digest),
        capabilities: {
          ingestion: "reviewed_metadata_export_and_jira_snapshot" as const,
          liveSync: "unavailable" as const,
          aiUsed: false,
          credits: 0,
        },
      };
    }),
  ),
  previewJira: protectedProcedure.input(jiraInput).mutation(({ctx,input})=>
    access(ctx,input.projectId,true,async(tx,orgId)=>{
      const batch=await jiraBatch(tx,ctx.user.id,orgId,input);
      const current=await state(tx,input.projectId,orgId),result=preview(current.document,batch);
      return {version:current.version,previewHash:jiraPreviewHash(current.version,input,batch),changes:result.changes,tasks:batch.tasks,credits:0};
    }),
  ),
  approveJira: protectedProcedure.input(jiraCommitInput).mutation(({ctx,input})=>
    access(ctx,input.projectId,true,async(tx,orgId)=>{
      const requestHash=digest(JSON.stringify([input.version,input.runId,input.runVersion,[...input.issueIds].sort(),input.previewHash]));
      // A receipt can acknowledge an already completed write after source access
      // expires. It exposes no summaries and never starts another write or read.
      const prior=await retry(tx,input.projectId,ctx.user.id,input.requestId,"jira_snapshot",requestHash);
      if(prior){await state(tx,input.projectId,orgId);return prior;}
      const batch=await jiraBatch(tx,ctx.user.id,orgId,input);
      if(jiraPreviewHash(input.version,input,batch)!==input.previewHash)throw conflict();
      const current=await state(tx,input.projectId,orgId);
      if(current.version!==input.version)throw conflict();
      const result=preview(current.document,batch);
      const receipt=await save(tx,input.projectId,orgId,result.document,input.version,ctx.user.id,input.requestId,"jira_snapshot",requestHash);
      await tx.auditLog.create({data:{organizationId:orgId,projectId:input.projectId,actorId:ctx.user.id,entityType:"DefectMap",entityId:input.projectId,action:"UPDATE",summary:"Imported reviewed Jira issue summaries as defect-map tasks",metadata:{runId:input.runId,runVersion:input.runVersion,issueIds:[...input.issueIds].sort(),requestId:input.requestId,previewHash:input.previewHash,appliedVersion:receipt.appliedVersion}}});
      return receipt;
    }),
  ),
  previewImport: protectedProcedure
    .input(boundedBatch)
    .mutation(({ ctx, input }) =>
      access(ctx, input.projectId, true, async (tx, orgId) => {
        const current = await state(tx, input.projectId, orgId);
        const result = preview(current.document, input.batch);
        return {
          version: current.version,
          previewHash: digest(JSON.stringify([current.version, input.batch])),
          changes: result.changes,
          map: buildDefectMap(result.document, digest),
          credits: 0,
        };
      }),
    ),
  approveImport: protectedProcedure
    .input(
      batchInput
        .extend({
          version: z.number().int().min(0),
          previewHash: z.string().regex(/^[a-f0-9]{64}$/),
          requestId: z.string().uuid(),
          approveImport: z.literal(true),
        })
        .refine(
          (input) => Buffer.byteLength(JSON.stringify(input.batch)) <= 150_000,
          "Keep a batch below 150 KB",
        ),
    )
    .mutation(({ ctx, input }) =>
      access(ctx, input.projectId, true, async (tx, orgId) => {
        const hash = digest(JSON.stringify([input.version, input.batch]));
        if (hash !== input.previewHash) throw conflict();
        const prior = await retry(
          tx,
          input.projectId,
          ctx.user.id,
          input.requestId,
          "import",
          hash,
        );
        if (prior) {
          await state(tx, input.projectId, orgId);
          return prior;
        }
        const current = await state(tx, input.projectId, orgId);
        if (current.version !== input.version) throw conflict();
        const result = preview(current.document, input.batch);
        return save(
          tx,
          input.projectId,
          orgId,
          result.document,
          input.version,
          ctx.user.id,
          input.requestId,
          "import",
          hash,
        );
      }),
    ),
  decideLink: protectedProcedure
    .input(
      projectInput.extend({
        version: z.number().int().min(0),
        requestId: z.string().uuid(),
        clusterId: z.string().min(1).max(1000),
        taskKey: z.string().min(1).max(500),
        status: z.enum(["confirmed", "rejected"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      access(ctx, input.projectId, true, async (tx, orgId) => {
        const hash = digest(
          JSON.stringify([
            input.version,
            input.clusterId,
            input.taskKey,
            input.status,
          ]),
        );
        const prior = await retry(
          tx,
          input.projectId,
          ctx.user.id,
          input.requestId,
          "link",
          hash,
        );
        if (prior) {
          await state(tx, input.projectId, orgId);
          return prior;
        }
        const current = await state(tx, input.projectId, orgId);
        if (current.version !== input.version) throw conflict();
        const signals = current.document.signals.filter(
          (signal) => defectClusterId(signal) === input.clusterId,
        );
        const task = current.document.tasks.find(
          (task) => defectRecordKey(task) === input.taskKey,
        );
        if (!signals.length || !task)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Both records must belong to this project's retained map.",
          });
        const decision = {
          clusterId: input.clusterId,
          taskKey: input.taskKey,
          status: input.status,
          evidenceHash: digest(defectLinkEvidence(signals, task)),
        };
        const document = defectDocumentSchema.parse({
          ...current.document,
          decisions: [
            ...current.document.decisions.filter(
              (value) =>
                value.clusterId !== input.clusterId ||
                value.taskKey !== input.taskKey,
            ),
            decision,
          ],
        });
        return save(
          tx,
          input.projectId,
          orgId,
          document,
          input.version,
          ctx.user.id,
          input.requestId,
          "link",
          hash,
        );
      }),
    ),
});
