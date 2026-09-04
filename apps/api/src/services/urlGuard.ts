import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Webhook and Slack digest URLs are admin-supplied and fetched from this
 * server (dispatchWebhookEvent, postSlackDigest). Without a guard that is a
 * server-side request forgery hole: a URL like http://169.254.169.254/ or
 * http://localhost:5432/ would be fetched with the API server's own network
 * position. We allow only http/https to hostnames that resolve outside
 * private/reserved address space, checked both when a URL is saved and again
 * immediately before every delivery (DNS can change between the two).
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a = 0, b = 0] = parts;
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
  // IPv4-mapped addresses (::ffff:127.0.0.1) inherit the IPv4 rules.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  return mapped ? isPrivateIPv4(mapped[1] as string) : false;
}

const isPrivateAddress = (ip: string): boolean =>
  isIP(ip) === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip);

/** Throws unless `raw` is a public http(s) URL. Returns the normalized URL. */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError(`"${raw}" is not a valid URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Only http and https links are allowed (got ${url.protocol}).`);
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("That URL points at a private address.");
  }

  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError("That URL points at a private address.");
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve ${host}.`);
  }

  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError("That URL points at a private address.");
  }

  return url;
}
