import { describe, expect, it } from "vitest";
import { testCaseContentRevision } from "./testCaseContentRevision.js";

const baseline = {
  title: "Delete own comment", background: "User comments", given: ["Signed in"], when: ["Delete"], then: ["Removed"],
  tags: ["comments"], testType: "FUNCTIONAL", priority: "MEDIUM", suitePath: "Regression", testPlanId: null,
  validationDomain: "SOFTWARE", verificationProfile: { setup: "", safety: "" }, sharedStepGroupId: null,
  sharedStepGroup: null, steps: [{ order: 0, action: "Confirm", expectedActionOrData: null, expectedResult: "Closed", expectedResponse: null, mediaAttachmentIds: [] }],
};

describe("full test case content revision", () => {
  it.each([
    { title: "Changed title" }, { background: "Changed background" }, { given: ["Other setup"] },
    { when: ["Other action"] }, { then: ["Other result"] }, { tags: ["business"] },
    { testType: "UNIT" }, { priority: "HIGH" }, { suitePath: "New suite" }, { testPlanId: "new-plan" },
    { validationDomain: "HARDWARE" }, { verificationProfile: { safety: "Stop first", setup: "" } },
    { sharedStepGroupId: "group" }, { sharedStepGroup: { steps: [{ action: "Changed shared step" }] } },
    { steps: [{ ...baseline.steps[0]!, mediaAttachmentIds: ["image"] }] },
  ])("invalidates the baseline for editable change %j", patch => {
    expect(testCaseContentRevision({ ...baseline, ...patch })).not.toBe(testCaseContentRevision(baseline));
  });

  it("ignores database object-key order, but retains intentional step and BDD ordering", () => {
    expect(testCaseContentRevision({ ...baseline, verificationProfile: { safety: "", setup: "" } })).toBe(testCaseContentRevision(baseline));
    expect(testCaseContentRevision({ ...baseline, given: ["A", "B"] })).not.toBe(testCaseContentRevision({ ...baseline, given: ["B", "A"] }));
  });
});
