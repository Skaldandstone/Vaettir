import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { reverseEngineerTestFile } from "@vaettir/ai-agent";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { persistReverseEngineerResult } from "../services/reverseEngineerPersist.js";
import { kickReverseEngineerQueue } from "../jobs/reverseEngineerWorker.js";
import { scanRepoForTestFiles, scanChangedTestFiles, hashFileContent } from "../services/repoScan.js";
import { assertReverseEngineerBudget, remainingReverseEngineerBudget } from "../services/rateLimit.js";

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
      const result = await reverseEngineerTestFile({
        filePath: input.filePath,
        content: input.content,
      });

      if (!input.persist) return { result, created: [] };

      const created = await persistReverseEngineerResult(ctx.prisma, {
        projectId: input.projectId,
        filePath: input.filePath,
        contentHash: hashFileContent(input.content),
        result,
      });

      return { result, created };
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
  scanRepo: protectedProcedure
    .input(z.object({ projectId: z.string(), repoUrl: z.string().optional(), ref: z.string().default("main") }))
    .output(z.object({ scannedFileCount: z.number(), queuedJobIds: z.array(z.string()), rateLimitedCount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { project: projectRef } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      await assertReverseEngineerBudget(ctx.prisma, projectRef.organizationId);
      const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: input.projectId } });
      const repoUrl = input.repoUrl ?? project.repoUrl;
      if (!repoUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No repo URL provided and the project has none configured" });
      }

      const alreadyTracked = await ctx.prisma.testCaseSource.findMany({
        where: { testCase: { projectId: input.projectId } },
        select: { filePath: true, contentHash: true },
      });
      const knownHashes = new Map(
        alreadyTracked.filter((s): s is { filePath: string; contentHash: string } => s.contentHash !== null).map((s) => [s.filePath, s.contentHash]),
      );

      // The checkpoint only means something against the project's own
      // configured repo -- a caller-supplied repoUrl override (scanning
      // some other repo ad hoc) can't be diffed from a commit that belongs
      // to a different repository, so that path always does a full walk
      // and never touches the checkpoint.
      const usingProjectRepo = !input.repoUrl || input.repoUrl === project.repoUrl;
      const { files, headSha } =
        usingProjectRepo && project.lastScannedCommitSha
          ? await scanChangedTestFiles(repoUrl, project.lastScannedCommitSha, input.ref, knownHashes)
          : await scanRepoForTestFiles(repoUrl, input.ref, knownHashes);

      if (usingProjectRepo) {
        await ctx.prisma.project.update({ where: { id: input.projectId }, data: { lastScannedCommitSha: headSha } });
      }

      // Budget was checked before the (potentially slow) clone/scan above,
      // but it can have moved since -- re-check against what was actually
      // found. Queueing a partial batch (rather than refusing the whole
      // scan) still makes progress instead of wasting the clone entirely.
      const remaining = await remainingReverseEngineerBudget(ctx.prisma, projectRef.organizationId);
      const filesToQueue = files.slice(0, remaining);
      const rateLimitedCount = files.length - filesToQueue.length;

      const jobs = await Promise.all(
        filesToQueue.map((f) =>
          ctx.prisma.reverseEngineerJob.create({
            data: {
              projectId: input.projectId,
              inputType: "REPO_SCAN",
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
          createdAt: z.date(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.reverseEngineerJob.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    }),
});
