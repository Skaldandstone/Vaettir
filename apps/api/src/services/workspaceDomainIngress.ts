import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@vaettir/db";
import { workspaceNameError } from "@vaettir/core";

const bindings = new WeakMap<FastifyRequest, string | null>();
const hosts = new WeakMap<FastifyRequest, string>();
export const requestWorkspaceOrganization = (request: FastifyRequest) => bindings.get(request) ?? null;
export const requestWorkspaceHost = (request: FastifyRequest) => hosts.get(request) ?? null;
const canonicalTarget = (target: string) => target.replace(/^\/api(?=\/)/, "");
export function ingressMessage(method: string, target: string, hostname: string, timestamp: string) {
  return ["vaettir-domain-v1", timestamp, method.toUpperCase(), hostname, canonicalTarget(target)].join("\n");
}
export function verifyWorkspaceIngress(
  headers: Record<string, unknown>, method: string, target: string,
  secret: string | undefined, now = Date.now(),
): string | null {
  const hostname = headers["x-vaettir-host"];
  const timestamp = headers["x-vaettir-time"];
  const signature = headers["x-vaettir-signature"];
  const forwarded = headers["x-forwarded-host"];
  if (hostname === undefined && timestamp === undefined && signature === undefined) {
    // The legacy origin keeps its existing auth behavior. New customer hosts
    // require an attestation, even when forged directly at the public origin.
    if ([forwarded, headers.host].some(value => typeof value === "string" && /(^|\.)vaettir\.app(?::\d+)?$/i.test(value)))
      throw new Error("DOMAIN_INGRESS_REQUIRED");
    return null;
  }
  if (process.env.VAETTIR_WORKSPACE_DOMAINS_ENABLED !== "1" || !secret || secret.length < 64
      || typeof hostname !== "string" || typeof timestamp !== "string"
      || typeof signature !== "string" || !/^\d{13}$/.test(timestamp)
      || Math.abs(now - Number(timestamp)) > 30_000 || !/^[a-f0-9]{64}$/.test(signature))
    throw new Error("DOMAIN_INGRESS_INVALID");
  const name = hostname.endsWith(".vaettir.app") ? hostname.slice(0, -".vaettir.app".length) : "";
  if (hostname !== "app.vaettir.app" && (!name || workspaceNameError(name) || hostname !== hostname.toLowerCase()))
    throw new Error("DOMAIN_INGRESS_INVALID");
  const expected = createHmac("sha256", secret).update(ingressMessage(method, target, hostname, timestamp)).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new Error("DOMAIN_INGRESS_INVALID");
  return hostname;
}
export function registerWorkspaceIngress(server: FastifyInstance, db: PrismaClient) {
  server.addHook("onRequest", async (request, reply) => {
    try {
      const host = verifyWorkspaceIngress(request.headers, request.method, request.url, process.env.VAETTIR_DOMAIN_INGRESS_SECRET);
      if (!host) return;
      hosts.set(request, host);
      reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
      if (request.headers.origin && request.headers.origin !== `https://${host}`)
        return reply.code(403).send({ error: "Workspace origin is not permitted." });
      if (host === "app.vaettir.app") { bindings.set(request, null); return; }
      const name = host.slice(0, -".vaettir.app".length);
      const claim = await db.workspaceDomain.findUnique({
        where: { name }, select: { organizationId: true, organization: { select: { suspendedAt: true } } },
      });
      if (!claim?.organizationId || !claim.organization || claim.organization.suspendedAt)
        return reply.code(404).send({ error: "Workspace unavailable." });
      bindings.set(request, claim.organizationId);
      // Every other public callback/webhook/REST surface stays on the entry
      // origin until it has an explicit tenant-aware contract and acceptance.
      const path = canonicalTarget(request.url).split("?")[0] ?? "";
      if (!(path === "/trpc" || path.startsWith("/trpc/") || path === "/integrations/ai/v1/project-summary"
          || path === "/health" || path === "/health/detailed"))
        return reply.code(403).send({ error: "This operation is unavailable on a workspace address." });
      if (path.startsWith("/integrations/ai/")) {
        const query = request.query as { projectId?: unknown };
        if (typeof query.projectId !== "string" || !(await db.project.count({ where: { id: query.projectId, organizationId: claim.organizationId } })))
          return reply.code(403).send({ error: "AI disclosure is not permitted." });
      }
    } catch {
      return reply.header("Cache-Control", "no-store").code(403).send({ error: "Workspace request is not permitted." });
    }
  });
}
