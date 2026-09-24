import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { generateTestCasesFromLiveApp } from "@vaettir/ai-agent";
import { router, requireProjectAccess, liveAppScanProcedure } from "../trpc.js";
import {
  chargeAiCredits,
  InsufficientAiCreditsError,
  meterAiCall,
} from "../services/aiCredits.js";
import { scanLiveApp, LiveAppScanError } from "../services/liveAppScan.js";
import { UnsafeUrlError } from "../services/urlGuard.js";
import { snapshotTestCaseVersion } from "../services/testCaseVersion.js";

// SSE-181: live-app test generation. Deliberately its own router, its own
// review surface (see the web page), and its own origin tag
// (AI_LIVE_APP_GENERATED) rather than folded into the existing reverse-
// engineering review queue - there's no prior test to diff a generated
// case against, which is a real, visible difference a reviewer should see.
// Gated by liveAppScanProcedure (a tight allowlist, not the general staff
// gate) since server-side browser automation against a caller-supplied URL
// is a genuinely new, unproven capability - see trpc.ts's own comment.
const draftOutput = z.object({
  title: z.string(),
  background: z.string().nullable(),
  given: z.array(z.string()),
  when: z.array(z.string()),
  then: z.array(z.string()),
  tags: z.array(z.string()),
  testType: z.string(),
  confidence: z.number(),
  notes: z.string().nullable(),
  coverageDisposition: z.enum(["NEW_COVERAGE", "STALE_EXISTING"]),
  matchedExistingTestCaseId: z.string().nullable(),
  matchedExistingTestCaseTitle: z.string().nullable(),
  matchedExistingUpdatedAt: z.string().nullable(),
  coverageRationale: z.string(),
  observedReleaseCommit: z.string(),
  steps: z.array(
    z.object({
      action: z.string(),
      target: z.object({
        role: z.string(),
        name: z.string(),
        stableId: z.string().optional(),
        selector: z.string().optional(),
        event: z.string().optional(),
        route: z.string().optional(),
      }),
      input: z.string().nullable().optional(),
      expectedResult: z.string(),
      expectedResponse: z.string().nullable().optional(),
    }),
  ),
});

const observedElement = z
  .object({
    role: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(200),
    stableId: z.string().trim().min(1).max(200).optional(),
    selector: z.string().trim().min(1).max(500).optional(),
    event: z.string().trim().min(1).max(80).optional(),
    route: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const deviceCaptureInput = z
  .object({
    version: z.literal(1),
    source: z.enum(["ANDROID_ADB", "IOS_CONNECTED", "IOS_REMOTE"]),
    deviceName: z.string().trim().min(1).max(200),
    appName: z.string().trim().min(1).max(200).optional(),
    capturedAt: z.string().datetime(),
    screens: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(120),
            label: z.string().trim().min(1).max(200),
            elements: z.array(observedElement).max(150),
          })
          .strict(),
      )
      .min(1)
      .max(25),
  })
  .strict();

function serializeDrafts(
  testCases: Awaited<
    ReturnType<typeof generateTestCasesFromLiveApp>
  >["testCases"],
  existingCases: Map<string, { title: string; updatedAt: string }>,
) {
  return testCases.map((testCase) => ({
    title: testCase.title,
    background: testCase.background ?? null,
    given: testCase.given,
    when: testCase.when,
    then: testCase.then,
    tags: testCase.tags,
    testType: testCase.testType,
    confidence: testCase.confidence,
    notes: testCase.notes ?? null,
    coverageDisposition: testCase.coverageDisposition,
    matchedExistingTestCaseId: testCase.matchedExistingTestCaseId,
    matchedExistingTestCaseTitle: testCase.matchedExistingTestCaseId
      ? (existingCases.get(testCase.matchedExistingTestCaseId)?.title ?? null)
      : null,
    matchedExistingUpdatedAt: testCase.matchedExistingTestCaseId
      ? (existingCases.get(testCase.matchedExistingTestCaseId)?.updatedAt ??
        null)
      : null,
    coverageRationale: testCase.coverageRationale,
    observedReleaseCommit: testCase.observedReleaseCommit,
    steps: testCase.steps,
  }));
}

const RELEASE_COMMIT =
  process.env.VAETTIR_RELEASE_COMMIT?.trim() || "unverified-local-build";

async function existingInventory(
  prisma: Parameters<typeof requireProjectAccess>[0]["prisma"],
  projectId: string,
) {
  const cases = await prisma.testCase.findMany({
    where: { projectId, archived: false },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      given: true,
      when: true,
      then: true,
      testType: true,
      updatedAt: true,
      steps: {
        orderBy: { order: "asc" },
        select: {
          action: true,
          expectedActionOrData: true,
          expectedResult: true,
        },
      },
    },
  });
  return cases.map((testCase) => ({
    ...testCase,
    testType: String(testCase.testType),
    updatedAt: testCase.updatedAt.toISOString(),
  }));
}

function technicalTarget(
  step: z.infer<typeof draftOutput>["steps"][number],
): string {
  return [
    `role=${step.target.role}`,
    `name=${JSON.stringify(step.target.name)}`,
    step.target.stableId
      ? `objectId=${JSON.stringify(step.target.stableId)}`
      : null,
    step.target.selector
      ? `selector=${JSON.stringify(step.target.selector)}`
      : null,
    step.target.event ? `event=${step.target.event}` : null,
    step.target.route ? `route=${JSON.stringify(step.target.route)}` : null,
    step.input ? `input=${JSON.stringify(step.input)}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

export const liveAppGenerationRouter = router({
  // Crawls startUrl (and up to 4 same-origin links found on it) and
  // generates BDD test cases grounded in what was actually observed.
  // Nothing is persisted here - same review-before-commit shape as every
  // other AI-generation feature in this codebase.
  generateFromUrl: liveAppScanProcedure
    .input(z.object({ projectId: z.string(), startUrl: z.string().min(1) }))
    .output(z.array(draftOutput))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      const charge = await chargeAiCredits(
        ctx.prisma,
        project.organizationId,
        "generateTestCasesFromLiveApp",
      ).catch((e: unknown) => {
        if (e instanceof InsufficientAiCreditsError)
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        throw e;
      });

      let scan;
      try {
        scan = await scanLiveApp(input.startUrl);
      } catch (err) {
        if (err instanceof LiveAppScanError || err instanceof UnsafeUrlError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }

      const existingTestCases = await existingInventory(
        ctx.prisma,
        input.projectId,
      );
      const generationInput = {
        ...scan,
        existingTestCases,
        releaseCommit: RELEASE_COMMIT,
      };

      const { testCases } = await meterAiCall(ctx.prisma, charge, () =>
        generateTestCasesFromLiveApp(generationInput),
      );
      return serializeDrafts(
        testCases,
        new Map(
          existingTestCases.map((testCase) => [
            testCase.id,
            { title: testCase.title, updatedAt: testCase.updatedAt },
          ]),
        ),
      );
    }),

  // Local ADB, connected-iOS (Appium/WebDriverAgent), and remote-iOS
  // sessions are captured outside the hosted API, then uploaded as a
  // bounded semantic manifest. Raw screenshots, credentials, Appium URLs,
  // and device hierarchy XML are deliberately not accepted or persisted.
  generateFromDeviceCapture: liveAppScanProcedure
    .input(z.object({ projectId: z.string(), capture: deviceCaptureInput }))
    .output(z.array(draftOutput))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      const charge = await chargeAiCredits(
        ctx.prisma,
        project.organizationId,
        "generateTestCasesFromLiveApp",
      ).catch((error: unknown) => {
        if (error instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      });

      const platform =
        input.capture.source === "ANDROID_ADB" ? "android" : "ios";
      const sourceName = input.capture.appName
        ? `${input.capture.appName} on ${input.capture.deviceName}`
        : input.capture.deviceName;
      const scan = {
        startUrl: `device://${platform}/${encodeURIComponent(input.capture.deviceName)}`,
        source: { kind: platform, name: sourceName } as const,
        pages: input.capture.screens.map((screen, index) => ({
          url: `device://${platform}/screen/${index + 1}`,
          title: screen.label,
          elements: screen.elements,
        })),
      };
      const existingTestCases = await existingInventory(
        ctx.prisma,
        input.projectId,
      );
      const generationInput = {
        ...scan,
        existingTestCases,
        releaseCommit: RELEASE_COMMIT,
      };
      const { testCases } = await meterAiCall(ctx.prisma, charge, () =>
        generateTestCasesFromLiveApp(generationInput),
      );
      return serializeDrafts(
        testCases,
        new Map(
          existingTestCases.map((testCase) => [
            testCase.id,
            { title: testCase.title, updatedAt: testCase.updatedAt },
          ]),
        ),
      );
    }),

  // Commits one reviewed draft as a real TestCase, tagged distinctly from
  // both AUTHORED and AI_REVERSE_ENGINEERED. Starts PENDING_REVIEW, same
  // as reverse-engineered cases - there's no prior test to compare
  // against, but this is still AI output that hasn't had a human decision
  // yet, so it goes through the same approve/reject gate every other
  // AI-origin case does (testCases.approve/reject, unchanged).
  commitDraft: liveAppScanProcedure
    .input(draftOutput.extend({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      if (input.observedReleaseCommit !== RELEASE_COMMIT) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This draft was generated from a different release. Generate it again before saving.",
        });
      }
      const stepData = input.steps.map((step, order) => ({
        order,
        action: step.action,
        expectedActionOrData: technicalTarget(step),
        expectedResult: step.expectedResult,
        expectedResponse: step.expectedResponse ?? null,
      }));
      const snapshot = {
        title: input.title,
        background: input.background,
        given: input.given,
        when: input.when,
        then: input.then,
        tags: input.tags,
        observedReleaseCommit: input.observedReleaseCommit,
        coverageDisposition: input.coverageDisposition,
        coverageRationale: input.coverageRationale,
        matchedExistingTestCaseId: input.matchedExistingTestCaseId,
        steps: input.steps,
      };

      let saved;
      if (input.coverageDisposition === "STALE_EXISTING") {
        if (!input.matchedExistingTestCaseId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A stale-case update must identify the existing case.",
          });
        }
        const existing = await ctx.prisma.testCase.findFirst({
          where: {
            id: input.matchedExistingTestCaseId,
            projectId: input.projectId,
            archived: false,
          },
          select: { id: true, updatedAt: true },
        });
        if (!existing)
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "The matched existing case no longer exists in this project.",
          });
        if (
          !input.matchedExistingUpdatedAt ||
          existing.updatedAt.toISOString() !== input.matchedExistingUpdatedAt
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The existing case changed after this draft was generated. Generate it again before updating.",
          });
        }
        saved = await ctx.prisma.testCase.update({
          where: { id: existing.id },
          data: {
            title: input.title,
            background: input.background,
            given: input.given,
            when: input.when,
            then: input.then,
            tags: input.tags,
            testType: input.testType as never,
            automationStatus: "NEEDS_AUTOMATION",
            reviewStatus: "PENDING_REVIEW",
            reviewedById: null,
            reviewedAt: null,
            reviewNote: `Live-app update from release ${input.observedReleaseCommit}: ${input.coverageRationale}`,
            confidence: input.confidence,
            aiSnapshot: snapshot,
            updatedById: ctx.user.id,
            steps: { deleteMany: {}, create: stepData },
          },
        });
      } else {
        if (input.matchedExistingTestCaseId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "New coverage cannot target an existing case.",
          });
        }
        saved = await ctx.prisma.testCase.create({
          data: {
            projectId: input.projectId,
            title: input.title,
            background: input.background,
            given: input.given,
            when: input.when,
            then: input.then,
            tags: input.tags,
            testType: input.testType as never,
            priority: "MEDIUM",
            automationStatus: "NEEDS_AUTOMATION",
            origin: "AI_LIVE_APP_GENERATED",
            reviewStatus: "PENDING_REVIEW",
            confidence: input.confidence,
            aiSnapshot: snapshot,
            steps: { create: stepData },
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        });
      }
      await snapshotTestCaseVersion(ctx.prisma, {
        testCaseId: saved.id,
        title: saved.title,
        background: saved.background,
        given: saved.given,
        when: saved.when,
        then: saved.then,
        steps: stepData.map((step) => ({
          ...step,
          expectedActionOrData: step.expectedActionOrData || null,
        })),
        tags: saved.tags,
        priority: saved.priority,
        testType: saved.testType,
        actorId: ctx.user.id,
      });
      return {
        id: saved.id,
        organizationId: project.organizationId,
        action:
          input.coverageDisposition === "STALE_EXISTING"
            ? "UPDATED"
            : "CREATED",
      };
    }),
});
