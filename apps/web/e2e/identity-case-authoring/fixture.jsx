import React from "react";
import { createRoot } from "react-dom/client";
import NewPage from "../../app/projects/[projectId]/test-cases/new/page";
import EditPage from "../../app/projects/[projectId]/test-cases/[id]/edit/page";
const Page = location.pathname === "/edit" ? EditPage : NewPage;
createRoot(document.getElementById("root")).render(<main style={{ padding: 16, maxWidth: 1120, margin: "auto" }}><Page /></main>);
