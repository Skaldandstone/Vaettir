"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useState } from "react";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { currentCommentPage } from "@/lib/case-comment-draft";
import { useCaseCommentController } from "@/lib/use-case-comment-controller";

export function CaseComments({ projectId, caseId, active = true }: { projectId: string; caseId: string; active?: boolean }) {
  const [cursor, setCursor] = useState<RouterInputs["caseComments"]["list"]["cursor"]>(undefined);
  const create = trpcReact.caseComments.create.useMutation();
  const control = useCaseCommentController(projectId, caseId, active, create, () => setCursor(undefined));
  const origin = control.reads.origin;
  const binding = JSON.stringify([control.reads.activation, control.readable, cursor]);
  const [cycle, setCycle] = useState({ binding: "", requestId: crypto.randomUUID() });
  if (cycle.binding !== binding) setCycle({ binding, requestId: crypto.randomUUID() });
  const comments = trpcReact.caseComments.list.useQuery({ projectId, caseId, cursor, readRequestId: cycle.requestId, originalOrganizationId: origin?.organizationId ?? "", expectedClerkActorId: origin?.clerkActorId ?? "" }, { enabled: control.readable && active && cycle.binding === binding, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const fresh = currentCommentPage(comments, origin, active && control.readable && cycle.binding === binding, cycle.requestId);
  return <section aria-label="Case comments" style={{ marginTop: 20 }}>
    <h3>Comments</h3>
    {!control.readable ? <div role="status"><p>Checking current access to the original account and workspace. Retained comment drafts were not transferred.</p><ActionButton type="button" onClick={control.reads.refresh} tooltip={<> Recheck comment access </>}> Refresh </ActionButton>{control.reads.query.error && <p role="alert">{control.reads.query.error.message}</p>}</div> : <>
      <details><summary>Details</summary><p className="text-muted">All current project members can comment, including read-only members. Comments do not edit or approve this case.</p></details>
      {control.open ? <>
        <label style={{ display: "block" }}>Add a comment<textarea value={control.pending?.input.body ?? control.draft?.body ?? ""} onChange={event => control.change(event.target.value)} disabled={Boolean(control.pending) || control.settled || control.busy} maxLength={4000} rows={3} style={{ display: "block", width: "100%" }} /></label>
        <ActionButton type="button" onClick={() => void control.submit()} disabled={control.busy || control.settled || (!control.pending && !control.draft?.body.trim())} tooltip={<> {control.busy ? "Posting…" : control.pending ? "Retry same comment" : "Post comment"} </>}>{control.busy ? "Posting…" : control.pending ? "Retry" : "Post comment"}</ActionButton>{" "}<ActionButton type="button" onClick={control.close} tooltip={<> Close and keep draft </>}> Keep draft </ActionButton>
        {control.settled && <p role="status">This original comment was confirmed posted after the view changed. Its draft is retained, but it will not be posted again. <ActionButton type="button" onClick={control.startNew} tooltip={<> Confirm and start a new comment </>}> Confirm </ActionButton></p>}
        {control.pending && !control.busy && <p role="status">The response is uncertain. The exact original body and request identity are retained; retrying confirms that request without adding another.</p>}
      </> : <ActionButton type="button" onClick={control.show} tooltip={<> Open comment draft </>}> Open </ActionButton>}
      {control.notice && <p role="status">{control.notice}</p>}
      {comments.error && <p role="alert">Could not load comments. <ActionButton type="button" onClick={control.reads.refresh} tooltip={<> Refresh current comment access </>}> Refresh </ActionButton></p>}
      {!fresh && !comments.error && <p role="status">Refreshing this comment page and its current reader…</p>}
      {fresh?.items.length === 0 && <p>No comments on this page.</p>}
      {fresh?.items.map(comment => <article key={comment.id} style={{ borderTop: "1px solid var(--line)", paddingBlock: 12 }}><strong>{comment.authorName}{comment.isOwn ? " (you)" : ""}</strong>{" · "}<time dateTime={new Date(comment.createdAt).toISOString()}>{new Date(comment.createdAt).toLocaleString()}</time><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{comment.body}</p></article>)}
      {cursor && <button type="button" disabled={!fresh} onClick={() => { if (control.canRead() && fresh) setCursor(undefined); }}>Newest comments</button>}
      {fresh?.nextCursor && <button type="button" onClick={() => { if (!control.canRead() || !fresh.nextCursor) return; setCursor({ id: fresh.nextCursor.id, createdAt: new Date(fresh.nextCursor.createdAt) }); }}>Older comments</button>}
      <details><summary>Details</summary><p className="text-muted">Drafts and retry receipts stay in this mounted page only. Confirm posting before navigating away or reloading.</p></details>
    </>}
  </section>;
}
