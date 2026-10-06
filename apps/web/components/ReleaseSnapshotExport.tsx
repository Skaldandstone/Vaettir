"use client";
import { useLayoutEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpcReact } from "@/lib/trpcReact";
import { currentSessionScope, sameAuthScope } from "@/lib/auth-query-cache";
import { admitRunHistoryAccess, RunHistoryRenderGuard, sameRunHistoryOrigin, type RunHistoryOrigin } from "@/lib/run-history-reader";
import { buildHtmlSnapshot, buildMarkdownSnapshot } from "@/lib/snapshotExport";
import { downloadFile } from "@/lib/download";

type Session = NonNullable<ReturnType<typeof currentSessionScope>>;
type Stamp = ReturnType<RunHistoryRenderGuard["observe"]>;
type Frame = Readonly<{ projectId: string; releaseId: string; organizationId: string; session: Session | null; eligible: boolean }>;
type Capture = { key: QueryKey; data: unknown; revision: number };
type Attempt = { frame: Frame; stamp: Stamp; activation: string; captures: Capture[]; handedOff: boolean };
type Display = { frame: Frame; stamp: Stamp; attempt: Attempt | null; format: "html" | "markdown" | null; notice: string | null };
function sdkSession() {
  return typeof window === "undefined" ? null : currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null);
}
function captureQuery(client: QueryClient, key: QueryKey): Capture | null {
  const state = client.getQueryState(key);
  return state?.status === "success" && state.fetchStatus === "idle"
    ? { key, data: state.data, revision: state.dataUpdatedAt } : null;
}
function captureCurrent(client: QueryClient, capture: Capture) {
  const state = client.getQueryState(capture.key);
  return state?.status === "success" && state.fetchStatus === "idle" && state.data === capture.data && state.dataUpdatedAt === capture.revision;
}
/** Render observation only retires previous action frames. Native proof and
 * attempt ownership are event-owned; only committed layout publishes a frame. */
class ReleaseExportOwner {
  private guard = new RunHistoryRenderGuard();
  private committed: Frame | null = null;
  private pending: Attempt | null = null;
  private origin: RunHistoryOrigin | null = null;
  observe(frame: Frame) { return this.guard.observe(frame, frame.eligible ? frame : null); }
  publish(frame: Frame, stamp: Stamp) { if (this.guard.matchesRead(stamp, null)) this.committed = frame; }
  detach(frame: Frame) {
    if (this.committed === frame) { this.committed = null; this.pending = null; }
  }
  currentFrame(frame: Frame, stamp: Stamp) {
    return frame.eligible && this.committed === frame && this.guard.matchesRead(stamp, null);
  }
  begin(frame: Frame, stamp: Stamp, captures: Capture[]): Attempt | null {
    if (!this.currentFrame(frame, stamp) || this.pending && this.current(this.pending)) return null;
    const attempt = { frame, stamp, activation: crypto.randomUUID(), captures, handedOff: false };
    this.pending = attempt;
    return attempt;
  }
  current(attempt: Attempt) {
    return this.pending === attempt && this.currentFrame(attempt.frame, attempt.stamp) && this.guard.matchesRead(attempt.stamp, attempt.activation);
  }
  active() { return this.pending; }
  revoke(attempt: Attempt) {
    if (this.pending !== attempt) return;
    this.guard.revokeCache(attempt.activation);
    this.pending = null;
  }
  sessionChanged() { this.guard.revokeActions(); this.pending = null; }
  nativeOrigin() { return this.origin; }
  admitOrigin(attempt: Attempt, origin: RunHistoryOrigin) {
    if (!this.current(attempt) || this.origin && !sameRunHistoryOrigin(this.origin, origin)) return false;
    this.origin ??= origin;
    return true;
  }
  finish(attempt: Attempt) {
    if (!this.current(attempt)) return false;
    this.pending = null;
    return true;
  }
}
function currentAttempt(owner: ReleaseExportOwner, client: QueryClient, attempt: Attempt) {
  if (!owner.current(attempt)) return false;
  if (!sameAuthScope(attempt.frame.session, sdkSession()) || !attempt.captures.every(capture => captureCurrent(client, capture))) {
    owner.revoke(attempt);
    return false;
  }
  return true;
}

type ExportProps = {
  projectId: string; releaseId: string; organizationId: string | null | undefined; active: boolean;
};
/** A deliberate new route/account/session owns a separate export instance.
 * The former instance's unmount retires its attempts, including A-B-A returns. */
export function ReleaseSnapshotExport(props: ExportProps) {
  const auth = useAuth();
  return <ReleaseSnapshotExportSession key={JSON.stringify([props.projectId, props.releaseId, auth.userId, auth.sessionId])} {...props} auth={auth} />;
}
/** Props discover the intended release only. Fresh existing native ACCESS reads
 * authorize this export's project-reader scope; no history page is requested. */
function ReleaseSnapshotExportSession({ projectId, releaseId, organizationId, active, auth }: ExportProps & {
  auth: Pick<ReturnType<typeof useAuth>, "isLoaded" | "isSignedIn" | "userId" | "sessionId">;
}) {
  const client = useQueryClient(), utils = trpcReact.useUtils();
  const [owner] = useState(() => new ReleaseExportOwner());
  const [display, setDisplay] = useState<Display | null>(null);
  const [, refreshSession] = useState(0);
  const sdk = sdkSession(), sdkUser = sdk?.userId, sdkId = sdk?.sessionId,
    session = useMemo(() => auth.userId && auth.sessionId ? { userId: auth.userId, sessionId: auth.sessionId } : null, [auth.userId, auth.sessionId]);
  const frame = useMemo<Frame>(() => Object.freeze({ projectId, releaseId, organizationId: organizationId ?? "", session,
    eligible: !!active && !!projectId && !!releaseId && !!organizationId && auth.isLoaded && !!auth.isSignedIn && !!session && session.userId === sdkUser && session.sessionId === sdkId,
  }), [projectId, releaseId, organizationId, active, auth.isLoaded, auth.isSignedIn, session, sdkUser, sdkId]);
  const stamp = owner.observe(frame);
  useLayoutEffect(() => { owner.publish(frame, stamp); return () => owner.detach(frame); }, [owner, frame, stamp]);

  useLayoutEffect(() => {
    let live = true;
    const changed = () => {
      const attempt = owner.active();
      if (live && attempt && !currentAttempt(owner, client, attempt)) setDisplay(previous => previous?.attempt === attempt ? null : previous);
    };
    const unsubscribe = client.getQueryCache().subscribe(changed);
    return () => { live = false; unsubscribe(); };
    // The callback checks event-owned captured frames and live SDK/cache, not
    // render state. Busy-state renders must not revoke their own native fetch.
  }, [client, owner]);
  useLayoutEffect(() => {
    type SDK = NonNullable<typeof window.Clerk> & { addListener?: (listener: () => void) => () => void };
    const clerk = typeof window === "undefined" ? null : window.Clerk as SDK | null;
    let observed = session, live = true;
    const changed = () => {
      const next = sdkSession();
      if (!live || observed === null && next === null || sameAuthScope(observed, next)) return;
      observed = next;
      owner.sessionChanged();
      setDisplay(null);
      refreshSession(value => value + 1);
    };
    const unsubscribe = clerk?.addListener?.(changed);
    changed();
    return () => { live = false; unsubscribe?.(); };
  }, [owner, session]);

  async function exportSnapshot(format: "html" | "markdown") {
    const project = captureQuery(client, getQueryKey(trpcReact.project.byId, { id: projectId }, "query")),
      release = captureQuery(client, getQueryKey(trpcReact.releases.byId, { id: releaseId }, "query"));
    // Discovery caches do not grant permission, and another route's objects
    // cannot supply the original organization or release for a native proof.
    if (!project || !release || !project.data || typeof project.data !== "object" || !release.data || typeof release.data !== "object" ||
      !("id" in project.data) || project.data.id !== projectId || !("organizationId" in project.data) || project.data.organizationId !== frame.organizationId ||
      !("id" in release.data) || release.data.id !== releaseId || !("projectId" in release.data) || release.data.projectId !== projectId ||
      !sameAuthScope(frame.session, sdkSession())) return;
    const attempt = owner.begin(frame, stamp, [project, release]);
    if (!attempt) return;
    setDisplay({ frame, stamp, attempt, format, notice: null });
    let notice: string | null = null;
    try {
      async function nativeProof() {
        if (!currentAttempt(owner, client, attempt!)) throw Error("Export scope changed");
        const origin = owner.nativeOrigin();
        const input = { projectId: attempt!.frame.projectId, originalOrganizationId: attempt!.frame.organizationId,
          expectedClerkActorId: attempt!.frame.session!.userId, ...(origin ? { expectedNativeActorId: origin.nativeActorId } : {}), requestId: crypto.randomUUID() };
        const raw = await utils.runHistory.access.fetch(input, { retry: false, staleTime: 0 });
        if (!currentAttempt(owner, client, attempt!)) throw Error("Export scope changed");
        const admitted = admitRunHistoryAccess(raw, input, origin), capture = captureQuery(client, getQueryKey(trpcReact.runHistory.access, input, "query"));
        if (!admitted || !capture || capture.data !== raw || !owner.admitOrigin(attempt!, admitted.origin)) throw Error("Native export scope unavailable");
        attempt!.captures.push(capture);
      }
      await nativeProof();
      if (!currentAttempt(owner, client, attempt)) return;
      const data = await utils.releases.getSnapshot.fetch({ releaseId: attempt.frame.releaseId }, { retry: false, staleTime: 0 });
      if (!currentAttempt(owner, client, attempt)) return;
      if (data.release.id !== attempt.frame.releaseId || data.release.projectId !== attempt.frame.projectId) throw Error("Snapshot identity mismatch");
      const snapshotCapture = captureQuery(client, getQueryKey(trpcReact.releases.getSnapshot, { releaseId: attempt.frame.releaseId }, "query"));
      if (!snapshotCapture || snapshotCapture.data !== data) throw Error("Snapshot read no longer current");
      attempt.captures.push(snapshotCapture);
      await nativeProof();
      if (!currentAttempt(owner, client, attempt)) return;
      const safeName = data.release.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const content = format === "html" ? buildHtmlSnapshot(data) : buildMarkdownSnapshot(data);
      if (!currentAttempt(owner, client, attempt) || attempt.handedOff) return;
      attempt.handedOff = true;
      downloadFile(`${safeName}-quality-snapshot.${format === "html" ? "html" : "md"}`, content,
        format === "html" ? "text/html" : "text/markdown", () => currentAttempt(owner, client, attempt));
      notice = "The current authorized release snapshot was handed to your browser.";
    } catch {
      notice = "The release snapshot could not be handed off. No new scope was substituted. If your browser may have received it, check downloads before explicitly exporting again.";
    } finally {
      if (currentAttempt(owner, client, attempt) && owner.finish(attempt)) setDisplay({ frame: attempt.frame, stamp: attempt.stamp, attempt: null, format: null, notice });
    }
  }
  const visible = display && owner.currentFrame(display.frame, display.stamp), busy = !!(visible && display.attempt && owner.current(display.attempt));
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
    <button type="button" className="btn-secondary" style={{ fontSize: 13 }} onClick={() => void exportSnapshot("html")} disabled={!frame.eligible || busy}>
      {busy && display?.format === "html" ? "Exporting…" : "Export interactive HTML snapshot"}
    </button>
    <button type="button" className="btn-secondary" style={{ fontSize: 13 }} onClick={() => void exportSnapshot("markdown")} disabled={!frame.eligible || busy}>
      {busy && display?.format === "markdown" ? "Exporting…" : "Export Markdown snapshot"}
    </button>
    {visible && display.notice && <p role="status">{display.notice}</p>}
  </div>;
}
