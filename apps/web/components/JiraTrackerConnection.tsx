"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useIsMutating } from "@tanstack/react-query";
import { trpcReact } from "@/lib/trpcReact";
import { Modal } from "./Modal";
import { JiraSourceConnection } from "./JiraSourceConnection";

/** Starts a real connection in Vaettir and retains drafts when the module closes. */
type Props = { projectId: string; canEdit: boolean; onSaved?: () => void };
export function JiraTrackerConnection(props: Props) {
  const { userId, sessionId, isLoaded, isSignedIn } = useAuth();
  return <JiraTrackerControls key={[props.projectId, userId, sessionId].join(":")} {...props} authReady={isLoaded && Boolean(isSignedIn)} />;
}
function JiraTrackerControls({ projectId, canEdit, onSaved, authReady }: Props & { authReady: boolean }) {
  const [open, setOpen] = useState(false), [visited, setVisited] = useState(false);
  const [activity, setActivity] = useState(false);
  const utils = trpcReact.useUtils();
  const mutationBusy = useIsMutating({ predicate: mutation => {
    const route = mutation.options.mutationKey?.[0];
    return Array.isArray(route) && (route[0] === "jiraConnections" || route[0] === "jiraIssueIntake" || route[0] === "defectMap" && ["previewJira", "approveJira"].includes(String(route[1])));
  } }) > 0;
  const busy = activity || mutationBusy;
  const allowed = canEdit && authReady;
  return <>
    <ActionButton type="button" disabled={!allowed || busy} onClick={() => { setVisited(true); setOpen(true); }} tooltip={<> Connect Jira tracker </>}> Connect Jira </ActionButton>
    <Modal open={open && allowed} keepMounted dismissible={!busy} title="Connect Jira to the defect map" size="wide" onClose={() => { if (!busy) setOpen(false); }}>
      {visited && <JiraSourceConnection projectId={projectId} purpose="defects" onDefectWorkingChange={setActivity} onClose={() => { if (!busy) setOpen(false); }} onDefectsSaved={() => { void utils.defectMap.get.invalidate({ projectId }); onSaved?.(); }} />}
    </Modal>
  </>;
}
