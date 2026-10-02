"use client";

import { useMemo, useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { prerequisitePage } from "@/lib/case-inspector";
import styles from "./CaseInspector.module.css";

export function TestCasePrerequisites({
  projectId,
  caseId,
  canEdit,
}: {
  projectId: string;
  caseId: string;
  canEdit: boolean;
}) {
  const utils = trpcReact.useUtils();
  const structure = trpcReact.testCaseStructure.list.useQuery({ projectId });
  const save = trpcReact.testCaseStructure.setPrerequisites.useMutation();
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState<{
    caseId: string;
    ids: string[];
    baseline: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseline = useMemo(
    () =>
      structure.data?.prerequisites
        .filter((link) => link.dependentId === caseId)
        .map((link) => link.prerequisiteId) ?? [],
    [structure.data, caseId],
  );
  const cases = trpcReact.testCases.list.useQuery(
    { projectId },
    { enabled: editing || baseline.length > 0 },
  );
  const selected = draft?.caseId === caseId ? draft.ids : baseline;
  const baselineKey = [...baseline].sort().join("\u0000");
  const dirty = [...selected].sort().join("\u0000") !== baselineKey;
  const known = new Map(
    cases.data?.map((testCase) => [testCase.id, testCase.title]) ?? [],
  );
  const matches = prerequisitePage(
    cases.data ?? [],
    caseId,
    selected,
    search,
    page,
  );

  function select(ids: string[]) {
    setDraft({
      caseId,
      ids,
      baseline: draft?.caseId === caseId ? draft.baseline : baseline,
    });
  }

  async function saveChanges() {
    setError(null);
    try {
      await save.mutateAsync({
        projectId,
        dependentId: caseId,
        prerequisiteIds: selected,
        expectedPrerequisiteIds:
          draft?.caseId === caseId ? draft.baseline : baseline,
      });
      await utils.testCaseStructure.list.invalidate({ projectId });
      setDraft(null);
      setEditing(false);
      setSearch("");
      setPage(0);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save prerequisites.",
      );
    }
  }

  return (
    <section
      aria-label="Prerequisite test cases"
      className={styles.prerequisites}
    >
      <div className={styles.row}>
        <h3>
          Prerequisites{selected.length > 0 ? ` (${selected.length})` : ""}
        </h3>
        {canEdit && !editing && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setEditing(true)}
          >
            Edit prerequisites
          </button>
        )}
      </div>
      {structure.isLoading && (
        <p role="status" className={styles.muted}>
          Loading prerequisites…
        </p>
      )}
      {structure.error && (
        <p role="alert">
          Prerequisites could not be loaded: {structure.error.message}{" "}
          <button onClick={() => void structure.refetch()}>Retry</button>
        </p>
      )}
      {!structure.isLoading && !structure.error && selected.length === 0 && (
        <p className={styles.muted}>None set.</p>
      )}
      {selected.length > 0 && (
        <>
          <p className={styles.muted}>
            These cases must pass first in a manual run.
          </p>
          <ul className={styles.selection}>
            {selected.map((id) => (
              <li key={id}>
                <a href={`/projects/${projectId}/test-cases/${id}`}>
                  {known.get(id) ??
                    (cases.isLoading
                      ? "Loading case…"
                      : cases.error
                        ? `Case name could not be loaded (${id.slice(-8)})`
                        : `Unavailable case (${id.slice(-8)})`)}
                </a>
                {canEdit && editing && (
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`Remove ${known.get(id) ?? "prerequisite"}`}
                    onClick={() =>
                      select(selected.filter((value) => value !== id))
                    }
                    disabled={save.isPending}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {canEdit && (
        <div hidden={!editing}>
          <p className={styles.muted}>
            Choose cases that establish the required state. Changes apply only
            when saved.
          </p>
          <label htmlFor={`prerequisite-${caseId}`}>
            Find prerequisite cases
          </label>
          <input
            id={`prerequisite-${caseId}`}
            type="search"
            value={search}
            placeholder="Search title or case ID"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            disabled={save.isPending}
            style={{ display: "block", width: "100%", marginTop: 6 }}
          />
          {cases.isLoading && <p role="status">Loading cases…</p>}
          {cases.error && (
            <p role="alert">
              Cases could not be loaded.{" "}
              <button onClick={() => void cases.refetch()}>Retry</button>
            </p>
          )}
          {cases.data && (
            <>
              <ul
                className={styles.matches}
                aria-label="Available prerequisite cases"
              >
                {matches.items.map((item) => (
                  <li key={item.id}>
                    <span>
                      {item.title}
                      <small>Case {item.id.slice(-8)}</small>
                    </span>
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Add prerequisite ${item.title} (${item.id.slice(-8)})`}
                      disabled={save.isPending || selected.length >= 50}
                      onClick={() => select([...selected, item.id])}
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
              <div className={styles.row}>
                <span role="status" className={styles.muted}>
                  {matches.total
                    ? `Page ${matches.page + 1} of ${matches.pageCount} · ${matches.total} matches`
                    : "No matching available cases."}
                </span>
                {matches.pageCount > 1 && (
                  <div>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={matches.page === 0}
                      onClick={() => setPage(matches.page - 1)}
                    >
                      Previous
                    </button>{" "}
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={matches.page + 1 === matches.pageCount}
                      onClick={() => setPage(matches.page + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {selected.length >= 50 && (
            <p className={styles.muted}>Maximum 50 direct prerequisites.</p>
          )}
          <div className={styles.row} style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={save.isPending}
              onClick={() => {
                setDraft(null);
                setEditing(false);
                setError(null);
                setSearch("");
                setPage(0);
              }}
            >
              Cancel changes
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={
                !dirty ||
                save.isPending ||
                !structure.data ||
                Boolean(structure.error)
              }
              onClick={() => void saveChanges()}
            >
              {save.isPending ? "Saving…" : "Save prerequisites"}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--ember)" }}>
          {error} Your draft is retained.
        </p>
      )}
    </section>
  );
}
