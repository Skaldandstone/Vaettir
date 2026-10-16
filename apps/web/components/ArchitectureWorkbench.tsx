"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@vaettir/api/src/router";
import { trpcReact } from "@/lib/trpcReact";
import {
  CaseCustomFieldsForm,
  type CaseFieldFormDraft,
} from "./CaseCustomFields";

type Preview = inferRouterOutputs<AppRouter>["architecture"]["preview"];
const panel = {
  border: "1px solid var(--line)",
  borderRadius: 12,
  padding: 20,
  minWidth: 0,
};
const row = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: 12,
  alignItems: "center",
};

/** Architecture is a Vaettir project capability, independent of Atlassian. */
export function ArchitectureWorkbench({
  projectId,
  actorClerkUserId,
}: {
  projectId: string;
  actorClerkUserId: string;
}) {
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    { staleTime: 0 },
  );
  const documents = trpcReact.architecture.documents.useQuery(
    { projectId, organizationId: project.data?.organizationId ?? "pending" },
    { enabled: !!project.data && !project.error, staleTime: 0 },
  );
  const [source, setSource] = useState<{
    fileName: string;
    content: string;
  } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(0),
    [view, setView] = useState<"ELEMENTS" | "MAPPINGS" | "DRAFTS">("ELEMENTS");
  const stop = useRef(false),
    mountedGeneration = useRef(0);
  useEffect(
    () => () => {
      stop.current = true;
      mountedGeneration.current++;
    },
    [],
  );
  const previewMutation = trpcReact.architecture.preview.useMutation();
  const openDocument = trpcReact.architecture.openDocument.useMutation();
  const saveDocument = trpcReact.architecture.saveDocument.useMutation();
  const analyze = trpcReact.architecture.analyzeBatch.useMutation();
  const decision = trpcReact.architecture.decide.useMutation();
  const current =
    preview &&
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    project.data?.organizationId === preview.organizationId &&
    preview.actorClerkUserId === actorClerkUserId
      ? preview
      : null;
  const input =
    source && project.data
      ? { projectId, organizationId: project.data.organizationId, ...source }
      : null;
  async function read(file: File | undefined) {
    const generation = ++mountedGeneration.current;
    setSource(null);
    setPreview(null);
    setApproved(false);
    setMessage("");
    if (!file) return;
    try {
      if (file.size > 1_000_000)
        throw new Error(
          "This diagram exceeds the current 1 MB analysis capacity. No content was truncated.",
        );
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (generation !== mountedGeneration.current) return;
      setSource({ fileName: file.name, content });
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "The document could not be read.",
      );
    }
  }
  async function inspect() {
    if (!input) return;
    setBusy(true);
    setMessage("");
    setApproved(false);
    try {
      const next = await previewMutation.mutateAsync(input);
      setPreview(next);
      setCompleted(next.results.length);
    } catch (e) {
      setPreview(null);
      setMessage(
        e instanceof Error ? e.message : "Could not inspect architecture.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openSaved(hash: string) {
    if (!project.data || !hash) return;
    mountedGeneration.current++;
    setBusy(true);
    setPreview(null);
    setApproved(false);
    setSource(null);
    setMessage("");
    try {
      const d = await openDocument.mutateAsync({
        projectId,
        organizationId: project.data.organizationId,
        hash,
      });
      setSource({ fileName: d.fileName, content: d.content });
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not open the saved diagram.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveSource() {
    if (!input) return;
    setBusy(true);
    setMessage("");
    try {
      await saveDocument.mutateAsync(input);
      await documents.refetch();
      setMessage(
        "Architecture version saved in Vaettir. No AI processing or Atlassian sharing was started.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not save architecture.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    if (!input || !current || !approved) return;
    const generation = mountedGeneration.current;
    stop.current = false;
    setBusy(true);
    setMessage("");
    try {
      const finished = new Set(current.results.map((r) => r.batchIndex));
      for (let i = 0; i < current.batchCount && !stop.current; i++) {
        if (finished.has(i)) continue;
        await analyze.mutateAsync({
          ...input,
          expectedScopeHash: current.scopeHash,
          batchIndex: i,
          approvedMaximumCredits: current.maximumCredits,
          approveAiProcessing: true,
        });
        if (generation !== mountedGeneration.current) return;
        const next = await previewMutation.mutateAsync(input);
        if (next.scopeHash !== current.scopeHash)
          throw new Error(
            "Cases changed during analysis. Review the new scope before continuing.",
          );
        setPreview(next);
        setCompleted(next.results.length);
      }
      setMessage(
        stop.current
          ? "Stopped between batches. Completed results are retained; inspect this same file to resume."
          : "Analysis ready for review. No tests were created or rewritten.",
      );
      setView("MAPPINGS");
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Analysis stopped. Inspect before continuing; unconfirmed work is never automatically charged again.",
      );
    } finally {
      setBusy(false);
      setApproved(false);
    }
  }
  async function decide(
    caseId: string,
    elementId: string,
    value: "CONFIRMED" | "REJECTED",
  ) {
    if (!input || !current) return;
    setMessage("");
    try {
      await decision.mutateAsync({
        ...input,
        expectedScopeHash: current.scopeHash,
        caseId,
        elementId,
        decision: value,
        requestId: crypto.randomUUID(),
      });
      setPreview(await previewMutation.mutateAsync(input));
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "The mapping could not be saved.",
      );
    }
  }
  const mappings = current?.results.flatMap((r) => r.result.mappings) ?? [];
  const drafts =
    current?.results.flatMap((r) =>
      r.result.suggestions.map((draft, draftIndex) => ({
        draft,
        draftIndex,
        batchIndex: r.batchIndex,
      })),
    ) ?? [];
  const reviewedLinks = [
    ...new Map(
      current?.decisions.map((d) => [`${d.caseId}:${d.elementId}`, d]),
    ).values(),
  ];
  const decisionByLink = new Map(
    reviewedLinks.map((d) => [JSON.stringify([d.caseId, d.elementId]), d]),
  );
  const confirmedByElement = new Map<string, number>();
  for (const d of reviewedLinks)
    if (d.decision === "CONFIRMED")
      confirmedByElement.set(
        d.elementId,
        (confirmedByElement.get(d.elementId) ?? 0) + 1,
      );
  return (
    <main
      style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gap: 24 }}
    >
      <header>
        <h1>Architecture &amp; test mapping</h1>
        <p>
          Read a PlantUML or SVG diagram, relate existing tests to its
          components and interactions, and draft tests for gaps.
        </p>
      </header>
      <section style={panel} aria-labelledby="architecture-source">
        <h2 id="architecture-source">Architecture source</h2>
        <div style={row}>
          <label>
            Diagram{" "}
            <input
              type="file"
              accept=".puml,.plantuml,.pu,.svg"
              disabled={busy}
              onChange={(e) => void read(e.target.files?.[0])}
            />
          </label>
          {!!documents.data?.length && !project.error && (
            <label>
              Saved architecture{" "}
              <select
                disabled={busy}
                value=""
                onChange={(e) => void openSaved(e.target.value)}
              >
                <option value="">Choose a retained version</option>
                {documents.data.map((d) => (
                  <option key={d.hash} value={d.hash}>
                    {d.fileName} · {new Date(d.savedAt).toLocaleDateString()} ·{" "}
                    {d.hash.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={!input || busy || project.isFetching}
            onClick={() => void inspect()}
          >
            Inspect diagram
          </button>
        </div>
        {source && <p>Selected: {source.fileName}</p>}
        <p>
          Inspection does not use AI or credits. Uploaded SVG is read as data,
          never rendered or executed. Include directives and external resources
          are not followed.
        </p>
        {project.error && <p role="alert">{project.error.message}</p>}
      </section>
      {message && <p role="status">{message}</p>}
      {current && (
        <>
          <section style={panel} aria-labelledby="architecture-scope">
            <h2 id="architecture-scope">Review analysis scope</h2>
            <div style={row}>
              <span>{current.document.fileName}</span>
              <span>
                {current.document.elements.length} architecture elements
              </span>
              <span>{current.cases.length} existing tests</span>
            </div>
            {current.canSpend && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveSource()}
              >
                Save architecture version
              </button>
            )}
            {current.document.warnings.map((w, i) => (
              <p key={i} role="note">
                {w}
              </p>
            ))}
            {current.unprocessed.map((item) => (
              <p key={item.caseId}>
                For review:{" "}
                {current.cases.find((c) => c.id === item.caseId)?.displayId}.{" "}
                {item.reason}
              </p>
            ))}
            <p>
              AI reads the extracted diagram and complete case definitions,
              including shared procedures. Proposed links are traceability, not
              measured code coverage or execution proof.
            </p>
            <p>
              Up to {current.maximumCredits} purchased AI credits across{" "}
              {current.batchCount} batches. Completed batches are reused.
              Available balance: {current.balance}.
            </p>
            <label style={row}>
              <input
                type="checkbox"
                checked={approved}
                disabled={busy || !current.canSpend}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I approve sending this diagram’s extracted text and case
              definitions to the AI provider, up to {current.maximumCredits}{" "}
              credits for this scope.
            </label>
            <div style={{ ...row, marginTop: 16 }}>
              <button
                type="button"
                disabled={
                  busy ||
                  !approved ||
                  !current.canSpend ||
                  current.results.length === current.batchCount ||
                  current.balance < 12
                }
                onClick={() => void run()}
              >
                {current.results.length
                  ? "Continue analysis"
                  : "Analyze architecture"}
              </button>
              {busy && (
                <button
                  type="button"
                  onClick={() => {
                    stop.current = true;
                  }}
                >
                  Stop after current batch
                </button>
              )}
              <span role="status">
                {completed} / {current.batchCount} batches completed
                {busy ? " · Analyzing…" : ""}
              </span>
            </div>
            <progress
              aria-label="Architecture analysis progress"
              max={current.batchCount}
              value={completed}
              style={{ width: "100%", marginTop: 12 }}
            />
          </section>
          <nav aria-label="Architecture review" style={row}>
            {(
              [
                ["ELEMENTS", "Architecture"],
                ["MAPPINGS", "Existing-test mappings"],
                ["DRAFTS", "Suggested tests"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={view === id}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {view === "ELEMENTS" && (
            <section style={panel}>
              <h2>Components &amp; interactions</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Element</th>
                      <th>Kind</th>
                      <th>Source evidence</th>
                      <th>Reviewed links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.document.elements.map((element) => (
                      <tr key={element.id}>
                        <td>{element.label}</td>
                        <td>{element.kind.toLowerCase()}</td>
                        <td>
                          <code
                            style={{
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {element.quote}
                          </code>
                          {element.line > 0 && (
                            <small> Line {element.line}</small>
                          )}
                        </td>
                        <td>{confirmedByElement.get(element.id) ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {view === "MAPPINGS" && (
            <section style={{ display: "grid", gap: 16 }}>
              <h2>Existing-test mappings</h2>
              {!!reviewedLinks.length && (
                <article style={panel}>
                  <h3>Retained review decisions</h3>
                  <p>
                    These links apply to this exact diagram and unchanged test
                    definitions. Editing one case requires review of its links,
                    not the rest of the project’s links.
                  </p>
                  {reviewedLinks.map((d) => (
                    <div
                      key={`${d.caseId}:${d.elementId}`}
                      style={{ ...row, paddingBlock: 8 }}
                    >
                      <span>
                        {
                          current.cases.find((c) => c.id === d.caseId)
                            ?.displayId
                        }{" "}
                        ·{" "}
                        {
                          current.document.elements.find(
                            (e) => e.id === d.elementId,
                          )?.label
                        }{" "}
                        ·{" "}
                        {d.decision === "CONFIRMED" ? "Confirmed" : "Rejected"}
                      </span>
                      {current.canSpend && (
                        <button
                          type="button"
                          disabled={busy || decision.isPending}
                          onClick={() =>
                            void decide(
                              d.caseId,
                              d.elementId,
                              d.decision === "CONFIRMED"
                                ? "REJECTED"
                                : "CONFIRMED",
                            )
                          }
                        >
                          {d.decision === "CONFIRMED"
                            ? "Reject link"
                            : "Confirm link"}
                        </button>
                      )}
                    </div>
                  ))}
                </article>
              )}
              {!mappings.length && (
                <p>
                  No current AI mapping proposals. Run the reviewed analysis
                  above.
                </p>
              )}
              {mappings.map((mapping) => {
                const c = current.cases.find(
                  (item) => item.id === mapping.caseId,
                );
                return (
                  <article key={mapping.caseId} style={panel}>
                    <h3>
                      {c?.displayId} · {c?.title}
                    </h3>
                    <Link
                      href={`/projects/${projectId}/test-cases/${encodeURIComponent(mapping.caseId)}`}
                    >
                      Open test case
                    </Link>
                    {!mapping.matches.length && (
                      <p>Unmapped · For review. {mapping.unmappedReason}</p>
                    )}
                    {mapping.matches.map((match) => {
                      const element = current.document.elements.find(
                          (item) => item.id === match.elementId,
                        ),
                        latest = decisionByLink.get(
                          JSON.stringify([mapping.caseId, match.elementId]),
                        );
                      return (
                        <div
                          key={match.elementId}
                          style={{
                            borderTop: "1px solid var(--line)",
                            marginTop: 16,
                            paddingTop: 16,
                          }}
                        >
                          <h4>
                            {element?.label} ·{" "}
                            {latest?.decision === "CONFIRMED"
                              ? "Confirmed"
                              : latest?.decision === "REJECTED"
                                ? "Rejected"
                                : "For review"}
                          </h4>
                          <p>
                            {match.confidence.toLowerCase()} confidence.{" "}
                            {match.reason}
                          </p>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "repeat(auto-fit,minmax(min(100%,280px),1fr))",
                              gap: 16,
                            }}
                          >
                            <div>
                              <strong>Test evidence</strong>
                              {match.caseEvidence.map((q, i) => (
                                <blockquote key={i}>{q}</blockquote>
                              ))}
                            </div>
                            <div>
                              <strong>Architecture evidence</strong>
                              {match.diagramEvidence.map((q, i) => (
                                <blockquote key={i}>{q}</blockquote>
                              ))}
                            </div>
                          </div>
                          {current.canSpend && (
                            <div style={row}>
                              <button
                                type="button"
                                disabled={
                                  busy ||
                                  decision.isPending ||
                                  latest?.decision === "CONFIRMED"
                                }
                                onClick={() =>
                                  void decide(
                                    mapping.caseId,
                                    match.elementId,
                                    "CONFIRMED",
                                  )
                                }
                              >
                                Confirm link
                              </button>
                              <button
                                type="button"
                                disabled={
                                  busy ||
                                  decision.isPending ||
                                  latest?.decision === "REJECTED"
                                }
                                onClick={() =>
                                  void decide(
                                    mapping.caseId,
                                    match.elementId,
                                    "REJECTED",
                                  )
                                }
                              >
                                Reject link
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </article>
                );
              })}
            </section>
          )}
          {view === "DRAFTS" && (
            <section style={{ display: "grid", gap: 16 }}>
              <h2>Suggested tests · For review</h2>
              <p>
                These are proposals, not saved test cases. Confirm assumptions
                and adapt the procedure before creating a case in Vaettir.
              </p>
              {!drafts.length && (
                <p>
                  No draft results yet, or no additional test was supported by
                  the reviewed diagram.
                </p>
              )}
              {drafts.map(({ draft, draftIndex, batchIndex }, i) => (
                <article key={`${current.scopeHash}:${i}`} style={panel}>
                  <h3>{draft.title}</h3>
                  <p>
                    {draft.confidence.toLowerCase()} confidence ·{" "}
                    {draft.elementIds
                      .map(
                        (id) =>
                          current.document.elements.find((e) => e.id === id)
                            ?.label,
                      )
                      .join(", ")}
                  </p>
                  <h4>Preconditions</h4>
                  {draft.preconditions.map((s, n) => (
                    <p key={n}>{s}</p>
                  ))}
                  <h4>Procedure</h4>
                  <ol>
                    {draft.actions.map((s, n) => (
                      <li key={n}>{s}</li>
                    ))}
                  </ol>
                  <h4>Expected results</h4>
                  <ol>
                    {draft.expectedResults.map((s, n) => (
                      <li key={n}>{s}</li>
                    ))}
                  </ol>
                  {!!draft.assumptions.length && (
                    <>
                      <h4>Assumptions to confirm</h4>
                      {draft.assumptions.map((s, n) => (
                        <p key={n}>{s}</p>
                      ))}
                    </>
                  )}
                  <h4>Diagram evidence</h4>
                  {draft.diagramEvidence.map((s, n) => (
                    <blockquote key={n}>{s}</blockquote>
                  ))}
                  {current.canSpend && input && (
                    <DraftEditor
                      input={input}
                      scopeHash={current.scopeHash}
                      batchIndex={batchIndex}
                      draftIndex={draftIndex}
                      draft={draft}
                      disabled={busy}
                    />
                  )}
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}

type Draft = Preview["results"][number]["result"]["suggestions"][number];
const testTypes = [
  "UNIT",
  "FUNCTIONAL",
  "CONTRACT",
  "INSTRUMENTATION",
  "SMOKE",
  "SANITY",
  "REGRESSION",
  "E2E",
  "PERFORMANCE",
  "SECURITY",
  "ACCESSIBILITY",
  "EXPLORATORY",
  "COMPLIANCE",
  "OTHER",
] as const;
function DraftEditor({
  input,
  scopeHash,
  batchIndex,
  draftIndex,
  draft,
  disabled,
}: {
  input: {
    projectId: string;
    organizationId: string;
    fileName: string;
    content: string;
  };
  scopeHash: string;
  batchIndex: number;
  draftIndex: number;
  draft: Draft;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [title, setTitle] = useState(draft.title),
    [preconditions, setPreconditions] = useState(
      draft.preconditions.join("\n"),
    ),
    [actions, setActions] = useState(draft.actions.join("\n")),
    [results, setResults] = useState(draft.expectedResults.join("\n")),
    [type, setType] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const mutation = trpcReact.architecture.createDraft.useMutation();
  const [fieldsDraft, setFieldsDraft] = useState<CaseFieldFormDraft | null>(
    null,
  );
  const [savePending, setSavePending] = useState(false);
  const [saved, setSaved] = useState<{ id: string; displayId: string } | null>(
      null,
    ),
    [message, setMessage] = useState("");
  const pending = useRef<Parameters<typeof mutation.mutateAsync>[0] | null>(
    null,
  );
  const lines = (text: string) =>
    text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  const field = { display: "grid", gap: 8, marginBlock: 16 };
  async function save() {
    if (!type || !reviewed) return;
    if (!pending.current && !fieldsDraft?.ready) return;
    // Retain one exact request after an uncertain response. Editing then saving
    // is blocked until that request is recovered, rather than duplicating cases.
    if (!testTypes.some((t) => t === type)) return;
    pending.current ??= {
      ...input,
      resultScopeHash: scopeHash,
      batchIndex,
      draftIndex,
      requestId: crypto.randomUUID(),
      reviewedAssumptions: true,
      title,
      preconditions: lines(preconditions),
      actions: lines(actions),
      expectedResults: lines(results),
      testType: type as (typeof testTypes)[number],
      customFields: fieldsDraft?.customFields,
      expectedFieldSchemaHash: fieldsDraft?.expectedFieldSchemaHash,
    };
    setSavePending(true);
    try {
      setMessage("");
      setSaved(await mutation.mutateAsync(pending.current));
    } catch (e) {
      if ((e as { data?: { code?: string } }).data?.code === "BAD_REQUEST") {
        pending.current = null;
        setSavePending(false);
      }
      setMessage(
        e instanceof Error
          ? e.message
          : "Save unconfirmed. Retry this exact save to recover its result.",
      );
    }
  }
  if (saved)
    return (
      <p role="status">
        Saved{" "}
        <Link
          href={`/projects/${input.projectId}/test-cases?caseId=${encodeURIComponent(saved.id)}`}
        >
          {saved.displayId}
        </Link>{" "}
        for review. Reinspect the diagram before confirming mappings against the
        updated case inventory.
      </p>
    );
  if (!open)
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)}>
        Review &amp; create test
      </button>
    );
  const frozen = mutation.isPending || savePending || disabled;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={frozen} style={{ border: 0, padding: 0 }}>
        <legend>Review test proposal</legend>
        <label style={field}>
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label style={field}>
          Preconditions
          <textarea
            rows={3}
            value={preconditions}
            onChange={(e) => setPreconditions(e.target.value)}
          />
        </label>
        <label style={field}>
          Actions, one per line
          <textarea
            required
            rows={5}
            value={actions}
            onChange={(e) => setActions(e.target.value)}
          />
        </label>
        <label style={field}>
          Expected results, one per line
          <textarea
            required
            rows={4}
            value={results}
            onChange={(e) => setResults(e.target.value)}
          />
        </label>
        <label style={field}>
          Test type
          <select
            required
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">Choose after reviewing the test</option>
            {testTypes.map((t) => (
              <option key={t} value={t}>
                {t[0]}
                {t.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label style={row}>
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          I reviewed the diagram evidence and assumptions. Save this proposal as
          a pending test case.
        </label>
      </fieldset>
      <fieldset disabled={frozen} style={{ border: 0, padding: 0 }}>
        <CaseCustomFieldsForm
          projectId={input.projectId}
          active={open && !disabled}
          onChange={setFieldsDraft}
        />
      </fieldset>
      <div style={{ ...row, marginTop: 16 }}>
        <button
          type="submit"
          disabled={
            disabled ||
            mutation.isPending ||
            !reviewed ||
            !type ||
            (!savePending && !fieldsDraft?.ready)
          }
        >
          {savePending ? "Recover this save" : "Save test for review"}
        </button>
        {!savePending && (
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
