import { describe, expect, it } from "vitest";
import {
  reportDefinitionListInput,
  reportDefinitionHistoryInput,
  reportDefinitionManageInput,
  retainedReportDefinitionStateSchema,
} from "./reportDefinitionLifecycleSchema.js";
// Source-authored regression scenarios only. Not executed tonight.
const request = {
  projectId: "synthetic-project",
  id: "synthetic-definition",
  version: 1,
  requestId: "b9440ac5-579c-455e-8a49-d813a44ed807",
  action: { kind: "rename", name: "Reviewed settings" },
  reason: "Synthetic review",
  approve: true,
};
describe("bounded reviewed report-definition lifecycle", () => {
  it("accepts complete typed settings but rejects raw SQL and incomplete sections", () => {
    const definition = {
      audience: "quality",
      windowDays: 7,
      sections: ["execution"],
      summary: "Authored notes",
      risks: "",
      nextActions: "",
      executionScope: { platform: "PC" },
    };
    expect(
      reportDefinitionManageInput.parse({
        ...request,
        action: { kind: "settings", definition },
      }).action,
    ).toEqual({ kind: "settings", definition });
    for (const extra of [
      { sections: [] },
      { executionScope: {} },
      { arbitrarySQL: "SELECT *" },
      { dateInterval: { start: "2026-02-29", end: "2026-03-01" } },
    ])
      expect(
        reportDefinitionManageInput.safeParse({
          ...request,
          action: { kind: "settings", definition: { ...definition, ...extra } },
        }).success,
      ).toBe(false);
  });
  it("defaults to active bounded catalog pages and requires exact approval", () => {
    expect(
      reportDefinitionListInput.parse({ projectId: request.projectId }),
    ).toEqual({
      projectId: request.projectId,
      page: 0,
      includeArchived: false,
    });
    expect(
      reportDefinitionManageInput.parse(request).approveProjectSharing,
    ).toBe(false);
    for (const extra of [
      { approve: false },
      { reason: " " },
      { version: 0 },
      { requestId: "new" },
      { arbitrarySQL: "SELECT *" },
    ])
      expect(
        reportDefinitionManageInput.safeParse({ ...request, ...extra }).success,
      ).toBe(false);
  });
  it("rejects unbounded pages, names and unknown actions", () => {
    expect(
      reportDefinitionListInput.safeParse({ projectId: "p", page: 10 }).success,
    ).toBe(false);
    expect(
      reportDefinitionHistoryInput.safeParse({
        projectId: "p",
        id: "d",
        page: 200,
      }).success,
    ).toBe(false);
    for (const action of [
      { kind: "delete" },
      { kind: "rename", name: "x".repeat(81) },
      { kind: "visibility", visibility: "public" },
      { kind: "restore", receiptKey: "short", side: "after" },
    ])
      expect(
        reportDefinitionManageInput.safeParse({ ...request, action }).success,
      ).toBe(false);
  });
  it("preserves exact supported restore identity and separates archival state", () => {
    const action = {
      kind: "restore",
      receiptKey: "a".repeat(64),
      side: "before",
    };
    expect(
      reportDefinitionManageInput.parse({ ...request, action }).action,
    ).toEqual(action);
    expect(
      retainedReportDefinitionStateSchema.safeParse({
        name: "Synthetic",
        definition: {},
        visibility: "project",
        archived: true,
        version: 4,
      }).success,
    ).toBe(true);
    expect(
      retainedReportDefinitionStateSchema.safeParse({
        name: "Synthetic",
        definition: {},
        visibility: "public",
        archived: false,
        version: 1,
      }).success,
    ).toBe(false);
  });
});
