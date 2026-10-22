"use client";

import { useEffect, useRef, useState } from "react";
import { IDENTITY_PERMISSIONS, IDENTITY_PERMISSION_LABELS, identityConfigurationSchema,
  identityRoleDraftSchema, identityGroupDraftSchema, type IdentityConfiguration } from "@vaettir/core";
import { Modal } from "./Modal";
import { Icon } from "./ui/Workspace";
import styles from "./IdentityAccessEditor.module.css";

type Role = IdentityConfiguration["roles"][number];
type Group = IdentityConfiguration["groups"][number];
type Member = { id: string; name: string | null; email: string };
type Project = { id: string; name: string };
export type AccessDraftView = { revision: number; configuration: IdentityConfiguration; members: Member[]; projects: Project[] };
type Props = { initial: AccessDraftView; onSave: (configuration: IdentityConfiguration, revision: number) => Promise<{ revision: number }>; onReload: () => Promise<AccessDraftView> };

function toggle(values: string[], id: string) { return values.includes(id) ? values.filter(value => value !== id) : [...values, id]; }
function replaceItem<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some(current => current.id === item.id) ? items.map(current => current.id === item.id ? item : current) : [...items, item];
}
function EditButton({ name, onClick }: { name: string; onClick: () => void }) {
  return <button type="button" className="btn-secondary" aria-label={`Edit ${name}`} title={`Edit ${name}`} onClick={onClick}><Icon name="edit" size={16} /></button>;
}

export function IdentityAccessEditor({ initial, onSave, onReload }: Props) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial.configuration);
  const [section, setSection] = useState<"roles" | "groups" | "sign-in">("roles");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadOpen, setReloadOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const leaveAccepted = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.configuration);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { if (!leaveAccepted.current) { event.preventDefault(); event.returnValue = ""; } };
    const guardLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const target = new URL(anchor.href);
      if (target.origin !== location.origin || target.pathname + target.search === location.pathname + location.search) return;
      event.preventDefault(); event.stopPropagation(); setPendingNavigation(anchor.href);
    };
    window.addEventListener("beforeunload", guard);
    document.addEventListener("click", guardLink, true);
    return () => { window.removeEventListener("beforeunload", guard); document.removeEventListener("click", guardLink, true); };
  }, [dirty]);
  const match = (name: string) => name.toLowerCase().includes(search.toLowerCase());
  function apply(next: IdentityConfiguration) {
    const result = identityConfigurationSchema.safeParse(next);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Review your selections."); return false; }
    setDraft(result.data); setError(""); setNotice(""); return true;
  }
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await onSave(draft, saved.revision);
      setSaved({ ...saved, revision: result.revision, configuration: draft });
      setNotice("Draft saved. Active access is unchanged.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save. Your changes are still here."); }
    finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError("");
    try { const current = await onReload(); setSaved(current); setDraft(current.configuration); setReloadOpen(false); setNotice("Loaded the saved draft."); }
    catch { setError("Could not reload. Your changes are still here."); }
    finally { setBusy(false); }
  }
  return <div className={styles.editor}>
    <header className={styles.header}><div><span className={styles.eyebrow}>Workspace settings</span><h1>Access</h1><p>Sign-in, roles and groups.</p></div><span className={styles.status}>Setup draft</span></header>
    <div className={styles.banner}><Icon name="alert" /><span>Prepare access rules here. Existing permissions stay in effect until activation is verified.</span></div>
    {error && <div role="alert" className={styles.error}>{error} <button type="button" onClick={() => setReloadOpen(true)} disabled={busy}>Reload saved version</button></div>}
    {notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy} className={styles.controls}>
      <nav className={styles.tabs} aria-label="Access sections">{([ ["roles", "Roles", "settings"], ["groups", "Groups", "people"], ["sign-in", "Sign-in & directory", "link"] ] as const).map(([id, label, icon]) =>
        <button key={id} type="button" aria-pressed={section === id} onClick={() => { setSection(id); setSearch(""); }}><Icon name={icon} size={16} />{label}</button>)}</nav>
      {section !== "sign-in" && <div className={styles.toolbar}><label className={styles.search}><Icon name="search" size={16} /><input aria-label={`Search ${section}`} placeholder={`Search ${section}`} value={search} onChange={event => setSearch(event.target.value)} /></label>
        <button className="btn-secondary" type="button" disabled={section === "groups" && !draft.roles.length} title={section === "groups" && !draft.roles.length ? "Create a role first" : undefined} onClick={() => section === "roles"
          ? setRole({ id: crypto.randomUUID(), name: "", permissions: [] })
          : setGroup({ id: crypto.randomUUID(), name: "", userIds: [], roleIds: [], scope: { kind: "workspace" } })}><Icon name="plus" size={16} />{section === "roles" ? "New role" : "New group"}</button></div>}
      {section === "roles" && <section aria-label="Custom roles" className={styles.list}>
        {!draft.roles.length && <div className={styles.empty}><Icon name="settings" size={28} /><h2>Define a focused role</h2><p>Choose exactly what a team can view or change.</p></div>}
        {draft.roles.length > 0 && !draft.roles.some(item => match(item.name)) && <p>No roles match your search.</p>}
        {draft.roles.filter(item => match(item.name)).map(item => <article className={styles.row} key={item.id}><details><summary>{item.name}<span>{item.permissions.length} permissions</span></summary><ul className={styles.permissionList}>{item.permissions.map(permission => <li key={permission}>{IDENTITY_PERMISSION_LABELS[permission]}</li>)}</ul></details><EditButton name={item.name} onClick={() => setRole(item)} /></article>)}
      </section>}
      {section === "groups" && <section aria-label="Custom groups" className={styles.list}>
        {!draft.groups.length && <div className={styles.empty}><Icon name="people" size={28} /><h2>Organize access by team</h2><p>{draft.roles.length ? "Add members, a role and project scope." : "Create a role, then assign it to a group."}</p></div>}
        {draft.groups.length > 0 && !draft.groups.some(item => match(item.name)) && <p>No groups match your search.</p>}
        {draft.groups.filter(item => match(item.name)).map(item => <article className={styles.row} key={item.id}><details><summary>{item.name}<span>{item.userIds.length} members · {item.scope.kind === "workspace" ? "All projects" : `${item.scope.projectIds.length} projects`}</span></summary><p>{item.roleIds.map(id => draft.roles.find(candidate => candidate.id === id)?.name ?? "Missing role").join(", ")}</p><ul>{item.userIds.map(id => <li key={id}>{saved.members.find(member => member.id === id)?.email ?? "Member no longer available"}</li>)}</ul></details><EditButton name={item.name} onClick={() => setGroup(item)} /></article>)}
      </section>}
      {section === "sign-in" && <section className={styles.setup} aria-label="Identity setup status">
        <div><Icon name="link" size={24} /><h2>Single sign-on</h2><span className={styles.status}>Setup pending</span><p>SAML or OpenID Connect through your identity provider.</p></div>
        <div><Icon name="people" size={24} /><h2>Directory sync</h2><span className={styles.status}>Setup pending</span><p>Provision members and map external groups to Vaettir roles.</p></div>
        <p className={styles.setupNote}>Provider setup and activation are not available in this preparation build. No sign-in enforcement or automatic access changes are enabled.</p>
      </section>}
      <footer className={styles.footer}><span>{dirty ? "Unsaved changes" : `Saved revision ${saved.revision}`}</span><button type="button" className="btn-secondary" onClick={() => setReloadOpen(true)}>Reload</button><button className="btn-primary" type="button" disabled={!dirty} onClick={save}><Icon name="save" size={16} />Save draft</button></footer>
    </fieldset>
    {busy && <p role="status">Saving or loading access settings…</p>}
    {role && <RoleDialog role={role} onClose={() => setRole(null)} onApply={next => {
      const success = apply({ ...draft, roles: replaceItem(draft.roles, next) });
      if (success) setRole(null); return success;
    }} />}
    {group && <GroupDialog group={group} roles={draft.roles} members={saved.members} projects={saved.projects} onClose={() => setGroup(null)} onApply={next => {
      const success = apply({ ...draft, groups: replaceItem(draft.groups, next) });
      if (success) setGroup(null); return success;
    }} />}
    <Modal open={reloadOpen} onClose={() => setReloadOpen(false)} title="Reload access settings?" dismissible={!busy}><p>{dirty ? "This replaces your unsaved changes with the saved draft." : "Get the latest saved draft."}</p><div className={styles.dialogActions}><button type="button" className="btn-secondary" disabled={busy} onClick={() => setReloadOpen(false)}>Keep editing</button><button type="button" disabled={busy} onClick={reload}>Reload</button></div></Modal>
    <Modal open={!!pendingNavigation} onClose={() => setPendingNavigation(null)} title="Leave unsaved changes?"><p>Save your draft before leaving to keep these changes.</p><div className={styles.dialogActions}><button className="btn-secondary" onClick={() => setPendingNavigation(null)}>Keep editing</button><button className="btn-primary" onClick={() => { if (pendingNavigation) { leaveAccepted.current = true; location.assign(pendingNavigation); } }}>Leave without saving</button></div></Modal>
  </div>;
}

function RoleDialog({ role, onClose, onApply }: { role: Role; onClose: () => void; onApply: (value: Role) => boolean }) {
  const [value, setValue] = useState(role); const [error, setError] = useState("");
  return <Modal open onClose={onClose} title={role.name ? "Edit role" : "New role"}><form className={styles.form} onSubmit={event => { event.preventDefault(); const result = identityRoleDraftSchema.safeParse(value); if (result.success) { if (!onApply(result.data)) setError("Choose a unique role name."); } else setError(result.error.issues[0]?.message ?? "Review this role."); }}>
    <label>Role name<input required maxLength={100} autoFocus value={value.name} onChange={event => setValue({ ...value, name: event.target.value })} /></label>
    <fieldset><legend>Permissions</legend><div className={styles.choices}>{IDENTITY_PERMISSIONS.map(permission => <label key={permission}><input type="checkbox" checked={value.permissions.includes(permission)} onChange={() => setValue({ ...value, permissions: toggle(value.permissions, permission) as Role["permissions"] })} />{IDENTITY_PERMISSION_LABELS[permission]}</label>)}</div></fieldset>
    <p className={styles.hint}>Billing, workspace ownership and access administration are not custom permissions.</p>{error && <p role="alert">{error}</p>}
    <div className={styles.dialogActions}><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" type="submit">Apply to draft</button></div>
  </form></Modal>;
}

function GroupDialog({ group, roles, members, projects, onClose, onApply }: { group: Group; roles: Role[]; members: Member[]; projects: Project[]; onClose: () => void; onApply: (value: Group) => boolean }) {
  const [value, setValue] = useState(group); const [search, setSearch] = useState(""); const [error, setError] = useState("");
  return <Modal open onClose={onClose} title={group.name ? "Edit group" : "New group"} size="wide"><form className={styles.form} onSubmit={event => { event.preventDefault(); const result = identityGroupDraftSchema.safeParse(value); if (result.success) { if (!onApply(result.data)) setError("Choose a unique group name and valid roles."); } else setError(result.error.issues[0]?.message ?? "Review this group."); }}>
    <label>Group name<input required maxLength={100} autoFocus value={value.name} onChange={event => setValue({ ...value, name: event.target.value })} /></label>
    <fieldset><legend>Roles</legend><div className={styles.choices}>{roles.map(role => <label key={role.id}><input type="checkbox" checked={value.roleIds.includes(role.id)} onChange={() => setValue({ ...value, roleIds: toggle(value.roleIds, role.id) })} />{role.name}</label>)}</div></fieldset>
    <fieldset><legend>Project scope</legend><label className={styles.inline}><input type="radio" name="scope" checked={value.scope.kind === "workspace"} onChange={() => setValue({ ...value, scope: { kind: "workspace" } })} />All workspace projects</label><label className={styles.inline}><input type="radio" name="scope" checked={value.scope.kind === "projects"} onChange={() => setValue({ ...value, scope: { kind: "projects", projectIds: [] } })} />Selected projects</label>
      {value.scope.kind === "projects" && <div className={styles.choices}>{projects.map(project => <label key={project.id}><input type="checkbox" checked={value.scope.kind === "projects" && value.scope.projectIds.includes(project.id)} onChange={() => setValue({ ...value, scope: { kind: "projects", projectIds: toggle(value.scope.kind === "projects" ? value.scope.projectIds : [], project.id) } })} />{project.name}</label>)}{!projects.length && <p>No projects available.</p>}</div>}
    </fieldset>
    <fieldset><legend>Members · {value.userIds.length} selected</legend><input aria-label="Search workspace members" placeholder="Search members" value={search} onChange={event => setSearch(event.target.value)} /><div className={styles.memberChoices}>{members.filter(member => `${member.name ?? ""} ${member.email}`.toLowerCase().includes(search.toLowerCase())).map(member => <label key={member.id}><input type="checkbox" checked={value.userIds.includes(member.id)} onChange={() => setValue({ ...value, userIds: toggle(value.userIds, member.id) })} /><span>{member.name || member.email}<small>{member.name ? member.email : ""}</small></span></label>)}</div></fieldset>
    {value.userIds.filter(id => !members.some(member => member.id === id)).map(id => <label className={styles.inline} key={id}><input type="checkbox" checked onChange={() => setValue({ ...value, userIds: value.userIds.filter(memberId => memberId !== id) })} />Unavailable member. Uncheck to remove from draft.</label>)}
    {value.scope.kind === "projects" && value.scope.projectIds.filter(id => !projects.some(project => project.id === id)).map(id => <label className={styles.inline} key={id}><input type="checkbox" checked onChange={() => setValue({ ...value, scope: { kind: "projects", projectIds: value.scope.kind === "projects" ? value.scope.projectIds.filter(projectId => projectId !== id) : [] } })} />Unavailable project. Uncheck to remove from draft.</label>)}
    {error && <p role="alert">{error}</p>}<div className={styles.dialogActions}><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" type="submit">Apply to draft</button></div>
  </form></Modal>;
}
