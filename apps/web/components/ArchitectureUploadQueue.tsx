"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useLayoutEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@vaettir/api/src/router";
import { trpcReact } from "@/lib/trpcReact";

type Preview = inferRouterOutputs<AppRouter>["architecture"]["preview"];
type Source = { fileName: string; content: string };
type Row = { file: File; source?: Source; preview?: Preview; error?: string; saved?: boolean };

/** Multiple independently reviewed, retained documents; never starts analysis. */
export function ArchitectureUploadQueue({ projectId, organizationId, actorClerkUserId, disabled, scopeAvailable, onSingle, onOpen, onSaved, onBusy }: {
  projectId: string; organizationId: string; actorClerkUserId: string;
  disabled: boolean; scopeAvailable: boolean;
  onSingle: (file: File | undefined) => void;
  onOpen: (source: Source, preview: Preview) => void;
  onSaved: () => void; onBusy: (busy: boolean) => void;
}) {
  const preview = trpcReact.architecture.preview.useMutation();
  const save = trpcReact.architecture.saveDocument.useMutation();
  const [rows, setRows] = useState<Row[]>([]), [message, setMessage] = useState("");
  const generation = useRef(0), available = useRef(scopeAvailable), inFlight = useRef(false);
  useLayoutEffect(() => {
    available.current = scopeAvailable;
    if (!scopeAvailable) generation.current++;
    return () => { available.current = false; };
  }, [scopeAvailable]);
  function select(files: FileList | null) {
    if (disabled || inFlight.current) return;
    generation.current++;
    setRows([]); setMessage("");
    const chosen = Array.from(files ?? []);
    if (chosen.length <= 1) { onSingle(chosen[0]); return; }
    onSingle(undefined);
    if (chosen.length > 20) { setMessage("Choose up to 20 diagrams at a time. No files were inspected or saved."); return; }
    setRows(chosen.map(file => ({ file })));
  }
  function update(index: number, patch: Partial<Row>) {
    setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  }
  async function inspectAll() {
    if (disabled || !available.current || inFlight.current) return;
    const ticket = generation.current;
    inFlight.current = true; onBusy(true); setMessage("");
    try {
      for (const [index, row] of rows.entries()) {
        if (ticket !== generation.current || !available.current) return;
        if (row.preview) continue;
        try {
          if (!/\.(puml|plantuml|pu|svg)$/i.test(row.file.name)) throw new Error("Choose a PlantUML or SVG file.");
          if (row.file.size > 1_000_000) throw new Error("This diagram exceeds 1 MB. No content was truncated.");
          let content: string;
          try { content = new TextDecoder("utf-8", { fatal: true }).decode(await row.file.arrayBuffer()); }
          catch { throw new Error("This file is not valid UTF-8 text. Export it as UTF-8 and try again."); }
          const source = { fileName: row.file.name, content };
          if (ticket !== generation.current || !available.current) return;
          const result = await preview.mutateAsync({ projectId, organizationId, ...source });
          if (ticket !== generation.current || !available.current) return;
          if (result.projectId !== projectId || result.organizationId !== organizationId || result.actorClerkUserId !== actorClerkUserId) throw new Error("Access changed. Refresh project access before continuing.");
          update(index, { source, preview: result, error: undefined });
        } catch (error) {
          if (ticket !== generation.current || !available.current) return;
          update(index, { error: error instanceof Error ? error.message : "Could not inspect this diagram." });
        }
      }
    } finally { inFlight.current = false; onBusy(false); }
  }
  async function saveReviewed() {
    if (disabled || !available.current || inFlight.current) return;
    const ticket = generation.current;
    inFlight.current = true; onBusy(true); setMessage("");
    try {
      for (const [index, row] of rows.entries()) {
        if (ticket !== generation.current || !available.current) return;
        if (row.saved || !row.source || !row.preview?.canSpend) continue;
        try {
          const result = await save.mutateAsync({ projectId, organizationId, ...row.source });
          if (ticket !== generation.current || !available.current) return;
          if (result.hash !== row.preview.document.hash) throw new Error("Saved version did not match the inspected source. Refresh access before continuing.");
          update(index, { saved: true, error: undefined });
          onSaved();
        } catch (error) {
          if (ticket !== generation.current || !available.current) return;
          update(index, { error: error instanceof Error ? error.message : "Save could not be confirmed." });
          setMessage("Saving stopped. Earlier confirmed versions are retained. Retry saves the same inspected content safely; no existing version is removed.");
          return;
        }
      }
      setMessage("Reviewed versions saved. No AI processing or sharing was started.");
    } finally { inFlight.current = false; onBusy(false); }
  }
  const ready = rows.filter(row => row.preview?.canSpend && !row.saved).length;
  return <div style={{ minWidth: 0, flex: "1 1 300px" }}>
    <label>Diagram<input type="file" multiple accept=".puml,.plantuml,.pu,.svg" disabled={disabled || !scopeAvailable} onChange={event => select(event.target.files)} style={{ display: "block", maxWidth: "100%" }} /></label>
    <small>Select one diagram or up to 20 for bulk upload · 1 MB per file</small>
    {scopeAvailable && rows.length > 0 && <section aria-label="Bulk architecture upload" style={{ marginTop: 12 }}>
      <p>{rows.length} diagrams selected. Inspect each file, review its preview, then save the valid versions. Files are saved individually; partial progress is retained.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ActionButton type="button" disabled={disabled || rows.every(row => row.preview)} onClick={() => void inspectAll()} tooltip={<> Inspect selected diagrams </>}> Inspect diagrams </ActionButton>
        <ActionButton type="button" disabled={disabled || !ready} onClick={() => void saveReviewed()} tooltip={<> {ready ? `Save ${ready} reviewed ${ready === 1 ? "version" : "versions"}` : "Save reviewed versions"} </>}>{ready ? `Save (${ready})` : "Save"}</ActionButton>
      </div>
      <ul>{rows.map((row, index) => <li key={index} style={{ marginBlock: 10, overflowWrap: "anywhere" }}>
        <strong>{row.file.name}</strong>{" · "}{row.saved ? "Saved" : row.preview ? `${row.preview.document.elements.length} elements · ready for review` : row.error ? "Could not inspect" : "Not inspected"}
        {row.error && <p role="alert">{row.error}</p>}
        {row.preview && <>
          <small style={{ display: "block" }}>Version {row.preview.document.hash.slice(0, 12)} · {row.preview.document.format}</small>
          {row.preview.document.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
          {row.preview.document.elements.slice(0, 5).map(element => <span key={element.id} style={{ display: "block" }}>{element.kind.toLowerCase()}: {element.label}</span>)}
          {row.preview.document.elements.length > 5 && <small>Open the preview to review all elements.</small>}
          <ActionButton type="button" disabled={disabled} onClick={() => row.source && row.preview && onOpen(row.source, row.preview)} tooltip={<> Open preview for {row.file.name} </>}> Open {row.file.name}</ActionButton>
          {!row.preview.canSpend && <p>Editor access is required to save this version.</p>}
        </>}
      </li>)}</ul>
    </section>}
    {message && <p role="status">{message}</p>}
  </div>;
}
