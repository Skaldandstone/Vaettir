"use client";

import { useCasePrerequisites } from "@/lib/use-case-prerequisites";
import styles from "./CaseInspector.module.css";

export function TestCasePrerequisites({ projectId, caseId, canEdit, active = true }: { projectId: string; caseId: string; canEdit: boolean; active?: boolean }) {
  const control = useCasePrerequisites(projectId, caseId, active, canEdit);
  const saved = control.freshPage;
  const held = control.pending?.draft ?? control.draft;
  const selected = held?.ids ?? saved?.prerequisiteIds ?? [];
  const metadata = new Map([...(held?.linked ?? []), ...(saved?.linked ?? []), ...(saved?.items ?? [])].map(item => [item.id, item]));
  const dirty = !!held && JSON.stringify([...held.ids].sort()) !== JSON.stringify([...held.baseline].sort());
  const baselineCurrent = !!saved && (!held || held.graphHash === saved.graphHash);
  const editable = canEdit && !!control.freshAccess?.canEdit;
  return <section aria-label="Prerequisite test cases" className={styles.prerequisites}>
    <div className={styles.row}>
      <h3>Execution prerequisites{control.readable && (saved || held) && selected.length ? ` (${selected.length})` : ""}</h3>
      {control.readable && editable && !control.open && <button type="button" className="btn-secondary" onClick={control.show}>Edit prerequisites</button>}
    </div>
    <p className={styles.muted}>Conditions required before this case can run. A linked case requires a prior Pass; it never replaces Given, When, Then or procedure steps.</p>
    {!control.readable ? <div role="status">
      <p>Checking current access to the original account and workspace. Retained drafts and requests remain private and were not transferred to another account or session.</p>
      <button type="button" onClick={control.refresh}>Recheck prerequisite access</button>
      {control.access.error && <p role="alert">{control.access.error.message}</p>}
    </div> : <>
      {!saved && <p role="status">{control.page.error ? "The complete prerequisite page could not be admitted. Saved links were not replaced with an empty list." : "Refreshing the complete saved links and current approved candidate page…"}</p>}
      {control.page.error && <p role="alert">{control.page.error.message} <button type="button" onClick={control.refresh}>Refresh current page</button></p>}
      {saved && !selected.length && <p className={styles.muted}>None set.</p>}
      {(saved || held) && selected.length > 0 && <ul className={styles.selection}>
        {selected.map(id => {
          const item = metadata.get(id);
          const unavailable = !item || item.unavailable;
          const retainedState = unavailable ? "Unavailable retained case" : item.archived ? "Archived retained case" : item.reviewStatus !== "APPROVED" ? `Retained ${item.reviewStatus?.toLowerCase().replaceAll("_", " ") ?? "unknown review state"}` : null;
          return <li key={id}>
            <span>{!unavailable ? <a href={`/projects/${projectId}/test-cases/${id}`}><code className="status-pill">{item.displayId}</code>{" "}{item.title}</a> : <><code className="status-pill">{id}</code> Unavailable case metadata</>}
              {retainedState && <small style={{ display: "block", color: "var(--warning)" }}>{retainedState}. This saved link is retained, not silently approved or removed. It may block a new manual run.</small>}
            </span>
            {control.open && editable && <button type="button" className="btn-secondary" aria-label={`Remove ${item?.displayId ?? id} prerequisite`} disabled={control.busy || !!control.pending || !!control.settled || !baselineCurrent} onClick={() => control.change(selected.filter(value => value !== id))}>Remove</button>}
          </li>;
        })}
      </ul>}
      <div hidden={!control.open}>
        <p className={styles.muted}>New links must be currently approved active cases. Retained old links can be removed explicitly. Changes apply only after you review and save the complete selection.</p>
        <label htmlFor={`prerequisite-${caseId}`}>Find prerequisite cases</label>
        <input id={`prerequisite-${caseId}`} type="search" maxLength={200} value={control.search} placeholder="Search title or case ID" onChange={event => control.setSearch(event.target.value)} disabled={control.busy || !!control.pending} style={{ display: "block", width: "100%" }} />
        <label>Sort prerequisite cases <select aria-label="Sort prerequisite cases" value={control.sort} onChange={event => control.setSort(event.target.value as typeof control.sort)} disabled={control.busy || !!control.pending}>
          <option value="case-id">Case ID</option><option value="title">Title (text order)</option><option value="inventory">Recent activity</option>
        </select></label>
        {saved && <><ul className={styles.matches} aria-label="Available prerequisite cases">
          {saved.items.filter(item => !selected.includes(item.id)).map(item => <li key={item.id}>
            <span><code className="status-pill">{item.displayId}</code>{" "}{item.title}</span>
            <button type="button" className="btn-secondary" aria-label={`Add prerequisite ${item.displayId} ${item.title}`} disabled={control.busy || !!control.pending || !!control.settled || !baselineCurrent || !editable || selected.length >= 50} onClick={() => control.change([...selected, item.id])}>Add</button>
          </li>)}
        </ul><div className={styles.row}>
          <span role="status" className={styles.muted}>{saved.total ? `Page ${Math.floor(saved.offset / 20) + 1} of ${Math.ceil(saved.total / 20)} · ${saved.total} approved candidates in the saved native scope` : "No matching approved candidates."} Locally selected additions remain in your draft above.</span>
          {control.cursors.length > 0 && <button type="button" onClick={control.previous} disabled={control.busy || !!control.pending}>Previous</button>}
          {saved.nextCursor && <button type="button" onClick={control.next} disabled={control.busy || !!control.pending}>Next</button>}
        </div></>}
        {selected.length >= 50 && <p className={styles.muted}>Maximum 50 direct prerequisites. The existing manual-run closure bound is 1,000 cases.</p>}
        {held?.baseline.filter(id => !selected.includes(id)).map(id => <p key={id}>Removed in this unsaved draft: <code>{metadata.get(id)?.displayId ?? id}</code>{" "}<button type="button" disabled={control.busy || !!control.pending || !!control.settled || !baselineCurrent || !editable} onClick={() => control.change([...selected, id])}>Undo removal</button></p>)}
        {held && !baselineCurrent && !control.pending && <p role="alert">Saved graph data changed or is unavailable. Your draft is retained; explicitly discard it before reviewing a new baseline.</p>}
        {control.pending && <p role="status">Request <code>{control.pending.input.requestId}</code> retains its exact original native account, workspace and complete link set. An uncertain response is not proof that the write failed. Retry the same request to recover its receipt.</p>}
        {control.settled && <p role="status">The original request was confirmed after this view changed. It will not be sent again. Confirm and discard its retained draft to start a new edit.</p>}
        <div className={styles.row}>
          <button type="button" className="btn-secondary" onClick={control.close}>Close and keep draft</button>
          {held && <button type="button" className="btn-secondary" disabled={control.busy || !!control.pending || !editable} onClick={control.discard}>Discard retained draft</button>}
          <button type="button" className="btn-primary" disabled={control.busy || !editable || !!control.settled || (!control.pending && (!dirty || !baselineCurrent))} onClick={() => void control.submit()}>{control.busy ? "Saving…" : control.pending ? "Retry same prerequisite request" : "Review and save prerequisites"}</button>
        </div>
      </div>
      {control.notice && <p role="status">{control.notice} Your draft remains retained unless its exact request was confirmed or you discarded it.</p>}
      <p className={styles.muted}>Drafts and receipts survive only while this inspector stays mounted. Reload recovery and adoption of a renewed session are separate, unsupported recovery paths here.</p>
    </>}
  </section>;
}
