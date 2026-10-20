import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PlanTemplateEditor } from "../../components/PlanTemplateEditor";
import { ArchitectureWorkbench } from "../../components/ArchitectureWorkbench";
import { Evidence, scope } from "./boundaries";
import ProjectsPage from "../../app/projects/page";
function App() {
  const [theme, setTheme] = useState("dark");
  const screen = new URLSearchParams(location.search).get("screen");
  return <div style={{ maxWidth: 1240, margin: "24px auto", padding: 16 }}>
    <nav className="workspace-toolbar"><strong>Vaettir · local synthetic workflow verification</strong><button onClick={() => { const next = theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; setTheme(next); }}>Switch theme</button></nav>
    {screen === "projects" ? <ProjectsPage /> : screen === "architecture" ? <ArchitectureWorkbench projectId={scope.projectId} actorClerkUserId={scope.actorClerkUserId} /> :
      <><h1>Checkout release validation</h1><p>Selected tests and reusable configurations</p><PlanTemplateEditor projectId={scope.projectId} testPlanId="synthetic-plan" organizationId={scope.organizationId} onChanged={() => {}} /></>}
    <Evidence />
  </div>;
}
createRoot(document.getElementById("root")).render(<App />);
