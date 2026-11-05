"use client";

import type { RouterOutputs } from "@/lib/trpcReact";
import { IconButton } from "./ui/IconButton";
type Tickets = RouterOutputs["jiraConnections"]["releasePlanPreview"]["tickets"];

export function jiraReleaseStrategy(tickets: Tickets) {
  const areas = [...new Set(tickets.flatMap(ticket => ticket.components))].slice(0, 10);
  return `Check acceptance criteria, retest fixes, then smoke-test ${areas.length ? areas.join(", ") : "affected areas"}.`;
}

export function JiraPlanPreview({ tickets, partial, caseIds, disabled, onCases, onChecks }: {
  tickets: Tickets;
  partial: boolean;
  caseIds: string[];
  disabled: boolean;
  onCases: (ids: string[]) => void;
  onChecks: (key: string, checks: string[]) => void;
}) {
  const selected = new Set(caseIds);
  const uncovered = tickets.filter(ticket => !ticket.cases.some(candidate => selected.has(candidate.id)));
  if (!tickets.length) return <p>No visible tickets in this release.</p>;

  return <>
    <p>{tickets.length} tickets · {caseIds.length} cases selected · {uncovered.length} tickets need coverage</p>
    <p>{jiraReleaseStrategy(tickets)}</p>
    {partial && <p>Preview limited to 100 tickets and 2,000 candidate cases.</p>}
    <div style={{ maxHeight: "50vh", overflow: "auto" }}>
      {tickets.map(ticket => <details key={ticket.key} className="workspace-panel" style={{ padding: 8, marginBottom: 6 }}>
        <summary>{ticket.key} · {ticket.title} · {ticket.cases.some(candidate => selected.has(candidate.id)) ? "Cases selected" : ticket.cases.length ? "Review matches" : "Coverage gap"}</summary>
        <p><a href={ticket.url} target="_blank" rel="noreferrer">Open Jira ↗</a>
          {ticket.issueType && ` · ${ticket.issueType}`}
          {ticket.components.length > 0 && ` · ${ticket.components.join(", ")}`}</p>
        <strong>{ticket.fromJira ? "Acceptance checks" : "Draft check"}</strong>
        {ticket.checks.map((check, index) => <textarea key={index} aria-label={`Check ${index + 1} for ${ticket.key}`}
          value={check} maxLength={650} rows={2} disabled={disabled}
          style={{ display: "block", width: "100%", boxSizing: "border-box" }}
          onChange={event => onChecks(ticket.key, ticket.checks.map((value, i) => i === index ? event.target.value : value))}/>)}
        {ticket.cases.map(candidate => <div key={candidate.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label>
            <input type="checkbox" checked={selected.has(candidate.id)} disabled={disabled || !selected.has(candidate.id) && caseIds.length >= 500}
              onChange={event => onCases(event.target.checked ? [...caseIds, candidate.id] : caseIds.filter(id => id !== candidate.id))}/>
            {candidate.title}
          </label>
          <IconButton icon="help" label={`Match details for ${candidate.title}`} tooltip={candidate.matches.join(", ")}/>
        </div>)}
        {ticket.moreCases && <p>Top 5 matches shown. Use Configure cases for more.</p>}
      </details>)}
    </div>
  </>;
}
