import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { experienceProfileSchema } from "@vaettir/core";
import { z } from "zod";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Hash the complete persisted JSON, including fields this version does not know. */
export function qualityProfileHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function qualityProfileRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This project's saved profile needs review before it can be changed.",
    });
  }
  return value as Record<string, unknown>;
}

export function readQualityExperience(value: unknown) {
  const profile = qualityProfileRecord(value);
  const parsed =
    profile.experience === undefined
      ? null
      : experienceProfileSchema.safeParse(profile.experience);
  if (parsed && !parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This project's experience profile is unsupported or invalid. Review it before starting a new run.",
    });
  }
  return {
    experience: parsed?.success ? parsed.data : null,
    profileHash: qualityProfileHash(value),
  };
}

const reference = z.string().trim().max(300).default("");
/** Labels and references supplied by the tester, not proof of safety or compliance. */
export const runConfigurationSchema = z
  .object({
    configuration: z.string().trim().max(2000).default(""),
    platform: reference,
    build: reference,
    hardwareRevision: reference,
    firmwareVersion: reference,
    rig: reference,
    batchOrLot: reference,
    environment: z.string().trim().max(2000).default(""),
    calibrationReference: reference,
    protocolReference: reference,
  })
  .strict();

export const testPlanExecutionTemplateSchema = z
  .object({
    version: z.literal(1),
    testCaseIds: z.array(z.string().min(1).max(200)).max(500),
    configurations: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z.string().trim().min(1).max(120),
            context: runConfigurationSchema,
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.testCaseIds).size !== value.testCaseIds.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose each case only once",
        path: ["testCaseIds"],
      });
    if (
      new Set(value.configurations.map((c) => c.id)).size !==
      value.configurations.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Configuration identities must be unique",
        path: ["configurations"],
      });
  });

export const runPlanSnapshotSchema = z
  .object({
    testPlanId: z.string().min(1).max(200),
    name: z.string().max(10000),
    templateHash: z.string().regex(/^[a-f0-9]{64}$/),
    configurationId: z.string().uuid(),
    template: testPlanExecutionTemplateSchema,
  })
  .strict();

const procedureText = z.string().max(10000);
export const runCaseDefinitionSchema = z.object({
  testCaseId: z.string().max(200),
  title: z.string().max(10000),
  validationDomain: z.string().max(100),
  reviewStatus: z.string().max(100),
  background: procedureText.nullable(),
  given: z.array(procedureText).max(500),
  when: z.array(procedureText).max(500),
  then: z.array(procedureText).max(500),
  verificationProfile: z.object({
    setup: procedureText,
    safety: procedureText,
    instruments: procedureText,
    acceptanceCriteria: procedureText,
  }),
  steps: z
    .array(
      z.object({
        order: z.number().int().nonnegative(),
        action: procedureText,
        expectedActionOrData: procedureText.nullable().default(null),
        expectedResult: procedureText.nullable().default(null),
        expectedResponse: procedureText.nullable().default(null),
        mediaAttachmentIds: z.array(z.string().max(200)).max(100).default([]),
      }),
    )
    .max(500),
});

export const runExperienceSnapshotSchema = z.object({
  version: z.literal(1),
  experience: experienceProfileSchema.nullable(),
  profileHash: z.string().regex(/^[a-f0-9]{64}$/),
  startRequestHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  configuration: runConfigurationSchema,
  stepFieldLabels: z.record(z.string().max(200)),
  caseDefinitions: z.array(runCaseDefinitionSchema).max(500),
  plan: runPlanSnapshotSchema.optional(),
});

export function readRunExperienceSnapshot(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("version" in value)
  )
    return null;
  const parsed = runExperienceSnapshotSchema.safeParse(value);
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This run's saved definition snapshot is unsupported or invalid; it cannot be replaced by current case content.",
    });
  return parsed.data;
}

export function boundedRunSnapshot(value: unknown) {
  // Count strings before building a large encoded JSON string. Stored legacy
  // content is not a trusted size guarantee; exceeding the cap fails explicitly.
  let bytes = 0;
  const pending: unknown[] = [value];
  while (pending.length && bytes <= 2 * 1024 * 1024) {
    const entry = pending.pop();
    if (typeof entry === "string")
      bytes += Buffer.byteLength(entry, "utf8") + 2;
    else if (Array.isArray(entry)) {
      if (entry.length > 500)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "The selected case definitions exceed the bounded run snapshot. Reduce the run scope or simplify oversized case content; nothing was started.",
        });
      bytes += entry.length + 2;
      for (const child of entry) pending.push(child);
    } else if (entry && typeof entry === "object") {
      for (const [key, child] of Object.entries(entry)) {
        bytes += Buffer.byteLength(key, "utf8") + 4;
        pending.push(child);
      }
    } else bytes += 5;
  }
  if (bytes > 2 * 1024 * 1024)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The selected case definitions exceed the bounded run snapshot. Reduce the run scope or simplify oversized case content; nothing was started.",
    });
  const parsed = runExperienceSnapshotSchema.safeParse(value);
  if (
    !parsed.success ||
    Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > 2 * 1024 * 1024
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The selected case definitions exceed the bounded run snapshot. Reduce the run scope or simplify oversized case content; nothing was started.",
    });
  }
  return parsed.data;
}
