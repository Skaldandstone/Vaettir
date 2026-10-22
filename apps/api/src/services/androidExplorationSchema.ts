import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) =>
      Array.from(v).every(
        (c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127,
      ),
    );
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const androidExplorationScope = z
  .object({
    projectId: text(200),
    organizationId: text(200),
    actorId: text(200),
    sessionId: text(200),
  })
  .strict();
export const androidExplorerTarget = z
  .object({
    version: z.literal(1),
    ticket: z.string().regex(/^[a-f0-9]{48}$/),
    packageName: text(200),
    expiresAt: z.number().int(),
  })
  .strict();
export const androidExplorerDevices = z
  .object({
    devices: z
      .array(
        z
          .object({
            id: text(200),
            name: text(200),
            status: text(80),
            ready: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const androidExplorerCapabilities = z
  .object({
    version: z.literal(1),
    platform: z.literal("ANDROID"),
    localNavigation: z.literal(true),
    aiProcessing: z.literal(false),
    maxActions: z.literal(24),
    maxScreens: z.literal(12),
    maxSeconds: z.literal(300),
  })
  .strict();
const screen = z.object({ id: digest, label: text(200) }).strict();
export const observedNavigationStep = z
  .object({
    sequence: z.number().int().min(1).max(24),
    action: z
      .object({
        kind: z.enum(["TAP", "SCROLL"]),
        label: text(200),
        targetId: digest,
      })
      .strict(),
    from: screen,
    to: screen,
    observedAt: z.string().datetime(),
  })
  .strict();
export const observedNavigationJourney = z
  .object({
    id: digest,
    sessionId: z.string().regex(/^[a-f0-9]{48}$/),
    packageName: z
      .string()
      .min(3)
      .max(200)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/),
    startedAt: z.string().datetime(),
    steps: z.array(observedNavigationStep).min(1).max(24),
  })
  .strict()
  .superRefine((journey, context) => {
    for (let i = 0; i < journey.steps.length; i++) {
      const step = journey.steps[i]!;
      if (
        step.from.id === step.to.id ||
        Date.parse(step.observedAt) < Date.parse(journey.startedAt) ||
        (i > 0 &&
          (journey.steps[i - 1]!.to.id !== step.from.id ||
            journey.steps[i - 1]!.sequence >= step.sequence))
      )
        context.addIssue({
          code: "custom",
          message:
            "A proposed journey must contain a continuous, ordered observed path.",
        });
    }
    if (journey.steps.at(-1)?.action.kind !== "TAP")
      context.addIssue({
        code: "custom",
        message:
          "Choose a journey that reached a destination through navigation.",
      });
  });
export type ObservedNavigationJourney = z.infer<
  typeof observedNavigationJourney
>;
export function navigationProposal(journey: ObservedNavigationJourney) {
  const value = observedNavigationJourney.parse(journey),
    first = value.steps[0]!,
    last = value.steps.at(-1)!;
  return {
    title: `Navigate to ${last.to.label}`,
    given: [
      `Open ${value.packageName} at ${first.from.label} using the reviewed test account.`,
    ],
    when: value.steps.map((step) =>
      step.action.kind === "SCROLL"
        ? `Scroll down on ${step.from.label}.`
        : `Choose ${step.action.label} on ${step.from.label}.`,
    ),
    then: [`Review that ${last.to.label} is displayed.`],
    reviewNote:
      "Proposed navigation check from a locally reported observed journey. Expected behavior requires human review; this is not an executed test, business-rule validation or coverage claim.",
  };
}
export const androidExplorationCommit = z
  .object({
    projectId: text(200),
    originalOrganizationId: text(200),
    expectedClerkActorId: text(200),
    requestId: z.string().uuid(),
    acknowledgeDisclosure: z.literal(true),
    journeys: z.array(observedNavigationJourney).min(1).max(12),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.journeys.map((j) => j.id)).size !== value.journeys.length ||
      value.journeys.some(
        (j) =>
          j.sessionId !== value.journeys[0]!.sessionId ||
          j.packageName !== value.journeys[0]!.packageName,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Select distinct journeys from one reviewed app session.",
      });
  });
export const androidExplorationReceipt = z
  .object({
    projectId: text(200),
    organizationId: text(200),
    actorClerkId: text(200),
    requestId: z.string().uuid(),
    requestHash: digest,
    cases: z
      .array(z.object({ journeyId: digest, caseId: text(200) }).strict())
      .max(12),
  })
  .strict();

export const androidExplorerState = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-f0-9]{48}$/),
    packageName: text(200),
    scope: androidExplorationScope,
    status: z.enum(["ACTIVE", "PAUSED", "STOPPED", "COMPLETED"]),
    reason: z.string().nullable(),
    startedAt: z.string().datetime(),
    expiresAt: z.number().int(),
    sequence: z.number().int().min(0).max(24),
    actionCount: z.number().int().min(0).max(24),
    limits: z
      .object({
        actions: z.number().int().min(1).max(24),
        screens: z.number().int().min(1).max(12),
        seconds: z.number().int().min(1).max(300),
      })
      .strict(),
    screens: z
      .array(
        screen
          .extend({
            controls: z
              .array(
                z
                  .object({
                    id: digest,
                    name: text(200),
                    role: text(80),
                    navigable: z.boolean(),
                  })
                  .strict(),
              )
              .max(150),
          })
          .strict(),
      )
      .max(12),
    journeys: z.array(observedNavigationJourney).max(24),
    skippedControls: z.number().int().nonnegative().max(150),
    lastOperation: z
      .object({
        requestId: z.string().uuid(),
        sequence: z.number().int().min(1).max(24),
        actionAttempted: z.boolean(),
        outcome: z.enum(["UNVERIFIED", "OBSERVED", "NO_ACTION"]),
      })
      .strict()
      .nullable(),
    observation: z.literal("BEFORE_AFTER_NOT_ATOMIC"),
    aiProcessingPerformed: z.literal(false),
    backgroundNavigation: z.literal(false),
  })
  .strict();
