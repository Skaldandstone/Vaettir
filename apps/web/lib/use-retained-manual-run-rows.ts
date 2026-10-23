"use client";

import { useMemo, useState } from "react";
import type { ManualRunCurrentSnapshot } from "./manual-run-current-reader";
import {
  retainManualRunRows,
  type ManualRunRowRetentionResult,
} from "./manual-run-row-retention";

/** React-owned private mounting retention, not read/write/action authority.
 * The same-component adjustment consumes each immutable candidate identity once,
 * including refusal and null. No refs/layout effects publish speculative reads.
 * Caller must still match reader.current() to this exact current snapshot before
 * navigation, intent, serialization and download, and keep child keys unchanged.
 */
export function useRetainedManualRunRows(
  candidate: ManualRunCurrentSnapshot | null,
): ManualRunRowRetentionResult {
  const [publication, setPublication] = useState<{
    seenCandidate: ManualRunCurrentSnapshot | null;
    result: ManualRunRowRetentionResult;
  }>(() => ({ seenCandidate: null, result: retainManualRunRows(null, null) }));
  const prepared = useMemo(
    () =>
      publication.seenCandidate === candidate
        ? publication.result
        : retainManualRunRows(publication.result.retained, candidate),
    [publication, candidate],
  );
  if (publication.seenCandidate !== candidate) {
    setPublication({ seenCandidate: candidate, result: prepared });
    // React retries this component before committing. This earlier pass exposes
    // no new current body and never erases an already mounted private row.
    return Object.freeze({
      retained: publication.result.retained,
      current: null,
      reason: "NO_CURRENT_READ",
    });
  }
  return publication.result;
}
