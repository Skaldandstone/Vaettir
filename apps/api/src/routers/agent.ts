import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { reverseEngineerTestFile } from "@tci/ai-agent";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { persistReverseEngineerResult } from "../services/reverseEngineerPersist.js";
import { kickReverseEngineerQueue } from "../jobs/reverseEngineerWorker.js";
import { scanRepoForTestFiles } from "../services/repoScan.js";

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
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
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

  // Clones a repo (shallow, single branch), finds files that look like
  // tests by naming convention, and queues one REPO_SCAN job per file --
  // each processed by the same worker/poller as a submitJob PASTE job, just
  // with the content sourced from the clone instead of a paste box. Caps at
  // MAX_FILES (see repoScan.ts) so a huge repo can't queue thousands of
  // jobs from a single click.
  scanRepo: protectedProcedure
    .input(z.object({ projectId: z.string(), repoUrl: z.string().optional(), ref: z.string().default("main") }))
    .output(z.object({ scannedFileCount: z.number(), queuedJobIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: input.projectId } });
      const repoUrl = input.repoUrl ?? project.repoUrl;
      if (!repoUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No repo URL provided and the project has none configured" });
      }

      const files = await scanRepoForTestFiles(repoUrl, input.ref);

      const jobs = await Promise.all(
        files.map((f) =>
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

      return { scannedFileCount: files.length, queuedJobIds: jobs.map((j) => j.id) };
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
