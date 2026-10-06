import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

type Props = Parameters<
  typeof import("../components/ReleaseDraftEvidenceReview").ReleaseDraftEvidenceReview
>[0];
const source = readFileSync(
  new URL("../components/ReleaseDraftEvidenceReview.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "review.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const printer = ts.createPrinter();
const implementation = ast.statements
  .filter(ts.isFunctionDeclaration)
  .map((node) =>
    printer
      .printNode(ts.EmitHint.Unspecified, node, ast)
      .replace(/\bexport\s+/, ""),
  )
  .join("\n");
const context = vm.createContext({ React });
vm.runInContext(
  ts.transpileModule(
    implementation + "\nthis.review=ReleaseDraftEvidenceReview;",
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
        jsx: ts.JsxEmit.React,
      },
    },
  ).outputText,
  context,
);
const review = (
  context as unknown as { review(props: Props): React.ReactElement }
).review;
const draft = (patch: Partial<Props> = {}): Props => ({
  retainedRequest: null,
  releaseName: " Release 1.2 ",
  planName: "",
  criteria: ["Verify regression"],
  ...patch,
});
const markup = (props: Props) => renderToStaticMarkup(review(props));
function listItems(
  node: React.ReactNode,
): React.ReactElement<{ children: string; style: React.CSSProperties }>[] {
  if (
    !React.isValidElement<{
      children?: React.ReactNode;
      style: React.CSSProperties;
    }>(node)
  )
    return [];
  return [
    ...(node.type === "li"
      ? [
          node as React.ReactElement<{
            children: string;
            style: React.CSSProperties;
          }>,
        ]
      : []),
    ...React.Children.toArray(node.props.children).flatMap(listItems),
  ];
}

const pageSource = readFileSync(
  new URL("../app/projects/[projectId]/releases/page.tsx", import.meta.url),
  "utf8",
);
const pageAst = ts.createSourceFile(
  "page.tsx",
  pageSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let mountedReview: ts.JsxSelfClosingElement | undefined;
let submittedPlan: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(pageAst) === "ReleaseDraftEvidenceReview"
  ) {
    expect(mountedReview).toBeUndefined();
    mountedReview = node;
  }
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(pageAst) === "request" &&
    node.initializer &&
    ts.isBinaryExpression(node.initializer) &&
    ts.isObjectLiteralExpression(node.initializer.right)
  ) {
    const property = node.initializer.right.properties.find(
      (value) =>
        ts.isPropertyAssignment(value) &&
        value.name.getText(pageAst) === "newPlan",
    );
    if (property && ts.isPropertyAssignment(property))
      submittedPlan = property.initializer;
  }
  ts.forEachChild(node, visit);
}
visit(pageAst);
function mount(props: Props) {
  if (!mountedReview) throw Error("Actual release review mount required");
  const host = vm.createContext({
    React,
    ReleaseDraftEvidenceReview: review,
    createRequest: props.retainedRequest,
    name: props.releaseName,
    newPlanName: props.planName,
    newCriteria: props.criteria,
  });
  vm.runInContext(
    ts.transpileModule(
      `this.element=(${printer.printNode(ts.EmitHint.Unspecified, mountedReview, pageAst)});`,
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.None,
          jsx: ts.JsxEmit.React,
        },
      },
    ).outputText,
    host,
  );
  return renderToStaticMarkup(
    (host as unknown as { element: React.ReactElement }).element,
  );
}
function actualSubmitPlan(
  props: Props,
): { name: string; criteria: readonly string[] } | undefined {
  if (!submittedPlan)
    throw Error("Unchanged actual submission recipe required");
  const host = vm.createContext({
    name: props.releaseName,
    newPlanName: props.planName,
    newCriteria: props.criteria,
  });
  vm.runInContext(
    ts.transpileModule(
      `this.plan=(${printer.printNode(ts.EmitHint.Unspecified, submittedPlan, pageAst)});`,
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.None,
        },
      },
    ).outputText,
    host,
  );
  return (host as unknown as { plan: ReturnType<typeof actualSubmitPlan> })
    .plan;
}

describe("actual release draft evidence review renderer, no transport or native acceptance", () => {
  it("shows every ordered duplicate and raw multiline criterion with wrapping, not clipping", () => {
    const raw = " \t First line\n  Second line \n",
      long = "Long line ".repeat(195) + "\nLAST EXACT LINE";
    const props = draft({
      planName: " Release checks ",
      criteria: [raw, raw, long],
    });
    const before = JSON.stringify(props),
      items = listItems(review(props));
    expect(items.map((item) => item.props.children)).toEqual([raw, raw, long]);
    expect(items).toHaveLength(3);
    for (const item of items)
      expect(item.props.style).toMatchObject({
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      });
    const html = markup(props);
    expect(html).toContain(raw);
    expect(html).toContain(long);
    expect(html).toContain("Release checks");
    expect(html).not.toMatch(/line-clamp|text-overflow|overflow:\s*hidden/);
    expect(JSON.stringify(props)).toBe(before);
  });
  it("uses precisely the unchanged actual submit naming fallback and criteria", () => {
    for (const patch of [
      { planName: "  Explicit plan  " },
      { planName: " \t ", releaseName: " Release 1.2 " },
      { planName: "", releaseName: "x".repeat(200) },
    ]) {
      const props = draft(patch),
        submitted = actualSubmitPlan(props)!;
      expect(markup(props)).toContain(submitted.name);
      expect(
        listItems(review(props)).map((item) => item.props.children),
      ).toEqual(submitted.criteria);
      expect(submitted.name.length).toBeLessThanOrEqual(200);
    }
  });
  it("renders only the retained request's exact plan, never an edited local replacement", () => {
    const plan = Object.freeze({
      name: "  Retained exact plan\n ",
      criteria: Object.freeze([
        "Saved first",
        "Saved first",
        "\n Saved final \t",
      ]),
    });
    const props = draft({
      retainedRequest: Object.freeze({ newPlan: plan }),
      planName: "Wrong draft plan",
      criteria: ["Wrong draft criterion"],
    });
    const html = mount(props);
    expect(html).toContain(plan.name);
    expect(html).toContain("\n Saved final \t");
    expect(html.match(/Saved first/g) ?? []).toHaveLength(2);
    expect(html).not.toContain("Wrong draft");
    expect(props.retainedRequest?.newPlan).toBe(plan);
  });
  it("retained explicit absence cannot fall back to nonempty local draft criteria", () => {
    const props = draft({ retainedRequest: Object.freeze({}) }),
      html = mount(props);
    expect(html).toContain("No new quality plan is included");
    expect(html).not.toContain("Verify regression");
    expect(html).not.toContain("Release 1.2 quality plan");
    expect(listItems(review(props))).toEqual([]);
  });
  it("empty drafts add no plan, and a retained empty plan is displayed without inventing criteria", () => {
    const noPlan = draft({ criteria: [], planName: "Unsubmitted name" });
    expect(actualSubmitPlan(noPlan)).toBeUndefined();
    expect(markup(noPlan)).toContain("No new quality plan is included");
    expect(markup(noPlan)).not.toContain("Unsubmitted name");
    const html = markup(
      draft({
        retainedRequest: {
          newPlan: { name: "Exact empty proposed plan", criteria: [] },
        },
      }),
    );
    expect(html).toContain("Exact empty proposed plan");
    expect(html).toContain("No acceptance criteria are included");
    expect(html).not.toContain("Verify regression");
  });
  it("escapes literal markup instead of turning criterion wording into controls or links", () => {
    const props = draft({
        planName: '<Plan & "checks">',
        criteria: [
          '<script>alert("no")</script>',
          '<img src=x onerror="no"> & wording',
        ],
      }),
      html = markup(props);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp; wording");
    expect(html).not.toMatch(
      /<script|<img|<[^>]*\sonerror=|dangerouslySetInnerHTML/,
    );
    expect(listItems(review(props)).map((item) => item.props.children)).toEqual(
      props.criteria,
    );
  });
  it("clearly separates proposed pending criteria from satisfied evidence or release approval", () => {
    const html = markup(draft());
    expect(html).toContain("pending, not satisfied");
    expect(html).toContain(
      "does not record test results or approve release readiness",
    );
    expect(html).toContain('aria-label="Proposed pending acceptance criteria"');
    expect(html).not.toMatch(/<button|<input|<textarea|<form|href=/);
    expect(ast.statements.filter(ts.isImportDeclaration)).toHaveLength(0);
    expect(source).not.toMatch(
      /\b(?:fetch|useEffect|useState|window|navigator|trpcReact|crypto|requestHash)\b/,
    );
  });
  it("preserves empty and whitespace-only retained wording as distinct ordered literal rows", () => {
    const props = draft({
      retainedRequest: {
        newPlan: {
          name: "Retained literal rows",
          criteria: ["", " \n ", "Last"],
        },
      },
    });
    const items = listItems(review(props));
    expect(items.map((item) => item.props.children)).toEqual([
      "",
      " \n ",
      "Last",
    ]);
    expect(items).toHaveLength(3);
    expect(markup(props)).toContain(" \n ");
    expect(markup(draft({ criteria: [] }))).toContain(
      "Existing selected plans will be linked without editing their criteria",
    );
  });
  it("mounts the real component in the final step while preserving counts, goals and original request selection", () => {
    expect(mountedReview).toBeDefined();
    let parent: ts.Node | undefined = mountedReview?.parent;
    let finalStep = false;
    while (parent) {
      if (
        ts.isBinaryExpression(parent) &&
        parent.left.getText(pageAst) === "releaseStep === 2"
      )
        finalStep = true;
      parent = parent.parent;
    }
    expect(finalStep).toBe(true);
    expect(pageSource).toContain(
      "{selectedPlanIds.length} test plan(s) will contribute",
    );
    expect(pageSource).toContain(
      "A new quality plan with {newCriteria.length} pending",
    );
    expect(pageSource).toContain('`Goals: ${releaseGoals.join(", ")}.`');
    expect(pageSource).toContain("const request = createRequest ??");
    expect(pageSource).toContain('wordingMode: "EXACT" as const');
    expect(mount(draft())).toBe(markup(draft()));
  });
});
