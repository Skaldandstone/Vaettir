import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  caseExportIds,
  scopeCaseExport,
  spreadsheetText,
} from "./test-case-export.ts";

test("filtered export follows the visible filtered order, not server or title order", () => {
  const visible = [{ id: "b" }, { id: "a" }];
  const rows = [
    { id: "a", title: "Same" },
    { id: "hidden", title: "Other" },
    { id: "b", title: "Same" },
  ];
  assert.deepEqual(
    scopeCaseExport(rows, caseExportIds(visible, new Set(), "filtered")).map(
      (row) => row.id,
    ),
    ["b", "a"],
  );
});
test("selected export intersects current visible scope and ignores stale foreign selections", () => {
  assert.deepEqual(
    caseExportIds(
      [{ id: "b" }, { id: "a" }],
      new Set(["hidden", "a", "other-project"]),
      "selected",
    ),
    ["a"],
  );
});
test("empty filter and selection export no rows", () => {
  assert.deepEqual(caseExportIds([], new Set(["stale"]), "filtered"), []);
  assert.deepEqual(caseExportIds([{ id: "a" }], new Set(), "selected"), []);
});
test("missing cases fail rather than silently downloading a smaller file", () => {
  assert.throws(
    () => scopeCaseExport([{ id: "a" }], ["a", "deleted"]),
    /case list changed/,
  );
});
test("duplicates cannot expand the exported count", () => {
  assert.deepEqual(
    caseExportIds([{ id: "a" }, { id: "a" }], new Set(), "filtered"),
    ["a"],
  );
});
test("formula-like cells are text and carriage returns are normalized for CSV quoting", () => {
  for (const value of [
    '=HYPERLINK("https://example.invalid")',
    "+1",
    "-2",
    "@SUM(A1)",
    "  =1",
    "\tcontent",
    "\rcontent",
  ])
    assert.ok(spreadsheetText(value).startsWith("'"));
  assert.equal(
    spreadsheetText('Comma, "quoted"\rnext'),
    'Comma, "quoted"\nnext',
  );
  assert.equal(spreadsheetText("ordinary title"), "ordinary title");
});
test("page binds export to visible identity scope, archive state and explicit counts", () => {
  const page = readFileSync(
    new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /caseExportIds\(visibleCases, selected, scope\)/);
  assert.match(page, /scopeCaseExport\(available, ids\)/);
  assert.match(page, /includeArchived: showArchived/);
  assert.match(page, /Spreadsheet CSV \(\$\{visibleCases.length\} shown\)/);
  assert.match(page, /Selected spreadsheet CSV \(\{selectedExportCount\}\)/);
  assert.match(page, /Case procedures JSON \(\{visibleCases.length\} shown\)/);
  assert.match(page, /Selected procedures JSON \(\{selectedExportCount\}\)/);
  assert.match(page, /utils.testCases.exportProcedure.fetch\(\{/);
  assert.match(page, /encodeCaseProcedureExport\(bundle\)/);
  assert.match(page, /not a full backup and cannot yet be reimported/);
  assert.match(page, /r.displayId/);
  assert.match(page, /row.map\(spreadsheetText\)/);
});
test("export API exposes stable IDs and retains project authorization", () => {
  const router = readFileSync(
    new URL("../../api/src/routers/testCases.ts", import.meta.url),
    "utf8",
  );
  const endpoint = router.slice(
    router.indexOf("  exportCsv: protectedProcedure"),
    router.indexOf("  byId: protectedProcedure"),
  );
  assert.match(endpoint, /id: z.string\(\)/);
  assert.match(endpoint, /id: true/);
  assert.match(endpoint, /displayId: z.string\(\)/);
  assert.match(endpoint, /displayId: true/);
  assert.match(endpoint, /requireProjectAccess\(ctx, input.projectId\)/);
  assert.match(endpoint, /projectId: input.projectId/);
});
