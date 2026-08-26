"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";

const ACTIVE_JOB_STATUSES = new Set(["PENDING", "RUNNING"]);

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

// FileReader's readAsDataURL gives "data:<mime>;base64,<data>" -- strip the
// prefix since the mutation just wants the raw base64 payload.
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function ReverseEngineerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [filePath, setFilePath] = useState("src/example.test.ts");
  const [content, setContent] = useState("");
  const [persist, setPersist] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouterOutputs["agent"]["reverseEngineerFile"] | null>(null);

  const [jobs, setJobs] = useState<RouterOutputs["agent"]["listJobs"]>([]);
  const [submittingJob, setSubmittingJob] = useState(false);

  const [repoUrl, setRepoUrl] = useState("");
  const [repoRef, setRepoRef] = useState("main");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<RouterOutputs["agent"]["scanRepo"] | null>(null);

  const [gherkinPath, setGherkinPath] = useState("features/example.feature");
  const [gherkinContent, setGherkinContent] = useState("");
  const [importingGherkin, setImportingGherkin] = useState(false);
  const [gherkinResult, setGherkinResult] = useState<RouterOutputs["agent"]["importGherkin"] | null>(null);

  const [uploadingZip, setUploadingZip] = useState(false);
  const [zipResult, setZipResult] = useState<RouterOutputs["agent"]["uploadZip"] | null>(null);

  const [postmanPath, setPostmanPath] = useState("collection.json");
  const [postmanContent, setPostmanContent] = useState("");
  const [importingPostman, setImportingPostman] = useState(false);
  const [postmanResult, setPostmanResult] = useState<RouterOutputs["agent"]["importPostmanCollection"] | null>(null);

  // Pre-fill the repo URL from the project itself so the user doesn't have
  // to go look it up on /projects again.
  useEffect(() => {
    trpc.project.byId
      .query({ id: projectId })
      .then((p) => {
        if (p.repoUrl) setRepoUrl(p.repoUrl);
      })
      .catch(() => undefined);
  }, [projectId]);

  function loadJobs() {
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

  async function importGherkin() {
    setImportingGherkin(true);
    setError(null);
    setGherkinResult(null);
    try {
      const res = await trpc.agent.importGherkin.mutate({ projectId, filePath: gherkinPath, content: gherkinContent });
      setGherkinResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingGherkin(false);
    }
  }

  async function importPostmanCollection() {
    setImportingPostman(true);
    setError(null);
    setPostmanResult(null);
    try {
      const res = await trpc.agent.importPostmanCollection.mutate({ projectId, filePath: postmanPath, content: postmanContent });
      setPostmanResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingPostman(false);
    }
  }

  async function uploadZip(file: File) {
    setUploadingZip(true);
    setError(null);
    setZipResult(null);
    try {
      const zipBase64 = await readFileAsBase64(file);
      const res = await trpc.agent.uploadZip.mutate({ projectId, zipBase64 });
      setZipResult(res);
      loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingZip(false);
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
        <button onClick={scanRepo} disabled={scanning}>
          {scanning ? "Cloning + scanning…" : "Scan repository"}
        </button>
        {scanResult && (
          <p style={{ color: "var(--frost)" }}>
            Found {scanResult.scannedFileCount} test file(s), queued {scanResult.queuedJobIds.length} background job(s).
            {scanResult.rateLimitedCount > 0 && (
              <span style={{ color: "var(--ember)" }}>
                {" "}
                {scanResult.rateLimitedCount} held back by this org&apos;s hourly rate limit — try again shortly.
              </span>
            )}
          </p>
        )}
      </div>

      <h2>...or upload a zip of a test directory</h2>
      <p style={{ color: "var(--muted)", margin: "0 0 8px" }}>
        Finds test files by naming convention inside the zip and queues one background job per file, same as
        scanning a repo — just from a local archive instead of a clone.
      </p>
      <div style={{ display: "grid", gap: 8, maxWidth: 720, marginBottom: 8 }}>
        <input
          type="file"
          accept=".zip"
          disabled={uploadingZip}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadZip(file);
            e.target.value = "";
          }}
        />
        {uploadingZip && <p className="text-muted">Uploading + scanning…</p>}
        {zipResult && (
          <p style={{ color: "var(--frost)" }}>
            Found {zipResult.scannedFileCount} test file(s), queued {zipResult.queuedJobIds.length} background job(s).
            {zipResult.rateLimitedCount > 0 && (
              <span style={{ color: "var(--ember)" }}>
                {" "}
                {zipResult.rateLimitedCount} held back by this org&apos;s hourly rate limit — try again shortly.
              </span>
            )}
          </p>
        )}
      </div>

      <h2>...or paste (or upload) a single test file</h2>
      <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        <label>
          File path
          <input value={filePath} onChange={(e) => setFilePath(e.target.value)} style={{ width: "100%" }} />
        </label>
        <input
          type="file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setFilePath(file.name);
            setContent(await readFileAsText(file));
            e.target.value = "";
          }}
        />
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
          test cases
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={submit} disabled={loading || !content}>
            {loading ? "Analyzing…" : "Reverse-engineer now"}
          </button>
          <button onClick={submitAsJob} disabled={submittingJob || !content}>
            {submittingJob ? "Submitting…" : "Run as background job"}
          </button>
        </div>
      </div>

      <h2>...or import a Gherkin/.feature file</h2>
      <p style={{ color: "var(--muted)", margin: "0 0 8px" }}>
        Already BDD, so this just parses and validates rather than inferring — each Scenario becomes its own test
        case, landing pre-approved (no AI to double-check). A Scenario Outline&apos;s Examples table expands into one
        case per row.
      </p>
      <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        <label>
          File path
          <input value={gherkinPath} onChange={(e) => setGherkinPath(e.target.value)} style={{ width: "100%" }} />
        </label>
        <input
          type="file"
          accept=".feature"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setGherkinPath(file.name);
            setGherkinContent(await readFileAsText(file));
            e.target.value = "";
          }}
        />
        <label>
          .feature source
          <textarea
            value={gherkinContent}
            onChange={(e) => setGherkinContent(e.target.value)}
            rows={12}
            style={{ width: "100%", fontFamily: "monospace" }}
            placeholder={"Feature: Checkout\n\n  Scenario: Empty cart cannot check out\n    Given the cart is empty\n    When the user attempts to check out\n    Then an EmptyCart error is shown"}
          />
        </label>
        <button onClick={importGherkin} disabled={importingGherkin || !gherkinContent}>
          {importingGherkin ? "Importing…" : "Import"}
        </button>
        {gherkinResult && (
          <p style={{ color: "var(--frost)" }}>
            Imported {gherkinResult.created.length} test case(s):{" "}
            {gherkinResult.created.map((tc) => tc.title).join(", ")}
          </p>
        )}
      </div>

      <h2>...or import a Postman collection</h2>
      <p style={{ color: "var(--muted)", margin: "0 0 8px" }}>
        Request/assertion pairs, not functions — this extracts each request&apos;s <code>pm.test(...)</code> checks
        rather than inferring anything. A request with no test script has nothing to verify and is skipped.
      </p>
      <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        <label>
          File path
          <input value={postmanPath} onChange={(e) => setPostmanPath(e.target.value)} style={{ width: "100%" }} />
        </label>
        <input
          type="file"
          accept=".json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setPostmanPath(file.name);
            setPostmanContent(await readFileAsText(file));
            e.target.value = "";
          }}
        />
        <label>
          Collection JSON (exported from Postman)
          <textarea
            value={postmanContent}
            onChange={(e) => setPostmanContent(e.target.value)}
            rows={10}
            style={{ width: "100%", fontFamily: "monospace" }}
            placeholder='{"info": {"name": "..."}, "item": [...]}'
          />
        </label>
        <button onClick={importPostmanCollection} disabled={importingPostman || !postmanContent}>
          {importingPostman ? "Importing…" : "Import"}
        </button>
        {postmanResult && (
          <p style={{ color: "var(--frost)" }}>
            Imported {postmanResult.created.length} test case(s):{" "}
            {postmanResult.created.map((tc) => tc.title).join(", ")}
          </p>
        )}
      </div>

      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {jobs.length > 0 && (
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
                    <a href={`/projects/${projectId}/test-cases/review`}>view in review queue</a>
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
