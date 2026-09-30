"use client";
import { useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { Modal } from "./Modal";
import { PopulationSetup } from "./PopulationSetup";
import { PopulationDocuments } from "./PopulationDocuments";
import { PopulationRequirements } from "./PopulationRequirements";
import { PopulationAssessment } from "./PopulationAssessment";
import { GitlabRepositoryConnection } from "./GitlabRepositoryConnection";
type Screen = "setup" | "documents" | "requirements" | "assessment" | "gitlab";
const screens: Screen[] = ["setup", "documents", "requirements", "assessment"];
const labels = { setup: "Project setup", documents: "Add evidence", requirements: "Review suggestions", assessment: "Next actions", gitlab: "Connect GitLab repositories" };

export function ProjectPopulationModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { loaded, canEdit } = useProjectPermissions(projectId);
  const busy = useIsMutating() > 0;
  const [screen, setScreen] = useState<Screen>("setup");
  const [visited, setVisited] = useState<Screen[]>(["setup"]);
  const [closing, setClosing] = useState(false);
  function go(next: Screen) {
    if (busy) return;
    setScreen(next);
    setVisited((previous) => previous.includes(next) ? previous : [...previous, next]);
  }
  if (!loaded || !canEdit) return <Modal open title="Project setup" onClose={onClose}><p>{!loaded ? "Checking project access…" : "A full editor seat is required to update this project."}</p></Modal>;
  return <Modal open title="Update project understanding" onClose={() => { if (!busy) setClosing(true); }} dismissible={!closing && !busy}>
    {closing ? <section><h3>Leave this wizard?</h3><p>Saved drafts and approved evidence are retained. Unsaved input will be lost. If an approval or save is running, stay here until it finishes.</p><button className="btn-primary" onClick={() => setClosing(false)}>Keep working</button>{" "}<button className="btn-secondary" onClick={onClose}>Leave wizard</button></section> : null}
    <div hidden={closing}>
      {busy && <p role="status">Finishing your current action. Please keep this wizard open.</p>}
      <p className="text-muted">{labels[screen]} · Your project stays open behind this wizard.</p>
      <div hidden={screen !== "setup"}><PopulationSetup projectId={projectId} onExit={() => setClosing(true)} onScreen={go} /></div>
      {visited.includes("documents") && <div hidden={screen !== "documents"}><PopulationDocuments projectId={projectId} /></div>}
      {visited.includes("requirements") && <div hidden={screen !== "requirements"}><PopulationRequirements projectId={projectId} /></div>}
      {visited.includes("assessment") && <div hidden={screen !== "assessment"}><PopulationAssessment projectId={projectId} /></div>}
      {visited.includes("gitlab") && <div hidden={screen !== "gitlab"}><GitlabRepositoryConnection projectId={projectId} onConnected={() => {}} onClose={() => go("setup")} /></div>}
      {screen === "gitlab" && <button className="btn-secondary" disabled={busy} onClick={() => go("setup")}>Back to setup</button>}
      {screen !== "setup" && screen !== "gitlab" && <footer className="population-modal-navigation"><button className="btn-secondary" onClick={() => go(screens[screens.indexOf(screen) - 1]!)}>Back</button><button className="btn-secondary" onClick={() => go("setup")}>Back to setup</button>{screen !== "assessment" && <button className="btn-primary" onClick={() => go(screens[screens.indexOf(screen) + 1]!)}>{screen === "documents" ? "Review requirement suggestions" : "Check evidence gaps"}</button>}</footer>}
    </div>
  </Modal>;
}
