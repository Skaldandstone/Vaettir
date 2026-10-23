/** UI capability only, never server authority or permission to create new work.
 * A retained request can recover a prior receipt after native run completion. */
export function manualCaseRecoveryAllowed(value: {
  freshOriginalAccess: boolean;
  currentFullEditor: boolean;
  exactRetainedRequest: boolean;
  confirmedReceipt: boolean;
  definitiveRejection: boolean;
  parentWriteDisabled: boolean;
  runStatus: string | null;
}) {
  if (!value.freshOriginalAccess || !value.currentFullEditor ||
      !value.exactRetainedRequest || value.confirmedReceipt || value.definitiveRejection)
    return false;
  if (!["RUNNING", "PASSED", "FAILED", "PARTIAL"].includes(value.runStatus ?? ""))
    return false;
  // A disabled RUNNING parent can mean completion/another write is in flight.
  // Closed native statuses permit ONLY identical receipt lookup, never new work.
  return !value.parentWriteDisabled || value.runStatus !== "RUNNING";
}
