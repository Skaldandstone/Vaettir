"use client";
import { useRef, useState } from "react";
import { readDocumentFile } from "../lib/document-file";

export function DocumentFileInput({ onUse }: { onUse: (text: string, name: string) => void }) {
  const latestRead = useRef(0);
  const [candidate, setCandidate] = useState<{ text: string; name: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  async function select(file?: File) {
    const read = ++latestRead.current;
    setCandidate(null);
    setError("");
    setReading(!!file);
    if (!file) return;
    try {
      const text = await readDocumentFile(file);
      if (read === latestRead.current) setCandidate({ text, name: file.name });
    } catch (cause) {
      if (read === latestRead.current)
        setError(cause instanceof Error ? cause.message : "Could not read this file.");
    } finally {
      if (read === latestRead.current) setReading(false);
    }
  }
  return (
    <details>
      <summary>Use a Markdown or text file</summary>
      <p>Read one file locally in your browser. Nothing is uploaded until you confirm permission and select Preview changes. Maximum 200 KB and 50,000 characters.</p>
      <label>
        Document file
        <input type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void select(file);
        }} />
      </label>
      {reading && <p role="status">Reading file locally…</p>}
      {error && <p role="alert">{error}</p>}
      {candidate && (
        <div>
          <p>{candidate.name} · {candidate.text.length.toLocaleString()} characters</p>
          <details><summary>Preview local file text</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 180, overflowY: "auto" }}>{candidate.text}</pre></details>
          <p>Using this file replaces the text in your unsaved draft only. Review it and remove secrets or personal data before uploading.</p>
          <button type="button" className="btn-secondary" onClick={() => {
            onUse(candidate.text, candidate.name);
            setCandidate(null);
          }}>Use file contents in draft</button>
        </div>
      )}
    </details>
  );
}
