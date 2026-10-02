"use client";

import { useState } from "react";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import EvidenceLinkChip from "@/components/EvidenceLinkChip";
import { Modal } from "@/components/Modal";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";

type Target = RouterInputs["caseTraceability"]["save"]["target"];
const providers: Array<{ value: Target["provider"]; label: string }> = [
  { value: "requirement", label: "Project requirement" },
  { value: "defect", label: "Project defect" },
  { value: "jira", label: "Jira" },
  { value: "linear", label: "Linear" },
  { value: "asana", label: "Asana" },
  { value: "notion", label: "Notion" },
  { value: "wiki", label: "Wiki / documentation" },
];
const fieldStyle = { display: "grid", gap: 5 } as const;
const wrapStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
} as const;
const errorMessage = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : "Could not save the selected reference.";

function useReviewedWrite<T>(write: (input: T) => Promise<unknown>) {
  const [receipt, setReceipt] = useState<TraceabilityReceipt<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(input: T) {
    const attempt = receipt ?? {
      input: structuredClone(input),
      uncertain: false,
    };
    setReceipt(attempt);
    try {
      await write(attempt.input);
      setReceipt(null);
      setError(null);
      return true;
    } catch (cause) {
      setReceipt(retainedTraceabilityReceipt(attempt, cause));
      setError(errorMessage(cause));
      return false;
    }
  }
  return {
    submit,
    pending: receipt !== null,
    error,
    clearError: () => {
      if (!receipt) setError(null);
    },
  };
}

export function CaseTraceabilityPanel({
  projectId,
  caseId,
  canEdit,
}: {
  projectId: string;
  caseId: string;
  canEdit: boolean;
}) {
  const links = trpcReact.caseTraceability.forCase.useQuery({
    projectId,
    caseId,
  });
  const save = trpcReact.caseTraceability.save.useMutation();
  const remove = trpcReact.caseTraceability.remove.useMutation();
  const utils = trpcReact.useUtils();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Target["provider"]>("requirement");
  const [kind, setKind] = useState<Target["kind"]>("feature");
  const [nativeId, setNativeId] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [search, setSearch] = useState("");
  const [baseline, setBaseline] = useState(0);
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removeRequest, setRemoveRequest] = useState("");
  const reviewedSave = useReviewedWrite<
    RouterInputs["caseTraceability"]["save"]
  >((input) => save.mutateAsync(input));
  const reviewedRemove = useReviewedWrite<
    RouterInputs["caseTraceability"]["remove"]
  >((input) => remove.mutateAsync(input));
  const requirements = trpcReact.caseTraceability.localRequirements.useQuery(
    { projectId, search },
    { enabled: open && source === "requirement" },
  );
  const defects = trpcReact.caseTraceability.localDefects.useQuery(
    { projectId },
    { enabled: open && source === "defect" },
  );
  const local = source === "requirement" || source === "defect";
  const options = source === "requirement" ? requirements.data : defects.data;
  const target: Target = local
    ? {
        provider: source,
        nativeId,
        kind: source === "requirement" ? "requirement" : "defect",
      }
    : { provider: source, nativeId, kind, title, url };
  const active = links.data?.links.filter((link) => !link.removedAt) ?? [];
  const removed = links.data?.links.filter((link) => link.removedAt) ?? [];
  const busy = save.isPending || remove.isPending;
  const draftLocked = busy || reviewedSave.pending;

  function begin() {
    if (reviewedSave.pending) {
      setOpen(true);
      return;
    }
    if (!links.data) return;
    setSource("requirement");
    setKind("feature");
    setNativeId("");
    setTitle("");
    setUrl("");
    setSearch("");
    setBaseline(links.data.version);
    setRequestId(crypto.randomUUID());
    setError(null);
    reviewedSave.clearError();
    setOpen(true);
  }
  function changeDraft(action: () => void) {
    if (draftLocked) return;
    action();
    setRequestId(crypto.randomUUID());
    setError(null);
    reviewedSave.clearError();
  }
  async function refresh() {
    await Promise.all([
      utils.caseTraceability.forCase.invalidate({ projectId, caseId }),
      utils.caseTraceability.forTarget.invalidate(),
    ]);
  }
  async function confirm() {
    if (
      await reviewedSave.submit({
        projectId,
        caseId,
        version: baseline,
        requestId,
        target,
        approveLink: true,
      })
    ) {
      setOpen(false);
      await refresh();
    }
  }

  return (
    <section
      aria-label="Test coverage references"
      style={{ margin: "12px 0", minWidth: 0 }}
    >
      <div style={{ ...wrapStyle, justifyContent: "space-between" }}>
        <strong>Tests</strong>
        {canEdit && (
          <button
            type="button"
            className="btn-secondary"
            onClick={begin}
            disabled={!links.data || Boolean(links.error)}
          >
            Link reference
          </button>
        )}
      </div>
      <p className="text-muted" style={{ fontSize: 12 }}>
        What this case tests: features, requirements, defects and document
        sections. These links do not establish a passing execution.
      </p>
      {links.isLoading && <p role="status">Loading test links…</p>}
      {links.error && (
        <p role="alert">
          Test links could not be loaded.{" "}
          <button type="button" onClick={() => void links.refetch()}>
            Retry
          </button>
        </p>
      )}
      {links.data && (
        <div style={wrapStyle}>
          {!active.length && (
            <span className="text-muted">
              No coverage references linked yet.
            </span>
          )}
          {active.map((link) => (
            <div key={link.id} style={{ ...wrapStyle, maxWidth: "100%" }}>
              {link.provider === "requirement" || link.provider === "defect" ? (
                <EvidenceLinkChip
                  provider={link.provider}
                  label={link.title}
                  status="confirmed"
                  onReview={() => {
                    window.location.assign(
                      link.provider === "requirement"
                        ? `/projects/${projectId}/requirements#requirement-${encodeURIComponent(link.nativeId)}`
                        : `/projects/${projectId}/defect-map#defect-${encodeURIComponent(link.nativeId)}`,
                    );
                  }}
                />
              ) : (
                <EvidenceLinkChip
                  provider={link.provider}
                  label={link.title}
                  href={link.url}
                  status="confirmed"
                />
              )}
              {canEdit && (
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={`Remove test link ${link.title}`}
                  disabled={
                    busy ||
                    reviewedSave.pending ||
                    (reviewedRemove.pending && removeId !== link.id)
                  }
                  onClick={() => {
                    if (!reviewedRemove.pending) {
                      setRemoveRequest(crypto.randomUUID());
                      setBaseline(links.data!.version);
                      reviewedRemove.clearError();
                    }
                    setRemoveId(link.id);
                    setError(null);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {removed.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary>Removed references ({removed.length})</summary>
          <ul>
            {removed.map((link) => (
              <li key={link.id}>
                {link.title} · removed{" "}
                {new Date(link.removedAt!).toLocaleDateString()}. History is
                retained; use Link reference to restore deliberately.
              </li>
            ))}
          </ul>
        </details>
      )}
      <Modal
        open={open}
        title="Link what this case tests"
        onClose={() => setOpen(false)}
        dismissible={!busy}
      >
        <p>
          Save a confirmed coverage reference. This reads no provider content
          and uses no AI credits.
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          <label style={fieldStyle}>
            Reference source
            <select
              value={source}
              disabled={draftLocked}
              onChange={(event) =>
                changeDraft(() => {
                  setSource(event.target.value as Target["provider"]);
                  setNativeId("");
                })
              }
            >
              {providers.map((item) => (
                <option value={item.value} key={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {local ? (
            <>
              {source === "requirement" && (
                <label style={fieldStyle}>
                  Find requirement
                  <input
                    type="search"
                    value={search}
                    maxLength={100}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              )}
              {(source === "requirement"
                ? requirements.isLoading
                : defects.isLoading) && (
                <p role="status">Loading project references…</p>
              )}
              {((requirements.error && source === "requirement") ||
                (defects.error && source === "defect")) && (
                <p role="alert">
                  Project references could not be loaded.{" "}
                  <button
                    type="button"
                    onClick={() =>
                      void (source === "requirement"
                        ? requirements.refetch()
                        : defects.refetch())
                    }
                  >
                    Retry
                  </button>
                </p>
              )}
              <label style={fieldStyle}>
                {source === "requirement" ? "Requirement" : "Defect"}
                <select
                  value={nativeId}
                  disabled={draftLocked}
                  onChange={(event) =>
                    changeDraft(() => setNativeId(event.target.value))
                  }
                >
                  <option value="">Choose a project {source}</option>
                  {options?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              {options?.length === 0 && (
                <p className="text-muted">
                  No matching project references. Add or import one before
                  linking it.
                </p>
              )}
            </>
          ) : (
            <>
              <label style={fieldStyle}>
                Tests a
                <select
                  value={kind}
                  disabled={draftLocked}
                  onChange={(event) =>
                    changeDraft(() =>
                      setKind(event.target.value as Target["kind"]),
                    )
                  }
                >
                  <option value="feature">Feature</option>
                  <option value="task">Task</option>
                  <option value="requirement">Requirement</option>
                  <option value="document">Documentation section</option>
                  <option value="defect">Defect</option>
                </select>
              </label>
              <label style={fieldStyle}>
                Reference title
                <input
                  value={title}
                  maxLength={200}
                  disabled={draftLocked}
                  onChange={(event) =>
                    changeDraft(() => setTitle(event.target.value))
                  }
                />
              </label>
              <label style={fieldStyle}>
                Native issue / page ID
                <input
                  value={nativeId}
                  maxLength={1000}
                  disabled={draftLocked}
                  onChange={(event) =>
                    changeDraft(() => setNativeId(event.target.value))
                  }
                />
                <small className="text-muted">
                  Use the provider&apos;s stable ID, not just its title.
                </small>
              </label>
              <label style={fieldStyle}>
                HTTPS reference link
                <input
                  type="url"
                  value={url}
                  maxLength={1500}
                  disabled={draftLocked}
                  onChange={(event) =>
                    changeDraft(() => setUrl(event.target.value))
                  }
                />
                <small className="text-muted">
                  A page-section anchor is supported. Do not include access
                  tokens or query parameters.
                </small>
              </label>
            </>
          )}
          {(error || reviewedSave.error) && (
            <p role="alert">
              {error || reviewedSave.error} Your draft is retained.{" "}
              {reviewedSave.pending ? (
                "The outcome is unknown. Retry the exact saved request; editing is paused."
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const current = await links.refetch();
                    if (current.data) {
                      setBaseline(current.data.version);
                      setRequestId(crypto.randomUUID());
                      setError(null);
                      reviewedSave.clearError();
                    }
                  }}
                >
                  Refresh review baseline
                </button>
              )}
            </p>
          )}
          <div style={{ ...wrapStyle, justifyContent: "space-between" }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {reviewedSave.pending ? "Close; keep pending request" : "Cancel"}
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !nativeId.trim() ||
                (!local && (!title.trim() || !url.trim()))
              }
              onClick={() => void confirm()}
            >
              {busy
                ? "Saving…"
                : reviewedSave.pending
                  ? "Retry exact saved request"
                  : "Confirm test link"}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={removeId !== null}
        title="Remove test coverage link?"
        onClose={() => {
          if (!reviewedRemove.pending) setRemoveId(null);
        }}
        dismissible={!busy && !reviewedRemove.pending}
      >
        <p>
          This removes the active coverage link, not the test case or source
          record. The previous link and author history remain retained.
        </p>
        {reviewedRemove.error && (
          <p role="alert">
            {reviewedRemove.error}{" "}
            {reviewedRemove.pending &&
              "Outcome unknown; the exact removal request is retained for retry."}
          </p>
        )}
        <div style={wrapStyle}>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || reviewedRemove.pending}
            onClick={() => setRemoveId(null)}
          >
            Keep link
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!removeId) return;
              if (
                await reviewedRemove.submit({
                  projectId,
                  caseId,
                  version: baseline,
                  requestId: removeRequest,
                  linkId: removeId,
                  approveRemove: true,
                })
              ) {
                setRemoveId(null);
                await refresh();
              }
            }}
          >
            {reviewedRemove.pending
              ? "Retry exact removal request"
              : "Remove link"}
          </button>
        </div>
      </Modal>
    </section>
  );
}

// Reciprocal panel for local requirements/defects or selected external records.
export function CoveredTestCasesPanel({
  projectId,
  target,
  canEdit = false,
}: {
  projectId: string;
  target: Target & { providerOrigin: string };
  canEdit?: boolean;
}) {
  const [afterId, setAfterId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [caseId, setCaseId] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = trpcReact.caseTraceability.forTarget.useQuery({
    projectId,
    provider: target.provider,
    providerOrigin: target.providerOrigin,
    nativeId: target.nativeId,
    afterId,
  });
  const available = trpcReact.caseTraceability.availableCases.useQuery(
    { projectId, search },
    { enabled: adding },
  );
  const save = trpcReact.caseTraceability.save.useMutation();
  const reviewedSave = useReviewedWrite<
    RouterInputs["caseTraceability"]["save"]
  >((input) => save.mutateAsync(input));
  const [requestId, setRequestId] = useState("");
  const [baseline, setBaseline] = useState(0);
  const utils = trpcReact.useUtils();
  return (
    <section
      aria-label="Test cases covering this record"
      style={{ marginTop: 12, minWidth: 0 }}
    >
      <div style={wrapStyle}>
        <strong>
          Linked test cases{list.data ? ` (${list.data.total})` : ""}
        </strong>
        {canEdit && (
          <button
            type="button"
            className="btn-secondary"
            disabled={!list.data}
            onClick={() => {
              setAdding(true);
              if (!reviewedSave.pending) {
                setBaseline(list.data!.version);
                setRequestId(crypto.randomUUID());
                setError(null);
                reviewedSave.clearError();
              }
            }}
          >
            Link test case
          </button>
        )}
      </div>
      <p className="text-muted" style={{ fontSize: 12 }}>
        Coverage references, not proof of a passing run or resolved defect.
      </p>
      {list.isLoading && <p role="status">Loading coverage…</p>}
      {list.error && (
        <p role="alert">
          Coverage could not be loaded.{" "}
          <button type="button" onClick={() => void list.refetch()}>
            Retry
          </button>
        </p>
      )}
      <div style={wrapStyle}>
        {list.data?.cases.map((link) => (
          <a
            key={link.id}
            href={`/projects/${projectId}/test-cases/${link.caseId}`}
            style={{
              border: "1px solid var(--line)",
              borderRadius: 999,
              padding: "5px 9px",
              overflowWrap: "anywhere",
            }}
          >
            {link.testCase.title}
            {link.testCase.archived ? " · archived" : ""}
          </a>
        ))}
      </div>
      {list.data?.total === 0 && (
        <span className="text-muted">No test cases linked.</span>
      )}
      {afterId && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setAfterId(undefined)}
        >
          First page
        </button>
      )}
      {list.data?.nextId && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setAfterId(list.data!.nextId!)}
        >
          Next cases
        </button>
      )}
      <Modal
        open={adding}
        title="Link a covering test case"
        onClose={() => setAdding(false)}
        dismissible={!save.isPending}
      >
        <p>
          Confirm the case that tests this record. No execution result, provider
          write or AI charge is implied.
        </p>
        <label style={fieldStyle}>
          Find test case
          <input
            type="search"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {available.error && (
          <p role="alert">
            Cases could not be loaded.{" "}
            <button type="button" onClick={() => void available.refetch()}>
              Retry
            </button>
          </p>
        )}
        <label style={{ ...fieldStyle, marginTop: 12 }}>
          Test case
          <select
            value={caseId}
            disabled={save.isPending || reviewedSave.pending}
            onChange={(event) => {
              setCaseId(event.target.value);
              setRequestId(crypto.randomUUID());
            }}
          >
            <option value="">Choose a project case</option>
            {available.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        {(error || reviewedSave.error) && (
          <p role="alert">
            {error || reviewedSave.error} Selection retained.{" "}
            {reviewedSave.pending ? (
              "Outcome unknown. Retry the exact saved request; changing the selection is paused."
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const fresh = await list.refetch();
                  if (fresh.data) {
                    setBaseline(fresh.data.version);
                    setRequestId(crypto.randomUUID());
                    setError(null);
                    reviewedSave.clearError();
                  }
                }}
              >
                Refresh review baseline
              </button>
            )}
          </p>
        )}
        <div style={{ ...wrapStyle, marginTop: 12 }}>
          <button
            type="button"
            className="btn-secondary"
            disabled={save.isPending}
            onClick={() => setAdding(false)}
          >
            {reviewedSave.pending ? "Close; keep pending request" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={!caseId || save.isPending}
            onClick={async () => {
              const { providerOrigin: _origin, ...selected } = target;
              if (
                await reviewedSave.submit({
                  projectId,
                  caseId,
                  version: baseline,
                  requestId,
                  target: selected,
                  approveLink: true,
                })
              ) {
                setAdding(false);
                setCaseId("");
                await Promise.all([
                  utils.caseTraceability.forTarget.invalidate(),
                  utils.caseTraceability.forCase.invalidate(),
                ]);
              }
            }}
          >
            {save.isPending
              ? "Saving…"
              : reviewedSave.pending
                ? "Retry exact saved request"
                : "Confirm test link"}
          </button>
        </div>
      </Modal>
    </section>
  );
}
