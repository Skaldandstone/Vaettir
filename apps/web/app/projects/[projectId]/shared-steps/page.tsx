"use client";

import { useRef, useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { Modal } from "@/components/Modal";
import { SharedStepHistoryReview } from "@/components/SharedStepHistoryReview";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";

export default function SharedStepsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit } = useProjectPermissions(projectId);
  const [includeArchived, setIncludeArchived] = useState(false);
  const query = trpcReact.sharedStepGroups.list.useQuery(
    { projectId, includeArchived },
    { retry: false },
  );
  const [library, setLibrary] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPending, setHistoryPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState([
    {
      action: "",
      expectedActionOrData: "",
      expectedResult: "",
      expectedResponse: "",
    },
  ]);
  const [approved, setApproved] = useState(false);
  const [pending, setPending] = useState<
    RouterInputs["sharedStepGroups"]["create"] | null
  >(null);
  const pendingReceipt = useRef<TraceabilityReceipt<
    RouterInputs["sharedStepGroups"]["create"]
  > | null>(null);
  const create = trpcReact.sharedStepGroups.create.useMutation({
    onSuccess: () => {
      pendingReceipt.current = null;
      setOpen(false);
      setPending(null);
      setName("");
      setDescription("");
      setSteps([
        {
          action: "",
          expectedActionOrData: "",
          expectedResult: "",
          expectedResponse: "",
        },
      ]);
      setApproved(false);
      void query.refetch();
    },
    onError: (error) => {
      if (pendingReceipt.current) {
        pendingReceipt.current = retainedTraceabilityReceipt(
          pendingReceipt.current,
          error,
        );
        setPending(pendingReceipt.current?.input ?? null);
        if (!pendingReceipt.current) setApproved(false);
      }
    },
  });
  const groups =
    query.isError || query.fetchStatus !== "idle" ? null : query.data;
  return (
    <div style={{ maxWidth: 850 }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h1>Shared step libraries</h1>
        {canEdit && (
          <button className="btn-primary" onClick={() => setOpen(true)}>
            New library
          </button>
        )}
      </div>
      <p>
        Reuse procedures in current test cases. Review changes and retained
        revisions here. Frozen run instructions and recorded outcomes are never
        rewritten by a library edit.
      </p>
      <label>
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        Show archived libraries
      </label>
      {query.isError && (
        <div role="alert">
          <p>
            Library access could not be verified. Cached libraries are hidden.
          </p>
          <button onClick={() => void query.refetch()}>Retry libraries</button>
        </div>
      )}
      {!query.isError && !groups && (
        <p role="status">Loading current libraries…</p>
      )}
      {groups?.map((g) => (
        <article
          key={g.id}
          className="panel"
          style={{
            padding: 12,
            marginTop: 10,
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
          <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <strong>{g.name}</strong>
            <p style={{ marginBottom: 0 }}>
              Revision {g.revision} · {g.steps.length} steps · {g.usageCount}{" "}
              current cases{g.archivedAt ? " · Archived" : ""}
            </p>
            {g.description && <p>{g.description}</p>}
          </div>
          <button
            disabled={historyPending && library !== g.id}
            onClick={() => {
              setLibrary(g.id);
              setHistoryOpen(true);
            }}
          >
            History and review
          </button>
        </article>
      ))}
      {groups?.length === 0 && (
        <p>No {includeArchived ? "" : "active "}step libraries yet.</p>
      )}
      {library && (
        <SharedStepHistoryReview
          key={`${projectId}:${library}`}
          projectId={projectId}
          groupId={library}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onSaved={() => void query.refetch()}
          onPendingChanged={setHistoryPending}
        />
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New shared step library"
      >
        <fieldset
          disabled={!!pending || !canEdit}
          style={{
            border: 0,
            padding: 0,
            minWidth: 0,
            display: "grid",
            gap: 10,
          }}
        >
          <label>
            Name (required)
            <input
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              maxLength={10000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {steps.map((s, i) => (
            <div key={i} className="panel" style={{ padding: 10 }}>
              <strong>Step {i + 1}</strong>
              {(
                [
                  "action",
                  "expectedActionOrData",
                  "expectedResult",
                  "expectedResponse",
                ] as const
              ).map((field) => (
                <label key={field} style={{ display: "block" }}>
                  {field === "action"
                    ? "Action (required)"
                    : field === "expectedActionOrData"
                      ? "Expected action / data"
                      : field === "expectedResult"
                        ? "Expected result"
                        : "Expected response"}
                  <textarea
                    value={s[field]}
                    maxLength={10000}
                    onChange={(e) =>
                      setSteps(
                        steps.map((step, j) =>
                          i === j ? { ...step, [field]: e.target.value } : step,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              <button
                disabled={steps.length === 1}
                onClick={() => setSteps(steps.filter((_, j) => j !== i))}
              >
                Remove step {i + 1}
              </button>
            </div>
          ))}
          <button
            disabled={steps.length >= 500}
            onClick={() =>
              setSteps([
                ...steps,
                {
                  action: "",
                  expectedActionOrData: "",
                  expectedResult: "",
                  expectedResponse: "",
                },
              ])
            }
          >
            Add step
          </button>
          <label>
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I reviewed the complete procedure. No AI credits are used.
          </label>
        </fieldset>
        {create.isError && (
          <p role="alert">
            {create.error.message} Retry the exact request to recover an
            unconfirmed save.
          </p>
        )}
        <div
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}
        >
          <button onClick={() => setOpen(false)}>Close</button>
          <button
            className="btn-primary"
            disabled={
              !canEdit ||
              create.isPending ||
              (!pending &&
                (!approved ||
                  !name.trim() ||
                  steps.some((s) => !s.action.trim())))
            }
            onClick={() => {
              const request = pending ?? {
                projectId,
                name,
                description: description || null,
                steps,
                requestId: crypto.randomUUID(),
              };
              setPending(request);
              pendingReceipt.current ??= { input: request, uncertain: false };
              create.mutate(request);
            }}
          >
            {create.isPending
              ? "Saving…"
              : pending
                ? "Retry exact creation"
                : "Create reviewed library"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
