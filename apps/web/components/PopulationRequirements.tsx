"use client";
import { useState } from "react";
import { trpcReact } from "../lib/trpcReact";

export function PopulationRequirements({ projectId }: { projectId: string }) {
  const documents = trpcReact.populationDocuments.list.useQuery({ projectId });
  const [sourceKey, setSourceKey] = useState("");
  return (
    <section className="population-wizard">
      <h1>Review requirement suggestions</h1>
      <p>
        Find explicit “must”, “shall” and “required to” statements in approved
        documents. This is a literal first pass, not a complete or AI-inferred
        specification. No AI credits are used.
      </p>
      {documents.error && (
        <p role="alert">Could not load documents: {documents.error.message}</p>
      )}
      {documents.isLoading && <p role="status">Loading approved documents…</p>}
      {documents.data?.length === 0 && (
        <p>Approve a document first to review its requirement statements.</p>
      )}
      <label>
        Approved document
        <select
          value={sourceKey}
          onChange={(event) => setSourceKey(event.target.value)}
        >
          <option value="">Choose a document</option>
          {documents.data?.map((doc) => (
            <option key={doc.sourceKey} value={doc.sourceKey}>
              {doc.title} · version {doc.version}
            </option>
          ))}
        </select>
      </label>
      {sourceKey && (
        <Suggestions
          key={sourceKey}
          projectId={projectId}
          sourceKey={sourceKey}
        />
      )}
    </section>
  );
}
function Suggestions({
  projectId,
  sourceKey,
}: {
  projectId: string;
  sourceKey: string;
}) {
  const query = trpcReact.populationRequirements.preview.useQuery(
    { projectId, sourceKey },
    { refetchOnWindowFocus: false },
  );
  const mutation = trpcReact.populationRequirements.approve.useMutation();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{
    projectId: string;
    sourceKey: string;
    version: number;
    candidateKey: string;
    title: string;
    approve: true;
  } | null>(null);
  const [message, setMessage] = useState("");
  async function save(key: string, title: string) {
    if (!query.data) return;
    const request = pending ?? {
      projectId,
      sourceKey,
      version: query.data.version,
      candidateKey: key,
      title,
      approve: true as const,
    };
    setPending(request);
    try {
      const result = await mutation.mutateAsync(request);
      setMessage(
        result.created
          ? "Requirement created with source citation."
          : "Existing requirement retained; no duplicate created.",
      );
      setPending(null);
      await query.refetch();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Save not confirmed. Retry safely.",
      );
    }
  }
  if (query.error)
    return (
      <p role="alert">Could not load suggestions: {query.error.message}</p>
    );
  if (!query.data) return <p role="status">Finding explicit statements…</p>;
  return (
    <div>
      {query.data.staleLinks.length>0 && <section className="card"><h2>Earlier requirements need source review</h2><p>These statements no longer appear in this document. Existing requirements are retained, not deleted or rewritten.</p>{query.data.staleLinks.map((link,index)=><p key={link.requirementId ?? index}>{link.title} · originally cited version {link.sourceVersion}</p>)}</section>}
      <p>
        {query.data.candidates.length} candidates · document version{" "}
        {query.data.version}. Similar wording can describe the same requirement;
        review before adding. Existing human edits are never overwritten.
      </p>
      {!query.data.candidates.length && (
        <p>
          No explicit statements found. Add requirements manually or enrich the
          source document; this does not mean the project has no requirements.
        </p>
      )}
      <fieldset disabled={pending !== null} className="population-fields">
        {query.data.candidates.map((row) => (
          <article
            key={row.key}
            className="card"
            style={{ marginTop: 12, padding: 16 }}
          >
            <p>
              {row.status} · {query.data!.title}, line {row.line}
            </p>
            <blockquote>{row.quote}</blockquote>
            {row.status === "new" || row.status === "existing" ? (
              <>
                <label>
                  Requirement title
                  <input
                    maxLength={500}
                    value={edits[row.key] ?? row.title}
                    onChange={(event) =>
                      setEdits({ ...edits, [row.key]: event.target.value })
                    }
                  />
                </label>
                <button
                  className="btn-primary"
                  disabled={!(edits[row.key] ?? row.title).trim()}
                  onClick={() =>
                    void save(row.key, edits[row.key] ?? row.title)
                  }
                >
                  Approve{" "}
                  {row.status === "existing" ? "existing match" : "requirement"}
                </button>
              </>
            ) : (
              <p>
                {row.status === "human-edited"
                  ? "Your edited requirement is preserved."
                  : row.status === "removed"
                    ? "Previously removed. It will not be recreated automatically."
                    : "Already linked. No write needed."}
              </p>
            )}
          </article>
        ))}
      </fieldset>
      <p role="status">{message}</p>
      {pending && !mutation.isPending && (
        <>
          <button
            className="btn-primary"
            onClick={() => void save(pending.candidateKey, pending.title)}
          >
            Retry exact approval
          </button>
          {mutation.error?.data?.code === "CONFLICT" && (
            <button
              className="btn-secondary"
              onClick={() => {
                setPending(null);
                void query.refetch();
                setMessage(
                  "Reloaded for review; your title edits are retained.",
                );
              }}
            >
              Review latest source
            </button>
          )}
        </>
      )}
    </div>
  );
}
