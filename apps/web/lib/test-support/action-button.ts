// Real shared controls for extracted server-render fixtures. Keep the actual
// JSX and React hooks; reject dependencies outside the reviewed controls.
import { readFileSync } from "node:fs";
import React from "react";
import { createPortal } from "react-dom";
import ts from "typescript";

const modules = new Map<string, Record<string, unknown>>();
function control(name: string): Record<string, unknown> {
  const retained = modules.get(name);
  if (retained) return retained;
  if (!["ActionButton", "ActionHelp", "FloatingTooltip"].includes(name))
    throw Error("Unreviewed shared control: " + name);
  const source = readFileSync(
    new URL("../../components/ui/" + name + ".tsx", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", "React", compiled)((dependency: string) => {
    if (dependency === "react") return React;
    if (dependency === "react-dom") return { createPortal };
    if (dependency === "./FloatingTooltip") return control("FloatingTooltip");
    throw Error("Unreviewed shared-control dependency: " + dependency);
  }, exports, React);
  modules.set(name, exports);
  return exports;
}

export const ActionButton = control("ActionButton").ActionButton as React.ComponentType<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tooltip: React.ReactNode }
>;

export const ActionHelp = control("ActionHelp").ActionHelp as React.ComponentType<{
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  tooltip: React.ReactNode;
}>;
