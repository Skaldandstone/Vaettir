"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";

// P1-15
export default function ExploratorySessionPage() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>();
  const router = useRouter();
  const utils = trpcReact.useUtils();
  const sessionQuery = trpcReact.exploratorySessions.byId.useQuery({ id: sessionId });
  const [note, setNote] = useState("");
  const [isFinding, setIsFinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caseTitle, setCaseTitle] = useState("");

  const invalidate = () => utils.exploratorySessions.byId.invalidate({ id: sessionId });
  const addNoteMutation = trpcReact.exploratorySessions.addNote.useMutation({
    onSuccess: () => {
      setNote("");
      setIsFinding(false);
      void invalidate();
    },
    onError: (e) => setError(e.message),
  });
  const completeMutation = trpcReact.exploratorySessions.complete.useMutation({
    onSuccess: () => void invalidate(),
    onError: (e) => setError(e.message),
  });
  const convertMutation = trpcReact.exploratorySessions.convertToTestCase.useMutation({
    onSuccess: ({ testCaseId }) => router.push(`/projects/${projectId}/test-cases/${testCaseId}`),
    onError: (e) => setError(e.message),
  });

  function addNote() {
    if (!note.trim()) return;
    setError(null);
    addNoteMutation.mutate({ sessionId, text: note.trim(), isFinding });
  }

  function convert() {
    if (!caseTitle.trim()) return;
    setError(null);
    convertMutation.mutate({ sessionId, title: caseTitle.trim() });
  }

  const session = sessionQuery.data;
  const pageError = error ?? sessionQuery.error?.message ?? null;

  if (pageError) return <p style={{ color: "var(--ember)" }}>{pageError}</p>;
  if (!session) return <p>Loading…</p>;

  const findingCount = session.notes.filter((n) => n.isFinding).length;

  return (
    <div style={{ maxWidth: 700 }}>
      <h1>{session.charter}</h1>
      <p className="text-muted" style={{ fontSize: 13 }}>
        {session.testerEmail} · started {new Date(session.startedAt).toLocaleString()} · {session.status}
        {session.endedAt && ` · ended ${new Date(session.endedAt).toLocaleString()}`}
      </p>

      <div style={{ margin: "16px 0" }}>
        {session.notes.map((n) => (
          <div
            key={n.id}
            style={{
              padding: "6px 10px",
              marginBottom: 6,
              borderLeft: n.isFinding ? "3px solid var(--ember)" : "3px solid var(--line)",
              background: n.isFinding ? "var(--ember-dim)" : "transparent",
            }}
          >
            <span className="text-muted" style={{ fontSize: 11, marginRight: 8 }}>
              {new Date(n.createdAt).toLocaleTimeString()}
            </span>
            {n.isFinding && <strong style={{ marginRight: 6 }}>FINDING</strong>}
            {n.text}
          </div>
        ))}
        {session.notes.length === 0 && <p className="text-muted">No notes logged yet.</p>}
      </div>

      {session.status === "IN_PROGRESS" && (
        <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you just observe?"
            rows={2}
          />
          <label style={{ fontSize: 13 }}>
            <input type="checkbox" checked={isFinding} onChange={(e) => setIsFinding(e.target.checked)} /> This is a
            finding worth following up on
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" onClick={addNote} disabled={addNoteMutation.isPending || !note.trim()}>
              {addNoteMutation.isPending ? "Adding…" : "Add note"}
            </button>
            <button className="btn-secondary" onClick={() => completeMutation.mutate({ sessionId })} disabled={completeMutation.isPending}>
              End session
            </button>
          </div>
        </div>
      )}

      {session.status === "COMPLETED" && (
        <div className="panel" style={{ padding: 12 }}>
          <strong>Convert to a scripted test case</strong>
          <p className="text-muted" style={{ fontSize: 13 }}>
            {findingCount > 0
              ? `Builds a test case from this session's charter and its ${findingCount} flagged finding(s).`
              : "No findings were flagged in this session - the resulting test case will just assert no regression from the charter."}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={caseTitle} onChange={(e) => setCaseTitle(e.target.value)} placeholder="Test case title" style={{ flex: 1 }} />
            <button className="btn-primary" onClick={convert} disabled={convertMutation.isPending || !caseTitle.trim()}>
              {convertMutation.isPending ? "Converting…" : "Convert"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
