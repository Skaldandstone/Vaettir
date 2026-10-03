import { z } from "zod";

export const MAX_PROCEDURE_EXPORT_BYTES = 8 * 1024 * 1024;
export const MAX_PROCEDURE_EXPORT_CASES = 2000;
const text = z.string().max(100_000);
const identity = z.string().min(1).max(200);
const labels = z.array(text).max(5000);

export const exportedProcedureStepSchema = z
  .object({
    order: z.number().int().nonnegative(),
    action: text,
    expectedActionOrData: text.nullable(),
    expectedResult: text.nullable(),
    expectedResponse: text.nullable(),
    mediaAttachmentIds: z.array(identity).max(100),
  })
  .strict();

const profileSchema = z
  .unknown()
  .superRefine((value, context) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (
      Object.keys(value).length > 32 ||
      Object.keys(value).some((key) =>
        ["__proto__", "prototype", "constructor"].includes(key),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Unsupported procedure profile fields",
      });
    }
  })
  .pipe(z.record(text));

export const exportedCaseProcedureSchema = z
  .object({
    id: identity,
    displayId: identity,
    caseNumber: z.number().int().positive(),
    title: text,
    background: text.nullable(),
    given: labels,
    when: labels,
    then: labels,
    // Both are retained. A shared-library reference does not erase otherwise
    // inactive authored steps; resolvedSteps states what a tester currently sees.
    authoredSteps: z.array(exportedProcedureStepSchema).max(5000),
    resolvedSteps: z.array(exportedProcedureStepSchema).max(5000),
    sharedStepGroup: z.object({ id: identity, name: text }).strict().nullable(),
    validationDomain: text,
    verificationProfile: profileSchema,
    suitePath: text.nullable(),
    testType: text,
    automationStatus: text,
    priority: text,
    origin: text,
    reviewStatus: text,
    archived: z.boolean(),
    tags: labels,
    prerequisites: z
      .array(
        z
          .object({
            id: identity,
            displayId: identity,
            title: text,
            archived: z.boolean(),
          })
          .strict(),
      )
      .max(2000),
    mediaReferences: z
      .array(
        z
          .object({
            id: identity,
            fileName: text,
            contentType: text,
            sizeBytes: z.number().int().nonnegative().safe(),
            uploadMetadataVerified: z.boolean(),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict()
  .superRefine((procedure, context) => {
    const media = new Map(
      procedure.mediaReferences.map((item) => [item.id, item]),
    );
    if (media.size !== procedure.mediaReferences.length) {
      context.addIssue({
        code: "custom",
        message: "Duplicate media references",
      });
    }
    for (const steps of [procedure.authoredSteps, procedure.resolvedSteps]) {
      if (
        steps.some(
          (step, index) => index > 0 && step.order <= steps[index - 1]!.order,
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Procedure step order must be unique and increasing",
        });
      }
      for (const step of steps) {
        if (
          new Set(step.mediaAttachmentIds).size !==
            step.mediaAttachmentIds.length ||
          step.mediaAttachmentIds.some((id) => {
            const reference = media.get(id);
            return (
              !reference || !/^(image|video)\//i.test(reference.contentType)
            );
          })
        )
          context.addIssue({
            code: "custom",
            message:
              "Every step media reference must identify an image or video on this case",
          });
      }
    }
    if (
      new Set(procedure.prerequisites.map((item) => item.id)).size !==
        procedure.prerequisites.length ||
      procedure.prerequisites.some((item) => item.id === procedure.id)
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid prerequisite references",
      });
    }
  });

export const caseProcedureExportSchema = z
  .object({
    format: z.literal("vaettir.case-procedure"),
    version: z.literal(1),
    capturedAt: z.string().datetime(),
    project: z.object({ id: identity, name: text, caseKey: identity }).strict(),
    scope: z
      .object({
        kind: z.enum(["selected", "filtered"]),
        includeArchived: z.boolean(),
      })
      .strict(),
    importSupported: z.literal(false),
    excluded: z.tuple([
      z.literal("attachment-bytes"),
      z.literal("datasets"),
      z.literal("case-and-run-history"),
      z.literal("paid-drafts"),
      z.literal("document-bytes"),
    ]),
    cases: z.array(exportedCaseProcedureSchema).max(MAX_PROCEDURE_EXPORT_CASES),
  })
  .strict()
  .superRefine((bundle, context) => {
    if (
      new Set(bundle.cases.map((item) => item.id)).size !==
        bundle.cases.length ||
      new Set(bundle.cases.map((item) => item.displayId)).size !==
        bundle.cases.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Duplicate case identities",
      });
    }
    if (
      !bundle.scope.includeArchived &&
      bundle.cases.some((item) => item.archived)
    ) {
      context.addIssue({
        code: "custom",
        message: "Archived cases are outside the approved export scope",
      });
    }
  });

export type CaseProcedureExport = z.infer<typeof caseProcedureExportSchema>;

function bounded(text: string): void {
  // Core has no DOM/Node dependency. Iterating code points also counts lone
  // surrogates as UTF-8 replacement characters (three bytes), like UTF-8 I/O.
  let bytes = 0;
  if (text.length <= MAX_PROCEDURE_EXPORT_BYTES) {
    for (const character of text) {
      const point = character.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (bytes > MAX_PROCEDURE_EXPORT_BYTES) break;
    }
  }
  if (
    text.length > MAX_PROCEDURE_EXPORT_BYTES ||
    bytes > MAX_PROCEDURE_EXPORT_BYTES
  ) {
    throw new Error(
      "Procedure export exceeds 8 MiB. Choose a smaller scope; no partial export was generated.",
    );
  }
}

export function encodeCaseProcedureExport(bundle: CaseProcedureExport): string {
  const validated = caseProcedureExportSchema.parse(bundle);
  const serialized = JSON.stringify(validated, null, 2);
  bounded(serialized);
  return serialized;
}

// Validation-only decoder. It never writes records, resolves URLs, fetches
// attachments or executes anything. It is not an approved case importer.
export function decodeCaseProcedureExport(
  serialized: string,
): CaseProcedureExport {
  bounded(serialized);
  return caseProcedureExportSchema.parse(JSON.parse(serialized));
}
