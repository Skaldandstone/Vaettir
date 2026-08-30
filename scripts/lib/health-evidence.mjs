export const expectedPollers = ['reverseEngineerWorker', 'readinessDigestScheduler', 'aiCreditGrantScheduler'];

export function evaluateHealth(body, expectedCommit) {
  const problems = [];
  if (body?.healthy !== true) problems.push('API_REPORTS_UNHEALTHY');
  if (body?.db?.ok !== true) problems.push('DATABASE_UNHEALTHY');
  const pollers = Array.isArray(body?.pollers) ? body.pollers : [];
  for (const name of expectedPollers) {
    const matches = pollers.filter(item => item?.name === name);
    if (matches.length !== 1 || matches[0].stale !== false || !Number.isFinite(matches[0].ageMs) || matches[0].ageMs < 0
      || !Number.isFinite(Date.parse(matches[0].lastTickAt))) problems.push(`POLLER_UNHEALTHY:${name}`);
  }
  const commit = /^[a-f0-9]{40}$/.test(body?.release?.commit) ? body.release.commit : null;
  if (expectedCommit && !/^[a-f0-9]{40}$/.test(expectedCommit)) throw new Error('Expected commit must be a full Git SHA.');
  if (expectedCommit && commit !== expectedCommit) problems.push('RELEASE_COMMIT_MISMATCH');
  return { healthy: problems.length === 0, releaseCommit: commit, problems,
    pollers: expectedPollers.map(name => ({ name, stale: pollers.find(p => p?.name === name)?.stale !== false })) };
}

export async function probeHealth(value, expectedCommit, timeoutMs = 10000) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !['/health/detailed', '/api/health/detailed'].includes(url.pathname)
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) {
    throw new Error('Use a credential-free HTTPS detailed-health URL, or loopback HTTP.');
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { accept: 'application/json' } });
    if (response.status !== 200) return { healthy: false, problems: ['HTTP_STATUS_NOT_200'], statusCode: response.status };
    return evaluateHealth(await response.json(), expectedCommit);
  } catch { return { healthy: false, problems: ['HEALTH_REQUEST_FAILED'] }; }
}
