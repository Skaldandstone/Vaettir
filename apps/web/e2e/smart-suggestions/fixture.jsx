import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SmartCaseSuggestions, SmartColumnMapping } from "../../components/SmartCaseSuggestions";
import { mapCsvRows } from "../../../api/src/services/csvFieldMapping";
const csvText = "Reference,Scenario text,Initial state,Do this,Expected behavior,Observed status\nsyn-1,Restore purchase,Purchased access,Reinstall and restore,Access retained,Failed\nsyn-2,Avoid duplicate charge,Purchased access,Restore again,Access retained,Passed";
window.smartFixture = { actor: "synthetic-actor", stored: [{ id: "synthetic-case", title: "Restore purchase", given: ["Purchased access"], when: ["Restore"], then: ["Access retained"], tags: [], suitePath: "Misplaced", priority: "MEDIUM", testType: "OTHER" }], mappingCalls: [], analyses: [], saves: [], writes: 0, dropAck: true, reject: false };
function Fixture() {
  const [mapping, setMapping] = useState({}), [patches, setPatches] = useState([]), [saved, setSaved] = useState(false);
  const stored = new URLSearchParams(location.search).has("stored");
  const rows = mapping.title ? mapCsvRows(csvText, mapping).rows.map(row => ({ id: String(row.rowNumber), title: row.title, given: row.given, when: row.when, then: row.then, tags: row.tags, priority: row.priority, testType: row.testType })) : [];
  return <main className="workbench" style={{ maxWidth: 960, padding: 16, margin: "auto" }}><h1>Smart import and organization</h1><p>Synthetic review fixture</p>
    {!stored && <><SmartColumnMapping projectId="synthetic-project" csvText={csvText} currentMapping={mapping} onApply={async next => setMapping(next)} /><p data-testid="mapping-state">{mapping.title ? `Mapped title: ${mapping.title}` : "No mapping changes applied"}</p></>}
    <SmartCaseSuggestions projectId="synthetic-project" {...(stored ? { caseIds: ["synthetic-case"], onSaved: () => setSaved(true) } : { cases: rows, onApplyImport: next => setPatches(next) })} />
    <p data-testid="saved-state">{saved ? "Reviewed changes saved" : "No saved changes confirmed"}</p><pre data-testid="patches">{JSON.stringify(patches)}</pre>
  </main>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
