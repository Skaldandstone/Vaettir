import React from "react";
import { createRoot } from "react-dom/client";
import { ReviewedRepositoryAttachment } from "../../components/ReviewedRepositoryAttachment";
import { useFixture } from "./boundaries";
function Fixture() {
  const state = useFixture();
  return <main style={{ maxWidth: 900, padding: 20, margin: "auto" }}><h1>Project integrations</h1><p>Local synthetic fixture · {state.projectId}</p>
    <ReviewedRepositoryAttachment projectId={state.projectId} onAttached={async () => {}} />
  </main>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><Fixture /></React.StrictMode>);
