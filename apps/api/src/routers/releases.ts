import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess, requireOrgRole } from "../trpc.js";
import { computeStatusesByTestPlan } from "../services/acceptanceCriteria.js";
import { evaluateReleaseGate } from "../services/releaseGate.js";

const CRITERION_WEIGHT: Record<string, number> = { MET: 1, AT_RISK: 0.5, PENDING: 0.25, NOT_MET: 0 };
const FLAG_PENALTY: Record<string, number> = { CRITICAL: 20, HIGH: 10, MEDIUM: 5, LOW: 2 };

// Readiness is deliberately a simple, explainable rollup for this first
// pass (P7-03), not a tuned model: acceptance criteria contribute a 0-100
// base score by how MET they are, and open risk flags subtract from it by
// severity. Any open CRITICAL flag forces BLOCKED regardless of score --
// a critical gap shouldn't be hideable behind an otherwise-good score.
function computeReadiness(criteria: { status: string }[], openFlags: { severity: string }[]) {
  const total = criteria.length;
  const met = criteria.filter((c) => c.status === "MET").length;
  const atRisk = criteria.filter((c) => c.status === "AT_RISK").length;
  const notMet = criteria.filter((c) => c.status === "NOT_MET").length;
  const pending = criteria.filter((c) => c.status === "PENDING").length;
  const criteriaScore =
    total === 0 ? 100 : (criteria.reduce((s, c) => s + (CRITERION_WEIGHT[c.status] ?? 0), 0) / total) * 100;

  const critical = openFlags.filter((f) => f.severity === "CRITICAL").length;
  const high = openFlags.filter((f) => f.severity === "HIGH").length;
  const medium = openFlags.filter((f) => f.severity === "MEDIUM").length;
  const low = openFlags.filter((f) => f.severity === "LOW").length;
  const penalty = Math.min(100, openFlags.reduce((s, f) => s + (FLAG_PENALTY[f.severity] ?? 0), 0));

  const score = Math.max(0, Math.round(criteriaScore - penalty));
  const label: "READY" | "AT_RISK" | "BLOCKED" =
    critical > 0 || score < 50 ? "BLOCKED" : score < 85 ? "AT_RISK" : "READY";

  return {
    score,
    label,
    criteria: { met, atRisk, notMet, pending, total },
    riskFlags: { critical, high, medium, low, openTotal: openFlags.length },
  };
}

const readinessOutput = z.object({
  score: z.number(),
  label: z.enum(["READY", "AT_RISK", "BLOCKED"]),
  criteria: z.object({ met: z.number(), atRisk: z.number(), notMet: z.number(), pending: z.number(), total: z.number() }),
  riskFlags: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    openTotal: z.number(),
  }),
});

const riskFlagOutput = z.object({
  id: z.string(),
  severity: z.string(),
  source: z.string(),
  description: z.string(),
  relatedFilePath: z.string().nullable(),
  relatedPrUrl: z.string().nullable(),
  createdAt: z.date(),
  resolvedAt: z.date().nullable(),
});

export const releasesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          status: z.string(),
          targetDate: z.date().nullable(),
          readiness: readinessOutput,
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const releases = await ctx.prisma.release.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "desc" },
        include: {
          testPlans: { include: { acceptanceCriteria: { select: { testPlanId: true, status: true } } } },
          riskFlags: { where: { resolvedAt: null }, select: { severity: true } },
        },
      });
      const allCriteria = releases.flatMap((r) => r.testPlans.flatMap((p) => p.acceptanceCriteria));
      const computedByPlan = await computeStatusesByTestPlan(
        ctx.prisma,
        allCriteria.map((c) => c.testPlanId),
      );
      return releases.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        targetDate: r.targetDate,
        readiness: computeReadiness(
          r.testPlans.flatMap((p) =>
            p.acceptanceCriteria.map((c) => ({ status: computedByPlan.get(c.testPlanId) ?? c.status })),
          ),
          r.riskFlags,
        ),
      }));
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        status: z.string(),
        targetDate: z.date().nullable(),
        createdAt: z.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.id } });
      await requireProjectAccess(ctx, release.projectId);
      return release;
    }),

  create: protectedProcedure
    .input(z.object({ projectId: z.string(), name: z.string().min(1), targetDate: z.date().optional() }))
    .output(z.object({ id: z.string(), name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return ctx.prisma.release.create({
        data: {
          projectId: input.projectId,
          name: input.name,
          targetDate: input.targetDate,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
        select: { id: true, name: true },
      });
    }),

  // P7-08: only entering READY is gated -- BLOCKED/SHIPPED/back to
  // PLANNING or IN_TESTING are never held up by this check, since the
  // gate's whole point is "don't call this release ready when it isn't."
  updateStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.enum(["PLANNING", "IN_TESTING", "READY", "SHIPPED", "BLOCKED"]) }))
    .mutation(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.id } });
      await requireProjectAccess(ctx, release.projectId, "EDITOR");

      if (input.status === "READY") {
        const gate = await evaluateReleaseGate(ctx.prisma, input.id);
        if (!gate.passes && gate.policy === "HARD_BLOCK") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `This organization requires release gates to pass before READY: ${gate.reasons.join("; ")}`,
          });
        }
      }

      return ctx.prisma.release.update({ where: { id: input.id }, data: { status: input.status, updatedById: ctx.user.id } });
    }),

  checkGate: protectedProcedure
    .input(z.object({ releaseId: z.string() }))
    .output(z.object({ policy: z.string(), passes: z.boolean(), reasons: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      await requireProjectAccess(ctx, release.projectId);
      return evaluateReleaseGate(ctx.prisma, input.releaseId);
    }),

  readiness: protectedProcedure
    .input(z.object({ releaseId: z.string() }))
    .output(readinessOutput)
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      await requireProjectAccess(ctx, release.projectId);
      const criteria = await ctx.prisma.acceptanceCriterion.findMany({
        where: { testPlan: { releaseId: input.releaseId } },
        select: { testPlanId: true, status: true },
      });
      const computedByPlan = await computeStatusesByTestPlan(
        ctx.prisma,
        criteria.map((c) => c.testPlanId),
      );
      const openFlags = await ctx.prisma.riskFlag.findMany({
        where: { releaseId: input.releaseId, resolvedAt: null },
        select: { severity: true },
      });
      return computeReadiness(
        criteria.map((c) => ({ status: computedByPlan.get(c.testPlanId) ?? c.status })),
        openFlags,
      );
    }),

  listTestPlans: protectedProcedure
    .input(z.object({ releaseId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          status: z.string(),
          testPlanType: z.object({ id: z.string(), name: z.string() }),
          acceptanceCriteria: z.array(
            z.object({ id: z.string(), description: z.string(), status: z.string(), autoComputed: z.boolean() }),
          ),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      await requireProjectAccess(ctx, release.projectId);
      const plans = await ctx.prisma.testPlan.findMany({
        where: { releaseId: input.releaseId },
        include: { testPlanType: true, acceptanceCriteria: { orderBy: { createdAt: "asc" } } },
        orderBy: { updatedAt: "desc" },
      });
      const computedByPlan = await computeStatusesByTestPlan(
        ctx.prisma,
        plans.map((p) => p.id),
      );
      return plans.map((p) => {
        const computed = computedByPlan.get(p.id) ?? null;
        return {
          ...p,
          acceptanceCriteria: p.acceptanceCriteria.map((c) => ({
            id: c.id,
            description: c.description,
            status: computed ?? c.status,
            autoComputed: computed !== null,
          })),
        };
      });
    }),

  listRiskFlags: protectedProcedure
    .input(z.object({ releaseId: z.string() }))
    .output(z.array(riskFlagOutput))
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      await requireProjectAccess(ctx, release.projectId);
      return ctx.prisma.riskFlag.findMany({
        where: { releaseId: input.releaseId },
        orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
      });
    }),

  resolveRiskFlag: protectedProcedure
    .input(z.object({ id: z.string(), resolved: z.boolean() }))
    .output(riskFlagOutput)
    .mutation(async ({ ctx, input }) => {
      const flag = await ctx.prisma.riskFlag.findUniqueOrThrow({
        where: { id: input.id },
        include: { release: { select: { projectId: true } } },
      });
      await requireProjectAccess(ctx, flag.release.projectId, "EDITOR");
      return ctx.prisma.riskFlag.update({
        where: { id: input.id },
        data: { resolvedAt: input.resolved ? new Date() : null, updatedById: ctx.user.id },
      });
    }),

  // P7-06: one row per project, showing its most recently active (not yet
  // SHIPPED) release's readiness -- "useful once you have more than one
  // team" means an org lead scanning this shouldn't have to click into
  // every project individually to see which ones are in trouble. A project
  // with no non-shipped release (nothing currently in flight) reports
  // release: null rather than being omitted, so it's still visible as "all
  // quiet" rather than silently missing from the list.
  orgOverview: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.object({
        projects: z.array(
          z.object({
            projectId: z.string(),
            projectName: z.string(),
            release: z
              .object({ id: z.string(), name: z.string(), status: z.string(), readiness: readinessOutput })
              .nullable(),
          }),
        ),
        summary: z.object({ ready: z.number(), atRisk: z.number(), blocked: z.number(), noActiveRelease: z.number() }),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId);
      const projects = await ctx.prisma.project.findMany({
        where: { organizationId: input.organizationId },
        orderBy: { name: "asc" },
      });

      const projectResults = await Promise.all(
        projects.map(async (p) => {
          const release = await ctx.prisma.release.findFirst({
            where: { projectId: p.id, status: { not: "SHIPPED" } },
            orderBy: { createdAt: "desc" },
            include: {
              testPlans: { include: { acceptanceCriteria: { select: { testPlanId: true, status: true } } } },
              riskFlags: { where: { resolvedAt: null }, select: { severity: true } },
            },
          });
          if (!release) return { projectId: p.id, projectName: p.name, release: null };

          const criteria = release.testPlans.flatMap((tp) => tp.acceptanceCriteria);
          const computedByPlan = await computeStatusesByTestPlan(
            ctx.prisma,
            criteria.map((c) => c.testPlanId),
          );
          const readiness = computeReadiness(
            criteria.map((c) => ({ status: computedByPlan.get(c.testPlanId) ?? c.status })),
            release.riskFlags,
          );
          return {
            projectId: p.id,
            projectName: p.name,
            release: { id: release.id, name: release.name, status: release.status, readiness },
          };
        }),
      );

      const summary = projectResults.reduce(
        (acc, r) => {
          if (!r.release) acc.noActiveRelease++;
          else if (r.release.readiness.label === "READY") acc.ready++;
          else if (r.release.readiness.label === "AT_RISK") acc.atRisk++;
          else acc.blocked++;
          return acc;
        },
        { ready: 0, atRisk: 0, blocked: 0, noActiveRelease: 0 },
      );

      return { projects: projectResults, summary };
    }),
});
