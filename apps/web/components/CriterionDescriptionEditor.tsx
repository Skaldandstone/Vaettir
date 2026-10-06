"use client";
import { useState } from "react";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { usePlanGovernance } from "@/lib/use-plan-governance";
import {
  assertGovernanceAcknowledgement,
  planGovernanceRequestHash,
  retainedGovernancePending,
  type GovernancePending,
} from "@/lib/plan-governance-receipt";
import type { CaseFieldOrigin } from "@/lib/case-field-origin";
import { Modal } from "./Modal";
type Input = RouterInputs["testPlanGovernance"]["editCriterionDescription"];
export function CriterionDescriptionEditor({
  projectId,
  testPlanId,
  criterionId,
  onChanged,
}: {
  projectId: string;
  testPlanId: string;
  criterionId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<{
      text: string;
      revision: string;
      criterionRevision: string;
      origin: CaseFieldOrigin;
    } | null>(null);
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<GovernancePending<Input> | null>(null),
    [preparing, setPreparing] = useState(false);
  const { access, fresh, query } = usePlanGovernance(
    projectId,
    testPlanId,
    open,
  );
  const save =
    trpcReact.testPlanGovernance.editCriterionDescription.useMutation();
  function begin() {
    setOpen(true);
    setNotice("");
  }
  function review() {
    const criterion = fresh?.snapshot.criteria.find(
      (c) => c.id === criterionId,
    );
    if (!fresh?.canEdit || !criterion || !access.origin || pending) return;
    setDraft({
      text: criterion.description,
      revision: fresh.planRevision,
      criterionRevision: fresh.criterionRevisions[criterionId]!,
      origin: access.origin,
    });
    setReason("");
    setConfirmed(false);
  }
  async function commit() {
    const original = pending?.origin ?? draft?.origin;
    if (
      !original ||
      !access.owns(original, "edit") ||
      save.isPending ||
      preparing
    )
      return;
    let retained = pending;
    if (!retained) {
      if (
        !draft ||
        !fresh?.canEdit ||
        !draft.text.trim() ||
        !reason.trim() ||
        !confirmed
      )
        return;
      const input: Input = {
        projectId,
        testPlanId,
        criterionId,
        description: draft.text.trim(),
        expectedPlanRevision: draft.revision,
        expectedCriterionRevision: draft.criterionRevision,
        originalOrganizationId: original.organizationId,
        expectedClerkActorId: original.clerkActorId,
        requestId: crypto.randomUUID(),
        reason: reason.trim(),
        confirmed: true,
      };
      setPreparing(true);
      try {
        retained = {
          input,
          origin: original,
          operation: "EDIT_CRITERION_DESCRIPTION",
          requestHash: await planGovernanceRequestHash(
            "EDIT_CRITERION_DESCRIPTION",
            input,
          ),
          uncertain: false,
        };
      } catch {
        setNotice(
          "The request could not be prepared. Your wording remains unsaved.",
        );
        return;
      } finally {
        setPreparing(false);
      }
      if (!access.owns(original, "edit")) return;
      setPending(retained);
    }
    try {
      const result = await save.mutateAsync(retained.input);
      assertGovernanceAcknowledgement(result, retained);
      if (!access.owns(original, "edit")) {
        setPending({ ...retained, uncertain: true });
        return;
      }
    } catch (cause) {
      setPending(retainedGovernancePending(retained, cause));
      if (access.owns(original))
        setNotice(
          cause instanceof Error
            ? cause.message
            : "Not acknowledged. Retry this exact request.",
        );
      return;
    }
    setPending(null);
    setDraft(null);
    setConfirmed(false);
    setReason("");
    setNotice(
      "Wording saved with an audited version. Existing verdicts and requirement links were preserved.",
    );
    void query.refetch();
    onChanged();
  }
  const readable = access.readable;
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        onClick={begin}
        style={{ fontSize: 12 }}
      >
        Edit wording
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit saved criterion wording"
        keepMounted
      >
        {!readable ? (
          <p>
            Restore the original signed-in account and current project access.
            The draft and any uncertain request remain retained.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <p className="text-muted">
              Changes only the wording. Native verdicts, linked requirements and
              release assignment are preserved. Approved or archived plans and
              ready or shipped releases must be explicitly reopened first.
            </p>
            {query.error && (
              <p role="alert">
                {query.error.message}{" "}
                <button onClick={() => void query.refetch()}>Retry read</button>
              </p>
            )}
            {fresh?.editBlockedReason && (
              <p role="alert">{fresh.editBlockedReason}</p>
            )}
            {!draft && !pending && (
              <button disabled={!fresh?.canEdit} onClick={review}>
                {fresh
                  ? "Load current wording for review"
                  : "Loading current plan…"}
              </button>
            )}
            {draft && !pending && (
              <>
                <label>
                  Criterion wording
                  <textarea
                    rows={4}
                    maxLength={2000}
                    style={{ width: "100%" }}
                    value={draft.text}
                    disabled={preparing || !access.canEdit}
                    onChange={(event) => {
                      setDraft({ ...draft, text: event.target.value });
                      setConfirmed(false);
                    }}
                  />
                </label>
                <label>
                  Reason for this change
                  <input
                    maxLength={1000}
                    value={reason}
                    disabled={preparing || !access.canEdit}
                    onChange={(event) => {
                      setReason(event.target.value);
                      setConfirmed(false);
                    }}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={preparing || !access.canEdit}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />{" "}
                  I reviewed the wording; the existing verdict and requirement
                  association stay unchanged.
                </label>
                <button
                  onClick={() => void commit()}
                  disabled={
                    preparing ||
                    save.isPending ||
                    !fresh?.canEdit ||
                    !confirmed ||
                    !reason.trim() ||
                    !draft.text.trim()
                  }
                >
                  Save reviewed wording
                </button>
                <button
                  className="btn-secondary"
                  disabled={preparing || save.isPending}
                  onClick={review}
                >
                  Reload current wording (replaces unsaved text)
                </button>
              </>
            )}
            {pending && (
              <>
                <p>
                  The exact request is retained until acknowledged. Closing this
                  panel does not discard it.
                </p>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {pending.input.description}
                </p>
                <button
                  disabled={save.isPending || !access.canEdit}
                  onClick={() => void commit()}
                >
                  Retry same wording request
                </button>
              </>
            )}
            {notice && <p role="status">{notice}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}
