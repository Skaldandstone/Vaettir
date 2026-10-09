import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
  new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "repository.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let navigation: ts.JsxElement | undefined;
function visit(node: ts.Node) {
  if (
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(ast) === "nav" &&
    node.openingElement.attributes.properties.some(
      (property) =>
        ts.isJsxAttribute(property) &&
        property.name.getText(ast) === "aria-label" &&
        property.initializer &&
        ts.isStringLiteral(property.initializer) &&
        property.initializer.text === "Case repository and review queue",
    )
  ) {
    expect(navigation).toBeUndefined();
    navigation = node;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!navigation) throw Error("Actual repository navigation required");
const emitted = ts.transpileModule(
  `this.navigation=(${ts.createPrinter().printNode(ts.EmitHint.Unspecified, navigation, ast)});`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      jsx: ts.JsxEmit.React,
    },
  },
).outputText;
type Status = "APPROVED" | "PENDING_REVIEW" | "REJECTED";
type Case = Readonly<{ reviewStatus: Status; archived: boolean }>;
type NavigationProps = {
  projectId: string;
  reviewFilter: Status;
  cases: readonly Case[];
};
function render(props: NavigationProps) {
  const setReviewFilter = vi.fn();
  const host = vm.createContext({
    React,
    Link,
    styles: {libraryTabs: "synthetic-tabs", libraryTab: "synthetic-tab"},
    ...props,
    tagFilter: null,
    setReviewFilter,
  });
  vm.runInContext(emitted, host);
  const element = (
    host as unknown as {
      navigation: React.ReactElement<{ children: React.ReactNode }>;
    }
  ).navigation;
  const children = React.Children.toArray(element.props.children).filter(
    React.isValidElement,
  );
  const link = children.find((child) => child.type === Link) as
    | React.ReactElement<{
        href: string;
        className: string;
        "aria-current"?: string;
        onClick?: () => void;
        children: React.ReactNode;
      }>
    | undefined;
  if (!link) throw Error("Real installed Next Link required");
  return { link, setReviewFilter, html: renderToStaticMarkup(element) };
}

describe("actual repository review navigation SSR, no native or browser action", () => {
  it("opens the existing current project's native review queue route as an accessible link", () => {
    const h = render({
      projectId: "synthetic-current-project",
      reviewFilter: "APPROVED",
      cases: [{ reviewStatus: "PENDING_REVIEW", archived: false }],
    });
    expect(h.link.props.href).toBe(
      "/projects/synthetic-current-project/test-cases/review",
    );
    expect(h.html).toContain('aria-label="Case repository and review queue"');
    expect(h.html).toContain(
      'href="/projects/synthetic-current-project/test-cases/review"',
    );
    expect(renderToStaticMarkup(h.link)).toMatch(/>Review queue \(1\)<\/a>/);
    expect(h.link.props).not.toHaveProperty("onClick");
    expect(h.link.props).not.toHaveProperty("target");
    expect(h.setReviewFilter).not.toHaveBeenCalled();
  });
  it.each(["APPROVED", "PENDING_REVIEW", "REJECTED"] as const)(
    "preserves styling and excludes approved/rejected/archived rows from the existing pending count in lane %s",
    (reviewFilter) => {
      const cases: readonly Case[] = Object.freeze([
        Object.freeze({ reviewStatus: "APPROVED", archived: false }),
        Object.freeze({ reviewStatus: "PENDING_REVIEW", archived: false }),
        Object.freeze({ reviewStatus: "PENDING_REVIEW", archived: true }),
        Object.freeze({ reviewStatus: "REJECTED", archived: false }),
        Object.freeze({ reviewStatus: "APPROVED", archived: true }),
        Object.freeze({ reviewStatus: "PENDING_REVIEW", archived: false }),
      ]);
      const before = JSON.stringify(cases),
        h = render({
          projectId: "another-synthetic-project",
          reviewFilter,
          cases,
        });
      expect(h.link.props.className).toBe("synthetic-tab");
      expect(h.link.props["aria-current"]).toBe(reviewFilter === "APPROVED" ? undefined : "page");
      expect(renderToStaticMarkup(h.link)).toMatch(/>Review queue \(2\)<\/a>/);
      expect(h.link.props.href).toBe(
        "/projects/another-synthetic-project/test-cases/review",
      );
      expect(h.setReviewFilter).not.toHaveBeenCalled();
      expect(JSON.stringify(cases)).toBe(before);
    },
  );
  it.each([
    { cases: [] },
    {
      cases: [
        { reviewStatus: "APPROVED", archived: false },
        { reviewStatus: "REJECTED", archived: false },
        { reviewStatus: "PENDING_REVIEW", archived: true },
      ],
    },
  ] satisfies readonly { cases: readonly Case[] }[])(
    "preserves an explicit zero count for no active pending cases: %s",
    ({ cases }) => {
      const h = render({
        projectId: "empty-synthetic-project",
        reviewFilter: "APPROVED",
        cases,
      });
      expect(renderToStaticMarkup(h.link)).toMatch(/>Review queue \(0\)<\/a>/);
      expect(h.link.props.href).toBe(
        "/projects/empty-synthetic-project/test-cases/review",
      );
      expect(h.setReviewFilter).not.toHaveBeenCalled();
    },
  );
  it("keeps the approved repository button and every existing lifecycle/filter/query contract separate", () => {
    const h = render({ projectId: "p", reviewFilter: "REJECTED", cases: [] });
    const approved = h.html.match(/<button[^>]*>Approved repository<\/button>/);
    expect(approved).not.toBeNull();
    expect(source).toContain('onClick={() => setReviewFilter("APPROVED")}');
    expect(source).toContain('useState("APPROVED")');
    expect(source).toContain(
      "tc.reviewStatus === repositoryReviewStatus(reviewFilter)",
    );
    expect(source).toContain(
      "setReviewFilter(repositoryReviewStatus(event.target.value))",
    );
    expect(source).toContain(
      "const casesQuery = trpcReact.testCases.list.useQuery({",
    );
    expect(source).toContain("includeArchived: true");
    expect(h.link.props).not.toHaveProperty("onClick");
    expect(h.setReviewFilter).not.toHaveBeenCalled();
  });
});
