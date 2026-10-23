// Public, credential-free transport/release checks. Never create approvals here.
import { pathToFileURL } from "node:url";

export async function preflight(origin, expectedRelease, fetchImpl = fetch) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/")
    throw new Error("An HTTPS origin without credentials or a path is required.");
  if (!/^[a-f0-9]{40}$/.test(expectedRelease) || /^0+$/.test(expectedRelease))
    throw new Error("Pin the reviewed deployed release commit.");
  const request = (path) => fetchImpl(new URL(path, base), {
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/json" },
  });
  const health = await request("/api/health/detailed");
  if (health.status !== 200 || !/^application\/json\b/i.test(health.headers.get("content-type") ?? ""))
    throw new Error("Release health is unavailable.");
  // Bounded public health input; do not print service internals or raw errors.
  const reader = health.body?.getReader();
  if (!reader) throw new Error("Release health is unavailable.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) throw new Error("Release health is unavailable.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (body.healthy !== true || body.release?.commit !== expectedRelease || body.release?.verifiable !== true ||
      !/^sha256:[a-f0-9]{64}$/.test(body.release?.imageDigest ?? ""))
    throw new Error("The healthy reviewed release is not deployed.");
  const denied = await request("/api/integrations/ai/v1/project-summary?projectId=synthetic-readiness-probe");
  const gatewayReady = denied.status === 403 && /\bno-store\b/i.test(denied.headers.get("cache-control") ?? "");
  await denied.body?.cancel().catch(() => {});
  return { release: expectedRelease, gatewayReady, readyForAdminApproval: gatewayReady,
    customerApprovalVerified: false, authenticatedReadVerified: false, installedCodexVerified: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await preflight(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result));
    if (!result.gatewayReady) process.exitCode = 2;
  } catch {
    console.error("Vaettir release preflight failed. Review release identity, health and gateway activation.");
    process.exitCode = 1;
  }
}
