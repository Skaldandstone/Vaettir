import { EventEmitter } from "node:events";
import type { RequestOptions } from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isPublicProviderIPv4, repositoryProviderJson, repositoryProviderOrigin } from "./repositoryProviderHttp.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

type Response = EventEmitter & { statusCode: number; destroy: ReturnType<typeof vi.fn> };
let response: Response;
let transportOptions: RequestOptions;
let deliver: () => void;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(lookup).mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  response = Object.assign(new EventEmitter(), { statusCode: 200, destroy: vi.fn() });
  const req = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
  vi.mocked(request).mockImplementation(((url: URL, options: RequestOptions, callback: (res: Response) => void) => {
    expect(url.hostname).toBe("gitlab.example.com");
    transportOptions = options;
    deliver = () => callback(response);
    return req;
  }) as unknown as typeof request);
});
afterEach(() => { vi.useRealTimers(); });
const flushDns = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("repository provider HTTP boundary", () => {
  it("rejects internal, non-HTTPS and credential-bearing origins", () => {
    for (const origin of ["http://gitlab.example.com", "https://127.0.0.1", "https://[::1]", "https://user:pass@gitlab.example.com", "https://gitlab.example.com/path", "https://gitlab.example.com:444"])
      expect(() => repositoryProviderOrigin(origin)).toThrow();
    for (const ip of ["127.0.0.1", "169.254.169.254", "10.1.2.3", "172.16.0.1", "192.168.1.1", "100.64.0.1", "::1", "0.0.0.0", "224.0.0.1"])
      expect(isPublicProviderIPv4(ip)).toBe(false);
  });
  it("rejects mixed public and private DNS without opening HTTPS", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "169.254.169.254", family: 4 }]);
    await expect(repositoryProviderJson("https://gitlab.example.com", "/api/v4/user")).rejects.toThrow("public HTTPS");
    expect(request).not.toHaveBeenCalled();
  });
  it("pins the checked address to the TLS socket and preserves hostname", async () => {
    const pending = repositoryProviderJson("https://gitlab.example.com", "/api/v4/user", { token: "synthetic" });
    await flushDns();
    const socketLookup = transportOptions.lookup as (host: string, options: object, cb: (...args: unknown[]) => void) => void;
    const callback = vi.fn();
    socketLookup("gitlab.example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    expect(lookup).toHaveBeenCalledTimes(1);
    deliver(); response.emit("data", Buffer.from('{"id":1}')); response.emit("end");
    await expect(pending).resolves.toEqual({ id: 1 });
  });
  it("never follows redirects or forwards credentials to their destination", async () => {
    response.statusCode = 302;
    const pending = repositoryProviderJson("https://gitlab.example.com", "/oauth/token", { form: new URLSearchParams({ client_secret: "synthetic" }) });
    const assertion = expect(pending).rejects.toThrow("302");
    await flushDns(); deliver(); await assertion;
    expect(response.destroy).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-origin endpoints before DNS or credentials", async () => {
    await expect(repositoryProviderJson("https://gitlab.example.com", "https://other.example.com/api", { token: "synthetic" })).rejects.toThrow("Invalid provider endpoint");
    expect(lookup).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });
  it("bounds DNS and refuses to open a socket when DNS resolves after timeout", async () => {
    vi.useFakeTimers();
    let completeDns!: (value: { address: string; family: number }[]) => void;
    vi.mocked(lookup).mockReturnValue(new Promise(resolve => { completeDns = resolve; }) as ReturnType<typeof lookup>);
    const pending = repositoryProviderJson("https://gitlab.example.com", "/api/v4/user");
    const assertion = expect(pending).rejects.toThrow("safe time limit");
    await vi.advanceTimersByTimeAsync(15000); await assertion;
    completeDns([{ address: "8.8.8.8", family: 4 }]); await flushDns();
    expect(request).not.toHaveBeenCalled();
  });
  it("uses the same total deadline after DNS rather than restarting the timer", async () => {
    vi.useFakeTimers();
    vi.mocked(lookup).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([{ address: "8.8.8.8", family: 4 }]), 14000)) as ReturnType<typeof lookup>);
    const pending = repositoryProviderJson("https://gitlab.example.com", "/api/v4/user");
    const assertion = expect(pending).rejects.toThrow("safe time limit");
    await vi.advanceTimersByTimeAsync(14000);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000); await assertion;
    expect(transportOptions.signal?.aborted).toBe(true);
  });
  it("destroys responses exceeding the one MiB body limit", async () => {
    const pending = repositoryProviderJson("https://gitlab.example.com", "/api/v4/projects");
    const assertion = expect(pending).rejects.toThrow("safe size limit");
    await flushDns(); deliver(); response.emit("data", Buffer.alloc(1024 * 1024 + 1)); await assertion;
    expect(response.destroy).toHaveBeenCalledOnce();
  });
});
