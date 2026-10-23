"use client";
import { useLayoutEffect, useRef, useState } from "react";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import { usePlanGovernance } from "@/lib/use-plan-governance";
import {
  assertGovernanceAcknowledgement,
  planGovernanceRequestHash,
  retainedGovernancePending,
  reviewedPlanHeaderFields,
  sameGovernanceReader,
  type GovernancePending,
} from "@/lib/plan-governance-receipt";
import type { CaseFieldOrigin } from "@/lib/case-field-origin";
import { Modal } from "./Modal";
type Input = RouterInputs["testPlanGovernance"]["editPlanHeader"];
type Draft = {
  baseline: RouterOutputs["testPlanGovernance"]["preview"];
  origin: CaseFieldOrigin;
  name: string;
  description: string | null;
  descriptionText: string;
  editName: boolean;
  editDescription: boolean;
  reason: string;
  confirmed: boolean;
};
type HeaderPending = GovernancePending<Input> & { reviewedDraft: Draft };
export function PlanHeaderEditor({
  projectId,
  testPlanId,
  readOnly = false,
  onChanged,
}: {
  projectId: string;
  testPlanId: string;
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<Draft | null>(null),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<HeaderPending | null>(null),
    [preparing, setPreparing] = useState(false);
  const { access, fresh, query } = usePlanGovernance(
    projectId,
    testPlanId,
    open,
  );
  const save = trpcReact.testPlanGovernance.editPlanHeader.useMutation();
  const draftRef = useRef(draft),
    pendingRef = useRef(pending),
    busyRef = useRef(false);
  const frame = useRef<{
    projectId: string;
    testPlanId: string;
    readOnly: boolean;
  } | null>({ projectId, testPlanId, readOnly });
  useLayoutEffect(() => {
    draftRef.current = draft;
    pendingRef.current = pending;
  }, [draft, pending]);
  useLayoutEffect(() => {
    frame.current = { projectId, testPlanId, readOnly };
    return () => {
      frame.current = null;
    };
  }, [projectId, testPlanId, readOnly]);
  const busy = preparing || save.isPending;
  function review() {
    if (
      !fresh?.canEdit ||
      !access.origin ||
      readOnly ||
      busyRef.current ||
      pendingRef.current
    )
      return;
    const next: Draft = {
      baseline: fresh,
      origin: access.origin,
      name: fresh.snapshot.name,
      description: fresh.snapshot.description,
      descriptionText: fresh.snapshot.description ?? "",
      editName: false,
      editDescription: false,
      reason: "",
      confirmed: false,
    };
    draftRef.current = next;
    setDraft(next);
    setNotice(
      "Loaded the exact current header. Choose only the fields you intend to change.",
    );
  }
  function change(values: Partial<Draft>) {
    if (
      busyRef.current ||
      pendingRef.current ||
      readOnly ||
      !access.canEdit ||
      !draftRef.current
    )
      return;
    const next = {
      ...draftRef.current,
      ...values,
      confirmed: values.confirmed === true,
    };
    draftRef.current = next;
    setDraft(next);
  }
  async function commit() {
    const currentPending = pendingRef.current,
      capturedDraft = currentPending?.reviewedDraft ?? draftRef.current;
    const original = currentPending?.origin ?? capturedDraft?.origin;
    const originalPlanId =
      currentPending?.input.testPlanId ?? capturedDraft?.baseline.snapshot.id;
    const ownsFrame = () =>
      !!original &&
      access.owns(original, "edit") &&
      frame.current?.projectId === original.projectId &&
      frame.current.testPlanId === originalPlanId &&
      !frame.current.readOnly;
    if (!original || !ownsFrame() || busyRef.current || readOnly) return;
    busyRef.current = true;
    let retained = currentPending;
    try {
      if (!retained) {
        if (
          !capturedDraft ||
          !fresh?.canEdit ||
          capturedDraft.baseline.snapshot.id !== testPlanId ||
          !sameGovernanceReader(capturedDraft.baseline.scope, original) ||
          capturedDraft.baseline.planRevision !== fresh.planRevision ||
          !capturedDraft.confirmed ||
          !capturedDraft.reason.trim()
        )
          return;
        const changes = reviewedPlanHeaderFields(
          capturedDraft.baseline.snapshot,
          capturedDraft,
        );
        if (
          !Object.keys(changes).length ||
          (changes.name !== undefined && !changes.name.trim())
        )
          return;
        const input: Input = {
          projectId,
          testPlanId,
          originalOrganizationId: original.organizationId,
          expectedClerkActorId: original.clerkActorId,
          expectedPlanRevision: capturedDraft.baseline.planRevision,
          requestId: crypto.randomUUID(),
          reason: capturedDraft.reason.trim(),
          confirmed: true,
          ...changes,
        };
        setPreparing(true);
        let requestHash: string;
        try {
          requestHash = await planGovernanceRequestHash(
            "EDIT_PLAN_HEADER",
            input,
          );
        } finally {
          setPreparing(false);
        }
        // Preparation may outlive a field change, account switch or reused
        // plan host. Never replace a newer draft or transfer the frozen intent.
        if (
          !ownsFrame() ||
          draftRef.current !== capturedDraft ||
          pendingRef.current !== null
        )
          return;
        retained = {
          input,
          origin: original,
          operation: "EDIT_PLAN_HEADER",
          requestHash,
          uncertain: false,
          reviewedDraft: capturedDraft,
        };
        pendingRef.current = retained;
        setPending(retained);
      }
      const saved = await save.mutateAsync(retained.input);
      assertGovernanceAcknowledgement(saved, retained);
      if (!ownsFrame() || pendingRef.current !== retained) {
        if (pendingRef.current === retained) {
          const uncertain = { ...retained, uncertain: true };
          pendingRef.current = uncertain;
          setPending((current) => (current === retained ? uncertain : current));
        }
        return;
      }
      pendingRef.current = null;
      setPending((current) => (current === retained ? null : current));
      if (draftRef.current !== retained.reviewedDraft) {
        setNotice(
          "Confirmed the previous header request. Your newer draft remains unchanged; refresh and review current saved values before a new save.",
        );
        return;
      }
      draftRef.current = null;
      setDraft((current) => (current === capturedDraft ? null : current));
      setNotice(
        "Header saved with complete governance history. Status, custom fields, procedures, criteria and assignment were preserved.",
      );
      void query.refetch();
      onChanged();
    } catch (cause) {
      if (retained && pendingRef.current === retained) {
        const result = retainedGovernancePending(retained, cause);
        const next = result
          ? { ...result, reviewedDraft: retained.reviewedDraft }
          : null;
        pendingRef.current = next;
        setPending((current) => (current === retained ? next : current));
      }
      if (ownsFrame())
        setNotice(
          cause instanceof Error
            ? cause.message
            : "The header request was not acknowledged. Your exact request and draft remain retained.",
        );
    } finally {
      busyRef.current = false;
      setPreparing(false);
    }
  }
  const belongsToPlan =
    (!draft || draft.baseline.snapshot.id === testPlanId) &&
    (!pending || pending.input.testPlanId === testPlanId);
  const readable =
    access.readable && belongsToPlan && !readOnly && access.canEdit;
  const changes = draft
    ? reviewedPlanHeaderFields(draft.baseline.snapshot, draft)
    : {};
  const validChanges =
    Object.keys(changes).length > 0 &&
    (changes.name === undefined || changes.name.trim().length > 0);
  return (
    <>
      {(!readOnly || pending) && (
        <button
          className="btn-secondary"
          type="button"
          onClick={() => setOpen(true)}
        >
          {pending
            ? "Reconcile header request"
            : "Edit plan name / description"}
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Review plan header changes"
        keepMounted
        size="wide"
      >
        {!readable ? (
          <p>
            Restore the original plan, signed-in actor and current full-editor
            access. Your local draft and uncertain request remain mounted but
            private.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            <p className="text-muted">
              Changes only the selected name or description. Status, custom
              fields, criteria, requirements, assignment and execution
              configuration are not submitted by this editor. Approved/archived
              plans and ready/shipped releases must be explicitly reopened
              first.
            </p>
            {query.error && (
              <p role="alert">
                {query.error.message}
                <button onClick={() => void query.refetch()}>
                  Retry current header
                </button>
              </p>
            )}
            {fresh?.editBlockedReason && (
              <p role="alert">{fresh.editBlockedReason}</p>
            )}
            {pending ? (
              <>
                <p>
                  Request {pending.input.requestId} is retained. Retry identical
                  content, not a replacement save.
                </p>
                <details>
                  <summary>Exact reviewed header request</summary>
                  <pre
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {JSON.stringify(pending.input, null, 2)}
                  </pre>
                </details>
                <button
                  disabled={busy || !access.canEdit}
                  onClick={() => void commit()}
                >
                  Retry identical header request
                </button>
              </>
            ) : (
              <>
                <button disabled={busy || !fresh?.canEdit} onClick={review}>
                  {draft
                    ? "Load current header (replaces unsaved header draft)"
                    : "Load current header for review"}
                </button>
                {draft && (
                  <fieldset
                    disabled={busy || !access.canEdit}
                    style={{
                      display: "grid",
                      gap: 12,
                      border: 0,
                      padding: 0,
                      minWidth: 0,
                    }}
                  >
                    {draft.baseline.planRevision !== fresh?.planRevision && (
                      <p role="alert">
                        The plan changed after review. Your draft remains
                        retained; explicitly load and review the current header
                        before a new save.
                      </p>
                    )}
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.editName}
                        onChange={(event) =>
                          change({ editName: event.target.checked })
                        }
                      />{" "}
                      Change name
                    </label>
                    <label>
                      Name
                      <input
                        value={draft.name}
                        maxLength={10000}
                        disabled={!draft.editName}
                        onChange={(event) =>
                          change({ name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.editDescription}
                        onChange={(event) =>
                          change({ editDescription: event.target.checked })
                        }
                      />{" "}
                      Change description
                    </label>
                    <label>
                      Description value
                      <select
                        disabled={!draft.editDescription}
                        value={draft.description === null ? "NULL" : "TEXT"}
                        onChange={(event) =>
                          change({
                            description:
                              event.target.value === "NULL"
                                ? null
                                : draft.descriptionText,
                          })
                        }
                      >
                        <option value="NULL">
                          No description (native NULL)
                        </option>
                        <option value="TEXT">
                          Text (empty text is distinct from NULL)
                        </option>
                      </select>
                    </label>
                    {draft.description !== null && (
                      <textarea
                        rows={5}
                        maxLength={40000}
                        value={draft.description}
                        disabled={!draft.editDescription}
                        onChange={(event) =>
                          change({
                            description: event.target.value,
                            descriptionText: event.target.value,
                          })
                        }
                      />
                    )}
                    <details>
                      <summary>Reviewed before / after changes</summary>
                      <pre
                        style={{
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {JSON.stringify(
                          {
                            before: {
                              name: draft.baseline.snapshot.name,
                              description: draft.baseline.snapshot.description,
                            },
                            submittedChangesOnly: changes,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                    <label>
                      Reason
                      <textarea
                        rows={2}
                        maxLength={1000}
                        value={draft.reason}
                        onChange={(event) =>
                          change({ reason: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={draft.confirmed}
                        onChange={(event) =>
                          change({ confirmed: event.target.checked })
                        }
                      />{" "}
                      I reviewed these exact header changes; all other plan
                      fields remain unchanged.
                    </label>
                    <button
                      disabled={
                        !validChanges ||
                        !draft.confirmed ||
                        !draft.reason.trim() ||
                        !fresh?.canEdit ||
                        draft.baseline.planRevision !== fresh.planRevision
                      }
                      onClick={() => void commit()}
                    >
                      Save reviewed header
                    </button>
                  </fieldset>
                )}
              </>
            )}
            {notice && <p role="status">{notice}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}
