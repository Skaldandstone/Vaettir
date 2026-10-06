type CurrentManualRunRecord = {
  runId: string;
  projectId: string;
  status: string;
  executionContext: unknown;
  stepFieldLabels: Record<string, string>;
  cases: readonly { testCaseId: string }[];
};
/** Download only the already-authorized current payload, never history/media. */
export function renderCurrentManualRunRecordJson(
  record: CurrentManualRunRecord,
): string {
  if (
    record.cases.length > 1000 ||
    new Set(record.cases.map((testCase) => testCase.testCaseId)).size !==
      record.cases.length ||
    record.cases.some((testCase) => !testCase.testCaseId)
  )
    throw new Error(
      "Current run case identities are unsupported or ambiguous. No partial record was exported.",
    );
  const content = JSON.stringify(
    {
      formatVersion: 1,
      kind: "current_manual_run_record",
      evidenceBoundary: {
        scope:
          "Currently authorized run case scope, including untested cases. Search and display filters do not remove cases from this export.",
        procedures: record.executionContext
          ? "Saved run procedures and configuration, not substituted current case definitions."
          : "Legacy run has no saved procedure snapshot; displayed procedures may reflect later case edits.",
        outcomes:
          "Current observations and step heads present in this response only, not a complete revision history.",
        media:
          "Attachment identifiers are references. No attachment files or external URLs were fetched or verified.",
        acceptance:
          "Not a signed audit report, deployed behavior or release acceptance.",
      },
      ...record,
    },
    null,
    2,
  );
  if (new TextEncoder().encode(content).byteLength > 8 * 1024 * 1024)
    throw new Error(
      "Current run record exceeds the 8 MiB export limit. No content was silently truncated.",
    );
  return content;
}
