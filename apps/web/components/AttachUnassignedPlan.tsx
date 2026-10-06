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
type Input = RouterInputs["testPlanGovernance"]["attachUnassignedPlan"];
export function AttachUnassignedPlan({
  projectId,
  releaseId,
  releaseStatus,
  plans,
  onChanged,
}: {
  projectId: string;
  releaseId: string;
  releaseStatus: string;
  plans: Array<{ id: string; name: string }>;
  onChanged: () => void;
}) {
  const [planId, setPlanId] = useState(""),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<GovernancePending<Input> | null>(null),
    [preparing, setPreparing] = useState(false);
  const { access, fresh, query } = usePlanGovernance(
    projectId,
    pending?.input.testPlanId ?? planId,
  );
  const save = trpcReact.testPlanGovernance.attachUnassignedPlan.useMutation();
  const targetBlocked = ["READY", "SHIPPED"].includes(releaseStatus);
  async function commit() {
    const original = pending?.origin ?? access.origin;
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
        !fresh?.canEdit ||
        targetBlocked ||
        fresh.snapshot.releaseId !== null ||
        !confirmed ||
        !reason.trim()
      )
        return;
      const input: Input = {
        projectId,
        testPlanId: fresh.snapshot.id,
        releaseId,
        expectedReleaseId: null,
        expectedPlanRevision: fresh.planRevision,
        requestId: crypto.randomUUID(),
        originalOrganizationId: original.organizationId,
        expectedClerkActorId: original.clerkActorId,
        reason: reason.trim(),
        confirmed: true,
      };
      setPreparing(true);
      try {
        retained = {
          input,
          origin: original,
          operation: "ATTACH_UNASSIGNED_PLAN",
          requestHash: await planGovernanceRequestHash(
            "ATTACH_UNASSIGNED_PLAN",
            input,
          ),
          uncertain: false,
        };
      } catch {
        setNotice(
          "The attachment request could not be prepared. No change was submitted.",
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
            : "Not acknowledged. Retry this exact attachment.",
        );
      return;
    }
    setPending(null);
    setPlanId("");
    setReason("");
    setConfirmed(false);
    setNotice(
      "Plan attached with an audited version. No other release lost its quality scope.",
    );
    onChanged();
  }
  if (!access.readable)
    return (
      <p>
        Checking original project access. Any uncertain attachment remains
        retained.
      </p>
    );
  if (!access.canEdit && !pending)
    return <p>An editor with a full seat can attach an unassigned plan.</p>;
  return (
    <section
      aria-label="Attach an unassigned quality plan"
      style={{ display: "grid", gap: 8, marginTop: 12 }}
    >
      {pending ? (
        <>
          <p>
            An attachment request is awaiting acknowledgement. Its original
            plan, release and UUID remain fixed.
          </p>
          <button
            onClick={() => void commit()}
            disabled={save.isPending || !access.canEdit}
          >
            Retry same attachment
          </button>
        </>
      ) : (
        <>
          {targetBlocked && (
            <p>
              Reopen this release's planning status before attaching quality
              scope.
            </p>
          )}
          <label>
            Unassigned test plan
            <select
              value={planId}
              disabled={preparing || save.isPending || targetBlocked}
              onChange={(event) => {
                setPlanId(event.target.value);
                setConfirmed(false);
              }}
            >
              <option value="">Choose a plan…</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
          {query.error && (
            <p role="alert">
              {query.error.message}{" "}
              <button onClick={() => void query.refetch()}>
                Retry reviewed plan
              </button>
            </p>
          )}
          {fresh?.editBlockedReason && (
            <p role="alert">{fresh.editBlockedReason}</p>
          )}
          {fresh && (
            <p>
              {fresh.snapshot.criteria.length} native criteria will contribute
              to this release. Their existing verdicts and linked requirements
              remain unchanged.
            </p>
          )}
          <label>
            Reason for attachment
            <input
              value={reason}
              maxLength={1000}
              disabled={preparing}
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
              disabled={preparing || !fresh?.canEdit || targetBlocked}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            I reviewed this unassigned plan for the current release.
          </label>
          <button
            onClick={() => void commit()}
            disabled={
              preparing ||
              save.isPending ||
              !fresh?.canEdit ||
              fresh.snapshot.releaseId !== null ||
              targetBlocked ||
              !confirmed ||
              !reason.trim()
            }
          >
            Attach reviewed plan
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
