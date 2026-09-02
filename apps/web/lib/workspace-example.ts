// Deliberately static public examples. Never mix these records into an API response.
export type ExampleCase = {
  id: string;
  title: string;
  suite: string;
  status: "Passed" | "Failed" | "Not run";
  priority: "High" | "Medium";
  owner: string;
  initials: string;
  given: string;
  when: string;
  then: string;
};

export const exampleCases: ExampleCase[] = [
  {
    id: "TC-001",
    title: "Invited member can join the workspace",
    suite: "Identity & access",
    status: "Passed",
    priority: "High",
    owner: "Alex Morgan",
    initials: "AM",
    given: "A team member has a valid workspace invitation",
    when: "They sign in with the invited email and accept",
    then: "The workspace opens with the assigned permissions",
  },
  {
    id: "TC-002",
    title: "Read-only members cannot edit test cases",
    suite: "Identity & access",
    status: "Passed",
    priority: "High",
    owner: "Alex Morgan",
    initials: "AM",
    given: "A member has a read-only seat",
    when: "They open an existing test case",
    then: "The case is visible and editing actions are unavailable",
  },
  {
    id: "TC-003",
    title: "Failed CI results link to the correct case",
    suite: "CI integration",
    status: "Failed",
    priority: "High",
    owner: "Sam Chen",
    initials: "SC",
    given: "A CI run includes an existing test mapping",
    when: "The runner reports a failing result",
    then: "The result appears on the mapped case in the same project",
  },
  {
    id: "TC-004",
    title: "JUnit import preserves execution history",
    suite: "CI integration",
    status: "Passed",
    priority: "Medium",
    owner: "Sam Chen",
    initials: "SC",
    given: "A project has a previous test run",
    when: "A new JUnit report is imported",
    then: "Both runs remain available in the execution history",
  },
  {
    id: "TC-005",
    title: "Release sign-off requires an authorized reviewer",
    suite: "Release controls",
    status: "Not run",
    priority: "High",
    owner: "Jordan Lee",
    initials: "JL",
    given: "A release is waiting for compliance review",
    when: "A member without sign-off authority opens the release",
    then: "Evidence is visible but sign-off is not available",
  },
  {
    id: "TC-006",
    title: "Unresolved failures block release readiness",
    suite: "Release controls",
    status: "Passed",
    priority: "High",
    owner: "Jordan Lee",
    initials: "JL",
    given: "An in-flight release has a failing required case",
    when: "The release readiness is evaluated",
    then: "The release shows the failing gate and an actionable blocker",
  },
];

export function filterExampleCases(query: string, status: string) {
  const search = query.trim().toLowerCase();
  return exampleCases.filter(
    (item) =>
      (status === "All results" || item.status === status) &&
      `${item.id} ${item.title} ${item.suite}`.toLowerCase().includes(search),
  );
}

export const exampleReviews = [
  {
    id: "review-1",
    title: "Handle a revoked invitation",
    source: "identity/invitations.spec.ts",
    given: "An invitation has been revoked by its owner",
    when: "The invitee follows the original invitation link",
    then: "Access is denied and a clear recovery message is shown",
  },
  {
    id: "review-2",
    title: "Keep a failed import recoverable",
    source: "imports/junit.spec.ts",
    given: "An imported report has an invalid test result",
    when: "The import fails validation",
    then: "Existing cases are unchanged and the user can retry",
  },
];
