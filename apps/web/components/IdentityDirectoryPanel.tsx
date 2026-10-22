"use client";
import { useId, useState } from "react";
import type { IdentityScope } from "@vaettir/core";
import { Modal } from "./Modal";
import { ReadableSelect } from "./ui/ReadableSelect";
import { Icon } from "./ui/Workspace";
import styles from "./IdentityAccessEditor.module.css";

type Mapping = { externalGroupId: string; roleId: string; scope: IdentityScope };
export type DirectoryView = { id: string; providerConnectionId: string; enabled: boolean; revision: number; mappings: Mapping[];
  groups: string[]; observedMembers: number; activeMembers: number; staleMembers: number; lastObservedAt: string | null };
type Catalog = { connections: DirectoryView[]; roles: { id: string; name: string }[] };
type Props = { initial: Catalog; projects: { id: string; name: string }[];
  reload: () => Promise<Catalog>; update: (connectionId: string, revision: number, change: { kind: "mappings"; mappings: Mapping[] } | { kind: "disable" }) => Promise<unknown> };

export function IdentityDirectoryPanel({ initial, projects, reload, update }: Props) {
  const [data, setData] = useState(initial), [editing, setEditing] = useState<DirectoryView | null>(null);
  const [disable, setDisable] = useState<DirectoryView | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [uncertain, setUncertain] = useState(false);
  async function refresh() {
    setBusy(true); setError("");
    try { setData(await reload()); setUncertain(false); setEditing(null); setDisable(null); }
    catch { setError("Could not reload directory status. Try again."); }
    finally { setBusy(false); }
  }
  async function save(connection: DirectoryView, change: Parameters<Props["update"]>[2]) {
    setBusy(true); setError(""); setNotice("");
    try {
      await update(connection.id, connection.revision, change); setData(await reload()); setEditing(null); setDisable(null);
      setNotice(change.kind === "disable" ? "Directory access disabled. Local memberships are unchanged." : "Mappings saved. A fresh provider sync is required before directory access resumes.");
    } catch { setError("The update could not be confirmed. Reload before retrying; current access is not inferred from this screen."); setUncertain(true); }
    finally { setBusy(false); }
  }
  return <section aria-label="Directory access" className={styles.directory}>
    <div className={styles.toolbar}><div><h2>Directory</h2><p className={styles.hint}>Map external groups to published roles.</p></div>
      <button type="button" className="btn-secondary" title="Reload directory status" disabled={busy} onClick={refresh}>Reload</button></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.hint}>{notice}</p>}
    {!data.connections.length ? <div className={styles.empty}><Icon name="people" size={24}/><h3>No directory connected</h3><p>Complete SSO and directory setup first. Existing access is unchanged.</p></div> :
      <div className={styles.list}>{data.connections.map(connection => <article className={styles.directoryRow} key={connection.id}>
        <div className={styles.previewHeading}><h3>{connection.providerConnectionId}</h3><span className={styles.status}>{!connection.enabled ? "Disabled" : connection.staleMembers ? "Sync needed" : "Observations current"}</span></div>
        <p className={styles.hint}>{connection.activeMembers} active · {connection.staleMembers} awaiting sync · {connection.mappings.length} mappings</p>
        <details><summary>Mappings and sync details</summary><p className={styles.hint}>Last observation: {connection.lastObservedAt ? new Date(connection.lastObservedAt).toLocaleString() : "Not yet synced"}</p>
          {connection.mappings.length ? <ul>{connection.mappings.map((mapping, index) => <li key={index}>{mapping.externalGroupId} → {data.roles.find(role => role.id === mapping.roleId)?.name ?? "Role unavailable"} · {mapping.scope.kind === "workspace" ? "Workspace" : `${mapping.scope.projectIds.length} selected projects`}</li>)}</ul> : <p>No group rules.</p>}</details>
        <div className={styles.dialogActions}><button type="button" className="btn-secondary" disabled={busy || uncertain || !data.roles.length} onClick={() => setEditing(connection)}>Edit mappings</button>
          <button type="button" className="btn-secondary" disabled={busy || uncertain || !connection.enabled} onClick={() => setDisable(connection)}>Disable access</button></div>
      </article>)}</div>}
    {editing && <MappingDialog connection={editing} roles={data.roles} projects={projects} busy={busy} uncertain={uncertain} error={error}
      onClose={() => setEditing(null)} onSave={mappings => save(editing, { kind: "mappings", mappings })} onReload={refresh}/>}
    <Modal open={!!disable} onClose={() => setDisable(null)} title="Disable directory access?" dismissible={!busy}>
      <p>Withdraw this directory’s access. Independent local memberships and other directories remain unchanged.</p>
      {error && <p role="alert">{error}</p>}
      <div className={styles.dialogActions}><button type="button" disabled={busy} onClick={() => setDisable(null)}>Cancel</button>
        {uncertain ? <button type="button" disabled={busy} onClick={refresh}>Reload status</button> : <button type="button" disabled={busy} onClick={() => disable && save(disable, { kind: "disable" })}>Disable access</button>}</div>
    </Modal>
  </section>;
}

function MappingDialog({ connection, roles, projects, busy, uncertain, error, onClose, onSave, onReload }: {
  connection: DirectoryView; roles: Catalog["roles"]; projects: Props["projects"]; busy: boolean; uncertain: boolean; error: string;
  onClose: () => void; onSave: (mappings: Mapping[]) => void; onReload: () => void;
}) {
  const [mappings, setMappings] = useState(connection.mappings), [group, setGroup] = useState(""), [role, setRole] = useState("");
  const [scope, setScope] = useState<"projects" | "workspace">("projects"), [selected, setSelected] = useState<string[]>([]), [validation, setValidation] = useState("");
  const labelId = useId();
  function add() {
    if (mappings.length >= 250) { setValidation("This connection already has 250 mappings. Remove a mapping before adding another."); return; }
    if (!group || !role || (scope === "projects" && !selected.length)) { setValidation("Choose a group, role and project scope."); return; }
    if (mappings.some(mapping => mapping.externalGroupId === group && mapping.roleId === role)) { setValidation("That group and role are already mapped."); return; }
    setMappings([...mappings, { externalGroupId: group, roleId: role, scope: scope === "workspace" ? { kind: "workspace" } : { kind: "projects", projectIds: selected } }]); setValidation("");
  }
  return <Modal open onClose={onClose} title="External group mappings" dismissible={!busy}>
    <fieldset disabled={busy || uncertain} className={styles.controls}><div className={styles.form}>
      <div><label htmlFor={`${labelId}-group`}>External group</label><ReadableSelect id={`${labelId}-group`} value={group} onChange={event => setGroup(event.target.value)}><option value="">Choose synced group</option>{connection.groups.map(id => <option key={id} value={id}>{id}</option>)}</ReadableSelect></div>
      <div><label htmlFor={`${labelId}-role`}>Published role</label><ReadableSelect id={`${labelId}-role`} value={role} onChange={event => setRole(event.target.value)}><option value="">Choose role</option>{roles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</ReadableSelect></div>
      <div><label htmlFor={`${labelId}-scope`}>Scope</label><ReadableSelect id={`${labelId}-scope`} value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="projects">Selected projects</option><option value="workspace">Entire workspace</option></ReadableSelect></div>
      {scope === "projects" && <fieldset><legend>Projects</legend><div className={styles.choices}>{projects.map(project => <label key={project.id}><input type="checkbox" checked={selected.includes(project.id)} onChange={() => setSelected(selected.includes(project.id) ? selected.filter(id => id !== project.id) : [...selected, project.id])}/>{project.name}</label>)}</div></fieldset>}
      <button type="button" className="btn-secondary" onClick={add}>Add mapping</button>
      <div className={styles.list}>{mappings.map((mapping, index) => <div className={styles.row} key={`${mapping.externalGroupId}:${mapping.roleId}`}><span>{mapping.externalGroupId} → {roles.find(item => item.id === mapping.roleId)?.name ?? "Role unavailable"}</span><button type="button" className="btn-secondary" aria-label={`Remove mapping ${index + 1}`} title="Remove mapping" onClick={() => setMappings(mappings.filter((_, i) => i !== index))}><Icon name="close" size={14}/></button></div>)}</div>
    </div></fieldset>
    {(validation || error) && <p role="alert">{validation || error}</p>}
    <p className={styles.hint}>Saving withdraws the old directory rules until a fresh provider sync. Local access is unchanged.</p>
    <div className={styles.dialogActions}><button type="button" disabled={busy} onClick={onClose}>Cancel</button>{uncertain ? <button type="button" disabled={busy} onClick={onReload}>Reload status</button> : <button type="button" disabled={busy} onClick={() => onSave(mappings)}>Save mappings</button>}</div>
  </Modal>;
}
