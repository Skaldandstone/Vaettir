import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
const scope = { setLevel: vi.fn(), setTag: vi.fn(), setContext: vi.fn() };
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  withScope: (callback: (s: typeof scope) => void) => callback(scope),
}));

const { verifiedWorkspaceWebHost, WorkspaceIngressError } = await import("./workspace-auth");
const { workspaceIngressRejection } = await import("./workspace-ingress-response");

const secret = "synthetic-ingress-response-".repeat(3);
const host = "app.vaettir.app";
function signed(target: string, time = String(Date.now())) {
  return new Headers({ "x-vaettir-host": host, "x-vaettir-time": time, "x-vaettir-target": target,
    "x-vaettir-signature": createHmac("sha256", secret).update(["vaettir-domain-v1", time, "GET", host, target].join("\n")).digest("hex") });
}
async function rejection(request: { method: string; url: string; headers: Headers }) {
  try { await verifiedWorkspaceWebHost(request, secret); } catch (error) { return error; }
  throw new Error("expected rejection");
}
afterEach(() => vi.clearAllMocks());

describe("workspace ingress rejection response", () => {
  it("classifies each refused attestation with a reason and keeps the message", async () => {
    const headers = signed("/projects?a=1");
    const cases: [Headers, string, string][] = [
      [new Headers({ ...Object.fromEntries(headers), "x-vaettir-host": "evil.test" }), "/projects?a=1", "host"],
      [signed("/projects?a=1", String(Date.now() - 120_000)), "/projects?a=1", "time"],
      [new Headers({ ...Object.fromEntries(headers), "x-vaettir-signature": "zz" }), "/projects?a=1", "signature_format"],
      [headers, "/other?a=1", "target"],
      [new Headers({ ...Object.fromEntries(headers), "x-vaettir-signature": "0".repeat(64) }), "/projects?a=1", "signature"],
    ];
    for (const [h, path, reason] of cases) {
      const error = await rejection({ method: "GET", url: "http://localhost:3000" + path, headers: h });
      expect(error).toBeInstanceOf(WorkspaceIngressError);
      expect((error as InstanceType<typeof WorkspaceIngressError>).reason).toBe(reason);
      expect((error as Error).message).toBe("Invalid workspace ingress");
    }
  });
  it("answers a forged attestation with a non-cacheable 400 and still reports it", async () => {
    const headers = new Headers({ ...Object.fromEntries(signed("/projects")), "x-vaettir-signature": "0".repeat(64) });
    const error = await rejection({ method: "HEAD", url: "http://localhost:3000/projects", headers });
    const response = workspaceIngressRejection(error, { method: "HEAD", headers });
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(captureException).toHaveBeenCalledWith(error);
    expect(scope.setLevel).toHaveBeenCalledWith("warning");
    expect(scope.setTag).toHaveBeenCalledWith("workspace_ingress.reason", "signature");
  });
  it("rethrows unrelated failures untouched without reporting them here", () => {
    const failure = new Error("unrelated");
    expect(() => workspaceIngressRejection(failure, { method: "GET", headers: new Headers() })).toThrow(failure);
    expect(captureException).not.toHaveBeenCalled();
  });
});
