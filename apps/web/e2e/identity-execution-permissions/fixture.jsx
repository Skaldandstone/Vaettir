// Actual recovery component and actual native/custom permission hooks.
// The labeled diagnostics/draft below are fixture-only, not a production run page.
import React from "react";
import { createRoot } from "react-dom/client";
import { ExecutionPermissionNotice } from "../../components/ExecutionPermissionNotice";
import { useScopedManualExecutionAccess } from "../../lib/use-scoped-manual-execution-access";
window.Clerk = { loaded: true, session: { id: "synthetic-session", user: { id: "synthetic-actor" } } };
function Fixture() {
  const access = useScopedManualExecutionAccess("synthetic-project");
  return <main style={{ maxWidth: 720, padding: 20 }}>
    <h1>Local permission recovery</h1>
    <p>Synthetic permission transport. No test run or provider request is performed.</p>
    <ExecutionPermissionNotice state={access.permissionState} onRetry={access.retryPermissions} />
    <output aria-label="Manual execution availability">{access.canWrite ? "Allowed" : "Unavailable"}</output>
    <p><label>Retained fixture draft<input defaultValue="Original unsaved notes" /></label></p>
  </main>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
