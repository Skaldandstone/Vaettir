export type AssessmentInput = {
  documents: number;
  requirements: number;
  testCases: number;
  approvedPlans: number;
  latestRun: {
    id: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
  } | null;
  releases: { id: string; name: string; status: string }[];
};
export function assessPopulation(input: AssessmentInput, now = new Date()) {
  const run = input.latestRun;
  const age = run ? now.getTime() - run.startedAt.getTime() : null;
  // Operational review heuristic only, not a regulatory freshness claim.
  const stale = age !== null && age > 30 * 24 * 60 * 60 * 1000;
  const invalidTime = age !== null && age < 0;
  const stages = [
    {
      key: "intent",
      label: "Documented intent",
      state: input.requirements ? "recorded" : "missing",
      summary: input.requirements
        ? `${input.requirements} requirements recorded; completeness is unverified.`
        : "No requirements recorded.",
      path: "requirements",
    },
    {
      key: "planning",
      label: "Approved test planning",
      state: input.approvedPlans ? "recorded" : "missing",
      summary: input.approvedPlans
        ? `${input.approvedPlans} approved plans recorded; coverage still needs review.`
        : "No approved test plan recorded.",
      path: "test-plans",
    },
    {
      key: "cases",
      label: "Test design",
      state: input.testCases ? "recorded" : "missing",
      summary: input.testCases
        ? `${input.testCases} cases recorded; imported cases do not prove execution.`
        : "No test cases recorded.",
      path: "test-cases",
    },
    {
      key: "execution",
      label: "Execution evidence",
      state: !run
        ? "missing"
        : stale || invalidTime || run.status !== "PASSED" || !run.finishedAt
          ? "review"
          : "recorded",
      summary: !run
        ? "No test run recorded."
        : invalidTime
          ? "Latest run timestamp is in the future; verify the evidence."
          : stale
            ? "Latest run is over 30 days old; review its relevance."
            : `Latest project run: ${run.status.toLowerCase()}. Release applicability is unverified.`,
      path: run ? `test-runs#run-${encodeURIComponent(run.id)}` : "test-runs",
    },
  ];
  const actions: {
    key: string;
    label: string;
    reason: string;
    path: string;
  }[] = [];
  if (run && (run.status === "FAILED" || invalidTime))
    actions.push({
      key: "inspect-run",
      label: "Inspect execution evidence",
      reason: invalidTime
        ? "The recorded timestamp needs correction."
        : "The latest project run failed; investigate before using it as release evidence.",
      path: `test-runs#run-${encodeURIComponent(run.id)}`,
    });
  if (!input.documents)
    actions.push({
      key: "add-evidence",
      label: "Add project evidence",
      reason:
        "Approve a specification or release note so recommendations can cite documented intent.",
      path: "populate/documents",
    });
  if (!input.requirements)
    actions.push({
      key: "requirements",
      label: input.documents
        ? "Review requirement suggestions"
        : "Define requirements",
      reason: "Establish expected behavior before judging test coverage.",
      path: input.documents ? "populate/requirements" : "requirements",
    });
  if (!input.testCases)
    actions.push({
      key: "cases",
      label: "Import or author test cases",
      reason:
        "Bring existing work into this project before generating more cases.",
      path: "import",
    });
  if (!input.approvedPlans)
    actions.push({
      key: "planning",
      label: "Review test planning",
      reason: "An approved plan has not been recorded for this project.",
      path: "test-plans",
    });
  if (!run || stale)
    actions.push({
      key: "run",
      label: "Record a relevant test run",
      reason: stale
        ? "Check whether the older run still matches the intended release."
        : "Manual and automated runs both supply execution evidence.",
      path: "test-runs",
    });
  if (!input.releases.length)
    actions.push({
      key: "release",
      label: "Define a release",
      reason: "Select release scope before making a readiness decision.",
      path: "releases",
    });
  return {
    stages,
    actions: actions.slice(0, 5),
    releasePhases: input.releases.map((release) => ({
      ...release,
      basis: "Recorded release status, not inferred deployment or readiness.",
    })),
    uncertainty: [
      "Repository revisions, deployed functionality and per-component phases are not established by this assessment.",
      "Counts do not establish requirement coverage or release readiness.",
      "A passing project run is not automatically evidence for the selected release.",
    ],
    overall: "Readiness not established" as const,
  };
}
