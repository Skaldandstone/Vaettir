import assert from "node:assert/strict";
import test from "node:test";
import { qaStrategyList, strategyRows, editStrategyRow, removeStrategyRow, sameStrategyRowValues, qaStrategyFingerprint, sameStrategySuggestionScope } from "./qa-strategy-fields.ts";
test("complete native lists preserve empty, commas, whitespace, duplicate strings and order", () => {
  const raw = ["", " a,b ", "same", "same", "line\nnext"];
  const list = qaStrategyList({ riskAreas: raw }, "riskAreas");
  assert.equal(list.kind, "supported"); assert.equal(list.items, raw);
  assert.equal(qaStrategyList({}, "riskAreas").kind, "missing");
  for (const value of [null, undefined, "text", 0, { x: [] }, ["retain", 3, "", null]]) {
    const retained = qaStrategyList({ riskAreas: value }, "riskAreas");
    assert.equal(retained.kind, "retained"); assert.equal(retained.raw, value); assert.equal(Object.hasOwn(retained, "items"), false);
  }
});
test("opaque row IDs are stable through edits and selected duplicate removal without persisting IDs", () => {
  let serial = 0;
  const rows = strategyRows(["same", "same", ""], () => `opaque-${serial++}`);
  const changed = editStrategyRow(rows, rows[1].id, " a,b\nexact ");
  assert.deepEqual(changed.map(row => row.id), rows.map(row => row.id));
  const removed = removeStrategyRow(changed, rows[0].id);
  assert.deepEqual(removed, [changed[1], changed[2]]);
  assert.equal(sameStrategyRowValues(removed, [" a,b\nexact ", ""]), true);
  assert.equal(sameStrategyRowValues(removed, ["", " a,b\nexact "]), false);
  assert.deepEqual(rows.map(row => row.value), ["same", "same", ""]);
  assert.throws(() => editStrategyRow(rows, "missing", "x"), /no longer present/);
});
test("suggestion scope pins entire raw values, project, actor, session and mounted readiness", () => {
  const raw = { riskAreas: [""], unrelated: { retain: [null, 3] } };
  const original = { ready: true, fingerprint: qaStrategyFingerprint("project", raw), actorId: "actor", sessionId: "session", generation: 1 };
  assert.equal(sameStrategySuggestionScope(original, { ...original }), true);
  for (const change of [{ ready: false }, { actorId: "other" }, { sessionId: "new-session" }, { generation: 2 }, { fingerprint: qaStrategyFingerprint("other-project", raw) }, { fingerprint: qaStrategyFingerprint("project", { ...raw, unrelated: { retain: [null, 4] } }) }, { fingerprint: qaStrategyFingerprint("project", { ...raw, riskAreas: ["edited"] }) }]) assert.equal(sameStrategySuggestionScope(original, { ...original, ...change }), false);
  assert.equal(sameStrategySuggestionScope({ ...original, sessionId: null }, { ...original, sessionId: null }), false);
});
