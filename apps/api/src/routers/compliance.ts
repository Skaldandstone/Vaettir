import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { recordAudit } from "../services/auditLog.js";

// P3-01/P3-03: ComplianceFramework/ComplianceControl are shared reference
// data across every org (same pattern as TestPlanType, not project- or
// org-scoped) -- seeded frameworks exist (SOC 2, HIPAA, PCI DSS, GDPR,
// ISO 27001) but with zero controls under them until an org adds its own,
// or adds an entirely custom framework (isBuiltIn: false marks the
// difference in the UI). Any authenticated user can add a custom
// framework/control -- same "don't shoehorn, no code change required"
// reasoning as a custom TestPlanType, and isBuiltIn keeps the seeded set
// visually distinct regardless of who adds what.
export const complianceRouter = router({
  listFrameworks: protectedProcedure
    .output(
      z.array(
        z.object({
          id: z.string(),
          key: z.string(),
          name: z.string(),
          version: z.string().nullable(),
          isBuiltIn: z.boolean(),
          controlCount: z.number(),
        }),
      ),
    )
    .query(async ({ ctx }) => {
      const frameworks = await ctx.prisma.complianceFramework.findMany({
        include: { _count: { select: { controls: true } } },
        orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
      });
      return frameworks.map((f) => ({
        id: f.id,
        key: f.key,
        name: f.name,
        version: f.version,
        isBuiltIn: f.isBuiltIn,
        controlCount: f._count.controls,
      }));
    }),

  createFramework: protectedProcedure
    .input(z.object({ key: z.string().min(1), name: z.string().min(1), version: z.string().optional(), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.complianceFramework.findUnique({ where: { key: input.key } });
      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `A framework with key "${input.key}" already exists` });
      }
      return ctx.prisma.complianceFramework.create({
        data: { key: input.key, name: input.name, version: input.version, description: input.description, isBuiltIn: false },
      });
    }),

  createControl: protectedProcedure
    .input(z.object({ frameworkId: z.string(), code: z.string().min(1), title: z.string().min(1), description: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.complianceControl.findUnique({
        where: { frameworkId_code: { frameworkId: input.frameworkId, code: input.code } },
      });
      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Control "${input.code}" already exists on this framework` });
      }
      return ctx.prisma.complianceControl.create({ data: input });
    }),

  // Per-control coverage within one project: how many of that project's
  // test cases are mapped to each control. A control with 0 is the gap
  // this whole feature exists to surface -- "which controls have zero
  // mapped test cases," straight from the roadmap ticket.
  controlCoverage: protectedProcedure
    .input(z.object({ projectId: z.string(), frameworkId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          code: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          mappedTestCaseCount: z.number(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const controls = await ctx.prisma.complianceControl.findMany({
        where: { frameworkId: input.frameworkId },
        include: { _count: { select: { testCases: { where: { testCase: { projectId: input.projectId } } } } } },
        orderBy: { code: "asc" },
      });
      return controls.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        description: c.description,
        mappedTestCaseCount: c._count.testCases,
      }));
    }),

  testCaseControls: protectedProcedure
    .input(z.object({ testCaseId: z.string() }))
    .output(z.array(z.object({ id: z.string(), code: z.string(), title: z.string(), frameworkName: z.string() })))
    .query(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true } });
      await requireProjectAccess(ctx, tc.projectId);
      const mappings = await ctx.prisma.testCaseComplianceControl.findMany({
        where: { testCaseId: input.testCaseId },
        include: { control: { include: { framework: true } } },
      });
      return mappings.map((m) => ({
        id: m.control.id,
        code: m.control.code,
        title: m.control.title,
        frameworkName: m.control.framework.name,
      }));
    }),

  mapTestCase: protectedProcedure
    .input(z.object({ testCaseId: z.string(), controlId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [tc, control] = await Promise.all([
        ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true, title: true } }),
        ctx.prisma.complianceControl.findUniqueOrThrow({ where: { id: input.controlId } }),
      ]);
      const { project } = await requireProjectAccess(ctx, tc.projectId, "EDITOR");
      await ctx.prisma.testCaseComplianceControl.upsert({
        where: { testCaseId_controlId: { testCaseId: input.testCaseId, controlId: input.controlId } },
        create: { testCaseId: input.testCaseId, controlId: input.controlId },
        update: {},
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: tc.projectId,
        actorId: ctx.user.id,
        entityType: "TestCaseComplianceControl",
        entityId: `${input.testCaseId}:${input.controlId}`,
        action: "MAP",
        summary: `Mapped test case "${tc.title}" to control "${control.code}"`,
      });
    }),

  unmapTestCase: protectedProcedure
    .input(z.object({ testCaseId: z.string(), controlId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [tc, control] = await Promise.all([
        ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true, title: true } }),
        ctx.prisma.complianceControl.findUniqueOrThrow({ where: { id: input.controlId } }),
      ]);
      const { project } = await requireProjectAccess(ctx, tc.projectId, "EDITOR");
      await ctx.prisma.testCaseComplianceControl.deleteMany({
        where: { testCaseId: input.testCaseId, controlId: input.controlId },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: tc.projectId,
        actorId: ctx.user.id,
        entityType: "TestCaseComplianceControl",
        entityId: `${input.testCaseId}:${input.controlId}`,
        action: "UNMAP",
        summary: `Unmapped test case "${tc.title}" from control "${control.code}"`,
      });
    }),

  // Test cases in a project not yet mapped to a given control -- feeds a
  // "map an existing case to this control" picker.
  unmappedTestCases: protectedProcedure
    .input(z.object({ projectId: z.string(), controlId: z.string() }))
    .output(z.array(z.object({ id: z.string(), title: z.string() })))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.testCase.findMany({
        where: { projectId: input.projectId, complianceControls: { none: { controlId: input.controlId } } },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
        take: 200,
      });
    }),

  // P3-04: the auditor-handoff report -- unlike controlCoverage (a UI-
  // friendly count), this names the actual mapped test cases and their
  // current review status, since "evidence exists" isn't the same claim as
  // "evidence exists and someone signed off on it." Returned as structured
  // data; the client renders it to CSV (no server-side file generation
  // needed for a report this shaped).
  exportReport: protectedProcedure
    .input(z.object({ projectId: z.string(), frameworkId: z.string() }))
    .output(
      z.object({
        frameworkName: z.string(),
        projectName: z.string(),
        generatedAt: z.date(),
        controls: z.array(
          z.object({
            code: z.string(),
            title: z.string(),
            description: z.string().nullable(),
            mappedTestCases: z.array(z.object({ title: z.string(), reviewStatus: z.string() })),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const [project, framework] = await Promise.all([
        ctx.prisma.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { name: true } }),
        ctx.prisma.complianceFramework.findUniqueOrThrow({ where: { id: input.frameworkId } }),
      ]);
      const controls = await ctx.prisma.complianceControl.findMany({
        where: { frameworkId: input.frameworkId },
        include: {
          testCases: {
            where: { testCase: { projectId: input.projectId } },
            include: { testCase: { select: { title: true, reviewStatus: true } } },
          },
        },
        orderBy: { code: "asc" },
      });
      return {
        frameworkName: framework.name,
        projectName: project.name,
        generatedAt: new Date(),
        controls: controls.map((c) => ({
          code: c.code,
          title: c.title,
          description: c.description,
          mappedTestCases: c.testCases.map((m) => ({ title: m.testCase.title, reviewStatus: m.testCase.reviewStatus })),
        })),
      };
    }),
});
