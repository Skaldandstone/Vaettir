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
  sameGovernanceReader,
  type GovernancePending,
} from "@/lib/plan-governance-receipt";
import { Modal } from "./Modal";
type Mode = "ADD_CRITERION" | "DELETE_CRITERION" | "SET_CRITERION_REQUIREMENT";
type Input =
  | RouterInputs["testPlanGovernance"]["addCriterion"]
  | RouterInputs["testPlanGovernance"]["deleteCriterion"]
  | RouterInputs["testPlanGovernance"]["setCriterionRequirement"];
export function GovernedCriterionCollection({
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
    [mode, setMode] = useState<Mode>("ADD_CRITERION");
  const [baseline, setBaseline] = useState<
    RouterOutputs["testPlanGovernance"]["preview"] | null
  >(null);
  const [description, setDescription] = useState(""),
    [criterionId, setCriterionId] = useState(""),
    [requirementId, setRequirementId] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string | undefined>();
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
  const frame = useRef<{
    projectId: string;
    testPlanId: string;
    readOnly: boolean;
  } | null>({ projectId, testPlanId, readOnly });
  useLayoutEffect(() => {
    frame.current = { projectId, testPlanId, readOnly };
    return () => {
      frame.current = null;
    };
  }, [projectId, testPlanId, readOnly]);
  const add = trpcReact.testPlanGovernance.addCriterion.useMutation(),
    remove = trpcReact.testPlanGovernance.deleteCriterion.useMutation(),
    associate =
      trpcReact.testPlanGovernance.setCriterionRequirement.useMutation();
  const busy =
    preparing || add.isPending || remove.isPending || associate.isPending;
  const origin = access.origin;
  const choicesQuery = trpcReact.testPlanGovernance.requirementChoices.useQuery(
    {
      projectId,
      testPlanId,
      originalOrganizationId: origin?.organizationId ?? "",
      expectedClerkActorId: origin?.clerkActorId ?? "",
      search,
      cursor,
      take: 25,
    },
    {
      enabled:
        open && access.readable && mode !== "DELETE_CRITERION" && !pending,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const choices =
    open &&
    access.readable &&
    !choicesQuery.isFetching &&
    !choicesQuery.isPaused &&
    !choicesQuery.error &&
    choicesQuery.data?.testPlanId === testPlanId &&
    sameGovernanceReader(choicesQuery.data.scope, origin)
      ? choicesQuery.data
      : null;
  function review() {
    if (!fresh?.canEdit || !origin || pending || busy || readOnly) return;
    setBaseline(fresh);
    setCriterionId("");
    setConfirmed(false);
    setNotice(
      "Loaded current plan for review. New criteria start pending; existing fields are never overwritten by this form.",
    );
  }
  async function commit() {
    const original = pending?.origin ?? origin;
    const originalPlanId = pending?.input.testPlanId ?? baseline?.snapshot.id;
    const ownsFrame = () =>
      !!original &&
      access.owns(original, "edit") &&
      frame.current?.projectId === original.projectId &&
      frame.current.testPlanId === originalPlanId &&
      !frame.current.readOnly;
    if (!original || !ownsFrame() || busy || readOnly) return;
    let retained = pending;
    if (!retained) {
      if (
        !baseline ||
        !fresh?.canEdit ||
        baseline.snapshot.id !== testPlanId ||
        !sameGovernanceReader(baseline.scope, original) ||
        !confirmed ||
        !reason.trim()
      )
        return;
      const criterion = baseline.snapshot.criteria.find(
        (c) => c.id === criterionId,
      );
      if (mode !== "ADD_CRITERION" && !criterion) return;
      if (mode === "ADD_CRITERION" && !description.trim()) return;
      const common = {
        projectId,
        testPlanId,
        originalOrganizationId: original.organizationId,
        expectedClerkActorId: original.clerkActorId,
        requestId: crypto.randomUUID(),
        expectedPlanRevision: baseline.planRevision,
        reason: reason.trim(),
        confirmed: true as const,
      };
      const input: Input =
        mode === "ADD_CRITERION"
          ? {
              ...common,
              criterionId: crypto.randomUUID(),
              description,
              requirementId,
            }
          : {
              ...common,
              criterionId,
              expectedCriterionRevision:
                baseline.criterionRevisions[criterionId]!,
              expectedRequirementId: criterion!.requirementId,
              ...(mode === "SET_CRITERION_REQUIREMENT"
                ? { requirementId }
                : {}),
            };
      setPreparing(true);
      try {
        retained = {
          input,
          origin: original,
          operation: mode,
          requestHash: await planGovernanceRequestHash(mode, input),
          uncertain: false,
        };
      } catch {
        setNotice(
          "The reviewed request could not be prepared. Your draft remains unsaved.",
        );
        return;
      } finally {
        setPreparing(false);
      }
      if (!ownsFrame()) return;
      setPending(retained);
    }
    try {
      const saved =
        retained.operation === "ADD_CRITERION"
          ? await add.mutateAsync(
              retained.input as RouterInputs["testPlanGovernance"]["addCriterion"],
            )
          : retained.operation === "DELETE_CRITERION"
            ? await remove.mutateAsync(
                retained.input as RouterInputs["testPlanGovernance"]["deleteCriterion"],
              )
            : await associate.mutateAsync(
                retained.input as RouterInputs["testPlanGovernance"]["setCriterionRequirement"],
              );
      assertGovernanceAcknowledgement(saved, retained);
      if (!ownsFrame()) {
        setPending({ ...retained, uncertain: true });
        return;
      }
    } catch (cause) {
      setPending(retainedGovernancePending(retained, cause));
      if (original && access.owns(original))
        setNotice(
          cause instanceof Error
            ? cause.message
            : "Not acknowledged. Retry the exact reviewed request.",
        );
      return;
    }
    setPending(null);
    setBaseline(null);
    setDescription("");
    setCriterionId("");
    setRequirementId(null);
    setReason("");
    setConfirmed(false);
    setNotice(
      "Saved with complete bounded before/after governance history. No unrelated criterion or verdict was changed.",
    );
    void query.refetch();
    onChanged();
  }
  const readable =
    access.readable &&
    (!pending ||
      (pending.input.projectId === projectId &&
        pending.input.testPlanId === testPlanId));
  const criterion = baseline?.snapshot.criteria.find(
    (c) => c.id === criterionId,
  );
  return (
    <>
      {(!readOnly || pending) && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setOpen(true)}
        >
          {pending
            ? "Reconcile criterion request"
            : "Add / remove / link criteria"}
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Manage governed acceptance criteria"
        keepMounted
        size="wide"
      >
        {!readable || readOnly || !access.canEdit ? (
          <p>
            Current original full-editor access is required. The local draft and
            exact pending request remain mounted and private until access
            returns.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            <p className="text-muted">
              Add a pending criterion, remove one explicitly, or change its
              requirement association. Existing wording, native verdicts, plan
              approvals and unrelated criteria are retained. Frozen
              plans/releases must be reopened first.
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
            {pending ? (
              <>
                <p>
                  Request {pending.input.requestId}:{" "}
                  {pending.operation.replaceAll("_", " ")} remains fixed until
                  acknowledged. Closing keeps its exact input and identity.
                </p>
                <details>
                  <summary>Exact reviewed request</summary>
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
                  Retry identical criterion request
                </button>
              </>
            ) : (
              <>
                <label>
                  Change
                  <select
                    value={mode}
                    disabled={busy || !access.canEdit}
                    onChange={(event) => {
                      const nextMode = event.target.value as Mode;
                      setMode(nextMode);
                      if (nextMode === "SET_CRITERION_REQUIREMENT")
                        setRequirementId(
                          baseline?.snapshot.criteria.find(
                            (c) => c.id === criterionId,
                          )?.requirementId ?? null,
                        );
                      else if (nextMode === "ADD_CRITERION")
                        setRequirementId(null);
                      setConfirmed(false);
                    }}
                  >
                    <option value="ADD_CRITERION">Add pending criterion</option>
                    <option value="DELETE_CRITERION">Remove criterion</option>
                    <option value="SET_CRITERION_REQUIREMENT">
                      Link / unlink requirement
                    </option>
                  </select>
                </label>
                <button disabled={busy || !fresh?.canEdit} onClick={review}>
                  {baseline
                    ? "Load current plan (replaces reviewed baseline)"
                    : "Load current plan for review"}
                </button>
                {baseline && (
                  <>
                    {baseline.planRevision !== fresh?.planRevision && (
                      <p role="alert">
                        The plan changed after this baseline was reviewed. Your
                        draft remains retained; load and review current criteria
                        before saving.
                      </p>
                    )}
                    {mode === "ADD_CRITERION" ? (
                      <label>
                        Criterion wording
                        <textarea
                          rows={4}
                          value={description}
                          maxLength={2000}
                          disabled={busy || !access.canEdit}
                          onChange={(event) => {
                            setDescription(event.target.value);
                            setConfirmed(false);
                          }}
                        />
                      </label>
                    ) : (
                      <>
                        <label>
                          Criterion
                          <select
                            value={criterionId}
                            disabled={busy || !access.canEdit}
                            onChange={(event) => {
                              setCriterionId(event.target.value);
                              if (mode === "SET_CRITERION_REQUIREMENT")
                                setRequirementId(
                                  baseline.snapshot.criteria.find(
                                    (c) => c.id === event.target.value,
                                  )?.requirementId ?? null,
                                );
                              setConfirmed(false);
                            }}
                          >
                            <option value="">
                              Choose the exact criterion…
                            </option>
                            {baseline.snapshot.criteria.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.id} · {c.description}
                              </option>
                            ))}
                          </select>
                        </label>
                        {criterion && (
                          <div
                            className="panel"
                            style={{ overflowWrap: "anywhere" }}
                          >
                            <code>{criterion.id}</code>
                            <p style={{ whiteSpace: "pre-wrap" }}>
                              {criterion.description}
                            </p>
                            <p>
                              Native verdict: {criterion.status} · Original
                              requirement: {criterion.requirementId ?? "None"}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                    {mode !== "DELETE_CRITERION" && (
                      <fieldset
                        disabled={busy || !access.canEdit}
                        style={{ minWidth: 0 }}
                      >
                        <legend>Same-project requirement</legend>
                        <label>
                          Search title or requirement ID
                          <input
                            value={search}
                            maxLength={200}
                            onChange={(event) => {
                              setSearch(event.target.value);
                              setCursor(undefined);
                            }}
                          />
                        </label>
                        <p>
                          Selected:{" "}
                          <code>
                            {requirementId ??
                              "No requirement (explicitly unlinked)"}
                          </code>
                        </p>
                        <label>
                          <input
                            type="radio"
                            name={`requirement-${testPlanId}`}
                            checked={requirementId === null}
                            onChange={() => {
                              setRequirementId(null);
                              setConfirmed(false);
                            }}
                          />{" "}
                          No requirement
                        </label>
                        {choices?.choices.map((choice) => (
                          <label
                            key={choice.id}
                            style={{
                              display: "block",
                              marginTop: 8,
                              overflowWrap: "anywhere",
                            }}
                          >
                            <input
                              type="radio"
                              name={`requirement-${testPlanId}`}
                              checked={requirementId === choice.id}
                              onChange={() => {
                                setRequirementId(choice.id);
                                setConfirmed(false);
                              }}
                            />
                            <code>{choice.id}</code> {choice.title}
                          </label>
                        ))}
                        {choicesQuery.error && (
                          <p role="alert">
                            {choicesQuery.error.message}
                            <button onClick={() => void choicesQuery.refetch()}>
                              Retry requirement search
                            </button>
                          </p>
                        )}
                        {choices?.choices.length === 0 && (
                          <p>
                            No matching requirements. Nothing will be created or
                            inferred.
                          </p>
                        )}
                        {cursor && (
                          <button onClick={() => setCursor(undefined)}>
                            First page
                          </button>
                        )}
                        {choices?.nextCursor && (
                          <button
                            onClick={() => setCursor(choices.nextCursor!)}
                          >
                            Next 25 requirements
                          </button>
                        )}
                      </fieldset>
                    )}
                    <label>
                      Reason for this change
                      <textarea
                        value={reason}
                        rows={2}
                        maxLength={1000}
                        disabled={busy || !access.canEdit}
                        onChange={(event) => {
                          setReason(event.target.value);
                          setConfirmed(false);
                        }}
                      />
                    </label>
                    {mode === "SET_CRITERION_REQUIREMENT" && criterion && (
                      <p>
                        Reviewed association:{" "}
                        <code>{criterion.requirementId ?? "None"}</code> →{" "}
                        <code>{requirementId ?? "None (explicit unlink)"}</code>
                      </p>
                    )}
                    <label>
                      <input
                        type="checkbox"
                        checked={confirmed}
                        disabled={busy || !access.canEdit}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />{" "}
                      {mode === "DELETE_CRITERION"
                        ? "I explicitly reviewed removal of this exact criterion. Its complete native row will remain in governance history."
                        : "I reviewed this exact change and requirement choice. All other criteria and native verdicts stay unchanged."}
                    </label>
                    <button
                      disabled={
                        busy ||
                        !fresh?.canEdit ||
                        baseline.planRevision !== fresh.planRevision ||
                        !confirmed ||
                        !reason.trim() ||
                        (mode === "ADD_CRITERION"
                          ? !description.trim() ||
                            baseline.snapshot.criteria.length >= 200
                          : !criterion)
                      }
                      onClick={() => void commit()}
                    >
                      {mode === "DELETE_CRITERION"
                        ? "Remove reviewed criterion"
                        : "Save reviewed criterion change"}
                    </button>
                  </>
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
