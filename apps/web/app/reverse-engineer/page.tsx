"use client";

import { useEffect, useState } from "react";
import { trpc, type RouterOutputs } from "../../lib/trpc";

const ACTIVE_JOB_STATUSES = new Set(["PENDING", "RUNNING"]);

export default function ReverseEngineerPage() {
  const [projectId, setProjectId] = useState("");
  const [filePath, setFilePath] = useState("src/example.test.ts");
  const [content, setContent] = useState("");
  const [persist, setPersist] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouterOutputs["agent"]["reverseEngineerFile"] | null>(null);

  const [jobs, setJobs] = useState<RouterOutputs["agent"]["listJobs"]>([]);
  const [submittingJob, setSubmittingJob] = useState(false);

  const [repoUrl, setRepoUrl] = useState("");
  const [repoRef, setRepoRef] = useState("main");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<RouterOutputs["agent"]["scanRepo"] | null>(null);

  function loadJobs() {
    if (!projectId) return;
    trpc.agent.listJobs.query({ projectId }).then(setJobs).catch(() => undefined);
  }

  useEffect(loadJobs, [projectId]);

  // Poll while any job is PENDING/RUNNING so status updates without a
  // manual refresh; stops polling once nothing's in flight.
  useEffect(() => {
    if (!jobs.some((j) => ACTIVE_JOB_STATUSES.has(j.status))) return;
    const t = setInterval(loadJobs, 2000);
    return () => clearInterval(t);
  }, [jobs, projectId]);

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await trpc.agent.reverseEngineerFile.mutate({ projectId, filePath, content, persist });
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function submitAsJob() {
    setSubmittingJob(true);
    setError(null);
    try {
      await trpc.agent.submitJob.mutate({ projectId, filePath, content });
      loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmittingJob(false);
    }
  }

  async function scanRepo() {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const res = await trpc.agent.scanRepo.mutate({ projectId, repoUrl: repoUrl || undefined, ref: repoRef });
      setScanResult(res);
      loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div>
      <h1>Reverse-engineer a test into BDD</h1>
      <p>Paste an automated test file (any framework) and get back human-readable Given/When/Then test cases.</p>

      <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        <label>
          Project ID (required to persist)
          <input value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ width: "100%" }} />
        </label>
      </div>

      <div
        style={{
          display: "grid",
          gap: 8,
          maxWidth: 720,
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: 16,
          margin: "16px 0",
        }}
      >
        <h2 style={{ margin: 0 }}>Scan a repository</h2>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Clones a repo, finds test files by naming convention, and queues one background job per file.
        </p>
        <label>
          Repo URL <span style={{ color: "var(--muted-dim)" }}>(https only; falls back to the project&apos;s repo URL if blank)</span>
          <input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/org/repo.git"
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Branch
          <input value={repoRef} onChange={(e) => setRepoRef(e.target.value)} style={{ width: 200 }} />
        </label>
        <button onClick={scanRepo} disabled={scanning || !projectId}>
          {scanning ? "Cloning + scanning…" : "Scan repository"}
        </button>
        {scanResult && (
          <p style={{ color: "var(--frost)" }}>
            Found {scanResult.scannedFileCount} test file(s), queued {scanResult.queuedJobIds.length} background job(s).
          </p>
        )}
      </div>

      <h2>...or paste a single test file</h2>
      <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        <label>
          File path
          <input value={filePath} onChange={(e) => setFilePath(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          Test source
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            style={{ width: "100%", fontFamily: "monospace" }}
            placeholder={"it('rejects checkout when cart is empty', () => {\n  const cart = new Cart();\n  expect(() => checkout(cart)).toThrow('EmptyCart');\n});"}
          />
        </label>
        <label>
          <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} /> Save results as
          test cases (requires Project ID)
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={submit} disabled={loading || !content}>
            {loading ? "Analyzing…" : "Reverse-engineer now"}
          </button>
          <button onClick={submitAsJob} disabled={submittingJob || !content || !projectId}>
            {submittingJob ? "Submitting…" : "Run as background job"}
          </button>
        </div>
      </div>

      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {projectId && jobs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2>Recent jobs</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {jobs.map((j) => (
              <li key={j.id} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0" }}>
                <strong>{j.status}</strong> — {j.inputRef}
                {j.status === "SUCCEEDED" && ` — ${j.resultTestCaseIds.length} test case(s) created`}
                {j.status === "FAILED" && j.error && <span style={{ color: "var(--ember)" }}> — {j.error}</span>}
                {j.resultTestCaseIds.length > 0 && (
                  <>
                    {" "}
                    <a href={`/test-cases/review?projectId=${projectId}`}>view in review queue</a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 24 }}>
          <h2>
            Detected: {result.result.detectedFramework} ({result.result.detectedFrameworkFamily})
          </h2>
          {result.result.testCases.map((tc, i) => (
            <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <h3>{tc.title}</h3>
              <p>
                <strong>{tc.testType}</strong> · confidence {(tc.confidence * 100).toFixed(0)}%
              </p>
              {tc.background && <p><em>Background: {tc.background}</em></p>}
              <ul>
                {tc.given.map((s, j) => <li key={j}>Given {s}</li>)}
                {tc.when.map((s, j) => <li key={j}>When {s}</li>)}
                {tc.then.map((s, j) => <li key={j}>Then {s}</li>)}
              </ul>
              {tc.notes && <p><small>{tc.notes}</small></p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
