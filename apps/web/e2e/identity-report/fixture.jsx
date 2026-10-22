// Actual report wizard and permission hook; synthetic transport only.
import React from "react";
import { createRoot } from "react-dom/client";
import { ReportBuilder } from "../../components/ReportBuilder";
window.Clerk = { loaded: true, session: { id: "synthetic-session", user: { id: "synthetic-actor" } } };
createRoot(document.getElementById("root")).render(<main style={{ padding: 16 }}><ReportBuilder projectId="synthetic-project" /></main>);
