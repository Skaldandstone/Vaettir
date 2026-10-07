"use client";
import { useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { sameGovernanceReader } from "@/lib/plan-governance-receipt";
import { governanceCriterionValue, governanceHeaderDescription, governanceOperationLabel, governanceMetadataValue } from "@/lib/plan-governance-display";
export function PlanGovernanceHistory({
  projectId,
  testPlanId,
}: {
  projectId: string;
  testPlanId: string;
}) {
  const [open, setOpen] = useState(false),
    [before, setBefore] = useState<
      { createdAt: string; id: string } | undefined
    >();
  const access = useCaseFieldAccess(projectId, undefined, open),
    origin = access.origin;
  const query = trpcReact.testPlanGovernance.history.useQuery(
    {
      projectId,
      testPlanId,
      originalOrganizationId: origin?.organizationId ?? "",
      expectedClerkActorId: origin?.clerkActorId ?? "",
      take: 5,
      before,
    },
    {
      enabled: open && access.readable,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const matchingEntries = query.data?.entries.every(
    (entry) =>
      entry.receipt.ack.testPlanId === testPlanId &&
      entry.receipt.before.id === testPlanId &&
      entry.receipt.after.id === testPlanId &&
      entry.receipt.ack.scope.projectId === projectId,
  );
  const fresh =
    open &&
    access.readable &&
    !query.isFetching &&
    !query.isPaused &&
    !query.error &&
    sameGovernanceReader(query.data?.scope, origin) &&
    matchingEntries
      ? query.data
      : null;
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Governed plan, fields, criteria and assignment history</summary>
      <p className="text-muted">
        These new governance entries retain complete plan scalar fields, native
        criteria and release assignment, linked to a plan version. Legacy plan
        versions did not include criteria or assignment. This is not a snapshot
        of test case procedures or requirement bodies.
      </p>
      {!access.readable ? (
        <p>Checking current original project access…</p>
      ) : (
        <>
          {query.error && (
            <p role="alert">
              {query.error.message}
              <button onClick={() => void query.refetch()}>
                Retry history
              </button>
            </p>
          )}
          {query.data && matchingEntries === false && (
            <p role="alert">
              This history page did not identify the original plan. No unrelated
              snapshots are displayed.
              <button onClick={() => void query.refetch()}>
                Retry scoped history
              </button>
            </p>
          )}
          {!fresh && !query.error && <p>Loading bounded history…</p>}
          {fresh?.entries.length === 0 && (
            <p>
              No governed plan, field, criterion or assignment changes on this page. Legacy
              versions remain in the plan's own history.
            </p>
          )}
          {fresh?.entries.map((entry) => (
            <details key={entry.id}>
              <summary>
                Version {entry.receipt.ack.versionNumber} ·{" "}
                {governanceOperationLabel(entry.receipt.ack.operation)}{" "}
                · {new Date(entry.createdAt).toLocaleString()}
              </summary>
              <p>Reason: {entry.receipt.reason}</p>
              {entry.receipt.ack.operation === "EDIT_PLAN_HEADER" ? (
                <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  <p>Before name: {entry.receipt.before.name}</p>
                  <p>After name: {entry.receipt.after.name}</p>
                  <p>Before description: {governanceHeaderDescription(entry.receipt.before.description)}</p>
                  <p>After description: {governanceHeaderDescription(entry.receipt.after.description)}</p>
                </div>
              ) : entry.receipt.ack.operation === "SET_PLAN_STATUS" ? (
                <p>Native lifecycle: {entry.receipt.before.status} → {entry.receipt.after.status}. This label is not a compliance sign-off or proof of passing evidence; reopening does not change any criterion verdict.</p>
              ) : entry.receipt.ack.operation === "EDIT_PLAN_CUSTOM_FIELDS" ? (
                <section>
                  <p>Only the reviewed declared keys changed. Other native metadata and plan status stayed retained.</p>
                  {entry.receipt.metadataReview?.changes.map(change => <div key={change.key}>
                    <strong>{change.operation === "REMOVE" ? "Remove" : "Set"} <code>{JSON.stringify(change.key)}</code></strong>
                    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>Before: {governanceMetadataValue(entry.receipt.before.customFields, change.key)}</pre>
                    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>After: {governanceMetadataValue(entry.receipt.after.customFields, change.key)}</pre>
                  </div>)}
                  {entry.receipt.metadataReview && <details><summary>Retained reviewed field schema</summary><code>{entry.receipt.metadataReview.fieldSchemaHash}</code><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(entry.receipt.metadataReview.fieldSchema, null, 2)}</pre></details>}
                </section>
              ) : entry.receipt.ack.criterionId ? (
                <>
                  <p>
                    Before:{" "}
                    {governanceCriterionValue(entry.receipt.before.criteria, entry.receipt.ack.criterionId, entry.receipt.ack.operation)}
                  </p>
                  <p>
                    After:{" "}
                    {governanceCriterionValue(entry.receipt.after.criteria, entry.receipt.ack.criterionId, entry.receipt.ack.operation)}
                  </p>
                </>
              ) : (
                <p>
                  Assignment: {entry.receipt.before.releaseId ?? "Unassigned"} →{" "}
                  {entry.receipt.after.releaseId ?? "Unassigned"}
                </p>
              )}
              <details>
                <summary>Complete retained governance snapshots</summary>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    maxHeight: 320,
                    overflow: "auto",
                  }}
                >
                  {JSON.stringify(
                    {
                      before: entry.receipt.before,
                      after: entry.receipt.after,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </details>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            {before && (
              <button onClick={() => setBefore(undefined)}>
                Newest history
              </button>
            )}
            {fresh?.nextCursor && (
              <button onClick={() => setBefore(fresh.nextCursor!)}>
                Older changes
              </button>
            )}
          </div>
        </>
      )}
    </details>
  );
}
