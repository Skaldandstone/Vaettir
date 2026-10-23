import { describe, expect, it } from "vitest";
import {
  decodeCaseProcedureExport,
  encodeCaseProcedureExport,
  type CaseProcedureExport,
  MAX_PROCEDURE_EXPORT_BYTES,
} from "./caseProcedureExport.js";

function fixture(): CaseProcedureExport {
  return {
    format: "vaettir.case-procedure",
    version: 1,
    capturedAt: "2026-10-03T06:00:00.000Z",
    project: {
      id: "synthetic-project",
      name: "Synthetic α",
      caseKey: "synthetic",
    },
    scope: { kind: "selected", includeArchived: false },
    importSupported: false,
    excluded: [
      "attachment-bytes",
      "datasets",
      "case-and-run-history",
      "paid-drafts",
      "document-bytes",
    ],
    cases: [
      {
        id: "synthetic-case",
        displayId: "synthetic-01",
        caseNumber: 1,
        title: "=literal title",
        background: "  Preserve whitespace\n背景  ",
        given: ["a|b", "two\nlines"],
        when: ["an action"],
        then: ["an outcome"],
        authoredSteps: [
          {
            order: 0,
            action: "owned|action",
            expectedActionOrData: '{"a":1}',
            expectedResult: "pass\nnext line",
            expectedResponse: null,
            mediaAttachmentIds: ["media-1"],
          },
        ],
        resolvedSteps: [
          {
            order: 7,
            action: "shared snapshot",
            expectedActionOrData: null,
            expectedResult: "actual expected",
            expectedResponse: "200",
            mediaAttachmentIds: [],
          },
        ],
        sharedStepGroup: { id: "shared-1", name: "Shared setup" },
        validationDomain: "HIL",
        verificationProfile: {
          setup: "Calibrated rig",
          safety: "Stop condition",
          instruments: "Fixture meter",
          acceptanceCriteria: "Owner-entered criterion",
        },
        suitePath: "hardware/setup",
        testType: "UNIT",
        automationStatus: "AUTOMATED",
        priority: "HIGH",
        origin: "IMPORTED",
        reviewStatus: "APPROVED",
        archived: false,
        tags: ["a|b", "α"],
        prerequisites: [
          {
            id: "case-prior",
            displayId: "synthetic-02",
            title: "Required state",
            archived: true,
          },
        ],
        mediaReferences: [
          {
            id: "media-1",
            fileName: "step image.png",
            contentType: "image/png",
            sizeBytes: 31,
            uploadMetadataVerified: false,
          },
        ],
      },
    ],
  };
}

describe("bounded lossless case procedure export", () => {
  it("preserves exact BDD, structured/shared procedures, domain and metadata without delimiter or formula remapping", () => {
    const input = fixture();
    expect(decodeCaseProcedureExport(encodeCaseProcedureExport(input))).toEqual(
      input,
    );
  });
  it("preserves structured-only and title-only draft cases rather than requiring artificial BDD", () => {
    const input = fixture();
    input.cases[0]!.given = [];
    input.cases[0]!.when = [];
    input.cases[0]!.then = [];
    expect(
      decodeCaseProcedureExport(encodeCaseProcedureExport(input)).cases[0]!
        .authoredSteps,
    ).toEqual(input.cases[0]!.authoredSteps);
    input.cases[0]!.authoredSteps = [];
    input.cases[0]!.resolvedSteps = [];
    input.cases[0]!.sharedStepGroup = null;
    expect(decodeCaseProcedureExport(encodeCaseProcedureExport(input))).toEqual(
      input,
    );
  });
  it("rejects unknown versions, hidden fields, URLs and claims of import or backup support", () => {
    for (const change of [
      { version: 2 },
      { importSupported: true },
      { token: "synthetic" },
      { storageUrl: "https://example.test/private" },
    ]) {
      expect(() =>
        decodeCaseProcedureExport(JSON.stringify({ ...fixture(), ...change })),
      ).toThrow();
    }
    const input = fixture();
    Object.assign(input.cases[0]!.mediaReferences[0]!, {
      storageUrl: "https://example.test/private",
    });
    expect(() => decodeCaseProcedureExport(JSON.stringify(input))).toThrow();
  });
  it("rejects missing/duplicate/nonmedia references and reordered/duplicate step identities", () => {
    for (const refs of [["foreign-media"], ["media-1", "media-1"]]) {
      const input = fixture();
      input.cases[0]!.authoredSteps[0]!.mediaAttachmentIds = refs;
      expect(() => encodeCaseProcedureExport(input)).toThrow();
    }
    const input = fixture();
    input.cases[0]!.mediaReferences[0]!.contentType = "application/pdf";
    expect(() => encodeCaseProcedureExport(input)).toThrow();
    const order = fixture();
    order.cases[0]!.authoredSteps.push({
      ...order.cases[0]!.authoredSteps[0]!,
    });
    expect(() => encodeCaseProcedureExport(order)).toThrow();
  });
  it("rejects duplicate cases, self prerequisites, archived scope and profile prototype keys", () => {
    const duplicate = fixture();
    duplicate.cases.push(duplicate.cases[0]!);
    expect(() => encodeCaseProcedureExport(duplicate)).toThrow();
    const self = fixture();
    self.cases[0]!.prerequisites[0]!.id = self.cases[0]!.id;
    expect(() => encodeCaseProcedureExport(self)).toThrow();
    const archived = fixture();
    archived.cases[0]!.archived = true;
    expect(() => encodeCaseProcedureExport(archived)).toThrow();
    archived.scope.includeArchived = true;
    expect(
      decodeCaseProcedureExport(encodeCaseProcedureExport(archived)),
    ).toEqual(archived);
    const profile = fixture();
    profile.cases[0]!.verificationProfile = JSON.parse(
      '{"__proto__":"unsupported"}',
    );
    expect(() => decodeCaseProcedureExport(JSON.stringify(profile))).toThrow();
  });
  it("rejects malformed, excessive cases and excessive UTF-8 before returning any partial data", () => {
    expect(() => decodeCaseProcedureExport("{ malformed")).toThrow();
    expect(() =>
      decodeCaseProcedureExport(" ".repeat(MAX_PROCEDURE_EXPORT_BYTES + 1)),
    ).toThrow(/8 MiB/);
    expect(() =>
      decodeCaseProcedureExport("α".repeat(MAX_PROCEDURE_EXPORT_BYTES / 2 + 1)),
    ).toThrow(/8 MiB/);
    const input = fixture();
    input.cases = Array.from({ length: 2001 }, (_, index) => ({
      ...input.cases[0]!,
      id: `case-${index}`,
      displayId: `synthetic-${index + 1}`,
    }));
    expect(() => encodeCaseProcedureExport(input)).toThrow();
  });
});
