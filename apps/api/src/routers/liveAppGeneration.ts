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
});

const observedElement = z
  .object({
    role: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(200),
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
  }));
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

      const { testCases } = await meterAiCall(ctx.prisma, charge, () =>
        generateTestCasesFromLiveApp(scan),
      );
      return serializeDrafts(testCases);
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
      const { testCases } = await meterAiCall(ctx.prisma, charge, () =>
        generateTestCasesFromLiveApp(scan),
      );
      return serializeDrafts(testCases);
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
      const created = await ctx.prisma.testCase.create({
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
          origin: "AI_LIVE_APP_GENERATED",
          reviewStatus: "PENDING_REVIEW",
          confidence: input.confidence,
          aiSnapshot: {
            title: input.title,
            background: input.background,
            given: input.given,
            when: input.when,
            then: input.then,
            tags: input.tags,
          },
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
      });
      return { id: created.id, organizationId: project.organizationId };
    }),
});
