// Source-only contracts authored, NOT RUN. Parent mount/navigation acceptance open.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../components/CaseObservationHistoryEntry.tsx", import.meta.url), "utf8");

test("inactive parent hides links; no private observation fetch or duplicate mutation workflow", () => {
  assert.match(source, /if \(!active\) return null/);
  assert.match(source, /entry\.kind === "UNAVAILABLE"/);
  for (const forbidden of ["trpcReact", "useQuery", "useMutation", "ManualCaseResultHistory", "JSON.stringify", "item.outcomeCounts", "item.starter"])
    assert.ok(!source.includes(forbidden), forbidden);
});

test("new native tab retains parent context and discloses correction/legacy semantics without automatic writes", () => {
  for (const required of ['target="_blank"', 'rel="noopener noreferrer"', "prefetch={false}", "opens in a new tab", "mounted drafts", "rechecks current workspace access", "not an authorization grant",
    "does not record or correct anything automatically", "Execution, correction and legacy evidence limits", "<summary>", "displayId"])
    assert.ok(source.includes(required), required);
});
