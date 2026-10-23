const labels: Record<string, string> = {
  reverseEngineerTestFile: "Extract cases from an automated test file",
  inferCustomFrameworkHeuristic: "Identify a custom test framework",
  recommendTestPlansForDiff: "Recommend plans for a code change",
  assessTestCaseRisk: "Assess a test case's risk",
  generateQaStrategyDraft: "Draft a QA strategy",
  classifyTestFailure: "Analyze a test failure",
  generateTestCasesFromRequirement: "Draft cases from a requirement",
  extractRequirementsFromMarkdown: "Extract requirements from a document",
  generateReleaseSummary: "Draft a release summary",
  reviewTestCaseQuality: "Review test case quality",
  generateTestCasesFromLiveApp: "Draft cases from live-app observations",
  generateAutomationDraft: "Draft framework-specific automation",
};

export function creditOperationLabel(operation: string): string {
  const words = operation
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ");
  return labels[operation] ?? words.charAt(0).toUpperCase() + words.slice(1);
}
