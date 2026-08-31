import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, staffProcedure, requireProjectAccess } from "../trpc.js";
import { recordAudit } from "../services/auditLog.js";
import { dispatchWebhookEvent } from "../services/webhookDelivery.js";
import { requireEvidenceReferences } from "../services/projectReferences.js";

// P3-01/P3-03: ComplianceFramework/ComplianceControl are shared reference
// data across every org (same pattern as TestPlanType, not project- or
// org-scoped) -- seeded frameworks exist (SOC 2, HIPAA, PCI DSS, GDPR,
// ISO 27001) but with zero controls under them until an org adds its own,
// or adds an entirely custom framework (isBuiltIn: false marks the
// difference in the UI). Definitions are staff-managed during private beta
// because this catalog is global, not private tenant content.
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

  createFramework: staffProcedure
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

  // P3-02: bulk-import a control set (AICPA TSC, NIST CSF, etc.) from
  // structured data an admin already has - a spreadsheet export, a vendor's
  // published control list - rather than hand-typing each control through
  // createControl one at a time, and rather than this codebase hand-seeding
  // (and silently going stale on) the text of external published standards.
  // skipDuplicates means re-importing an updated file is safe to run again:
  // existing (frameworkId, code) rows are left alone, not overwritten.
  importControls: staffProcedure
    .input(
      z.object({
        frameworkId: z.string(),
        controls: z
          .array(z.object({ code: z.string().min(1), title: z.string().min(1), description: z.string().optional() }))
          .min(1)
          .max(500),
      }),
    )
    .output(z.object({ createdCount: z.number(), skippedCount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.complianceFramework.findUniqueOrThrow({ where: { id: input.frameworkId } });
      const result = await ctx.prisma.complianceControl.createMany({
        data: input.controls.map((c) => ({
          frameworkId: input.frameworkId,
          code: c.code,
          title: c.title,
          description: c.description,
        })),
        skipDuplicates: true,
      });
      return { createdCount: result.count, skippedCount: input.controls.length - result.count };
    }),

  createControl: staffProcedure
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

  // Test cases already mapped to a control -- feeds the "record evidence"
  // picker (evidence only makes sense for a case actually mapped to the
  // control it's meant to prove).
  mappedTestCases: protectedProcedure
    .input(z.object({ projectId: z.string(), controlId: z.string() }))
    .output(z.array(z.object({ id: z.string(), title: z.string() })))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const mappings = await ctx.prisma.testCaseComplianceControl.findMany({
        where: { controlId: input.controlId, testCase: { projectId: input.projectId } },
        include: { testCase: { select: { id: true, title: true } } },
      });
      return mappings.map((m) => ({ id: m.testCase.id, title: m.testCase.title }));
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

  // P3-05: records a dated, immutable proof point for a control -- "this
  // specific execution passed on this date" (or a manual attestation with
  // no automated result behind it), distinct from the structural
  // testCases mapping above which only claims "this case is designed to
  // verify this control." No update/delete mutation exists for this model
  // anywhere in the API -- a wrong record is superseded by a new one, not
  // edited.
  recordEvidence: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        controlId: z.string(),
        testCaseId: z.string(),
        testResultId: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .output(
      z.object({
        id: z.string(),
        controlId: z.string(),
        testCaseId: z.string(),
        testResultId: z.string().nullable(),
        note: z.string().nullable(),
        recordedAt: z.date(),
        recordedByEmail: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const evidence = await ctx.prisma.$transaction(async (tx) => {
        await requireEvidenceReferences(tx, input);
        return tx.complianceEvidence.create({
          data: {
            projectId: input.projectId,
            controlId: input.controlId,
            testCaseId: input.testCaseId,
            testResultId: input.testResultId,
            note: input.note,
            recordedById: ctx.user.id,
          },
          include: { recordedBy: { select: { email: true } } },
        });
      });
      await recordAudit(ctx.prisma, {
        organizationId: (await ctx.prisma.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { organizationId: true } }))
          .organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType: "ComplianceEvidence",
        entityId: evidence.id,
        action: "CREATE",
        summary: `Recorded evidence for a compliance control`,
      });
      return {
        id: evidence.id,
        controlId: evidence.controlId,
        testCaseId: evidence.testCaseId,
        testResultId: evidence.testResultId,
        note: evidence.note,
        recordedAt: evidence.recordedAt,
        recordedByEmail: evidence.recordedBy.email,
      };
    }),

  listEvidence: protectedProcedure
    .input(z.object({ projectId: z.string(), controlId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          testCaseId: z.string(),
          testCaseTitle: z.string(),
          testResultId: z.string().nullable(),
          note: z.string().nullable(),
          recordedAt: z.date(),
          recordedByEmail: z.string(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const rows = await ctx.prisma.complianceEvidence.findMany({
        where: { projectId: input.projectId, controlId: input.controlId, testCase: { projectId: input.projectId } },
        include: { testCase: { select: { title: true } }, recordedBy: { select: { email: true } } },
        orderBy: { recordedAt: "desc" },
      });
      return rows.map((r) => ({
        id: r.id,
        testCaseId: r.testCaseId,
        testCaseTitle: r.testCase.title,
        testResultId: r.testResultId,
        note: r.note,
        recordedAt: r.recordedAt,
        recordedByEmail: r.recordedBy.email,
      }));
    }),

  // P3-07: a ComplianceAuditor's (or org ADMIN/OWNER, as an override)
  // formal, durable attestation that a control was reviewed and is
  // operating effectively for a given period. Deliberately gated by ROLE,
  // not just project access level -- COMPLIANCE_AUDITOR ranks below EDITOR
  // in this app's general permission hierarchy (trpc.ts's ROLE_RANK), so
  // requireProjectAccess's minRole check can't express "must actually hold
  // this specific role," hence the explicit membership.role check below.
  signOffControl: protectedProcedure
    .input(z.object({ projectId: z.string(), controlId: z.string(), period: z.string().min(1), statement: z.string().min(1) }))
    .output(
      z.object({
        id: z.string(),
        controlId: z.string(),
        period: z.string(),
        statement: z.string(),
        signedAt: z.date(),
        signedByEmail: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { membership } = await requireProjectAccess(ctx, input.projectId);
      if (membership.seatType === "READ_ONLY" || !["COMPLIANCE_AUDITOR", "ADMIN", "OWNER"].includes(membership.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a Compliance Auditor (or an org Admin/Owner) can sign off on a control",
        });
      }
      const signOff = await ctx.prisma.complianceSignOff.create({
        data: {
          projectId: input.projectId,
          controlId: input.controlId,
          period: input.period,
          statement: input.statement,
          signedById: ctx.user.id,
        },
        include: { signedBy: { select: { email: true } } },
      });
      const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { organizationId: true } });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType: "ComplianceSignOff",
        entityId: signOff.id,
        action: "CREATE",
        summary: `Signed off on a compliance control for ${input.period}`,
      });
      void dispatchWebhookEvent(ctx.prisma, project.organizationId, "compliance.sign_off_recorded", {
        projectId: input.projectId,
        controlId: input.controlId,
        period: input.period,
        signedByEmail: signOff.signedBy.email,
      }).catch(() => undefined);
      return {
        id: signOff.id,
        controlId: signOff.controlId,
        period: signOff.period,
        statement: signOff.statement,
        signedAt: signOff.signedAt,
        signedByEmail: signOff.signedBy.email,
      };
    }),

  listSignOffs: protectedProcedure
    .input(z.object({ projectId: z.string(), controlId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          period: z.string(),
          statement: z.string(),
          signedAt: z.date(),
          signedByEmail: z.string(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const rows = await ctx.prisma.complianceSignOff.findMany({
        where: { projectId: input.projectId, controlId: input.controlId },
        include: { signedBy: { select: { email: true } } },
        orderBy: { signedAt: "desc" },
      });
      return rows.map((r) => ({
        id: r.id,
        period: r.period,
        statement: r.statement,
        signedAt: r.signedAt,
        signedByEmail: r.signedBy.email,
      }));
    }),
});
