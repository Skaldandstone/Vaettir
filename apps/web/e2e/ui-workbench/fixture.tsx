// Local-only rendered-component fixture. No authentication, transport or customer data.
/* eslint-disable @next/next/no-html-link-for-pages -- standalone browser fixture, not a Next route */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import TestCaseForm from "../../components/TestCaseForm";
import { CompactSidebar } from "../../components/ui/CompactSidebar";
import { ModularWorkspace } from "../../components/ui/ModularWorkspace";
import { CompactTabs } from "../../components/ui/CompactTabs";
import { IconButton } from "../../components/ui/IconButton";
import { PageHeading, StatusPill } from "../../components/ui/Workspace";
import { CreationWizard } from "../../components/CreationWizard";
import { ThemeToggle } from "../../components/ThemeToggle";
import { RuneMark } from "../../components/RuneMark";
import { Sidebar } from "../../components/Sidebar";
import { ReadableSelect } from "../../components/ui/ReadableSelect";
import { ArchitectureMap } from "../../components/ArchitectureMap";
import { Modal } from "../../components/Modal";

const actions = ["Open the account settings", "Choose a new notification preference", "Save the preference", "Reload and verify the saved value", "Check another signed-in device"];
function App() {
  const screen = new URLSearchParams(location.search).get("screen") ?? "editor";
  const [tab, setTab] = useState("Procedure");
  const [wizardStep, setWizardStep] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scope, setScope] = useState("synthetic-actor:synthetic-project");
  return <><header className="app-nav"><div className="app-nav-inner"><a className="brand" href="/?screen=editor"><RuneMark size={24} /> Vaettir</a><span style={{ marginRight: "auto" }}>UI verification · Synthetic data</span><ThemeToggle /></div></header>
    <div className="app-shell"><Sidebar/><main className="app-main" style={{ padding: 24 }}>
      <PageHeading eyebrow="DEMO / QUALITY WORKSPACE" title={{ editor: "Notification preferences", library: "Test cases", overview: "Project overview", wizard: "Create a test plan" }[screen] ?? "Workbench"} description="Local component verification. No saved project is changed." actions={<IconButton label="Change test preference scope" icon="people" onClick={() => setScope(scope.startsWith("synthetic-actor:") ? "second-actor:synthetic-project" : "synthetic-actor:synthetic-project")} />} />
      {screen === "editor" && <><CompactTabs id="demo" label="Test sections" tabs={["Procedure", "Activity"]} selected={tab} onChange={setTab}/>
        <div role="tabpanel" id="demo-panel-Procedure" aria-labelledby="demo-tab-Procedure" hidden={tab !== "Procedure"}>
          <TestCaseForm mode="edit" projectId="synthetic-project" testCaseId="synthetic-case" initial={{ title: "Notification preferences persist across devices", suitePath: "Account / Notifications", steps: actions.map(action => ({ action, expectedActionOrData: "PATCH /preferences stores the selected value for the signed-in account.", expectedResult: "The selected preference is shown after reload.", expectedResponse: "200 OK", mediaAttachmentIds: [] })) }} />
        </div><div role="tabpanel" id="demo-panel-Activity" aria-labelledby="demo-tab-Activity" hidden={tab !== "Activity"}><label>Draft comment<textarea defaultValue="Retain this draft when changing tabs." /></label></div></>}
      {screen === "library" && <CompactSidebar scope={scope} title="Test suites" sidebar={<nav aria-label="Suite fixtures">{["All cases", "Account", "Notifications", "Billing", "API contracts", "Accessibility"].map(label => <button type="button" key={label} className="suite-fixture">{label}<span>12</span></button>)}</nav>}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}><input aria-label="Search test cases" placeholder="Search cases" style={{ flex: 1, minWidth: 0 }}/><IconButton icon="filter" label="Filter cases"/><button className="btn-primary">New case</button></div>
        <table className="workspace-table"><thead><tr><th>Test case</th><th>Type</th><th>Review</th></tr></thead><tbody>{[...actions,...actions].map((action,index) => <tr key={index}><td><code>DEMO-{index + 1}</code> {action}</td><td>Functional</td><td><StatusPill tone="success">Approved</StatusPill></td></tr>)}</tbody></table>
      </CompactSidebar>}
      {screen === "overview" && <ModularWorkspace scope={scope} name="Project overview" panels={[
        { id: "execution", title: "Execution", content: <><p>Synthetic fixture, not release evidence.</p><progress value={8} max={10} aria-label="Synthetic completed runs"/><p>8 of 10 runs complete</p></> },
        { id: "notes", title: "Notes", content: <label>Draft notes<textarea defaultValue="Local draft survives layout changes." /></label> },
        { id: "risk", title: "Risks", wide: true, content: <p>No production risk data is read in this fixture.</p> },
      ]} />}
      {screen === "architecture" && <ArchitectureMap elements={[
        { id: "app", label: "Mobile application", kind: "COMPONENT" }, { id: "api", label: "Account API", kind: "COMPONENT" }, { id: "db", label: "Preference store", kind: "COMPONENT" },
        { id: "req", label: "Update preferences", kind: "INTERACTION", from: "app", to: "api" }, { id: "save", label: "Persist selected value", kind: "INTERACTION", from: "api", to: "db" },
      ]} reviewedLinks={new Map([["app", 3], ["api", 2]])} />}
      {screen === "wizard" && <div className="fixture-wizard"><CreationWizard step={wizardStep} steps={["Details", "Cases", "Review"]} title={["Name your plan", "Choose the test scope", "Review your plan"][wizardStep]!} description="A reusable plan for the checks that matter." submitLabel="Create plan" onCancel={() => setWizardStep(0)} onSubmit={() => {}} onStepChange={setWizardStep}>
        <label>Plan name<input defaultValue="Mobile release verification" /></label>
        <label>Configuration<ReadableSelect defaultValue="long"><option value="long">Production-like staging / mobile / English (United States)</option><option value="other">Development</option></ReadableSelect></label>
        <label>Notes<textarea defaultValue="Include the affected account and notification checks." /></label>
      </CreationWizard></div>}
      {screen === "dialog" && <><button onClick={() => setDialogOpen(true)}>Open help dialog</button><Modal open={dialogOpen} onClose={() => setDialogOpen(false)} title="Local dialog check"><label>Dialog notes<input data-dialog-initial-focus defaultValue="Unsaved local note" /></label><IconButton icon="help" label="Dialog help" tooltip="Keep this help visible while reading it. Escape dismisses help before closing the dialog." /></Modal></>}
    </main></div></>;
}
createRoot(document.getElementById("root")!).render(<App/>);
