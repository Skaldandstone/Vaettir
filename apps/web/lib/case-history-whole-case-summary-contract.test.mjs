// SOURCE ONLY: authored NOT RUN. Not React/Clerk/runtime or immutable-history acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const component = readFileSync(new URL("../components/TestCaseExecutionHistory.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../api/src/services/caseExecutionHistory.ts", import.meta.url), "utf8");
test("case-centred metadata uses retained recorder/time and does not label corrections as new executions", () => {
  for (const value of ["item.wholeCase.correctionCount", "not separate retests", "Retained whole-case observations", "Last whole-case recorder (name recorded at observation)",
    "item.wholeCase.lastRecorderName", "dateTime={item.wholeCase.lastRecordedAt}", "Original observations remain in the native history"])
    assert.ok(component.includes(value), value);
  assert.ok(!component.includes("trpcReact.manualCaseResults.history.useQuery"));
  assert.ok(!component.includes("ManualCaseResultHistory"));
  assert.ok(component.includes("CaseObservationHistoryEntry"));
});
test("summary projects only after locked scoped page selection and remains exact-original-key guarded", () => {
  assert.ok(service.indexOf("await lockCaseHistoryAccess") < service.indexOf("await readCaseHistoryWholeCaseSummaries"));
  assert.ok(service.indexOf("const runIds = page.map") < service.indexOf("await readCaseHistoryWholeCaseSummaries"));
  assert.ok(service.includes("originalOrganizationId: access.organizationId, runIds"));
  assert.ok(service.includes("Object.hasOwn(wholeCaseSummaries, run.id)"));
  assert.ok(service.includes("!m.recordedCount && resultCount && !wholeCase"));
  assert.ok(service.includes("lastRecordedAt: wholeCase.lastRecordedAt.toISOString()"));
  assert.ok(service.includes("earlier unrecorded changes are not reconstructed"));
  assert.ok(component.includes("history.data.requested === caseHistoryRequestKey(input)"));
});
