import { z } from "zod";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { recordAudit } from "../services/auditLog.js";
import { snapshotTestCaseVersion } from "../services/testCaseVersion.js";

// 2026-08-27 competitor parity audit: session-based exploratory testing.
// See the schema comment on ExploratorySession for why this isn't built
// on TestRun/TestResult (P5-16's manual execution) - no predefined steps,
// no pass/fail, just a charter and a running log.
export const exploratorySessionsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          charter: z.string(),
          status: z.string(),
          testerEmail: z.string(),
          startedAt: z.date(),
          endedAt: z.date().nullable(),
          noteCount: z.number(),
          findingCount: z.number(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const sessions = await ctx.prisma.exploratorySession.findMany({
        where: { projectId: input.projectId },
        include: { tester: { select: { email: true } }, notes: { select: { isFinding: true } } },
        orderBy: { startedAt: "desc" },
      });
      return sessions.map((s) => ({
        id: s.id,
        charter: s.charter,
        status: s.status,
        testerEmail: s.tester.email,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        noteCount: s.notes.length,
        findingCount: s.notes.filter((n) => n.isFinding).length,
      }));
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        projectId: z.string(),
        charter: z.string(),
        status: z.string(),
        testerEmail: z.string(),
        startedAt: z.date(),
        endedAt: z.date().nullable(),
        notes: z.array(
          z.object({ id: z.string(), text: z.string(), isFinding: z.boolean(), createdAt: z.date() }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const session = await ctx.prisma.exploratorySession.findUniqueOrThrow({
        where: { id: input.id },
        include: { tester: { select: { email: true } }, notes: { orderBy: { createdAt: "asc" } } },
      });
      await requireProjectAccess(ctx, session.projectId);
      return {
        id: session.id,
        projectId: session.projectId,
        charter: session.charter,
        status: session.status,
        testerEmail: session.tester.email,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        notes: session.notes.map((n) => ({ id: n.id, text: n.text, isFinding: n.isFinding, createdAt: n.createdAt })),
      };
    }),

  start: protectedProcedure
    .input(z.object({ projectId: z.string(), charter: z.string().min(1) }))
    .output(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const session = await ctx.prisma.exploratorySession.create({
        data: { projectId: input.projectId, charter: input.charter, testerId: ctx.user.id },
        select: { id: true },
      });
      return { sessionId: session.id };
    }),

  addNote: protectedProcedure
    .input(z.object({ sessionId: z.string(), text: z.string().min(1), isFinding: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.exploratorySession.findUniqueOrThrow({ where: { id: input.sessionId } });
      await requireProjectAccess(ctx, session.projectId, "EDITOR");
      const note = await ctx.prisma.exploratorySessionNote.create({
        data: { sessionId: input.sessionId, text: input.text, isFinding: input.isFinding },
      });
      return { id: note.id };
    }),

  complete: protectedProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
    const session = await ctx.prisma.exploratorySession.findUniqueOrThrow({ where: { id: input.sessionId } });
    await requireProjectAccess(ctx, session.projectId, "EDITOR");
    await ctx.prisma.exploratorySession.update({
      where: { id: input.sessionId },
      data: { status: "COMPLETED", endedAt: new Date() },
    });
  }),

  // The "convert session into a scripted test" move both qTest and
  // PractiTest support - a real TestCase, given/when/then built from the
  // charter (as the precondition/context) and each flagged finding (as
  // the observed outcome to guard against regressing). Deliberately only
  // uses findings, not every note - a note logged just to keep the
  // session's narrative complete isn't necessarily worth a permanent
  // regression case.
  convertToTestCase: protectedProcedure
    .input(z.object({ sessionId: z.string(), title: z.string().min(1) }))
    .output(z.object({ testCaseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.exploratorySession.findUniqueOrThrow({
        where: { id: input.sessionId },
        include: { notes: { where: { isFinding: true }, orderBy: { createdAt: "asc" } } },
      });
      const { project } = await requireProjectAccess(ctx, session.projectId, "EDITOR");

      const testCase = await ctx.prisma.testCase.create({
        data: {
          projectId: session.projectId,
          title: input.title,
          given: [session.charter],
          when: ["The scenario explored in this session is repeated"],
          then: session.notes.length > 0 ? session.notes.map((n) => n.text) : ["No regressions from the explored findings"],
          testType: "EXPLORATORY",
          origin: "AUTHORED",
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: session.projectId,
        actorId: ctx.user.id,
        entityType: "TestCase",
        entityId: testCase.id,
        action: "CREATE",
        summary: `Created test case "${testCase.title}" from exploratory session findings`,
      });
      await snapshotTestCaseVersion(ctx.prisma, {
        testCaseId: testCase.id,
        title: testCase.title,
        background: testCase.background,
        given: testCase.given,
        when: testCase.when,
        then: testCase.then,
        steps: [],
        tags: testCase.tags,
        priority: testCase.priority,
        testType: testCase.testType,
        actorId: ctx.user.id,
      });
      return { testCaseId: testCase.id };
    }),
});
