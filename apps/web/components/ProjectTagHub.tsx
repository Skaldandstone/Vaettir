"use client";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { projectTagHref, projectTagItemHref, projectTagLabel, projectTagPageMatches, type TagSection } from "@/lib/project-tag-navigation";

type TagPage = RouterOutputs["projectTags"]["page"];
type TagCursor = NonNullable<TagPage["nextCursor"]>;
const sections: Record<TagSection, string> = { CASES: "Directly tagged cases", PLANS: "Linked plans", RELEASES: "Linked releases", REQUIREMENTS: "Linked requirements" };
const edges = { DIRECT_CASE_TAG: "Exact current case tag", DIRECT_CASE_PLAN: "Through the case’s assigned plan", DIRECT_CASE_PLAN_RELEASE: "Through the case’s assigned plan and release", ACTIVE_CASE_REQUIREMENT_REFERENCE: "Active saved case-to-requirement reference" };

export function ProjectTagHub({ projectId, tag }: { projectId: string; tag: string | null }) {
  return <ProjectTagHubView key={JSON.stringify([projectId, tag])} projectId={projectId} tag={tag} />;
}
function ProjectTagHubView({ projectId, tag }: { projectId: string; tag: string | null }) {
  const router = useRouter(), auth = useAuth(), access = useCaseFieldAccess(projectId);
  const [draftTag, setDraftTag] = useState(tag ?? ""), [section, setSection] = useState<TagSection>("CASES");
  const [archive, setArchive] = useState<"ACTIVE" | "ARCHIVED" | "ALL">("ACTIVE");
  const [review, setReview] = useState<"APPROVED" | "PENDING_REVIEW" | "REJECTED" | "ALL">("APPROVED");
  const [pages, setPages] = useState<TagCursor[]>([]), [refresh, setRefresh] = useState(0);
  const [nativeActor, setNativeActor] = useState<string | null>(null);
  const candidateActor = access.readable ? access.fresh?.readScope?.actorId : null;
  if (nativeActor === null && candidateActor) setNativeActor(candidateActor);
  const ready = tag !== null && access.readable && access.origin && auth.isLoaded && auth.isSignedIn && auth.userId === access.origin.clerkActorId && !!auth.sessionId && !!nativeActor && access.fresh?.readScope?.actorId === nativeActor;
  const binding = JSON.stringify([!!ready, projectId, access.origin?.organizationId, access.origin?.clerkActorId, nativeActor, auth.sessionId, tag, section, archive, review, pages.at(-1), refresh]);
  const [cycle, setCycle] = useState({ binding: "", requestId: crypto.randomUUID() });
  if (cycle.binding !== binding) setCycle({ binding, requestId: crypto.randomUUID() });
  const input = { projectId, originalOrganizationId: access.origin?.organizationId ?? "pending", expectedClerkActorId: access.origin?.clerkActorId ?? "pending", requestId: cycle.requestId, tag: tag ?? "", section, archive, review, ...(pages.at(-1) ? { cursor: pages.at(-1)! } : {}) };
  const query = trpcReact.projectTags.page.useQuery(input, { enabled: !!ready && cycle.binding === binding, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const [wasPaused, setWasPaused] = useState(query.isPaused);
  if (wasPaused !== query.isPaused) { setWasPaused(query.isPaused); if (!query.isPaused) setRefresh(value => value + 1); }
  const fresh = !!ready && cycle.binding === binding && query.isFetchedAfterMount && !query.isFetching && !query.isPaused && !query.error && projectTagPageMatches(query.data, input, nativeActor!);
  const value = fresh ? query.data! : null;
  function restart() { setPages([]); setRefresh(value => value + 1); }
  return <main>
    <h1>Tag associations</h1>
    <p>Find saved cases with an exact tag and the records linked through those cases. Linked records do not acquire the tag, and current tags do not describe historical run evidence.</p>
    <form onSubmit={event => { event.preventDefault(); router.push(projectTagHref(projectId, draftTag)); }}>
      <label htmlFor="project-tag-search">Exact tag text</label>
      <textarea id="project-tag-search" rows={2} value={draftTag} onChange={event => setDraftTag(event.target.value)} style={{ maxWidth: 640, width: "100%", display: "block" }} />
      <button type="submit">Find saved tag associations</button>
      <p className="text-muted">Whitespace and punctuation are literal. An empty tag is a retained native value, not “all tags.” Editing this search does not edit case tags.</p>
    </form>
    {tag === null ? <p>Select an exact tag to start. No repository-wide request has been made.</p> : <>
      <h2 style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{projectTagLabel(tag)}</h2>
      <code style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(tag)}</code>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBlock: 16 }}>
        <label>Case repository scope<select value={review} onChange={event => { setReview(event.target.value as typeof review); setPages([]); }}><option value="APPROVED">Approved repository</option><option value="PENDING_REVIEW">Pending review only</option><option value="REJECTED">Rejected only</option><option value="ALL">All review states (explicit scope)</option></select></label>
        <label>Archive scope<select value={archive} onChange={event => { setArchive(event.target.value as typeof archive); setPages([]); }}><option value="ACTIVE">Active cases</option><option value="ARCHIVED">Archived cases</option><option value="ALL">Active and archived</option></select></label>
        <button type="button" disabled={!ready || query.isFetching} onClick={restart}>Refresh current scope</button>
      </div>
      <nav aria-label="Tag association sections" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{(Object.keys(sections) as TagSection[]).map(key => <button key={key} type="button" aria-pressed={section === key} onClick={() => { setSection(key); setPages([]); }}>{sections[key]}</button>)}</nav>
      {!ready && <p role="status">Waiting for current original project membership and the same native reader. Private tag results remain hidden.</p>}
      {ready && !value && !query.error && <p role="status">{query.isPaused ? "The scoped read is paused. Reconnecting requires a new read before results return." : "Awaiting a new completed scoped read. Cached results are not shown as current."}</p>}
      {ready && query.error && <p role="alert">Tag associations are unavailable: {query.error.message} No counts are being shown as zero. <button type="button" disabled={query.isFetching} onClick={restart}>Restart current view</button></p>}
      {value && <>
        <section className="panel" style={{ marginBlock: 16 }}>
          <h2>{sections[section]}</h2>
          <p><strong>{value.total}</strong> distinct {section === "CASES" ? "cases" : section.toLowerCase()} in this exact section and scope, among <strong>{value.matchingCases}</strong> exact-tag matching cases. Not every matching case has a saved link.</p>
          <p>Current read <time dateTime={value.asOf}>{new Date(value.asOf).toLocaleString()}</time>. Each section and page is independently checked; this is not a frozen all-sections snapshot.</p>
          <p>Page {pages.length + 1}, {value.items.length} records shown. Changes to the admitted population invalidate old pagination rather than silently skipping records.</p>
        </section>
        {value.items.length === 0 ? <p>No matching saved records in this admitted section and scope.</p> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 12 }}>
          {value.items.map(item => <article key={item.id} className="panel" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <h3><a href={projectTagItemHref(projectId, section, item.id)} target="_blank" rel="noopener noreferrer">{item.title || "Empty retained title"}</a></h3>
            <code>{item.displayId ?? item.id}</code>
            <p>{edges[item.edge]} · {item.matchingCaseCount} distinct tagged {item.matchingCaseCount === 1 ? "case" : "cases"}</p>
            {item.reviewStatus !== undefined && <p>{item.reviewStatus.toLowerCase().replaceAll("_", " ")}{item.archived ? " · archived" : ""}</p>}
            {item.status !== undefined && <p>Saved status: {item.status}. No readiness or acceptance inferred.</p>}
            {section === "REQUIREMENTS" && <p className="text-muted">Opens the requirements list at the saved requirement anchor; this is not a separate detail page.</p>}
          </article>)}
        </div>}
        <div style={{ display: "flex", gap: 8, marginBlock: 16 }}>
          <button type="button" disabled={pages.length === 0 || query.isFetching} onClick={() => setPages(current => current.slice(0, -1))}>Previous page</button>
          <button type="button" disabled={!value.nextCursor || query.isFetching} onClick={() => { if (value.nextCursor) setPages(current => [...current, value.nextCursor!]); }}>Next page</button>
        </div>
        <details><summary>Supported relationships and limits</summary>{value.limitations.map((limitation, index) => <p key={index}>{limitation}</p>)}</details>
      </>}
    </>}
  </main>;
}
