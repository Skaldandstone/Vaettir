import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { COMPLIANCE_STARTERS } from "./compliance-starters";
import { controlGuidance, frameworkGuidance } from "./compliance-guidance";
// Same source/SSR test boundary as the other renderer tests. Next preserves JSX;
// transform the actual component explicitly rather than changing app tooling.
const componentExports: Record<
  string,
  React.ComponentType<Record<string, unknown>>
> = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../components/ComplianceMappingGuidance.tsx", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  {
    React,
    exports: componentExports,
    require: () => ({ controlGuidance, frameworkGuidance }),
  },
);
const ComplianceMappingGuidance = componentExports.ComplianceMappingGuidance!;
const ComplianceFrameworkGuidance =
  componentExports.ComplianceFrameworkGuidance!;

describe("compliance reference guidance", () => {
  it("provides purposeful examples and official references for every curated control", () => {
    let count = 0;
    for (const starter of COMPLIANCE_STARTERS) {
      const framework = frameworkGuidance(starter.key);
      expect(framework?.sourceUrl).toMatch(/^https:\/\//);
      expect(framework?.review).toBeTruthy();
      for (const control of starter.controls) {
        const guide = controlGuidance(starter.key, control.code, control.title);
        expect(guide?.tests.length).toBeGreaterThan(30);
        expect(guide?.evidence.length).toBeGreaterThan(30);
        const html = renderToStaticMarkup(
          React.createElement(ComplianceMappingGuidance, {
            frameworkKey: starter.key,
            control,
          }),
        );
        expect(html).toContain("Tests worth mapping");
        expect(html).toContain("Evidence to review");
        expect(html).toContain("Human review");
        expect(html).toContain('rel="noopener noreferrer"');
        count++;
      }
    }
    expect(count).toBe(63);
  });
  it("does not infer a requirement from a matching code on a custom or reworded control", () => {
    expect(
      controlGuidance(
        "unknown",
        "Art. 25",
        "Data protection by design and default",
      ),
    ).toBeNull();
    expect(
      controlGuidance("gdpr", "Art. 25", "Customer-authored scope"),
    ).toBeNull();
    const html = renderToStaticMarkup(
      React.createElement(ComplianceMappingGuidance, {
        frameworkKey: "gdpr",
        control: { code: "Art. 25", title: "Customer-authored scope" },
      }),
    );
    expect(html).toContain("no curated interpretation");
    expect(html).not.toContain("privacy-protective sharing");
  });
  it("distinguishes linked coverage from passed execution or compliance", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComplianceFrameworkGuidance, {
        frameworkKey: "gdpr",
      }),
    );
    expect(html).toContain("it does not show that the test passed");
    expect(html).toContain("six selected articles");
    expect(html).toContain("legal basis");
    expect(html).toContain("eur-lex.europa.eu");
  });
});
