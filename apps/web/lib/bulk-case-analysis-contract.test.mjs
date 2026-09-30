import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../components/BulkCaseAnalysis.tsx", import.meta.url), "utf8");

test("bulk analysis retries require a fresh preview and explicit approval", () => {
  assert.match(component, /setPlan\(null\); setApproved\(false\);\s*setDone\(failures\.length === 0\)/);
  assert.match(component, /!plan && <button[^\n]*Review cases and cost/);
  assert.match(component, /newItems\.map\(item => item\.id\)/);
  assert.match(component, /disabled=\{busy \|\| !newItems\.length\}[^\n]*Make a request/);
});
