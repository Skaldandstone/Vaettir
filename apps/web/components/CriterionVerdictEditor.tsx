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
type Input = RouterInputs["testPlanGovernance"]["setCriterionVerdict"];
export function CriterionVerdictEditor({
  projectId,
  testPlanId,
  criterionId,
  status,
  computed = false,
  onChanged,
}: {
  projectId: string;
  testPlanId: string;
  criterionId: string;
  status: string;
  computed?: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<{
      status: Input["status"];
      wording: string;
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
  const save = trpcReact.testPlanGovernance.setCriterionVerdict.useMutation();
  function review() {
    const criterion = fresh?.snapshot.criteria.find(
      (c) => c.id === criterionId,
    );
    if (
      !fresh?.canEdit ||
      !fresh.manualVerdicts ||
      !criterion ||
      !access.origin ||
      pending
    )
      return;
    setDraft({
      status: criterion.status,
      wording: criterion.description,
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
        !fresh.manualVerdicts ||
        !reason.trim() ||
        !confirmed
      )
        return;
      const input: Input = {
        projectId,
        testPlanId,
        criterionId,
        status: draft.status,
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
          operation: "SET_CRITERION_VERDICT",
          requestHash: await planGovernanceRequestHash(
            "SET_CRITERION_VERDICT",
            input,
          ),
          uncertain: false,
        };
      } catch {
        setNotice(
          "The verdict could not be prepared. No decision was submitted.",
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
            : "Not acknowledged. Retry this exact verdict request.",
        );
      return;
    }
    setPending(null);
    setDraft(null);
    setConfirmed(false);
    setReason("");
    setNotice(
      "Native verdict saved with an audited version. Wording and requirement associations were preserved.",
    );
    void query.refetch();
    onChanged();
  }
  const readable = access.readable;
  return (
    <>
      <span style={{ fontSize: 12 }}>
        {status}
        {computed && (
          <span className="text-muted"> (live from case evidence)</span>
        )}
      </span>{" "}
      {(!computed || pending || draft) && (
        <button
          type="button"
          className="btn-secondary"
          style={{ fontSize: 12 }}
          onClick={() => setOpen(true)}
        >
          {pending ? "Reconcile verdict" : "Review verdict"}
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Review criterion verdict"
        keepMounted
      >
        {!readable ? (
          <p>
            Restore the original account and current project access. Your draft
            and exact uncertain request remain retained but private.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <p className="text-muted">
              Change only this native criterion verdict. Wording, linked
              requirements and all other criteria stay unchanged. A manual
              decision does not constitute executed test evidence.
            </p>
            {query.error && (
              <p role="alert">
                {query.error.message}
                <button onClick={() => void query.refetch()}>
                  Retry plan read
                </button>
              </p>
            )}
            {fresh?.editBlockedReason && (
              <p role="alert">{fresh.editBlockedReason}</p>
            )}
            {fresh && !fresh.manualVerdicts && (
              <p>
                Effective verdicts for this plan are computed from test case
                evidence. Record case results instead.
              </p>
            )}
            {!draft && !pending && (
              <button
                onClick={review}
                disabled={!fresh?.canEdit || !fresh.manualVerdicts}
              >
                Load native criterion for review
              </button>
            )}
            {draft && !pending && (
              <>
                <p style={{ whiteSpace: "pre-wrap" }}>{draft.wording}</p>
                <label>
                  Verdict
                  <select
                    value={draft.status}
                    disabled={preparing || !access.canEdit}
                    onChange={(event) => {
                      setDraft({
                        ...draft,
                        status: event.target.value as Input["status"],
                      });
                      setConfirmed(false);
                    }}
                  >
                    {(["PENDING", "MET", "AT_RISK", "NOT_MET"] as const).map(
                      (value) => (
                        <option key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Reason / evidence reference
                  <textarea
                    maxLength={1000}
                    rows={3}
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
                  I reviewed this verdict; existing wording and requirement
                  links remain unchanged.
                </label>
                <button
                  onClick={() => void commit()}
                  disabled={
                    preparing ||
                    save.isPending ||
                    !fresh?.canEdit ||
                    !fresh.manualVerdicts ||
                    !confirmed ||
                    !reason.trim()
                  }
                >
                  Save reviewed verdict
                </button>
                <button
                  className="btn-secondary"
                  disabled={preparing || save.isPending}
                  onClick={review}
                >
                  Reload current criterion (replaces unsaved decision)
                </button>
              </>
            )}
            {pending && (
              <>
                <p>
                  Verdict {pending.input.status} is awaiting acknowledgement.
                  Closing this panel retains the exact request.
                </p>
                <button
                  disabled={save.isPending || !access.canEdit}
                  onClick={() => void commit()}
                >
                  Retry same verdict request
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
