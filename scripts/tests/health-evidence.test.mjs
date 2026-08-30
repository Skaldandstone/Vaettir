import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { evaluateHealth, expectedPollers, probeHealth } from '../lib/health-evidence.mjs';

const revision = 'a'.repeat(40);
const healthy = () => ({ healthy: true, db: { ok: true }, release: { commit: revision }, pollers: expectedPollers.map(name => ({ name, stale: false, ageMs: 10, lastTickAt: new Date().toISOString() })) });
test('requires database, all expected pollers and matching immutable release identity', () => {
  assert.equal(evaluateHealth(healthy(), revision).healthy, true);
  for (const body of [null, {}, { ...healthy(), db: { ok: false } }, { ...healthy(), pollers: [] }, { ...healthy(), healthy: false }, { ...healthy(), release: { commit: 'b'.repeat(40) } }]) assert.equal(evaluateHealth(body, revision).healthy, false);
  const duplicate = healthy(); duplicate.pollers.push(duplicate.pollers[0]);
  assert.equal(evaluateHealth(duplicate, revision).healthy, false);
});
test('rejects stale and never-started pollers even when overall status says healthy', () => {
  const body = healthy(); body.pollers[0].ageMs = null;
  assert.equal(evaluateHealth(body).healthy, false);
  body.pollers[0].ageMs = 10; body.pollers[0].stale = true;
  assert.equal(evaluateHealth(body).healthy, false);
});
test('probe reads actual JSON and does not treat HTTP 200 as acceptance', async () => {
  let response = healthy();
  const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(response)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/health/detailed`;
    assert.equal((await probeHealth(url, revision)).healthy, true);
    response.db.ok = false;
    assert.equal((await probeHealth(url, revision)).healthy, false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('rejects remote plaintext, credentials and redirected/query-bearing probe targets', async () => {
  for (const url of ['http://example.com/health/detailed', 'https://user:pass@example.com/health/detailed', 'https://example.com/health/detailed?secret=x']) await assert.rejects(probeHealth(url));
});
