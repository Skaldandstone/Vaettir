"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact, useReadOnlySeat, type RouterOutputs } from "@/lib/trpcReact";

const ACTIVE_JOB_STATUSES = new Set(["PENDING", "RUNNING"]);

// P2-07: the raw material for "periodically review edit patterns to
// tighten the system prompt" -- a human reads this list and decides
// whether the prompt needs adjusting; nothing here automates that
// judgment call, it just makes the before/after visible in one place.
function AiEditFeedbackSection({ projectId }: { projectId: string }) {
  const feedbackQuery = trpcReact.testCases.listAiEditFeedback.useQuery({ projectId });
  const feedback = feedbackQuery.data ?? [];

  if (feedback.length === 0) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ marginBottom: 4 }}>AI edit feedback</h2>
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
        When a human corrects an AI-reverse-engineered case, that correction lands here - useful signal for whether
        the system prompt needs tightening.
      </p>
      {feedback.map((f) => (
        <div key={f.id} className="panel" style={{ marginBottom: 12, fontSize: 13 }}>
          <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
            Edited by {f.editedByEmail} · {new Date(f.editedAt).toLocaleString()}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 6 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 11 }}>
                Before (AI)
              </div>
              <strong>{f.beforeTitle}</strong>
              <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                {f.beforeGiven.map((s, i) => <li key={`bg${i}`}>Given {s}</li>)}
                {f.beforeWhen.map((s, i) => <li key={`bw${i}`}>When {s}</li>)}
                {f.beforeThen.map((s, i) => <li key={`bt${i}`}>Then {s}</li>)}
              </ul>
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 11 }}>
                After (human-corrected)
              </div>
              <strong>{f.afterTitle}</strong>
              <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                {f.afterGiven.map((s, i) => <li key={`ag${i}`}>Given {s}</li>)}
                {f.afterWhen.map((s, i) => <li key={`aw${i}`}>When {s}</li>)}
                {f.afterThen.map((s, i) => <li key={`at${i}`}>Then {s}</li>)}
              </ul>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

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

// P1-15
export default function ReverseEngineerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const utils = trpcReact.useUtils();
  const [filePath, setFilePath] = useState("src/example.test.ts");
  const [content, setContent] = useState("");
  const [persist, setPersist] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouterOutputs["agent"]["reverseEngineerFile"] | null>(null);

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

  // P5-12: "teach the platform your framework"
  const heuristicsQuery = trpcReact.agent.listCustomFrameworkHeuristics.useQuery({ projectId });
  const heuristics = heuristicsQuery.data ?? [];
  const [exampleFiles, setExampleFiles] = useState<{ filePath: string; content: string }[]>([
    { filePath: "", content: "" },
    { filePath: "", content: "" },
  ]);
  const [inferring, setInferring] = useState(false);
  const [inferred, setInferred] = useState<RouterOutputs["agent"]["inferCustomFrameworkHeuristic"] | null>(null);
  const [savingHeuristic, setSavingHeuristic] = useState(false);
  const [heuristicError, setHeuristicError] = useState<string | null>(null);

  const readOnly = useReadOnlySeat(projectId);

  function loadHeuristics() {
    void utils.agent.listCustomFrameworkHeuristics.invalidate({ projectId });
  }

  // Pre-fill the repo URL from the project itself so the user doesn't have
  // to go look it up on /projects again.
  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const projectRepoUrl = projectQuery.data?.repoUrl ?? null;
  useEffect(() => {
    if (projectRepoUrl) setRepoUrl(projectRepoUrl);
  }, [projectRepoUrl]);

  // Poll while any job is PENDING/RUNNING so status updates without a
  // manual refresh; stops polling once nothing's in flight.
  const jobsQuery = trpcReact.agent.listJobs.useQuery(
    { projectId },
    { refetchInterval: (q) => (q.state.data?.some((j) => ACTIVE_JOB_STATUSES.has(j.status)) ? 2000 : false) },
  );
  const jobs = jobsQuery.data ?? [];

  function loadJobs() {
    void utils.agent.listJobs.invalidate({ projectId });
  }

  const inferMutation = trpcReact.agent.inferCustomFrameworkHeuristic.useMutation();
  const saveHeuristicMutation = trpcReact.agent.saveCustomFrameworkHeuristic.useMutation();
  const deleteHeuristicMutation = trpcReact.agent.deleteCustomFrameworkHeuristic.useMutation();
  const reverseEngineerMutation = trpcReact.agent.reverseEngineerFile.useMutation();
  const submitJobMutation = trpcReact.agent.submitJob.useMutation();
  const importGherkinMutation = trpcReact.agent.importGherkin.useMutation();
  const importPostmanMutation = trpcReact.agent.importPostmanCollection.useMutation();
  const uploadZipMutation = trpcReact.agent.uploadZip.useMutation();
  const scanRepoMutation = trpcReact.agent.scanRepo.useMutation();

  async function inferHeuristic() {
    const validFiles = exampleFiles.filter((f) => f.filePath.trim() && f.content.trim());
    if (validFiles.length < 2) {
      setHeuristicError("Provide at least 2 example files");
      return;
    }
    setInferring(true);
    setHeuristicError(null);
    setInferred(null);
    try {
      const res = await inferMutation.mutateAsync({ projectId, files: validFiles });
      setInferred(res);
    } catch (e) {
      setHeuristicError(e instanceof Error ? e.message : String(e));
    } finally {
      setInferring(false);
    }
  }

  async function saveHeuristic() {
    if (!inferred) return;
    setSavingHeuristic(true);
    setHeuristicError(null);
    try {
      await saveHeuristicMutation.mutateAsync({
        projectId,
        name: inferred.name,
        description: inferred.description,
        confidence: inferred.confidence,
        exampleFilePaths: exampleFiles.filter((f) => f.filePath.trim()).map((f) => f.filePath),
      });
      setInferred(null);
      setExampleFiles([{ filePath: "", content: "" }, { filePath: "", content: "" }]);
      loadHeuristics();
    } catch (e) {
      setHeuristicError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingHeuristic(false);
    }
  }

  async function deleteHeuristic(id: string) {
    if (!confirm("Delete this learned framework pattern? Future files won't get this hint anymore.")) return;
    await deleteHeuristicMutation.mutateAsync({ id });
    loadHeuristics();
  }

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await reverseEngineerMutation.mutateAsync({ projectId, filePath, content, persist });
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
      await submitJobMutation.mutateAsync({ projectId, filePath, content });
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
      const res = await importGherkinMutation.mutateAsync({ projectId, filePath: gherkinPath, content: gherkinContent });
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
      const res = await importPostmanMutation.mutateAsync({ projectId, filePath: postmanPath, content: postmanContent });
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
      const res = await uploadZipMutation.mutateAsync({ projectId, zipBase64 });
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
      const res = await scanRepoMutation.mutateAsync({ projectId, repoUrl: repoUrl || undefined, ref: repoRef });
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

      {readOnly && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          You have read-only access to this organization — reverse-engineering and importing is hidden.
        </p>
      )}

      {!readOnly && (
      <>
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

      <h2>...or teach the platform a custom framework</h2>
      <p style={{ color: "var(--muted)", margin: "0 0 8px" }}>
        For a bespoke/internal framework with no built-in support: give 2-3 example test files and the agent infers
        how test names, assertions, and setup/teardown are expressed in it. That pattern is then included as context
        on every later reverse-engineer call for this project&apos;s files in that same framework, instead of
        guessing from scratch each time.
      </p>
      <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
        {exampleFiles.map((f, i) => (
          <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10 }}>
            <label>
              File path
              <input
                value={f.filePath}
                onChange={(e) =>
                  setExampleFiles(exampleFiles.map((ff, j) => (j === i ? { ...ff, filePath: e.target.value } : ff)))
                }
                style={{ width: "100%" }}
              />
            </label>
            <input
              type="file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await readFileAsText(file);
                setExampleFiles(exampleFiles.map((ff, j) => (j === i ? { filePath: file.name, content: text } : ff)));
                e.target.value = "";
              }}
            />
            <textarea
              value={f.content}
              onChange={(e) =>
                setExampleFiles(exampleFiles.map((ff, j) => (j === i ? { ...ff, content: e.target.value } : ff)))
              }
              rows={6}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
              placeholder="Paste an example test file..."
            />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          {exampleFiles.length < 3 && (
            <button
              className="btn-secondary"
              onClick={() => setExampleFiles([...exampleFiles, { filePath: "", content: "" }])}
            >
              + Add a third example
            </button>
          )}
          <button onClick={inferHeuristic} disabled={inferring}>
            {inferring ? "Inferring…" : "Infer the pattern"}
          </button>
        </div>
        {heuristicError && <p style={{ color: "var(--ember)" }}>{heuristicError}</p>}

        {inferred && (
          <div className="panel" style={{ display: "grid", gap: 8 }}>
            <label>
              Name
              <input
                value={inferred.name}
                onChange={(e) => setInferred({ ...inferred, name: e.target.value })}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              Description <span className="text-muted" style={{ fontSize: 12 }}>(edit before saving if needed)</span>
              <textarea
                value={inferred.description}
                onChange={(e) => setInferred({ ...inferred, description: e.target.value })}
                rows={6}
                style={{ width: "100%" }}
              />
            </label>
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              Agent&apos;s own confidence: {(inferred.confidence * 100).toFixed(0)}%
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={() => setInferred(null)}>
                Discard
              </button>
              <button onClick={saveHeuristic} disabled={savingHeuristic}>
                {savingHeuristic ? "Saving…" : "Save this pattern"}
              </button>
            </div>
          </div>
        )}

        {heuristics.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Learned patterns for this project</div>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {heuristics.map((h) => (
                <li key={h.id} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <strong>{h.name}</strong>
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      used {h.usageCount} time{h.usageCount === 1 ? "" : "s"}
                      {h.confidence !== null && ` · ${(h.confidence * 100).toFixed(0)}% confidence`}
                      {h.usageCount >= 10 && (
                        <span style={{ color: "var(--frost)" }}> · well-understood - consider a native evaluator</span>
                      )}
                    </span>
                  </div>
                  <p className="text-muted" style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{h.description}</p>
                  <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => deleteHeuristic(h.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      </>
      )}

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
      <AiEditFeedbackSection projectId={projectId} />
    </div>
  );
}
