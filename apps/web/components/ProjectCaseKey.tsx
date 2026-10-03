"use client";

import { useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { Modal } from "@/components/Modal";

export function ProjectCaseKey({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const identity = trpcReact.project.caseIdentity.useQuery({ projectId });
  const utils = trpcReact.useUtils();
  const save = trpcReact.project.saveCaseKey.useMutation();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [expectedKey, setExpectedKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = identity.data;

  async function submit() {
    setError(null);
    try {
      await save.mutateAsync({
        projectId,
        caseKey: key.trim(),
        expectedCaseKey: expectedKey,
      });
      await utils.project.caseIdentity.invalidate({ projectId });
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the project key.",
      );
    }
  }

  return (
    <>
      {identity.error && (
        <p role="alert">
          Could not load case identifiers. {identity.error.message}
        </p>
      )}
      {current && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            margin: "12px 0",
          }}
        >
          <span>
            Case key: <code>{current.caseKey}</code>
          </span>
          <span className="text-muted">Example: {current.caseKey}-01</span>
          {canEdit && !current.keyLocked && (
            <button
              type="button"
              className="btn-secondary"
              aria-haspopup="dialog"
              onClick={() => {
                setKey(current.caseKey);
                setExpectedKey(current.caseKey);
                setError(null);
                setOpen(true);
              }}
            >
              Change case key
            </button>
          )}
          {current.keyLocked && (
            <span className="text-muted">
              Fixed to keep issued case IDs stable.
            </span>
          )}
        </div>
      )}
      <Modal
        open={open}
        onClose={() => {
          if (!save.isPending) setOpen(false);
        }}
        title="Choose a project case key"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          style={{ display: "grid", gap: 12 }}
        >
          <label>
            Project key
            <input
              autoFocus
              value={key}
              onChange={(event) => setKey(event.target.value)}
              maxLength={24}
              pattern="[A-Za-z][A-Za-z0-9-]{0,23}"
              required
              disabled={save.isPending}
              aria-describedby="project-case-key-help"
            />
          </label>
          <p id="project-case-key-help" className="text-muted">
            Use 1–24 letters, numbers or hyphens, starting with a letter. The
            key is fixed after the first case is created. Each case keeps its ID
            when renamed or moved between suites.
          </p>
          <p aria-live="polite">
            Case preview:{" "}
            <code>{key.trim().toLowerCase() || "project"}-01</code>
          </p>
          {error && <p role="alert">{error}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={save.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={save.isPending}
            >
              {save.isPending ? "Saving…" : "Save key"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
