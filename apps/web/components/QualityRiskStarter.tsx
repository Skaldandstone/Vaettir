"use client";
import { useState } from "react";
import { qualityRiskStarters, type QualityRiskStarterId } from "@/lib/quality-risk-starters";

export function QualityRiskStarter({ eligible, applied, screen, onApply }: {
  eligible: boolean; applied: QualityRiskStarterId | null; screen: number;
  onApply: (id: QualityRiskStarterId, reviewed: boolean) => void;
}) {
  const [choice, setChoice] = useState<QualityRiskStarterId | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const selected = qualityRiskStarters.find(starter => starter.id === choice);
  const guide = qualityRiskStarters.find(starter => starter.id === applied);
  const field = { width: "100%", minWidth: 0, boxSizing: "border-box" as const };
  return <section aria-label="Optional risk starter" style={{ marginBlock: 12 }}>
    {guide ? <details open>
      <summary>{guide.label}: prompts for this step</summary>
      <ul>{(guide.prompts[screen] ?? []).map(prompt => <li key={prompt}>{prompt}</li>)}</ul>
      <p className="text-muted">Guidance only. No factual fields, categories, links or human decisions were filled or persisted.</p>
      <details><summary>Public references and limitations</summary>
        <p>These references explain public concepts. They do not qualify your project, define its acceptance thresholds or grant proprietary platform standards.</p>
        <ul>{guide.references.map(reference => <li key={reference.url}><a href={reference.url} target="_blank" rel="noopener noreferrer">{reference.label}</a></li>)}</ul>
      </details>
    </details> : screen === 0 ? <details>
      <summary>Optional guided starter</summary>
      <p>Choose a domain to review prompts before entering your own facts. This does not create an assessed risk or prescribe a score.</p>
      <label style={{ display: "grid", gap: 6, minWidth: 0 }}>Workflow
        <select style={field} value={choice} disabled={!eligible} onChange={event => { setChoice(event.target.value as QualityRiskStarterId | ""); setConfirmed(false); }}>
          <option value="">Choose a starter…</option>
          {qualityRiskStarters.map(starter => <option key={starter.id} value={starter.id}>{starter.label}</option>)}
        </select>
      </label>
      {selected && <><p>{selected.description}</p><ul>{selected.prompts[0].map(prompt => <li key={prompt}>{prompt}</li>)}</ul>
        <label style={{ display: "flex", gap: 8, alignItems: "start", marginBlock: 12 }}>
          <input type="checkbox" disabled={!eligible} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
          I reviewed these prompts. All facts and qualitative categories remain my responsibility; this is not a qualified approval.
        </label>
        <button type="button" className="btn-secondary" disabled={!eligible || !confirmed} onClick={() => {
          if (eligible && confirmed) onApply(selected.id, confirmed);
        }}>Use reviewed prompts</button>
      </>}
      {!eligible && <p role="status">Starters apply only to an untouched new local draft with no human text, links, assessment or pending change. Existing content will not be replaced.</p>}
    </details> : null}
  </section>;
}
