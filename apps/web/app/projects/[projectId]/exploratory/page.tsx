"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";

// P1-15
export default function ExploratorySessionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const sessionsQuery = trpcReact.exploratorySessions.list.useQuery({ projectId });
  const sessions = sessionsQuery.data ?? [];
  const [charter, setCharter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startMutation = trpcReact.exploratorySessions.start.useMutation({
    onSuccess: ({ sessionId }) => router.push(`/projects/${projectId}/exploratory/${sessionId}`),
    onError: (e) => setError(e.message),
  });

  function start() {
    if (!charter.trim()) return;
    setError(null);
    startMutation.mutate({ projectId, charter: charter.trim() });
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <h1>Exploratory testing</h1>
      <p className="text-muted" style={{ fontSize: 13 }}>
        Session-based exploratory testing: no predefined steps - explore against a charter, log what you find as you
        go, then optionally turn real findings into a permanent scripted test case.
      </p>

      <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        <input
          value={charter}
          onChange={(e) => setCharter(e.target.value)}
          placeholder='Charter, e.g. "Explore checkout with an expired discount code"'
          style={{ flex: 1 }}
        />
        <button className="btn-primary" onClick={start} disabled={startMutation.isPending || !charter.trim()}>
          {startMutation.isPending ? "Starting…" : "Start session"}
        </button>
      </div>
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {sessions.map((s) => (
        <a
          key={s.id}
          href={`/projects/${projectId}/exploratory/${s.id}`}
          className="panel"
          style={{ display: "block", marginBottom: 8, padding: 10, textDecoration: "none", color: "inherit" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{s.charter}</strong>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {s.status}
            </span>
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {s.testerEmail} · started {new Date(s.startedAt).toLocaleString()} · {s.noteCount} note(s), {s.findingCount} finding(s)
          </div>
        </a>
      ))}
      {sessionsQuery.isSuccess && sessions.length === 0 && <p className="text-muted">No exploratory sessions yet.</p>}
    </div>
  );
}
