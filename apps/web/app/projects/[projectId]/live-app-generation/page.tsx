"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact, useReadOnlySeat, type RouterOutputs } from "@/lib/trpcReact";

type Draft = RouterOutputs["liveAppGeneration"]["generateFromUrl"][number];

// SSE-181: deliberately its own page, not folded into /reverse-engineer or
// the shared /test-cases/review queue - there's no prior test to diff a
// live-app-generated draft against, which is a real difference a reviewer
// should see, not just a label. Visibly marked EXPERIMENTAL (dashed
// var(--ember) border, not the calm var(--line) panels used elsewhere)
// since server-side browser automation against a caller-supplied URL is a
// genuinely new, unproven capability behind a tight allowlist - see
// trpc.ts's liveAppScanProcedure and its own comment. A temp UI, per
// explicit instruction, ahead of a real one once this proves out.
export default function LiveAppGenerationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const readOnly = useReadOnlySeat(projectId);

  const [startUrl, setStartUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [scannedUrl, setScannedUrl] = useState<string | null>(null);
  const [committedTitles, setCommittedTitles] = useState<string[]>([]);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  const generateMutation = trpcReact.liveAppGeneration.generateFromUrl.useMutation();
  const commitMutation = trpcReact.liveAppGeneration.commitDraft.useMutation();

  async function generate() {
    setGenerating(true);
    setError(null);
    setDrafts(null);
    setCommittedTitles([]);
    try {
      const res = await generateMutation.mutateAsync({ projectId, startUrl });
      setDrafts(res);
      setScannedUrl(startUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function commit(index: number) {
    const draft = drafts?.[index];
    if (!draft) return;
    setBusyIndex(index);
    setError(null);
    try {
      await commitMutation.mutateAsync({ projectId, ...draft });
      setCommittedTitles((prev) => [...prev, draft.title]);
      setDrafts((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyIndex(null);
    }
  }

  function discard(index: number) {
    setDrafts((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  return (
    <div>
      <h1>Generate test cases from a live app</h1>
      <div
        style={{
          display: "inline-block",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: "var(--ember)",
          border: "1px dashed var(--ember)",
          borderRadius: 999,
          padding: "2px 10px",
          marginBottom: 12,
        }}
      >
        Experimental — early access
      </div>
      <p>
        Crawls a public URL (and a handful of same-origin pages linked from it) and drafts BDD test cases grounded in
        what was actually observed on the page - buttons, links, form fields, page titles. There&apos;s no prior test
        to compare against here, unlike reverse-engineering, so review each draft on its own merits before saving it.
      </p>

      {readOnly && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          You have read-only access to this organization — generating test cases is hidden.
        </p>
      )}

      {!readOnly && (
        <>
          <div
            style={{
              display: "grid",
              gap: 8,
              maxWidth: 720,
              border: "1px dashed var(--ember)",
              borderRadius: 8,
              padding: 16,
              margin: "16px 0",
            }}
          >
            <label>
              Start URL <span style={{ color: "var(--muted-dim)" }}>(public http/https only - private and internal addresses are rejected)</span>
              <input
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                placeholder="https://your-staging-app.example.com"
                style={{ width: "100%" }}
              />
            </label>
            <button onClick={generate} disabled={generating || !startUrl.trim()}>
              {generating ? "Crawling + generating…" : "Crawl and generate drafts"}
            </button>
          </div>

          {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

          {committedTitles.length > 0 && (
            <p style={{ color: "var(--frost)" }}>
              Saved {committedTitles.length} test case(s) as pending review: {committedTitles.join(", ")}
            </p>
          )}

          {drafts && drafts.length === 0 && committedTitles.length === 0 && (
            <p className="text-muted">No drafts generated - the crawl may not have found enough to work with.</p>
          )}

          {drafts && drafts.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h2>Drafts from {scannedUrl}</h2>
              <p className="text-muted" style={{ fontSize: 13 }}>
                Nothing is saved yet. Commit each draft you want to keep, or discard it.
              </p>
              {drafts.map((draft, i) => (
                <div
                  key={`${draft.title}-${i}`}
                  style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, marginBottom: 12 }}
                >
                  <h3>{draft.title}</h3>
                  <p>
                    <strong>{draft.testType}</strong> · confidence {(draft.confidence * 100).toFixed(0)}%
                  </p>
                  {draft.background && (
                    <p>
                      <em>Background: {draft.background}</em>
                    </p>
                  )}
                  <ul>
                    {draft.given.map((s, j) => (
                      <li key={`g${j}`}>Given {s}</li>
                    ))}
                    {draft.when.map((s, j) => (
                      <li key={`w${j}`}>When {s}</li>
                    ))}
                    {draft.then.map((s, j) => (
                      <li key={`t${j}`}>Then {s}</li>
                    ))}
                  </ul>
                  {draft.tags.length > 0 && (
                    <p className="text-muted" style={{ fontSize: 12 }}>
                      Tags: {draft.tags.join(", ")}
                    </p>
                  )}
                  {draft.notes && (
                    <p>
                      <small>{draft.notes}</small>
                    </p>
                  )}
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button className="btn-secondary" onClick={() => discard(i)} disabled={busyIndex === i}>
                      Discard
                    </button>
                    <button onClick={() => commit(i)} disabled={busyIndex === i}>
                      {busyIndex === i ? "Saving…" : "Save as pending review"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
