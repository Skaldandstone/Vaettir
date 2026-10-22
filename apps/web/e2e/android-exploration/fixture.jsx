import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AndroidAppExploration } from "../../components/AndroidAppExploration";
window.explorationFixture = {
  commits: [],
  scope: {
    projectId: "synthetic-project",
    organizationId: "synthetic-org",
    actorId: "synthetic-actor",
    sessionId: "synthetic-session",
  },
  epochKey: "original-synthetic-epoch",
  uncertain: true,
};
function App() {
  const [, render] = useState(0);
  window.explorationFixture.render = () => render((v) => v + 1);
  return (
    <main style={{ maxWidth: 1000, margin: "24px auto", padding: 16 }}>
      <AndroidAppExploration
        pairingCode="ABCDEF123456"
        currentScope={() =>
          window.explorationFixture.scope
            ? {
                scope: window.explorationFixture.scope,
                epochKey: window.explorationFixture.epochKey,
              }
            : null
        }
      />
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
