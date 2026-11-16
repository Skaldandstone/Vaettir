"use client";

import { ActionButton } from "@/components/ui/ActionButton";

import Link from "next/link";
import { ReadableSelect } from "./ui/ReadableSelect";
import { repositoryDisplayName } from "@/lib/repository-display";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { SourceConnectionChips } from "./SourceConnectionChips";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";

type Repository = RouterOutputs["project"]["repositories"][number];

/** Every project workflow reads the same registered repository query. This
 * selects an existing reference, never starts authorization or source I/O. */
export function ConnectedRepositoryPicker({ projectId, selectedId, onSelect, disabled = false }: {
  projectId: string; selectedId: string; onSelect: (repository: Repository | null) => void; disabled?: boolean;
}) {
  const access = useCaseFieldAccess(projectId);
  const query = trpcReact.project.repositories.useQuery({ projectId }, { staleTime: 0, retry: false });
  const ready = access.readable && query.isSuccess && !query.error && !query.isFetching && !query.isPaused;
  if (!ready) return <div>
    <p role={query.error ? "alert" : "status"}>{query.error ? "Connected repositories could not be refreshed." : "Checking project repositories…"}</p>
    {query.error && <ActionButton type="button" className="btn-secondary" onClick={() => void query.refetch()} tooltip={<> Retry project repositories </>}> Retry </ActionButton>}
  </div>;
  if (!query.data.length) return <div>
    <p className="text-muted">No repositories connected to this project yet.</p>
    <SourceConnectionChips projectId={projectId} only={["github", "gitlab", "bitbucket", "azure-devops", "git", "perforce", "svn"]}/>
  </div>;
  const selected = query.data.find(repo => repo.id === selectedId);
  return <section aria-label="Connected project repositories" style={{display:"grid",gap:8,minWidth:0}}>
    <label style={{display:"grid",gap:6}}>Connected repository
      <ReadableSelect value={selected?.id ?? ""} disabled={disabled} style={{width:"100%",minWidth:0}} onChange={event => {
        if (disabled || !access.origin || !access.owns(access.origin)) return;
        onSelect(query.data.find(repo => repo.id === event.target.value) ?? null);
      }}>
        <option value="">Choose from {query.data.length} project repositories</option>
        {query.data.map(repo => <option key={repo.id} value={repo.id}>{repositoryDisplayName(repo.url)} · {repo.accessVerified ? "connected" : "access needs review"}</option>)}
      </ReadableSelect>
    </label>
    {selected && <p className="text-muted" style={{margin:0,overflowWrap:"anywhere"}}>{selected.accessVerified ? "Existing project connection. No reconnect required." : "The saved repository is retained, but provider access needs renewal before private reads."}</p>}
    <Link className="text-muted" href={`/projects/${encodeURIComponent(projectId)}/settings/integrations`}>Manage project repositories</Link>
  </section>;
}
