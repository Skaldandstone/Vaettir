"use client";
import { useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { trpcReact } from "../lib/trpcReact";

export function PopulationDocuments({ projectId }: { projectId: string }) {
  const list = trpcReact.populationDocuments.list.useQuery({ projectId });
  const pendingRuns = trpcReact.populationDocuments.pending.useQuery({
    projectId,
  });
  const cancel = trpcReact.populationDocuments.cancel.useMutation();
  const preview = trpcReact.populationDocuments.preview.useMutation();
  const approve = trpcReact.populationDocuments.approve.useMutation();
  const [sourceKey, setSourceKey] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [permission, setPermission] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const busy = preview.isPending || approve.isPending;
  async function review() {
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    setMessage("");
    try {
      await preview.mutateAsync({
        projectId,
        requestId: id,
        sourceKey,
        title,
        content,
        processingPermission: true,
      });
      void pendingRuns.refetch();
    } catch (error) {
      if (
        error instanceof TRPCClientError &&
        ["BAD_REQUEST", "FORBIDDEN", "CONFLICT"].includes(error.data?.code)
      )
        setRequestId(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Preview failed. Retry with the same input.",
      );
    }
  }
  async function commit() {
    if (!preview.data) return;
    try {
      const result = await approve.mutateAsync({
        projectId,
        requestId: preview.data.requestId,
        approve: true,
      });
      setMessage(
        `Evidence approved at version ${result.version}. Existing tests and requirements were not changed.`,
      );
      setEditing(false);
      preview.reset();
      setRequestId(null);
      void list.refetch();
      void pendingRuns.refetch();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Approval not confirmed. Retry safely.",
      );
    }
  }
  return (
    <section className="population-wizard" style={{ marginTop: 32 }}>
      <h2>Project documents</h2>
      <p>
        Build an approved evidence baseline from a README, specification or
        release note. No AI credits are used.
      </p>
      {list.error && (
        <p role="alert">Could not load evidence: {list.error.message}</p>
      )}
      {list.data?.map((doc) => (
        <p key={doc.sourceKey}>
          {doc.title} · {doc.sourceKey} · version {doc.version}
        </p>
      ))}
      {!editing && pendingRuns.data && pendingRuns.data.length > 0 && (
        <details>
          <summary>
            Resume pending reviews ({pendingRuns.data.length} most recent)
          </summary>
          {pendingRuns.data.map((run) => (
            <p key={run.requestId}>
              {run.title}{" "}
              <button
                className="btn-secondary"
                onClick={() => {
                  setEditing(true);
                  setSourceKey(run.sourceKey);
                  setTitle(run.title);
                  setContent(run.content);
                  setPermission(true);
                  setRequestId(run.requestId);
                  setMessage(
                    "Review restored. Retry preview to compare with current evidence.",
                  );
                }}
              >
                Resume review
              </button>{" "}
              <button
                className="btn-secondary"
                disabled={cancel.isPending}
                onClick={() =>
                  void cancel
                    .mutateAsync({ projectId, requestId: run.requestId })
                    .then(() => pendingRuns.refetch())
                    .catch(() =>
                      setMessage("Cancellation not confirmed. Retry safely."),
                    )
                }
              >
                Cancel review
              </button>
            </p>
          ))}
        </details>
      )}
      {!editing ? (
        <button
          className="btn-secondary"
          onClick={() => {
            setEditing(true);
            setSourceKey("");
            setTitle("");
            setContent("");
            setPermission(false);
            setMessage("");
          }}
        >
          Add or update a document
        </button>
      ) : !preview.data ? (
        <div>
          <fieldset
            disabled={busy || requestId !== null}
            className="population-fields"
          >
            <label>
              Stable document key
              <input
                value={sourceKey}
                maxLength={100}
                placeholder="For example: mobile/readme"
                onChange={(e) => setSourceKey(e.target.value)}
              />
            </label>
            <p className="text-muted">
              Reuse this key when updating the same document. Other documents
              are never removed.
            </p>
            <label>
              Title
              <input
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Plain text or Markdown
              <textarea
                rows={8}
                value={content}
                maxLength={50000}
                onChange={(e) => setContent(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={permission}
                onChange={(e) => setPermission(e.target.checked)}
              />
              I have permission to store this document in this project. I have
              removed secrets and regulated personal data.
            </label>
          </fieldset>
          <p>
            Preview stores this text for review in Vaettir. It does not execute
            it, follow links, or send it to an AI provider.
          </p>
          <button
            className="btn-primary"
            disabled={
              busy ||
              !permission ||
              !sourceKey.trim() ||
              !title.trim() ||
              !content
            }
            onClick={() => void review()}
          >
            {requestId ? "Retry preview" : "Preview changes"}
          </button>
          {!requestId && (
            <button className="btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div>
          <h3>
            {preview.data.status === "conflict"
              ? "Source changed since this preview"
              : `${preview.data.status}: ${preview.data.title}`}
          </h3>
          <p>
            Documented intent only. This does not establish implemented or
            released behavior.
          </p>
          <details>
            <summary>Previously approved text</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {preview.data.previous?.content ?? "No previous evidence"}
            </pre>
          </details>
          <details open>
            <summary>Proposed text</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {preview.data.content}
            </pre>
          </details>
          <button
            className="btn-primary"
            disabled={busy || preview.data.status === "conflict"}
            onClick={() => void commit()}
          >
            Approve document evidence · 0 credits
          </button>
          <button
            className="btn-secondary"
            disabled={
              busy ||
              (approve.isError && approve.error.data?.code !== "CONFLICT")
            }
            onClick={() => {
              preview.reset();
              approve.reset();
              setRequestId(null);
            }}
          >
            Edit and preview again
          </button>
        </div>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
