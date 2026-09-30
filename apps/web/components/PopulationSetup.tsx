"use client";

import { useState } from "react";
import type { PopulationDraft } from "@vaettir/core";
import { trpcReact } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import {
  PopulationWizard,
  emptyPopulationDraft,
} from "@/components/PopulationWizard";

export function PopulationSetup({ projectId, onExit, onScreen }: { projectId: string; onExit: () => void; onScreen: (screen: "documents" | "requirements" | "assessment" | "gitlab" | "github") => void }) {
  const permissions = useProjectPermissions(projectId);
  const query = trpcReact.projectPopulation.draft.useQuery(
    { projectId },
    { refetchOnWindowFocus: false },
  );
  if (query.error)
    return <p role="alert">Could not load setup: {query.error.message}</p>;
  if (!query.isSuccess || !permissions.loaded)
    return <p role="status">Loading saved setup…</p>;
  if (!permissions.canEdit)
    return (
      <p>
        A full editor seat is required to update project understanding. Your
        existing project remains available.
      </p>
    );
  return (
    <Editor
      key={projectId}
      projectId={projectId}
      initial={query.data?.document ?? emptyPopulationDraft}
      initialVersion={query.data?.version ?? 0}
      onExit={onExit}
      onScreen={onScreen}
    />
  );
}

function Editor({
  projectId,
  initial,
  initialVersion,
  onExit,
  onScreen,
}: {
  projectId: string;
  initial: PopulationDraft;
  initialVersion: number;
  onExit: () => void;
  onScreen: (screen: "documents" | "requirements" | "assessment" | "gitlab" | "github") => void;
}) {
  const utils = trpcReact.useUtils();
  const mutation = trpcReact.projectPopulation.saveDraft.useMutation();
  const [version, setVersion] = useState(initialVersion);
  const [status, setStatus] = useState(
    initialVersion
      ? `Resumed saved draft ${initialVersion}.`
      : "No saved setup draft yet.",
  );
  const [pending, setPending] = useState<{
    projectId: string;
    requestId: string;
    expectedVersion: number;
    document: PopulationDraft;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<{
    version: number;
    document: PopulationDraft;
  } | null>(null);
  const [display, setDisplay] = useState({ initial, key: 0 });

  async function save(document: PopulationDraft) {
    const request = pending ?? {
      projectId,
      requestId: crypto.randomUUID(),
      expectedVersion: version,
      document,
    };
    setPending(request);
    setBusy(true);
    setStatus("Saving your setup…");
    try {
      const ack = await mutation.mutateAsync(request);
      const current = await utils.projectPopulation.draft.fetch({ projectId });
      if (!current)
        throw new Error(
          "Saved draft could not be read back. Retry to confirm it.",
        );
      if (current.version !== ack.version) {
        setLatest(current);
        setStatus(
          "Your save was acknowledged, but a newer draft exists. Compare before continuing.",
        );
      } else {
        setVersion(current.version);
        setPending(null);
        setLatest(null);
        setStatus(
          `Saved draft ${current.version}. You can leave and resume here later.`,
        );
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Save could not be confirmed. Retry safely.",
      );
      // Retain the exact request until success or explicit conflict reconciliation.
      try {
        const current = await utils.projectPopulation.draft.fetch({
          projectId,
        });
        if (
          current &&
          current.version > request.expectedVersion &&
          JSON.stringify(current.document) !== JSON.stringify(request.document)
        )
          setLatest(current);
      } catch {
        /* Keep local input and original retry identity. */
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <PopulationWizard
        onDocuments={() => onScreen("documents")}
        onGitlab={() => onScreen("gitlab")}
        onGithub={() => onScreen("github")}
        key={display.key}
        initial={display.initial}
        locked={busy || pending !== null}
        status={status}
        onSave={(document) => void save(document)}
        onExit={onExit}
      />
      {pending && !busy && !latest && (
        <button
          className="btn-primary"
          onClick={() => void save(pending.document)}
        >
          Retry and confirm save
        </button>
      )}
      {latest && (
        <section className="card" aria-label="Compare setup drafts">
          <h2>A newer setup needs review</h2>
          <p>Your input is retained below. Nothing was silently replaced.</p>
          <details open>
            <summary>Your draft</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(pending?.document, null, 2)}
            </pre>
          </details>
          <details>
            <summary>Latest saved draft {latest.version}</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(latest.document, null, 2)}
            </pre>
          </details>
          <button
            className="btn-secondary"
            onClick={() => {
              setVersion(latest.version);
              setDisplay({ initial: latest.document, key: display.key + 1 });
              setLatest(null);
              setPending(null);
              setStatus("Loaded the latest saved draft after your review.");
            }}
          >
            Use latest saved draft
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setVersion(latest.version);
              setLatest(null);
              setPending(null);
              setStatus(
                "Your draft is retained. Review it before saving over the latest draft.",
              );
            }}
          >
            Keep my draft for review
          </button>
        </section>
      )}
      <details><summary>Continue with evidence and suggestions</summary>
        <p>Add a specification, review suggested requirements, then check what still needs evidence.</p>
        <button type="button" className="btn-secondary" onClick={() => onScreen("documents")}>Add document evidence</button>{" "}
        <button type="button" className="btn-secondary" onClick={() => onScreen("requirements")}>Review requirement suggestions</button>{" "}
        <button type="button" className="btn-secondary" onClick={() => onScreen("assessment")}>Check evidence gaps</button>
      </details>
    </div>
  );
}
