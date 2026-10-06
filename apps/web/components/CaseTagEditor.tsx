"use client";

import { useId, useRef, useState } from "react";
import { appendCaseTag, removeCaseTag, reopenLastCaseTag } from "@/lib/case-authoring-fields";

export function CaseTagEditor({ projectId, tags, draft, reopenedOriginal, onTagsChange, onDraftChange, onReopen }: {
  projectId: string; tags: string[]; draft: string;
  reopenedOriginal?: string; onReopen: (original: string | undefined) => void;
  onTagsChange: (tags: string[]) => void; onDraftChange: (draft: string) => void;
}) {
  const prefix = useId();
  const input = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState("");
  function add() {
    const next = appendCaseTag(tags, draft, reopenedOriginal);
    if (next.status === "empty") return;
    onTagsChange(next.tags);
    onDraftChange("");
    onReopen(undefined);
    setAnnouncement(next.status === "added" ? `Added tag ${next.tag}.` : `Tag ${next.tag} is already present.`);
    input.current?.focus();
  }
  return <div>
    <label htmlFor={`${prefix}-input`}>Tags</label>
    <p id={`${prefix}-help`} className="text-muted" style={{ fontSize: 12, marginBlock: 4 }}>
      Press Enter or comma to add a tag. Backspace in an empty input edits the last tag. Chip links find saved cases in a new tab; this draft stays here.
    </p>
    <ul aria-label="Case tag chips" style={{ listStyle: "none", padding: 0, margin: "8px 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
      {tags.map((tag, index) => <li key={`${index}:${tag}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", border: "1px solid var(--line)", borderRadius: 20, padding: "4px 8px", background: "var(--surface-raised)" }}>
        <a href={`/projects/${encodeURIComponent(projectId)}/test-cases?tag=${encodeURIComponent(tag)}`} target="_blank" rel="noopener noreferrer" title={`Find saved cases tagged ${tag}`} style={{ overflowWrap: "anywhere", minWidth: 0 }}>{tag || "Empty retained tag"}</a>
        <button type="button" aria-label={`Remove tag ${tag || "empty retained tag"} at position ${index + 1}`} onClick={() => {
          onTagsChange(removeCaseTag(tags, index));
          setAnnouncement(`Removed tag ${tag || "empty retained tag"}.`);
          input.current?.focus();
        }} style={{ border: 0, background: "transparent", padding: "0 4px", minWidth: 24, minHeight: 24 }}>×</button>
      </li>)}
    </ul>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <input ref={input} id={`${prefix}-input`} aria-describedby={`${prefix}-help`} value={draft} onChange={event => onDraftChange(event.target.value)} placeholder="Add a tag…" style={{ flex: "1 1 180px", minWidth: 0 }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); }
        if (event.key === "Backspace" && draft === "" && tags.length && reopenedOriginal === undefined) {
          event.preventDefault();
          const next = reopenLastCaseTag(tags, draft);
          onTagsChange(next.tags); onDraftChange(next.draft);
          onReopen(next.draft);
          setAnnouncement(`Editing tag ${next.draft}.`);
        }
      }} />
      <button type="button" disabled={!draft.trim() && draft !== reopenedOriginal} onClick={add}>Add tag</button>
    </div>
    <span role="status" className="sr-only">{announcement}</span>
  </div>;
}
