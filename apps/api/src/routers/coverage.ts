import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { parseIstanbulJson, parseCoberturaXml, parseJacocoXml } from "../services/coverageParse.js";

// P5-06: coverage ingestion, separate from pass/fail results (P5-01) --
// feeds the release-readiness coverage-gap logic in Phase 7. Three formats
// cover the realistic spread: Istanbul/nyc JSON (JS/TS), Cobertura XML
// (coverage.py's `coverage xml`, and widely convertible-to from other
// ecosystems), and JaCoCo XML (Java, a genuinely different shape from
// Cobertura, not just a dialect of it).
export const coverageRouter = router({
  ingest: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        testRunId: z.string().optional(),
        commitSha: z.string().min(1),
        branch: z.string().min(1),
        tool: z.enum(["ISTANBUL", "COBERTURA", "JACOCO"]),
        reportContent: z.string().min(1),
      }),
    )
    .output(
      z.object({
        coverageReportId: z.string(),
        linesCovered: z.number(),
        linesTotal: z.number(),
        branchesCovered: z.number().nullable(),
        branchesTotal: z.number().nullable(),
        fileCount: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");

      if (input.testRunId) {
        const run = await ctx.prisma.testRun.findUnique({ where: { id: input.testRunId }, select: { projectId: true } });
        if (!run || run.projectId !== input.projectId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That test run does not belong to this project" });
        }
      }

      let parsed;
      try {
        parsed =
          input.tool === "ISTANBUL"
            ? parseIstanbulJson(input.reportContent)
            : input.tool === "COBERTURA"
              ? parseCoberturaXml(input.reportContent)
              : parseJacocoXml(input.reportContent);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Could not parse ${input.tool} coverage report: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      const report = await ctx.prisma.coverageReport.create({
        data: {
          projectId: input.projectId,
          testRunId: input.testRunId,
          commitSha: input.commitSha,
          branch: input.branch,
          tool: input.tool,
          linesCovered: parsed.linesCovered,
          linesTotal: parsed.linesTotal,
          branchesCovered: parsed.branchesCovered,
          branchesTotal: parsed.branchesTotal,
          files: {
            create: parsed.files.map((f) => ({
              filePath: f.filePath,
              linesCovered: f.linesCovered,
              linesTotal: f.linesTotal,
              branchesCovered: f.branchesCovered,
              branchesTotal: f.branchesTotal,
            })),
          },
        },
        select: { id: true },
      });

      return {
        coverageReportId: report.id,
        linesCovered: parsed.linesCovered,
        linesTotal: parsed.linesTotal,
        branchesCovered: parsed.branchesCovered ?? null,
        branchesTotal: parsed.branchesTotal ?? null,
        fileCount: parsed.files.length,
      };
    }),

  list: protectedProcedure
    .input(z.object({ projectId: z.string(), take: z.number().min(1).max(50).default(20) }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          tool: z.string(),
          branch: z.string(),
          commitSha: z.string(),
          linesCovered: z.number(),
          linesTotal: z.number(),
          createdAt: z.date(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.coverageReport.findMany({
        where: { projectId: input.projectId },
        select: { id: true, tool: true, branch: true, commitSha: true, linesCovered: true, linesTotal: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: input.take,
      });
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        tool: z.string(),
        branch: z.string(),
        commitSha: z.string(),
        linesCovered: z.number(),
        linesTotal: z.number(),
        branchesCovered: z.number().nullable(),
        branchesTotal: z.number().nullable(),
        createdAt: z.date(),
        files: z.array(
          z.object({
            filePath: z.string(),
            linesCovered: z.number(),
            linesTotal: z.number(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const report = await ctx.prisma.coverageReport.findUniqueOrThrow({
        where: { id: input.id },
        include: { files: { orderBy: { filePath: "asc" } } },
      });
      await requireProjectAccess(ctx, report.projectId);
      return {
        id: report.id,
        tool: report.tool,
        branch: report.branch,
        commitSha: report.commitSha,
        linesCovered: report.linesCovered,
        linesTotal: report.linesTotal,
        branchesCovered: report.branchesCovered,
        branchesTotal: report.branchesTotal,
        createdAt: report.createdAt,
        files: report.files.map((f) => ({ filePath: f.filePath, linesCovered: f.linesCovered, linesTotal: f.linesTotal })),
      };
    }),
});
