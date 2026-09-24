import { describe, expect, it } from "vitest";
import {
  filterCoverageAwareDrafts,
  type CoverageAwareLiveAppTestCase,
  type GenerateTestCasesFromLiveAppInput,
} from "./generateTestCasesFromLiveApp.js";

const observed = {
  role: "button",
  name: "Sign in",
  stableId: "sign-in",
  selector: "#sign-in",
  event: "click",
};
const input: GenerateTestCasesFromLiveAppInput = {
  startUrl: "https://example.com",
  releaseCommit: "abc123",
  pages: [{ url: "https://example.com", title: "Login", elements: [observed] }],
  existingTestCases: [
    {
      id: "existing-1",
      title: "User can sign in",
      given: [],
      when: [],
      then: [],
      testType: "E2E",
      updatedAt: "2026-09-24T00:00:00Z",
      steps: [],
    },
  ],
};

function draft(
  overrides: Partial<CoverageAwareLiveAppTestCase> = {},
): CoverageAwareLiveAppTestCase {
  return {
    title: "Passwordless sign in works",
    background: null,
    given: ["the login page is open"],
    when: ["the user signs in"],
    then: ["the account opens"],
    tags: [],
    testType: "E2E",
    confidence: 0.8,
    notes: null,
    coverageDisposition: "NEW_COVERAGE",
    matchedExistingTestCaseId: null,
    coverageRationale: "The existing case does not cover passwordless login.",
    observedReleaseCommit: "abc123",
    steps: [
      {
        action: "click",
        target: observed,
        expectedResult: "The account opens",
      },
    ],
    ...overrides,
  };
}

describe("filterCoverageAwareDrafts", () => {
  it("keeps new coverage grounded in exact observed action metadata", () => {
    expect(filterCoverageAwareDrafts([draft()], input)).toHaveLength(1);
  });

  it("drops duplicate coverage, invented selectors, and incorrect revisions", () => {
    const duplicate = draft({ title: "User can sign in" });
    const invented = draft({
      steps: [
        {
          action: "click",
          target: { ...observed, selector: "#invented" },
          expectedResult: "Done",
        },
      ],
    });
    const wrongRelease = draft({ observedReleaseCommit: "other" });
    expect(
      filterCoverageAwareDrafts([duplicate, invented, wrongRelease], input),
    ).toEqual([]);
  });

  it("keeps stale updates only when they reference a real existing case", () => {
    const stale = draft({
      coverageDisposition: "STALE_EXISTING",
      matchedExistingTestCaseId: "existing-1",
    });
    const unknown = draft({
      coverageDisposition: "STALE_EXISTING",
      matchedExistingTestCaseId: "missing",
    });
    expect(filterCoverageAwareDrafts([stale, unknown], input)).toEqual([stale]);
  });
});
