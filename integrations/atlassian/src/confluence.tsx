import React from "react";
import ForgeReconciler, { useConfig } from "@forge/react";
import { QualityApp, MacroConfig } from "./quality";
function ConfluenceApp() {
  const config = useConfig();
  return <QualityApp macroConfig={config} />;
}
ForgeReconciler.render(<ConfluenceApp />);
ForgeReconciler.addConfig(<MacroConfig />);
