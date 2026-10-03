import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
import { captureCaseProcedureExport } from "./caseProcedureExport.js";

function row(id = "case-1") {
  return {
    id,
    displayId: `demo-${id === "case-1" ? "01" : "02"}`,
    caseNumber: id === "case-1" ? 1 : 2,
    title: "Synthetic procedure",
    background: "exact background",
    given: ["literal a|b"],
    when: ["do\naction"],
    then: ["outcome"],
    sharedStepGroupId: null as string | null,
    validationDomain: "HIL",
    verificationProfile: { setup: "Synthetic rig" },
    suitePath: "bench/rig",
    testType: "UNIT",
    automationStatus: "AUTOMATED",
    priority: "HIGH",
    origin: "IMPORTED",
    reviewStatus: "APPROVED",
    archived: false,
    tags: ["pipe|tag"],
    steps: [
      {
        order: 0,
        action: "own action",
        expectedActionOrData: null,
        expectedResult: "expected",
        expectedResponse: "200",
        mediaAttachmentIds: [] as string[],
      },
    ],
    prerequisites: [] as Array<{
      prerequisite: {
        id: string;
        displayId: string;
        title: string;
        archived: boolean;
        projectId: string;
      };
    }>,
  };
}

function database(rows = [row()]) {
  const query = {
    project: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "project-1",
        name: "Synthetic",
        caseKey: "demo",
      }),
    },
    $queryRaw: vi
      .fn()
      .mockResolvedValue([
        { capturedAt: new Date("2026-10-03T06:00:00.000Z") },
      ]),
    testCase: { findMany: vi.fn().mockResolvedValue(rows) },
    sharedStepGroup: { findMany: vi.fn().mockResolvedValue([]) },
    testCaseAttachment: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { query, db: query as unknown as Prisma.TransactionClient };
}
const input = {
  projectId: "project-1",
  ids: ["case-1"],
  scope: "selected" as const,
  includeArchived: false,
};

describe("case procedure export capture", () => {
  it("pins every read to reviewed project/case scope and preserves visible order/content", async () => {
    const { db, query } = database([row("case-2"), row()]);
    const exported = await captureCaseProcedureExport(db, {
      ...input,
      ids: ["case-1", "case-2"],
    });
    expect(exported.cases.map((item) => item.id)).toEqual(["case-1", "case-2"]);
    expect(exported.cases[0]).toMatchObject({
      given: ["literal a|b"],
      when: ["do\naction"],
      testType: "UNIT",
      automationStatus: "AUTOMATED",
      suitePath: "bench/rig",
      validationDomain: "HIL",
      verificationProfile: { setup: "Synthetic rig" },
    });
    expect(query.testCase.findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        projectId: "project-1",
        id: { in: ["case-1", "case-2"] },
        archived: false,
      },
    });
    expect(exported.importSupported).toBe(false);
  });
  it("refuses unavailable scope rather than returning a partial export", async () => {
    const { db, query } = database();
    await expect(
      captureCaseProcedureExport(db, {
        ...input,
        ids: ["case-1", "foreign-case"],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(query.sharedStepGroup.findMany).not.toHaveBeenCalled();
  });
  it("fetches shared definitions only within the selected project and retains owned and resolved steps", async () => {
    const item = row();
    item.sharedStepGroupId = "library-1";
    const { db, query } = database([item]);
    query.sharedStepGroup.findMany.mockResolvedValue([
      {
        id: "library-1",
        name: "Shared",
        steps: [
          {
            order: 0,
            action: "shared exact|action",
            expectedActionOrData: null,
            expectedResult: "shared expected",
            expectedResponse: null,
          },
        ],
      },
    ]);
    const exported = await captureCaseProcedureExport(db, input);
    expect(query.sharedStepGroup.findMany.mock.calls[0]![0]).toMatchObject({
      where: { projectId: "project-1", id: { in: ["library-1"] } },
    });
    expect(exported.cases[0]!.authoredSteps[0]!.action).toBe("own action");
    expect(exported.cases[0]!.resolvedSteps[0]).toMatchObject({
      action: "shared exact|action",
      mediaAttachmentIds: [],
    });
  });
  it("fails closed if a library is foreign or absent without fetching foreign contents", async () => {
    const item = row();
    item.sharedStepGroupId = "foreign-library";
    const { db, query } = database([item]);
    await expect(captureCaseProcedureExport(db, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(query.sharedStepGroup.findMany.mock.calls[0]![0]).toMatchObject({
      where: { projectId: "project-1", id: { in: ["foreign-library"] } },
    });
  });
  it("exports only case-owned media labels, never storage URLs, and rejects foreign/nonmedia references", async () => {
    const item = row();
    item.steps[0]!.mediaAttachmentIds = ["media-1"];
    const { db, query } = database([item]);
    const attachment = {
      id: "media-1",
      testCaseId: "case-1",
      fileName: "fixture.png",
      contentType: "image/png",
      sizeBytes: 12,
      uploadCompletedAt: null,
      storageUrl: "https://example.test/synthetic-private",
    };
    query.testCaseAttachment.findMany.mockResolvedValue([attachment]);
    const exported = await captureCaseProcedureExport(db, input);
    expect(exported.cases[0]!.mediaReferences).toEqual([
      {
        id: "media-1",
        fileName: "fixture.png",
        contentType: "image/png",
        sizeBytes: 12,
        uploadMetadataVerified: false,
      },
    ]);
    expect(JSON.stringify(exported)).not.toContain("storageUrl");
    expect(query.testCaseAttachment.findMany.mock.calls[0]![0]).toMatchObject({
      where: {
        testCaseId: { in: ["case-1"] },
        testCase: { projectId: "project-1" },
      },
    });
    query.testCaseAttachment.findMany.mockResolvedValue([
      { ...attachment, testCaseId: "foreign-case" },
    ]);
    await expect(captureCaseProcedureExport(db, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    query.testCaseAttachment.findMany.mockResolvedValue([
      { ...attachment, contentType: "application/pdf" },
    ]);
    await expect(captureCaseProcedureExport(db, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("retains archived prerequisite labels but rejects a mismatched project", async () => {
    const item = row();
    item.prerequisites = [
      {
        prerequisite: {
          id: "prior-case",
          displayId: "demo-03",
          title: "Required state",
          archived: true,
          projectId: "project-1",
        },
      },
    ];
    const { db } = database([item]);
    expect(
      (await captureCaseProcedureExport(db, input)).cases[0]!.prerequisites,
    ).toEqual([
      {
        id: "prior-case",
        displayId: "demo-03",
        title: "Required state",
        archived: true,
      },
    ]);
    item.prerequisites[0]!.prerequisite.projectId = "foreign-project";
    await expect(captureCaseProcedureExport(db, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
