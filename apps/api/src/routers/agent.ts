import { z } from "zod";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {Prisma} from "@vaettir/db";
import { reverseEngineerTestFile, inferCustomFrameworkHeuristic } from "@vaettir/ai-agent";
import { gherkinToReverseEngineerResult, postmanCollectionToReverseEngineerResult } from "@vaettir/core";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { persistReverseEngineerResult } from "../services/reverseEngineerPersist.js";
import { kickReverseEngineerQueue } from "../jobs/reverseEngineerWorker.js";
import { scanRepoForTestFiles, hashFileContent } from "../services/repoScan.js";
import { repositoryProcessingScope, repositoryProcessingConsent, repositoryProcessingPreview, beginRepositoryProcessing, assertRepositoryProcessingApproval, lockedProcessingEditor,lockedProcessingReader } from "../services/repositoryProcessingApproval.js";
import {publicRepositoryProcessingError} from "../services/repositoryProcessingErrors.js";
import { connectedSourceBinding, sourceBindingReceipt } from "../services/connectedRepositoryAccess.js";
import { scanApprovedConnectedGitlab } from "../services/connectedGitlabScan.js";
import { scanZipForTestFiles } from "../services/zipScan.js";
import { assertReverseEngineerBudget, remainingReverseEngineerBudget } from "../services/rateLimit.js";
import { getMostRecentHeuristic, recordHeuristicUsage } from "../services/customFrameworkHeuristic.js";
import { chargeAiCredits, InsufficientAiCreditsError, meterAiCall, type AiCharge } from "../services/aiCredits.js";

async function chargeOrThrow(
  prisma: Parameters<typeof chargeAiCredits>[0],
  organizationId: string,
  operation: Parameters<typeof chargeAiCredits>[2],
): Promise<AiCharge> {
  try {
    return await chargeAiCredits(prisma, organizationId, operation);
  } catch (e) {
    if (e instanceof InsufficientAiCreditsError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    }
    throw e;
  }
}

export const agentRouter = router({
  // Reverse-engineers a pasted/uploaded test file into BDD test cases and
  // persists them, linked back to their TestCaseSource. Blocks the request
  // for the duration of the LLM call -- fine for a single small file from
  // the UI's paste box. For anything bigger (multi-file, repo scans), use
  // submitJob instead so the caller isn't stuck holding an HTTP request open.
  reverseEngineerFile: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        filePath: z.string(),
        content: z.string().min(1),
        persist: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.persist) {
        await requireProjectAccess(ctx, input.projectId, "EDITOR");
      }
      const project = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { organizationId: true },
      });
      const charge = await chargeOrThrow(ctx.prisma, project.organizationId, "reverseEngineerTestFile");
      const heuristic = await getMostRecentHeuristic(ctx.prisma, input.projectId);
      const result = await meterAiCall(ctx.prisma, charge, () =>
        reverseEngineerTestFile({
          filePath: input.filePath,
          content: input.content,
          customFrameworkHint: heuristic?.description,
        }),
      );
      // The hint is only ever included in the prompt when the detected
      // family is CUSTOM (see reverseEngineer.ts's buildPromptContent) --
      // detectedFrameworkFamily coming back CUSTOM is what confirms this
      // call actually leaned on it, not just that a heuristic happened to
      // exist for the project.
      if (heuristic && result.detectedFrameworkFamily === "CUSTOM") {
        await recordHeuristicUsage(ctx.prisma, heuristic.id);
      }

      if (!input.persist) return { result, created: [] };

      const created = await persistReverseEngineerResult(ctx.prisma, {
        projectId: input.projectId,
        filePath: input.filePath,
        contentHash: hashFileContent(input.content),
        result,
      });

      return { result, created };
    }),

  // P2-13: Gherkin/.feature files are already BDD -- this parses and
  // validates rather than inferring, so it's plain code, not an LLM call
  // (no rate limit, no job queue, no confidence score to distrust). Each
  // Scenario in the file becomes its own TestCase; a Scenario Outline's
  // Examples table expands into one case per row. Cases land APPROVED, not
  // PENDING_REVIEW -- see reverseEngineerPersist.ts for why IMPORTED
  // content skips the AI trust gate.
  importGherkin: protectedProcedure
    .input(z.object({ projectId: z.string(), filePath: z.string(), content: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const result = gherkinToReverseEngineerResult(input.content);
      if (result.testCases.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No usable Scenario found in this file (needs Given/When/Then steps)" });
      }
      const created = await persistReverseEngineerResult(ctx.prisma, {
        projectId: input.projectId,
        filePath: input.filePath,
        contentHash: hashFileContent(input.content),
        result,
        origin: "IMPORTED",
      });
      return { created: created.map((tc) => ({ id: tc.id, title: tc.title })) };
    }),

  // P2-12: request/assertion pairs, not functions -- structurally different
  // from code-based frameworks, so like Gherkin this extracts rather than
  // infers (plain JSON parse + regex over each request's test script, no
  // LLM call). Each request with at least one pm.test(...) assertion in the
  // collection becomes its own TestCase; a request with no test script has
  // nothing to verify and is skipped. Same IMPORTED/APPROVED treatment as
  // Gherkin -- see reverseEngineerPersist.ts.
  importPostmanCollection: protectedProcedure
    .input(z.object({ projectId: z.string(), filePath: z.string(), content: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      let result;
      try {
        result = postmanCollectionToReverseEngineerResult(input.content);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }
      if (result.testCases.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No requests with pm.test(...) assertions found in this collection",
        });
      }
      const created = await persistReverseEngineerResult(ctx.prisma, {
        projectId: input.projectId,
        filePath: input.filePath,
        contentHash: hashFileContent(input.content),
        result,
        origin: "IMPORTED",
      });
      return { created: created.map((tc) => ({ id: tc.id, title: tc.title })) };
    }),

  // Queues the same work as reverseEngineerFile but returns immediately --
  // an in-process poller (jobs/reverseEngineerWorker.ts) picks it up. Use
  // this from the UI instead of the synchronous path when the caller wants
  // to keep working while the LLM call runs (or just prefers not to block).
  submitJob: protectedProcedure
    .input(z.object({ projectId: z.string(), filePath: z.string(), content: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      await assertReverseEngineerBudget(ctx.prisma, project.organizationId);
      const job = await ctx.prisma.reverseEngineerJob.create({
        data: {
          projectId: input.projectId,
          inputType: "PASTE",
          inputRef: input.filePath,
          content: input.content,
          status: "PENDING",
        },
      });
      // Fire-and-forget: don't hold the mutation open for the LLM call. If
      // the poller (started at server boot) already picked this job up by
      // the time this fires, runJob's PENDING guard makes it a safe no-op.
      void kickReverseEngineerQueue();
      return { id: job.id, status: job.status };
    }),

  // Finds files that look like tests by naming convention and queues one
  // REPO_SCAN job per file -- each processed by the same worker/poller as a
  // submitJob PASTE job, just with the content sourced from a clone instead
  // of a paste box. Caps at MAX_FILES (see repoScan.ts) so a huge repo
  // can't queue thousands of jobs from a single click. The first scan of a
  // project (or one against a caller-supplied repoUrl override) walks and
  // hashes the whole repo; every scan after that diffs from the previous
  // scan's checkpoint commit instead (P2-05) -- much cheaper, and it's what
  // lets a genuinely-changed already-tracked file get caught at all rather
  // than being excluded forever once any TestCaseSource exists for its path.
  previewRepoProcessing: protectedProcedure
    .input(z.object({projectId:z.string(),purpose:z.enum(["TEST_CASES","REQUIREMENTS"]),scope:repositoryProcessingScope}))
    .query(({ctx,input})=>repositoryProcessingPreview(ctx,input.projectId,input.purpose,input.scope)),

  repositoryProcessingStatus: protectedProcedure
    .input(z.object({projectId:z.string(),requestId:z.string().uuid()}))
    .output(z.object({id:z.string(),status:z.string(),resolvedCommitSha:z.string().nullable(),results:z.unknown().nullable(),purpose:z.string(),createdAt:z.date()}).nullable())
    .query(async({ctx,input})=>{
      const {project}=await requireProjectAccess(ctx,input.projectId);
      return ctx.prisma.$transaction(async tx=>{
        await lockedProcessingReader(tx,project.organizationId,ctx.user.id,input.projectId);
        const row=await tx.repositoryProcessingApproval.findUnique({where:{projectId_actorId_requestId:{projectId:input.projectId,actorId:ctx.user.id,requestId:input.requestId}},select:{id:true,organizationId:true,status:true,resolvedCommitSha:true,results:true,purpose:true,createdAt:true}});
        if(row&&row.organizationId!==project.organizationId)throw new TRPCError({code:"FORBIDDEN"});return row;
      });
    }),

  repositoryProcessingRuns:protectedProcedure
    .input(z.object({projectId:z.string(),purpose:z.enum(["TEST_CASES","REQUIREMENTS"])}))
    .query(async({ctx,input})=>{
      const {project}=await requireProjectAccess(ctx,input.projectId);
      return ctx.prisma.$transaction(async tx=>{
        await lockedProcessingReader(tx,project.organizationId,ctx.user.id,input.projectId);
        return tx.repositoryProcessingApproval.findMany({where:{projectId:input.projectId,organizationId:project.organizationId,actorId:ctx.user.id,purpose:input.purpose},select:{requestId:true,status:true,repositoryUrl:true,ref:true,createdAt:true},orderBy:{createdAt:"desc"},take:20});
      });
    }),

  cancelRepositoryProcessing: protectedProcedure
    .input(z.object({projectId:z.string(),requestId:z.string().uuid()}))
    .mutation(async({ctx,input})=>{
      const {project}=await requireProjectAccess(ctx,input.projectId,"EDITOR");
      return ctx.prisma.$transaction(async tx=>{
        await lockedProcessingEditor(tx,project.organizationId,ctx.user.id,input.projectId);
        const row=await tx.repositoryProcessingApproval.findUnique({where:{projectId_actorId_requestId:{projectId:input.projectId,actorId:ctx.user.id,requestId:input.requestId}}});
        if(!row)return{canceled:false};
        if(row.organizationId!==project.organizationId)throw new TRPCError({code:"FORBIDDEN"});
        if(["COMPLETED","CANCELED"].includes(row.status))return{canceled:row.status==="CANCELED"};
        await tx.repositoryProcessingApproval.update({where:{id:row.id},data:{status:"CANCELED"}});
        await tx.reverseEngineerJob.updateMany({where:{processingApprovalId:row.id,status:"PENDING"},data:{status:"FAILED",completedAt:new Date(),error:"Source processing canceled before AI. Paid outputs, if any, remain retained."}});
        return{canceled:true};
      });
    }),

  scanRepo: protectedProcedure
    .input(z.object({ projectId: z.string(), scope:repositoryProcessingScope, consent:repositoryProcessingConsent }))
    .output(z.object({ scannedFileCount: z.number(), queuedJobIds: z.array(z.string()), rateLimitedCount: z.number(), approvalId:z.string(), resolvedCommitSha:z.string() }))
    .mutation(async ({ ctx, input }) => {
      const {approval,replayed}=await beginRepositoryProcessing(ctx,input.projectId,"TEST_CASES",input.scope,input.consent);
      const resultSchema=z.object({scannedFileCount:z.number(),queuedJobIds:z.array(z.string()),rateLimitedCount:z.number(),approvalId:z.string(),resolvedCommitSha:z.string()});
      if(replayed){
        if(approval.status==="QUEUED"||approval.status==="COMPLETED")return resultSchema.parse(approval.results);
        throw new TRPCError({code:"PRECONDITION_FAILED",message:"This approved run is in progress or requires recovery. Review its saved status; retrying cannot reread or recharge it."});
      }
      try{
        await assertReverseEngineerBudget(ctx.prisma,approval.organizationId);
        // A single project checkpoint cannot describe multiple repositories or
        // partial path scopes. Full scoped scans retain hash deduplication and
        // never advance a checkpoint ahead of queued or paid work.
        const tracked=await ctx.prisma.testCaseSource.findMany({where:{testCase:{projectId:input.projectId},repoUrl:input.scope.repoUrl},select:{filePath:true,contentHash:true}});
        const hashes=new Map(tracked.filter((s):s is {filePath:string;contentHash:string}=>s.contentHash!==null).map(s=>[s.filePath,s.contentHash]));
        const paidJobs=await ctx.prisma.reverseEngineerJob.findMany({where:{projectId:input.projectId,processingApproval:{repositoryUrl:input.scope.repoUrl,organizationId:approval.organizationId},paidProcessingResult:{not:Prisma.DbNull}},select:{inputRef:true,content:true},orderBy:{createdAt:"asc"}});
        const knownBlobs=new Map<string,string>();
        for(const prior of paidJobs)if(prior.content!==null){
          hashes.set(prior.inputRef,hashFileContent(prior.content));
          const bytes=Buffer.from(prior.content,"utf8");knownBlobs.set(prior.inputRef,createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"));
        }
        await ctx.prisma.$transaction(tx=>assertRepositoryProcessingApproval(tx,approval.id,input.projectId,"TEST_CASES"));
        const {files,headSha}=connectedSourceBinding(approval.results)
          ? await scanApprovedConnectedGitlab(ctx,approval.id,input.projectId,"TEST_CASES",hashes,knownBlobs)
          : await scanRepoForTestFiles(input.scope.repoUrl,input.scope.ref,hashes,input.scope.pathPrefixes,input.scope.maxItems);
        if(!/^[a-f0-9]{40}$/i.test(headSha))throw new TRPCError({code:"PRECONDITION_FAILED",message:"The repository revision could not be pinned."});
        const result=await ctx.prisma.$transaction(async tx=>{
          await assertRepositoryProcessingApproval(tx,approval.id,input.projectId,"TEST_CASES");
          const remaining=await remainingReverseEngineerBudget(tx as unknown as typeof ctx.prisma,approval.organizationId);
          const active=await tx.reverseEngineerJob.findMany({where:{projectId:input.projectId,processingApproval:{repositoryUrl:input.scope.repoUrl,organizationId:approval.organizationId},OR:[{status:{in:["PENDING","RUNNING"]}},{aiProcessingStartedAt:{not:null}}]},select:{id:true,inputRef:true,content:true}});
          const jobs=[];
          for(const file of files.slice(0,remaining)){
            const prior=active.find(job=>job.inputRef===file.relativePath&&job.content!==null&&hashFileContent(job.content)===file.contentHash);
            jobs.push(prior??await tx.reverseEngineerJob.create({data:{projectId:input.projectId,inputType:"REPO_SCAN",inputRef:file.relativePath,content:file.content,status:"PENDING",processingApprovalId:approval.id}}));
          }
          const value={scannedFileCount:files.length,queuedJobIds:jobs.map(job=>job.id),rateLimitedCount:Math.max(0,files.length-remaining),approvalId:approval.id,resolvedCommitSha:headSha};
          await tx.repositoryProcessingApproval.update({where:{id:approval.id},data:{status:"QUEUED",resolvedCommitSha:headSha,results:{...value,...sourceBindingReceipt(approval.results)}}});
          return value;
        });
        void kickReverseEngineerQueue();return result;
      }catch(error){
        await ctx.prisma.repositoryProcessingApproval.updateMany({where:{id:approval.id,status:"READING"},data:{status:"FAILED"}});
        throw publicRepositoryProcessingError(error);
      }
    }),

  // P2-11: the file-upload counterpart to scanRepo -- same queue-one-job-
  // per-test-file shape, just reading from an uploaded zip of a test
  // directory instead of cloning a repo. No git history exists for an
  // upload, so there's no diff-aware path (P2-05's equivalent); every
  // upload scans fresh, deduped only against whatever's already tracked by
  // path+hash. `zipBase64` because tRPC's JSON transport has no native
  // binary/multipart support -- the client base64-encodes the file before
  // sending (see server.ts's raised bodyLimit for why that's viable at all).
  uploadZip: protectedProcedure
    .input(z.object({ projectId: z.string(), zipBase64: z.string().min(1) }))
    .output(z.object({ scannedFileCount: z.number(), queuedJobIds: z.array(z.string()), rateLimitedCount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      await assertReverseEngineerBudget(ctx.prisma, project.organizationId);

      const alreadyTracked = await ctx.prisma.testCaseSource.findMany({
        where: { testCase: { projectId: input.projectId } },
        select: { filePath: true, contentHash: true },
      });
      const knownHashes = new Map(
        alreadyTracked.filter((s): s is { filePath: string; contentHash: string } => s.contentHash !== null).map((s) => [s.filePath, s.contentHash]),
      );

      let zipBuffer: Buffer;
      try {
        zipBuffer = Buffer.from(input.zipBase64, "base64");
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "zipBase64 is not valid base64" });
      }
      let files;
      try {
        files = scanZipForTestFiles(zipBuffer, knownHashes);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }

      const remaining = await remainingReverseEngineerBudget(ctx.prisma, project.organizationId);
      const filesToQueue = files.slice(0, remaining);
      const rateLimitedCount = files.length - filesToQueue.length;

      const jobs = await Promise.all(
        filesToQueue.map((f) =>
          ctx.prisma.reverseEngineerJob.create({
            data: {
              projectId: input.projectId,
              inputType: "FILE_UPLOAD",
              inputRef: f.relativePath,
              content: f.content,
              status: "PENDING",
            },
          }),
        ),
      );
      void kickReverseEngineerQueue();

      return { scannedFileCount: files.length, queuedJobIds: jobs.map((j) => j.id), rateLimitedCount };
    }),

  // P5-12: step 1 of "teach the platform your framework" -- infers the
  // reusable structural pattern from 2-3 example files but does NOT save
  // it. Same review-before-commit shape as P4-02's strategy draft: the
  // user reviews (and can edit) the inferred description before it's
  // persisted and starts actually shaping future reverse-engineer calls.
  inferCustomFrameworkHeuristic: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        files: z.array(z.object({ filePath: z.string(), content: z.string().min(1) })).min(2).max(3),
      }),
    )
    .output(z.object({ name: z.string(), description: z.string(), confidence: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const charge = await chargeOrThrow(ctx.prisma, project.organizationId, "inferCustomFrameworkHeuristic");
      return meterAiCall(ctx.prisma, charge, () => inferCustomFrameworkHeuristic({ files: input.files }));
    }),

  // Step 2: persists a (possibly user-edited) inferred heuristic. Kept as
  // a separate mutation from the inference step rather than an
  // auto-save -- the user might reject or rewrite the description before
  // it starts being used.
  saveCustomFrameworkHeuristic: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1),
        description: z.string().min(1),
        confidence: z.number().optional(),
        exampleFilePaths: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return ctx.prisma.customFrameworkHeuristic.create({
        data: {
          projectId: input.projectId,
          name: input.name,
          description: input.description,
          confidence: input.confidence,
          exampleFilePaths: input.exampleFilePaths,
          createdById: ctx.user.id,
        },
      });
    }),

  listCustomFrameworkHeuristics: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          confidence: z.number().nullable(),
          usageCount: z.number(),
          exampleFilePaths: z.array(z.string()),
          createdAt: z.date(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.customFrameworkHeuristic.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "desc" },
      });
    }),

  deleteCustomFrameworkHeuristic: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const heuristic = await ctx.prisma.customFrameworkHeuristic.findUniqueOrThrow({ where: { id: input.id } });
      await requireProjectAccess(ctx, heuristic.projectId, "EDITOR");
      await ctx.prisma.customFrameworkHeuristic.delete({ where: { id: input.id } });
    }),

  jobStatus: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        status: z.string(),
        error: z.string().nullable(),
        resultTestCaseIds: z.array(z.string()),
        createdAt: z.date(),
        startedAt: z.date().nullable(),
        completedAt: z.date().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const job = await ctx.prisma.reverseEngineerJob.findUniqueOrThrow({ where: { id: input.id } });
      await requireProjectAccess(ctx, job.projectId);
      return job;
    }),

  listJobs: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          inputRef: z.string(),
          status: z.string(),
          error: z.string().nullable(),
          resultTestCaseIds: z.array(z.string()),
          processingApprovalId:z.string().nullable(),
          paidProcessingResult:z.unknown().nullable(),
          createdAt: z.date(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const {project}=await requireProjectAccess(ctx,input.projectId);
      return ctx.prisma.$transaction(async tx=>{
        await lockedProcessingReader(tx,project.organizationId,ctx.user.id,input.projectId);
        return tx.reverseEngineerJob.findMany({
          where:{projectId:input.projectId,OR:[{processingApprovalId:null},{processingApproval:{organizationId:project.organizationId}}]},
          orderBy:{createdAt:"desc"},take:50,
        });
      });
    }),
});
