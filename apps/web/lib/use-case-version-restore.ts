"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RouterOutputs } from "./trpcReact";
import type { VersionAccess } from "./use-case-version-access";
import {
  assertVersionRestoreAck,
  freezeVersionEnvelope,
  freezeVersionReview,
  sameVersionReader,
  versionRestoreRequestHash,
  type VersionOrigin,
  type VersionPending,
  type VersionRestore,
  type VersionEnvelope,
} from "./case-version-draft";
import { retainedTraceabilityReceipt } from "./traceability-receipt";
type Preview = RouterOutputs["caseVersionReview"]["preview"];
type Draft = {
  identity: string;
  baseline: Preview;
  origin: VersionOrigin;
  fields: VersionRestore["fields"];
  reason: string;
  confirmed: boolean;
};
export function useCaseVersionRestore({
  projectId,
  testCaseId,
  active,
  open,
  fromVersion,
  version,
  readOnly,
  reads,
  preview,
  mutation,
  afterConfirmed,
  navigationActivation,
  navigationReady = true,
}: {
  projectId: string;
  testCaseId: string;
  active: boolean;
  open: boolean;
  fromVersion: number | null;
  version: number | null;
  readOnly: boolean;
  reads: VersionAccess;
  preview: Preview | null;
  mutation: {
    isPending: boolean;
    mutateAsync: (
      input: VersionEnvelope,
    ) => Promise<RouterOutputs["caseVersionReview"]["restoreReviewed"]>;
  };
  afterConfirmed: (
    ack: RouterOutputs["caseVersionReview"]["restoreReviewed"],
  ) => void;
  navigationActivation?: string;
  navigationReady?: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null),
    [pending, setPending] = useState<VersionPending | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [preparing, setPreparing] = useState(false);
  const [settledIdentity, setSettledIdentity] = useState<string | null>(null);
  const draftRef = useRef(draft),
    pendingRef = useRef(pending),
    busyRef = useRef(false),
    settledRef = useRef(new Set<string>());
  const authority = JSON.stringify([
    active,
    open,
    projectId,
    testCaseId,
    version,
    fromVersion,
    readOnly,
    reads.activation,
    reads.readable,
    reads.fresh?.canRecover,
    reads.fresh?.readScope,
    draft?.identity,
    preview?.readContext?.readRequestId,
    preview?.expectedCaseRevision,
    preview?.expectedVersionRevision,
    navigationActivation,
    navigationReady,
  ]);
  const [authorityState, setAuthorityState] = useState({ authority, epoch: 0 });
  if (authorityState.authority !== authority)
    setAuthorityState({ authority, epoch: authorityState.epoch + 1 });
  const epoch = authorityState.epoch;
  const frame = useRef<{
    epoch: number;
    activation: string;
    active: boolean;
    open: boolean;
    projectId: string;
    testCaseId: string;
    version: number | null;
    fromVersion: number | null;
    readOnly: boolean;
    reads: VersionAccess;
  } | null>(null);
  useLayoutEffect(() => {
    frame.current = {
      epoch,
      activation: reads.activation,
      active,
      open,
      projectId,
      testCaseId,
      version,
      fromVersion,
      readOnly,
      reads,
    };
    return () => {
      frame.current = null;
    };
  }, [
    epoch,
    reads,
    active,
    open,
    projectId,
    testCaseId,
    version,
    fromVersion,
    readOnly,
  ]);
  const currentHandler = (requireOpen = true) =>
    !!frame.current?.active &&
    (!requireOpen || frame.current.open) &&
    frame.current.epoch === epoch &&
    frame.current.activation === reads.activation &&
    frame.current.projectId === projectId &&
    frame.current.testCaseId === testCaseId &&
    frame.current.reads.readable;
  useEffect(() => {
    const now = frame.current;
    if (
      !now?.active ||
      !now.open ||
      now.epoch !== epoch ||
      now.activation !== reads.activation ||
      now.projectId !== projectId ||
      now.testCaseId !== testCaseId ||
      !now.reads.readable ||
      !reads.origin ||
      !preview ||
      !sameVersionReader(preview.readContext?.readScope, reads.origin) ||
      preview.readContext?.caseId !== testCaseId ||
      preview.readContext?.projection.kind !== "CURRENT" ||
      preview.readContext.projection.versionNumber !== version ||
      preview.caseId !== testCaseId ||
      preview.versionNumber !== version ||
      fromVersion !== null ||
      draftRef.current ||
      pendingRef.current ||
      busyRef.current
    )
      return;
    const next = {
      identity: crypto.randomUUID(),
      baseline: freezeVersionReview(preview),
      origin: reads.origin,
      fields: preview.fields
        .filter((field) => field.changed && field.restorable)
        .map((field) => field.key),
      reason: "",
      confirmed: false,
    };
    draftRef.current = next;
    setDraft(next);
  }, [
    preview,
    reads.origin,
    reads.activation,
    active,
    open,
    fromVersion,
    version,
    epoch,
    projectId,
    testCaseId,
  ]);
  function change(
    patch: Partial<Pick<Draft, "fields" | "reason" | "confirmed">>,
  ) {
    const held = draftRef.current;
    if (
      !held ||
      !currentHandler() ||
      frame.current?.readOnly ||
      !frame.current?.reads.fresh?.canRecover ||
      !held.baseline.canRestore ||
      busyRef.current ||
      pendingRef.current ||
      settledRef.current.has(held.identity)
    )
      return;
    const next = {
      ...held,
      ...patch,
      fields: patch.fields ? [...patch.fields] : held.fields,
      identity: crypto.randomUUID(),
      confirmed: patch.confirmed === true,
    };
    draftRef.current = next;
    setDraft(next);
  }
  function clearComparison(fromClosedList = false) {
    if (
      !currentHandler(!fromClosedList) ||
      busyRef.current ||
      pendingRef.current
    )
      return false;
    draftRef.current = null;
    setDraft(null);
    setNotice(null);
    return true;
  }
  async function commit() {
    const held = pendingRef.current,
      captured = draftRef.current;
    if (
      busyRef.current ||
      !currentHandler() ||
      !frame.current?.reads.fresh?.canRecover ||
      frame.current.readOnly ||
      fromVersion !== null ||
      !reads.origin
    )
      return;
    const original = held?.origin ?? captured?.origin;
    if (!original) return;
    const reviewedVersion =
      held?.input.request.versionNumber ?? captured?.baseline.versionNumber;
    const activation = frame.current.activation,
      startedEpoch = frame.current.epoch;
    const owns = () => {
      const now = frame.current;
      return (
        !!now?.active &&
        now.open &&
        !now.readOnly &&
        now.epoch === startedEpoch &&
        now.activation === activation &&
        now.projectId === original.projectId &&
        now.testCaseId === original.caseId &&
        now.version === reviewedVersion &&
        now.fromVersion === null &&
        now.reads.readable &&
        !!now.reads.fresh?.canRecover &&
        sameVersionReader(now.reads.fresh.readScope, original)
      );
    };
    if (!owns()) return;
    busyRef.current = true;
    let retained = held;
    try {
      if (!retained) {
        if (
          !captured ||
          !preview ||
          preview.expectedCaseRevision !==
            captured.baseline.expectedCaseRevision ||
          preview.expectedVersionRevision !==
            captured.baseline.expectedVersionRevision ||
          preview.versionId !== captured.baseline.versionId ||
          settledRef.current.has(captured.identity) ||
          !captured.confirmed ||
          !captured.baseline.canRestore ||
          captured.baseline.versionNumber !== version ||
          !captured.fields.length ||
          !captured.reason.trim() ||
          captured.reason.trim().length > 1000
        )
          return;
        const allowed = new Set(
          captured.baseline.fields
            .filter((field) => field.changed && field.restorable)
            .map((field) => field.key),
        );
        if (
          new Set(captured.fields).size !== captured.fields.length ||
          captured.fields.some((field) => !allowed.has(field))
        )
          return;
        const input = freezeVersionEnvelope(
          {
            projectId: original.projectId,
            testCaseId: original.caseId,
            versionNumber: captured.baseline.versionNumber,
            expectedCaseRevision: captured.baseline.expectedCaseRevision,
            expectedVersionRevision: captured.baseline.expectedVersionRevision,
            fields: captured.fields,
            reason: captured.reason.trim(),
            confirmed: true,
            requestId: crypto.randomUUID(),
          },
          original,
        );
        setPreparing(true);
        const requestHash = await versionRestoreRequestHash(input.request);
        if (
          !owns() ||
          draftRef.current?.identity !== captured.identity ||
          pendingRef.current
        )
          return;
        retained = Object.freeze({
          input,
          origin: original,
          requestHash,
          uncertain: false,
          draftIdentity: captured.identity,
        });
        pendingRef.current = retained;
        setPending(retained);
      }
      const sent = retained;
      const result = await mutation.mutateAsync(sent.input);
      assertVersionRestoreAck(result, sent);
      if (pendingRef.current !== sent) return;
      // Known exact ACK may settle ONLY this private receipt after access loss.
      // No draft/notice/cache/parent effect is allowed outside the current frame.
      pendingRef.current = null;
      setPending((now) => (now === sent ? null : now));
      settledRef.current.add(sent.draftIdentity);
      setSettledIdentity(sent.draftIdentity);
      if (!owns() || draftRef.current?.identity !== sent.draftIdentity) return;
      draftRef.current = null;
      setDraft((now) => (now?.identity === sent.draftIdentity ? null : now));
      setNotice(
        `Restored selected fields from v${result.restoredVersionNumber} as new v${result.createdVersionNumber}${result.replayed ? " (confirmed prior request)" : ""}. Existing risk/design assessments, paid drafts and review decisions were retained and may need renewed review.`,
      );
      try {
        afterConfirmed(result);
      } catch {
        if (owns())
          setNotice(
            "Restore confirmed. Refresh reads only; do not resubmit because a view refresh failed.",
          );
      }
    } catch (cause) {
      if (retained && pendingRef.current === retained) {
        const outcome = owns()
          ? retainedTraceabilityReceipt(
              { input: retained.input, uncertain: retained.uncertain },
              cause,
            )
          : { uncertain: true };
        const next = outcome
          ? Object.freeze({ ...retained, uncertain: outcome.uncertain })
          : null;
        pendingRef.current = next;
        setPending((now) => (now === retained ? next : now));
      }
      if (owns())
        setNotice(
          pendingRef.current
            ? "The restore response is uncertain. Keep the exact original request and retry only to confirm it."
            : "Restore was refused before acceptance. Your selected fields and reason are retained; refresh the comparison if the case changed.",
        );
    } finally {
      busyRef.current = false;
      setPreparing(false);
    }
  }
  const busy = preparing || mutation.isPending;
  const canCommit =
    active &&
    open &&
    !readOnly &&
    fromVersion === null &&
    reads.readable &&
    !!reads.fresh?.canRecover &&
    !busy &&
    (pending
      ? sameVersionReader(reads.fresh.readScope, pending.origin)
      : !!draft &&
        !!preview &&
        preview.expectedCaseRevision === draft.baseline.expectedCaseRevision &&
        preview.expectedVersionRevision ===
          draft.baseline.expectedVersionRevision &&
        preview.versionId === draft.baseline.versionId &&
        settledIdentity !== draft.identity &&
        sameVersionReader(reads.fresh.readScope, draft.origin) &&
        draft.baseline.canRestore &&
        draft.baseline.versionNumber === version &&
        draft.confirmed &&
        !!draft.reason.trim() &&
        draft.reason.trim().length <= 1000 &&
        !!draft.fields.length);
  return {
    draft,
    draftRef,
    pending,
    pendingRef,
    busyRef,
    busy,
    notice,
    canCommit,
    commit,
    change,
    clearComparison,
    closeFrame: () => {
      if (frame.current) frame.current = { ...frame.current, open: false };
    },
    canBrowse: () =>
      navigationReady &&
      currentHandler(false) &&
      !busyRef.current &&
      !pendingRef.current,
  };
}
