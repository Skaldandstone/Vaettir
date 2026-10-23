import { NextRequest } from "next/server";
import { verifiedWorkspaceWebHost } from "./workspace-auth";

// Clerk builds its satellite handshake before our auth callback runs. The ALB
// connection is HTTP, so only an attested workspace may restore the browser's
// HTTPS context here. Body-bearing requests retain their original stream.
export async function verifiedWorkspaceClerkRequest(
  request: NextRequest,
  enabled: boolean,
  secret: string | undefined,
): Promise<NextRequest> {
  if (!enabled || !["GET", "HEAD"].includes(request.method)) return request;
  const host = await verifiedWorkspaceWebHost(request, secret);
  if (!host) return request;
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", host);
  headers.set("x-forwarded-proto", "https");
  return new NextRequest(request, { headers });
}
