"use client";
import { useState } from "react";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { manualStartDefinitivelyRejected as definitivelyRejected } from "@/lib/manual-run-start";
import { currentCollaborationRead } from "@/lib/case-collaboration-read";

export function CaseComments({ projectId, caseId }: { projectId: string; caseId: string }) {
  const access = useCaseFieldAccess(projectId, caseId);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<{ request: RouterInputs["caseComments"]["create"]; everAmbiguous: boolean } | null>(null);
  const [cursor, setCursor] = useState<RouterInputs["caseComments"]["list"]["cursor"]>(undefined);
  const [error, setError] = useState("");
  const comments = trpcReact.caseComments.list.useQuery({ projectId, caseId, cursor, originalOrganizationId: access.origin?.organizationId ?? "", expectedClerkActorId: access.origin?.clerkActorId ?? "" }, { enabled: access.readable, retry: false });
  const create = trpcReact.caseComments.create.useMutation();
  const fresh = currentCollaborationRead(comments, access.current);
  async function submit() {
    if (!body.trim() && !pending) return;
    const original = access.origin;
    if (!original || !access.owns(original)) return;
    const receipt = pending ?? { request: { projectId, caseId, body: body.trim(), requestId: crypto.randomUUID(), originalOrganizationId: original.organizationId, expectedClerkActorId: original.clerkActorId }, everAmbiguous: false };
    const request = receipt.request;
    setPending(receipt); setError("");
    try {
      const saved = await create.mutateAsync(request);
      if (!access.owns(original)) { setPending({ ...receipt, everAmbiguous: true }); return; }
      if (saved.requestId !== request.requestId) throw new Error("The response did not identify this retained comment. Retry the same request.");
    } catch (cause) {
      if (access.owns(original)) setError(cause instanceof Error ? cause.message : "Comment was not acknowledged. Retry the same comment.");
      setPending(definitivelyRejected(cause, receipt.everAmbiguous) ? null : { ...receipt, everAmbiguous: true });
      return;
    }
    if (!access.owns(original)) return;
    setPending(null); setBody(""); setCursor(undefined);
    try { await comments.refetch(); } catch { if (access.owns(original)) setError("Comment posted, but refreshing the list failed. Refresh comments; do not post again."); }
  }
  if (!access.readable) return <p role="status">Comments require current access to the original account and workspace. Retained drafts were not transferred.</p>;
  return <section aria-label="Case comments" style={{ marginTop: 20 }}>
    <h3>Comments</h3>
    <p className="text-muted">All current project members can comment, including read-only members. Comments do not edit or approve this case.</p>
    <label style={{ display: "block" }}>Add a comment
      <textarea value={pending?.request.body ?? body} onChange={event => setBody(event.target.value)} disabled={Boolean(pending) || create.isPending} maxLength={4000} rows={3} style={{ display: "block", width: "100%" }} />
    </label>
    <button onClick={() => void submit()} disabled={create.isPending || (!pending && !body.trim())}>{create.isPending ? "Posting…" : pending ? "Retry same comment" : "Post comment"}</button>
    {pending && !create.isPending && <p role="status">The response was not confirmed. Your exact comment is retained; retrying cannot add a duplicate.</p>}
    {error && <p role="alert">{error}</p>}
    {comments.error && <p role="alert">Could not load comments. <button onClick={() => void comments.refetch()}>Retry</button></p>}
    {comments.isLoading && <p role="status">Loading comments…</p>}
    {comments.isFetching && !comments.isLoading && <p role="status">Refreshing current comment access…</p>}
    {fresh?.items.length === 0 && <p>No comments on this page.</p>}
    {fresh?.items.map(comment => <article key={comment.id} style={{ borderTop: "1px solid var(--line)", paddingBlock: 12 }}>
      <strong>{comment.authorName}{comment.isOwn ? " (you)" : ""}</strong>{" · "}<time dateTime={new Date(comment.createdAt).toISOString()}>{new Date(comment.createdAt).toLocaleString()}</time>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{comment.body}</p>
    </article>)}
    {cursor && <button onClick={() => setCursor(undefined)}>Newest comments</button>}
    {fresh?.nextCursor && <button onClick={() => { const next = fresh.nextCursor!; setCursor({ id: next.id, createdAt: new Date(next.createdAt) }); }}>Older comments</button>}
  </section>;
}
