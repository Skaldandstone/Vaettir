import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../components/RequirementBaselines.tsx", import.meta.url), "utf8");
// Source contracts are authored, not executed. They cannot establish rendered
// behavior or real TanStack QueryClient cache acceptance.
test("fresh current scope and permissions, not cached failed/offline data, gate captures", () => {
  for (const name of ["list", "detail", "permissions"]) {
    assert.ok(source.includes(`!${name}.error && !${name}.isFetching && !${name}.isPaused`), name);
  }
  assert.match(source, /current!\.currentFingerprint === approval\.fingerprint/);
  assert.match(source, /current!\.latestVersion === approval\.version/);
  assert.match(source, /current\.selectedIsLatest/);
  assert.match(source, /<Register key=\{projectId\}/);
});
test("an unconfirmed capture survives close and retains exact payload through typed refusal", () => {
  assert.match(source, /pending \?\? structuredClone\(input\)/);
  assert.match(source, /retainRequirementBaselineCapture\(receiptRef\.current, error\)/);
  assert.match(source, /setOpen\(false\); setAcknowledged\(false\)/);
  assert.match(source, /Retry exact baseline capture/);
});
test("original project/member/Clerk scope withholds cached history wording and chips without erasing human rationale", () => {
  for (const value of ["useAuth", "project.isFetchedAfterMount", "organizations.isFetchedAfterMount", "origin.organizationId === project.data?.organizationId", "origin.clerkActorId === userId", "sameScope(permissions.data)", "sameScope(list.data)", "sameScope(detail.data)", "expectedScope: origin ?? undefined", "cached wording, chips and history are hidden"])
    assert.ok(source.includes(value), value);
  assert.ok(!source.includes("key={userId}"));
  const begin = source.slice(source.indexOf("function startReview"), source.indexOf("async function send"));
  assert.ok(!begin.includes("setRationale(\"\")"));
});
test("approval binds complete fresh response and availability epoch; ACK and read refresh cannot share a refusal path", () => {
  for (const value of ["approval.response === current", "approval.epoch === availability.current.epoch", "requirementBaselineAckMatches(receipt, request, origin)", "receiptRef.current?.input ?? pending ?? structuredClone(input)", "Capture acknowledged; current view refresh failed", "Retry reads without resubmitting", "mounted.current"])
    assert.ok(source.includes(value), value);
});

test("late acknowledgement cannot use an old actor or access epoch after a scope loss and return", () => {
  assert.match(source, /const requestEpoch = liveCapture\.current\.epoch/);
  assert.match(source, /!liveCapture\.current\.available \|\| liveCapture\.current\.epoch !== requestEpoch/);
  assert.match(source, /liveCapture\.current\.clerkActorId !== origin\.clerkActorId/);
  assert.ok(source.indexOf("Current capture access changed while acknowledgement") < source.indexOf("receiptRef.current = null"));
});
test("human baseline scope review is progressive, linked and explicitly unqualified", () => {
  for (const text of ["Wording comparison", "Direct case scope", "Capture rationale and limits", "No execution verification",
    "Earlier snapshots remain intact", "Native case unavailable", "Retained immutable baseline history", "label excerpt"])
    assert.ok(source.includes(text), text);
  assert.match(source, /not verified coverage, a qualified signature or regulatory approval/);
  assert.match(source, /width: "100%", minWidth: 0, boxSizing: "border-box"/);
});

test("complete supported wording is grouped without calling a missing side unchanged", () => {
  for (const text of ["groupBaselineWording(current.baseline?.requirement ?? null, current.current, current.comparison.changedFields)",
    "Changed recorded fields", "Unchanged recorded fields", "Fields without two available comparison sides", "unsupported changed fields",
    "Current requirement</th>", "Captured baseline</th>", "not proof of unchanged procedure"])
    assert.ok(source.includes(text), text);
  assert.ok(!source.includes("setRationale(\"\")"));
});

test("literal title search binds the canonical echoed query while preserving typed local search", () => {
  assert.match(source, /const searchTerm = baselineLiteralSearch\(search\)/);
  assert.match(source, /search: searchTerm, expectedScope: origin/);
  assert.match(source, /list\.data\.search === searchTerm/);
  assert.match(source, /value=\{search\}/);
  assert.ok(source.includes("%, _ and backslash are text, not wildcard patterns"));
});

test("native expandable case chips disclose page-only filtering and current-versus-captured limitations", () => {
  for (const text of ["filterBaselineCasePage(current.affected.items, caseSearch)", "<details key={c.caseId ?? c.displayId}",
    "baselineNativeCaseHref(projectId, c.caseId, c.available)", "<summary", "Open current native test case", "No currently available same-project native case route",
    "does not search other pages or full case procedures", "not the historical procedure at baseline capture", "Show all candidates on this page",
    "filtering does not change captured/current membership", "Previous cases", "Next cases"])
    assert.ok(source.includes(text), text);
  assert.ok(!source.includes("setTarget({ caseId:"));
});
