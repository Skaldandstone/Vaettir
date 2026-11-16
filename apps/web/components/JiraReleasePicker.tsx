"use client";

import { useState } from "react";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";

type JiraRelease = RouterOutputs["jiraConnections"]["releases"]["releases"][number];
export type JiraReleaseSelection = JiraRelease & { connectionId: string; jiraProjectId: string };

export function JiraReleasePicker({ projectId, disabled, showUnavailable = false, onSelect }: {
  projectId: string;
  disabled: boolean;
  showUnavailable?: boolean;
  onSelect?: (release: JiraReleaseSelection) => void;
}) {
  const connections = trpcReact.jiraConnections.mine.useQuery({ projectId }, { retry: false });
  const [open, setOpen] = useState(false);
  const [sourceKey, setSourceKey] = useState("");
  const sources = connections.isSuccess && !connections.isFetching && !connections.isPaused
    ? connections.data.filter(connection => connection.status === "VERIFIED").flatMap(connection =>
      connection.approvedProjects.map(project => ({
        key: `${connection.id}:${project.id}`, id: connection.id, project, site: connection.siteUrl,
      })),
    )
    : [];
  const selected = sources.find(source => source.key === sourceKey) ?? (sources.length === 1 ? sources[0] : undefined);

  if (!sources.length && !open && !showUnavailable) return null;
  return <div style={{ display: "grid", gap: 8, marginBottom: 10, justifyItems: "start" }}>
    <button type="button" className="btn-secondary" disabled={disabled} aria-expanded={open}
      onClick={() => setOpen(!open)}>Jira releases</button>
    {open && <>
      {connections.isFetching ? <p role="status">Checking Jira access…</p>
        : connections.isError ? <p role="alert">Could not check Jira access.{" "}
          <button type="button" className="btn-secondary" disabled={disabled} onClick={() => void connections.refetch()}>Retry</button></p>
        : !sources.length ? <p role="status">No approved Jira projects. <a href={`/projects/${encodeURIComponent(projectId)}/settings/integrations#atlassian-quality`}>Manage access</a></p>
        : <label>Jira project <select value={selected?.key ?? ""} disabled={disabled} onChange={event => setSourceKey(event.target.value)}>
          <option value="" disabled>Choose project</option>
          {sources.map(source => <option key={source.key} value={source.key}>{source.project.name} ({source.project.key}) · {source.site}</option>)}
        </select></label>}
      {selected && <ReleaseList key={selected.key} projectId={projectId} connectionId={selected.id}
        jiraProjectId={selected.project.id} disabled={disabled}
        onSelect={onSelect && (release => { onSelect(release); setOpen(false); })}/>}
    </>}
  </div>;
}

function ReleaseList({ projectId, connectionId, jiraProjectId, disabled, onSelect }: {
  projectId: string;
  connectionId: string;
  jiraProjectId: string;
  disabled: boolean;
  onSelect?: (release: JiraReleaseSelection) => void;
}) {
  const [offsets, setOffsets] = useState<number[]>([]);
  const releases = trpcReact.jiraConnections.releases.useQuery({
    projectId, id: connectionId, jiraProjectId, after: offsets.at(-1) ?? null,
  }, { retry: false, enabled: !disabled });
  if (releases.isError) return <p role="alert">Could not load Jira releases.{" "}
    <button type="button" className="btn-secondary" disabled={disabled} onClick={() => void releases.refetch()}>Retry</button>
  </p>;
  if (!releases.isSuccess || releases.isFetching || releases.isPaused) return <p role="status">Loading Jira releases…</p>;
  const { releases: versions, next } = releases.data;
  function label(version: JiraRelease) {
    const status = version.archived ? "Archived" : version.released ? "Released" : "Unreleased";
    return [version.name, status, version.releaseDate].filter(Boolean).join(" · ");
  }
  return <>
    {!versions.length ? <p role="status">No Jira releases found.</p> : onSelect ? <label>Release <select value="" disabled={disabled} onChange={event => {
      const version = versions.find(candidate => candidate.id === event.target.value);
      if (version) onSelect({ ...version, connectionId, jiraProjectId });
    }}>
      <option value="" disabled>Choose release</option>
      {versions.map(version => <option value={version.id} key={version.id}>
        {label(version)}
      </option>)}
    </select></label> : <ul>{versions.map(version => <li key={version.id}>{label(version)}</li>)}</ul>}
    {(offsets.length > 0 || next !== null) && <div style={{ display: "flex", gap: 8 }}>
      <button type="button" className="btn-secondary" disabled={disabled || !offsets.length} onClick={() => setOffsets(offsets.slice(0, -1))}>Previous</button>
      <button type="button" className="btn-secondary" disabled={disabled || next === null} onClick={() => { if (next !== null) setOffsets([...offsets, next]); }}>Next</button>
    </div>}
  </>;
}
