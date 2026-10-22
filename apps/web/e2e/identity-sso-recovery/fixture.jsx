import React from "react";
import { createRoot } from "react-dom/client";
import { IdentitySsoSetup } from "../../components/IdentitySsoSetup";
import { useFixture } from "./boundaries";
function Fixture() {
  const current = useFixture();
  return <main style={{ maxWidth: 820, margin: "24px auto", padding: 16 }}>
    <h1>Workspace access</h1><p>Local synthetic verification · {current.workspace}</p>
    {current.mounted && <IdentitySsoSetup organizationId={current.workspace} />}
  </main>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><Fixture /></React.StrictMode>);
