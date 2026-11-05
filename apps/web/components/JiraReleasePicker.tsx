"use client";

import { useState } from "react";
import { trpcReact } from "@/lib/trpcReact";

export function JiraReleasePicker({ projectId, disabled, onSelect }: {
  projectId: string;
  disabled: boolean;
  onSelect: (releaseName: string) => void;
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

  if (!sources.length && !open) return null;
  return <div style={{ display: "grid", gap: 8, marginBottom: 10, justifyItems: "start" }}>
    <button type="button" className="btn-secondary" disabled={disabled} aria-expanded={open}
      onClick={() => setOpen(!open)}>Jira releases</button>
    {open && <>
      {connections.isFetching ? <p role="status">Checking Jira access…</p>
        : !sources.length ? <p role="status">No approved Jira projects. <a href={`/projects/${encodeURIComponent(projectId)}/settings/integrations#atlassian-quality`}>Manage access</a></p>
        : <label>Jira project <select value={selected?.key ?? ""} disabled={disabled} onChange={event => setSourceKey(event.target.value)}>
          <option value="" disabled>Choose project</option>
          {sources.map(source => <option key={source.key} value={source.key}>{source.project.name} ({source.project.key}) · {source.site}</option>)}
        </select></label>}
      {selected && <ReleaseList key={selected.key} projectId={projectId} connectionId={selected.id}
        jiraProjectId={selected.project.id} disabled={disabled}
        onSelect={name => { onSelect(name); setOpen(false); }}/>}
    </>}
  </div>;
}

function ReleaseList({ projectId, connectionId, jiraProjectId, disabled, onSelect }: {
  projectId: string;
  connectionId: string;
  jiraProjectId: string;
  disabled: boolean;
  onSelect: (releaseName: string) => void;
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
  return <>
    {versions.length ? <label>Release <select value="" disabled={disabled} onChange={event => {
      const version = versions.find(candidate => candidate.id === event.target.value);
      if (version) onSelect(version.name);
    }}>
      <option value="" disabled>Choose release</option>
      {versions.map(version => <option value={version.id} key={version.id}>
        {version.name} · {version.archived ? "Archived" : version.released ? "Released" : "Unreleased"}{version.releaseDate ? ` · ${version.releaseDate}` : ""}
      </option>)}
    </select></label> : <p role="status">No Jira releases found.</p>}
    {(offsets.length > 0 || next !== null) && <div style={{ display: "flex", gap: 8 }}>
      <button type="button" className="btn-secondary" disabled={disabled || !offsets.length} onClick={() => setOffsets(offsets.slice(0, -1))}>Previous</button>
      <button type="button" className="btn-secondary" disabled={disabled || next === null} onClick={() => { if (next !== null) setOffsets([...offsets, next]); }}>Next</button>
    </div>}
  </>;
}
