import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { refreshProjectReadiness } from "../services/releaseReadiness.js";

// Data, never executable commands or local paths. A worker maps projectKey to
// a project it explicitly permits on its own machine.
const objectiveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  actorTag: z.string().trim().max(120).default(""),
  actorLabel: z.string().trim().max(120).default(""),
  optional: z.boolean().default(false),
  acceptanceRadiusCm: z.number().finite().min(10).max(1000).default(100),
  timeBudgetSeconds: z.number().finite().min(1).max(900).default(90),
  interactOnArrival: z.boolean().default(false),
  interactionVerb: z.string().trim().max(80).default(""),
}).refine((v) => Boolean(v.actorTag) !== Boolean(v.actorLabel), "Choose either one actor tag or one actor label");

export const unrealBindingSchema = z.object({
  projectKey: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  map: z.string().regex(/^\/Game\/[A-Za-z0-9_/-]+$/).max(240),
  persona: z.string().trim().min(1).max(80).default("careful-first-timer"),
  walkSeconds: z.number().int().min(10).max(900).default(120),
  drivePlayer: z.boolean().default(true),
  knowsObjectives: z.boolean().default(false),
  objectives: z.array(objectiveSchema).min(1).max(30),
}).superRefine((v, ctx) => {
  if (v.objectives.every((objective) => objective.optional)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["objectives"], message: "At least one objective must be required" });
  }
  const names = new Set<string>();
  for (const [index, objective] of v.objectives.entries()) {
    const key = objective.name.toLowerCase();
    if (names.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["objectives", index, "name"], message: "Objective names must be unique" });
    names.add(key);
  }
});

const objectiveResultSchema = z.object({
  name: z.string(),
  reached: z.boolean(),
  resolvedTo: z.string().max(500),
  seconds: z.number().finite().min(0),
  wrongTurns: z.number().int().min(0),
});

const catalogMapSchema = z.object({
  path: z.string().regex(/^\/Game\/[A-Za-z0-9_/-]+$/).max(240),
  actors: z.array(z.object({
    label: z.string().min(1).max(160),
    tags: z.array(z.string().min(1).max(120)).max(20),
    location: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).optional(),
  })).max(1000),
});
const catalogSchema = z.array(catalogMapSchema).min(1).max(100);

const completionSchema = z.object({
  jobId: z.string(),
  engineExitCode: z.number().int(),
  testFailureOnly: z.boolean().default(false),
  reportFound: z.boolean(),
  objectives: z.array(objectiveResultSchema).max(30),
  error: z.string().max(2000).optional(),
  commitSha: z.string().regex(/^[0-9a-f]{7,40}$/i),
  branch: z.string().min(1).max(150),
  durationMs: z.number().int().min(0).max(3_600_000),
  report: z.unknown().refine((value) => JSON.stringify(value).length <= 128_000, "Report summary is too large").optional(),
});

async function requireServiceKey(ctx: { prisma: typeof import("@vaettir/db")["prisma"]; user: { id: string } }) {
  const key = await ctx.prisma.apiKey.findFirst({ where: { serviceUserId: ctx.user.id, revokedAt: null }, select: { id: true } });
  if (!key) throw new TRPCError({ code: "FORBIDDEN", message: "A project service API key is required" });
}

export const unrealPlaytestsRouter = router({
  catalogs: protectedProcedure.input(z.object({ projectId: z.string() }))
    .output(z.array(z.object({ projectKey: z.string(), updatedAt: z.date(), maps: catalogSchema })))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const catalogs = await ctx.prisma.unrealPlaytestCatalog.findMany({ where: { projectId: input.projectId }, orderBy: { updatedAt: "desc" } });
      return catalogs.map((catalog) => ({ projectKey: catalog.projectKey, updatedAt: catalog.updatedAt, maps: catalogSchema.parse(catalog.maps) }));
    }),

  publishCatalog: protectedProcedure.input(z.object({ projectId: z.string(), projectKey: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), maps: catalogSchema }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      await requireServiceKey(ctx);
      if (new Set(input.maps.map((map) => map.path)).size !== input.maps.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Catalog map paths must be unique" });
      }
      const existing = await ctx.prisma.unrealPlaytestCatalog.findUnique({
        where: { projectId_projectKey: { projectId: input.projectId, projectKey: input.projectKey } }, select: { maps: true },
      });
      const incomingPaths = new Set(input.maps.map((map) => map.path));
      const maps = [...(existing ? catalogSchema.parse(existing.maps).filter((map) => !incomingPaths.has(map.path)) : []), ...input.maps];
      if (maps.length > 100) throw new TRPCError({ code: "BAD_REQUEST", message: "Catalog is limited to 100 maps" });
      await ctx.prisma.unrealPlaytestCatalog.upsert({
        where: { projectId_projectKey: { projectId: input.projectId, projectKey: input.projectKey } },
        create: { projectId: input.projectId, projectKey: input.projectKey, maps: maps as Prisma.InputJsonValue },
        update: { maps: maps as Prisma.InputJsonValue },
      });
      return { published: true };
    }),

  binding: protectedProcedure.input(z.object({ testCaseId: z.string() })).query(async ({ ctx, input }) => {
    const testCase = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true } });
    await requireProjectAccess(ctx, testCase.projectId);
    const binding = await ctx.prisma.unrealPlaytestBinding.findUnique({ where: { testCaseId: input.testCaseId } });
    return binding ? unrealBindingSchema.parse(binding.config) : null;
  }),

  saveBinding: protectedProcedure.input(z.object({ testCaseId: z.string(), config: unrealBindingSchema })).mutation(async ({ ctx, input }) => {
    const testCase = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true, archived: true } });
    await requireProjectAccess(ctx, testCase.projectId, "EDITOR");
    if (testCase.archived) throw new TRPCError({ code: "BAD_REQUEST", message: "Archived cases cannot be bound" });
    await ctx.prisma.unrealPlaytestBinding.upsert({
      where: { testCaseId: input.testCaseId },
      create: { testCaseId: input.testCaseId, config: input.config as Prisma.InputJsonValue },
      update: { config: input.config as Prisma.InputJsonValue },
    });
    return { saved: true };
  }),

  queue: protectedProcedure.input(z.object({ testCaseId: z.string() })).mutation(async ({ ctx, input }) => {
    const testCase = await ctx.prisma.testCase.findUniqueOrThrow({
      where: { id: input.testCaseId },
      include: { steps: { orderBy: { order: "asc" } }, unrealPlaytestBinding: true, versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    await requireProjectAccess(ctx, testCase.projectId, "EDITOR");
    if (testCase.archived || testCase.reviewStatus !== "APPROVED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The test case must be active and approved" });
    }
    const config = unrealBindingSchema.parse(testCase.unrealPlaytestBinding?.config);
    const catalog = await ctx.prisma.unrealPlaytestCatalog.findUnique({ where: { projectId_projectKey: { projectId: testCase.projectId, projectKey: config.projectKey } } });
    if (!catalog) throw new TRPCError({ code: "BAD_REQUEST", message: "This local Unreal project has not published a map/actor catalog" });
    const map = catalogSchema.parse(catalog.maps).find((item) => item.path === config.map);
    if (!map) throw new TRPCError({ code: "BAD_REQUEST", message: "The selected map is not in the worker's current catalog" });
    for (const objective of config.objectives) {
      const matches = map.actors.filter((actor) => objective.actorTag ? actor.tags.includes(objective.actorTag) : actor.label === objective.actorLabel);
      if (matches.length !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: `Objective '${objective.name}' resolves to ${matches.length} catalog actors; choose a unique tag or label` });
    }
    const snapshot = {
      caseVersionId: testCase.versions[0]?.id ?? null,
      caseUpdatedAt: testCase.updatedAt.toISOString(),
      title: testCase.title,
      given: testCase.given,
      when: testCase.when,
      then: testCase.then,
      steps: testCase.steps.map((s) => ({ order: s.order, action: s.action, expectedResult: s.expectedResult })),
      binding: config,
    };
    const job = await ctx.prisma.unrealPlaytestJob.create({
      data: { projectId: testCase.projectId, testCaseId: testCase.id, projectKey: config.projectKey, snapshot },
      select: { id: true, status: true },
    });
    return job;
  }),

  runsForCase: protectedProcedure.input(z.object({ testCaseId: z.string() }))
    .output(z.array(z.object({ id: z.string(), status: z.string(), testRunId: z.string().nullable(), createdAt: z.date(), result: z.string().nullable() })))
    .query(async ({ ctx, input }) => {
    const testCase = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true } });
    await requireProjectAccess(ctx, testCase.projectId);
    const jobs = await ctx.prisma.unrealPlaytestJob.findMany({
      where: { testCaseId: input.testCaseId }, orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, status: true, result: true, testRunId: true, createdAt: true },
    });
    return jobs.map((job) => ({ id: job.id, status: job.status, testRunId: job.testRunId, createdAt: job.createdAt, result: job.result ? JSON.stringify(job.result) : null }));
  }),

  claimNext: protectedProcedure.input(z.object({ projectId: z.string(), projectKey: z.string() })).mutation(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId, "EDITOR");
    await requireServiceKey(ctx);
    // Conditional update makes concurrent polling workers race safely. No
    // automatic replay: a dead worker needs an explicit operator decision.
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = await ctx.prisma.unrealPlaytestJob.findFirst({
        where: { projectId: input.projectId, projectKey: input.projectKey, status: "QUEUED" },
        orderBy: { createdAt: "asc" }, select: { id: true },
      });
      if (!candidate) return null;
      const claimed = await ctx.prisma.unrealPlaytestJob.updateMany({
        where: { id: candidate.id, status: "QUEUED" },
        data: { status: "CLAIMED", claimedById: ctx.user.id, claimedAt: new Date() },
      });
      if (claimed.count === 1) return ctx.prisma.unrealPlaytestJob.findUniqueOrThrow({ where: { id: candidate.id }, select: { id: true, snapshot: true } });
    }
    return null;
  }),

  complete: protectedProcedure.input(completionSchema).mutation(async ({ ctx, input }) => {
    await requireServiceKey(ctx);
    const job = await ctx.prisma.unrealPlaytestJob.findUniqueOrThrow({ where: { id: input.jobId } });
    await requireProjectAccess(ctx, job.projectId, "EDITOR");
    if (job.status !== "CLAIMED" || job.claimedById !== ctx.user.id) {
      throw new TRPCError({ code: "CONFLICT", message: "This service identity does not own the claimed job" });
    }
    const snapshot = job.snapshot as { binding: z.infer<typeof unrealBindingSchema> };
    const expected = unrealBindingSchema.parse(snapshot.binding).objectives;
    const mismatch = input.objectives.length !== expected.length || expected.some((objective, i) => input.objectives[i]?.name !== objective.name)
      || input.objectives.some((objective) => objective.reached && !objective.resolvedTo.trim());
    const missed = expected.filter((objective, i) => !objective.optional && !input.objectives[i]?.reached);
    // Unreal exits nonzero when an automation assertion fails. A worker may
    // identify that exact, report-backed outcome; other nonzero exits remain
    // infrastructure errors, even when the report also has missed objectives.
    const expectedAssertionFailure = input.testFailureOnly && input.engineExitCode !== 0
      && input.reportFound && !mismatch && missed.length > 0 && !input.error;
    const error = input.error || (input.engineExitCode !== 0 && !expectedAssertionFailure ? `Unreal editor exited ${input.engineExitCode}` : undefined)
      || (!input.reportFound ? "Unreal playtest report was not produced" : undefined)
      || (mismatch ? "Objective results did not match the queued test snapshot" : undefined);
    const status = error ? "ERROR" : missed.length ? "FAILED" : "PASSED";
    const message = error ?? (missed.length ? `Required objectives not reached: ${missed.map((o) => o.name).join(", ")}` : null);
    const result = { engineExitCode: input.engineExitCode, testFailureOnly: input.testFailureOnly, reportFound: input.reportFound, objectives: input.objectives, error: message, report: input.report ?? null };
    const testRun = await ctx.prisma.$transaction(async (tx) => {
      const changed = await tx.unrealPlaytestJob.updateMany({
        where: { id: job.id, status: "CLAIMED", claimedById: ctx.user.id },
        data: { status, finishedAt: new Date(), result: result as Prisma.InputJsonValue },
      });
      if (changed.count !== 1) throw new TRPCError({ code: "CONFLICT", message: "Job already completed" });
      const run = await tx.testRun.create({
        data: {
          projectId: job.projectId, ciProvider: "unreal-playtester", commitSha: input.commitSha, branch: input.branch,
          startedAt: job.claimedAt ?? job.createdAt, finishedAt: new Date(), status: status === "PASSED" ? "PASSED" : "FAILED",
          results: { create: { testCaseId: job.testCaseId, status: status === "PASSED" ? "PASS" : status === "ERROR" ? "BLOCKED" : "FAIL", durationMs: input.durationMs, errorMessage: message } },
        }, select: { id: true },
      });
      await tx.unrealPlaytestJob.update({ where: { id: job.id }, data: { testRunId: run.id } });
      return run;
    });
    refreshProjectReadiness(ctx.prisma, job.projectId);
    return { status, testRunId: testRun.id };
  }),
});
